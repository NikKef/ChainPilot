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
   * 
   * @param request - The settle request
   * @param skipVerification - If true, skips signature verification (caller already verified)
   */
  async settle(request: SettleRequest, skipVerification: boolean = false): Promise<SettleResponse> {
    const startTime = Date.now();
    
    try {
      logger.info('Starting settlement', {
        requestId: request.requestId,
        signer: request.signerAddress,
        skipVerification,
      });

      // 1. Verify signature (skip if already verified by caller)
      if (!skipVerification) {
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
      } else {
        logger.debug('Skipping verification (already verified by caller)');
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
      const minBalanceWei = parseUnits('0.001', 18); // Minimum 0.001 BNB (lowered for testnet)
      
      if (sponsorBalance < minBalanceWei) {
        logger.error('Sponsor wallet has insufficient funds', {
          balance: formatUnits(sponsorBalance, 18),
          required: '0.001 BNB',
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

      // Check if this is a token payment (non-native token in witness)
      // For token payments, we MUST use the Q402 contract's executeTransfer
      // because the facilitator cannot directly call ERC20.transfer (it doesn't own the tokens)
      const isTokenPayment = request.witness.token !== '0x0000000000000000000000000000000000000000';
      
      if (isTokenPayment) {
        // Token transfers MUST go through Q402 contract
        // The Q402 contract will call transferFrom with user's prior approval
        logger.info('Using Q402 contract for token transfer', {
          token: request.witness.token,
          amount: request.witness.amount,
          owner: request.witness.owner,
          recipient: request.witness.to,
        });
        txResponse = await this.executePaymentTransaction(request, gasPrice);
      } else if (request.transaction && request.transaction.data && request.transaction.data !== '0x') {
        // Custom contract interaction (swaps, other contract calls)
        // These should be designed to use the user's funds via approval/permit
        txResponse = await this.executeCustomTransaction(request, gasPrice);
      } else {
        // Native BNB payment via Q402 contract
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
    // Ensure proper parameter types
    const owner = getAddress(request.witness.owner);
    const facilitator = getAddress(this.config.sponsorAddress);
    const token = getAddress(request.witness.token);
    const recipient = getAddress(request.witness.to);
    const amount = BigInt(request.witness.amount);
    const nonce = BigInt(request.witness.nonce);
    const deadline = BigInt(request.witness.deadline);
    const signature = request.signature;

    logger.info('Executing payment transaction', {
      owner,
      facilitator,
      token,
      amount: amount.toString(),
      recipient,
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      signatureLength: signature?.length,
      signaturePreview: signature?.slice(0, 20),
    });

    // Try a static call first to see if it would revert
    try {
      await this.implementationContract.executeTransfer.staticCall(
        owner,
        facilitator,
        token,
        recipient,
        amount,
        nonce,
        deadline,
        signature
      );
      logger.debug('Static call passed - transaction should succeed');
    } catch (staticCallError) {
      logger.error('Static call failed - transaction would revert', {
        error: staticCallError instanceof Error ? staticCallError.message : String(staticCallError),
      });
      // Still try the actual transaction to get the on-chain error
    }

    // Populate the transaction to see the encoded data
    const populatedTx = await this.implementationContract.executeTransfer.populateTransaction(
      owner,
      facilitator,
      token,
      recipient,
      amount,
      nonce,
      deadline,
      signature
    );

    logger.debug('Populated executeTransfer transaction', {
      to: populatedTx.to,
      data: populatedTx.data?.slice(0, 138),
      dataLength: populatedTx.data?.length,
    });

    // Call the implementation contract
    const tx = await this.sponsorWallet.sendTransaction({
      to: this.config.implementationContract,
      data: populatedTx.data,
      value: BigInt(0),
      gasLimit: this.config.maxGasLimit,
      gasPrice,
    });

    return tx;
  }

  /**
   * Execute a custom transaction (for general actions like transfers, swaps)
   * 
   * SECURITY: The facilitator should NEVER send funds from its own wallet.
   * It should only pay gas to execute transactions that use the USER's funds
   * via smart contract interactions (approve/transferFrom pattern).
   * 
   * For native BNB transfers: Requires Q402 contract with user's pre-deposited funds
   * For ERC20 transfers: Requires user's prior approval to the Q402 contract
   */
  private async executeCustomTransaction(
    request: SettleRequest,
    gasPrice: bigint
  ): Promise<TransactionResponse> {
    if (!request.transaction) {
      throw new Error('Transaction data required for custom execution');
    }

    const txValue = BigInt(request.transaction.value || '0');
    const hasData = request.transaction.data && request.transaction.data !== '0x';

    logger.info('Analyzing custom transaction', {
      to: request.transaction.to,
      value: request.transaction.value,
      hasData,
      isNativeTransfer: txValue > BigInt(0) && !hasData,
    });

    // SECURITY CHECK: Prevent facilitator from sending its own funds
    // Native BNB transfers (value > 0 with no contract data) are NOT supported
    // via facilitator because we cannot move user's native BNB without their direct signature
    if (txValue > BigInt(0) && !hasData) {
      logger.error('SECURITY: Native BNB transfers cannot be executed via facilitator', {
        requestedValue: formatUnits(txValue, 18),
        to: request.transaction.to,
        signerAddress: request.signerAddress,
      });
      
      throw new Error(
        'Native BNB transfers require direct wallet execution. ' +
        'The facilitator can only sponsor gas for smart contract interactions ' +
        '(ERC20 transfers, swaps, etc.) where the user has pre-approved the contract.'
      );
    }

    // For contract interactions (hasData = true), we execute the call
    // The contract should be designed to use the user's funds via approval/permit
    // The facilitator only pays gas - the actual tokens come from the user
    if (hasData) {
      // Extract and validate transaction data
      const txTo = request.transaction.to;
      const txData = request.transaction.data;
      
      // Ensure data is a valid hex string
      if (!txData || txData === '0x' || txData.length < 10) {
        throw new Error(`Invalid transaction data: ${txData}`);
      }
      
      logger.info('Executing contract interaction with gas sponsorship', {
        to: txTo,
        dataLength: txData.length,
        dataPreview: txData.slice(0, 74), // Show function selector + first param
      });

      // Get the current nonce for the sponsor wallet
      const nonce = await this.provider.getTransactionCount(this.config.sponsorAddress, 'pending');
      
      // Populate the transaction fully before sending
      // This ensures ethers.js doesn't modify any fields
      const populatedTx = await this.sponsorWallet.populateTransaction({
        to: txTo,
        data: txData,
        value: BigInt(0),
        gasLimit: BigInt(this.config.maxGasLimit),
        gasPrice,
        nonce,
        chainId: this.config.chainId,
      });
      
      logger.debug('Populated transaction', {
        to: populatedTx.to,
        data: populatedTx.data?.toString().slice(0, 74),
        dataLength: populatedTx.data?.toString().length,
        nonce: populatedTx.nonce?.toString(),
        chainId: populatedTx.chainId?.toString(),
        gasLimit: populatedTx.gasLimit?.toString(),
        gasPrice: populatedTx.gasPrice?.toString(),
      });

      // Sign and send the transaction
      const tx = await this.sponsorWallet.sendTransaction(populatedTx);

      return tx;
    }

    // If we reach here, something unexpected happened
    throw new Error('Transaction type not supported for gas sponsorship');
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

