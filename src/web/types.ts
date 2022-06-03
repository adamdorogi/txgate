import {
  Asset, ChainHealth, CreateInvoice, Invoice, InvoiceDetail, InvoiceFilter, SweepInput
} from "../services/types";

export interface WebServices {
  createInvoice(input: CreateInvoice): Promise<Invoice>;
  getInvoice(id: string): Promise<Invoice | null>;
  listInvoices(filter: InvoiceFilter): Promise<Invoice[]>;
  invoiceDetail(id: string): Promise<InvoiceDetail | null>;
  resendWebhook(id: string, deliveryId: string): Promise<boolean>;
  listSweepCandidates(chain: string, refund: boolean): Promise<Invoice[]>;
  buildSweep(input: SweepInput): Promise<unknown>;
  chainHealth(): Promise<ChainHealth[]>;
  listAssets(): Asset[];
  settings(): Record<string, string>;
}
