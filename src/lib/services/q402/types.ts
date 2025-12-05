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
