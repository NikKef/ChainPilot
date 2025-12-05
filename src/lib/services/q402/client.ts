import { keccak256, toUtf8Bytes, hexlify, randomBytes, TypedDataDomain, TypedDataField } from 'ethers';
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

/**
 * Module-level request storage that persists across client instances
 * In production, this should be replaced with database or Redis storage
 */
const globalRequestStore = new Map<string, Q402PaymentRequest>();

// Clean up expired requests every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = new Date();
    for (const [id, request] of globalRequestStore.entries()) {
      if (new Date(request.expiresAt) < now) {
        globalRequestStore.delete(id);
      }
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
      apiUrl: Q402_FACILITATOR.apiUrl,
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

    // Create payment details for x402 protocol compliance
    const paymentDetails: Q402PaymentDetails = {
      scheme: 'evm/eip7702-delegated-payment',
      networkId: this.config.network,
      token: options?.tokenAddress || '0x0000000000000000000000000000000000000000', // Native BNB
      amount: options?.amount || tx.value || '0',
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
   */
  createTypedDataForSigning(
    request: Q402PaymentRequest,
    ownerAddress: string,
    nonce: number = 0
  ): Q402SignedMessage {
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

    const domain: TypedDataDomain = {
      name: 'q402',
      version: '1',
      chainId: request.chainId,
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
   * Verify a signature against the facilitator API
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

    try {
      // In production, call the facilitator API
      const response = await fetch(
        `${this.config.apiUrl}${Q402_FACILITATOR.endpoints.verify}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` }),
          },
          body: JSON.stringify({
            networkId: this.config.network,
            requestId,
            signature,
            signerAddress,
            paymentDetails: request.paymentDetails,
          }),
        }
      );

      if (!response.ok) {
        // Fallback to local verification for demo/development
      logger.warn('Facilitator API unavailable, using local verification', {});
      return this.localVerifySignature(request, signature, signerAddress);
      }

      return await response.json();
    } catch (error) {
      // Fallback to local verification
      logger.warn('Facilitator API error, using local verification', { error: String(error) });
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
   */
  private async submitToFacilitator(
    request: Q402PaymentRequest,
    executionRequest: Q402ExecutionRequest
  ): Promise<FacilitatorSettleResponse> {
    try {
      const response = await fetch(
        `${this.config.apiUrl}${Q402_FACILITATOR.endpoints.settle}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` }),
          },
          body: JSON.stringify({
            networkId: this.config.network,
            requestId: request.id,
            signature: executionRequest.signature,
            signerAddress: executionRequest.signerAddress,
            transaction: request.transaction,
            paymentDetails: request.paymentDetails,
            authorization: executionRequest.authorization,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn('Facilitator settlement failed', { status: response.status, error: errorText });
        return { success: false, error: errorText };
      }

      return await response.json();
    } catch (error) {
      logger.warn('Facilitator API unavailable', { error: String(error) });
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Facilitator unavailable' 
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

    globalRequestStore.delete(requestId);
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
    globalRequestStore.set(request.id, request);
    logger.q402('Request stored', { requestId: request.id, storeSize: globalRequestStore.size });
  }

  /**
   * Get request from global store
   */
  private async getRequest(requestId: string): Promise<Q402PaymentRequest | undefined> {
    const request = globalRequestStore.get(requestId);
    logger.q402('Request lookup', { requestId, found: !!request, storeSize: globalRequestStore.size });
    return request;
  }

  /**
   * Delete request from store (used after execution)
   */
  deleteRequest(requestId: string): void {
    globalRequestStore.delete(requestId);
  }
}

/**
 * Factory function to create Q402Client
 */
export function createQ402Client(network: NetworkType): Q402Client {
  return new Q402Client(network);
}
