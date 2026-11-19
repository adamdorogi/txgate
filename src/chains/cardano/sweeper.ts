import {
  Address, AssetName, Assets, BigNum, Ed25519Signature, MultiAsset, PublicKey, RewardAddress,
  ScriptHash, Transaction, TransactionBody, TransactionHash, TransactionInput, TransactionInputs,
  TransactionOutput, TransactionOutputs, TransactionWitnessSet, Value, Vkey, Vkeywitness, Vkeywitnesses,
} from '@emurgo/cardano-serialization-lib-nodejs';
import { alonzoMinLovelace, babbageMinLovelace } from './min-ada';

export interface CardanoUtxo {
  txId: string;
  outputIndex: number;
  address: string;
  lovelace: bigint;
  assets: Record<string, string>;
  derivationIndex?: number;
}

export interface CardanoSweepOptions {
  era?: 'alonzo' | 'babbage' | 'conway';
  coinsPerUtxoByte?: bigint;
  coinsPerUtxoWord?: bigint;
  feePerByte?: bigint;
  feeConstant?: bigint;
  maxTxSize?: number;
  maxValueSize?: number;
  testnetMagic?: number;
}

interface UnsignedTransaction {
  bodyHex: string;
  textEnvelope: { type: string; description: string; cborHex: string };
  inputs: string[];
  witnesses: { address: string; path: string }[];
  fee: string;
  signedSize: number;
  signingCommand: string;
}

type Disposable = { free(): void };
type Track = <T extends Disposable>(value: T) => T;
type Asset = [string, bigint];

const maxQuantity = (1n << 64n) - 1n;
const eraNames = { alonzo: 'Alonzo', babbage: 'Babbage', conway: 'Conway' };

function withWasm<T>(build: (track: Track) => T): T {
  const pending: Disposable[] = [];
  try {
    return build(value => {
      pending.push(value);
      return value;
    });
  } finally {
    for (let index = pending.length - 1; index >= 0; index--) pending[index].free();
  }
}

function amount(value: bigint, track: Track): BigNum {
  return track(BigNum.from_str(value.toString()));
}

function makeValue(coin: bigint, entries: Asset[], track: Track): Value {
  const value = track(Value.new(amount(coin, track)));
  if (!entries.length) return value;

  const multi = track(MultiAsset.new());
  const policies = new Map<string, Assets>();
  for (const [id, quantity] of entries) {
    const [policy, name] = id.split('.');
    let assets = policies.get(policy);
    if (!assets) {
      assets = track(Assets.new());
      policies.set(policy, assets);
    }
    const previous = assets.insert(track(AssetName.new(Buffer.from(name, 'hex'))), amount(quantity, track));
    previous?.free();
  }
  for (const [policy, assets] of policies) {
    const previous = multi.insert(track(ScriptHash.from_bytes(Buffer.from(policy, 'hex'))), assets);
    previous?.free();
  }
  value.set_multiasset(multi);
  return value;
}

function splitAssets(assets: Asset[], maxSize: number): Asset[][] {
  const unique = new Set(assets.map(([id]) => id)).size === assets.length;
  const fits = unique && withWasm(track => makeValue(maxQuantity, assets, track).to_bytes().length <= maxSize);
  if (fits) return [assets];
  if (assets.length <= 1) throw new Error('Cardano asset does not fit the configured value size');
  const middle = Math.floor(assets.length / 2);
  return [...splitAssets(assets.slice(0, middle), maxSize), ...splitAssets(assets.slice(middle), maxSize)];
}

function aggregateAssets(utxos: CardanoUtxo[]): Asset[] {
  const totals = new Map<string, bigint>();
  for (const utxo of utxos) {
    for (const [id, raw] of Object.entries(utxo.assets)) {
      if (!/^[0-9a-f]{56}\.(?:[0-9a-f]{2}){0,32}$/.test(id)) throw new Error(`Invalid Cardano asset: ${id}`);
      const quantity = BigInt(raw);
      if (quantity < 0n || quantity > maxQuantity) throw new Error(`Invalid Cardano asset quantity: ${id}`);
      totals.set(id, (totals.get(id) ?? 0n) + quantity);
    }
  }
  const entries: Asset[] = [];
  for (const [id, total] of totals) {
    let remaining = total;
    while (remaining > maxQuantity) {
      entries.push([id, maxQuantity]);
      remaining -= maxQuantity;
    }
    if (remaining > 0n) entries.push([id, remaining]);
  }
  return entries;
}

function sizingWitnesses(count: number, track: Track): TransactionWitnessSet {
  const witnesses = track(TransactionWitnessSet.new());
  const keys = track(Vkeywitnesses.new());
  const signature = track(Ed25519Signature.from_bytes(Buffer.alloc(64)));
  for (let index = 0; index < count; index++) {
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32LE(index);
    const key = track(Vkey.new(track(PublicKey.from_bytes(bytes))));
    keys.add(track(Vkeywitness.new(key, signature)));
  }
  witnesses.set_vkeys(keys);
  return witnesses;
}

function buildTransaction(
  utxos: CardanoUtxo[],
  destination: Address,
  options: CardanoSweepOptions,
  track: Track,
): UnsignedTransaction {
  const era = options.era ?? 'babbage';
  const minimum = era === 'alonzo'
    ? (output: TransactionOutput) => alonzoMinLovelace(output, options.coinsPerUtxoWord)
    : (output: TransactionOutput) => babbageMinLovelace(output, options.coinsPerUtxoByte);
  const groups = splitAssets(aggregateAssets(utxos), options.maxValueSize ?? 5000);
  const available = utxos.reduce((sum, utxo) => sum + utxo.lovelace, 0n);
  const feePerByte = options.feePerByte ?? 44n;
  const feeConstant = options.feeConstant ?? 155381n;
  const inputs = track(TransactionInputs.new());
  for (const utxo of utxos) {
    const hash = track(TransactionHash.from_bytes(Buffer.from(utxo.txId, 'hex')));
    inputs.add(track(TransactionInput.new(hash, utxo.outputIndex)));
  }

  const output = (coin: bigint, assets: Asset[], add: Track) =>
    add(TransactionOutput.new(destination, makeValue(coin, assets, add)));
  const minima = groups.map(assets => withWasm(add => {
    let coin = 0n;
    let required = minimum(output(coin, assets, add));
    while (required > coin) {
      coin = required;
      required = minimum(output(coin, assets, add));
    }
    return coin;
  }));
  const totalMinimum = minima.reduce((sum, coin) => sum + coin, 0n);
  const addresses = new Map(utxos.map(utxo => [utxo.address, utxo.derivationIndex]));
  const placeholders = sizingWitnesses(addresses.size, track);
  let fee = feeConstant;

  while (true) {
    const remainder = available - fee - totalMinimum;
    if (remainder < 0n) throw new Error('Cardano inputs cannot cover the minimum outputs and network fee');
    const outputs = track(TransactionOutputs.new());
    for (const [index, assets] of groups.entries()) {
      const coin = minima[index] + (index === 0 ? remainder : 0n);
      const txOut = output(coin, assets, track);
      if (minimum(txOut) > coin) throw new Error('Cardano output is below its minimum ADA');
      outputs.add(txOut);
    }
    const body = track(TransactionBody.new(inputs, outputs, amount(fee, track)));
    // Conway CLI encodes vkey witnesses with the three-byte CBOR set tag.
    const witnessTagSize = era === 'conway' ? 3 : 0;
    const signedSize = track(Transaction.new(body, placeholders, undefined)).to_bytes().length + witnessTagSize;
    const nextFee = feeConstant + feePerByte * BigInt(signedSize);
    if (nextFee > fee) {
      fee = nextFee;
      continue;
    }

    const unsigned = track(Transaction.new(body, track(TransactionWitnessSet.new()), undefined));
    const witnesses = [...addresses].map(([address, index]) => ({ address, path: `m/1852'/1815'/0'/0/${index ?? 'INDEX'}` }));
    const keys = [...addresses.values()].map(index => `--signing-key-file payment-${index ?? 'INDEX'}.skey`);
    const network = destination.network_id() === 1 ? '--mainnet' : `--testnet-magic ${options.testnetMagic ?? 'NETWORK_MAGIC'}`;
    const cli = era === 'conway' ? 'cardano-cli conway' : 'cardano-cli';
    return {
      bodyHex: Buffer.from(body.to_bytes()).toString('hex'),
      textEnvelope: {
        type: `Unwitnessed Tx ${eraNames[era]}Era`,
        description: 'Ledger Cddl Format',
        cborHex: Buffer.from(unsigned.to_bytes()).toString('hex'),
      },
      inputs: utxos.map(utxo => `${utxo.txId}#${utxo.outputIndex}`),
      witnesses,
      fee: fee.toString(),
      signedSize,
      signingCommand: [`${cli} transaction sign --tx-body-file sweep.raw`, ...keys, network, '--out-file sweep.signed'].join(' '),
    };
  }
}

function buildBatches(utxos: CardanoUtxo[], destination: Address, options: CardanoSweepOptions): UnsignedTransaction[] {
  const transaction = withWasm(track => buildTransaction(utxos, destination, options, track));
  if (transaction.signedSize <= (options.maxTxSize ?? 16384)) return [transaction];
  if (utxos.length === 1) throw new Error('Cardano input cannot fit the configured transaction size');
  const middle = Math.floor(utxos.length / 2);
  return [
    ...buildBatches(utxos.slice(0, middle), destination, options),
    ...buildBatches(utxos.slice(middle), destination, options),
  ];
}

export function buildCardanoSweep(utxos: CardanoUtxo[], address: string, networkId: number, options: CardanoSweepOptions = {}) {
  if (!utxos.length) throw new Error('No Cardano outputs selected');
  const selected = new Set<string>();
  for (const utxo of utxos) {
    const key = `${utxo.txId}#${utxo.outputIndex}`;
    if (!/^[0-9a-f]{64}$/.test(utxo.txId) || !Number.isInteger(utxo.outputIndex) || utxo.outputIndex < 0 || utxo.outputIndex > 65535) {
      throw new Error(`Invalid Cardano output: ${key}`);
    }
    if (selected.has(key) || utxo.lovelace < 0n || utxo.lovelace > maxQuantity) throw new Error(`Invalid Cardano input: ${key}`);
    selected.add(key);
  }

  return withWasm(track => {
    let destination: Address;
    try {
      destination = track(Address.from_bech32(address));
    } catch {
      throw new Error('Invalid Cardano destination address');
    }
    const reward = RewardAddress.from_address(destination);
    if (reward) {
      reward.free();
      throw new Error('Cardano destination must be a payment address');
    }
    if (destination.network_id() !== networkId) throw new Error('Cardano destination is on the wrong network');
    return { chain: 'cardano', destination: address, transactions: buildBatches(utxos, destination, options) };
  });
}
