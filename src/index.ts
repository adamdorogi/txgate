import pino from 'pino';
import { CardanoAdapter } from './chains/cardano';
import { readConfig } from './config';
import { connect } from './db/connection';
import { configureSlots } from './db/reservations';
import { background } from './services/background';
import { pollChain } from './services/chain-watcher';
import { gateway, Network } from './services/gateway';
import { dispatchWebhook } from './services/webhook-dispatcher';
import { createApp } from './web';

const log = pino({ name: 'txgate' });

async function main(): Promise<void> {
  const config = readConfig();
  const db = connect(config.databaseUrl);
  const source = connect(config.dbSyncUrl, true);
  const networks: Network[] = [];
  const settings: Record<string, string> = { 'Webhooks': config.webhook ? 'enabled' : 'disabled' };
  const stops: (() => Promise<void>)[] = [];
  try {
    await configureSlots(db, config.supply);
    const adapter = new CardanoAdapter(source, config.cardano);
    networks.push({ adapter, assets: config.cardanoAssets, confirmations: config.cardanoConfirmations });
    settings['Cardano account xpub'] = config.cardano.accountXpub;
    settings['Cardano network'] = config.cardano.networkId === 1 ? 'mainnet' : 'testnet';
    settings['Merchant API key'] = 'configured (ending ' + config.apiKey.slice(-4) + ')';
    const services = gateway(db, networks, settings, Boolean(config.webhook));
    const app = createApp({ ...config, services });
    const server = app.listen(config.port, config.host);
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve).once('error', reject);
    });
    log.info({ port: config.port, chains: networks.map((network) => network.adapter.chain) }, 'listening');
    for (const { adapter } of networks) {
      stops.push(background(() => pollChain(db, adapter, Boolean(config.webhook)), config.intervalMs,
        (err) => log.error({ err, chain: adapter.chain }, 'chain poll failed')));
    }
    const webhook = config.webhook;
    if (webhook) {
      stops.push(background(() => dispatchWebhook(db, webhook), config.intervalMs,
        (err) => log.error({ err }, 'webhook queue failed')));
    }
    const shutdown = async () => {
      await Promise.all([
        new Promise<void>((resolve) => server.close(() => resolve())),
        ...stops.map((stop) => stop())
      ]);
      await Promise.all([db.destroy(), source.destroy(), app.locals.closeSessionStore()]);
    };
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => void shutdown().catch((err) => {
        log.error({ err }, 'shutdown failed');
        process.exitCode = 1;
      }));
    }
  } catch (error) {
    await Promise.all([db.destroy(), source.destroy()]);
    throw error;
  }
}

main().catch((err) => {
  log.error({ err }, 'startup failed');
  process.exitCode = 1;
});
