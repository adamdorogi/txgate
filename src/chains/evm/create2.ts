import { Address, Hash, encodePacked, getCreate2Address, keccak256, stringToHex } from 'viem';

export function invoiceKey(invoiceId: string): Hash {
  return keccak256(stringToHex(invoiceId));
}

export function deriveEvmAddress(factory: Address, treasury: Address, invoiceId: string, initCodeHash: Hash): Address {
  const salt = keccak256(encodePacked(['address', 'bytes32'], [treasury, invoiceKey(invoiceId)]));
  return getCreate2Address({ from: factory, salt, bytecodeHash: initCodeHash });
}
