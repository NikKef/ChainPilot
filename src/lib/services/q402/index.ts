import type { PreparedTx, TransactionResult, PolicyDecision } from '@/lib/types';
import type { 
  Q402PaymentRequest, 
  Q402ExecutionResult, 
  Q402SignedMessage,
  Q402Witness,
  Q402BatchRequest,
  Q402BatchResult,
} from './types';
import { 
  Q402Client, 
  createQ402Client,
  storePendingTransfer,
  getPendingTransfer,
  deletePendingTransfer,
  type PendingTransferInfo,
} from './client';
import { type NetworkType } from '@/lib/utils/constants';
import { logger } from '@/lib/utils';
import { TransactionError } from '@/lib/utils/errors';

export * from './types';
export { 
  Q402Client, 
  createQ402Client,
  storePendingTransfer,
  getPendingTransfer,
  deletePendingTransfer,
  storePendingSwap,
  getPendingSwap,
  deletePendingSwap,
  type PendingTransferInfo,
  type PendingSwapInfo,
} from './client';

/**
 * Q402 Service - Main entry point for gas-sponsored sign-to-pay transactions
 * 
 * This service implements the full Q402/x402 protocol flow:
 * 1. Prepare transaction and create EIP-712 typed data
 * 2. User signs the typed data with their wallet
 * 3. Submit signed data to facilitator for gas-sponsored execution
 * 4. Transaction is executed on-chain without user paying gas
 */
export class Q402Service {
  private client: Q402Client;
  private network: NetworkType;

  constructor(network: NetworkType) {
    this.network = network;
    this.client = createQ402Client(network);
  }

  /**
   * Prepare a transaction for Q402 execution
   * Returns the payment request and typed data for signing
   */
  async prepareTransaction(
    preparedTx: PreparedTx,
    action: string,
    description: string,
    options?: {
      valueUsd?: number;
      tokenAddress?: string;
      amount?: string;
      ownerAddress?: string;
      nonce?: number;
      recipientAddress?: string; // Actual recipient for transfers
    }
  ): Promise<{
    request: Q402PaymentRequest;
    typedData: Q402SignedMessage;
    ethersTypedData?: ReturnType<Q402Client['createEthersTypedData']>;
  }> {
    logger.q402('prepareTransaction', { action, recipientAddress: options?.recipientAddress });

    // Fetch the current nonce from the contract if owner address is provided and nonce not specified
    const ownerAddress = options?.ownerAddress || '0x0000000000000000000000000000000000000000';
    let nonce = options?.nonce;
    
    if (nonce === undefined && ownerAddress !== '0x0000000000000000000000000000000000000000') {
      nonce = await this.client.getNonce(ownerAddress);
      logger.q402('Fetched nonce for transaction', { ownerAddress, nonce });
    }

    const request = await this.client.createPaymentRequest(
      preparedTx,
      {
        action,
        description,
        valueUsd: options?.valueUsd,
      },
      {
        tokenAddress: options?.tokenAddress,
        amount: options?.amount,
        nonce,
        recipientAddress: options?.recipientAddress,
      }
    );

    // Create typed data for signing
    const typedData = this.client.createTypedDataForSigning(request, ownerAddress, nonce);
    
    // Also create ethers.js compatible typed data
    const ethersTypedData = this.client.createEthersTypedData(request, ownerAddress, nonce);

    return { request, typedData, ethersTypedData };
  }

  /**
   * Execute a signed transaction through Q402 facilitator
   */
  async executeTransaction(
    requestId: string,
    signature: string,
    signerAddress: string
  ): Promise<TransactionResult> {
    logger.q402('executeTransaction', { requestId, signerAddress });

    try {
      const result = await this.client.executeRequest({
        requestId,
        signature,
        signerAddress,
      });

      return {
        success: result.success,
        txHash: result.txHash,
        blockNumber: result.blockNumber,
        gasUsed: result.gasUsed,
        error: result.error,
        q402RequestId: requestId,
      };
    } catch (error) {
      logger.error('Q402 execution failed', error);
      throw new TransactionError(
        error instanceof Error ? error.message : 'Transaction execution failed'
      );
    }
  }

  /**
   * Prepare and get typed data for batch execution
   */
  async prepareBatchTransaction(
    transactions: Array<{
      preparedTx: PreparedTx;
      action: string;
      description: string;
    }>
  ): Promise<{
    batchRequest: Q402BatchRequest;
    typedDataArray: Q402SignedMessage[];
  }> {
    logger.q402('prepareBatchTransaction', { txCount: transactions.length });

    const batchRequest = await this.client.createBatchRequest(
      transactions.map(t => t.preparedTx),
      {
        action: 'batch_execution',
        description: transactions.map(t => t.description).join('; '),
      }
    );

    // Create typed data for each transaction
    const typedDataArray = batchRequest.witnesses.map((witness, index) =>
      this.client.createTypedDataForSigning(
        {
          id: `${batchRequest.id}_${index}`,
          chainId: batchRequest.chainId,
          transaction: batchRequest.transactions[index],
          metadata: {
            action: transactions[index].action,
            description: transactions[index].description,
          },
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
        },
        witness.owner,
        witness.nonce
      )
    );

    return { batchRequest, typedDataArray };
  }

  /**
   * Execute a batch of signed transactions
   */
  async executeBatch(
    batchRequest: Q402BatchRequest,
    signatures: string[]
  ): Promise<{
    success: boolean;
    results: Array<{
      index: number;
      txHash?: string;
      success: boolean;
      error?: string;
    }>;
  }> {
    logger.q402('executeBatch', { batchId: batchRequest.id, signatureCount: signatures.length });

    const result = await this.client.executeBatch(batchRequest, signatures);

    return {
      success: result.success,
      results: result.results,
    };
  }

  /**
   * Get transaction status
   */
  async getStatus(requestId: string): Promise<{
    status: 'pending' | 'signed' | 'executing' | 'completed' | 'failed';
    txHash?: string;
    error?: string;
  }> {
    const status = await this.client.getTransactionStatus(requestId);
    
    if (!status) {
      return { status: 'failed', error: 'Request not found' };
    }

    return {
      status: status.status,
      txHash: status.txHash,
      error: status.error,
    };
  }

  /**
   * Cancel a pending request
   */
  async cancelRequest(requestId: string): Promise<boolean> {
    return this.client.cancelRequest(requestId);
  }

  /**
   * Check if gas sponsorship is available
   */
  async checkGasSponsorship(): Promise<{
    available: boolean;
    maxGasLimit?: number;
    sponsoredNetworks?: string[];
  }> {
    const result = await this.client.checkGasSponsorship();
    return {
      available: result.available,
      maxGasLimit: result.maxGasLimit,
      sponsoredNetworks: result.sponsoredNetworks,
    };
  }

  /**
   * Get the underlying Q402 client
   */
  getClient(): Q402Client {
    return this.client;
  }
}

/**
 * Create Q402 service instance
 */
export function createQ402Service(network: NetworkType): Q402Service {
  return new Q402Service(network);
}

/**
 * Transaction execution service that combines policy + Q402
 * This is the main entry point for executing transactions with safety checks
 */
export class TransactionExecutor {
  private q402Service: Q402Service;
  private network: NetworkType;

  constructor(network: NetworkType) {
    this.network = network;
    this.q402Service = new Q402Service(network);
  }

  /**
   * Full execution flow: validate policy -> prepare Q402 -> return for signing
   */
  async prepareForExecution(
    preparedTx: PreparedTx,
    action: string,
    description: string,
    policyDecision: PolicyDecision,
    options?: {
      valueUsd?: number;
      ownerAddress?: string;
      tokenAddress?: string;
      amount?: string;
      recipientAddress?: string; // Actual recipient for transfers
    }
  ): Promise<{
    allowed: boolean;
    request?: Q402PaymentRequest;
    typedData?: Q402SignedMessage;
    ethersTypedData?: ReturnType<Q402Client['createEthersTypedData']>;
    rejectionReason?: string;
    riskLevel?: string;
    warnings?: string[];
  }> {
    // Check policy
    if (!policyDecision.allowed) {
      return {
        allowed: false,
        rejectionReason: policyDecision.reasons.join('; '),
        riskLevel: policyDecision.riskLevel,
        warnings: policyDecision.warnings,
      };
    }

    // Prepare Q402 request
    const { request, typedData, ethersTypedData } = await this.q402Service.prepareTransaction(
      preparedTx,
      action,
      description,
      {
        valueUsd: options?.valueUsd,
        ownerAddress: options?.ownerAddress,
        tokenAddress: options?.tokenAddress,
        amount: options?.amount,
        recipientAddress: options?.recipientAddress,
      }
    );

    return {
      allowed: true,
      request,
      typedData,
      ethersTypedData,
      riskLevel: policyDecision.riskLevel,
      warnings: policyDecision.warnings,
    };
  }

  /**
   * Execute after user signs
   */
  async execute(
    requestId: string,
    signature: string,
    signerAddress: string
  ): Promise<TransactionResult> {
    return this.q402Service.executeTransaction(requestId, signature, signerAddress);
  }

  /**
   * Prepare and execute a batch of transactions
   */
  async prepareBatchForExecution(
    transactions: Array<{
      preparedTx: PreparedTx;
      action: string;
      description: string;
      policyDecision: PolicyDecision;
    }>
  ): Promise<{
    allowed: boolean;
    batchRequest?: Q402BatchRequest;
    typedDataArray?: Q402SignedMessage[];
    rejectionReasons?: string[];
  }> {
    // Check all policies
    const rejectedTransactions = transactions.filter(t => !t.policyDecision.allowed);
    if (rejectedTransactions.length > 0) {
      return {
        allowed: false,
        rejectionReasons: rejectedTransactions.map(
          t => t.policyDecision.reasons.join('; ')
        ),
      };
    }

    // Prepare batch
    const { batchRequest, typedDataArray } = await this.q402Service.prepareBatchTransaction(
      transactions.map(t => ({
        preparedTx: t.preparedTx,
        action: t.action,
        description: t.description,
      }))
    );

    return {
      allowed: true,
      batchRequest,
      typedDataArray,
    };
  }

  /**
   * Execute a batch after all transactions are signed
   */
  async executeBatch(
    batchRequest: Q402BatchRequest,
    signatures: string[]
  ): Promise<{
    success: boolean;
    results: Array<{
      index: number;
      txHash?: string;
      success: boolean;
      error?: string;
    }>;
  }> {
    return this.q402Service.executeBatch(batchRequest, signatures);
  }

  /**
   * Get Q402 service
   */
  getQ402Service(): Q402Service {
    return this.q402Service;
  }
}

/**
 * Create transaction executor
 */
export function createTransactionExecutor(network: NetworkType): TransactionExecutor {
  return new TransactionExecutor(network);
}
