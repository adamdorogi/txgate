export const invoiceStatuses = [
  'NEW', 'DETECTED', 'CONFIRMING', 'SETTLED', 'UNDERPAID',
  'OVERPAID', 'EXPIRED', 'LATE_PAYMENT', 'REORGED'
] as const;

export type InvoiceStatus = typeof invoiceStatuses[number];

export interface Asset {
  chain: string;
  id: string;
  symbol: string;
  decimals: number;
}

export interface CreateInvoice {
  chain: string;
  assetId: string;
  amount: string;
  ttlSeconds?: number;
  sku?: string;
}

export interface Invoice {
  id: string;
  chain: string;
  assetId: string;
  assetSymbol: string;
  decimals: number;
  address: string;
  derivationIndex: number;
  amount: string;
  paid: string;
  remaining: string;
  excess: string;
  status: InvoiceStatus;
  confirmations: number;
  targetConfirmations: number;
  expiresAt: string;
  createdAt: string;
  sku: string | null;
}

export interface InvoiceFilter {
  chain?: string;
  assetId?: string;
  status?: string;
}

export interface TransferRecord {
  txId: string;
  outputIndex: number;
  blockHeight: number;
  blockHash: string;
  time: string;
  amount: string;
  orphaned: boolean;
  detail: Record<string, unknown>;
}

export interface InvoiceEvent {
  status: InvoiceStatus;
  confirmations: number;
  at: string;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  attempts: number;
  nextAttemptAt: string;
  deliveredAt: string | null;
  lastError: string | null;
  payload: Record<string, unknown>;
}

export interface InvoiceDetail {
  invoice: Invoice;
  transfers: TransferRecord[];
  events: InvoiceEvent[];
  webhooks: WebhookDelivery[];
}

export interface SweepInput {
  chain: string;
  invoiceIds: string[];
  destination: string;
  refund: boolean;
}

export interface ChainHealth {
  chain: string;
  tip: number | null;
  hash: string | null;
  lagSeconds: number | null;
  reorgs: { from: number; to: number; at: string }[];
}

export class TxgateError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}
