import { isAddress } from 'ethers';
import type { PolicyWithLists, Policy, SecurityLevel } from '@/lib/types';
import { DEFAULT_POLICY_VALUES } from '@/lib/types/policy';

const VALID_SECURITY_LEVELS: SecurityLevel[] = ['STRICT', 'NORMAL', 'PERMISSIVE'];

/**
 * Validate policy values
 */
export function validatePolicy(policy: Partial<Policy>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Validate security level
  if (policy.securityLevel !== undefined) {
    if (!VALID_SECURITY_LEVELS.includes(policy.securityLevel)) {
      errors.push('Security level must be STRICT, NORMAL, or PERMISSIVE');
    }
  }

  // Validate maxPerTxUsd
  if (policy.maxPerTxUsd !== undefined && policy.maxPerTxUsd !== null) {
    if (typeof policy.maxPerTxUsd !== 'number' || policy.maxPerTxUsd < 0) {
      errors.push('Per-transaction limit must be a positive number');
    }
  }

  // Validate maxDailyUsd
  if (policy.maxDailyUsd !== undefined && policy.maxDailyUsd !== null) {
    if (typeof policy.maxDailyUsd !== 'number' || policy.maxDailyUsd < 0) {
      errors.push('Daily limit must be a positive number');
    }
  }

  // Validate slippage
  if (policy.maxSlippageBps !== undefined) {
    if (
      typeof policy.maxSlippageBps !== 'number' ||
      policy.maxSlippageBps < 0 ||
      policy.maxSlippageBps > 10000
    ) {
      errors.push('Slippage must be between 0 and 10000 basis points (0-100%)');
    }
  }

  // Validate large transaction threshold
  if (policy.largeTransactionThresholdPct !== undefined) {
    if (
      typeof policy.largeTransactionThresholdPct !== 'number' ||
      policy.largeTransactionThresholdPct < 1 ||
      policy.largeTransactionThresholdPct > 100
    ) {
      errors.push('Large transaction threshold must be between 1 and 100 percent');
    }
  }

  // Cross-validate limits
  if (
    policy.maxPerTxUsd !== null &&
    policy.maxDailyUsd !== null &&
    policy.maxPerTxUsd !== undefined &&
    policy.maxDailyUsd !== undefined &&
    policy.maxPerTxUsd > policy.maxDailyUsd
  ) {
    errors.push('Per-transaction limit cannot exceed daily limit');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate an address for allow/deny lists
 */
export function validateListAddress(address: string): {
  valid: boolean;
  error?: string;
} {
  if (!address) {
    return { valid: false, error: 'Address is required' };
  }

  if (!isAddress(address)) {
    return { valid: false, error: 'Invalid address format' };
  }

  return { valid: true };
}

/**
 * Normalize policy with defaults
 */
export function normalizePolicy(
  policy: Partial<Policy>
): Omit<Policy, 'id' | 'sessionId' | 'createdAt' | 'updatedAt'> {
  return {
    securityLevel: policy.securityLevel ?? DEFAULT_POLICY_VALUES.securityLevel,
    maxPerTxUsd: policy.maxPerTxUsd ?? DEFAULT_POLICY_VALUES.maxPerTxUsd,
    maxDailyUsd: policy.maxDailyUsd ?? DEFAULT_POLICY_VALUES.maxDailyUsd,
    requireVerifiedContracts: policy.requireVerifiedContracts ?? DEFAULT_POLICY_VALUES.requireVerifiedContracts,
    largeTransactionThresholdPct: policy.largeTransactionThresholdPct ?? DEFAULT_POLICY_VALUES.largeTransactionThresholdPct,
    maxSlippageBps: policy.maxSlippageBps ?? DEFAULT_POLICY_VALUES.maxSlippageBps,
  };
}

/**
 * Create empty policy with lists
 */
export function createEmptyPolicyWithLists(
  sessionId: string
): Omit<PolicyWithLists, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    sessionId,
    ...DEFAULT_POLICY_VALUES,
    allowedTokens: [],
    deniedTokens: [],
    allowedContracts: [],
    deniedContracts: [],
  };
}

/**
 * Merge policy updates
 */
export function mergePolicyUpdate(
  current: PolicyWithLists,
  updates: Partial<Policy>
): PolicyWithLists {
  return {
    ...current,
    securityLevel: updates.securityLevel !== undefined 
      ? updates.securityLevel 
      : current.securityLevel,
    maxPerTxUsd: updates.maxPerTxUsd !== undefined ? updates.maxPerTxUsd : current.maxPerTxUsd,
    maxDailyUsd: updates.maxDailyUsd !== undefined ? updates.maxDailyUsd : current.maxDailyUsd,
    requireVerifiedContracts: updates.requireVerifiedContracts !== undefined 
      ? updates.requireVerifiedContracts 
      : current.requireVerifiedContracts,
    largeTransactionThresholdPct: updates.largeTransactionThresholdPct !== undefined 
      ? updates.largeTransactionThresholdPct 
      : current.largeTransactionThresholdPct,
    maxSlippageBps: updates.maxSlippageBps !== undefined 
      ? updates.maxSlippageBps 
      : current.maxSlippageBps,
  };
}

/**
 * Check if an address should be blocked
 */
export function shouldBlockAddress(
  address: string,
  policy: PolicyWithLists,
  type: 'token' | 'contract'
): { blocked: boolean; reason?: string } {
  const normalized = address.toLowerCase();
  
  if (type === 'token') {
    if (policy.deniedTokens.some(t => t.toLowerCase() === normalized)) {
      return { blocked: true, reason: 'Token is on deny list' };
    }
  } else {
    if (policy.deniedContracts.some(c => c.toLowerCase() === normalized)) {
      return { blocked: true, reason: 'Contract is on deny list' };
    }
  }

  return { blocked: false };
}

/**
 * Format policy for display
 */
export function formatPolicyForDisplay(policy: PolicyWithLists): {
  securityLevel: string;
  perTxLimit: string;
  dailyLimit: string;
  slippage: string;
  largeTransactionWarning: string;
  requireVerifiedContracts: string;
  allowedTokens: number;
  deniedTokens: number;
  allowedContracts: number;
  deniedContracts: number;
} {
  const securityLevelLabels = {
    STRICT: 'Strict (Whitelist Only)',
    NORMAL: 'Normal (Balanced)',
    PERMISSIVE: 'Permissive (Allow All)',
  };
  
  return {
    securityLevel: securityLevelLabels[policy.securityLevel] || 'Normal',
    perTxLimit: policy.maxPerTxUsd !== null ? `$${policy.maxPerTxUsd}` : 'No limit',
    dailyLimit: policy.maxDailyUsd !== null ? `$${policy.maxDailyUsd}` : 'No limit',
    slippage: `${policy.maxSlippageBps / 100}%`,
    largeTransactionWarning: `${policy.largeTransactionThresholdPct}% of balance`,
    requireVerifiedContracts: policy.requireVerifiedContracts ? 'Required' : 'Optional',
    allowedTokens: policy.allowedTokens.length,
    deniedTokens: policy.deniedTokens.length,
    allowedContracts: policy.allowedContracts.length,
    deniedContracts: policy.deniedContracts.length,
  };
}

/**
 * Validate transaction value against policy
 */
export function validateTransactionValue(
  valueUsd: number,
  todaySpendUsd: number,
  policy: PolicyWithLists
): { allowed: boolean; errors: string[] } {
  const errors: string[] = [];

  if (policy.maxPerTxUsd !== null && valueUsd > policy.maxPerTxUsd) {
    errors.push(`Exceeds per-transaction limit of $${policy.maxPerTxUsd}`);
  }

  if (policy.maxDailyUsd !== null) {
    const newTotal = todaySpendUsd + valueUsd;
    if (newTotal > policy.maxDailyUsd) {
      errors.push(`Would exceed daily limit of $${policy.maxDailyUsd}`);
    }
  }

  return {
    allowed: errors.length === 0,
    errors,
  };
}

