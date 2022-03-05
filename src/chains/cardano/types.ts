export interface ChainBlock {
  height: number;
  hash: string;
  parentHash: string | null;
  time: Date;
}

export interface WatchedTarget {
  invoiceId: string;
  address: string;
  assetId: string;
}

export interface ChainTransfer {
  invoiceId: string;
  txId: string;
  outputIndex: number;
  blockHeight: number;
  blockHash: string;
  time: Date;
  amount: bigint;
  detail?: Record<string, unknown>;
}

export interface SweepItem extends ChainTransfer {
  address: string;
  assetId: string;
  derivationIndex: number;
}

export interface SweepRequest {
  items: SweepItem[];
  destination: string;
  refund: boolean;
}

export interface CardanoChain {
  readonly chain: string;
  readonly tipFloor: number;
  deriveDepositTarget(invoiceId: string, index: number): string;
  getTip(): Promise<ChainBlock | null>;
  verifyChainTip(height: number): Promise<ChainBlock | null>;
  pollBlocks(
    from: number,
    to: number,
    targets: WatchedTarget[]
  ): Promise<{ blocks: ChainBlock[]; transfers: ChainTransfer[] }>;
  buildUnsignedSweep(request: SweepRequest): Promise<unknown>;
}
