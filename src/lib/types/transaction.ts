import type { NetworkType } from '../utils/constants';
import type { Intent } from './intent';

/**
 * Prepared transaction ready for execution
 */
export interface PreparedTx {
  to: string;
  data: string;
  value: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: number;
  chainId?: number;
}

/**
 * Transaction type
 */
export type TransactionType = 
  | 'transfer'
  | 'token_transfer'
  | 'swap'
  | 'contract_call'
  | 'deploy';

/**
 * Transaction preview for UI display
 */
export interface TransactionPreview {
  type: TransactionType;
  network: NetworkType;
  from: string;
  to: string;
  contractAddress?: string; // On-chain target (token/router/contract)
  recipient?: string; // Human recipient when different from contractAddress
  
  // Value info
  nativeValue?: string;
  nativeValueFormatted?: string;
  tokenAmount?: string;
  tokenAmountFormatted?: string;
  tokenSymbol?: string;
  tokenAddress?: string;
  tokenInAddress?: string | null;
  tokenOutAddress?: string | null;
  
  // For swaps
  tokenInSymbol?: string;
  tokenInAmount?: string;
  tokenOutSymbol?: string;
  tokenOutAmount?: string;
  tokenOutAmountMin?: string;
  slippageBps?: number;
  priceImpact?: number;
  
  // For contract calls
  methodName?: string;
  methodArgs?: unknown[];
  
  // Gas estimates
  estimatedGas?: string;
  estimatedGasPrice?: string;
  estimatedFee?: string;
  estimatedFeeUsd?: string;
  
  // USD values
  valueUsd?: string;
  
  // Prepared transaction
  preparedTx: PreparedTx;
}

/**
 * Transaction execution result
 */
export interface TransactionResult {
  success: boolean;
  txHash?: string;
  blockNumber?: number;
  gasUsed?: string;
  error?: string;
  q402RequestId?: string;
}

/**
 * Action log entry
 */
export interface ActionLog {
  id: string;
  sessionId: string;
  intentType: Intent['type'];
  network: NetworkType;
  userMessage?: string;
  parsedIntent?: Intent;
  preparedTx?: PreparedTx;
  policyDecision?: PolicyDecision;
  estimatedValueUsd?: number;
  txHash?: string;
  q402RequestId?: string;
  status: ActionStatus;
  errorMessage?: string;
  createdAt: string;
  executedAt?: string;
}

/**
 * Action status
 */
export type ActionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'failed'
  | 'cancelled';

/**
 * Policy decision for a transaction
 */
export interface PolicyDecision {
  allowed: boolean;
  riskLevel: RiskLevel;
  reasons: string[];
  warnings?: string[];
}

/**
 * Risk level
 */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';

/**
 * Q402 transaction status
 */
export interface Q402Transaction {
  id: string;
  actionLogId?: string;
  q402RequestId: string;
  status: Q402Status;
  txHash?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export type Q402Status =
  | 'pending'
  | 'signed'
  | 'executing'
  | 'completed'
  | 'failed';

/**
 * Token balance info
 */
export interface TokenBalance {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  balanceFormatted: string;
  priceUsd?: number;
  valueUsd?: number;
  logoUrl?: string;
}

/**
 * Portfolio data
 */
export interface Portfolio {
  address: string;
  network: NetworkType;
  nativeBalance: string;
  nativeBalanceFormatted: string;
  nativeValueUsd?: number;
  tokens: TokenBalance[];
  totalValueUsd?: number;
  updatedAt: string;
}

/**
 * Gas estimation result
 */
export interface GasEstimate {
  gasLimit: bigint;
  gasPrice: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  estimatedFee: bigint;
  estimatedFeeFormatted: string;
}

/**
 * Swap quote from DEX
 */
export interface SwapQuote {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  amountOutMin: string;
  path: string[];
  priceImpact: number;
  executionPrice: string;
  deadline: number;
}

