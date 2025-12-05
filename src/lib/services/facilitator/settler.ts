/**
 * Q402 Transaction Settler
 * 
 * Responsible for submitting transactions on-chain with gas sponsorship.
 * The sponsor wallet pays all gas fees, enabling gasless transactions for users.
 * 
 * Key Features:
 * 1. Gas-sponsored transaction submission
 * 2. Budget tracking to prevent gas drain
 * 3. Retry logic for failed transactions
 * 4. Transaction receipt monitoring
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
  TransactionResponse,
  TransactionReceipt as EthersReceipt,
} from 'ethers';
import type { Q402Witness } from '../q402/types';
import type {
  FacilitatorConfig,
  SettleRequest,
  SettleResponse,
  TransactionReceipt,
  BudgetRecord,
  AddressBudget,
  BudgetCheckResult,
  ExecuteTransferParams,
} from './types';
import { Q402_IMPLEMENTATION_ABI, FacilitatorErrorCode } from './types';
import { SignatureVerifier } from './verifier';
import { logger } from '@/lib/utils';

/**
 * Transaction Settler Service
 * 
 * Handles on-chain transaction submission with gas sponsorship
 */
export class TransactionSettler {
  private config: FacilitatorConfig;
  private provider: JsonRpcProvider;
  private sponsorWallet: Wallet;
  private verifier: SignatureVerifier;
  private implementationContract: Contract;
  
  // Budget tracking
  private dailyBudget: Map<string, BudgetRecord> = new Map();
  private stats = {
    totalTransactions: 0,
    totalGasUsed: BigInt(0),
    successCount: 0,
    failCount: 0,
  };

  constructor(config: FacilitatorConfig) {
    this.config = config;
    
    // Initialize provider
    this.provider = new JsonRpcProvider(config.rpcUrl);
    
    // Initialize sponsor wallet
    this.sponsorWallet = new Wallet(config.sponsorPrivateKey, this.provider);
    
    // Initialize signature verifier
    this.verifier = new SignatureVerifier(config.chainId, config.verifyingContract);
    
    // Initialize implementation contract
    this.implementationContract = new Contract(
      config.implementationContract,
      Q402_IMPLEMENTATION_ABI,
      this.sponsorWallet
    );

    logger.info('TransactionSettler initialized', {
      network: config.network,
      chainId: config.chainId,
      sponsorAddress: config.sponsorAddress,
      implementationContract: config.implementationContract,
    });
  }

  /**
   * Settle a payment request on-chain
   */
  async settle(request: SettleRequest): Promise<SettleResponse> {
    const startTime = Date.now();
    
    try {
      logger.info('Starting settlement', {
        requestId: request.requestId,
        signer: request.signerAddress,
      });

      // 1. Verify signature first
      const verification = await this.verifier.verify({
        networkId: request.networkId,
        witness: request.witness,
        signature: request.signature,
        signerAddress: request.signerAddress,
      });

      if (!verification.valid) {
        return {
          success: false,
          error: verification.error || 'Signature verification failed',
        };
      }

      // 2. Check budget limits
      const budgetCheck = this.checkBudget(request.signerAddress);
      if (!budgetCheck.allowed) {
        return {
          success: false,
          error: budgetCheck.reason || 'Budget limit exceeded',
        };
      }

      // 3. Check sponsor wallet balance
      const sponsorBalance = await this.getSponsorBalance();
      const minBalanceWei = parseUnits('0.01', 18); // Minimum 0.01 BNB
      
      if (sponsorBalance < minBalanceWei) {
        logger.error('Sponsor wallet has insufficient funds', {
          balance: formatUnits(sponsorBalance, 18),
          required: '0.01 BNB',
        });
        return {
          success: false,
          error: 'Facilitator has insufficient funds for gas sponsorship',
        };
      }

      // 4. Check gas price
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice || parseUnits(String(this.config.maxGasPriceGwei), 'gwei');
      
      if (gasPrice > parseUnits(String(this.config.maxGasPriceGwei), 'gwei')) {
        logger.warn('Gas price too high', {
          current: formatUnits(gasPrice, 'gwei'),
          max: this.config.maxGasPriceGwei,
        });
        return {
          success: false,
          error: `Gas price too high: ${formatUnits(gasPrice, 'gwei')} gwei`,
        };
      }

      // 5. Submit transaction
      let txResponse: TransactionResponse;
      let txReceipt: EthersReceipt | null;

      if (request.transaction) {
        // Execute custom transaction (for transfers, swaps, etc.)
        txResponse = await this.executeCustomTransaction(request, gasPrice);
      } else {
        // Execute Q402 payment contract call
        txResponse = await this.executePaymentTransaction(request, gasPrice);
      }

      // 6. Wait for confirmation
      txReceipt = await txResponse.wait(1); // Wait for 1 confirmation

      if (!txReceipt) {
        return {
          success: false,
          error: 'Transaction failed - no receipt',
        };
      }

      // 7. Update nonce tracker
      this.verifier.markNonceUsed(request.witness.owner, request.witness.nonce);

      // 8. Update budget tracking
      const gasUsed = txReceipt.gasUsed;
      const effectiveGasPrice = txReceipt.gasPrice || gasPrice;
      this.updateBudget(request.signerAddress, gasUsed * effectiveGasPrice);

      // 9. Update stats
      this.stats.totalTransactions++;
      this.stats.totalGasUsed += gasUsed;
      this.stats.successCount++;

      const duration = Date.now() - startTime;
      logger.info('Settlement successful', {
        requestId: request.requestId,
        txHash: txReceipt.hash,
        blockNumber: txReceipt.blockNumber,
        gasUsed: gasUsed.toString(),
        duration,
      });

      // 10. Return success response
      const receipt: TransactionReceipt = {
        transactionHash: txReceipt.hash,
        blockNumber: txReceipt.blockNumber,
        blockHash: txReceipt.blockHash,
        gasUsed: gasUsed.toString(),
        effectiveGasPrice: effectiveGasPrice.toString(),
        status: txReceipt.status === 1 ? 'success' : 'failed',
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
        receipt,
      };
    } catch (error) {
      this.stats.failCount++;
      const duration = Date.now() - startTime;
      
      logger.error('Settlement failed', {
        requestId: request.requestId,
        error: String(error),
        duration,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Settlement failed',
      };
    }
  }

  /**
   * Execute a Q402 payment via the implementation contract
   */
  private async executePaymentTransaction(
    request: SettleRequest,
    gasPrice: bigint
  ): Promise<TransactionResponse> {
    const params: ExecuteTransferParams = {
      owner: request.witness.owner,
      facilitator: this.config.sponsorAddress,
      token: request.witness.token,
      recipient: request.witness.to,
      amount: request.witness.amount,
      nonce: request.witness.nonce,
      deadline: request.witness.deadline,
      signature: request.signature,
    };

    logger.info('Executing payment transaction', {
      owner: params.owner,
      token: params.token,
      amount: params.amount,
      recipient: params.recipient,
    });

    // Call the implementation contract
    const tx = await this.implementationContract.executeTransfer(
      params.owner,
      params.facilitator,
      params.token,
      params.recipient,
      params.amount,
      params.nonce,
      params.deadline,
      params.signature,
      {
        gasLimit: this.config.maxGasLimit,
        gasPrice,
      }
    );

    return tx;
  }

  /**
   * Execute a custom transaction (for general actions like transfers, swaps)
   */
  private async executeCustomTransaction(
    request: SettleRequest,
    gasPrice: bigint
  ): Promise<TransactionResponse> {
    if (!request.transaction) {
      throw new Error('Transaction data required for custom execution');
    }

    logger.info('Executing custom transaction', {
      to: request.transaction.to,
      value: request.transaction.value,
    });

    // Send the transaction from sponsor wallet
    const tx = await this.sponsorWallet.sendTransaction({
      to: request.transaction.to,
      data: request.transaction.data,
      value: BigInt(request.transaction.value || '0'),
      gasLimit: this.config.maxGasLimit,
      gasPrice,
    });

    return tx;
  }

  /**
   * Get sponsor wallet balance
   */
  async getSponsorBalance(): Promise<bigint> {
    return this.provider.getBalance(this.config.sponsorAddress);
  }

  /**
   * Check if a transaction is within budget limits
   */
  checkBudget(address: string): BudgetCheckResult {
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

    // Check per-address limits
    const normalizedAddress = getAddress(address).toLowerCase();
    const addressBudget = record.addresses.get(normalizedAddress);
    
    if (addressBudget && addressBudget.transactionCount >= this.config.maxRequestsPerAddress) {
      return {
        allowed: false,
        reason: `Address has exceeded daily transaction limit (${this.config.maxRequestsPerAddress})`,
        addressTransactionsToday: addressBudget.transactionCount,
      };
    }

    // Check rate limiting
    if (addressBudget) {
      const timeSinceLastRequest = Date.now() - addressBudget.lastRequestTime;
      if (timeSinceLastRequest < 1000 && addressBudget.requestsThisMinute >= this.config.maxRequestsPerMinute) {
        return {
          allowed: false,
          reason: 'Rate limit exceeded - too many requests per minute',
        };
      }
    }

    return {
      allowed: true,
      remainingDailyBudget: (dailyLimit - dailyUsed).toString(),
      addressTransactionsToday: addressBudget?.transactionCount || 0,
    };
  }

  /**
   * Update budget after a transaction
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
    
    const now = Date.now();
    if (now - addressBudget.lastRequestTime > 60000) {
      addressBudget.requestsThisMinute = 1;
    } else {
      addressBudget.requestsThisMinute++;
    }
    addressBudget.lastRequestTime = now;

    logger.info('Budget updated', {
      address: normalizedAddress,
      dailyTotal: record.totalGasUsedWei,
      addressTotal: addressBudget.gasUsedWei,
      addressTxCount: addressBudget.transactionCount,
    });
  }

  /**
   * Get facilitator statistics
   */
  getStats() {
    return {
      totalTransactions: this.stats.totalTransactions,
      totalGasSponsored: this.stats.totalGasUsed.toString(),
      successCount: this.stats.successCount,
      failCount: this.stats.failCount,
      successRate: this.stats.totalTransactions > 0 
        ? (this.stats.successCount / this.stats.totalTransactions) * 100 
        : 0,
    };
  }

  /**
   * Get signature verifier
   */
  getVerifier(): SignatureVerifier {
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
      logger.info('Cleaned up old budget records', { count: cleaned });
    }

    return cleaned;
  }
}

/**
 * Create a transaction settler instance
 */
export function createTransactionSettler(config: FacilitatorConfig): TransactionSettler {
  return new TransactionSettler(config);
}

