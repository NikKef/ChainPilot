import { JsonRpcProvider, Network } from 'ethers';
import { NETWORKS, type NetworkType } from '@/lib/utils/constants';
import { logger } from '@/lib/utils';

// Provider cache
const providers: Map<NetworkType, JsonRpcProvider> = new Map();

/**
 * Get a JSON-RPC provider for the specified network
 */
export function getProvider(network: NetworkType): JsonRpcProvider {
  // Check cache
  const cached = providers.get(network);
  if (cached) {
    return cached;
  }

  const config = NETWORKS[network];
  
  // Create provider with proper network configuration
  const networkConfig = new Network(config.name, config.chainId);
  const provider = new JsonRpcProvider(config.rpcUrl, networkConfig, {
    staticNetwork: networkConfig,
    batchMaxCount: 10,
  });

  // Cache the provider
  providers.set(network, provider);
  
  logger.debug('Created Web3 provider', { network, rpcUrl: config.rpcUrl });

  return provider;
}

/**
 * Get the current block number
 */
export async function getBlockNumber(network: NetworkType): Promise<number> {
  const provider = getProvider(network);
  return provider.getBlockNumber();
}

/**
 * Get the current gas price
 */
export async function getGasPrice(network: NetworkType): Promise<bigint> {
  const provider = getProvider(network);
  const feeData = await provider.getFeeData();
  return feeData.gasPrice || 5000000000n; // Default 5 Gwei
}

/**
 * Get fee data including EIP-1559 fields
 */
export async function getFeeData(network: NetworkType): Promise<{
  gasPrice: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}> {
  const provider = getProvider(network);
  const feeData = await provider.getFeeData();
  
  return {
    gasPrice: feeData.gasPrice || 5000000000n,
    maxFeePerGas: feeData.maxFeePerGas || undefined,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
  };
}

/**
 * Get native balance for an address
 */
export async function getNativeBalance(
  address: string,
  network: NetworkType
): Promise<bigint> {
  const provider = getProvider(network);
  return provider.getBalance(address);
}

/**
 * Get transaction by hash
 */
export async function getTransaction(
  txHash: string,
  network: NetworkType
) {
  const provider = getProvider(network);
  return provider.getTransaction(txHash);
}

/**
 * Get transaction receipt
 */
export async function getTransactionReceipt(
  txHash: string,
  network: NetworkType
) {
  const provider = getProvider(network);
  return provider.getTransactionReceipt(txHash);
}

/**
 * Wait for transaction confirmation
 */
export async function waitForTransaction(
  txHash: string,
  network: NetworkType,
  confirmations = 1
) {
  const provider = getProvider(network);
  const tx = await provider.getTransaction(txHash);
  if (!tx) {
    throw new Error(`Transaction ${txHash} not found`);
  }
  return tx.wait(confirmations);
}

/**
 * Check if an address is a contract
 */
export async function isContract(
  address: string,
  network: NetworkType
): Promise<boolean> {
  const provider = getProvider(network);
  const code = await provider.getCode(address);
  return code !== '0x';
}

/**
 * Get contract code
 */
export async function getContractCode(
  address: string,
  network: NetworkType
): Promise<string> {
  const provider = getProvider(network);
  return provider.getCode(address);
}

/**
 * Estimate gas for a transaction
 */
export async function estimateGas(
  tx: {
    to?: string;
    from?: string;
    data?: string;
    value?: bigint;
  },
  network: NetworkType
): Promise<bigint> {
  const provider = getProvider(network);
  return provider.estimateGas(tx);
}

/**
 * Get network configuration
 */
export function getNetworkConfig(network: NetworkType) {
  return NETWORKS[network];
}

/**
 * Get explorer URL for a transaction
 */
export function getExplorerTxUrl(txHash: string, network: NetworkType): string {
  return `${NETWORKS[network].explorerUrl}/tx/${txHash}`;
}

/**
 * Get explorer URL for an address
 */
export function getExplorerAddressUrl(address: string, network: NetworkType): string {
  return `${NETWORKS[network].explorerUrl}/address/${address}`;
}

/**
 * Clear provider cache (useful for testing)
 */
export function clearProviderCache(): void {
  providers.clear();
}

