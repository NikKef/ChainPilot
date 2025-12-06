/**
 * Q402 Facilitator Service Types
 * 
 * The facilitator is responsible for:
 * 1. Verifying EIP-712 witness signatures
 * 2. Submitting transactions on-chain with gas sponsorship
 * 3. Enforcing budget limits to prevent gas drain
 * 
 * @see https://github.com/quackai-labs/Q402
 */

import type { Q402Witness, Q402Network } from '../q402/types';

// =============================================================================
// Facilitator Configuration
// =============================================================================

/**
 * Facilitator service configuration
 */
export interface FacilitatorConfig {
  // Network settings
  network: Q402Network;
  chainId: number;
  rpcUrl: string;
  
  // Sponsor wallet (pays gas fees)
  sponsorPrivateKey: string;
  sponsorAddress: string;
  
  // Contract addresses
  implementationContract: string;
  verifyingContract: string;
  
  // Security settings
  implementationWhitelist: string[];
  maxGasPriceGwei: number;
  maxGasLimit: number;
  
  // Budget limits
  dailyGasBudgetWei: string;
  perTransactionMaxGasWei: string;
  
  // Rate limiting
  maxRequestsPerMinute: number;
  maxRequestsPerAddress: number;
}

/**
 * Supported network configuration
 */
export interface NetworkConfig {
  network: Q402Network;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  implementationContract: string;
  verifyingContract: string;
  tokens: SupportedToken[];
}

/**
 * Supported token for payments
 */
export interface SupportedToken {
  address: string;
  symbol: string;
  decimals: number;
  name: string;
  minAmount?: string;
  maxAmount?: string;
}

// =============================================================================
// Verification Types
// =============================================================================

/**
 * Verification request from client
 */
export interface VerifyRequest {
  networkId: Q402Network;
  witness: Q402Witness;
  signature: string;
  signerAddress: string;
}

/**
 * Verification response
 */
export interface VerifyResponse {
  valid: boolean;
  error?: string;
  payer?: string;
  amount?: string;
  token?: string;
  nonce?: number;
  deadline?: number;
  recovered?: string; // Recovered address from signature
}

// =============================================================================
// Settlement Types
// =============================================================================

/**
 * Settlement request from client
 */
export interface SettleRequest {
  networkId: Q402Network;
  requestId: string;
  witness: Q402Witness;
  signature: string;
  signerAddress: string;
  transaction?: {
    to: string;
    data: string;
    value: string;
  };
}

/**
 * Settlement response
 */
export interface SettleResponse {
  success: boolean;
  txHash?: string;
  blockNumber?: number;
  gasUsed?: string;
  gasPrice?: string;
  effectiveGasPrice?: string;
  error?: string;
  receipt?: TransactionReceipt;
}

/**
 * Transaction receipt from settlement
 */
export interface TransactionReceipt {
  transactionHash: string;
  blockNumber: number;
  blockHash: string;
  gasUsed: string;
  effectiveGasPrice: string;
  status: 'success' | 'failed';
  logs: TransactionLog[];
}

/**
 * Transaction log entry
 */
export interface TransactionLog {
  address: string;
  topics: string[];
  data: string;
}

// =============================================================================
// Budget & Rate Limiting Types
// =============================================================================

/**
 * Budget tracking record
 */
export interface BudgetRecord {
  date: string; // YYYY-MM-DD
  totalGasUsedWei: string;
  transactionCount: number;
  addresses: Map<string, AddressBudget>;
}

/**
 * Per-address budget tracking
 */
export interface AddressBudget {
  address: string;
  gasUsedWei: string;
  transactionCount: number;
  lastRequestTime: number;
  requestsThisMinute: number;
}

/**
 * Budget check result
 */
export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  remainingDailyBudget?: string;
  addressTransactionsToday?: number;
}

// =============================================================================
// Nonce Management Types
// =============================================================================

/**
 * Nonce tracker for preventing replay attacks
 */
export interface NonceRecord {
  address: string;
  currentNonce: number;
  usedNonces: Set<number>;
  lastUpdated: number;
}

/**
 * Nonce validation result
 */
export interface NonceValidation {
  valid: boolean;
  currentNonce: number;
  error?: string;
}

// =============================================================================
// Health & Status Types
// =============================================================================

/**
 * Facilitator health status
 */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: HealthCheck[];
}

/**
 * Individual health check
 */
export interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  latency?: number;
}

/**
 * Facilitator statistics
 */
export interface FacilitatorStats {
  totalTransactions: number;
  totalGasSponsored: string;
  successRate: number;
  averageGasPerTx: string;
  uniqueAddresses: number;
  lastTransactionTime?: string;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Facilitator error codes
 */
export enum FacilitatorErrorCode {
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  INVALID_NONCE = 'INVALID_NONCE',
  EXPIRED_DEADLINE = 'EXPIRED_DEADLINE',
  BUDGET_EXCEEDED = 'BUDGET_EXCEEDED',
  RATE_LIMITED = 'RATE_LIMITED',
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  INVALID_IMPLEMENTATION = 'INVALID_IMPLEMENTATION',
  UNAUTHORIZED = 'UNAUTHORIZED',
}

/**
 * Facilitator error
 */
export interface FacilitatorError {
  code: FacilitatorErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// =============================================================================
// Contract Interface Types (for on-chain calls)
// =============================================================================

/**
 * Execute transfer parameters (matches contract interface)
 */
export interface ExecuteTransferParams {
  owner: string;
  facilitator: string;
  token: string;
  recipient: string;
  amount: string;
  nonce: number;
  deadline: number;
  signature: string;
}

/**
 * Q402 Implementation contract ABI
 */
export const Q402_IMPLEMENTATION_ABI = [
  'function executeTransfer(address owner, address facilitator, address token, address recipient, uint256 amount, uint256 nonce, uint256 deadline, bytes calldata signature) external',
  'function getNonce(address owner) view returns (uint256)',
  'function usedNonces(address owner, uint256 nonce) view returns (bool)',
  'event PaymentExecuted(address indexed owner, address indexed token, address indexed recipient, uint256 amount, bytes32 paymentId, uint256 nonce)',
] as const;

/**
 * Q402 Vault contract ABI for deposits/withdrawals
 */
export const Q402_VAULT_ABI = [
  'function deposit() external payable',
  'function withdraw(uint256 amount) external',
  'function withdrawAll() external',
  'function getBalance(address account) external view returns (uint256)',
  'event Deposited(address indexed account, uint256 amount)',
  'event Withdrawn(address indexed account, uint256 amount)',
] as const;

/**
 * EIP-712 domain for witness verification
 */
export interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

/**
 * EIP-712 Witness type definition
 */
export const WITNESS_TYPES = {
  Witness: [
    { name: 'owner', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'to', type: 'address' },
    { name: 'deadline', type: 'uint256' },
    { name: 'paymentId', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

