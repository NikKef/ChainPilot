import type { PolicyEvaluationResult, PolicyWithLists, RiskLevel } from '@/lib/types';

const RISK_ORDER: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  BLOCKED: 3,
};

function maxRiskLevel(current: RiskLevel, next: RiskLevel): RiskLevel {
  return RISK_ORDER[next] > RISK_ORDER[current] ? next : current;
}

/**
 * Apply additional token allow/deny checks to an existing policy decision.
 * Useful when a transaction touches multiple tokens (e.g., swaps) and only one
 * token was evaluated in the base policy check.
 */
export function applyTokenPolicy(
  decision: PolicyEvaluationResult,
  policy: PolicyWithLists,
  tokens: Array<string | null | undefined>
): PolicyEvaluationResult {
  const violations = [...decision.violations];
  const warnings = [...decision.warnings];
  let riskLevel = decision.riskLevel;
  const securityLevel = policy.securityLevel || 'NORMAL';

  tokens
    .filter(Boolean)
    .map(t => t!.toLowerCase())
    .forEach(token => {
      if (securityLevel === 'STRICT') {
        const inAllowList = policy.allowedTokens.some(t => t.toLowerCase() === token);
        const inDenyList = policy.deniedTokens.some(t => t.toLowerCase() === token);

        if (!inAllowList) {
          violations.push({
            type: 'denied_token',
            message: 'This token is not in your allow list (Strict mode)',
            severity: 'blocking',
            details: { tokenAddress: token },
          });
          riskLevel = maxRiskLevel(riskLevel, 'BLOCKED');
        }

        if (inDenyList) {
          violations.push({
            type: 'denied_token',
            message: 'This token is on your deny list',
            severity: 'blocking',
            details: { tokenAddress: token },
          });
          riskLevel = maxRiskLevel(riskLevel, 'BLOCKED');
        }
      } else {
        const inDenyList = policy.deniedTokens.some(t => t.toLowerCase() === token);
        if (inDenyList) {
          violations.push({
            type: 'denied_token',
            message: 'This token is on your deny list',
            severity: 'blocking',
            details: { tokenAddress: token },
          });
          riskLevel = maxRiskLevel(riskLevel, 'BLOCKED');
        }
      }
    });

  const allowed = violations.filter(v => v.severity === 'blocking').length === 0;
  const reasons = [
    ...violations.map(v => v.message),
    ...warnings.map(w => w.message),
  ];

  return {
    ...decision,
    allowed,
    riskLevel,
    violations,
    warnings,
    reasons,
  };
}


