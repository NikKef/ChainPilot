import type {
  PolicyWithLists,
  PolicyEvaluationContext,
  PolicyEvaluationResult,
  PolicyViolation,
  RiskLevel,
  SecurityLevel,
} from '@/lib/types';
import { RISK_THRESHOLDS } from '@/lib/utils/constants';
import { logger } from '@/lib/utils';

/**
 * Evaluate a transaction against user policies
 * 
 * Security Level Behavior:
 * - STRICT: Only whitelisted tokens/contracts allowed. All others blocked.
 * - NORMAL: Blacklist enforced, warnings for risky transactions.
 * - PERMISSIVE: Only spend caps enforced. No other checks.
 */
export function evaluatePolicy(
  context: PolicyEvaluationContext
): PolicyEvaluationResult {
  const violations: PolicyViolation[] = [];
  const warnings: PolicyViolation[] = [];
  let maxRiskLevel: RiskLevel = 'LOW';

  const securityLevel: SecurityLevel = context.policy.securityLevel || 'NORMAL';

  logger.policyEval('evaluating', { 
    type: context.transactionType,
    valueUsd: context.valueUsd,
    securityLevel,
  });

  // =====================================
  // STEP 1: Spend cap validation (ALL security levels)
  // =====================================

  // 1a. Check per-transaction spend limit
  if (context.policy.maxPerTxUsd !== null && context.valueUsd !== undefined) {
    if (context.valueUsd > context.policy.maxPerTxUsd) {
      violations.push({
        type: 'exceeds_per_tx_limit',
        message: `Transaction value ($${context.valueUsd.toFixed(2)}) exceeds per-transaction limit ($${context.policy.maxPerTxUsd})`,
        severity: 'blocking',
        details: {
          value: context.valueUsd,
          limit: context.policy.maxPerTxUsd,
        },
      });
      maxRiskLevel = 'BLOCKED';
    }
  }

  // 1b. Check daily spend limit
  if (context.policy.maxDailyUsd !== null && context.valueUsd !== undefined) {
    const newDailyTotal = context.todaySpendUsd + context.valueUsd;
    if (newDailyTotal > context.policy.maxDailyUsd) {
      violations.push({
        type: 'exceeds_daily_limit',
        message: `This transaction would exceed your daily limit ($${context.policy.maxDailyUsd}). Today's spend: $${context.todaySpendUsd.toFixed(2)}, this transaction: $${context.valueUsd.toFixed(2)}`,
        severity: 'blocking',
        details: {
          todaySpend: context.todaySpendUsd,
          transactionValue: context.valueUsd,
          dailyLimit: context.policy.maxDailyUsd,
        },
      });
      maxRiskLevel = 'BLOCKED';
    }
  }

  // =====================================
  // STEP 2: Security level specific checks
  // =====================================

  if (securityLevel === 'PERMISSIVE') {
    // PERMISSIVE: Skip all token/contract checks, only spend caps apply
    // Just return with current violations (spend caps only)
    const result: PolicyEvaluationResult = {
      allowed: violations.filter(v => v.severity === 'blocking').length === 0,
      riskLevel: maxRiskLevel,
      violations,
      warnings: [], // No warnings in PERMISSIVE mode
      reasons: violations.map(v => v.message),
    };

    logger.policyEval(result.allowed ? 'allowed' : 'blocked', {
      riskLevel: result.riskLevel,
      violationCount: violations.length,
      warningCount: 0,
      securityLevel,
    });

    return result;
  }

  if (securityLevel === 'STRICT') {
    // STRICT: Whitelist-only mode
    
    // Check token is in allow list
    if (context.tokenAddress) {
      const normalizedToken = context.tokenAddress.toLowerCase();
      const isTokenAllowed = context.policy.allowedTokens.some(
        t => t.toLowerCase() === normalizedToken
      );
      
      if (!isTokenAllowed) {
        violations.push({
          type: 'denied_token',
          message: 'This token is not in your allow list (Strict mode)',
          severity: 'blocking',
          details: { tokenAddress: context.tokenAddress },
        });
        maxRiskLevel = 'BLOCKED';
      }
      
      // Also check deny list for extra protection
      if (context.policy.deniedTokens.some(t => t.toLowerCase() === normalizedToken)) {
        violations.push({
          type: 'denied_token',
          message: 'This token is on your deny list',
          severity: 'blocking',
          details: { tokenAddress: context.tokenAddress },
        });
        maxRiskLevel = 'BLOCKED';
      }
    }

    // Check contract is in allow list
    if (context.targetAddress) {
      const normalizedTarget = context.targetAddress.toLowerCase();
      const isContractAllowed = context.policy.allowedContracts.some(
        c => c.toLowerCase() === normalizedTarget
      );
      
      if (!isContractAllowed) {
        violations.push({
          type: 'unknown_contract',
          message: 'This contract is not in your allow list (Strict mode)',
          severity: 'blocking',
          details: { contractAddress: context.targetAddress },
        });
        maxRiskLevel = 'BLOCKED';
      }
      
      // Also check deny list for extra protection
      if (context.policy.deniedContracts.some(c => c.toLowerCase() === normalizedTarget)) {
        violations.push({
          type: 'denied_contract',
          message: 'This contract is on your deny list',
          severity: 'blocking',
          details: { contractAddress: context.targetAddress },
        });
        maxRiskLevel = 'BLOCKED';
      }
    }
  } else {
    // NORMAL: Blacklist mode with warnings
    
    // Check token deny list
  if (context.tokenAddress) {
    const normalizedToken = context.tokenAddress.toLowerCase();
    if (context.policy.deniedTokens.some(t => t.toLowerCase() === normalizedToken)) {
      violations.push({
        type: 'denied_token',
        message: 'This token is on your deny list',
        severity: 'blocking',
        details: { tokenAddress: context.tokenAddress },
      });
      maxRiskLevel = 'BLOCKED';
    }
  }

    // Check contract deny list
  if (context.targetAddress) {
    const normalizedTarget = context.targetAddress.toLowerCase();
    if (context.policy.deniedContracts.some(c => c.toLowerCase() === normalizedTarget)) {
      violations.push({
        type: 'denied_contract',
        message: 'This contract is on your deny list',
        severity: 'blocking',
        details: { contractAddress: context.targetAddress },
      });
      maxRiskLevel = 'BLOCKED';
    }
  }

    // Check unknown/unverified contracts
  if (context.targetAddress && !context.isContractKnown) {
      const isInAllowList = context.policy.allowedContracts.some(
      c => c.toLowerCase() === context.targetAddress!.toLowerCase()
    );

      if (!isInAllowList) {
        // Check if we require verified contracts
        if (context.policy.requireVerifiedContracts) {
      violations.push({
        type: 'unknown_contract',
            message: 'Interaction with unverified contracts is disabled in your settings',
        severity: 'blocking',
        details: { contractAddress: context.targetAddress },
      });
      maxRiskLevel = 'BLOCKED';
        } else {
          // Add warning for unverified contract
      warnings.push({
        type: 'unknown_contract',
            message: 'This is an unverified contract - proceed with caution',
        severity: 'warning',
        details: { contractAddress: context.targetAddress },
      });
          if (maxRiskLevel === 'LOW') maxRiskLevel = 'HIGH';
        }
    }
  }

    // Check slippage for swaps
  if (context.slippageBps !== undefined) {
    if (context.slippageBps > context.policy.maxSlippageBps) {
      warnings.push({
        type: 'high_slippage',
        message: `Slippage (${context.slippageBps / 100}%) exceeds your maximum (${context.policy.maxSlippageBps / 100}%)`,
        severity: 'warning',
        details: {
          slippage: context.slippageBps,
          maxSlippage: context.policy.maxSlippageBps,
        },
      });
      if (maxRiskLevel === 'LOW') maxRiskLevel = 'MEDIUM';
    }

    if (context.slippageBps > RISK_THRESHOLDS.highSlippageBps) {
      warnings.push({
        type: 'high_slippage',
        message: `Very high slippage (${context.slippageBps / 100}%) - you may receive significantly less than expected`,
        severity: 'warning',
      });
      if (maxRiskLevel !== 'BLOCKED') maxRiskLevel = 'HIGH';
    }
  }

    // Check holdings percentage using policy threshold
    const threshold = context.policy.largeTransactionThresholdPct || RISK_THRESHOLDS.highValuePercentage;
  if (context.holdingsPercentage !== undefined) {
      if (context.holdingsPercentage > threshold) {
      warnings.push({
        type: 'high_holdings_percentage',
        message: `You're moving ${context.holdingsPercentage}% of your holdings in this token`,
        severity: 'warning',
        details: { percentage: context.holdingsPercentage },
      });
      if (maxRiskLevel === 'LOW') maxRiskLevel = 'MEDIUM';
    }
  }

    // Check contract audit status
  if (context.contractAuditRisk) {
    if (context.contractAuditRisk === 'HIGH') {
      warnings.push({
        type: 'high_risk_contract',
        message: 'This contract has high-risk findings in its audit',
        severity: 'warning',
      });
      if (maxRiskLevel !== 'BLOCKED') maxRiskLevel = 'HIGH';
    } else if (context.contractAuditRisk === 'BLOCKED') {
      violations.push({
        type: 'high_risk_contract',
        message: 'This contract has critical security issues and should not be used',
        severity: 'blocking',
      });
      maxRiskLevel = 'BLOCKED';
    } else if (context.contractAuditRisk === 'MEDIUM') {
      warnings.push({
        type: 'high_risk_contract',
        message: 'This contract has medium-risk findings - review before proceeding',
        severity: 'warning',
      });
      if (maxRiskLevel === 'LOW') maxRiskLevel = 'MEDIUM';
      }
    }
  }

  // Compile reasons
  const reasons = [
    ...violations.map(v => v.message),
    ...warnings.map(w => w.message),
  ];

  const result: PolicyEvaluationResult = {
    allowed: violations.filter(v => v.severity === 'blocking').length === 0,
    riskLevel: maxRiskLevel,
    violations,
    warnings,
    reasons,
  };

  logger.policyEval(result.allowed ? 'allowed' : 'blocked', {
    riskLevel: result.riskLevel,
    violationCount: violations.length,
    warningCount: warnings.length,
    securityLevel,
  });

  return result;
}

/**
 * Quick risk assessment without full policy evaluation
 */
export function assessRisk(context: {
  valueUsd?: number;
  isKnownContract?: boolean;
  hasAudit?: boolean;
  auditRisk?: RiskLevel;
  slippageBps?: number;
}): RiskLevel {
  let risk: RiskLevel = 'LOW';

  // High value transaction
  if (context.valueUsd && context.valueUsd > 10000) {
    risk = 'HIGH';
  } else if (context.valueUsd && context.valueUsd > 1000) {
    risk = risk === 'LOW' ? 'MEDIUM' : risk;
  }

  // Unknown contract
  if (context.isKnownContract === false && !context.hasAudit) {
    risk = risk === 'LOW' ? 'MEDIUM' : risk;
  }

  // Audit risk
  if (context.auditRisk) {
    if (context.auditRisk === 'BLOCKED') return 'BLOCKED';
    if (context.auditRisk === 'HIGH') return 'HIGH';
    if (context.auditRisk === 'MEDIUM' && risk === 'LOW') risk = 'MEDIUM';
  }

  // High slippage
  if (context.slippageBps && context.slippageBps > RISK_THRESHOLDS.highSlippageBps) {
    risk = 'HIGH';
  }

  return risk;
}

/**
 * Check if address is in allow list
 */
export function isAddressAllowed(
  address: string,
  allowList: string[],
  denyList: string[]
): { allowed: boolean; reason?: string } {
  const normalized = address.toLowerCase();

  if (denyList.some(a => a.toLowerCase() === normalized)) {
    return { allowed: false, reason: 'Address is on deny list' };
  }

  if (allowList.length > 0) {
    const isInAllowList = allowList.some(a => a.toLowerCase() === normalized);
    if (!isInAllowList) {
      return { allowed: false, reason: 'Address is not on allow list' };
    }
  }

  return { allowed: true };
}

/**
 * Batch operation context for policy evaluation
 */
export interface BatchOperationContext {
  type: 'transfer' | 'swap' | 'call';
  tokenAddress?: string;
  targetAddress?: string;
  valueUsd?: number;
  slippageBps?: number;
}

/**
 * Batch policy evaluation context
 */
export interface BatchPolicyEvaluationContext {
  policy: PolicyWithLists;
  operations: BatchOperationContext[];
  todaySpendUsd: number;
  userAddress: string;
}

/**
 * Batch policy evaluation result
 */
export interface BatchPolicyEvaluationResult extends PolicyEvaluationResult {
  operationResults: Array<{
    index: number;
    allowed: boolean;
    riskLevel: RiskLevel;
    violations: PolicyViolation[];
    warnings: PolicyViolation[];
  }>;
  totalValueUsd: number;
}

/**
 * Evaluate a batch of operations against user policies
 * 
 * Evaluates each operation individually and aggregates results.
 * The batch is only allowed if all operations are allowed.
 */
export function evaluateBatchPolicy(
  context: BatchPolicyEvaluationContext
): BatchPolicyEvaluationResult {
  const operationResults: BatchPolicyEvaluationResult['operationResults'] = [];
  const allViolations: PolicyViolation[] = [];
  const allWarnings: PolicyViolation[] = [];
  let maxRiskLevel: RiskLevel = 'LOW';
  let totalValueUsd = 0;
  let runningTodaySpend = context.todaySpendUsd;

  const securityLevel: SecurityLevel = context.policy.securityLevel || 'NORMAL';

  logger.policyEval('evaluating batch', { 
    operationCount: context.operations.length,
    securityLevel,
  });

  // Maximum operations per batch
  const MAX_BATCH_OPERATIONS = 10;
  if (context.operations.length > MAX_BATCH_OPERATIONS) {
    allViolations.push({
      type: 'exceeds_batch_limit',
      message: `Batch contains ${context.operations.length} operations, maximum allowed is ${MAX_BATCH_OPERATIONS}`,
      severity: 'blocking',
    });
    maxRiskLevel = 'BLOCKED';
  }

  // Evaluate each operation
  for (let i = 0; i < context.operations.length; i++) {
    const op = context.operations[i];
    const opViolations: PolicyViolation[] = [];
    const opWarnings: PolicyViolation[] = [];
    let opRiskLevel: RiskLevel = 'LOW';

    // Track total value
    if (op.valueUsd) {
      totalValueUsd += op.valueUsd;
    }

    // Evaluate operation based on type
    const transactionType = op.type === 'call' ? 'contract_call' : op.type;
    
    const opContext: PolicyEvaluationContext = {
      transactionType,
      policy: context.policy,
      targetAddress: op.targetAddress,
      tokenAddress: op.tokenAddress,
      valueUsd: op.valueUsd,
      todaySpendUsd: runningTodaySpend,
      slippageBps: op.slippageBps,
      walletAddress: context.userAddress,
      network: 'testnet', // Default to testnet for batch operations
    };

    const opResult = evaluatePolicy(opContext);
    
    // Update running daily spend for subsequent operations
    if (op.valueUsd) {
      runningTodaySpend += op.valueUsd;
    }

    // Collect violations and warnings
    opViolations.push(...opResult.violations);
    opWarnings.push(...opResult.warnings);
    opRiskLevel = opResult.riskLevel;

    // Track max risk level across all operations
    if (opRiskLevel === 'BLOCKED') {
      maxRiskLevel = 'BLOCKED';
    } else if (opRiskLevel === 'HIGH' && maxRiskLevel !== 'BLOCKED') {
      maxRiskLevel = 'HIGH';
    } else if (opRiskLevel === 'MEDIUM' && maxRiskLevel === 'LOW') {
      maxRiskLevel = 'MEDIUM';
    }

    operationResults.push({
      index: i,
      allowed: opResult.allowed,
      riskLevel: opRiskLevel,
      violations: opViolations,
      warnings: opWarnings,
    });

    allViolations.push(...opViolations.map(v => ({
      ...v,
      message: `[Operation ${i + 1}] ${v.message}`,
    })));
    allWarnings.push(...opWarnings.map(w => ({
      ...w,
      message: `[Operation ${i + 1}] ${w.message}`,
    })));
  }

  // Check total batch value against per-transaction limit
  if (context.policy.maxPerTxUsd !== null && totalValueUsd > context.policy.maxPerTxUsd) {
    allViolations.push({
      type: 'batch_exceeds_per_tx_limit',
      message: `Total batch value ($${totalValueUsd.toFixed(2)}) exceeds per-transaction limit ($${context.policy.maxPerTxUsd})`,
      severity: 'blocking',
      details: {
        totalValue: totalValueUsd,
        limit: context.policy.maxPerTxUsd,
      },
    });
    maxRiskLevel = 'BLOCKED';
  }

  // Check total batch value against daily limit
  if (context.policy.maxDailyUsd !== null) {
    const finalDailyTotal = context.todaySpendUsd + totalValueUsd;
    if (finalDailyTotal > context.policy.maxDailyUsd) {
      allViolations.push({
        type: 'batch_exceeds_daily_limit',
        message: `This batch would exceed your daily limit ($${context.policy.maxDailyUsd}). Today's spend: $${context.todaySpendUsd.toFixed(2)}, batch total: $${totalValueUsd.toFixed(2)}`,
        severity: 'blocking',
        details: {
          todaySpend: context.todaySpendUsd,
          batchValue: totalValueUsd,
          dailyLimit: context.policy.maxDailyUsd,
        },
      });
      maxRiskLevel = 'BLOCKED';
    }
  }

  const allOperationsAllowed = operationResults.every(r => r.allowed);
  const allowed = allOperationsAllowed && allViolations.length === 0;

  const result: BatchPolicyEvaluationResult = {
    allowed,
    riskLevel: maxRiskLevel,
    violations: allViolations,
    warnings: allWarnings,
    reasons: allViolations.map(v => v.message),
    operationResults,
    totalValueUsd,
  };

  logger.policyEval('batch evaluation complete', {
    allowed: result.allowed,
    riskLevel: result.riskLevel,
    operationCount: context.operations.length,
    totalValueUsd,
    violationCount: allViolations.length,
    warningCount: allWarnings.length,
  });

  return result;
}

