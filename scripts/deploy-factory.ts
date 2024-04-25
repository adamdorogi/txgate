import { artifacts, network } from 'hardhat';
import { Hex, createPublicClient, createWalletClient, custom, keccak256 } from 'viem';
import { factoryAbi } from '../src/chains/evm/sweeper';

async function deploy() {
  const factory = await artifacts.readArtifact('SweepFactory');
  const sweeper = await artifacts.readArtifact('DepositSweeper');
  const transport = custom(network.provider);
  const wallet = createWalletClient({ transport });
  const client = createPublicClient({ transport });
  const [account] = await wallet.getAddresses();
  const initCodeHash = keccak256(sweeper.bytecode as Hex);

  if (!account) {
    console.log(JSON.stringify({
      chainId: await client.getChainId(), data: factory.bytecode, value: '0', initCodeHash,
    }, null, 2));
    return;
  }

  const hash = await wallet.deployContract({ account, chain: null, abi: factoryAbi, bytecode: factory.bytecode as Hex });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('Factory deployment failed');
  const deployedHash = await client.readContract({
    address: receipt.contractAddress, abi: factoryAbi, functionName: 'initCodeHash',
  });
  if (deployedHash !== initCodeHash) throw new Error('Factory init code hash mismatch');
  console.log(JSON.stringify({ factoryAddress: receipt.contractAddress, initCodeHash }, null, 2));
}

deploy().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
