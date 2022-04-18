import type { Knex } from 'knex';
import { TxgateError } from '../services/types';

export async function reserveSlot(db: Knex.Transaction, sku: string): Promise<void> {
  const count = await db('sku_slots').where({ sku })
    .whereRaw('reserved_count < max_supply').increment('reserved_count', 1);
  if (count) return;
  const slot = await db('sku_slots').where({ sku }).first('sku');
  throw new TxgateError(slot ? 409 : 400, slot ? 'SKU sold out' : 'Unknown SKU');
}

export async function releaseSlot(db: Knex.Transaction, invoiceId: string, sku: string): Promise<void> {
  const count = await db('invoices').where({ id: invoiceId, reserved: true }).update({ reserved: false });
  if (count) await db('sku_slots').where({ sku }).decrement('reserved_count', 1);
}

export async function configureSlots(db: Knex, supply: Record<string, number>): Promise<void> {
  await db.transaction(async (trx) => {
    for (const [sku, maxSupply] of Object.entries(supply).sort()) {
      await trx('sku_slots').insert({ sku, max_supply: maxSupply })
        .onConflict('sku').merge(['max_supply']);
    }
  });
}
