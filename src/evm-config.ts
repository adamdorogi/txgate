import Joi from 'joi';
import type { EvmAdapterOptions } from './chains/evm';
import { configuredAssets, jsonSetting } from './asset-config';
import type { Asset } from './services/types';

const networks: Record<string, number> = { ethereum: 1, arbitrum: 42161, base: 8453, polygon: 137, local: 31337 };

const schema = Joi.array().items(Joi.object({
  chain: Joi.string().valid(...Object.keys(networks)).required(),
  chainId: Joi.number().integer().min(1),
  rpcUrl: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
  factoryAddress: Joi.string().pattern(/^0x[0-9a-fA-F]{40}$/).required(),
  treasury: Joi.string().pattern(/^0x[0-9a-fA-F]{40}$/).required(),
  initCodeHash: Joi.string().pattern(/^0x[0-9a-fA-F]{64}$/).required(),
  logChunkSize: Joi.number().integer().min(1).max(10000).default(1000),
  tipFloor: Joi.number().integer().min(-1).default(-1),
  confirmations: Joi.number().integer().min(1).max(64).default(12),
  tokens: Joi.array().default([])
})).unique('chain');

export interface EvmSettings extends EvmAdapterOptions {
  confirmations: number;
  assets: Asset[];
}

export function evmSettings(env: NodeJS.ProcessEnv): EvmSettings[] {
  const single = env.EVM_RPC_URL ? [{
    chain: env.EVM_CHAIN || 'ethereum',
    chainId: env.EVM_CHAIN_ID,
    rpcUrl: env.EVM_RPC_URL,
    factoryAddress: env.EVM_SWEEP_FACTORY_ADDRESS,
    treasury: env.EVM_TREASURY_ADDRESS,
    initCodeHash: env.EVM_INIT_CODE_HASH,
    logChunkSize: env.EVM_LOG_CHUNK_SIZE,
    tipFloor: env.EVM_START_BLOCK,
    confirmations: env.EVM_CONFIRMATIONS,
    tokens: jsonSetting('EVM_TOKENS', env.EVM_TOKENS, [])
  }] : [];
  if (env.EVM_NETWORKS && single.length) throw new Error('Configure EVM_NETWORKS or EVM_RPC_URL');
  const result = schema.validate(jsonSetting('EVM_NETWORKS', env.EVM_NETWORKS, single));
  if (result.error) throw new Error('Invalid EVM settings: ' + result.error.message);
  return (result.value as (Omit<EvmSettings, 'tokenAddresses' | 'assets'> & { tokens: unknown })[])
    .map(({ tokens, ...options }) => {
      const id = networks[options.chain];
      if (options.chainId !== undefined && options.chainId !== id) throw new Error('EVM chain ID does not match chain name');
      const nativeAssetId = options.chain === 'polygon' ? 'MATIC' : 'ETH';
      const assets = configuredAssets(options.chain, tokens, /^0x[0-9a-fA-F]{40}$/, {
        id: nativeAssetId, symbol: nativeAssetId, decimals: 18
      });
      return { ...options, chainId: id, nativeAssetId, assets, tokenAddresses: assets.slice(1).map((asset) => asset.id) };
    });
}
