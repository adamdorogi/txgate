import type { TransactionOutput } from '@emurgo/cardano-serialization-lib-nodejs';

export function alonzoMinLovelace(output: TransactionOutput, coinsPerUtxoWord = 34482n): bigint {
  const value = output.amount();
  const multi = value.multiasset();
  value.free();
  const dataHash = output.data_hash();
  const datumWords = dataHash ? 10 : 0;
  dataHash?.free();

  if (!multi) return BigInt(29 + datumWords) * coinsPerUtxoWord;

  const policies = multi.keys();
  try {
    let assets = 0;
    const assetNames = new Map<string, number>();
    for (let i = 0; i < policies.len(); i++) {
      const policy = policies.get(i);
      const bundle = multi.get(policy);
      policy.free();
      if (!bundle) continue;

      const names = bundle.keys();
      assets += names.len();
      for (let j = 0; j < names.len(); j++) {
        const name = names.get(j);
        const bytes = Buffer.from(name.name());
        assetNames.set(bytes.toString('hex'), bytes.length);
        name.free();
      }
      names.free();
      bundle.free();
    }

    const nameBytes = [...assetNames.values()].reduce((sum, length) => sum + length, 0);
    const bundleWords = assets === 0 ? 2 : 6 + Math.ceil((assets * 12 + policies.len() * 28 + nameBytes) / 8);
    return BigInt(27 + bundleWords + datumWords) * coinsPerUtxoWord;
  } finally {
    policies.free();
    multi.free();
  }
}
