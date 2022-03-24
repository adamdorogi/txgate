import type { Invoice, InvoiceStatus } from '../services/types';

export interface InvoiceRow {
  id: string;
  chain: string;
  asset_id: string;
  asset_symbol: string;
  decimals: number;
  address: string;
  derivation_index: number;
  amount: string;
  paid: string;
  status: InvoiceStatus;
  confirmations: number;
  target_confirmations: number;
  expires_at: Date;
  created_at: Date;
  sku: string | null;
  reserved: boolean;
}

export function invoiceRecord(row: InvoiceRow): Invoice {
  const delta = BigInt(row.amount) - BigInt(row.paid);
  return {
    id: row.id,
    chain: row.chain,
    assetId: row.asset_id,
    assetSymbol: row.asset_symbol,
    decimals: row.decimals,
    address: row.address,
    derivationIndex: row.derivation_index,
    amount: row.amount,
    paid: row.paid,
    remaining: String(delta > 0n ? delta : 0n),
    excess: String(delta < 0n ? -delta : 0n),
    status: row.status,
    confirmations: row.confirmations,
    targetConfirmations: row.target_confirmations,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    sku: row.sku
  };
}
