import {
  Address, BlockNotFoundError, Hash, createPublicClient, getAddress, http, parseAbiItem, zeroAddress,
} from 'viem';
import { ChainAdapter, ChainBlock, ChainTransfer, SweepRequest, WatchedTarget } from '../types';
import { deriveEvmAddress } from './create2';
import { encodeSweep, factoryAbi } from './sweeper';

const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const blockBatchSize = 8;
const addressBatchSize = 100;

export interface EvmAdapterOptions {
  chain: string;
  chainId: number;
  rpcUrl: string;
  factoryAddress: string;
  treasury: string;
  initCodeHash: string;
  tokenAddresses: string[];
  nativeAssetId?: string;
  logChunkSize?: number;
  tipFloor?: number;
}

function toChainBlock(block: { number: bigint | null; hash: Hash | null; parentHash: Hash; timestamp: bigint }): ChainBlock {
  if (block.number === null || block.hash === null) throw new Error('Expected a mined EVM block');
  const height = Number(block.number);
  if (!Number.isSafeInteger(height)) throw new Error('EVM block height exceeds the supported range');
  return { height, hash: block.hash, parentHash: height === 0 ? null : block.parentHash, time: new Date(Number(block.timestamp) * 1000) };
}

export class EvmAdapter implements ChainAdapter {
  readonly chain: string;
  readonly tipFloor: number;
  private readonly client;
  private readonly chainId: number;
  private readonly factory: Address;
  private readonly treasury: Address;
  private readonly initCodeHash: Hash;
  private readonly tokens: Address[];
  private readonly nativeAssetId: string;
  private readonly logChunkSize: number;
  private chainVerified = false;

  constructor(options: EvmAdapterOptions) {
    this.chain = options.chain;
    this.tipFloor = options.tipFloor ?? -1;
    this.chainId = options.chainId;
    this.factory = getAddress(options.factoryAddress);
    this.treasury = getAddress(options.treasury);
    if (this.factory === zeroAddress || this.treasury === zeroAddress) throw new Error('Factory and treasury are required');
    if (!/^0x[0-9a-f]{64}$/i.test(options.initCodeHash)) throw new Error('Expected a 32-byte EVM init code hash');
    this.initCodeHash = options.initCodeHash.toLowerCase() as Hash;
    this.tokens = [...new Set(options.tokenAddresses.map(token => getAddress(token)))];
    this.nativeAssetId = options.nativeAssetId ?? 'ETH';
    if (this.tokens.includes(zeroAddress)) throw new Error('ERC-20 address cannot be the zero address');
    this.logChunkSize = options.logChunkSize ?? 1000;
    if (!Number.isSafeInteger(this.logChunkSize) || this.logChunkSize < 1) throw new Error('Invalid EVM log chunk size');
    if (!Number.isSafeInteger(this.chainId) || this.chainId < 1) throw new Error('Invalid EVM chain ID');
    if (!Number.isSafeInteger(this.tipFloor) || this.tipFloor < -1) throw new Error('Invalid EVM starting block');
    this.client = createPublicClient({ transport: http(options.rpcUrl), cacheTime: 0 });
  }

  deriveDepositTarget(invoiceId: string, _index: number): Address {
    return deriveEvmAddress(this.factory, this.treasury, invoiceId, this.initCodeHash);
  }

  private async verifyChainId(): Promise<void> {
    if (this.chainVerified) return;
    const networkId = await this.client.getChainId();
    if (networkId !== this.chainId) throw new Error(`Expected EVM chain ${this.chainId}, RPC returned ${networkId}`);
    this.chainVerified = true;
  }

  async verifyDeployment(): Promise<void> {
    await this.verifyChainId();
    const codeHash = await this.client.readContract({ address: this.factory, abi: factoryAbi, functionName: 'initCodeHash' });
    if (codeHash.toLowerCase() !== this.initCodeHash) throw new Error('EVM factory init code hash does not match configuration');
  }

  async getTip(): Promise<ChainBlock> {
    await this.verifyChainId();
    return toChainBlock(await this.client.getBlock({ blockTag: 'latest' }));
  }

  async verifyChainTip(height: number): Promise<ChainBlock | null> {
    await this.verifyChainId();
    try {
      return toChainBlock(await this.client.getBlock({ blockNumber: BigInt(height) }));
    } catch (error) {
      if (error instanceof BlockNotFoundError) return null;
      throw error;
    }
  }

  async pollBlocks(from: number, to: number, targets: WatchedTarget[]): Promise<{ blocks: ChainBlock[]; transfers: ChainTransfer[] }> {
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || from > to) {
      throw new Error('Invalid EVM block range');
    }
    await this.verifyChainId();

    const nativeTargets = new Map<string, WatchedTarget>();
    const tokenTargets = new Map<string, WatchedTarget>();
    const tokenRecipients = new Set<Address>();
    const activeTokens = new Set<Address>();
    for (const target of targets) {
      const address = getAddress(target.address);
      if (target.assetId === this.nativeAssetId) {
        nativeTargets.set(address, target);
      } else {
        const token = getAddress(target.assetId);
        if (!this.tokens.includes(token)) continue;
        tokenTargets.set(`${address}:${token}`, target);
        tokenRecipients.add(address);
        activeTokens.add(token);
      }
    }

    const blocks: ChainBlock[] = [];
    const transfers: ChainTransfer[] = [];
    for (let start = from; start <= to; start += blockBatchSize) {
      const end = Math.min(start + blockBatchSize - 1, to);
      const heights = Array.from({ length: end - start + 1 }, (_, index) => start + index);
      const rawBlocks = await Promise.all(heights.map(height => this.client.getBlock({
        blockNumber: BigInt(height), includeTransactions: nativeTargets.size > 0,
      })));
      for (const rawBlock of rawBlocks) {
        const block = toChainBlock(rawBlock);
        const predecessor = blocks[blocks.length - 1];
        if (predecessor && block.parentHash !== predecessor.hash) throw new Error('EVM parent changed during block scan');
        blocks.push(block);

        for (const transaction of rawBlock.transactions) {
          if (typeof transaction === 'string' || !transaction.to || transaction.value === 0n) continue;
          const target = nativeTargets.get(getAddress(transaction.to));
          if (!target) continue;
          const receipt = await this.client.getTransactionReceipt({ hash: transaction.hash });
          if (receipt.blockHash !== block.hash) throw new Error('EVM receipt changed during block scan');
          if (receipt.status !== 'success') continue;
          transfers.push({
            invoiceId: target.invoiceId, txId: transaction.hash, outputIndex: -1, blockHeight: block.height,
            blockHash: block.hash, time: block.time, amount: transaction.value, detail: { sender: getAddress(transaction.from) },
          });
        }
      }
    }

    const recipients = [...tokenRecipients];
    const addresses = [...activeTokens];
    for (let start = from; start <= to; start += this.logChunkSize) {
      const end = Math.min(start + this.logChunkSize - 1, to);
      for (let offset = 0; offset < recipients.length; offset += addressBatchSize) {
        const logs = await this.client.getLogs({
          address: addresses, event: transferEvent, args: { to: recipients.slice(offset, offset + addressBatchSize) },
          fromBlock: BigInt(start), toBlock: BigInt(end), strict: true,
        });
        for (const log of logs) {
          if (log.removed || log.blockNumber === null || log.transactionHash === null || log.logIndex === null) {
            throw new Error('EVM log changed during block scan');
          }
          const block = blocks[Number(log.blockNumber) - from];
          if (!block || block.hash !== log.blockHash) throw new Error('EVM log belongs to a different branch');
          const target = tokenTargets.get(`${getAddress(log.args.to)}:${getAddress(log.address)}`);
          if (!target || log.args.value === 0n) continue;
          transfers.push({
            invoiceId: target.invoiceId, txId: log.transactionHash, outputIndex: log.logIndex, blockHeight: block.height,
            blockHash: block.hash, time: block.time, amount: log.args.value, detail: { sender: getAddress(log.args.from) },
          });
        }
      }
    }

    const end = await this.verifyChainTip(to);
    if (!end || end.hash !== blocks[blocks.length - 1].hash) throw new Error('EVM tip changed during block scan');
    return { blocks, transfers };
  }

  async buildUnsignedSweep(request: SweepRequest) {
    await this.verifyDeployment();
    const data = encodeSweep(this.factory, this.treasury, this.initCodeHash, request, this.nativeAssetId);
    const gas = await this.client.estimateGas({ account: this.treasury, to: this.factory, data });
    return { to: this.factory, from: this.treasury, data, value: '0', chainId: this.chainId, gas: gas.toString() };
  }
}
