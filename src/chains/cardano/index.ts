import type { Knex } from 'knex';
import type { CardanoChain, SweepRequest, WatchedTarget } from './types';
import { DbSync } from './db-sync';
import { deriveAddress } from './derivation';
import { buildCardanoSweep, CardanoSweepOptions } from './sweeper';

export interface CardanoOptions {
  accountXpub: string;
  networkId: number;
  stakeKeyHash?: string;
  startBlock: number;
  sweep?: CardanoSweepOptions;
}

export class CardanoAdapter implements CardanoChain {
  readonly chain = 'cardano';
  readonly tipFloor: number;
  private readonly source: DbSync;

  constructor(db: Knex, private readonly options: CardanoOptions) {
    if (!Number.isSafeInteger(options.startBlock) || options.startBlock < -1) throw new Error('Invalid Cardano starting block');
    this.tipFloor = options.startBlock;
    this.source = new DbSync(db);
    this.deriveDepositTarget('', 0);
  }

  deriveDepositTarget(_invoiceId: string, index: number): string {
    return deriveAddress(this.options.accountXpub, index, this.options.networkId, this.options.stakeKeyHash);
  }

  getTip() {
    return this.source.getTip();
  }

  verifyChainTip(height: number) {
    return this.source.getBlock(height);
  }

  pollBlocks(from: number, to: number, targets: WatchedTarget[]) {
    return this.source.poll(from, to, targets);
  }

  async buildUnsignedSweep(request: SweepRequest) {
    if (!request.items.length) throw new Error('No Cardano outputs selected');
    for (const item of request.items) {
      if (this.deriveDepositTarget(item.invoiceId, item.derivationIndex) !== item.address) {
        throw new Error('Cardano output is outside the configured account');
      }
    }

    const outputs = await this.source.spendable(request.items);
    return {
      ...buildCardanoSweep(outputs, request.destination, this.options.networkId, this.options.sweep),
      refund: request.refund,
    };
  }
}
