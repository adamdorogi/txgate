import { rejects } from 'node:assert/strict';
import { expect } from 'chai';
import { artifacts, network } from 'hardhat';
import {
  Address, Hex, createPublicClient, createWalletClient, custom, getAddress, keccak256, parseAbi, zeroAddress,
} from 'viem';
import { EvmAdapter } from '../../src/chains/evm';
import { deriveEvmAddress, invoiceKey } from '../../src/chains/evm/create2';
import { encodeSweep, factoryAbi } from '../../src/chains/evm/sweeper';

const tokenAbi = parseAbi([
  'function mint(address to, uint256 value)',
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
]);
const transport = custom(network.provider);
const client = createPublicClient({ transport, cacheTime: 0 });
const wallet = createWalletClient({ transport });

async function mine(hash: Hex) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  expect(receipt.status).to.equal('success');
  return receipt;
}

async function deploy(name: string, account: Address): Promise<Address> {
  const artifact = await artifacts.readArtifact(name);
  const receipt = await mine(await wallet.deployContract({
    account, chain: null, abi: [], bytecode: artifact.bytecode as Hex,
  }));
  if (!receipt.contractAddress) throw new Error('Deployment returned no contract address');
  return getAddress(receipt.contractAddress);
}

describe('SweepFactory', () => {
  let factory: Address;
  let token: Address;
  let treasury: Address;
  let payer: Address;
  let outsider: Address;
  let initCodeHash: Hex;

  beforeEach(async () => {
    [treasury, payer, outsider] = await wallet.getAddresses();
    factory = await deploy('SweepFactory', treasury);
    token = await deploy('MockERC20', treasury);
    initCodeHash = await client.readContract({ address: factory, abi: factoryAbi, functionName: 'initCodeHash' });
  });

  function balanceOf(account: Address) {
    return client.readContract({ address: token, abi: tokenAbi, functionName: 'balanceOf', args: [account] });
  }

  async function mint(to: Address, amount: bigint) {
    await mine(await wallet.writeContract({
      chain: null, account: payer, address: token, abi: tokenAbi, functionName: 'mint', args: [to, amount],
    }));
  }

  it('matches off-chain addresses and sweeps two prefunded deposits in one transaction', async () => {
    const ethInvoice = 'eth-1';
    const tokenInvoice = 'usdc-1';
    const nativeDeposit = deriveEvmAddress(factory, treasury, ethInvoice, initCodeHash);
    const tokenDeposit = deriveEvmAddress(factory, treasury, tokenInvoice, initCodeHash);
    const sweeper = await artifacts.readArtifact('DepositSweeper');
    expect(initCodeHash).to.equal(keccak256(sweeper.bytecode as Hex));
    expect(getAddress(await client.readContract({
      address: factory, abi: factoryAbi, functionName: 'depositAddress', args: [treasury, invoiceKey(ethInvoice)],
    }))).to.equal(nativeDeposit);
    expect(deriveEvmAddress(factory, outsider, ethInvoice, initCodeHash)).to.not.equal(nativeDeposit);

    await mine(await wallet.sendTransaction({ chain: null, account: payer, to: nativeDeposit, value: 125n }));
    await mint(tokenDeposit, 2_500_000n);
    expect(await client.getBytecode({ address: nativeDeposit })).to.equal(undefined);
    expect(await client.getBytecode({ address: tokenDeposit })).to.equal(undefined);

    const block = { blockHeight: 0, blockHash: '0x0', time: new Date(), derivationIndex: 0 };
    const data = encodeSweep(factory, treasury, initCodeHash, { destination: treasury, refund: false, items: [
      { ...block, invoiceId: ethInvoice, address: nativeDeposit, assetId: 'ETH', amount: 125n, txId: '1', outputIndex: -1 },
      { ...block, invoiceId: tokenInvoice, address: tokenDeposit, assetId: token, amount: 2_500_000n, txId: '2', outputIndex: 0 },
    ] });
    const before = await client.getBalance({ address: treasury });
    const receipt = await mine(await wallet.sendTransaction({ chain: null, account: treasury, to: factory, data }));
    expect(await client.getBalance({ address: nativeDeposit })).to.equal(0n);
    expect(await balanceOf(tokenDeposit)).to.equal(0n);
    expect(await balanceOf(treasury)).to.equal(2_500_000n);
    expect(await client.getBalance({ address: treasury })).to.equal(before + 125n - receipt.gasUsed * receipt.effectiveGasPrice);

    await mine(await wallet.sendTransaction({ chain: null, account: payer, to: nativeDeposit, value: 3n }));
    await mine(await wallet.writeContract({
      chain: null, account: treasury, address: factory, abi: factoryAbi, functionName: 'deployAndSweepETH',
      args: [treasury, invoiceKey(ethInvoice)],
    }));
    expect(await client.getBalance({ address: nativeDeposit })).to.equal(0n);
  });

  it('authorizes refunds by treasury and reverts a failed batch atomically', async () => {
    const invoice = 'late-usdc';
    const deposit = deriveEvmAddress(factory, treasury, invoice, initCodeHash);
    await mint(deposit, 10n);
    const item = { invoiceId: invoiceKey(invoice), transferId: invoiceKey('transfer-1'), token, recipient: payer, amount: 4n };

    await rejects(wallet.writeContract({
      chain: null, account: outsider, address: factory, abi: factoryAbi, functionName: 'batchRefund', args: [treasury, [item]],
    }));
    await rejects(wallet.writeContract({
      chain: null, account: treasury, address: factory, abi: factoryAbi, functionName: 'batchRefund',
      args: [treasury, [item, { ...item, transferId: invoiceKey('transfer-2'), amount: 7n }]],
    }));
    expect(await balanceOf(deposit)).to.equal(10n);
    expect(await balanceOf(payer)).to.equal(0n);
    expect(await client.getBytecode({ address: deposit })).to.equal(undefined);

    await mine(await wallet.writeContract({
      chain: null, account: treasury, address: factory, abi: factoryAbi, functionName: 'batchRefund', args: [treasury, [item]],
    }));
    expect(await balanceOf(deposit)).to.equal(6n);
    expect(await balanceOf(payer)).to.equal(4n);
    await rejects(wallet.writeContract({
      chain: null, account: treasury, address: factory, abi: factoryAbi, functionName: 'batchRefund', args: [treasury, [item]],
    }));
    await rejects(wallet.writeContract({
      chain: null, account: treasury, address: factory, abi: factoryAbi, functionName: 'deployAndSweepERC20',
      args: [treasury, invoiceKey(invoice), zeroAddress],
    }));
    await mine(await wallet.writeContract({
      chain: null, account: treasury, address: factory, abi: factoryAbi, functionName: 'deployAndSweepERC20',
      args: [treasury, invoiceKey(invoice), token],
    }));
    expect(await balanceOf(treasury)).to.equal(6n);
  });

  it('reads direct ETH and ERC-20 payments and detects a replaced tip', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const payload = await request.json() as Parameters<typeof network.provider.request>[0] & { id: number };
      const result = await network.provider.request(payload);
      return Response.json({ jsonrpc: '2.0', id: payload.id, result });
    };
    try {
      const adapter = new EvmAdapter({
        chain: 'ethereum', chainId: 31337, treasury, initCodeHash, factoryAddress: factory,
        tokenAddresses: [token], rpcUrl: 'http://127.0.0.1:8545', logChunkSize: 1,
      });
      await adapter.verifyDeployment();
      await mint(payer, 70n);
      const initial = await adapter.getTip();
      const snapshot = await network.provider.send('evm_snapshot');
      const ethAddress = adapter.deriveDepositTarget('eth', 0);
      const tokenAddress = adapter.deriveDepositTarget('token', 0);
      await mine(await wallet.sendTransaction({ chain: null, account: payer, to: ethAddress, value: 7n }));
      await mine(await wallet.writeContract({
        chain: null, account: payer, address: token, abi: tokenAbi, functionName: 'transfer', args: [tokenAddress, 70n],
      }));
      const tip = await adapter.getTip();
      const nativeTarget = { invoiceId: 'eth', address: ethAddress, assetId: 'ETH' };
      const tokenTarget = { invoiceId: 'token', address: tokenAddress, assetId: token.toLowerCase() };
      const { blocks, transfers } = await adapter.pollBlocks(initial.height + 1, tip.height, [nativeTarget, tokenTarget]);
      expect(blocks.map(block => block.parentHash)).to.deep.equal([initial.hash, blocks[0].hash]);
      expect(transfers.map(row => [row.invoiceId, row.amount, row.outputIndex, row.detail?.sender])).to.deep.equal([
        ['eth', 7n, -1, getAddress(payer)], ['token', 70n, 0, getAddress(payer)],
      ]);
      const items = transfers.map(row => ({
        ...(row.invoiceId === 'eth' ? nativeTarget : tokenTarget), ...row, derivationIndex: 0,
      }));
      const sweep = await adapter.buildUnsignedSweep({ destination: treasury, refund: false, items });
      expect(sweep.to).to.equal(factory);
      expect(sweep.chainId).to.equal(31337);
      expect(BigInt(sweep.gas) > 0n).to.equal(true);

      await network.provider.send('evm_revert', [snapshot]);
      await network.provider.send('evm_mine');
      await network.provider.send('evm_mine');
      expect((await adapter.verifyChainTip(tip.height))?.hash).to.not.equal(tip.hash);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
