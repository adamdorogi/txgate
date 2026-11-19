import Joi from 'joi';
import { configuredAssets, jsonSetting } from './asset-config';
import type { CardanoOptions } from './chains/cardano';
import { evmSettings } from './evm-config';

const uri = (schemes: string[]) => Joi.string().uri({ scheme: schemes });
const positiveInteger = (max: number) => Joi.number().integer().min(1).max(max);
const units = Joi.string().pattern(/^[0-9]{1,20}$/);

const schema = Joi.object({
  DATABASE_URL: uri(['postgres', 'postgresql']).required(),
  DB_SYNC_DATABASE_URL: uri(['postgres', 'postgresql']),
  CARDANO_ACCOUNT_XPUB: Joi.string(),
  CARDANO_STAKE_KEY_HASH: Joi.string().hex().length(56),
  CARDANO_NETWORK_ID: Joi.number().valid(0, 1).default(0),
  CARDANO_START_BLOCK: Joi.number().integer().min(-1).default(-1),
  CARDANO_CONFIRMATIONS: positiveInteger(64).default(15),
  CARDANO_ERA: Joi.string().valid('alonzo', 'babbage', 'conway').default('conway'),
  CARDANO_COINS_PER_UTXO_BYTE: units.default('4310'),
  CARDANO_FEE_PER_BYTE: units.default('44'),
  CARDANO_FEE_CONSTANT: units.default('155381'),
  CARDANO_MAX_TX_SIZE: positiveInteger(65536).default(16384),
  CARDANO_MAX_VALUE_SIZE: positiveInteger(65536).default(5000),
  CARDANO_TESTNET_MAGIC: Joi.number().integer().min(0).max(4294967295).default(1),
  API_KEY: Joi.string().min(16).required(),
  SESSION_SECRET: Joi.string().min(32).required(),
  ADMIN_PASSWORD: Joi.string().min(12).required(),
  SECURE_COOKIES: Joi.boolean().default(true),
  WEBHOOK_URL: uri(['http', 'https']),
  WEBHOOK_SECRET: Joi.string().min(16),
  PORT: positiveInteger(65535).default(3000),
  HOST: Joi.string().default('0.0.0.0'),
  POLL_INTERVAL_MS: positiveInteger(60000).min(200).default(2000)
}).and('DB_SYNC_DATABASE_URL', 'CARDANO_ACCOUNT_XPUB').and('WEBHOOK_URL', 'WEBHOOK_SECRET').unknown();

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const { error, value } = schema.validate(env, { abortEarly: false });
  if (error) throw new Error('Invalid configuration: ' + error.message);
  const cardano: CardanoOptions | undefined = value.DB_SYNC_DATABASE_URL ? {
    accountXpub: value.CARDANO_ACCOUNT_XPUB,
    stakeKeyHash: value.CARDANO_STAKE_KEY_HASH,
    networkId: value.CARDANO_NETWORK_ID,
    startBlock: value.CARDANO_START_BLOCK,
    sweep: {
      era: value.CARDANO_ERA,
      coinsPerUtxoByte: BigInt(value.CARDANO_COINS_PER_UTXO_BYTE),
      feePerByte: BigInt(value.CARDANO_FEE_PER_BYTE),
      feeConstant: BigInt(value.CARDANO_FEE_CONSTANT),
      maxTxSize: value.CARDANO_MAX_TX_SIZE,
      maxValueSize: value.CARDANO_MAX_VALUE_SIZE,
      testnetMagic: value.CARDANO_TESTNET_MAGIC
    }
  } : undefined;
  const evm = evmSettings(env);
  if (!cardano && !evm.length) throw new Error('Configure at least one chain');
  const supplies = Joi.object().pattern(/^[A-Za-z0-9._-]{1,80}$/, positiveInteger(2147483647))
    .validate(jsonSetting('SKU_SUPPLY', env.SKU_SUPPLY, {}));
  if (supplies.error) throw new Error('Invalid SKU_SUPPLY: ' + supplies.error.message);

  return {
    databaseUrl: value.DATABASE_URL as string,
    dbSyncUrl: value.DB_SYNC_DATABASE_URL as string | undefined,
    apiKey: value.API_KEY as string,
    sessionSecret: value.SESSION_SECRET as string,
    adminPassword: value.ADMIN_PASSWORD as string,
    secureCookies: value.SECURE_COOKIES as boolean,
    webhook: value.WEBHOOK_URL ? { url: value.WEBHOOK_URL as string, secret: value.WEBHOOK_SECRET as string } : undefined,
    port: value.PORT as number,
    host: value.HOST as string,
    intervalMs: value.POLL_INTERVAL_MS as number,
    supply: supplies.value as Record<string, number>,
    cardano,
    cardanoConfirmations: value.CARDANO_CONFIRMATIONS as number,
    cardanoAssets: cardano ? configuredAssets('cardano', jsonSetting('CARDANO_ASSETS', env.CARDANO_ASSETS, []),
      /^[0-9a-fA-F]{56}\.[0-9a-fA-F]{0,64}$/, { id: 'ADA', symbol: 'ADA', decimals: 6 }) : [],
    evm
  };
}
