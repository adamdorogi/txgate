import { HardhatUserConfig, subtask } from 'hardhat/config';
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from 'hardhat/builtin-tasks/task-names';

const version = '0.8.24';

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args: { solcVersion: string }, _hre, runSuper) => {
  if (args.solcVersion !== version) return runSuper();
  return {
    compilerPath: require.resolve('solc/soljson.js'),
    isSolcJs: true,
    version,
    longVersion: '0.8.24+commit.e11b9ed9',
  };
});

function rpc(name: string, chainId: number) {
  return { url: process.env[`${name}_RPC_URL`] || process.env.EVM_RPC_URL || 'http://127.0.0.1:8545', chainId };
}

const config: HardhatUserConfig = {
  solidity: {
    version,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' },
  },
  networks: {
    localhost: { url: process.env.LOCAL_EVM_RPC_URL || 'http://127.0.0.1:8545', chainId: 31337 },
    ethereum: rpc('ETHEREUM', 1),
    arbitrum: rpc('ARBITRUM', 42161),
    base: rpc('BASE', 8453),
    polygon: rpc('POLYGON', 137),
  },
  paths: { tests: './test/contracts' },
};

export default config;
