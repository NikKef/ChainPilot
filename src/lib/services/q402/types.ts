import type { PreparedTx } from '@/lib/types';

// =============================================================================
// Q402 Protocol Types (Based on https://github.com/quackai-labs/Q402)
// =============================================================================

/**
 * Supported networks for Q402
 */
export type Q402Network = 'bsc-mainnet' | 'bsc-testnet';

/**
 * EIP-712 Domain for Q402 witness signatures
 */
export interface Q402Domain {
  name: 'q402';
  version: '1';
  chainId: number;
  verifyingContract: string; // Q402 verifying contract address
}

/**
 * EIP-712 Witness - The typed data structure the user signs
 * This authorizes a specific payment without giving unlimited approval
 */
export interface Q402Witness {
  owner: string;           // User's wallet address
  token: string;           // ERC20 token address
  amount: string;          // Amount in wei
  to: string;              // Recipient (server's settlement wallet)
  deadline: number;        // Unix timestamp after which signature is invalid
  paymentId: string;       // Unique identifier for this payment (bytes32)
  nonce: number;           // Prevents replay attacks
}

/**
 * EIP-7702 Authorization Tuple
 * Allows user's EOA to execute code from implementation contract
 */
export interface Q402Authorization {
  chainId: number;
  address: string;         // Implementation contract address
  nonce: number;           // User's account nonce
  yParity: number;         // Signature v value parity
  r: string;               // Signature r value
  s: string;               // Signature s value
}

/**
 * Complete payment header sent with HTTP request
 * Encoded as Base64 JSON in X-PAYMENT header
 */
export interface Q402PaymentHeader {
  scheme: 'evm/eip7702-delegated-payment';
  networkId: Q402Network;
  witness: Q402Witness;
  witnessSignature: string;       // EIP-712 signature of witness
  authorization?: Q402Authorization; // EIP-7702 auth (optional if already delegated)
}

/**
 * Payment details returned by server in 402 response
 */
export interface Q402PaymentDetails {
  scheme: 'evm/eip7702-delegated-payment';
  networkId: Q402Network;
  token: string;                   // Token address for payment
  amount: string;                  // Amount in token's smallest unit
  to: string;                      // Server's settlement wallet
  implementationContract: string;  // Q402 implementation contract
  verifyingContract: string;       // EIP-712 verifying contract
  description?: string;            // Human-readable description
}

/**
 * Q402 payment request
 */
export interface Q402PaymentRequest {
  id: string;
  chainId: number;
  transaction: PreparedTx;
  metadata: {
    action: string;
    description: string;
    valueUsd?: number;
  };
  policy?: {
    maxGasPrice?: string;
    deadline?: number;
  };
  paymentDetails?: Q402PaymentDetails;
  /** The witness that was used for signing - must be reused for verification */
  witness?: Q402Witness;
  createdAt: string;
  expiresAt: string;
}

/**
 * Q402 execution request sent to facilitator
 */
export interface Q402ExecutionRequest {
  requestId: string;
  signature: string;          // EIP-712 witness signature
  signerAddress: string;      // User's address
  authorization?: Q402Authorization;
}

/**
 * Q402 execution result from facilitator
 */
export interface Q402ExecutionResult {
  success: boolean;
  requestId: string;
  txHash?: string;
  blockNumber?: number;
  gasUsed?: string;
  error?: string;
  status: Q402TransactionStatusType;
}

/**
 * Q402 transaction status types
 */
export type Q402TransactionStatusType = 
  | 'pending' 
  | 'signed' 
  | 'executing' 
  | 'completed' 
  | 'failed';

/**
 * Q402 transaction status
 */
export interface Q402TransactionStatus {
  requestId: string;
  status: Q402TransactionStatusType;
  txHash?: string;
  blockNumber?: number;
  gasUsed?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Q402 facilitator configuration
 */
export interface Q402FacilitatorConfig {
  apiUrl: string;
  apiKey?: string;
  chainId: number;
  network: Q402Network;
  implementationContract: string;
  verifyingContract: string;
  recipientAddress: string;
  gasPolicy?: {
    maxGasPriceGwei?: number;
    maxGasLimit?: number;
    sponsorGas?: boolean;
  };
}

/**
 * Q402 signed message format for wallet signing
 */
export interface Q402SignedMessage {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  types: {
    Witness: Array<{
      name: string;
      type: string;
    }>;
  };
  primaryType: 'Witness';
  message: Q402Witness;
}

/**
 * Q402 batch request for multiple transactions
 */
export interface Q402BatchRequest {
  id: string;
  chainId: number;
  transactions: PreparedTx[];
  witnesses: Q402Witness[];
  metadata: {
    action: string;
    description: string;
    totalValueUsd?: number;
  };
  policy?: {
    maxGasPrice?: string;
    deadline?: number;
    atomicExecution?: boolean;
  };
}

/**
 * Q402 batch execution result
 */
export interface Q402BatchResult {
  success: boolean;
  batchId: string;
  results: Array<{
    index: number;
    txHash?: string;
    success: boolean;
    error?: string;
  }>;
  totalGasUsed?: string;
}

// =============================================================================
// Q402 Batch Executor Types (Gas-sponsored batch operations)
// =============================================================================

/**
 * Operation types for batch execution
 */
export type BatchOperationType = 'transfer' | 'swap' | 'call';

/**
 * Numeric operation type codes (matching smart contract)
 */
export const BATCH_OP_CODES = {
  TRANSFER: 0,
  SWAP: 1,
  CALL: 2,
} as const;

/**
 * A single operation in a batch
 * Maps to the Operation struct in Q402BatchExecutor.sol
 */
export interface BatchOperation {
  /** Operation type: 'transfer', 'swap', or 'call' */
  type: BatchOperationType;
  /** Input token address (use zero address for native BNB) */
  tokenIn: string;
  /** Input amount in wei */
  amountIn: string;
  /** Output token address (for swaps, zero address for native BNB) */
  tokenOut: string;
  /** Minimum output amount (for slippage protection in swaps) */
  minAmountOut: string;
  /** Target address (recipient for transfers, router for swaps, contract for calls) */
  target: string;
  /** Calldata for swaps and calls (empty '0x' for transfers) */
  data: string;
  
  // Additional metadata for display/tracking (not sent to contract)
  /** Human-readable description */
  description?: string;
  /** Token symbol for tokenIn */
  tokenInSymbol?: string;
  /** Token symbol for tokenOut */
  tokenOutSymbol?: string;
  /** Formatted input amount (e.g., "10.5") */
  formattedAmountIn?: string;
  /** Formatted output amount (e.g., "0.025") */
  formattedAmountOut?: string;
  /** Slippage (bps) used when building the swap operation */
  slippageBps?: number;
}

/**
 * Batch witness structure that the user signs
 * Maps to the BatchWitness struct in Q402BatchExecutor.sol
 */
export interface BatchWitness {
  /** User's wallet address */
  owner: string;
  /** Keccak256 hash of encoded operations array */
  operationsHash: string;
  /** Unix timestamp after which signature is invalid */
  deadline: number;
  /** Unique identifier for this batch (bytes32) */
  batchId: string;
  /** User's current nonce from the contract */
  nonce: number;
}

/**
 * EIP-712 Domain for BatchExecutor signatures
 */
export interface BatchExecutorDomain {
  name: 'q402-batch';
  version: '1';
  chainId: number;
  verifyingContract: string;
}

/**
 * Complete batch payment request
 */
export interface BatchPaymentRequest {
  /** Unique request ID */
  id: string;
  /** Chain ID */
  chainId: number;
  /** Array of operations to execute */
  operations: BatchOperation[];
  /** The witness structure to be signed */
  witness: BatchWitness;
  /** Request metadata */
  metadata: {
    action: string;
    description: string;
    totalValueUsd?: number;
    operationCount: number;
  };
  /** Policy constraints */
  policy?: {
    maxGasPrice?: string;
    deadline?: number;
    atomicExecution?: boolean;
  };
  /** Creation timestamp */
  createdAt: string;
  /** Expiration timestamp */
  expiresAt: string;
}

/**
 * Typed data for signing a batch (EIP-712 format)
 */
export interface BatchSignedMessage {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  types: {
    BatchWitness: Array<{ name: string; type: string }>;
  };
  primaryType: 'BatchWitness';
  message: BatchWitness;
}

/**
 * Batch execution request sent to facilitator
 */
export interface BatchExecutionRequest {
  /** Request/batch ID */
  requestId: string;
  /** The witness that was signed */
  witness: BatchWitness;
  /** Array of operations */
  operations: BatchOperation[];
  /** EIP-712 signature */
  signature: string;
  /** Signer's address */
  signerAddress: string;
}

/**
 * Result of batch execution
 */
export interface BatchExecutionResult {
  success: boolean;
  batchId: string;
  txHash?: string;
  blockNumber?: number;
  gasUsed?: string;
  /** Individual operation results */
  operationResults?: Array<{
    index: number;
    success: boolean;
    amountOut?: string;
    error?: string;
  }>;
  error?: string;
}

/**
 * Check if user needs to approve BatchExecutor for a token
 */
export interface BatchApprovalCheck {
  needsApproval: boolean;
  tokenAddress: string;
  tokenSymbol?: string;
  currentAllowance: bigint;
  requiredAmount: bigint;
  batchExecutorAddress: string;
}

/**
 * Pending batch info stored when approval is needed
 */
export interface PendingBatchInfo {
  /** Approval request ID */
  approvalRequestId: string;
  /** Session ID */
  sessionId: string;
  /** Network */
  network: string;
  /** User's wallet address */
  walletAddress: string;
  /** Operations in the pending batch */
  operations: BatchOperation[];
  /** Created timestamp */
  createdAt: string;
  /** Expiration timestamp */
  expiresAt: string;
}

/**
 * Facilitator API response types
 */
export interface FacilitatorVerifyResponse {
  valid: boolean;
  error?: string;
  payer?: string;
  amount?: string;
  token?: string;
}

export interface FacilitatorSettleResponse {
  success: boolean;
  txHash?: string;
  error?: string;
  gasUsed?: string;
}

export interface FacilitatorSupportedResponse {
  networks: Q402Network[];
  tokens: Array<{
    address: string;
    symbol: string;
    decimals: number;
    network: Q402Network;
  }>;
}

/**
 * Contract function signatures for Q402 implementation
 */
export const Q402_CONTRACT_ABI = [
  'function executeTransfer(address owner, address facilitator, address token, address recipient, uint256 amount, uint256 nonce, uint256 deadline, bytes calldata signature) external',
  'function getNonce(address owner) view returns (uint256)',
  'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)',
  'event PaymentExecuted(address indexed owner, address indexed token, address indexed recipient, uint256 amount, bytes32 paymentId)',
] as const;

/**
 * EIP-712 type definitions for Witness
 */
export const Q402_WITNESS_TYPES: { Witness: Array<{ name: string; type: string }> } = {
  Witness: [
    { name: 'owner', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'to', type: 'address' },
    { name: 'deadline', type: 'uint256' },
    { name: 'paymentId', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
  ],
};

/**
 * EIP-712 type definitions for BatchWitness
 */
export const BATCH_WITNESS_TYPES = {
  BatchWitness: [
    { name: 'owner', type: 'address' },
    { name: 'operationsHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
    { name: 'batchId', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

/**
 * EIP-712 type definitions for Operation (used to compute operationsHash)
 */
export const OPERATION_TYPES = {
  Operation: [
    { name: 'opType', type: 'uint8' },
    { name: 'tokenIn', type: 'address' },
    { name: 'amountIn', type: 'uint256' },
    { name: 'tokenOut', type: 'address' },
    { name: 'minAmountOut', type: 'uint256' },
    { name: 'target', type: 'address' },
    { name: 'data', type: 'bytes' },
  ],
} as const;
