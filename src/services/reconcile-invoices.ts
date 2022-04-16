import type { Knex } from 'knex';
import { invoiceRecord, InvoiceRow } from '../db/invoice-record';
import { canonicalTransfers, TransferRow } from '../db/observations';
import { enqueue } from '../db/outbox';
import { releaseSlot } from '../db/reservations';
import { invoiceState, Payment } from './invoice-state';

export async function reconcileInvoices(
  db: Knex.Transaction,
  chain: string,
  tip: number,
  changed: string[],
  orphaned: string[],
  webhooks: boolean
): Promise<void> {
  const now = new Date();
  const affected = new Set(orphaned);
  const rows = await db<InvoiceRow>('invoices').where({ chain })
    .where((query) => query.whereIn('id', [...new Set([...changed, ...orphaned])])
      .orWhereIn('status', ['DETECTED', 'CONFIRMING', 'UNDERPAID', 'LATE_PAYMENT'])
      .orWhereIn('id', db('observed_transfers').where({ chain, orphaned: false })
        .where('block_height', '>', tip - 64).select('invoice_id'))
      .orWhere((expirable) => expirable.where('expires_at', '<=', now)
        .where((pending) => pending.where({ status: 'NEW' }).orWhere({ reserved: true, paid: '0' }))))
    .orderBy(['sku', 'id']);
  if (!rows.length) return;
  const transfers = await canonicalTransfers(db, rows.map((row) => row.id));
  const byInvoice = new Map<string, Payment[]>();
  for (const row of transfers as TransferRow[]) {
    const list = byInvoice.get(row.invoice_id) ?? [];
    list.push({ amount: BigInt(row.amount), height: Number(row.block_height), time: row.block_time });
    byInvoice.set(row.invoice_id, list);
  }
  const safeTimes: { block_no: string; block_time: Date }[] = await db('chain_tips')
    .where({ chain }).select('block_no', 'block_time');
  const timeAt = new Map(safeTimes.map((row) => [Number(row.block_no), row.block_time]));

  for (const row of rows) {
    const reorged = affected.has(row.id);
    const next = invoiceState({
      amount: BigInt(row.amount), expiresAt: row.expires_at, target: row.target_confirmations,
      tip, now, prior: reorged ? 'REORGED' : row.status, payments: byInvoice.get(row.id) ?? [],
      reservationReleased: Boolean(row.sku && !row.reserved)
    });
    const confirmations = Math.min(next.confirmations, row.target_confirmations);
    const update = { status: next.status, paid: next.paid.toString(), confirmations };
    if (row.sku && row.reserved && next.paid === 0n && now >= row.expires_at) {
      const confirmedTime = timeAt.get(tip - row.target_confirmations + 1);
      if (confirmedTime && confirmedTime >= row.expires_at) {
        await releaseSlot(db, row.id, row.sku);
      }
    }

    if (reorged) {
      await db('invoice_events').insert({ invoice_id: row.id, status: 'REORGED', confirmations });
      if (webhooks) await enqueue(db, invoiceRecord({ ...row, ...update, status: 'REORGED' }));
    }
    if (row.status === update.status && row.paid === update.paid && row.confirmations === confirmations) continue;
    await db('invoices').where({ id: row.id }).update(update);
    if (update.status === 'REORGED' && reorged) continue;
    await db('invoice_events').insert({ invoice_id: row.id, status: update.status, confirmations });
    if (webhooks && (row.status !== update.status || reorged)) {
      await enqueue(db, invoiceRecord({ ...row, ...update }));
    }
  }
}
