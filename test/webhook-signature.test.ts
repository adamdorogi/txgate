import { createHmac } from 'crypto';
import { expect } from 'chai';
import { signWebhook, verifyWebhook } from '../src/services/webhook-signature';

describe('webhook signatures', () => {
  it('authenticates the original body and timestamp', () => {
    const body = '{"event":"invoice.settled"}';
    const stamp = 1650000123;
    const digest = createHmac('sha256', 'merchant-secret').update(stamp + '.' + body).digest('hex');
    const signature = 't=' + stamp + ',v1=' + digest;
    expect(signWebhook('merchant-secret', body, stamp)).to.equal(signature);
    expect(verifyWebhook('merchant-secret', body, signature, stamp + 5)).to.equal(true);
    expect(verifyWebhook('merchant-secret', body + '\\n', signature, stamp)).to.equal(false);
    expect(verifyWebhook('merchant-secret', body, signature, stamp + 301)).to.equal(false);
    expect(verifyWebhook('other-secret', body, signature, stamp)).to.equal(false);
    expect(verifyWebhook('merchant-secret', body, 't=1,v1=00', stamp)).to.equal(false);
  });
});
