import { BaseAddress, Bip32PublicKey, Ed25519KeyHash, EnterpriseAddress, StakeCredential } from '@emurgo/cardano-serialization-lib-nodejs';
import { bech32 } from 'bech32';

function accountKey(xpub: string): Uint8Array {
  if (/^[0-9a-f]{128}$/i.test(xpub)) return Buffer.from(xpub, 'hex');

  const { prefix, words } = bech32.decode(xpub, 128);
  const bytes = bech32.fromWords(words);
  if (!['acct_xpub', 'acct_xvk', 'xpub'].includes(prefix) || bytes.length !== 64) {
    throw new Error('Expected a 64-byte Cardano account public key');
  }
  return Uint8Array.from(bytes);
}

export function deriveAddress(
  xpub: string,
  index: number,
  networkId: number,
  stakeKeyHash?: string,
): string {
  if (!Number.isInteger(index) || index < 0 || index >= 2 ** 31) {
    throw new Error('Cardano derivation index must be unhardened');
  }
  if (networkId !== 0 && networkId !== 1) throw new Error('Invalid Cardano network ID');
  if (stakeKeyHash !== undefined && !/^[0-9a-f]{56}$/i.test(stakeKeyHash)) {
    throw new Error('Invalid Cardano stake key hash');
  }

  const account = Bip32PublicKey.from_bytes(accountKey(xpub));
  const chain = account.derive(0);
  const child = chain.derive(index);
  const publicKey = child.to_raw_key();
  const paymentHash = publicKey.hash();
  const payment = StakeCredential.from_keyhash(paymentHash);
  const stakeHash = stakeKeyHash === undefined ? undefined : Ed25519KeyHash.from_bytes(Buffer.from(stakeKeyHash, 'hex'));
  const stake = stakeHash && StakeCredential.from_keyhash(stakeHash);
  const shelley = stake ? BaseAddress.new(networkId, payment, stake) : EnterpriseAddress.new(networkId, payment);
  const address = shelley.to_address();
  try {
    return address.to_bech32();
  } finally {
    address.free();
    shelley.free();
    stake?.free();
    stakeHash?.free();
    payment.free();
    paymentHash.free();
    publicKey.free();
    child.free();
    chain.free();
    account.free();
  }
}
