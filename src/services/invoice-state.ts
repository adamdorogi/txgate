import type { InvoiceStatus } from './types';

export interface Payment {
  amount: bigint;
  height: number;
  time: Date;
}

interface StateInput {
  amount: bigint;
  expiresAt: Date;
  target: number;
  tip: number;
  now: Date;
  prior: InvoiceStatus;
  reservationReleased?: boolean;
  payments: Payment[];
}

export function invoiceState(input: StateInput): {
  status: InvoiceStatus;
  paid: bigint;
  confirmations: number;
} {
  const { amount, expiresAt, payments, prior, tip, target, now } = input;
  let paid = 0n;
  let timely = 0n;
  let confirmed = 0n;
  let threshold: number | undefined;
  let first: number | undefined;
  for (const payment of payments) {
    paid += payment.amount;
    first ??= payment.height;
    if (payment.time < expiresAt) timely += payment.amount;
    if (tip - payment.height + 1 >= target) confirmed += payment.amount;
    if (paid >= amount) threshold ??= payment.height;
  }
  const height = threshold ?? first;
  const confirmations = height === undefined ? 0 : Math.max(0, tip - height + 1);
  let status: InvoiceStatus;
  if (paid === 0n) {
    status = prior === 'REORGED' ? 'REORGED' : now >= expiresAt ? 'EXPIRED' : 'NEW';
  } else if (input.reservationReleased || (timely < amount && payments.some((payment) => payment.time >= expiresAt))) {
    status = 'LATE_PAYMENT';
  } else if (paid < amount) {
    status = 'UNDERPAID';
  } else if (confirmations >= target) {
    status = confirmed > amount ? 'OVERPAID' : 'SETTLED';
  } else {
    status = confirmations <= 1 ? 'DETECTED' : 'CONFIRMING';
  }
  return { status, paid, confirmations };
}
