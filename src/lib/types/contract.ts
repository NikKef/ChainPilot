import type { NetworkType } from '../utils/constants';
import type { RiskLevel } from './transaction';

/**
 * Contract record
 */
export interface Contract {
  id: string;
  address: string | null;
  network: NetworkType;
  sourceCode: string | null;
  bytecode: string | null;
  abi: ContractAbi | null;
  contractName: string | null;
  isGenerated: boolean;
  lastAuditId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Contract ABI
 */
export type ContractAbi = AbiItem[];

/**
 * ABI item
 */
export interface AbiItem {
  type: 'function' | 'event' | 'constructor' | 'fallback' | 'receive' | 'error';
  name?: string;
  inputs?: AbiParameter[];
  outputs?: AbiParameter[];
  stateMutability?: 'pure' | 'view' | 'nonpayable' | 'payable';
  anonymous?: boolean;
}

/**
 * ABI parameter
 */
export interface AbiParameter {
  name: string;
  type: string;
  indexed?: boolean;
  components?: AbiParameter[];
  internalType?: string;
}

/**
 * Generated contract record
 */
export interface GeneratedContract {
  id: string;
  sessionId: string;
  contractId: string | null;
  specText: string;
  sourceCode: string;
  network: NetworkType;
  deployedAddress: string | null;
  deploymentTxHash: string | null;
  createdAt: string;
  deployedAt: string | null;
}

/**
 * Contract generation request
 */
export interface ContractGenerationRequest {
  specText: string;
  network: NetworkType;
}

/**
 * Contract generation result
 */
export interface ContractGenerationResult {
  success: boolean;
  sourceCode?: string;
  contractName?: string;
  description?: string;
  warnings?: string[];
  error?: string;
}

/**
 * Contract with audit info
 */
export interface ContractWithAudit extends Contract {
  audit?: Audit;
}

/**
 * Contract description/summary
 */
export interface ContractDescription {
  name: string;
  summary: string;
  mainFunctions: FunctionDescription[];
  events: string[];
  stateVariables: string[];
  inherits: string[];
  interfaces: string[];
}

/**
 * Function description
 */
export interface FunctionDescription {
  name: string;
  signature: string;
  description: string;
  visibility: 'public' | 'external' | 'internal' | 'private';
  stateMutability: 'pure' | 'view' | 'nonpayable' | 'payable';
  parameters: ParameterDescription[];
  returns: ParameterDescription[];
}

/**
 * Parameter description
 */
export interface ParameterDescription {
  name: string;
  type: string;
  description?: string;
}

/**
 * Audit record
 */
export interface Audit {
  id: string;
  contractId: string;
  riskLevel: RiskLevel;
  summary: string | null;
  majorFindings: AuditFinding[];
  mediumFindings: AuditFinding[];
  minorFindings: AuditFinding[];
  recommendations: string[];
  rawResponse?: unknown;
  createdAt: string;
}

/**
 * Audit finding
 */
export interface AuditFinding {
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  location?: string;
  recommendation?: string;
}

/**
 * Audit request
 */
export interface AuditRequest {
  address?: string;
  sourceCode?: string;
  network: NetworkType;
}

/**
 * Audit result from ChainGPT
 */
export interface AuditResult {
  success: boolean;
  riskLevel: RiskLevel;
  summary: string;
  majorFindings: AuditFinding[];
  mediumFindings: AuditFinding[];
  minorFindings: AuditFinding[];
  recommendations: string[];
  error?: string;
}

/**
 * Calculate overall risk from findings
 */
export function calculateRiskFromFindings(
  major: AuditFinding[],
  medium: AuditFinding[],
  minor: AuditFinding[]
): RiskLevel {
  // Check for critical findings in major
  const hasCritical = major.some(f => f.severity === 'critical');
  if (hasCritical) return 'BLOCKED';

  // High if any major findings
  if (major.length > 0) return 'HIGH';

  // Medium if multiple medium findings or many minor
  if (medium.length >= 2 || minor.length >= 5) return 'MEDIUM';

  // Medium if any medium findings
  if (medium.length > 0) return 'MEDIUM';

  return 'LOW';
}

/**
 * Get severity color
 */
export function getSeverityColor(severity: AuditFinding['severity']): string {
  switch (severity) {
    case 'critical':
      return 'text-risk-blocked';
    case 'high':
      return 'text-risk-high';
    case 'medium':
      return 'text-risk-medium';
    case 'low':
      return 'text-accent-amber';
    case 'informational':
      return 'text-foreground-muted';
    default:
      return 'text-foreground';
  }
}

// Re-export from policy.ts to maintain backward compatibility
export { getRiskLevelVariant } from './policy';

