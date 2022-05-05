import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import type { Invoice, WebhookDelivery } from '../services/types';

export const maxAttempts = 9;
export const leaseMs = 30000;

export interface DeliveryRow {
  id: string;
  invoice_id: string;
  event: string;
  attempts: number;
  next_attempt_at: Date;
  delivered_at: Date | null;
  lease_token: string | null;
  leased_until: Date | null;
  last_error: string | null;
  payload: Record<string, unknown>;
}

export async function enqueue(db: Knex.Transaction, invoice: Invoice): Promise<void> {
  const id = randomUUID();
  const event = 'invoice.' + invoice.status.toLowerCase();
  if (invoice.status === 'REORGED') {
    await db('webhook_deliveries').where({ invoice_id: invoice.id }).whereNull('delivered_at')
      .whereIn('event', ['invoice.detected', 'invoice.confirming', 'invoice.settled', 'invoice.overpaid'])
      .update({ attempts: maxAttempts, last_error: 'Superseded by reorg' });
  }
  await db('webhook_deliveries').insert({
    id, invoice_id: invoice.id, event, payload: { id, event, invoice }
  });
}

export async function claim(db: Knex, now: Date): Promise<DeliveryRow | undefined> {
  return db.transaction(async (trx) => {
    const ready: DeliveryRow | undefined = await trx<DeliveryRow>('webhook_deliveries')
      .whereNull('delivered_at').where('attempts', '<', maxAttempts)
      .where('next_attempt_at', '<=', now)
      .where((query) => query.whereNull('leased_until').orWhere('leased_until', '<=', now))
      .orderByRaw("CASE WHEN event = 'invoice.reorged' THEN 0 ELSE 1 END")
      .orderBy('next_attempt_at').orderBy('id')
      .forUpdate().skipLocked().first();
    if (!ready) return;
    const update = { lease_token: randomUUID(), leased_until: new Date(now.getTime() + leaseMs) };
    await trx('webhook_deliveries').where({ id: ready.id }).update(update);
    return { ...ready, ...update };
  });
}

export function deliveryRecord(row: DeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    event: row.event,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at.toISOString(),
    deliveredAt: row.delivered_at?.toISOString() ?? null,
    lastError: row.last_error,
    payload: row.payload
  };
}
