/**
 * Q402 Facilitator Service
 * 
 * Main entry point for the facilitator service that handles:
 * 1. Signature verification (EIP-712)
 * 2. Transaction settlement with gas sponsorship
 * 3. Budget and rate limiting
 * 4. Multi-network support
 * 
 * @see https://github.com/quackai-labs/Q402
 */

import { parseUnits, getAddress } from 'ethers';
import type { Q402Network, Q402Witness } from '../q402/types';
import type {
  FacilitatorConfig,
  NetworkConfig,
  VerifyRequest,
  VerifyResponse,
  SettleRequest,
  SettleResponse,
  HealthStatus,
  HealthCheck,
  FacilitatorStats,
  SupportedToken,
} from './types';
import { SignatureVerifier, createSignatureVerifier } from './verifier';
import { TransactionSettler, createTransactionSettler } from './settler';
import { NETWORKS, Q402_CONTRACTS, TOKENS, type NetworkType } from '@/lib/utils/constants';
import { logger } from '@/lib/utils';

export * from './types';
export { SignatureVerifier, createSignatureVerifier } from './verifier';
export { TransactionSettler, createTransactionSettler } from './settler';
export { BatchSignatureVerifier, createBatchSignatureVerifier } from './batch-verifier';
export { BatchTransactionSettler, createBatchTransactionSettler } from './batch-settler';
export type { BatchSettleRequest, BatchSettleResponse, BatchExecutorConfig } from './batch-settler';

/**
 * Q402 Facilitator Service
 * 
 * Main service class that orchestrates verification and settlement
 */
export class FacilitatorService {
  private settlers: Map<Q402Network, TransactionSettler> = new Map();
  private verifiers: Map<Q402Network, SignatureVerifier> = new Map();
  private startTime: number;
  private initialized: boolean = false;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Initialize the facilitator for a specific network
   */
  async initialize(network: NetworkType): Promise<void> {
    const q402Network = this.toQ402Network(network);
    
    // Skip if already initialized
    if (this.settlers.has(q402Network)) {
      return;
    }

    const config = this.getConfigForNetwork(network);
    
    if (!config.sponsorPrivateKey) {
      throw new Error(`FACILITATOR_PRIVATE_KEY environment variable is required for ${network}`);
    }

    // Create verifier
    const verifier = createSignatureVerifier(config.chainId, config.verifyingContract);
    this.verifiers.set(q402Network, verifier);

    // Create settler
    const settler = createTransactionSettler(config);
    this.settlers.set(q402Network, settler);

    this.initialized = true;

    logger.info('Facilitator initialized', {
      network: q402Network,
      chainId: config.chainId,
      sponsorAddress: config.sponsorAddress,
    });
  }

  /**
   * Initialize for all supported networks
   */
  async initializeAll(): Promise<void> {
    await this.initialize('testnet');
    await this.initialize('mainnet');
  }

  /**
   * Verify a payment signature
   */
  async verify(request: VerifyRequest): Promise<VerifyResponse> {
    const verifier = this.verifiers.get(request.networkId);
    
    if (!verifier) {
      return {
        valid: false,
        error: `Network ${request.networkId} not initialized`,
      };
    }

    return verifier.verify(request);
  }

  /**
   * Settle a payment on-chain
   * 
   * @param request - The settle request
   * @param skipVerification - If true, skips signature verification (caller already verified)
   */
  async settle(request: SettleRequest, skipVerification: boolean = false): Promise<SettleResponse> {
    const settler = this.settlers.get(request.networkId);
    
    if (!settler) {
      return {
        success: false,
        error: `Network ${request.networkId} not initialized`,
      };
    }

    return settler.settle(request, skipVerification);
  }

  /**
   * Get supported networks and tokens
   */
  getSupported(): { networks: NetworkConfig[] } {
    const networks: NetworkConfig[] = [];

    // BSC Testnet
    if (this.settlers.has('bsc-testnet')) {
      networks.push({
        network: 'bsc-testnet',
        chainId: NETWORKS.testnet.chainId,
        rpcUrl: NETWORKS.testnet.rpcUrl,
        explorerUrl: NETWORKS.testnet.explorerUrl,
        implementationContract: Q402_CONTRACTS.testnet.implementation,
        verifyingContract: Q402_CONTRACTS.testnet.verifier,
        tokens: this.getSupportedTokens('testnet'),
      });
    }

    // BSC Mainnet
    if (this.settlers.has('bsc-mainnet')) {
      networks.push({
        network: 'bsc-mainnet',
        chainId: NETWORKS.mainnet.chainId,
        rpcUrl: NETWORKS.mainnet.rpcUrl,
        explorerUrl: NETWORKS.mainnet.explorerUrl,
        implementationContract: Q402_CONTRACTS.mainnet.implementation,
        verifyingContract: Q402_CONTRACTS.mainnet.verifier,
        tokens: this.getSupportedTokens('mainnet'),
      });
    }

    return { networks };
  }

  /**
   * Get health status
   */
  async getHealth(): Promise<HealthStatus> {
    const checks: HealthCheck[] = [];
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    // Check each network
    for (const [network, settler] of this.settlers.entries()) {
      try {
        const balance = await settler.getSponsorBalance();
        const balanceBNB = Number(balance) / 1e18;
        
        if (balanceBNB < 0.01) {
          checks.push({
            name: `${network}_sponsor_balance`,
            status: 'fail',
            message: `Low balance: ${balanceBNB.toFixed(4)} BNB`,
          });
          overallStatus = 'unhealthy';
        } else if (balanceBNB < 0.1) {
          checks.push({
            name: `${network}_sponsor_balance`,
            status: 'warn',
            message: `Balance getting low: ${balanceBNB.toFixed(4)} BNB`,
          });
          if (overallStatus === 'healthy') overallStatus = 'degraded';
        } else {
          checks.push({
            name: `${network}_sponsor_balance`,
            status: 'pass',
            message: `Balance: ${balanceBNB.toFixed(4)} BNB`,
          });
        }
      } catch (error) {
        checks.push({
          name: `${network}_rpc`,
          status: 'fail',
          message: `RPC error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
        overallStatus = 'unhealthy';
      }
    }

    // Overall initialization check
    if (!this.initialized) {
      checks.push({
        name: 'initialization',
        status: 'fail',
        message: 'Facilitator not initialized',
      });
      overallStatus = 'unhealthy';
    } else {
      checks.push({
        name: 'initialization',
        status: 'pass',
        message: 'Facilitator initialized',
      });
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      uptime: Date.now() - this.startTime,
      checks,
    };
  }

  /**
   * Get facilitator statistics
   */
  getStats(): FacilitatorStats {
    let totalTransactions = 0;
    let totalGasSponsored = BigInt(0);
    let successCount = 0;
    let failCount = 0;
    const uniqueAddresses = new Set<string>();

    for (const settler of this.settlers.values()) {
      const stats = settler.getStats();
      totalTransactions += stats.totalTransactions;
      totalGasSponsored += BigInt(stats.totalGasSponsored);
      successCount += stats.successCount;
      failCount += stats.failCount;
    }

    return {
      totalTransactions,
      totalGasSponsored: totalGasSponsored.toString(),
      successRate: totalTransactions > 0 ? (successCount / totalTransactions) * 100 : 0,
      averageGasPerTx: totalTransactions > 0 
        ? (totalGasSponsored / BigInt(totalTransactions)).toString()
        : '0',
      uniqueAddresses: uniqueAddresses.size,
    };
  }

  /**
   * Get configuration for a network
   */
  private getConfigForNetwork(network: NetworkType): FacilitatorConfig {
    const q402Network = this.toQ402Network(network);
    const networkConfig = NETWORKS[network];
    const contracts = Q402_CONTRACTS[network];

    // Get sponsor private key from environment
    const sponsorPrivateKey = process.env.FACILITATOR_PRIVATE_KEY || '';
    
    // Derive address from private key (if provided)
    let sponsorAddress = process.env.FACILITATOR_ADDRESS || '';
    if (sponsorPrivateKey && !sponsorAddress) {
      try {
        const { Wallet } = require('ethers');
        const wallet = new Wallet(sponsorPrivateKey);
        sponsorAddress = wallet.address;
      } catch {
        sponsorAddress = '';
      }
    }

    // Get implementation whitelist
    const whitelistEnv = process.env.IMPLEMENTATION_WHITELIST || '';
    const implementationWhitelist = whitelistEnv
      .split(',')
      .map(addr => addr.trim())
      .filter(addr => addr.length > 0);

    // Add default implementation to whitelist
    if (!implementationWhitelist.includes(contracts.implementation)) {
      implementationWhitelist.push(contracts.implementation);
    }

    return {
      network: q402Network,
      chainId: networkConfig.chainId,
      rpcUrl: network === 'testnet' 
        ? (process.env.RPC_URL_BSC_TESTNET || networkConfig.rpcUrl)
        : (process.env.RPC_URL_BSC_MAINNET || networkConfig.rpcUrl),
      
      sponsorPrivateKey,
      sponsorAddress,
      
      implementationContract: contracts.implementation,
      verifyingContract: contracts.verifier,
      
      implementationWhitelist,
      maxGasPriceGwei: parseInt(process.env.MAX_GAS_PRICE_GWEI || '20'),
      maxGasLimit: parseInt(process.env.MAX_GAS_LIMIT || '5000000'),
      
      dailyGasBudgetWei: parseUnits(
        process.env.DAILY_GAS_BUDGET_BNB || '1',
        18
      ).toString(),
      perTransactionMaxGasWei: parseUnits(
        process.env.PER_TX_MAX_GAS_BNB || '0.01',
        18
      ).toString(),
      
      maxRequestsPerMinute: parseInt(process.env.MAX_REQUESTS_PER_MINUTE || '10'),
      maxRequestsPerAddress: parseInt(process.env.MAX_REQUESTS_PER_ADDRESS || '100'),
    };
  }

  /**
   * Get supported tokens for a network
   */
  private getSupportedTokens(network: NetworkType): SupportedToken[] {
    const tokens = TOKENS[network];
    return [
      {
        address: '0x0000000000000000000000000000000000000000',
        symbol: network === 'testnet' ? 'tBNB' : 'BNB',
        decimals: 18,
        name: 'BNB',
      },
      {
        address: tokens.USDT,
        symbol: 'USDT',
        decimals: 18,
        name: 'Tether USD',
      },
      {
        address: tokens.USDC,
        symbol: 'USDC',
        decimals: 18,
        name: 'USD Coin',
      },
      {
        address: tokens.BUSD,
        symbol: 'BUSD',
        decimals: 18,
        name: 'Binance USD',
      },
    ];
  }

  /**
   * Convert NetworkType to Q402Network
   */
  private toQ402Network(network: NetworkType): Q402Network {
    return network === 'mainnet' ? 'bsc-mainnet' : 'bsc-testnet';
  }

  /**
   * Check if a network is initialized
   */
  isNetworkInitialized(network: Q402Network): boolean {
    return this.settlers.has(network);
  }
}

// Singleton instance
let facilitatorInstance: FacilitatorService | null = null;

/**
 * Get the facilitator service instance (singleton)
 */
export function getFacilitatorService(): FacilitatorService {
  if (!facilitatorInstance) {
    facilitatorInstance = new FacilitatorService();
  }
  return facilitatorInstance;
}

/**
 * Initialize the facilitator service
 */
export async function initializeFacilitator(network?: NetworkType): Promise<FacilitatorService> {
  const service = getFacilitatorService();
  
  if (network) {
    await service.initialize(network);
  } else {
    // Default to testnet if no network specified
    await service.initialize('testnet');
  }
  
  return service;
}

