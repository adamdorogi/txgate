import type { Knex } from 'knex';
import type { ChainAdapter, SweepItem } from '../chains/types';
import { lockChain } from '../db/chain-history';
import { invoiceRecord, InvoiceRow } from '../db/invoice-record';
import { canonicalTransfers } from '../db/observations';
import { Invoice, InvoiceStatus, SweepInput, TxgateError } from './types';

const settled: InvoiceStatus[] = ['SETTLED', 'OVERPAID'];
const refundable: InvoiceStatus[] = ['LATE_PAYMENT', 'UNDERPAID'];

export async function listSweepCandidates(db: Knex, chain: string, refund: boolean): Promise<Invoice[]> {
  const query = db<InvoiceRow>('invoices').where({ chain })
    .whereIn('status', refund ? refundable : settled).orderBy('created_at', 'desc').limit(200);
  if (refund) query.where('expires_at', '<=', db.fn.now()).whereRaw('confirmations >= target_confirmations');
  return (await query).map(invoiceRecord);
}

export async function buildSweep(db: Knex, adapter: ChainAdapter, input: SweepInput): Promise<unknown> {
  const ids = [...new Set(input.invoiceIds)];
  if (!ids.length || ids.length > 200) throw new TxgateError(400, 'Select between 1 and 200 invoices');
  return db.transaction(async (trx) => {
    const cursor = await lockChain(trx, adapter.chain);
    const height = Number(cursor.height);
    const current = cursor.height === null ? null : await adapter.verifyChainTip(height);
    if (!current || current.hash !== cursor.hash) throw new TxgateError(409, 'Chain checkpoint is stale');
    const rows = await trx<InvoiceRow>('invoices').where({ chain: adapter.chain }).whereIn('id', ids)
      .whereIn('status', input.refund ? refundable : settled);
    if (rows.length !== ids.length) throw new TxgateError(409, 'Invoice is ineligible for this batch');
    if (input.refund && rows.some((row) => row.expires_at > new Date())) {
      throw new TxgateError(409, 'Refunds require expired invoices');
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    const transfers = await canonicalTransfers(trx, ids);
    const items: SweepItem[] = transfers.map((row) => {
      const invoice = byId.get(row.invoice_id)!;
      if (height - Number(row.block_height) + 1 < invoice.target_confirmations) {
        throw new TxgateError(409, 'Batch includes an unconfirmed transfer');
      }
      return {
        invoiceId: invoice.id,
        address: invoice.address,
        assetId: invoice.asset_id,
        derivationIndex: invoice.derivation_index,
        txId: row.tx_id,
        outputIndex: row.output_index,
        amount: BigInt(row.amount),
        blockHeight: Number(row.block_height),
        blockHash: row.block_hash,
        time: row.block_time,
        detail: row.detail
      };
    });
    if (!items.length) throw new TxgateError(409, 'No canonical transfers in the selected batch');
    try {
      return await adapter.buildUnsignedSweep({ items, destination: input.destination, refund: input.refund });
    } catch (error) {
      throw new TxgateError(422, error instanceof Error ? error.message : 'Unable to build batch');
    }
  });
}
