import pino from 'pino';
import { CardanoAdapter } from './chains/cardano';
import { connect } from './db/connection';
import { background } from './services/background';
import { pollChain } from './services/chain-watcher';
import { createInvoice } from './services/invoices';
import { dispatchWebhook } from './services/webhook-dispatcher';

const log = pino({ name: 'txgate' });

function setting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(name + ' is required');
  return value;
}

async function main(): Promise<void> {
  const adapterOptions = {
    accountXpub: setting('CARDANO_ACCOUNT_XPUB'),
    networkId: Number(process.env.CARDANO_NETWORK_ID ?? 0),
    startBlock: Number(process.env.CARDANO_START_BLOCK ?? 1)
  };
  const source = connect(setting('DB_SYNC_DATABASE_URL'), true);
  const db = connect(setting('DATABASE_URL'));
  const adapter = new CardanoAdapter(source, adapterOptions);
  const stop = async () => {
    await Promise.all([db.destroy(), source.destroy()]);
  };
  const [command, amount] = process.argv.slice(2);
  if (command === 'invoice') {
    try {
      const asset = { chain: 'cardano', id: 'ADA', symbol: 'ADA', decimals: 6 };
      const invoice = await createInvoice(db, adapter, asset, {
        chain: 'cardano', assetId: 'ADA', amount
      }, Number(process.env.CARDANO_CONFIRMATIONS ?? 15));
      console.log(JSON.stringify(invoice));
    } finally {
      await stop();
    }
    return;
  }
  const url = process.env.WEBHOOK_URL;
  const secret = process.env.WEBHOOK_SECRET;
  const stops = [
    background(() => pollChain(db, adapter, Boolean(url && secret)), 2000,
      (err) => log.error({ err }, 'chain poll failed'))
  ];
  if (url && secret) {
    stops.push(background(() => dispatchWebhook(db, { url, secret }), 2000,
      (err) => log.error({ err }, 'webhook queue failed')));
  }
  const shutdown = async () => {
    await Promise.all(stops.map((close) => close()));
    await stop();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

main().catch((err) => {
  log.error({ err }, 'startup failed');
  process.exitCode = 1;
});
