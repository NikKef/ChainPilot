// Re-export audit types from contract.ts for convenience
export type {
  Audit,
  AuditFinding,
  AuditRequest,
  AuditResult,
} from './contract';

export { calculateRiskFromFindings, getSeverityColor } from './contract';

import type { RiskLevel } from './transaction';
import type { AuditFinding } from './contract';

/**
 * Audit summary for display
 */
export interface AuditSummary {
  riskLevel: RiskLevel;
  summary: string;
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
}

/**
 * Create audit summary from findings
 */
export function createAuditSummary(
  riskLevel: RiskLevel,
  summary: string,
  findings: AuditFinding[]
): AuditSummary {
  const criticalCount = findings.filter(f => f.severity === 'critical').length;
  const highCount = findings.filter(f => f.severity === 'high').length;
  const mediumCount = findings.filter(f => f.severity === 'medium').length;
  const lowCount = findings.filter(f => f.severity === 'low').length;
  const infoCount = findings.filter(f => f.severity === 'informational').length;

  return {
    riskLevel,
    summary,
    totalFindings: findings.length,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    infoCount,
  };
}

/**
 * Get risk badge text
 */
export function getRiskBadgeText(riskLevel: RiskLevel): string {
  switch (riskLevel) {
    case 'LOW':
      return 'Low Risk';
    case 'MEDIUM':
      return 'Medium Risk';
    case 'HIGH':
      return 'High Risk';
    case 'BLOCKED':
      return 'Critical Issues';
    default:
      return riskLevel;
  }
}

/**
 * Audit history entry
 */
export interface AuditHistoryEntry {
  id: string;
  contractId: string;
  contractAddress: string | null;
  contractName: string | null;
  riskLevel: RiskLevel;
  totalFindings: number;
  createdAt: string;
}

/**
 * Pending audit status
 */
export interface PendingAudit {
  id: string;
  contractId?: string;
  sourceCode?: string;
  address?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  error?: string;
}

