import { bech32 } from 'bech32';
import { expect } from 'chai';
import { deriveAddress } from '../src/chains/cardano/derivation';

const account = '42bd48638d8c689c9012b9c1fd97d15f9aa5f4803d3dcd12ecfb5ef789df2986f51f70f13716b72fd107bb7dbf945600a28378e5ee994fdd56e33a2980eee510';
const stake = 'f6d2f2ef387333e15aea9333e9d908e57a2b513ec6d762884f70ae2a';

describe('Cardano account addresses', () => {
  it('matches the cardano-address CLI enterprise vector on testnet', () => {
    const xpub = bech32.encode('acct_xpub', bech32.toWords(Buffer.from(account, 'hex')), 128);
    expect(deriveAddress(xpub, 0, 0)).to.equal('addr_test1vp2fg770ddmqxxduasjsas39l5wwvwa04nj8ud95fde7f7guscp6v');
  });

  it('encodes the enterprise credential on mainnet from a hex account key', () => {
    expect(deriveAddress(account, 0, 1)).to.equal('addr1v92fg770ddmqxxduasjsas39l5wwvwa04nj8ud95fde7f7g8cva4f');
  });
});
