import { TransactionOutput } from '@emurgo/cardano-serialization-lib-nodejs';
import { expect } from 'chai';
import { babbageMinLovelace } from '../src/chains/cardano/min-ada';

describe('Cardano multi-asset minimum output', () => {
  it('uses serialized output bytes for Babbage', () => {
    const cbor = '82581d6054947bcf6b760319bcec250ec225fd1ce63baface47e34b44b73e4f9821a002dc6c0a1581c21212121212121212121212121212121212121212121212121212121a144deadbeef1904d2';
    const output = TransactionOutput.from_bytes(Buffer.from(cbor, 'hex'));
    expect(babbageMinLovelace(output)).to.equal(1025780n);
  });
});
