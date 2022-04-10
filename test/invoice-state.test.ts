import { expect } from 'chai';
import { invoiceState, Payment } from '../src/services/invoice-state';

const expiresAt = new Date('2022-04-01T00:05:00Z');
const before = new Date('2022-04-01T00:00:00Z');
const after = new Date('2022-04-01T00:10:00Z');
const first = { amount: 60n, height: 10, time: before };
const remainder = { amount: 50n, height: 11, time: before };

function state(payments: Payment[], tip: number, prior: 'NEW' | 'REORGED' = 'NEW', now = before) {
  return invoiceState({ amount: 100n, expiresAt, target: 3, tip, prior, now, payments });
}

describe('invoice confirmation and expiry', () => {
  it('applies confirmation depth starting at the block that covered the invoice', () => {
    expect(state([first], 12).status).to.equal('UNDERPAID');
    expect(state([first, remainder], 11).status).to.equal('DETECTED');
    expect(state([first, remainder], 12).status).to.equal('CONFIRMING');
    expect(state([first, remainder], 13)).to.deep.equal({ status: 'OVERPAID', paid: 110n, confirmations: 3 });
  });

  it('keeps the state reorged after removing all orphaned payments', () => {
    expect(state([], 10, 'REORGED')).to.deep.equal({ status: 'REORGED', paid: 0n, confirmations: 0 });
    expect(state([{ ...first, amount: 100n }], 12, 'REORGED').status).to.equal('SETTLED');
  });
});
