import type { RiskLevel } from './transaction';

/**
 * Security level for policy enforcement
 * - STRICT: Whitelist-only mode. Only allowed tokens/contracts work.
 * - NORMAL: Blacklist mode with warnings. Shows warnings for risky transactions.
 * - PERMISSIVE: Allow everything, ignore deny lists, no warnings.
 */
export type SecurityLevel = 'STRICT' | 'NORMAL' | 'PERMISSIVE';

/**
 * Security level configuration and descriptions
 */
export const SECURITY_LEVELS: Record<SecurityLevel, {
  label: string;
  description: string;
  color: string;
  icon: 'shield-alert' | 'shield' | 'shield-off';
}> = {
  STRICT: {
    label: 'Strict',
    description: 'Maximum security. Only whitelisted tokens and contracts allowed.',
    color: 'text-accent-red',
    icon: 'shield-alert',
  },
  NORMAL: {
    label: 'Normal',
    description: 'Balanced protection with warnings for risky transactions.',
    color: 'text-accent-amber',
    icon: 'shield',
  },
  PERMISSIVE: {
    label: 'Permissive',
    description: 'Minimal restrictions. You accept full responsibility.',
    color: 'text-accent-green',
    icon: 'shield-off',
  },
};

/**
 * User policy configuration
 */
export interface Policy {
  id: string;
  sessionId: string;
  securityLevel: SecurityLevel;
  maxPerTxUsd: number | null;
  maxDailyUsd: number | null;
  requireVerifiedContracts: boolean;
  largeTransactionThresholdPct: number;
  maxSlippageBps: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Policy with associated lists
 */
export interface PolicyWithLists extends Policy {
  allowedTokens: string[];
  deniedTokens: string[];
  allowedContracts: string[];
  deniedContracts: string[];
}

/**
 * Policy list entry
 */
export interface PolicyListEntry {
  id: string;
  policyId: string;
  address: string;
  listType: 'allowed' | 'denied';
  createdAt: string;
}

/**
 * Policy token list entry
 */
export interface PolicyTokenList extends PolicyListEntry {
  tokenAddress: string;
}

/**
 * Policy contract list entry
 */
export interface PolicyContractList extends PolicyListEntry {
  contractAddress: string;
}

/**
 * Policy evaluation context
 */
export interface PolicyEvaluationContext {
  policy: PolicyWithLists;
  network: 'testnet' | 'mainnet';
  walletAddress: string;
  
  // Transaction details
  transactionType: string;
  targetAddress?: string;
  tokenAddress?: string;
  amount?: string;
  valueUsd?: number;
  slippageBps?: number;
  
  // Additional context
  contractAuditRisk?: RiskLevel;
  isContractKnown?: boolean;
  holdingsPercentage?: number;
  
  // Daily spend
  todaySpendUsd: number;
}

/**
 * Policy violation
 */
export interface PolicyViolation {
  type: PolicyViolationType;
  message: string;
  severity: 'warning' | 'blocking';
  details?: Record<string, unknown>;
}

export type PolicyViolationType =
  | 'exceeds_per_tx_limit'
  | 'exceeds_daily_limit'
  | 'denied_token'
  | 'denied_contract'
  | 'unknown_contract'
  | 'high_slippage'
  | 'high_holdings_percentage'
  | 'unaudited_contract'
  | 'high_risk_contract';

/**
 * Policy evaluation result
 */
export interface PolicyEvaluationResult {
  allowed: boolean;
  riskLevel: RiskLevel;
  violations: PolicyViolation[];
  warnings: PolicyViolation[];
  reasons: string[];
}

/**
 * Daily spend record
 */
export interface DailySpend {
  id: string;
  sessionId: string;
  date: string;
  totalSpentUsd: number;
  transactionCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Default policy values
 */
export const DEFAULT_POLICY_VALUES: Omit<Policy, 'id' | 'sessionId' | 'createdAt' | 'updatedAt'> = {
  securityLevel: 'NORMAL',
  maxPerTxUsd: 1000,
  maxDailyUsd: 5000,
  requireVerifiedContracts: false,
  largeTransactionThresholdPct: 30,
  maxSlippageBps: 300,
};

/**
 * Risk level descriptions
 */
export const RISK_LEVEL_DESCRIPTIONS: Record<RiskLevel, string> = {
  LOW: 'This transaction appears safe with no concerning patterns detected.',
  MEDIUM: 'This transaction has some risk factors. Please review the details carefully.',
  HIGH: 'This transaction has significant risk factors. Proceed with extreme caution.',
  BLOCKED: 'This transaction is blocked by your policy settings or security checks.',
};

/**
 * Get risk level color class
 */
export function getRiskLevelVariant(level: RiskLevel): 'low' | 'medium' | 'high' | 'blocked' {
  return level.toLowerCase() as 'low' | 'medium' | 'high' | 'blocked';
}

