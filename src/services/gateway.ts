import type { Knex } from 'knex';
import type { CardanoChain } from '../chains/cardano/types';
import type { ChainCursor } from '../db/chain-history';
import type { WebServices } from '../web/types';
import { createInvoice, getInvoice, invoiceDetail, listInvoices } from './invoices';
import { buildSweep, listSweepCandidates } from './sweeps';
import { Asset, ChainHealth, TxgateError } from './types';

export interface Network {
  adapter: CardanoChain;
  assets: Asset[];
  confirmations: number;
}

export function gateway(
  db: Knex, networks: Network[], publicSettings: Record<string, string>, webhooks: boolean
): WebServices {
  const byChain = new Map(networks.map((network) => [network.adapter.chain, network]));
  const network = (chain: string): Network => {
    const item = byChain.get(chain);
    if (!item) throw new TxgateError(400, 'Unknown chain');
    return item;
  };
  return {
    async createInvoice(input) {
      const { adapter, assets, confirmations } = network(input.chain);
      const asset = assets.find((candidate) => candidate.id.toLowerCase() === input.assetId.toLowerCase());
      if (!asset) throw new TxgateError(400, 'Unknown asset');
      return createInvoice(db, adapter, asset, input, confirmations);
    },
    getInvoice: (id) => getInvoice(db, id),
    listInvoices: (filter) => listInvoices(db, filter),
    invoiceDetail: (id) => invoiceDetail(db, id),
    async resendWebhook(id, deliveryId) {
      if (!webhooks) return false;
      const count = await db('webhook_deliveries').where({ invoice_id: id, id: deliveryId })
        .where((query) => query.whereNull('leased_until').orWhere('leased_until', '<=', db.fn.now()))
        .where((query) => query.whereNull('last_error').orWhere('last_error', '!=', 'Superseded by reorg'))
        .update({
          attempts: 0, delivered_at: null, last_error: null,
          lease_token: null, leased_until: null, next_attempt_at: db.fn.now()
        });
      return count > 0;
    },
    listSweepCandidates: (chain, refund) => listSweepCandidates(db, network(chain).adapter.chain, refund),
    buildSweep: (input) => buildSweep(db, network(input.chain).adapter, input),
    async chainHealth(): Promise<ChainHealth[]> {
      const now = Date.now();
      return Promise.all(networks.map(async ({ adapter }) => {
        const chain = adapter.chain;
        const [cursor, reorgs] = await Promise.all([
          db<ChainCursor>('chain_state').where({ chain }).first(),
          db('chain_reorgs').where({ chain }).orderBy('id', 'desc').limit(15)
        ]);
        return {
          chain, tip: cursor?.height == null ? null : Number(cursor.height), hash: cursor?.hash ?? null,
          lagSeconds: cursor?.block_time ? Math.max(0, Math.floor((now - cursor.block_time.getTime()) / 1000)) : null,
          reorgs: reorgs.map((row) => ({
            from: Number(row.from_block), to: Number(row.to_block), at: row.created_at.toISOString()
          }))
        };
      }));
    },
    listAssets: () => networks.flatMap((item) => item.assets),
    settings: () => ({ ...publicSettings })
  };
}
