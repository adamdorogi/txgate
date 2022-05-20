import { TransactionBody } from '@emurgo/cardano-serialization-lib-nodejs';
import { expect } from 'chai';
import { deriveAddress } from '../src/chains/cardano/derivation';
import { buildCardanoSweep, CardanoUtxo } from '../src/chains/cardano/sweeper';

const account = '42bd48638d8c689c9012b9c1fd97d15f9aa5f4803d3dcd12ecfb5ef789df2986f51f70f13716b72fd107bb7dbf945600a28378e5ee994fdd56e33a2980eee510';
const destination = deriveAddress(account, 90, 0);
const policy = '21'.repeat(28);

function utxo(index: number, assets: Record<string, string>): CardanoUtxo {
  return {
    txId: index.toString(16).padStart(64, '0'),
    outputIndex: 0,
    address: deriveAddress(account, index, 0),
    derivationIndex: index,
    lovelace: 5000000n,
    assets,
  };
}

describe('Cardano unsigned sweep', () => {
  it('preserves native assets and allocates the exact fee using witness size', () => {
    const inputs = [utxo(1, { [`${policy}.deadbeef`]: '11' }), utxo(2, { [`${policy}.deadbeef`]: '32' })];
    const result = buildCardanoSweep(inputs, destination, 0);
    expect(result.transactions).to.have.length(1);
    const transaction = result.transactions[0];
    const body = TransactionBody.from_bytes(Buffer.from(transaction.bodyHex, 'hex'));
    const output = body.outputs().get(0);
    const value = output.amount();
    const multi = value.multiasset()!;
    const names = multi.get(multi.keys().get(0))!;
    expect(names.get(names.keys().get(0))?.to_str()).to.equal('43');
    expect(output.address().to_bech32()).to.equal(destination);
    expect(value.coin().to_str()).to.equal((10000000n - BigInt(transaction.fee)).toString());
    expect(BigInt(transaction.fee)).to.equal(155381n + 44n * BigInt(transaction.signedSize));
    expect(transaction.textEnvelope.type).to.equal('TxBodyAlonzo');
    expect(transaction.textEnvelope.cborHex).to.equal(`86${transaction.bodyHex}9fff8080f5f6`);
    expect(transaction.witnesses.map(witness => witness.path)).to.deep.equal(["m/1852'/1815'/0'/0/1", "m/1852'/1815'/0'/0/2"]);
  });

  it('splits over-size batches while retaining each input once', () => {
    const inputs = Array.from({ length: 90 }, (_, index) => utxo(index, {
      [`${index.toString(16).padStart(56, '0')}.${'20'.repeat(32)}`]: '1',
    }));
    const result = buildCardanoSweep(inputs, destination, 0);
    expect(result.transactions.length).to.be.greaterThan(1);
    expect(result.transactions.flatMap(transaction => transaction.inputs)).to.deep.equal(inputs.map(input => `${input.txId}#0`));
    expect(result.transactions.every(transaction => transaction.signedSize <= 16384)).to.equal(true);
  });

  it('rejects an output below the minimum and a destination on another network', () => {
    const input = { ...utxo(1, {}), lovelace: 600000n };
    expect(() => buildCardanoSweep([input], destination, 0)).to.throw('minimum outputs');
    expect(() => buildCardanoSweep([input], destination, 1)).to.throw('wrong network');
  });
});
