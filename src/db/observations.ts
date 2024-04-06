import type { Knex } from 'knex';
import type { ChainTransfer } from '../chains/types';

export interface TransferRow {
  invoice_id: string;
  tx_id: string;
  output_index: number;
  block_height: string;
  block_hash: string;
  block_time: Date;
  amount: string;
  orphaned: boolean;
  detail: Record<string, unknown>;
}

export function transferRecord(row: TransferRow) {
  return {
    txId: row.tx_id,
    outputIndex: row.output_index,
    blockHeight: Number(row.block_height),
    blockHash: row.block_hash,
    time: row.block_time.toISOString(),
    amount: row.amount,
    orphaned: row.orphaned,
    detail: row.detail
  };
}

export async function recordTransfers(db: Knex.Transaction, chain: string, transfers: ChainTransfer[]): Promise<void> {
  for (let offset = 0; offset < transfers.length; offset += 250) {
    await db('observed_transfers').insert(transfers.slice(offset, offset + 250).map((transfer) => ({
      chain,
      invoice_id: transfer.invoiceId,
      tx_id: transfer.txId,
      output_index: transfer.outputIndex,
      block_height: transfer.blockHeight,
      block_hash: transfer.blockHash,
      block_time: transfer.time,
      amount: transfer.amount.toString(),
      detail: transfer.detail ?? {}
    }))).onConflict(['invoice_id', 'tx_id', 'output_index', 'block_hash']).merge({ orphaned: false });
  }
}

export function canonicalTransfers(db: Knex.Transaction, invoiceIds: string[]) {
  return db<TransferRow>('observed_transfers').whereIn('invoice_id', invoiceIds)
    .where({ orphaned: false }).orderBy(['block_height', 'tx_id', 'output_index']);
}
