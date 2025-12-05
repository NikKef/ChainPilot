import type { NetworkType } from '../utils/constants';

/**
 * Supported intent types
 */
export type IntentType =
  | 'research'
  | 'explain'
  | 'generate_contract'
  | 'audit_contract'
  | 'transfer'
  | 'swap'
  | 'contract_call'
  | 'deploy';

/**
 * Base intent structure
 */
export interface BaseIntent {
  type: IntentType;
  network?: NetworkType;
  confidence?: number;
}

/**
 * Research intent - General Web3 questions
 */
export interface ResearchIntent extends BaseIntent {
  type: 'research';
  query: string;
  topics?: string[];
}

/**
 * Explain intent - Explain contract/token/protocol
 */
export interface ExplainIntent extends BaseIntent {
  type: 'explain';
  address?: string;
  query: string;
}

/**
 * Generate contract intent
 */
export interface GenerateContractIntent extends BaseIntent {
  type: 'generate_contract';
  specText: string;
}

/**
 * Audit contract intent
 */
export interface AuditContractIntent extends BaseIntent {
  type: 'audit_contract';
  address?: string;
  sourceCode?: string;
}

/**
 * Transfer intent - BNB or token transfer
 */
export interface TransferIntent extends BaseIntent {
  type: 'transfer';
  to?: string;
  amount?: string;
  tokenAddress?: string | null; // null for native BNB
  tokenSymbol?: string;
}

/**
 * Swap intent - DEX swap
 */
export interface SwapIntent extends BaseIntent {
  type: 'swap';
  tokenIn?: string;
  tokenInSymbol?: string;
  tokenOut?: string;
  tokenOutSymbol?: string;
  amount?: string;
  slippageBps?: number;
}

/**
 * Contract call intent
 */
export interface ContractCallIntent extends BaseIntent {
  type: 'contract_call';
  contractAddress?: string;
  method?: string;
  args?: unknown[];
  value?: string; // For payable functions
}

/**
 * Deploy intent - Deploy generated contract
 */
export interface DeployIntent extends BaseIntent {
  type: 'deploy';
  contractId?: string;
  constructorArgs?: unknown[];
}

/**
 * Union of all intent types
 */
export type Intent =
  | ResearchIntent
  | ExplainIntent
  | GenerateContractIntent
  | AuditContractIntent
  | TransferIntent
  | SwapIntent
  | ContractCallIntent
  | DeployIntent;

/**
 * Result of context extraction from ChainGPT
 */
export interface ContextExtractionResult {
  intent: Intent;
  missingFields: string[];
  questions: string[];
  requiresFollowUp: boolean;
  confidence: number;
}

/**
 * Session context for intent parsing
 */
export interface SessionContext {
  sessionId: string;
  network: NetworkType;
  walletAddress?: string;
  lastContractAddress?: string;
  lastTokenAddress?: string;
  partialIntent?: Partial<Intent>;
  chatHistory?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

/**
 * Chat message with optional intent
 */
export interface ChatMessage {
  id: string;
  sessionId: string;
  conversationId?: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  intent?: Intent;
  createdAt: string;
}

/**
 * Required fields for each intent type
 */
export const INTENT_REQUIRED_FIELDS: Record<IntentType, string[]> = {
  research: ['query'],
  explain: ['query'],
  generate_contract: ['specText'],
  audit_contract: [], // Either address or sourceCode needed
  transfer: ['to', 'amount'],
  swap: ['tokenIn', 'tokenOut', 'amount'],
  contract_call: ['contractAddress', 'method'],
  deploy: ['contractId'],
};

/**
 * Check if an intent has all required fields
 */
export function isIntentComplete(intent: Intent): boolean {
  const requiredFields = INTENT_REQUIRED_FIELDS[intent.type];
  
  // Special case for audit - needs either address or sourceCode
  if (intent.type === 'audit_contract') {
    const auditIntent = intent as AuditContractIntent;
    return !!(auditIntent.address || auditIntent.sourceCode);
  }

  return requiredFields.every((field) => {
    const value = (intent as Record<string, unknown>)[field];
    return value !== undefined && value !== null && value !== '';
  });
}

/**
 * Get missing fields for an intent
 */
export function getMissingFields(intent: Intent): string[] {
  const requiredFields = INTENT_REQUIRED_FIELDS[intent.type];
  
  // Special case for audit
  if (intent.type === 'audit_contract') {
    const auditIntent = intent as AuditContractIntent;
    if (!auditIntent.address && !auditIntent.sourceCode) {
      return ['address or sourceCode'];
    }
    return [];
  }

  return requiredFields.filter((field) => {
    const value = (intent as Record<string, unknown>)[field];
    return value === undefined || value === null || value === '';
  });
}

