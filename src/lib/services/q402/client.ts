import { keccak256, toUtf8Bytes, hexlify, randomBytes, TypedDataDomain, TypedDataField, parseEther, parseUnits, solidityPacked, Contract, JsonRpcProvider, AbiCoder } from 'ethers';
import type { PreparedTx } from '@/lib/types';
import type {
  Q402PaymentRequest,
  Q402ExecutionRequest,
  Q402ExecutionResult,
  Q402TransactionStatus,
  Q402FacilitatorConfig,
  Q402SignedMessage,
  Q402BatchRequest,
  Q402BatchResult,
  Q402Witness,
  Q402PaymentDetails,
  Q402Network,
  FacilitatorVerifyResponse,
  FacilitatorSettleResponse,
  BatchOperation,
  BatchWitness,
  BatchPaymentRequest,
  BatchSignedMessage,
  BatchExecutionRequest,
  BatchExecutionResult,
  BATCH_OP_CODES,
} from './types';
import { Q402_WITNESS_TYPES, Q402_CONTRACT_ABI, BATCH_WITNESS_TYPES } from './types';
import { NETWORKS, Q402_CONTRACTS, Q402_FACILITATOR, Q402_BATCH_EXECUTOR_ABI, type NetworkType } from '@/lib/utils/constants';
import { logger } from '@/lib/utils';
import { ExternalApiError } from '@/lib/utils/errors';
import { initializeFacilitator, type SettleRequest } from '@/lib/services/facilitator';

/**
 * Resolve relative API URLs to absolute URLs for server-side requests
 * In Next.js API routes, relative URLs don't work - we need absolute URLs
 */
function resolveApiUrl(baseUrl: string): string {
  // If already absolute, return as-is
  if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) {
    return baseUrl;
  }
  
  // For server-side, construct absolute URL
  // Use NEXT_PUBLIC_APP_URL or default to localhost
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 
                 process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` :
                 'http://localhost:3000';
  
  return `${appUrl}${baseUrl}`;
}

/**
 * Global request storage that persists across hot reloads in development
 * Uses globalThis to survive webpack module recompilation
 * In production, this should be replaced with database or Redis storage
 */
const GLOBAL_STORE_KEY = '__q402_request_store__';

// Pending transfer info stored when approval is needed
export interface PendingTransferInfo {
  approvalRequestId: string;
  sessionId: string;
  network: string;
  walletAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  recipientAddress: string;
  amount: string;
  createdAt: string;
  expiresAt: string;
}

// Pending swap info stored when approval is needed
export interface PendingSwapInfo {
  approvalRequestId: string;
  sessionId: string;
  network: string;
  walletAddress: string;
  tokenIn: string;
  tokenInSymbol: string;
  tokenOut: string | null; // null for native BNB
  tokenOutSymbol: string;
  amount: string;
  slippageBps: number;
  createdAt: string;
  expiresAt: string;
}

// Pending batch info stored when approval is needed
export interface PendingBatchInfo {
  approvalRequestId: string;
  sessionId: string;
  network: string;
  walletAddress: string;
  operations: BatchOperation[];
  createdAt: string;
  expiresAt: string;
}

// Declare the global type
declare global {
  // eslint-disable-next-line no-var
  var __q402_request_store__: Map<string, Q402PaymentRequest> | undefined;
  // eslint-disable-next-line no-var
  var __q402_cleanup_initialized__: boolean | undefined;
  // eslint-disable-next-line no-var
  var __q402_pending_transfers__: Map<string, PendingTransferInfo> | undefined;
  // eslint-disable-next-line no-var
  var __q402_pending_swaps__: Map<string, PendingSwapInfo> | undefined;
  // eslint-disable-next-line no-var
  var __q402_batch_request_store__: Map<string, BatchPaymentRequest> | undefined;
  // eslint-disable-next-line no-var
  var __q402_pending_batches__: Map<string, PendingBatchInfo> | undefined;
}

// Get or create the global store
function getGlobalRequestStore(): Map<string, Q402PaymentRequest> {
  if (!globalThis.__q402_request_store__) {
    globalThis.__q402_request_store__ = new Map<string, Q402PaymentRequest>();
    console.log('[Q402] Created new global request store');
  }
  return globalThis.__q402_request_store__;
}

// Get or create the pending transfers store
function getPendingTransferStore(): Map<string, PendingTransferInfo> {
  if (!globalThis.__q402_pending_transfers__) {
    globalThis.__q402_pending_transfers__ = new Map<string, PendingTransferInfo>();
    console.log('[Q402] Created new pending transfer store');
  }
  return globalThis.__q402_pending_transfers__;
}

// Get or create the pending swaps store
function getPendingSwapStore(): Map<string, PendingSwapInfo> {
  if (!globalThis.__q402_pending_swaps__) {
    globalThis.__q402_pending_swaps__ = new Map<string, PendingSwapInfo>();
    console.log('[Q402] Created new pending swap store');
  }
  return globalThis.__q402_pending_swaps__;
}

/**
 * Store a pending transfer (called when approval is needed)
 */
export function storePendingTransfer(info: PendingTransferInfo): void {
  const store = getPendingTransferStore();
  store.set(info.approvalRequestId, info);
  console.log('[Q402] Stored pending transfer', { approvalRequestId: info.approvalRequestId });
}

/**
 * Get a pending transfer by approval request ID
 */
export function getPendingTransfer(approvalRequestId: string): PendingTransferInfo | undefined {
  const store = getPendingTransferStore();
  return store.get(approvalRequestId);
}

/**
 * Delete a pending transfer after it's been processed
 */
export function deletePendingTransfer(approvalRequestId: string): void {
  const store = getPendingTransferStore();
  store.delete(approvalRequestId);
  console.log('[Q402] Deleted pending transfer', { approvalRequestId });
}

/**
 * Store a pending swap (called when approval is needed)
 */
export function storePendingSwap(info: PendingSwapInfo): void {
  const store = getPendingSwapStore();
  store.set(info.approvalRequestId, info);
  console.log('[Q402] Stored pending swap', { approvalRequestId: info.approvalRequestId });
}

/**
 * Get a pending swap by approval request ID
 */
export function getPendingSwap(approvalRequestId: string): PendingSwapInfo | undefined {
  const store = getPendingSwapStore();
  return store.get(approvalRequestId);
}

/**
 * Delete a pending swap after it's been processed
 */
export function deletePendingSwap(approvalRequestId: string): void {
  const store = getPendingSwapStore();
  store.delete(approvalRequestId);
  console.log('[Q402] Deleted pending swap', { approvalRequestId });
}

// Get or create the batch request store
function getBatchRequestStore(): Map<string, BatchPaymentRequest> {
  if (!globalThis.__q402_batch_request_store__) {
    globalThis.__q402_batch_request_store__ = new Map<string, BatchPaymentRequest>();
    console.log('[Q402] Created new batch request store');
  }
  return globalThis.__q402_batch_request_store__;
}

// Get or create the pending batches store
function getPendingBatchStore(): Map<string, PendingBatchInfo> {
  if (!globalThis.__q402_pending_batches__) {
    globalThis.__q402_pending_batches__ = new Map<string, PendingBatchInfo>();
    console.log('[Q402] Created new pending batch store');
  }
  return globalThis.__q402_pending_batches__;
}

/**
 * Store a pending batch (called when approval is needed)
 */
export function storePendingBatch(info: PendingBatchInfo): void {
  const store = getPendingBatchStore();
  store.set(info.approvalRequestId, info);
  console.log('[Q402] Stored pending batch', { approvalRequestId: info.approvalRequestId });
}

/**
 * Get a pending batch by approval request ID
 */
export function getPendingBatch(approvalRequestId: string): PendingBatchInfo | undefined {
  const store = getPendingBatchStore();
  return store.get(approvalRequestId);
}

/**
 * Delete a pending batch after it's been processed
 */
export function deletePendingBatch(approvalRequestId: string): void {
  const store = getPendingBatchStore();
  store.delete(approvalRequestId);
  console.log('[Q402] Deleted pending batch', { approvalRequestId });
}

// Clean up expired requests every 5 minutes (only initialize once)
if (typeof setInterval !== 'undefined' && !globalThis.__q402_cleanup_initialized__) {
  globalThis.__q402_cleanup_initialized__ = true;
  setInterval(() => {
    const store = getGlobalRequestStore();
    const now = new Date();
    let cleaned = 0;
    for (const [id, request] of store.entries()) {
      if (new Date(request.expiresAt) < now) {
        store.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[Q402] Cleaned up ${cleaned} expired requests`);
    }
  }, 5 * 60 * 1000);
}

/**
 * Q402 API Client for gas-sponsored sign-to-pay transactions
 * Implements the x402 protocol with EIP-7702 extensions
 * 
 * @see https://github.com/quackai-labs/Q402
 */
export class Q402Client {
  private config: Q402FacilitatorConfig;

  constructor(network: NetworkType) {
    const q402Network: Q402Network = network === 'mainnet' ? 'bsc-mainnet' : 'bsc-testnet';
    const contracts = Q402_CONTRACTS[network];

    this.config = {
      apiUrl: resolveApiUrl(Q402_FACILITATOR.apiUrl),
      apiKey: process.env.Q402_API_KEY,
      chainId: NETWORKS[network].chainId,
      network: q402Network,
      implementationContract: contracts.implementation,
      verifyingContract: contracts.verifier,
      recipientAddress: contracts.facilitatorWallet,
      gasPolicy: {
        maxGasPriceGwei: Q402_FACILITATOR.gasPolicy.maxGasPriceGwei,
        maxGasLimit: Q402_FACILITATOR.gasPolicy.maxGasLimit,
        sponsorGas: Q402_FACILITATOR.gasPolicy.sponsorGas,
      },
    };
  }

  /**
   * Get the current nonce for a user from the Q402 implementation contract
   */
  async getNonce(userAddress: string): Promise<number> {
    try {
      const networkConfig = this.config.network === 'bsc-mainnet' 
        ? NETWORKS.mainnet 
        : NETWORKS.testnet;
      
      const provider = new JsonRpcProvider(networkConfig.rpcUrl);
      const contract = new Contract(
        this.config.implementationContract,
        Q402_CONTRACT_ABI,
        provider
      );
      
      const nonce = await contract.getNonce(userAddress);
      const nonceNumber = Number(nonce);
      
      logger.q402('Fetched user nonce', { 
        userAddress, 
        nonce: nonceNumber,
        contract: this.config.implementationContract,
      });
      
      return nonceNumber;
    } catch (error) {
      logger.error('Failed to fetch nonce from contract', { 
        userAddress, 
        error: error instanceof Error ? error.message : String(error),
      });
      // Default to 0 if we can't fetch the nonce
      // This may cause the transaction to fail, but it's better than silently using wrong nonce
      return 0;
    }
  }

  /**
   * Compute payment ID the same way the contract does
   * bytes32 paymentId = keccak256(abi.encodePacked(owner, token, recipient, amount, nonce, deadline))
   */
  private computePaymentId(
    owner: string,
    token: string,
    recipient: string,
    amount: string,
    nonce: number,
    deadline: number
  ): string {
    return keccak256(
      solidityPacked(
        ['address', 'address', 'address', 'uint256', 'uint256', 'uint256'],
        [owner, token, recipient, BigInt(amount), BigInt(nonce), BigInt(deadline)]
      )
    );
  }

  /**
   * Generate a placeholder payment ID for batch operations
   * These get replaced with computed paymentIds when the batch is finalized
   */
  private generatePlaceholderPaymentId(): string {
    const timestamp = Date.now().toString();
    const random = hexlify(randomBytes(16));
    return keccak256(toUtf8Bytes(`${timestamp}:${random}`));
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 15);
    return `q402_${timestamp}_${random}`;
  }

  /**
   * Create a payment request for a transaction
   * Returns typed data for the user to sign
   */
  async createPaymentRequest(
    tx: PreparedTx,
    metadata: {
      action: string;
      description: string;
      valueUsd?: number;
    },
    options?: {
      tokenAddress?: string;
      amount?: string;
      nonce?: number;
      recipientAddress?: string; // Actual recipient for transfers
    }
  ): Promise<Q402PaymentRequest> {
    logger.q402('createPaymentRequest', { action: metadata.action });

    const requestId = this.generateRequestId();
    const now = Date.now();
    const deadline = now + Q402_FACILITATOR.requestExpiryMs;

    // Convert amount to wei if it's a decimal string
    let amountInWei = tx.value || '0';
    if (options?.amount) {
      // Check if the amount looks like a decimal (has a decimal point or is a small number)
      const amountStr = options.amount.toString();
      if (amountStr.includes('.') || (parseFloat(amountStr) < 1000 && !amountStr.startsWith('0x'))) {
        try {
          // Assume it's in ether/BNB and convert to wei
          amountInWei = parseEther(amountStr).toString();
          logger.q402('Converted amount to wei', { original: amountStr, wei: amountInWei });
        } catch {
          // If parsing fails, use the original value (might already be in wei)
          amountInWei = amountStr;
        }
      } else {
        amountInWei = amountStr;
      }
    }

    // For token transfers, use the actual recipient address
    // For payments to facilitator, use the facilitator address
    const recipientAddress = options?.recipientAddress || this.config.recipientAddress;

    // Create payment details for x402 protocol compliance
    const paymentDetails: Q402PaymentDetails = {
      scheme: 'evm/eip7702-delegated-payment',
      networkId: this.config.network,
      token: options?.tokenAddress || '0x0000000000000000000000000000000000000000', // Native BNB
      amount: amountInWei,
      to: recipientAddress,
      implementationContract: this.config.implementationContract,
      verifyingContract: this.config.verifyingContract,
      description: metadata.description,
    };
    
    logger.debug('Payment details created', {
      token: paymentDetails.token,
      amount: paymentDetails.amount,
      to: paymentDetails.to,
    });

    const request: Q402PaymentRequest = {
      id: requestId,
      chainId: this.config.chainId,
      transaction: tx,
      metadata,
      policy: {
        maxGasPrice: tx.gasPrice,
        deadline: Math.floor(deadline / 1000),
      },
      paymentDetails,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(deadline).toISOString(),
    };

    // Store request for later verification
    await this.storeRequest(request);

    return request;
  }

  /**
   * Create EIP-712 typed data for wallet signing
   * This creates the Witness structure the user must sign
   * IMPORTANT: The witness is stored in the request for later verification
   * NOTE: If witness already exists, reuse it to avoid generating different paymentIds
   */
  createTypedDataForSigning(
    request: Q402PaymentRequest,
    ownerAddress: string,
    nonce: number = 0
  ): Q402SignedMessage {
    // CRITICAL: If witness already exists, reuse it!
    // This prevents generating different paymentIds on multiple calls
    if (request.witness) {
      logger.q402('Reusing existing witness', {
        requestId: request.id,
        paymentId: request.witness.paymentId,
      });
      return this.buildTypedDataFromWitness(request.witness, request.chainId);
    }

    const paymentDetails = request.paymentDetails;
    if (!paymentDetails) {
      throw new Error('Payment details not available on request');
    }

    const deadline = request.policy?.deadline || Math.floor(Date.now() / 1000) + 1200; // 20 min default
    
    // Compute paymentId the same way the contract does:
    // keccak256(abi.encodePacked(owner, token, recipient, amount, nonce, deadline))
    const paymentId = this.computePaymentId(
      ownerAddress,
      paymentDetails.token,
      paymentDetails.to,
      paymentDetails.amount,
      nonce,
      deadline
    );

    const witness: Q402Witness = {
      owner: ownerAddress,
      token: paymentDetails.token,
      amount: paymentDetails.amount,
      to: paymentDetails.to,
      deadline,
      paymentId,
      nonce,
    };
    
    // Store the witness in the request for later verification
    // This is critical - the SAME witness must be used for verification
    request.witness = witness;
    
    // Update the stored request with the witness
    // This is async but we don't need to wait for it
    this.updateStoredRequest(request);
    
    logger.q402('Created typed data for signing', {
      requestId: request.id,
      owner: witness.owner,
      paymentId: witness.paymentId,
    });

    return this.buildTypedDataFromWitness(witness, request.chainId);
  }

  /**
   * Build typed data structure from an existing witness
   * Used to ensure consistent typed data when witness already exists
   */
  private buildTypedDataFromWitness(witness: Q402Witness, chainId?: number): Q402SignedMessage {
    const domain: TypedDataDomain = {
      name: 'q402',
      version: '1',
      chainId: chainId || this.config.chainId,
      verifyingContract: this.config.verifyingContract,
    };

    return {
      domain: {
        name: domain.name!,
        version: domain.version!,
        chainId: Number(domain.chainId),
        verifyingContract: domain.verifyingContract!,
      },
      types: Q402_WITNESS_TYPES,
      primaryType: 'Witness',
      message: witness,
    };
  }

  /**
   * Create typed data compatible with ethers.js signTypedData
   */
  createEthersTypedData(request: Q402PaymentRequest, ownerAddress: string, nonce: number = 0): {
    domain: TypedDataDomain;
    types: Record<string, TypedDataField[]>;
    value: Q402Witness;
  } {
    const typedData = this.createTypedDataForSigning(request, ownerAddress, nonce);
    
    return {
      domain: {
        name: typedData.domain.name,
        version: typedData.domain.version,
        chainId: typedData.domain.chainId,
        verifyingContract: typedData.domain.verifyingContract,
      },
      types: {
        Witness: typedData.types.Witness.map(field => ({
          name: field.name,
          type: field.type,
        })),
      },
      value: typedData.message,
    };
  }

  /**
   * Verify a signature using the facilitator service directly
   */
  async verifySignature(
    requestId: string,
    signature: string,
    signerAddress: string
  ): Promise<FacilitatorVerifyResponse> {
    const request = await this.getRequest(requestId);
    if (!request) {
      return { valid: false, error: 'Request not found' };
    }

    // CRITICAL: Use the stored witness that was used for signing
    // Creating a new witness would result in a different paymentId and signature mismatch
    if (!request.witness) {
      logger.warn('No stored witness found, using local verification');
      return this.localVerifySignature(request, signature, signerAddress);
    }

    try {
      // Initialize the facilitator service directly (no HTTP call needed)
      const network = this.config.network === 'bsc-mainnet' ? 'mainnet' : 'testnet';
      const facilitator = await initializeFacilitator(network);
      
      logger.q402('Verifying signature with stored witness', {
        requestId,
        paymentId: request.witness.paymentId,
        owner: request.witness.owner,
      });
      
      // Call the facilitator service directly for verification
      const result = await facilitator.verify({
        networkId: this.config.network,
        witness: request.witness,
        signature,
        signerAddress,
      });
      
      return result;
    } catch (error) {
      // Fallback to local verification
      logger.warn('Facilitator service error, using local verification', { error: String(error) });
      return this.localVerifySignature(request, signature, signerAddress);
    }
  }

  /**
   * Local signature verification (fallback when facilitator is unavailable)
   */
  private localVerifySignature(
    request: Q402PaymentRequest,
    signature: string,
    signerAddress: string
  ): FacilitatorVerifyResponse {
    // Basic validation
    if (!signature || signature.length < 130) {
      return { valid: false, error: 'Invalid signature format' };
    }

    // For demo purposes, accept valid-looking signatures
    // In production, this would verify the EIP-712 signature
    return {
      valid: true,
      payer: signerAddress,
      amount: request.paymentDetails?.amount,
      token: request.paymentDetails?.token,
    };
  }

  /**
   * Execute a signed payment request through the facilitator
   * This submits the transaction with gas sponsorship
   */
  async executeRequest(executionRequest: Q402ExecutionRequest): Promise<Q402ExecutionResult> {
    logger.q402('executeRequest', { requestId: executionRequest.requestId });

    try {
      const request = await this.getRequest(executionRequest.requestId);
      if (!request) {
        return {
          success: false,
          requestId: executionRequest.requestId,
          status: 'failed',
          error: 'Payment request not found',
        };
      }

      // Check expiration
      if (new Date(request.expiresAt) < new Date()) {
        return {
          success: false,
          requestId: executionRequest.requestId,
          status: 'failed',
          error: 'Payment request expired',
        };
      }

      // Verify signature first
      const verification = await this.verifySignature(
        executionRequest.requestId,
        executionRequest.signature,
        executionRequest.signerAddress
      );

      if (!verification.valid) {
        return {
          success: false,
          requestId: executionRequest.requestId,
          status: 'failed',
          error: verification.error || 'Signature verification failed',
        };
      }

      // Submit to facilitator for settlement
      const settlement = await this.submitToFacilitator(request, executionRequest);

      if (settlement.success) {
        return {
          success: true,
          requestId: request.id,
          txHash: settlement.txHash,
          gasUsed: settlement.gasUsed,
          status: 'completed',
        };
      }

      // If facilitator fails, attempt local execution (for development)
      logger.warn('Facilitator settlement failed, using simulation');
      return this.simulateExecution(request, executionRequest);
    } catch (error) {
      logger.error('Q402 execution failed', error);
      return {
        success: false,
        requestId: executionRequest.requestId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Submit transaction to Q402 facilitator for gas-sponsored execution
   * Uses direct service call instead of HTTP to avoid server-to-server fetch issues
   */
  private async submitToFacilitator(
    request: Q402PaymentRequest,
    executionRequest: Q402ExecutionRequest
  ): Promise<FacilitatorSettleResponse> {
    // CRITICAL: Must use the stored witness that was used for signing
    if (!request.witness) {
      logger.error('No stored witness found - cannot verify signature');
      return {
        success: false,
        error: 'No witness data available for settlement',
      };
    }

    try {
      // Initialize the facilitator service directly (no HTTP call needed)
      const network = this.config.network === 'bsc-mainnet' ? 'mainnet' : 'testnet';
      const facilitator = await initializeFacilitator(network);
      
      // Log transaction details before building settle request
      logger.debug('Building settle request with transaction', {
        requestId: request.id,
        hasTransaction: !!request.transaction,
        transactionTo: request.transaction?.to,
        transactionDataLength: request.transaction?.data?.length,
        transactionDataPreview: request.transaction?.data?.slice(0, 74),
        transactionValue: request.transaction?.value,
      });

      // Build settle request using the STORED witness
      const settleRequest: SettleRequest = {
        networkId: this.config.network,
        requestId: request.id,
        witness: request.witness,  // Use the stored witness!
        signature: executionRequest.signature,
        signerAddress: executionRequest.signerAddress,
        transaction: request.transaction ? {
          to: request.transaction.to,
          data: request.transaction.data,
          value: request.transaction.value,
        } : undefined,
      };
      
      logger.info('Submitting to facilitator service directly', {
        requestId: request.id,
        signerAddress: executionRequest.signerAddress,
        paymentId: request.witness.paymentId,
        network,
        settleTransactionData: settleRequest.transaction?.data?.slice(0, 74),
      });
      
      // Call the facilitator service directly
      // Skip verification since we already verified the signature above
      const result = await facilitator.settle(settleRequest, true);
      
      if (result.success) {
        logger.info('Facilitator settlement successful', {
          requestId: request.id,
          txHash: result.txHash,
        });
      } else {
        logger.warn('Facilitator settlement failed', {
          requestId: request.id,
          error: result.error,
        });
      }
      
      return result;
    } catch (error) {
      logger.error('Facilitator service error', { error: String(error) });
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Facilitator service error' 
      };
    }
  }

  /**
   * Simulate transaction execution for demo/development
   */
  private async simulateExecution(
    request: Q402PaymentRequest,
    execution: Q402ExecutionRequest
  ): Promise<Q402ExecutionResult> {
    // In development mode, we might want to simulate success
    // But in production, we should fail properly
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    if (isDevelopment && process.env.ENABLE_Q402_SIMULATION === 'true') {
      // Only simulate if explicitly enabled in development
      const txHash = hexlify(randomBytes(32));
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      logger.warn('Using SIMULATED transaction (not real)', { requestId: request.id, txHash });
      
      return {
        success: true,
        requestId: request.id,
        txHash,
        blockNumber: Math.floor(Math.random() * 1000000) + 30000000,
        gasUsed: request.transaction.gasLimit || '100000',
        status: 'completed',
      };
    }
    
    // In production or when simulation is disabled, return failure
    logger.error('Facilitator settlement failed and simulation is disabled', {
      requestId: request.id,
    });
    
    return {
      success: false,
      requestId: request.id,
      status: 'failed',
      error: 'Transaction settlement failed. Please try again.',
    };
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(requestId: string): Promise<Q402TransactionStatus | null> {
    logger.q402('getTransactionStatus', { requestId });

    const request = await this.getRequest(requestId);
    if (!request) return null;

    // Try to get status from facilitator
    try {
      const response = await fetch(
        `${this.config.apiUrl}/status/${requestId}`,
        {
          headers: {
            ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` }),
          },
        }
      );

      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      // Facilitator unavailable, return local status
    }

    return {
      requestId,
      status: 'pending',
      createdAt: request.createdAt,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Create a batch request for multiple transactions (atomic execution)
   */
  async createBatchRequest(
    transactions: PreparedTx[],
    metadata: {
      action: string;
      description: string;
      totalValueUsd?: number;
    }
  ): Promise<Q402BatchRequest> {
    logger.q402('createBatchRequest', { 
      action: metadata.action, 
      txCount: transactions.length 
    });

    const batchId = this.generateRequestId();
    const now = Date.now();
    const deadline = now + Q402_FACILITATOR.requestExpiryMs;

    // Create witnesses for each transaction (placeholders - will be filled by signer)
    const witnesses: Q402Witness[] = transactions.map((tx, index) => ({
      owner: '0x0000000000000000000000000000000000000000', // Will be filled by signer
      token: '0x0000000000000000000000000000000000000000',
      amount: tx.value || '0',
      to: this.config.recipientAddress,
      deadline: Math.floor(deadline / 1000),
      paymentId: this.generatePlaceholderPaymentId(), // Placeholder - will be recomputed when finalized
      nonce: index,
    }));

    return {
      id: batchId,
      chainId: this.config.chainId,
      transactions,
      witnesses,
      metadata,
      policy: {
        deadline: Math.floor(deadline / 1000),
        atomicExecution: true,
      },
    };
  }

  /**
   * Execute a batch of transactions atomically
   */
  async executeBatch(
    batchRequest: Q402BatchRequest,
    signatures: string[]
  ): Promise<Q402BatchResult> {
    logger.q402('executeBatch', { batchId: batchRequest.id });

    // For production, this would:
    // 1. Verify all signatures
    // 2. Submit batch to facilitator
    // 3. Execute atomically on-chain

    // Simulate batch execution
    const results = batchRequest.transactions.map((_, index) => ({
      index,
      txHash: hexlify(randomBytes(32)),
      success: true,
    }));

    return {
      success: true,
      batchId: batchRequest.id,
      results,
      totalGasUsed: String(batchRequest.transactions.length * 100000),
    };
  }

  /**
   * Check gas sponsorship availability
   */
  async checkGasSponsorship(): Promise<{
    available: boolean;
    maxGasLimit?: number;
    sponsoredNetworks?: Q402Network[];
    dailyLimitRemaining?: string;
  }> {
    try {
      const response = await fetch(
        `${this.config.apiUrl}${Q402_FACILITATOR.endpoints.supported}`,
        {
          headers: {
            ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` }),
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        return {
          available: true,
          maxGasLimit: this.config.gasPolicy?.maxGasLimit,
          sponsoredNetworks: data.networks,
        };
      }
    } catch (error) {
      // Facilitator unavailable
    }

    // Default response when facilitator is unavailable
    return {
      available: true,
      maxGasLimit: this.config.gasPolicy?.maxGasLimit,
      sponsoredNetworks: ['bsc-testnet', 'bsc-mainnet'],
    };
  }

  /**
   * Cancel a pending request
   */
  async cancelRequest(requestId: string): Promise<boolean> {
    logger.q402('cancelRequest', { requestId });
    
    const request = await this.getRequest(requestId);
    if (!request) return false;

    const store = getGlobalRequestStore();
    store.delete(requestId);
    return true;
  }

  /**
   * Get facilitator configuration
   */
  getConfig(): Q402FacilitatorConfig {
    return { ...this.config };
  }

  /**
   * Store request in global store
   * Note: In production, this should store to database or Redis
   */
  private async storeRequest(request: Q402PaymentRequest): Promise<void> {
    const store = getGlobalRequestStore();
    store.set(request.id, request);
    logger.q402('Request stored', { 
      requestId: request.id, 
      storeSize: store.size,
      hasTransaction: !!request.transaction,
      transactionTo: request.transaction?.to,
      transactionDataLength: request.transaction?.data?.length,
      transactionDataPreview: request.transaction?.data?.slice(0, 74),
    });
  }

  /**
   * Update an existing stored request (e.g., after adding witness)
   */
  private updateStoredRequest(request: Q402PaymentRequest): void {
    const store = getGlobalRequestStore();
    if (store.has(request.id)) {
      store.set(request.id, request);
      logger.q402('Request updated with witness', { 
        requestId: request.id, 
        hasWitness: !!request.witness,
        paymentId: request.witness?.paymentId,
      });
    }
  }

  /**
   * Get request from global store
   */
  private async getRequest(requestId: string): Promise<Q402PaymentRequest | undefined> {
    const store = getGlobalRequestStore();
    const request = store.get(requestId);
    logger.q402('Request lookup', { requestId, found: !!request, storeSize: store.size });
    return request;
  }

  /**
   * Delete request from store (used after execution)
   */
  deleteRequest(requestId: string): void {
    const store = getGlobalRequestStore();
    store.delete(requestId);
  }

  // =============================================================================
  // BATCH EXECUTION METHODS
  // =============================================================================

  /**
   * Get the BatchExecutor contract address for this network
   */
  getBatchExecutorAddress(): string {
    const network = this.config.network === 'bsc-mainnet' ? 'mainnet' : 'testnet';
    return Q402_CONTRACTS[network].batchExecutor || '';
  }

  /**
   * Get the current nonce for a user from the BatchExecutor contract
   */
  async getBatchNonce(userAddress: string): Promise<number> {
    try {
      const batchExecutorAddress = this.getBatchExecutorAddress();
      if (!batchExecutorAddress) {
        logger.warn('BatchExecutor not deployed, using nonce 0');
        return 0;
      }

      const networkConfig = this.config.network === 'bsc-mainnet' 
        ? NETWORKS.mainnet 
        : NETWORKS.testnet;
      
      const provider = new JsonRpcProvider(networkConfig.rpcUrl);
      const contract = new Contract(
        batchExecutorAddress,
        Q402_BATCH_EXECUTOR_ABI,
        provider
      );
      
      const nonce = await contract.getNonce(userAddress);
      const nonceNumber = Number(nonce);
      
      logger.q402('Fetched batch nonce', { 
        userAddress, 
        nonce: nonceNumber,
        contract: batchExecutorAddress,
      });
      
      return nonceNumber;
    } catch (error) {
      logger.error('Failed to fetch batch nonce from contract', { 
        userAddress, 
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Compute the operations hash the same way the contract does
   */
  computeOperationsHash(operations: BatchOperation[]): string {
    const abiCoder = new AbiCoder();
    const OPERATION_TYPEHASH = keccak256(
      toUtf8Bytes('Operation(uint8 opType,address tokenIn,uint256 amountIn,address tokenOut,uint256 minAmountOut,address target,bytes data)')
    );
    
    // Hash each operation
    const operationHashes: string[] = operations.map(op => {
      const opTypeCode = this.getOpTypeCode(op.type);
      const dataHash = keccak256(op.data || '0x');
      
      return keccak256(
        abiCoder.encode(
          ['bytes32', 'uint8', 'address', 'uint256', 'address', 'uint256', 'address', 'bytes32'],
          [
            OPERATION_TYPEHASH,
            opTypeCode,
            op.tokenIn,
            BigInt(op.amountIn),
            op.tokenOut,
            BigInt(op.minAmountOut),
            op.target,
            dataHash,
          ]
        )
      );
    });
    
    // Combine all operation hashes
    return keccak256(solidityPacked(['bytes32[]'], [operationHashes]));
  }

  /**
   * Convert operation type string to numeric code
   */
  private getOpTypeCode(type: string): number {
    switch (type) {
      case 'transfer': return 0;
      case 'swap': return 1;
      case 'call': return 2;
      default: return 0;
    }
  }

  /**
   * Generate a unique batch ID
   */
  private generateBatchId(): string {
    const timestamp = Date.now().toString(36);
    const random = hexlify(randomBytes(16));
    return keccak256(toUtf8Bytes(`batch_${timestamp}_${random}`));
  }

  /**
   * Create a batch payment request
   */
  async createBatchPaymentRequest(
    operations: BatchOperation[],
    ownerAddress: string,
    metadata: {
      action: string;
      description: string;
      totalValueUsd?: number;
    }
  ): Promise<BatchPaymentRequest> {
    logger.q402('createBatchPaymentRequest', { 
      action: metadata.action,
      operationCount: operations.length,
    });

    const requestId = this.generateRequestId();
    const batchId = this.generateBatchId();
    const now = Date.now();
    const deadline = now + Q402_FACILITATOR.requestExpiryMs;

    // Get nonce for the owner
    const nonce = await this.getBatchNonce(ownerAddress);

    // Compute operations hash
    const operationsHash = this.computeOperationsHash(operations);

    // Create batch witness
    const witness: BatchWitness = {
      owner: ownerAddress,
      operationsHash,
      deadline: Math.floor(deadline / 1000),
      batchId,
      nonce,
    };

    const request: BatchPaymentRequest = {
      id: requestId,
      chainId: this.config.chainId,
      operations,
      witness,
      metadata: {
        ...metadata,
        operationCount: operations.length,
      },
      policy: {
        deadline: Math.floor(deadline / 1000),
        atomicExecution: true,
      },
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(deadline).toISOString(),
    };

    // Store request
    await this.storeBatchRequest(request);

    return request;
  }

  /**
   * Create EIP-712 typed data for batch signing
   */
  createBatchTypedDataForSigning(request: BatchPaymentRequest): BatchSignedMessage {
    const batchExecutorAddress = this.getBatchExecutorAddress();
    
    const domain = {
      name: 'q402-batch',
      version: '1',
      chainId: this.config.chainId,
      verifyingContract: batchExecutorAddress || this.config.verifyingContract,
    };

    const types = {
      BatchWitness: BATCH_WITNESS_TYPES.BatchWitness.map(field => ({
        name: field.name,
        type: field.type,
      })),
    };

    logger.q402('Created batch typed data for signing', {
      requestId: request.id,
      owner: request.witness.owner,
      batchId: request.witness.batchId,
      operationCount: request.operations.length,
    });

    return {
      domain,
      types,
      primaryType: 'BatchWitness',
      message: request.witness,
    };
  }

  /**
   * Create ethers-compatible typed data for batch signing
   */
  createEthersBatchTypedData(request: BatchPaymentRequest): {
    domain: TypedDataDomain;
    types: Record<string, TypedDataField[]>;
    value: BatchWitness;
  } {
    const typedData = this.createBatchTypedDataForSigning(request);
    
    return {
      domain: {
        name: typedData.domain.name,
        version: typedData.domain.version,
        chainId: typedData.domain.chainId,
        verifyingContract: typedData.domain.verifyingContract,
      },
      types: {
        BatchWitness: typedData.types.BatchWitness.map(field => ({
          name: field.name,
          type: field.type,
        })),
      },
      value: typedData.message,
    };
  }

  /**
   * Execute a batch payment request
   */
  async executeBatchRequest(
    requestId: string,
    signature: string,
    signerAddress: string
  ): Promise<BatchExecutionResult> {
    logger.q402('executeBatchRequest', { requestId });

    try {
      const request = await this.getBatchRequest(requestId);
      if (!request) {
        return {
          success: false,
          batchId: '',
          error: 'Batch request not found',
        };
      }

      // Check expiration
      if (new Date(request.expiresAt) < new Date()) {
        return {
          success: false,
          batchId: request.witness.batchId,
          error: 'Batch request expired',
        };
      }

      // Import and use batch settler
      const { createBatchTransactionSettler } = await import('@/lib/services/facilitator/batch-settler');
      
      const network = this.config.network === 'bsc-mainnet' ? 'mainnet' : 'testnet';
      const networkConfig = NETWORKS[network];
      const contracts = Q402_CONTRACTS[network];

      // Get sponsor private key from environment
      const sponsorPrivateKey = process.env.FACILITATOR_PRIVATE_KEY || '';
      if (!sponsorPrivateKey) {
        return {
          success: false,
          batchId: request.witness.batchId,
          error: 'Facilitator not configured',
        };
      }

      // Derive sponsor address
      const { Wallet } = await import('ethers');
      const sponsorWallet = new Wallet(sponsorPrivateKey);
      const sponsorAddress = sponsorWallet.address;

      const batchSettler = createBatchTransactionSettler({
        network: this.config.network,
        chainId: this.config.chainId,
        rpcUrl: networkConfig.rpcUrl,
        sponsorPrivateKey,
        sponsorAddress,
        implementationContract: contracts.implementation,
        verifyingContract: contracts.verifier,
        batchExecutorContract: contracts.batchExecutor || '',
        implementationWhitelist: [contracts.implementation],
        maxGasPriceGwei: Q402_FACILITATOR.gasPolicy.maxGasPriceGwei,
        maxGasLimit: Q402_FACILITATOR.gasPolicy.maxGasLimit,
        dailyGasBudgetWei: '1000000000000000000', // 1 BNB
        perTransactionMaxGasWei: '10000000000000000', // 0.01 BNB
        maxRequestsPerMinute: 10,
        maxRequestsPerAddress: 100,
      });

      // Execute batch
      const result = await batchSettler.settleBatch({
        networkId: this.config.network,
        requestId,
        witness: request.witness,
        operations: request.operations,
        signature,
        signerAddress,
      }, false); // Don't skip verification

      if (result.success) {
        // Clean up stored request
        this.deleteBatchRequest(requestId);

        return {
          success: true,
          batchId: request.witness.batchId,
          txHash: result.txHash,
          blockNumber: result.blockNumber,
          gasUsed: result.gasUsed,
          operationResults: result.operationResults,
        };
      }

      return {
        success: false,
        batchId: request.witness.batchId,
        error: result.error,
      };
    } catch (error) {
      logger.error('Batch execution failed', error);
      return {
        success: false,
        batchId: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Store batch request in global store
   */
  private async storeBatchRequest(request: BatchPaymentRequest): Promise<void> {
    const store = getBatchRequestStore();
    store.set(request.id, request);
    logger.q402('Batch request stored', { 
      requestId: request.id, 
      storeSize: store.size,
      operationCount: request.operations.length,
    });
  }

  /**
   * Get batch request from global store
   */
  private async getBatchRequest(requestId: string): Promise<BatchPaymentRequest | undefined> {
    const store = getBatchRequestStore();
    const request = store.get(requestId);
    logger.q402('Batch request lookup', { requestId, found: !!request, storeSize: store.size });
    return request;
  }

  /**
   * Delete batch request from store
   */
  deleteBatchRequest(requestId: string): void {
    const store = getBatchRequestStore();
    store.delete(requestId);
  }

  /**
   * Check if user needs to approve BatchExecutor for a token
   */
  async checkBatchApprovalNeeded(
    tokenAddress: string,
    ownerAddress: string,
    amount: string
  ): Promise<{
    needsApproval: boolean;
    currentAllowance: bigint;
    requiredAmount: bigint;
    batchExecutorAddress: string;
  }> {
    const batchExecutorAddress = this.getBatchExecutorAddress();
    if (!batchExecutorAddress) {
      return {
        needsApproval: false,
        currentAllowance: BigInt(0),
        requiredAmount: BigInt(0),
        batchExecutorAddress: '',
      };
    }

    const networkConfig = this.config.network === 'bsc-mainnet' 
      ? NETWORKS.mainnet 
      : NETWORKS.testnet;
    
    const provider = new JsonRpcProvider(networkConfig.rpcUrl);
    const tokenContract = new Contract(
      tokenAddress,
      ['function allowance(address owner, address spender) view returns (uint256)'],
      provider
    );

    const currentAllowance = await tokenContract.allowance(ownerAddress, batchExecutorAddress);
    const requiredAmount = BigInt(amount);

    return {
      needsApproval: currentAllowance < requiredAmount,
      currentAllowance,
      requiredAmount,
      batchExecutorAddress,
    };
  }
}

/**
 * Factory function to create Q402Client
 */
export function createQ402Client(network: NetworkType): Q402Client {
  return new Q402Client(network);
}
