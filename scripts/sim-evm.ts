import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Knex } from 'knex';
import {
  Hex, createPublicClient, createWalletClient, getAddress, http, parseAbi
} from 'viem';
import { hardhat } from 'viem/chains';
import { factoryAbi } from '../src/chains/evm/sweeper';

const tokenAbi = parseAbi([
  'function mint(address to, uint256 amount)',
  'function transfer(address to, uint256 amount) returns (bool)'
]);
const mockTokens = [
  { symbol: 'USDC', decimals: 6 },
  { symbol: 'USDT', decimals: 6 }
];

function artifact(path: string): Hex {
  const file = resolve('artifacts/contracts', path);
  try {
    return JSON.parse(readFileSync(file, 'utf8')).bytecode;
  } catch {
    throw new Error('Missing contract artifacts. Run npx hardhat compile.');
  }
}

export async function runEvm(command: string, args: string[], db: Knex) {
  const url = process.env.LOCAL_EVM_RPC_URL || 'http://127.0.0.1:8545';
  const client = createPublicClient({ chain: hardhat, transport: http(url), cacheTime: 0 });
  const wallet = createWalletClient({ chain: hardhat, transport: http(url) });
  if (await client.getChainId() !== hardhat.id) throw new Error('Expected a local Hardhat chain (31337)');
  const account = (await wallet.getAddresses())[0];
  if (!account) throw new Error('No unlocked local development account');
  if (command === 'init') {
    const deploy = async (bytecode: Hex, abi: readonly [] = []) => {
      const hash = await wallet.deployContract({ abi, bytecode, account });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('Local deployment failed');
      return receipt.contractAddress;
    };
    const factory = await deploy(artifact('SweepFactory.sol/SweepFactory.json'));
    const initCodeHash = await client.readContract({ address: factory, abi: factoryAbi, functionName: 'initCodeHash' });
    const tokens = [];
    for (const token of mockTokens) {
      const id = await deploy(artifact('test/MockERC20.sol/MockERC20.json'));
      tokens.push({ ...token, id });
    }
    return {
      EVM_CHAIN: 'local',
      EVM_RPC_URL: url,
      EVM_SWEEP_FACTORY_ADDRESS: factory,
      EVM_INIT_CODE_HASH: initCodeHash,
      EVM_TREASURY_ADDRESS: account,
      EVM_TOKENS: tokens,
      EVM_CONFIRMATIONS: 2
    };
  }
  const rpc = client.request as (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  if (command === 'snapshot') return rpc({ method: 'evm_snapshot' });
  if (command === 'revert') {
    if (!/^0x[0-9a-f]+$/i.test(args[0] || '')) throw new Error('Expected a snapshot ID');
    const result = await rpc({ method: 'evm_revert', params: [args[0]] });
    if (!result) throw new Error('Unknown EVM snapshot');
    return result;
  }
  if (command === 'mine') {
    const count = Number(args[0] || 1);
    if (!Number.isInteger(count) || count < 1 || count > 1024) throw new Error('Invalid block count');
    for (let i = 0; i < count; i++) await rpc({ method: 'evm_mine' });
    return count;
  }
  if (command !== 'payment') throw new Error('Unknown local EVM command');
  if (!/^[a-f0-9-]{36}$/i.test(args[0] || '')) throw new Error('Expected an invoice ID');
  const invoice = await db('invoices').where({ id: args[0], chain: 'local' }).first();
  if (!invoice) throw new Error('Local EVM invoice was not found');
  const amount = args[1] ?? invoice.amount;
  if (!/^[1-9]\d{0,77}$/.test(amount) || BigInt(amount) >= 2n ** 256n) throw new Error('Invalid minor-unit amount');
  const address = getAddress(invoice.address);
  let hash: Hex;
  if (invoice.asset_id === 'ETH') {
    hash = await wallet.sendTransaction({ account, to: address, value: BigInt(amount) });
  } else {
    const token = getAddress(invoice.asset_id);
    const mint = await wallet.writeContract({
      account, address: token, abi: tokenAbi, functionName: 'mint', args: [account, BigInt(amount)]
    });
    if ((await client.waitForTransactionReceipt({ hash: mint })).status !== 'success') throw new Error('Local mint reverted');
    hash = await wallet.writeContract({
      account, address: token, abi: tokenAbi, functionName: 'transfer', args: [address, BigInt(amount)]
    });
  }
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('Local payment reverted');
  return hash;
}
