import { randomBytes } from 'node:crypto';
import type { Knex } from 'knex';

interface Payment {
  invoiceId: string;
  address: string;
  assetId: string;
  amount: string;
}

interface Block {
  id: string;
  block_no: number;
  hash: Buffer;
}

async function insertBlock(trx: Knex.Transaction, parent?: Block): Promise<Block> {
  const [block] = await trx('public.block').insert({
    previous_id: parent?.id ?? null,
    block_no: (parent?.block_no ?? 0) + 1,
    hash: randomBytes(32),
  }).returning<Block[]>(['id', 'block_no', 'hash']);
  return block;
}

async function insertPayment(trx: Knex.Transaction, block: Block, payment: Payment): Promise<string> {
  const hash = randomBytes(32);
  const [{ id: txId }] = await trx('public.tx').insert({ hash, block_id: block.id }).returning('id');
  const [{ id: outputId }] = await trx('public.tx_out').insert({
    tx_id: txId,
    index: 0,
    address: payment.address,
    value: payment.assetId === 'ADA' ? payment.amount : '3000000',
  }).returning('id');
  if (payment.assetId !== 'ADA') {
    const [policy, name] = payment.assetId.split('.');
    const key = { policy: Buffer.from(policy, 'hex'), name: Buffer.from(name, 'hex') };
    await trx('public.multi_asset').insert(key).onConflict(['policy', 'name']).ignore();
    const asset = await trx('public.multi_asset').where(key).first('id');
    await trx('public.ma_tx_out').insert({ tx_out_id: outputId, ident: asset.id, quantity: payment.amount });
  }
  return hash.toString('hex');
}

async function invoicePayment(db: Knex, args: string[]): Promise<Payment> {
  const [id, quantity] = args;
  if (!id || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) || args.length > 2) {
    throw new Error('Usage: cardano payment <invoice-id> [minor-units]');
  }
  const invoice = await db('invoices').where({ id, chain: 'cardano' }).first('address', 'asset_id', 'amount');
  if (!invoice) throw new Error('Cardano invoice not found');
  const amount = quantity ?? String(invoice.amount);
  if (!/^\d{1,20}$/.test(amount) || BigInt(amount) === 0n || BigInt(amount) > 18446744073709551615n) {
    throw new Error('Payment amount must be a positive integer in minor units within Cardano limits');
  }
  return { invoiceId: id, address: invoice.address, assetId: invoice.asset_id, amount };
}

export async function runCardano(command: string, args: string[], db: Knex, source: Knex): Promise<unknown> {
  if (command !== 'payment' && command !== 'mine' && command !== 'rollback') {
    throw new Error('Expected a Cardano payment, mine or rollback command');
  }
  const payment = command === 'payment' ? await invoicePayment(db, args) : undefined;
  const count = payment ? 1 : Number(args[0] ?? 1);
  if (!payment && (!Number.isInteger(count) || count < 1 || count > 1000 || args.length > 1)) {
    throw new Error('Block count must be an integer from 1 to 1000');
  }

  return source.transaction(async trx => {
    if (!await trx.schema.withSchema('public').hasTable('txgate_sim')) throw new Error('Simulation requires the local db-sync schema');
    await trx.raw('select pg_advisory_xact_lock(?)', [286416813]);
    const tip: Block | undefined = await trx('public.block').orderBy('block_no', 'desc').first();
    if (command === 'rollback') {
      const from = tip?.block_no ?? 0;
      const to = Math.max(from - count, 0);
      await trx('public.block').where('block_no', '>', to).delete();
      return { chain: 'cardano', from, to };
    }

    let block = await insertBlock(trx, tip);
    for (let mined = 1; mined < count; mined++) block = await insertBlock(trx, block);
    if (!payment) return { chain: 'cardano', height: block.block_no, hash: block.hash.toString('hex') };

    const txId = await insertPayment(trx, block, payment);
    return { chain: 'cardano', invoiceId: payment.invoiceId, txId, height: block.block_no, amount: payment.amount };
  });
}
