import { 
  Contract, 
  Interface, 
  parseUnits, 
  formatUnits,
  TransactionRequest,
  keccak256,
  toUtf8Bytes,
} from 'ethers';
import type { PreparedTx, GasEstimate, TransactionPreview, TransactionType } from '@/lib/types';
import { getProvider, estimateGas, getFeeData } from './provider';
import { ERC20_ABI, TOKENS, type NetworkType } from '@/lib/utils/constants';
import { logger } from '@/lib/utils';
import { Web3Error } from '@/lib/utils/errors';
import { formatTokenAmount } from '@/lib/utils/formatting';

/**
 * Build a native BNB transfer transaction
 */
export async function buildNativeTransfer(
  from: string,
  to: string,
  amount: string,
  network: NetworkType
): Promise<PreparedTx> {
  logger.web3Tx('buildNativeTransfer', { from, to, amount, network });

  const value = parseUnits(amount, 18);
  
  const gasEstimate = await estimateGas(
    { from, to, value },
    network
  );

  const feeData = await getFeeData(network);

  return {
    to,
    data: '0x',
    value: value.toString(),
    gasLimit: (gasEstimate * BigInt(120) / BigInt(100)).toString(), // 20% buffer
    gasPrice: feeData.gasPrice.toString(),
  };
}

/**
 * Build a BEP20 token transfer transaction
 */
export async function buildTokenTransfer(
  from: string,
  to: string,
  tokenAddress: string,
  amount: string,
  network: NetworkType
): Promise<PreparedTx> {
  logger.web3Tx('buildTokenTransfer', { from, to, tokenAddress, amount, network });

  const provider = getProvider(network);
  const tokenContract = new Contract(tokenAddress, ERC20_ABI, provider);

  // Get token decimals
  const decimals = await tokenContract.decimals();
  const amountWei = parseUnits(amount, decimals);

  // Encode transfer call
  const iface = new Interface(ERC20_ABI);
  const data = iface.encodeFunctionData('transfer', [to, amountWei]);

  logger.debug('Token transfer data encoded', {
    functionSelector: data.slice(0, 10),
    dataLength: data.length,
    recipient: to,
    amountWei: amountWei.toString(),
  });

  // Estimate gas
  const gasEstimate = await estimateGas(
    { from, to: tokenAddress, data },
    network
  );

  const feeData = await getFeeData(network);

  const preparedTx: PreparedTx = {
    to: tokenAddress,
    data,
    value: '0',
    gasLimit: (gasEstimate * BigInt(120) / BigInt(100)).toString(),
    gasPrice: feeData.gasPrice.toString(),
  };

  logger.debug('Prepared token transfer transaction', {
    to: preparedTx.to,
    dataLength: preparedTx.data.length,
    dataPreview: preparedTx.data.slice(0, 74),
    value: preparedTx.value,
  });

  return preparedTx;
}

/**
 * Build an ERC20 approval transaction
 */
export async function buildApproval(
  from: string,
  tokenAddress: string,
  spender: string,
  amount: string,
  network: NetworkType
): Promise<PreparedTx> {
  logger.web3Tx('buildApproval', { from, tokenAddress, spender, amount, network });

  const provider = getProvider(network);
  const tokenContract = new Contract(tokenAddress, ERC20_ABI, provider);

  // Get token decimals
  const decimals = await tokenContract.decimals();
  const amountWei = parseUnits(amount, decimals);

  // Encode approve call
  const iface = new Interface(ERC20_ABI);
  const data = iface.encodeFunctionData('approve', [spender, amountWei]);

  // Estimate gas
  const gasEstimate = await estimateGas(
    { from, to: tokenAddress, data },
    network
  );

  const feeData = await getFeeData(network);

  return {
    to: tokenAddress,
    data,
    value: '0',
    gasLimit: (gasEstimate * BigInt(120) / BigInt(100)).toString(),
    gasPrice: feeData.gasPrice.toString(),
  };
}

/**
 * Build an arbitrary contract call transaction
 */
export async function buildContractCall(
  from: string,
  contractAddress: string,
  abi: string[] | Interface,
  methodName: string,
  args: unknown[],
  value: string = '0',
  network: NetworkType
): Promise<PreparedTx> {
  logger.web3Tx('buildContractCall', { from, contractAddress, methodName, network });

  const iface = typeof abi === 'object' && abi instanceof Interface 
    ? abi 
    : new Interface(abi);

  // Encode the function call
  const data = iface.encodeFunctionData(methodName, args);

  // Parse value
  const valueWei = value === '0' ? BigInt(0) : parseUnits(value, 18);

  // Estimate gas
  const gasEstimate = await estimateGas(
    { from, to: contractAddress, data, value: valueWei },
    network
  );

  const feeData = await getFeeData(network);

  return {
    to: contractAddress,
    data,
    value: valueWei.toString(),
    gasLimit: (gasEstimate * BigInt(150) / BigInt(100)).toString(), // 50% buffer for complex calls
    gasPrice: feeData.gasPrice.toString(),
  };
}

/**
 * Build a contract deployment transaction
 */
export async function buildDeployment(
  from: string,
  bytecode: string,
  constructorArgs: string = '',
  network: NetworkType
): Promise<PreparedTx> {
  logger.web3Tx('buildDeployment', { from, network });

  // Combine bytecode with constructor args
  const data = bytecode + constructorArgs;

  // Estimate gas
  const gasEstimate = await estimateGas(
    { from, data },
    network
  );

  const feeData = await getFeeData(network);

  return {
    to: '', // Empty for deployment
    data,
    value: '0',
    gasLimit: (gasEstimate * BigInt(130) / BigInt(100)).toString(), // 30% buffer
    gasPrice: feeData.gasPrice.toString(),
  };
}

/**
 * Estimate gas cost for a transaction
 */
export async function estimateTransactionGas(
  tx: PreparedTx,
  network: NetworkType
): Promise<GasEstimate> {
  const provider = getProvider(network);

  const gasLimit = tx.gasLimit 
    ? BigInt(tx.gasLimit)
    : await estimateGas({ to: tx.to, data: tx.data, value: BigInt(tx.value || 0) }, network);

  const feeData = await getFeeData(network);
  const gasPrice = tx.gasPrice ? BigInt(tx.gasPrice) : feeData.gasPrice;

  const estimatedFee = gasLimit * gasPrice;

  return {
    gasLimit,
    gasPrice,
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    estimatedFee,
    estimatedFeeFormatted: formatUnits(estimatedFee, 18),
  };
}

/**
 * Get ERC20 token info
 * Returns token info if the address is a valid ERC20 contract
 * Some tokens may have non-standard implementations, so we're tolerant of missing name/symbol
 * but decimals() is required for transfers
 */
export async function getTokenInfo(
  tokenAddress: string,
  network: NetworkType
): Promise<{
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}> {
  const provider = getProvider(network);
  const contract = new Contract(tokenAddress, ERC20_ABI, provider);

  try {
    // decimals() is essential for transfers - if this fails, the token is not usable
    const decimals = await contract.decimals();
    
    // name() and symbol() are optional - some tokens don't implement them
    let name = 'Unknown Token';
    let symbol = 'TOKEN';
    
    try {
      name = await contract.name();
    } catch {
      logger.debug('Token does not have name() function', { tokenAddress });
    }
    
    try {
      symbol = await contract.symbol();
    } catch {
      logger.debug('Token does not have symbol() function', { tokenAddress });
    }

    return {
      address: tokenAddress,
      name,
      symbol,
      decimals: Number(decimals),
    };
  } catch (error) {
    // Handle ethers.js call exceptions with a friendly message
    logger.error('Failed to get token info', { tokenAddress, network, error });
    throw new Web3Error(
      `Unable to fetch token information for ${tokenAddress}. Please verify this is a valid BEP20/ERC20 token contract address on ${network}.`,
      { code: 'TOKEN_INFO_FETCH_FAILED', tokenAddress, network }
    );
  }
}

/**
 * Get ERC20 token balance
 */
export async function getTokenBalance(
  tokenAddress: string,
  walletAddress: string,
  network: NetworkType
): Promise<{
  balance: bigint;
  decimals: number;
  formatted: string;
}> {
  const provider = getProvider(network);
  const contract = new Contract(tokenAddress, ERC20_ABI, provider);

  const [balance, decimals] = await Promise.all([
    contract.balanceOf(walletAddress),
    contract.decimals(),
  ]);

  return {
    balance,
    decimals: Number(decimals),
    formatted: formatTokenAmount(balance, Number(decimals)),
  };
}

/**
 * Check ERC20 allowance
 */
export async function getAllowance(
  tokenAddress: string,
  owner: string,
  spender: string,
  network: NetworkType
): Promise<bigint> {
  const provider = getProvider(network);
  const contract = new Contract(tokenAddress, ERC20_ABI, provider);
  return contract.allowance(owner, spender);
}

/**
 * Check if Q402 contract has sufficient allowance for a token transfer
 * Returns true if approval is needed, false if sufficient allowance exists
 */
export async function checkQ402ApprovalNeeded(
  tokenAddress: string,
  ownerAddress: string,
  amount: string,
  network: NetworkType
): Promise<{
  needsApproval: boolean;
  currentAllowance: bigint;
  requiredAmount: bigint;
  q402ContractAddress: string;
}> {
  // Import Q402 contract address
  const { Q402_CONTRACTS } = await import('@/lib/utils/constants');
  const q402ContractAddress = Q402_CONTRACTS[network].implementation;
  
  // Get token decimals
  const provider = getProvider(network);
  const tokenContract = new Contract(tokenAddress, ERC20_ABI, provider);
  const decimals = await tokenContract.decimals();
  
  // Parse amount to wei
  const requiredAmount = parseUnits(amount, decimals);
  
  // Check current allowance
  const currentAllowance = await getAllowance(tokenAddress, ownerAddress, q402ContractAddress, network);
  
  logger.debug('Q402 approval check', {
    tokenAddress,
    ownerAddress,
    q402ContractAddress,
    requiredAmount: requiredAmount.toString(),
    currentAllowance: currentAllowance.toString(),
    needsApproval: currentAllowance < requiredAmount,
  });
  
  return {
    needsApproval: currentAllowance < requiredAmount,
    currentAllowance,
    requiredAmount,
    q402ContractAddress,
  };
}

/**
 * Build an approval transaction for the Q402 contract
 */
export async function buildQ402Approval(
  from: string,
  tokenAddress: string,
  amount: string,
  network: NetworkType
): Promise<PreparedTx> {
  const { Q402_CONTRACTS } = await import('@/lib/utils/constants');
  const q402ContractAddress = Q402_CONTRACTS[network].implementation;
  
  // Build approval for the Q402 contract
  return buildApproval(from, tokenAddress, q402ContractAddress, amount, network);
}

/**
 * Check if PancakeSwap router has sufficient allowance for a token swap
 * Returns true if approval is needed, false if sufficient allowance exists
 */
export async function checkSwapApprovalNeeded(
  tokenAddress: string,
  ownerAddress: string,
  amount: string,
  network: NetworkType
): Promise<{
  needsApproval: boolean;
  currentAllowance: bigint;
  requiredAmount: bigint;
  routerAddress: string;
}> {
  // Import PancakeSwap router address
  const { PANCAKE_ROUTER } = await import('@/lib/utils/constants');
  const routerAddress = PANCAKE_ROUTER[network];
  
  // Get token decimals
  const provider = getProvider(network);
  const tokenContract = new Contract(tokenAddress, ERC20_ABI, provider);
  const decimals = await tokenContract.decimals();
  
  // Parse amount to wei
  const requiredAmount = parseUnits(amount, decimals);
  
  // Check current allowance
  const currentAllowance = await getAllowance(tokenAddress, ownerAddress, routerAddress, network);
  
  logger.debug('Swap approval check', {
    tokenAddress,
    ownerAddress,
    routerAddress,
    requiredAmount: requiredAmount.toString(),
    currentAllowance: currentAllowance.toString(),
    needsApproval: currentAllowance < requiredAmount,
  });
  
  return {
    needsApproval: currentAllowance < requiredAmount,
    currentAllowance,
    requiredAmount,
    routerAddress,
  };
}

/**
 * Build an approval transaction for the PancakeSwap router
 * Uses max uint256 for unlimited approval (common for DEX routers)
 */
export async function buildSwapApproval(
  from: string,
  tokenAddress: string,
  network: NetworkType
): Promise<PreparedTx> {
  logger.web3Tx('buildSwapApproval', { from, tokenAddress, network });

  const { PANCAKE_ROUTER } = await import('@/lib/utils/constants');
  const routerAddress = PANCAKE_ROUTER[network];
  
  // Use max uint256 for unlimited approval (standard for DEX routers)
  // This is already in wei, so we pass it directly to the encoder as a BigInt
  const maxApproval = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');
  
  // Encode approve call directly (bypassing parseUnits since maxApproval is already in wei)
  const iface = new Interface(ERC20_ABI);
  const data = iface.encodeFunctionData('approve', [routerAddress, maxApproval]);

  // Estimate gas
  const gasEstimate = await estimateGas(
    { from, to: tokenAddress, data },
    network
  );

  const feeData = await getFeeData(network);

  return {
    to: tokenAddress,
    data,
    value: '0',
    gasLimit: (gasEstimate * BigInt(120) / BigInt(100)).toString(),
    gasPrice: feeData.gasPrice.toString(),
  };
}

/**
 * Build a token approval transaction for the BatchExecutor contract
 * This is a one-time approval that enables gas-sponsored swaps
 */
export async function buildBatchExecutorApproval(
  from: string,
  tokenAddress: string,
  network: NetworkType
): Promise<PreparedTx> {
  logger.web3Tx('buildBatchExecutorApproval', { from, tokenAddress, network });

  const { Q402_CONTRACTS } = await import('@/lib/utils/constants');
  const batchExecutorAddress = Q402_CONTRACTS[network].batchExecutor;
  
  if (!batchExecutorAddress) {
    throw new Web3Error('BatchExecutor contract not deployed on this network');
  }
  
  // Use max uint256 for unlimited approval (enables gas-free swaps forever)
  const maxApproval = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');
  
  // Encode approve call
  const iface = new Interface(ERC20_ABI);
  const data = iface.encodeFunctionData('approve', [batchExecutorAddress, maxApproval]);

  // Estimate gas
  const gasEstimate = await estimateGas(
    { from, to: tokenAddress, data },
    network
  );

  const feeData = await getFeeData(network);

  return {
    to: tokenAddress,
    data,
    value: '0',
    gasLimit: (gasEstimate * BigInt(120) / BigInt(100)).toString(),
    gasPrice: feeData.gasPrice.toString(),
  };
}

/**
 * Create a transaction preview for UI display
 */
export async function createTransactionPreview(
  type: TransactionType,
  preparedTx: PreparedTx,
  params: {
    from: string;
    network: NetworkType;
    recipient?: string; // The actual recipient for transfers (different from preparedTx.to for token transfers)
    tokenSymbol?: string;
    tokenAddress?: string;
    amount?: string;
    tokenInAddress?: string | null;
    tokenOutAddress?: string | null;
    tokenInSymbol?: string;
    tokenOutSymbol?: string;
    tokenOutAmount?: string;
    slippageBps?: number;
    methodName?: string;
    methodArgs?: unknown[];
  }
): Promise<TransactionPreview> {
  const gasEstimate = await estimateTransactionGas(preparedTx, params.network);

  // For token transfers, preparedTx.to is the token contract, not the actual recipient
  // Use params.recipient for the display "to" address when provided
  const displayTo = params.recipient || preparedTx.to;

  const preview: TransactionPreview = {
    type,
    network: params.network,
    from: params.from,
    to: displayTo,
    contractAddress: preparedTx.to,
    recipient: params.recipient,
    preparedTx,
    estimatedGas: gasEstimate.gasLimit.toString(),
    estimatedGasPrice: gasEstimate.gasPrice.toString(),
    estimatedFee: gasEstimate.estimatedFee.toString(),
  };

  // Add type-specific fields
  if (type === 'transfer' || type === 'token_transfer') {
    preview.nativeValue = preparedTx.value !== '0' ? preparedTx.value : undefined;
    preview.tokenAmount = params.amount;
    preview.tokenSymbol = params.tokenSymbol;
    preview.tokenAddress = params.tokenAddress;
  }

  if (type === 'swap') {
    preview.tokenInSymbol = params.tokenInSymbol;
    preview.tokenInAmount = params.amount;
    preview.tokenOutSymbol = params.tokenOutSymbol;
    preview.tokenOutAmount = params.tokenOutAmount;
    preview.tokenInAddress = params.tokenInAddress ?? null;
    preview.tokenOutAddress = params.tokenOutAddress ?? null;
    preview.slippageBps = params.slippageBps;
  }

  if (type === 'contract_call') {
    preview.methodName = params.methodName;
    preview.methodArgs = params.methodArgs;
  }

  return preview;
}

