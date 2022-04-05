import type { Knex } from 'knex';
import type { CardanoChain, ChainBlock } from '../chains/cardano/types';

export interface ChainCursor {
  chain: string;
  height: string | null;
  hash: string | null;
  block_time: Date | null;
  scan_start: string | null;
}

interface BlockRow {
  block_no: string;
  block_hash: string;
  block_time: Date;
}

export async function lockChain(db: Knex.Transaction, chain: string): Promise<ChainCursor> {
  await db('chain_state').insert({ chain }).onConflict('chain').ignore();
  return db('chain_state').where({ chain }).forUpdate().first();
}

export async function commonAncestor(db: Knex.Transaction, adapter: CardanoChain, tip: number): Promise<BlockRow | undefined> {
  const recent: BlockRow[] = await db('chain_tips').where({ chain: adapter.chain })
    .where('block_no', '<=', tip).orderBy('block_no', 'desc').limit(64);
  for (const row of recent) {
    const block = await adapter.verifyChainTip(Number(row.block_no));
    if (block?.hash === row.block_hash) return row;
  }
}

export async function saveBlocks(db: Knex.Transaction, chain: string, blocks: ChainBlock[]): Promise<void> {
  if (!blocks.length) return;
  const last = blocks[blocks.length - 1];
  await db('chain_tips').insert(blocks.map((block) => ({
    chain,
    block_no: block.height,
    block_hash: block.hash,
    prev_hash: block.parentHash,
    block_time: block.time
  })));
  await db('chain_tips').where({ chain }).where('block_no', '<=', last.height - 64).delete();
  await db('chain_state').where({ chain })
    .update({ height: last.height, hash: last.hash, block_time: last.time });
}

export async function rewindChain(
  db: Knex.Transaction,
  chain: string,
  from: number,
  floor: number,
  ancestor?: BlockRow
): Promise<string[]> {
  const end = ancestor ? Number(ancestor.block_no) : floor - 1;
  const orphaned: { invoice_id: string }[] = await db('observed_transfers').where({ chain, orphaned: false })
    .where('block_height', '>', end).update({ orphaned: true }).returning('invoice_id');
  await db('chain_tips').where({ chain }).where('block_no', '>', end).delete();
  await db('chain_state').where({ chain }).update({
    height: ancestor?.block_no ?? null,
    hash: ancestor?.block_hash ?? null,
    block_time: ancestor?.block_time ?? null
  });
  await db('chain_reorgs').insert({ chain, from_block: from, to_block: end });
  return Array.from(new Set(orphaned.map((row) => row.invoice_id)));
}
