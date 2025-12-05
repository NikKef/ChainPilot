require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "paris",
      viaIR: true, // Enable IR-based code generation to fix "Stack too deep"
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    bscTestnet: {
      url: process.env.RPC_URL_BSC_TESTNET || "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      accounts: process.env.FACILITATOR_PRIVATE_KEY 
        ? [process.env.FACILITATOR_PRIVATE_KEY] 
        : [],
      gasPrice: 10000000000, // 10 gwei
    },
    bscMainnet: {
      url: process.env.RPC_URL_BSC_MAINNET || "https://bsc-dataseed.binance.org",
      chainId: 56,
      accounts: process.env.FACILITATOR_PRIVATE_KEY 
        ? [process.env.FACILITATOR_PRIVATE_KEY] 
        : [],
      gasPrice: 3000000000, // 3 gwei
    },
  },
  etherscan: {
    // Use single API key for Etherscan V2 API
    apiKey: process.env.BSCSCAN_API_KEY || "",
    customChains: [
      {
        network: "bscTestnet",
        chainId: 97,
        urls: {
          apiURL: "https://api-testnet.bscscan.com/api",
          browserURL: "https://testnet.bscscan.com"
        }
      },
      {
        network: "bscMainnet",
        chainId: 56,
        urls: {
          apiURL: "https://api.bscscan.com/api",
          browserURL: "https://bscscan.com"
        }
      }
    ]
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

