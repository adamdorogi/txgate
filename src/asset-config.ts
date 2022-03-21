import Joi from 'joi';
import type { Asset } from './services/types';

const assetSchema = Joi.array().items(Joi.object({
  id: Joi.string().required(),
  symbol: Joi.string().pattern(/^[A-Za-z0-9._-]{1,24}$/).required(),
  decimals: Joi.number().integer().min(0).max(36).required()
})).unique('id').unique('symbol').max(100);

export function jsonSetting(name: string, input: string | undefined, fallback: unknown): unknown {
  if (!input) return fallback;
  try {
    return JSON.parse(input);
  } catch {
    throw new Error(name + ' must be valid JSON');
  }
}

export function configuredAssets(
  chain: string, input: unknown, identifier: RegExp, builtin: { id: string; symbol: string; decimals: number }
): Asset[] {
  const result = assetSchema.validate(input);
  if (result.error) throw new Error('Invalid ' + chain + ' asset list: ' + result.error.message);
  const assets: Asset[] = [{ ...builtin, chain }];
  for (const data of result.value as Omit<Asset, 'chain'>[]) {
    if (!identifier.test(data.id)) throw new Error('Invalid ' + chain + ' asset ID');
    assets.push({ ...data, id: data.id.toLowerCase(), chain });
  }
  if (new Set(assets.map((asset) => asset.id)).size !== assets.length) throw new Error('Duplicate asset IDs');
  return assets;
}
