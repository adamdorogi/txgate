import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import type { CardanoChain } from '../chains/cardano/types';
import { lockChain } from '../db/chain-history';
import { invoiceRecord, InvoiceRow } from '../db/invoice-record';
import { transferRecord } from '../db/observations';
import { deliveryRecord } from '../db/outbox';
import { reserveSlot } from '../db/reservations';
import { Asset, CreateInvoice, Invoice, InvoiceDetail, InvoiceFilter, TxgateError } from './types';

export async function createInvoice(
  db: Knex,
  adapter: CardanoChain,
  asset: Asset,
  input: CreateInvoice,
  target: number
): Promise<Invoice> {
  const ttl = input.ttlSeconds ?? 900;
  if (!/^[1-9]\d{0,77}$/.test(input.amount) || BigInt(input.amount) >= (adapter.chain === 'cardano' ? 2n ** 64n : 2n ** 256n)) {
    throw new TxgateError(400, 'Amount must be a positive integer in minor units');
  }
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 604800) throw new TxgateError(400, 'Invalid invoice TTL');
  return db.transaction(async (trx) => {
    await lockChain(trx, adapter.chain);
    if (input.sku) await reserveSlot(trx, input.sku);
    const result = await trx.raw("SELECT nextval('invoice_derivation_index') AS idx");
    const index = Number(result.rows[0].idx);
    const now = new Date();
    const id = randomUUID();
    const [row] = await trx<InvoiceRow>('invoices').insert({
      id,
      chain: adapter.chain,
      asset_id: asset.id,
      asset_symbol: asset.symbol,
      decimals: asset.decimals,
      address: adapter.deriveDepositTarget(id, index),
      derivation_index: index,
      amount: input.amount,
      created_at: now,
      expires_at: new Date(now.getTime() + ttl * 1000),
      target_confirmations: target,
      sku: input.sku || null,
      reserved: Boolean(input.sku)
    }).returning('*');
    return invoiceRecord(row);
  });
}

export async function listInvoices(db: Knex, filter: InvoiceFilter): Promise<Invoice[]> {
  const query = db<InvoiceRow>('invoices').orderBy('created_at', 'desc').limit(200);
  if (filter.chain) query.where({ chain: filter.chain });
  if (filter.assetId) query.where({ asset_id: filter.assetId });
  if (filter.status) query.where('status', '=', filter.status);
  return (await query).map(invoiceRecord);
}

export async function getInvoice(db: Knex, id: string): Promise<Invoice | null> {
  const row = await db<InvoiceRow>('invoices').where({ id }).first();
  return row ? invoiceRecord(row) : null;
}

export async function invoiceDetail(db: Knex, id: string): Promise<InvoiceDetail | null> {
  const invoice = await getInvoice(db, id);
  if (!invoice) return null;
  const [transfers, events, deliveries] = await Promise.all([
    db('observed_transfers').where({ invoice_id: id }).orderBy(['block_height', 'tx_id', 'output_index']),
    db('invoice_events').where({ invoice_id: id }).orderBy('id', 'desc').limit(200),
    db('webhook_deliveries').where({ invoice_id: id }).orderBy('next_attempt_at', 'desc').limit(200)
  ]);
  return {
    invoice,
    transfers: transfers.map(transferRecord),
    events: events.map((row) => ({
      status: row.status, confirmations: row.confirmations, at: row.created_at.toISOString()
    })),
    webhooks: deliveries.map(deliveryRecord)
  };
}
