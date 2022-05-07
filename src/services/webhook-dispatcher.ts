import axios from 'axios';
import type { Knex } from 'knex';
import { claim, maxAttempts } from '../db/outbox';
import { signWebhook } from './webhook-signature';

export interface WebhookConfig {
  url: string;
  secret: string;
}

export async function dispatchWebhook(db: Knex, config: WebhookConfig): Promise<boolean> {
  const row = await claim(db, new Date());
  if (!row) return false;
  const body = JSON.stringify(row.payload);
  let error: string | null = null;
  try {
    await axios.post(config.url, body, {
      headers: {
        'Content-Type': 'application/json',
        'X-Txgate-Signature': signWebhook(config.secret, body),
        'X-Txgate-Delivery': row.id
      },
      timeout: 8000,
      maxRedirects: 0,
      maxContentLength: 65536,
      proxy: false
    });
  } catch (err) {
    error = axios.isAxiosError(err) && err.response
      ? 'HTTP ' + err.response.status
      : 'Webhook transport failed';
  }
  const now = new Date();
  await db('webhook_deliveries').where({ id: row.id, lease_token: row.lease_token })
    .where('attempts', '<', maxAttempts).update({
      attempts: row.attempts + 1,
      delivered_at: error ? null : now,
      next_attempt_at: new Date(now.getTime() + 10000 * 2 ** row.attempts),
      leased_until: null,
      lease_token: null,
      last_error: error
    });
  return true;
}
