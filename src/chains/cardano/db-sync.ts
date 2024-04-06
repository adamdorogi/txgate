import type { Knex } from 'knex';
import type { ChainBlock, ChainTransfer, SweepItem, WatchedTarget } from '../types';
import type { CardanoUtxo } from './sweeper';

type Connection = Knex | Knex.Transaction;

interface BlockRow {
  height: number;
  hash: string;
  parent_hash: string | null;
  block_time: Date;
}

interface OutputRow extends BlockRow {
  tx_id: string;
  output_index: number;
  address: string;
  lovelace: string;
  policy: string | null;
  name: string | null;
  quantity: string | null;
}

interface Output extends CardanoUtxo {
  block: ChainBlock;
}

interface Schema {
  inlineAddress: boolean;
  assetTable: boolean;
  inputTable: boolean;
  collateralTable: boolean;
  consumedColumn: boolean;
}

function blockFromRow(row: BlockRow): ChainBlock {
  return { height: Number(row.height), hash: row.hash, parentHash: row.parent_hash, time: row.block_time };
}

function groupOutputs(rows: OutputRow[]): Map<string, Output> {
  const outputs = new Map<string, Output>();
  for (const row of rows) {
    const key = `${row.tx_id}#${row.output_index}`;
    let output = outputs.get(key);
    if (!output) {
      output = {
        txId: row.tx_id,
        outputIndex: row.output_index,
        address: row.address,
        lovelace: BigInt(row.lovelace),
        assets: {},
        block: blockFromRow(row),
      };
      outputs.set(key, output);
    }
    if (row.policy !== null && row.name !== null && row.quantity !== null) {
      output.assets[`${row.policy}.${row.name}`] = row.quantity;
    }
  }
  return outputs;
}

export class DbSync {
  private schema?: Schema;

  constructor(private readonly db: Knex) {}

  private async inspectSchema(db: Knex.Transaction): Promise<Schema> {
    if (this.schema) return this.schema;
    const columns = await db('information_schema.columns')
      .select('table_name', 'column_name')
      .where('table_schema', 'public')
      .whereIn('table_name', ['tx_out', 'ma_tx_out', 'tx_in', 'collateral_tx_in']);
    const hasColumn = (table: string, column: string) => columns.some(row => row.table_name === table && row.column_name === column);
    this.schema = {
      inlineAddress: hasColumn('tx_out', 'address'),
      assetTable: hasColumn('ma_tx_out', 'ident'),
      inputTable: hasColumn('tx_in', 'tx_out_id'),
      collateralTable: hasColumn('collateral_tx_in', 'tx_out_id'),
      consumedColumn: hasColumn('tx_out', 'consumed_by_tx_id'),
    };
    return this.schema;
  }

  private blockColumns(db: Connection) {
    return [
      'b.block_no as height',
      db.raw("encode(b.hash, 'hex') as hash"),
      db.raw("encode(parent.hash, 'hex') as parent_hash"),
      db.raw('to_timestamp(extract(epoch from b.time)) as block_time'),
    ];
  }

  private blocks(db: Connection) {
    return db('public.block as b')
      .leftJoin('public.block as parent', 'parent.id', 'b.previous_id')
      .whereNotNull('b.block_no')
      .select<BlockRow[]>(...this.blockColumns(db));
  }

  private outputs(db: Knex.Transaction, schema: Schema) {
    const address = schema.inlineAddress ? 'o.address' : 'a.address';
    const asset = schema.assetTable ? 'native' : 'ma';
    const query = db('public.tx_out as o')
      .join('public.tx as t', 't.id', 'o.tx_id')
      .join('public.block as b', 'b.id', 't.block_id')
      .leftJoin('public.block as parent', 'parent.id', 'b.previous_id')
      .leftJoin('public.ma_tx_out as ma', 'ma.tx_out_id', 'o.id')
      .where('t.valid_contract', true);
    if (!schema.inlineAddress) query.join('public.address as a', 'a.id', 'o.address_id');
    if (schema.assetTable) query.leftJoin('public.multi_asset as native', 'native.id', 'ma.ident');
    return query.select<OutputRow[]>(
      ...this.blockColumns(db),
      db.raw("encode(t.hash, 'hex') as tx_id"),
      'o.index as output_index',
      `${address} as address`,
      'o.value as lovelace',
      db.raw("encode(??, 'hex') as policy", [`${asset}.policy`]),
      db.raw("encode(??, 'hex') as name", [`${asset}.name`]),
      'ma.quantity',
    );
  }

  async getTip(): Promise<ChainBlock | null> {
    const row = await this.blocks(this.db).orderBy('b.block_no', 'desc').first();
    return row ? blockFromRow(row) : null;
  }

  async getBlock(height: number): Promise<ChainBlock | null> {
    const row = await this.blocks(this.db).where('b.block_no', height).first();
    return row ? blockFromRow(row) : null;
  }

  async poll(from: number, to: number, targets: WatchedTarget[]) {
    return this.db.transaction(async trx => {
      await trx.raw('set transaction read only');
      const rows = await this.blocks(trx).whereBetween('b.block_no', [from, to]).orderBy('b.block_no');
      const blocks = rows.map(blockFromRow);
      const transfers: ChainTransfer[] = [];
      if (!targets.length || !blocks.length) return { blocks, transfers };

      const watched = new Map<string, WatchedTarget[]>();
      for (const target of targets) {
        const existing = watched.get(target.address);
        if (existing) existing.push(target);
        else watched.set(target.address, [target]);
      }
      const schema = await this.inspectSchema(trx);
      const outputs = await this.outputs(trx, schema)
        .whereBetween('b.block_no', [from, to])
        .whereRaw('?? = any(?::text[])', [schema.inlineAddress ? 'o.address' : 'a.address', [...watched.keys()]]);

      for (const output of groupOutputs(outputs).values()) {
        for (const target of watched.get(output.address) ?? []) {
          const amount = target.assetId === 'ADA' ? output.lovelace : BigInt(output.assets[target.assetId] ?? '0');
          if (amount === 0n) continue;
          transfers.push({
            invoiceId: target.invoiceId,
            txId: output.txId,
            outputIndex: output.outputIndex,
            blockHeight: output.block.height,
            blockHash: output.block.hash,
            time: output.block.time,
            amount,
            detail: { lovelace: output.lovelace.toString(), assets: output.assets },
          });
        }
      }
      return { blocks, transfers };
    }, { isolationLevel: 'repeatable read' });
  }

  async spendable(items: SweepItem[]): Promise<CardanoUtxo[]> {
    return this.db.transaction(async trx => {
      await trx.raw('set transaction read only');
      const schema = await this.inspectSchema(trx);
      if (!schema.consumedColumn && !schema.inputTable) throw new Error('db-sync has no spent-output index');

      const query = this.outputs(trx, schema)
        .whereIn(['t.hash', 'o.index'], items.map(item => [Buffer.from(item.txId, 'hex'), item.outputIndex]));
      if (schema.consumedColumn) query.whereNull('o.consumed_by_tx_id');
      if (schema.inputTable) query.whereNotExists(trx('public.tx_in as spending')
        .select(trx.raw('1'))
        .join('public.tx as spend_tx', 'spend_tx.id', 'spending.tx_in_id')
        .whereRaw('spending.tx_out_id = o.tx_id and spending.tx_out_index = o.index')
        .where('spend_tx.valid_contract', true));
      if (schema.collateralTable) query.whereNotExists(trx('public.collateral_tx_in as spending')
        .select(trx.raw('1'))
        .join('public.tx as spend_tx', 'spend_tx.id', 'spending.tx_in_id')
        .whereRaw('spending.tx_out_id = o.tx_id and spending.tx_out_index = o.index')
        .where('spend_tx.valid_contract', false));

      const outputs = groupOutputs(await query);
      const spendable = new Map<string, CardanoUtxo>();
      for (const item of items) {
        const key = `${item.txId}#${item.outputIndex}`;
        const output = outputs.get(key);
        if (!output || output.address !== item.address || output.block.hash !== item.blockHash) {
          throw new Error(`Cardano output unavailable: ${key}`);
        }
        const amount = item.assetId === 'ADA' ? output.lovelace : BigInt(output.assets[item.assetId] ?? '0');
        if (amount !== item.amount) throw new Error(`Cardano output amount changed: ${key}`);
        spendable.set(key, { ...output, derivationIndex: item.derivationIndex });
      }
      return [...spendable.values()];
    }, { isolationLevel: 'repeatable read' });
  }
}
