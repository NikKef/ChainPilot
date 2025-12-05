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
    gasLimit: (gasEstimate * 120n / 100n).toString(), // 20% buffer
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
    gasLimit: (gasEstimate * 120n / 100n).toString(),
    gasPrice: feeData.gasPrice.toString(),
  };
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
    gasLimit: (gasEstimate * 120n / 100n).toString(),
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
  const valueWei = value === '0' ? 0n : parseUnits(value, 18);

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
    gasLimit: (gasEstimate * 150n / 100n).toString(), // 50% buffer for complex calls
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
    gasLimit: (gasEstimate * 130n / 100n).toString(), // 30% buffer
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

  const [name, symbol, decimals] = await Promise.all([
    contract.name(),
    contract.symbol(),
    contract.decimals(),
  ]);

  return {
    address: tokenAddress,
    name,
    symbol,
    decimals: Number(decimals),
  };
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
 * Create a transaction preview for UI display
 */
export async function createTransactionPreview(
  type: TransactionType,
  preparedTx: PreparedTx,
  params: {
    from: string;
    network: NetworkType;
    tokenSymbol?: string;
    tokenAddress?: string;
    amount?: string;
    tokenInSymbol?: string;
    tokenOutSymbol?: string;
    tokenOutAmount?: string;
    slippageBps?: number;
    methodName?: string;
    methodArgs?: unknown[];
  }
): Promise<TransactionPreview> {
  const gasEstimate = await estimateTransactionGas(preparedTx, params.network);

  const preview: TransactionPreview = {
    type,
    network: params.network,
    from: params.from,
    to: preparedTx.to,
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
    preview.slippageBps = params.slippageBps;
  }

  if (type === 'contract_call') {
    preview.methodName = params.methodName;
    preview.methodArgs = params.methodArgs;
  }

  return preview;
}

