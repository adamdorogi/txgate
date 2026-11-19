import { expect } from 'chai';
import { buildCardanoSweep } from '../src/chains/cardano/sweeper';

describe('Cardano Conway envelope', () => {
  it('accounts for the tagged witness set and supplies the era-specific signing command', () => {
    const address = 'addr_test1vp2fg770ddmqxxduasjsas39l5wwvwa04nj8ud95fde7f7guscp6v';
    const utxos = [{ txId: '10'.repeat(32), outputIndex: 0, address, derivationIndex: 0, lovelace: 5000000n, assets: {} }];
    const babbage = buildCardanoSweep(utxos, address, 0).transactions[0];
    const conway = buildCardanoSweep(utxos, address, 0, { era: 'conway', testnetMagic: 1 }).transactions[0];
    expect(conway.textEnvelope.type).to.equal('Unwitnessed Tx ConwayEra');
    expect(conway.signedSize - babbage.signedSize).to.equal(3);
    expect(BigInt(conway.fee) - BigInt(babbage.fee)).to.equal(132n);
    expect(conway.signingCommand).to.contain('cardano-cli conway transaction sign');
    expect(conway.signingCommand).to.contain('--testnet-magic 1');
  });
});
