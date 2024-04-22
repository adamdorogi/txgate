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
  'function deployAndSweepETH(address treasury, bytes32 invoiceId)',
  'function deployAndSweepERC20(address treasury, bytes32 invoiceId, address token)',
  'function batchSweep(address treasury, Sweep[] items)',
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

  if (request.refund) throw new Error('Refunds are unavailable');
    if (destination && destination !== treasury) throw new Error('Sweep destination must be the configured treasury');
    const unique = new Map(items.map(item => [`${item.invoiceId}:${item.token}`, item]));
    return encodeFunctionData({ abi: factoryAbi, functionName: 'batchSweep', args: [treasury, [...unique.values()]] });

}
