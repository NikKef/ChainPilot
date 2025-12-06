/**
 * Q402 Batch Transaction Settler
 * 
 * Responsible for submitting batch transactions on-chain with gas sponsorship.
 * Enables multiple operations (transfers, swaps, calls) to be executed atomically
 * with the facilitator paying all gas fees.
 * 
 * Key Features:
 * 1. Gas-sponsored batch execution
 * 2. Support for transfers, swaps, and contract calls
 * 3. EIP-712 signature verification for batches
 * 4. Budget tracking across all operations
 * 
 * @see https://github.com/quackai-labs/Q402
 */

import { 
  JsonRpcProvider, 
  Wallet, 
  Contract,
  parseUnits,
  formatUnits,
  getAddress,
  keccak256,
  solidityPacked,
  AbiCoder,
  TransactionResponse,
  TransactionReceipt as EthersReceipt,
} from 'ethers';
import type { 
  BatchWitness, 
  BatchOperation,
  BatchExecutionRequest,
  BatchExecutionResult,
  BATCH_OP_CODES,
} from '../q402/types';
import type {
  FacilitatorConfig,
  TransactionReceipt,
  BudgetRecord,
  AddressBudget,
  BudgetCheckResult,
} from './types';
import { FacilitatorErrorCode } from './types';
import { BatchSignatureVerifier } from './batch-verifier';
import { logger } from '@/lib/utils';
import { Q402_BATCH_EXECUTOR_ABI } from '@/lib/utils/constants';

/**
 * Extended config for batch executor
 */
export interface BatchExecutorConfig extends FacilitatorConfig {
  batchExecutorContract: string;
}

/**
 * Batch settle request
 */
export interface BatchSettleRequest {
  networkId: string;
  requestId: string;
  witness: BatchWitness;
  operations: BatchOperation[];
  signature: string;
  signerAddress: string;
}

/**
 * Batch settle response
 */
export interface BatchSettleResponse {
  success: boolean;
  txHash?: string;
  blockNumber?: number;
  gasUsed?: string;
  gasPrice?: string;
  effectiveGasPrice?: string;
  error?: string;
  operationResults?: Array<{
    index: number;
    success: boolean;
    amountOut?: string;
    error?: string;
  }>;
  receipt?: TransactionReceipt;
}

/**
 * Batch Transaction Settler Service
 * 
 * Handles on-chain batch execution with gas sponsorship
 */
export class BatchTransactionSettler {
  private config: BatchExecutorConfig;
  private provider: JsonRpcProvider;
  private sponsorWallet: Wallet;
  private verifier: BatchSignatureVerifier;
  private batchExecutorContract: Contract;
  
  // Budget tracking
  private dailyBudget: Map<string, BudgetRecord> = new Map();
  private stats = {
    totalBatches: 0,
    totalOperations: 0,
    totalGasUsed: BigInt(0),
    successCount: 0,
    failCount: 0,
  };

  constructor(config: BatchExecutorConfig) {
    this.config = config;
    
    // Initialize provider
    this.provider = new JsonRpcProvider(config.rpcUrl);
    
    // Initialize sponsor wallet
    this.sponsorWallet = new Wallet(config.sponsorPrivateKey, this.provider);
    
    // Initialize batch signature verifier
    this.verifier = new BatchSignatureVerifier(config.chainId, config.batchExecutorContract);
    
    // Initialize batch executor contract
    this.batchExecutorContract = new Contract(
      config.batchExecutorContract,
      Q402_BATCH_EXECUTOR_ABI,
      this.sponsorWallet
    );

    logger.info('BatchTransactionSettler initialized', {
      network: config.network,
      chainId: config.chainId,
      sponsorAddress: config.sponsorAddress,
      batchExecutorContract: config.batchExecutorContract,
    });
  }

  /**
   * Get the current nonce for a user from the BatchExecutor contract
   */
  async getNonce(userAddress: string): Promise<number> {
    try {
      const nonce = await this.batchExecutorContract.getNonce(userAddress);
      return Number(nonce);
    } catch (error) {
      logger.error('Failed to fetch batch nonce', { userAddress, error: String(error) });
      return 0;
    }
  }

  /**
   * Compute the operations hash the same way the contract does
   */
  computeOperationsHash(operations: BatchOperation[]): string {
    const abiCoder = new AbiCoder();
    
    // Hash each operation
    const operationHashes: string[] = operations.map(op => {
      const opTypeCode = this.getOpTypeCode(op.type);
      const dataHash = keccak256(op.data || '0x');
      
      return keccak256(
        abiCoder.encode(
          ['bytes32', 'uint8', 'address', 'uint256', 'address', 'uint256', 'address', 'bytes32'],
          [
            keccak256(Buffer.from('Operation(uint8 opType,address tokenIn,uint256 amountIn,address tokenOut,uint256 minAmountOut,address target,bytes data)')),
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
   * Settle a batch of operations on-chain
   */
  async settleBatch(request: BatchSettleRequest, skipVerification: boolean = false): Promise<BatchSettleResponse> {
    const startTime = Date.now();
    
    try {
      logger.info('Starting batch settlement', {
        requestId: request.requestId,
        signer: request.signerAddress,
        operationCount: request.operations.length,
        skipVerification,
      });

      // 1. Verify signature (skip if already verified by caller)
      if (!skipVerification) {
        const verification = await this.verifier.verify({
          witness: request.witness,
          operations: request.operations,
          signature: request.signature,
          signerAddress: request.signerAddress,
        });

        if (!verification.valid) {
          return {
            success: false,
            error: verification.error || 'Batch signature verification failed',
          };
        }
      } else {
        logger.debug('Skipping batch verification (already verified by caller)');
      }

      // 2. Check budget limits
      const budgetCheck = this.checkBudget(request.signerAddress, request.operations.length);
      if (!budgetCheck.allowed) {
        return {
          success: false,
          error: budgetCheck.reason || 'Budget limit exceeded',
        };
      }

      // 3. Check sponsor wallet balance
      const sponsorBalance = await this.getSponsorBalance();
      const minBalanceWei = parseUnits('0.01', 18); // Need more for batch operations
      
      if (sponsorBalance < minBalanceWei) {
        logger.error('Sponsor wallet has insufficient funds for batch', {
          balance: formatUnits(sponsorBalance, 18),
          required: '0.01 BNB',
        });
        return {
          success: false,
          error: 'Facilitator has insufficient funds for batch gas sponsorship',
        };
      }

      // 4. Check gas price
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice || parseUnits(String(this.config.maxGasPriceGwei), 'gwei');
      
      if (gasPrice > parseUnits(String(this.config.maxGasPriceGwei), 'gwei')) {
        logger.warn('Gas price too high for batch', {
          current: formatUnits(gasPrice, 'gwei'),
          max: this.config.maxGasPriceGwei,
        });
        return {
          success: false,
          error: `Gas price too high: ${formatUnits(gasPrice, 'gwei')} gwei`,
        };
      }

      // 5. Prepare operations for contract call
      const contractOperations = request.operations.map(op => ({
        opType: this.getOpTypeCode(op.type),
        tokenIn: op.tokenIn,
        amountIn: BigInt(op.amountIn),
        tokenOut: op.tokenOut,
        minAmountOut: BigInt(op.minAmountOut),
        target: op.target,
        data: op.data || '0x',
      }));

      // 6. Prepare witness for contract call
      const contractWitness = {
        owner: request.witness.owner,
        operationsHash: request.witness.operationsHash,
        deadline: BigInt(request.witness.deadline),
        batchId: request.witness.batchId,
        nonce: BigInt(request.witness.nonce),
      };

      // 7. Estimate gas for the batch
      let gasEstimate: bigint;
      try {
        gasEstimate = await this.batchExecutorContract.executeBatch.estimateGas(
          contractWitness,
          contractOperations,
          request.signature
        );
        // Add 20% buffer for safety
        gasEstimate = (gasEstimate * BigInt(120)) / BigInt(100);
      } catch (estimateError) {
        logger.error('Gas estimation failed for batch', { error: String(estimateError) });
        // Use a reasonable default based on operation count
        gasEstimate = BigInt(300000 + (request.operations.length * 200000));
      }

      // 8. Submit batch transaction
      logger.info('Submitting batch to blockchain', {
        requestId: request.requestId,
        operationCount: request.operations.length,
        gasEstimate: gasEstimate.toString(),
        gasPrice: formatUnits(gasPrice, 'gwei'),
      });

      const tx: TransactionResponse = await this.batchExecutorContract.executeBatch(
        contractWitness,
        contractOperations,
        request.signature,
        {
          gasLimit: gasEstimate,
          gasPrice,
        }
      );

      // 9. Wait for confirmation
      const txReceipt = await tx.wait(1);

      if (!txReceipt || txReceipt.status !== 1) {
        this.stats.failCount++;
        return {
          success: false,
          txHash: tx.hash,
          error: 'Batch transaction failed on-chain',
        };
      }

      // 10. Update budget tracking
      const gasUsed = txReceipt.gasUsed;
      const effectiveGasPrice = txReceipt.gasPrice || gasPrice;
      this.updateBudget(request.signerAddress, gasUsed * effectiveGasPrice);

      // 11. Update stats
      this.stats.totalBatches++;
      this.stats.totalOperations += request.operations.length;
      this.stats.totalGasUsed += gasUsed;
      this.stats.successCount++;

      const duration = Date.now() - startTime;
      logger.info('Batch settlement successful', {
        requestId: request.requestId,
        txHash: txReceipt.hash,
        blockNumber: txReceipt.blockNumber,
        gasUsed: gasUsed.toString(),
        operationCount: request.operations.length,
        duration,
      });

      // 12. Parse operation results from events
      const operationResults = this.parseOperationResults(txReceipt, request.operations.length);

      // 13. Build response
      const receipt: TransactionReceipt = {
        transactionHash: txReceipt.hash,
        blockNumber: txReceipt.blockNumber,
        blockHash: txReceipt.blockHash,
        gasUsed: gasUsed.toString(),
        effectiveGasPrice: effectiveGasPrice.toString(),
        status: 'success',
        logs: txReceipt.logs.map(log => ({
          address: log.address,
          topics: [...log.topics],
          data: log.data,
        })),
      };

      return {
        success: true,
        txHash: txReceipt.hash,
        blockNumber: txReceipt.blockNumber,
        gasUsed: gasUsed.toString(),
        gasPrice: gasPrice.toString(),
        effectiveGasPrice: effectiveGasPrice.toString(),
        operationResults,
        receipt,
      };
    } catch (error) {
      this.stats.failCount++;
      const duration = Date.now() - startTime;
      
      logger.error('Batch settlement failed', {
        requestId: request.requestId,
        error: String(error),
        duration,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Batch settlement failed',
      };
    }
  }

  /**
   * Parse operation results from transaction receipt
   */
  private parseOperationResults(
    receipt: EthersReceipt,
    operationCount: number
  ): Array<{ index: number; success: boolean; amountOut?: string; error?: string }> {
    const results: Array<{ index: number; success: boolean; amountOut?: string; error?: string }> = [];
    
    // Look for OperationExecuted events
    for (let i = 0; i < operationCount; i++) {
      // In a successful batch, all operations succeeded
      results.push({
        index: i,
        success: true,
      });
    }
    
    return results;
  }

  /**
   * Get sponsor wallet balance
   */
  async getSponsorBalance(): Promise<bigint> {
    return this.provider.getBalance(this.config.sponsorAddress);
  }

  /**
   * Check if a batch is within budget limits
   */
  checkBudget(address: string, operationCount: number): BudgetCheckResult {
    const today = new Date().toISOString().split('T')[0];
    const record = this.dailyBudget.get(today);

    if (!record) {
      return {
        allowed: true,
        remainingDailyBudget: this.config.dailyGasBudgetWei,
        addressTransactionsToday: 0,
      };
    }

    // Check daily budget
    const dailyUsed = BigInt(record.totalGasUsedWei);
    const dailyLimit = BigInt(this.config.dailyGasBudgetWei);
    
    if (dailyUsed >= dailyLimit) {
      return {
        allowed: false,
        reason: 'Daily gas budget exceeded',
        remainingDailyBudget: '0',
      };
    }

    // Check per-address limits (batches count as multiple transactions)
    const normalizedAddress = getAddress(address).toLowerCase();
    const addressBudget = record.addresses.get(normalizedAddress);
    
    const effectiveTxCount = (addressBudget?.transactionCount || 0) + operationCount;
    if (effectiveTxCount > this.config.maxRequestsPerAddress) {
      return {
        allowed: false,
        reason: `Address would exceed daily transaction limit (${this.config.maxRequestsPerAddress})`,
        addressTransactionsToday: addressBudget?.transactionCount || 0,
      };
    }

    return {
      allowed: true,
      remainingDailyBudget: (dailyLimit - dailyUsed).toString(),
      addressTransactionsToday: addressBudget?.transactionCount || 0,
    };
  }

  /**
   * Update budget after a batch
   */
  private updateBudget(address: string, gasUsedWei: bigint): void {
    const today = new Date().toISOString().split('T')[0];
    let record = this.dailyBudget.get(today);

    if (!record) {
      record = {
        date: today,
        totalGasUsedWei: '0',
        transactionCount: 0,
        addresses: new Map(),
      };
      this.dailyBudget.set(today, record);
    }

    // Update totals
    record.totalGasUsedWei = (BigInt(record.totalGasUsedWei) + gasUsedWei).toString();
    record.transactionCount++;

    // Update per-address tracking
    const normalizedAddress = getAddress(address).toLowerCase();
    let addressBudget = record.addresses.get(normalizedAddress);

    if (!addressBudget) {
      addressBudget = {
        address: normalizedAddress,
        gasUsedWei: '0',
        transactionCount: 0,
        lastRequestTime: 0,
        requestsThisMinute: 0,
      };
      record.addresses.set(normalizedAddress, addressBudget);
    }

    addressBudget.gasUsedWei = (BigInt(addressBudget.gasUsedWei) + gasUsedWei).toString();
    addressBudget.transactionCount++;
    addressBudget.lastRequestTime = Date.now();

    logger.info('Batch budget updated', {
      address: normalizedAddress,
      dailyTotal: record.totalGasUsedWei,
      addressTotal: addressBudget.gasUsedWei,
      addressTxCount: addressBudget.transactionCount,
    });
  }

  /**
   * Get batch settler statistics
   */
  getStats() {
    return {
      totalBatches: this.stats.totalBatches,
      totalOperations: this.stats.totalOperations,
      totalGasSponsored: this.stats.totalGasUsed.toString(),
      successCount: this.stats.successCount,
      failCount: this.stats.failCount,
      successRate: this.stats.totalBatches > 0 
        ? (this.stats.successCount / this.stats.totalBatches) * 100 
        : 0,
      averageOperationsPerBatch: this.stats.totalBatches > 0
        ? this.stats.totalOperations / this.stats.totalBatches
        : 0,
    };
  }

  /**
   * Get signature verifier
   */
  getVerifier(): BatchSignatureVerifier {
    return this.verifier;
  }

  /**
   * Clean up old budget records
   */
  cleanupOldBudgets(daysToKeep: number = 7): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];
    
    let cleaned = 0;
    for (const [date] of this.dailyBudget.entries()) {
      if (date < cutoffStr) {
        this.dailyBudget.delete(date);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info('Cleaned up old batch budget records', { count: cleaned });
    }

    return cleaned;
  }
}

/**
 * Create a batch transaction settler instance
 */
export function createBatchTransactionSettler(config: BatchExecutorConfig): BatchTransactionSettler {
  return new BatchTransactionSettler(config);
}

