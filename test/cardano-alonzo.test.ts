import { TransactionOutput } from '@emurgo/cardano-serialization-lib-nodejs';
import { expect } from 'chai';
import { alonzoMinLovelace } from '../src/chains/cardano/min-ada';

describe('Cardano Alonzo minimum output', () => {
  const outputPrefix = '82581d6054947bcf6b760319bcec250ec225fd1ce63baface47e34b44b73e4f9';

  it('uses the fixed ADA-only word count', () => {
    const output = TransactionOutput.from_bytes(Buffer.from(`${outputPrefix}1a002dc6c0`, 'hex'));
    expect(alonzoMinLovelace(output)).to.equal(999978n);
  });

  it('uses the compact representation for tokens with a name shared by two policies', () => {
    const assets = `a2581c${'21'.repeat(28)}a148deadbeefdeadbeef01581c${'22'.repeat(28)}a148deadbeefdeadbeef01`;
    const output = TransactionOutput.from_bytes(Buffer.from(`${outputPrefix}821a002dc6c0${assets}`, 'hex'));
    expect(alonzoMinLovelace(output)).to.equal(1517208n);
  });
});
