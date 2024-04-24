import { Address, Hash, getAddress, encodeFunctionData, parseAbi, zeroAddress } from 'viem';
import { SweepRequest } from '../types';
import { deriveEvmAddress, invoiceKey } from './create2';

export const factoryAbi = parseAbi([
  'error Unauthorized()',
  'error InvalidTransfer()',
  'error TransferFailed()',
  'function initCodeHash() pure returns (bytes32)',
  'function depositAddress(address treasury, bytes32 invoiceId) view returns (address)',
  'struct Sweep { bytes32 invoiceId; address token; }',
  'struct Refund { bytes32 invoiceId; bytes32 transferId; address token; address recipient; uint256 amount; }',
  'function deployAndSweepETH(address treasury, bytes32 invoiceId)',
  'function deployAndSweepERC20(address treasury, bytes32 invoiceId, address token)',
  'function batchSweep(address treasury, Sweep[] items)',
  'function batchRefund(address treasury, Refund[] items)',
]);

export function encodeSweep(factory: Address, treasury: Address, initCodeHash: Hash, request: SweepRequest, nativeAssetId = 'ETH') {
  if (request.items.length === 0) throw new Error('Select at least one transfer');
  const destination = request.destination ? getAddress(request.destination) : undefined;
  const items = request.items.map(item => {
    if (getAddress(item.address) !== deriveEvmAddress(factory, treasury, item.invoiceId, initCodeHash)) {
      throw new Error('Deposit address does not match the configured factory and treasury');
    }
    const token = item.assetId === nativeAssetId ? zeroAddress : getAddress(item.assetId);
    return { invoiceId: invoiceKey(item.invoiceId), token };
  });

  if (!request.refund) {
    if (destination && destination !== treasury) throw new Error('Sweep destination must be the configured treasury');
    const unique = new Map(items.map(item => [`${item.invoiceId}:${item.token}`, item]));
    return encodeFunctionData({ abi: factoryAbi, functionName: 'batchSweep', args: [treasury, [...unique.values()]] });
  }

  const seen = new Set<string>();
  const refunds = items.map((item, index) => {
    const transfer = request.items[index];
    const transferId = invoiceKey(`${transfer.txId.toLowerCase()}:${transfer.outputIndex}`);
    if (seen.has(transferId)) throw new Error('Duplicate transfer in refund request');
    seen.add(transferId);
    const sender = transfer.detail?.sender;
    if (typeof sender !== 'string') throw new Error('Original sender is unavailable for this transfer');
    const recipient = getAddress(sender);
    if (recipient === zeroAddress || (destination && destination !== recipient)) {
      throw new Error('Refund destination must match the original sender');
    }
    if (transfer.amount <= 0n) throw new Error('Refund amount must be positive');
    return { ...item, transferId, recipient, amount: transfer.amount };
  });
  return encodeFunctionData({ abi: factoryAbi, functionName: 'batchRefund', args: [treasury, refunds] });
}
