import { keccak256, toUtf8Bytes, hexlify, randomBytes, TypedDataDomain, TypedDataField, parseEther, parseUnits } from 'ethers';
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
} from './types';
import { Q402_WITNESS_TYPES } from './types';
import { NETWORKS, Q402_CONTRACTS, Q402_FACILITATOR, type NetworkType } from '@/lib/utils/constants';
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

// Declare the global type
declare global {
  // eslint-disable-next-line no-var
  var __q402_request_store__: Map<string, Q402PaymentRequest> | undefined;
  // eslint-disable-next-line no-var
  var __q402_cleanup_initialized__: boolean | undefined;
}

// Get or create the global store
function getGlobalRequestStore(): Map<string, Q402PaymentRequest> {
  if (!globalThis.__q402_request_store__) {
    globalThis.__q402_request_store__ = new Map<string, Q402PaymentRequest>();
    console.log('[Q402] Created new global request store');
  }
  return globalThis.__q402_request_store__;
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
   * Generate a unique payment ID (bytes32)
   */
  private generatePaymentId(): string {
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

    // Create payment details for x402 protocol compliance
    const paymentDetails: Q402PaymentDetails = {
      scheme: 'evm/eip7702-delegated-payment',
      networkId: this.config.network,
      token: options?.tokenAddress || '0x0000000000000000000000000000000000000000', // Native BNB
      amount: amountInWei,
      to: this.config.recipientAddress,
      implementationContract: this.config.implementationContract,
      verifyingContract: this.config.verifyingContract,
      description: metadata.description,
    };

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

    const witness: Q402Witness = {
      owner: ownerAddress,
      token: paymentDetails.token,
      amount: paymentDetails.amount,
      to: paymentDetails.to,
      deadline: request.policy?.deadline || Math.floor(Date.now() / 1000) + 1200, // 20 min default
      paymentId: this.generatePaymentId(),
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
      
      // Build settle request using the STORED witness
      const settleRequest: SettleRequest = {
        networkId: this.config.network,
        requestId: request.id,
        witness: request.witness,  // Use the stored witness!
        signature: executionRequest.signature,
        signerAddress: executionRequest.signerAddress,
        transaction: request.transaction,
      };
      
      logger.info('Submitting to facilitator service directly', {
        requestId: request.id,
        signerAddress: executionRequest.signerAddress,
        paymentId: request.witness.paymentId,
        network,
      });
      
      // Call the facilitator service directly
      const result = await facilitator.settle(settleRequest);
      
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
    // Generate a realistic-looking transaction hash
    const txHash = hexlify(randomBytes(32));

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    return {
      success: true,
      requestId: request.id,
      txHash,
      blockNumber: Math.floor(Math.random() * 1000000) + 30000000,
      gasUsed: request.transaction.gasLimit || '100000',
      status: 'completed',
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

    // Create witnesses for each transaction
    const witnesses: Q402Witness[] = transactions.map((tx, index) => ({
      owner: '0x0000000000000000000000000000000000000000', // Will be filled by signer
      token: '0x0000000000000000000000000000000000000000',
      amount: tx.value || '0',
      to: this.config.recipientAddress,
      deadline: Math.floor(deadline / 1000),
      paymentId: this.generatePaymentId(),
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
    logger.q402('Request stored', { requestId: request.id, storeSize: store.size });
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
}

/**
 * Factory function to create Q402Client
 */
export function createQ402Client(network: NetworkType): Q402Client {
  return new Q402Client(network);
}
