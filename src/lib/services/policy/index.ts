import type {
  PolicyWithLists,
  PolicyEvaluationContext,
  PolicyEvaluationResult,
  RiskLevel,
  PreparedTx,
  TransactionType,
} from '@/lib/types';
import { evaluatePolicy, assessRisk, isAddressAllowed } from './evaluator';
import {
  validatePolicy,
  validateListAddress,
  normalizePolicy,
  createEmptyPolicyWithLists,
  mergePolicyUpdate,
  shouldBlockAddress,
  formatPolicyForDisplay,
  validateTransactionValue,
} from './validators';
import { type NetworkType } from '@/lib/utils/constants';
import { logger } from '@/lib/utils';

export {
  evaluatePolicy,
  assessRisk,
  isAddressAllowed,
  validatePolicy,
  validateListAddress,
  normalizePolicy,
  createEmptyPolicyWithLists,
  mergePolicyUpdate,
  shouldBlockAddress,
  formatPolicyForDisplay,
  validateTransactionValue,
};

/**
 * Policy Engine - Main service for policy evaluation
 */
export class PolicyEngine {
  private policy: PolicyWithLists;
  private network: NetworkType;

  constructor(policy: PolicyWithLists, network: NetworkType) {
    this.policy = policy;
    this.network = network;
  }

  /**
   * Evaluate a transaction against the policy
   */
  async evaluate(
    transactionType: TransactionType | string,
    params: {
      targetAddress?: string;
      tokenAddress?: string;
      valueUsd?: number;
      slippageBps?: number;
      contractAuditRisk?: RiskLevel;
      isContractKnown?: boolean;
      holdingsPercentage?: number;
    },
    todaySpendUsd: number,
    walletAddress: string
  ): Promise<PolicyEvaluationResult> {
    const context: PolicyEvaluationContext = {
      policy: this.policy,
      network: this.network,
      walletAddress,
      transactionType,
      targetAddress: params.targetAddress,
      tokenAddress: params.tokenAddress,
      valueUsd: params.valueUsd,
      slippageBps: params.slippageBps,
      contractAuditRisk: params.contractAuditRisk,
      isContractKnown: params.isContractKnown,
      holdingsPercentage: params.holdingsPercentage,
      todaySpendUsd,
    };

    return evaluatePolicy(context);
  }

  /**
   * Quick check if a transaction is allowed
   */
  quickCheck(
    targetAddress?: string,
    tokenAddress?: string,
    valueUsd?: number
  ): { allowed: boolean; reason?: string } {
    // Check deny lists
    if (targetAddress) {
      const contractCheck = shouldBlockAddress(targetAddress, this.policy, 'contract');
      if (contractCheck.blocked) {
        return { allowed: false, reason: contractCheck.reason };
      }
    }

    if (tokenAddress) {
      const tokenCheck = shouldBlockAddress(tokenAddress, this.policy, 'token');
      if (tokenCheck.blocked) {
        return { allowed: false, reason: tokenCheck.reason };
      }
    }

    // Check per-tx limit
    if (valueUsd !== undefined && this.policy.maxPerTxUsd !== null) {
      if (valueUsd > this.policy.maxPerTxUsd) {
        return { 
          allowed: false, 
          reason: `Exceeds per-transaction limit of $${this.policy.maxPerTxUsd}` 
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Update policy
   */
  updatePolicy(updates: Partial<PolicyWithLists>): void {
    this.policy = mergePolicyUpdate(this.policy, updates);
  }

  /**
   * Get current policy
   */
  getPolicy(): PolicyWithLists {
    return this.policy;
  }

  /**
   * Add address to allow/deny list
   */
  addToList(
    address: string,
    type: 'token' | 'contract',
    listType: 'allowed' | 'denied'
  ): { success: boolean; error?: string } {
    const validation = validateListAddress(address);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const normalized = address.toLowerCase();
    const list = this.getListByType(type, listType);

    if (list.some(a => a.toLowerCase() === normalized)) {
      return { success: false, error: 'Address already in list' };
    }

    // Remove from opposite list if present
    this.removeFromOppositeList(normalized, type, listType);

    list.push(address);
    return { success: true };
  }

  /**
   * Remove address from list
   */
  removeFromList(
    address: string,
    type: 'token' | 'contract',
    listType: 'allowed' | 'denied'
  ): boolean {
    const normalized = address.toLowerCase();
    const list = this.getListByType(type, listType);
    const index = list.findIndex(a => a.toLowerCase() === normalized);

    if (index === -1) return false;

    list.splice(index, 1);
    return true;
  }

  private getListByType(
    type: 'token' | 'contract',
    listType: 'allowed' | 'denied'
  ): string[] {
    if (type === 'token') {
      return listType === 'allowed' ? this.policy.allowedTokens : this.policy.deniedTokens;
    }
    return listType === 'allowed' ? this.policy.allowedContracts : this.policy.deniedContracts;
  }

  private removeFromOppositeList(
    address: string,
    type: 'token' | 'contract',
    currentList: 'allowed' | 'denied'
  ): void {
    const oppositeList = this.getListByType(
      type,
      currentList === 'allowed' ? 'denied' : 'allowed'
    );
    const index = oppositeList.findIndex(a => a.toLowerCase() === address);
    if (index !== -1) {
      oppositeList.splice(index, 1);
    }
  }
}

/**
 * Create policy engine instance
 */
export function createPolicyEngine(
  policy: PolicyWithLists,
  network: NetworkType
): PolicyEngine {
  return new PolicyEngine(policy, network);
}

/**
 * Get default policy for new users
 */
export function getDefaultPolicy(sessionId: string): PolicyWithLists {
  return {
    id: '',
    sessionId,
    maxPerTxUsd: 1000,
    maxDailyUsd: 5000,
    allowUnknownContracts: false,
    maxSlippageBps: 300,
    allowedTokens: [],
    deniedTokens: [],
    allowedContracts: [],
    deniedContracts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

