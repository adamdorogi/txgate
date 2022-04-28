import { createHmac, timingSafeEqual } from 'crypto';

export function signWebhook(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const digest = createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');
  return 't=' + timestamp + ',v1=' + digest;
}

export function verifyWebhook(secret: string, body: string, signature: string, now = Math.floor(Date.now() / 1000)): boolean {
  const match = /^t=(\d{1,12}),v1=([a-f0-9]{64})$/.exec(signature);
  if (!match || Math.abs(now - Number(match[1])) > 300) return false;
  const expected = signWebhook(secret, body, Number(match[1])).split('v1=')[1];
  return timingSafeEqual(Buffer.from(match[2], 'hex'), Buffer.from(expected, 'hex'));
}
