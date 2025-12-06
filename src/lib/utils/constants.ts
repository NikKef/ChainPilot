// Network configuration
export const NETWORKS = {
  testnet: {
    chainId: 97,
    name: 'BNB Smart Chain Testnet',
    rpcUrl: process.env.BNB_TESTNET_RPC_URL || 'https://data-seed-prebsc-1-s1.binance.org:8545',
    explorerUrl: 'https://testnet.bscscan.com',
    nativeCurrency: {
      name: 'tBNB',
      symbol: 'tBNB',
      decimals: 18,
    },
  },
  mainnet: {
    chainId: 56,
    name: 'BNB Smart Chain',
    rpcUrl: process.env.BNB_MAINNET_RPC_URL || 'https://bsc-dataseed.binance.org',
    explorerUrl: 'https://bscscan.com',
    nativeCurrency: {
      name: 'BNB',
      symbol: 'BNB',
      decimals: 18,
    },
  },
} as const;

export type NetworkType = keyof typeof NETWORKS;

// PancakeSwap Router addresses
export const PANCAKE_ROUTER = {
  testnet: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1', // V2 Router on testnet
  mainnet: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4', // SmartRouter on mainnet
} as const;

// Q402 Contract Addresses (EIP-7702 delegated payments)
// These are placeholder addresses - update with deployed contracts
export const Q402_CONTRACTS = {
  testnet: {
    implementation: process.env.Q402_IMPLEMENTATION_TESTNET || '0x0000000000000000000000000000000000000001', // Q402 Implementation Contract
    verifier: process.env.Q402_VERIFIER_TESTNET || '0x0000000000000000000000000000000000000002', // EIP-712 Verifying Contract
    facilitatorWallet: process.env.Q402_FACILITATOR_WALLET_TESTNET || '0x0000000000000000000000000000000000000003', // Gas sponsor wallet
    vault: process.env.Q402_VAULT_TESTNET || '', // Q402 Vault Contract for deposits
    batchExecutor: process.env.Q402_BATCH_EXECUTOR_TESTNET || '', // Q402 BatchExecutor for gas-sponsored batches
  },
  mainnet: {
    implementation: process.env.Q402_IMPLEMENTATION_MAINNET || '0x0000000000000000000000000000000000000001',
    verifier: process.env.Q402_VERIFIER_MAINNET || '0x0000000000000000000000000000000000000002',
    facilitatorWallet: process.env.Q402_FACILITATOR_WALLET_MAINNET || '0x0000000000000000000000000000000000000003',
    vault: process.env.Q402_VAULT_MAINNET || '', // Q402 Vault Contract for deposits
    batchExecutor: process.env.Q402_BATCH_EXECUTOR_MAINNET || '', // Q402 BatchExecutor for gas-sponsored batches
  },
} as const;

// Q402 Facilitator API endpoints
// Use /api/facilitator for self-hosted, or external URL for Quack's facilitator
export const Q402_FACILITATOR = {
  // Default to local facilitator (self-hosted)
  apiUrl: process.env.Q402_API_URL || '/api/facilitator',
  endpoints: {
    verify: '/verify',
    settle: '/settle',
    supported: '/supported',
    health: '/health',
  },
  // Default gas sponsorship limits
  gasPolicy: {
    maxGasPriceGwei: parseInt(process.env.MAX_GAS_PRICE_GWEI || '20'),
    maxGasLimit: parseInt(process.env.MAX_GAS_LIMIT || '5000000'),
    sponsorGas: true,
  },
  // Payment request expiry (20 minutes)
  requestExpiryMs: 20 * 60 * 1000,
} as const;

export const PANCAKE_FACTORY = {
  testnet: '0x6725F303b657a9451d8BA641348b6761A6CC7a17',
  mainnet: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
} as const;

// Common token addresses on BNB Chain
export const TOKENS = {
  testnet: {
    WBNB: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
    USDT: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
    BUSD: '0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee',
    USDC: '0x64544969ed7EBf5f083679233325356EbE738930',
    // Additional common testnet tokens (may need to be updated with actual testnet addresses)
    LINK: '0x84b9B910527Ad5C03A9Ca831909E21e236EA7b06', // Chainlink testnet
    CAKE: '0xFa60D973F7642B748046464e165A65B7323b0DEE', // PancakeSwap testnet
    DAI: '0x8a9424745056Eb399FD19a0EC26A14316684e274', // DAI testnet
    ETH: '0xd66c6B4F0be8CE5b39D52E0Fd1344c389929B378', // Binance-Peg Ethereum testnet
  },
  mainnet: {
    WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    // Additional common mainnet tokens
    LINK: '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD', // Chainlink on BSC
    CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', // PancakeSwap
    DAI: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', // DAI on BSC
    ETH: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', // Binance-Peg Ethereum
    BTCB: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', // Binance-Peg BTC
    XRP: '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE', // Binance-Peg XRP
    DOGE: '0xbA2aE424d960c26247Dd6c32edC70B295c744C43', // Binance-Peg Dogecoin
    SHIB: '0x2859e4544C4bB03966803b044A93563Bd2D0DD4D', // SHIBA INU
  },
} as const;

// Token symbol to address mapping for common tokens
export const TOKEN_SYMBOLS: Record<string, Record<NetworkType, string>> = {
  BNB: { testnet: 'native', mainnet: 'native' },
  WBNB: TOKENS.testnet.WBNB ? { testnet: TOKENS.testnet.WBNB, mainnet: TOKENS.mainnet.WBNB } : { testnet: '', mainnet: '' },
  USDT: { testnet: TOKENS.testnet.USDT, mainnet: TOKENS.mainnet.USDT },
  BUSD: { testnet: TOKENS.testnet.BUSD, mainnet: TOKENS.mainnet.BUSD },
  USDC: { testnet: TOKENS.testnet.USDC, mainnet: TOKENS.mainnet.USDC },
  LINK: { testnet: TOKENS.testnet.LINK, mainnet: TOKENS.mainnet.LINK },
  CAKE: { testnet: TOKENS.testnet.CAKE, mainnet: TOKENS.mainnet.CAKE },
  DAI: { testnet: TOKENS.testnet.DAI, mainnet: TOKENS.mainnet.DAI },
  ETH: { testnet: TOKENS.testnet.ETH, mainnet: TOKENS.mainnet.ETH },
  BTCB: { testnet: '', mainnet: TOKENS.mainnet.BTCB },
  XRP: { testnet: '', mainnet: TOKENS.mainnet.XRP },
  DOGE: { testnet: '', mainnet: TOKENS.mainnet.DOGE },
  SHIB: { testnet: '', mainnet: TOKENS.mainnet.SHIB },
};

// Default policy values
export const DEFAULT_POLICY = {
  maxPerTxUsd: 1000,
  maxDailyUsd: 5000,
  maxSlippageBps: 300, // 3%
  allowUnknownContracts: false,
};

// Risk level thresholds
export const RISK_THRESHOLDS = {
  highValuePercentage: 50, // Warn if moving more than 50% of holdings
  highSlippageBps: 500, // 5%
  unknownContractRisk: 'MEDIUM',
} as const;

// API rate limits
export const RATE_LIMITS = {
  chatMessagesPerMinute: 20,
  contractGenerationsPerHour: 10,
  contractAuditsPerHour: 20,
};

// ERC20 ABI (minimal for transfers and approvals)
export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
];

// PancakeSwap Router ABI (minimal for swaps)
export const PANCAKE_ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapTokensForExactTokens(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapTokensForExactETH(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapETHForExactTokens(uint amountOut, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
  'function getAmountsIn(uint amountOut, address[] calldata path) external view returns (uint[] memory amounts)',
  'function WETH() external pure returns (address)',
];

// Q402 BatchExecutor ABI (for gas-sponsored batch operations)
export const Q402_BATCH_EXECUTOR_ABI = [
  // Main execution function
  'function executeBatch((address owner, bytes32 operationsHash, uint256 deadline, bytes32 batchId, uint256 nonce) witness, (uint8 opType, address tokenIn, uint256 amountIn, address tokenOut, uint256 minAmountOut, address target, bytes data)[] operations, bytes signature) external',
  // View functions
  'function getNonce(address owner) view returns (uint256)',
  'function isBatchIdUsed(bytes32 batchId) view returns (bool)',
  'function isFacilitator(address addr) view returns (bool)',
  'function isRouterWhitelisted(address router) view returns (bool)',
  'function isTargetWhitelisted(address target) view returns (bool)',
  'function domainSeparator() view returns (bytes32)',
  'function computeOperationsHash((uint8 opType, address tokenIn, uint256 amountIn, address tokenOut, uint256 minAmountOut, address target, bytes data)[] operations) view returns (bytes32)',
  'function maxOperationsPerBatch() view returns (uint256)',
  'function paused() view returns (bool)',
  // Constants
  'function OP_TRANSFER() view returns (uint8)',
  'function OP_SWAP() view returns (uint8)',
  'function OP_CALL() view returns (uint8)',
  // Events
  'event BatchExecuted(address indexed owner, bytes32 indexed batchId, uint256 operationCount, uint256 nonce, address facilitator)',
  'event OperationExecuted(bytes32 indexed batchId, uint256 indexed operationIndex, uint8 opType, address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut, address target)',
];

// EIP-712 type definitions for BatchWitness
export const BATCH_WITNESS_TYPES = {
  Operation: [
    { name: 'opType', type: 'uint8' },
    { name: 'tokenIn', type: 'address' },
    { name: 'amountIn', type: 'uint256' },
    { name: 'tokenOut', type: 'address' },
    { name: 'minAmountOut', type: 'uint256' },
    { name: 'target', type: 'address' },
    { name: 'data', type: 'bytes' },
  ],
  BatchWitness: [
    { name: 'owner', type: 'address' },
    { name: 'operationsHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
    { name: 'batchId', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

// Operation types for batch execution
export const BATCH_OPERATION_TYPES = {
  TRANSFER: 0,
  SWAP: 1,
  CALL: 2,
} as const;

// BscScan API configuration
export const BSCSCAN_API = {
  testnet: {
    baseUrl: 'https://api-testnet.bscscan.com/api',
    explorerUrl: 'https://testnet.bscscan.com',
  },
  mainnet: {
    baseUrl: 'https://api.bscscan.com/api',
    explorerUrl: 'https://bscscan.com',
  },
  // API key from environment variable
  apiKey: process.env.BSCSCAN_API_KEY || '',
} as const;

