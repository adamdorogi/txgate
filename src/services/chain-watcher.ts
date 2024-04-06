import type { Knex } from 'knex';
import type { ChainAdapter, ChainBlock, ChainTransfer } from '../chains/types';
import { commonAncestor, lockChain, rewindChain, saveBlocks } from '../db/chain-history';
import { recordTransfers } from '../db/observations';
import { reconcileInvoices } from './reconcile-invoices';

const batchSize = 32;

function validateBatch(
  blocks: ChainBlock[],
  transfers: ChainTransfer[],
  start: number,
  end: number,
  previousHash: string | null
): void {
  const heights = new Map<number, string>();
  if (blocks.length !== end - start + 1) throw new Error('Incomplete block range');
  for (const [index, block] of blocks.entries()) {
    if (block.height !== start + index || (previousHash !== null && block.parentHash !== previousHash)) {
      throw new Error('Block range changed during poll');
    }
    heights.set(block.height, block.hash);
    previousHash = block.hash;
  }
  if (transfers.some((transfer) => heights.get(transfer.blockHeight) !== transfer.blockHash)) {
    throw new Error('Transfer must belong to a scanned block');
  }
}

export async function pollChain(db: Knex, adapter: ChainAdapter, webhooks = false): Promise<boolean> {
  return db.transaction(async (trx) => {
    const cursor = await lockChain(trx, adapter.chain);
    const tip = await adapter.getTip();
    const remoteHeight = tip?.height ?? -1;
    const floor = cursor.scan_start === null
      ? (adapter.tipFloor < 0 ? Math.max(0, remoteHeight - 63) : adapter.tipFloor)
      : Number(cursor.scan_start);
    if (cursor.scan_start === null && tip) {
      await trx('chain_state').where({ chain: adapter.chain }).update({ scan_start: floor });
    }
    let height = cursor.height === null ? floor - 1 : Number(cursor.height);
    let parentHash = cursor.hash;
    let orphaned: string[] = [];
    if (cursor.height !== null) {
      const block = height <= remoteHeight ? await adapter.verifyChainTip(height) : null;
      if (!block || block.hash !== parentHash) {
        const ancestor = await commonAncestor(trx, adapter, remoteHeight);
        orphaned = await rewindChain(trx, adapter.chain, height, floor, ancestor);
        height = ancestor ? Number(ancestor.block_no) : floor - 1;
        parentHash = ancestor?.block_hash ?? null;
        await reconcileInvoices(trx, adapter.chain, height, [], orphaned, webhooks);
        return remoteHeight > height;
      }
    }

    const end = Math.min(remoteHeight, height + batchSize);
    const changed: string[] = [];
    if (end > height) {
      const rows: { id: string; address: string; asset_id: string }[] = await trx('invoices')
        .where({ chain: adapter.chain }).select('id', 'address', 'asset_id');
      const targets = rows.map((row) => ({ invoiceId: row.id, address: row.address, assetId: row.asset_id }));
      const { blocks, transfers } = await adapter.pollBlocks(height + 1, end, targets);
      validateBatch(blocks, transfers, height + 1, end, parentHash);
      const last = await adapter.verifyChainTip(end);
      if (last?.hash !== blocks[blocks.length - 1].hash) throw new Error('Tip changed during poll');
      await saveBlocks(trx, adapter.chain, blocks);
      await recordTransfers(trx, adapter.chain, transfers);
      for (const transfer of transfers) changed.push(transfer.invoiceId);
      height = end;
    }
    await reconcileInvoices(trx, adapter.chain, height, changed, orphaned, webhooks);
    return remoteHeight > height;
  });
}
