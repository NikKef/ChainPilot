import type { Intent, ContextExtractionResult, ChatMessage } from './intent';
import type { TransactionPreview, TransactionResult, ActionLog, Portfolio } from './transaction';
import type { PolicyWithLists, PolicyEvaluationResult, SecurityLevel } from './policy';
import type { Contract, GeneratedContract, Audit, AuditResult, ContractGenerationResult } from './contract';
import type { NetworkType } from '../utils/constants';

// ============================================
// CHAT API
// ============================================

/**
 * POST /api/chat - Request
 */
export interface ChatRequest {
  message: string;
  sessionId: string;
}

/**
 * POST /api/chat - Response
 */
export interface ChatResponse {
  message: ChatMessage;
  intent?: Intent;
  requiresFollowUp: boolean;
  followUpQuestions?: string[];
  
  // Conversation tracking
  conversationId?: string;
  
  // For actionable intents
  transactionPreview?: TransactionPreview;
  policyDecision?: PolicyEvaluationResult;
  
  // For token transfers requiring approval
  approvalRequired?: {
    tokenAddress: string;
    tokenSymbol: string;
    spenderAddress: string;
    amount: string;
    currentAllowance: string;
    requiredAmount: string;
    pendingTransferId?: string; // ID to retrieve pending transfer after approval
    isDirectTransaction?: boolean; // If true, user must send this directly (pays gas) - approvals cannot be gas-sponsored
  };
  
  // For swaps requiring approval (token -> token or token -> BNB)
  swapApprovalRequired?: {
    tokenInAddress: string;
    tokenInSymbol: string;
    tokenOutAddress: string | null; // null for native BNB
    tokenOutSymbol: string;
    routerAddress: string;
    amount: string;
    currentAllowance: string;
    requiredAmount: string;
    pendingSwapId?: string; // ID to retrieve pending swap after approval
    isDirectTransaction?: boolean; // If true, user must send this directly (pays gas)
    slippageBps: number;
    estimatedOutput?: string;
  };
  
  // For contract operations
  generatedContract?: GeneratedContract;
  auditResult?: AuditResult;
  
  // For research
  explanation?: string;
}

// ============================================
// CONTRACTS API
// ============================================

/**
 * POST /api/contracts/generate - Request
 */
export interface GenerateContractRequest {
  specText: string;
  sessionId: string;
  network: NetworkType;
}

/**
 * POST /api/contracts/generate - Response
 */
export interface GenerateContractResponse {
  success: boolean;
  contract?: GeneratedContract;
  auditResult?: AuditResult;
  error?: string;
}

/**
 * POST /api/contracts/audit - Request
 */
export interface AuditContractRequest {
  address?: string;
  sourceCode?: string;
  sessionId: string;
  network: NetworkType;
}

/**
 * POST /api/contracts/audit - Response
 */
export interface AuditContractResponse {
  success: boolean;
  audit?: Audit;
  contract?: Contract;
  error?: string;
}

/**
 * GET /api/contracts/[id] - Response
 */
export interface GetContractResponse {
  contract: Contract;
  audits: Audit[];
}

// ============================================
// TRANSACTIONS API
// ============================================

/**
 * POST /api/transactions/prepare - Request
 */
export interface PrepareTransactionRequest {
  intent: Intent;
  sessionId: string;
}

/**
 * POST /api/transactions/prepare - Response
 */
export interface PrepareTransactionResponse {
  success: boolean;
  preview?: TransactionPreview;
  policyDecision?: PolicyEvaluationResult;
  error?: string;
}

/**
 * POST /api/transactions/execute - Request
 * Execute a signed transaction through Q402 facilitator
 */
export interface ExecuteTransactionRequest {
  actionLogId: string;
  sessionId: string;
  signature: string;           // EIP-712 witness signature (required for Q402)
  signerAddress: string;       // User's wallet address
  network?: NetworkType;       // Network for execution
  pendingTransferId?: string;  // ID of pending transfer to execute after approval
  authorization?: {            // Optional EIP-7702 authorization
    chainId: number;
    address: string;
    nonce: number;
    yParity: number;
    r: string;
    s: string;
  };
}

/**
 * POST /api/transactions/execute - Response
 */
export interface ExecuteTransactionResponse {
  success: boolean;
  result?: TransactionResult;
  actionLog?: ActionLog;
  explorerUrl?: string;        // Direct link to block explorer
  error?: string;
  
  // For multi-step transactions (e.g., approval + transfer)
  // If present, the frontend should automatically prompt user to sign this next
  nextTransaction?: {
    message: string;           // Message to show user
    requestId: string;         // Q402 request ID for the next transaction
    typedData: unknown;        // EIP-712 typed data to sign
    preview: TransactionPreview;
    expiresAt: string;
  };
}

/**
 * POST /api/transactions/prepare/q402 - Request
 * Prepare a transaction for Q402 signing
 */
export interface PrepareQ402Request {
  sessionId: string;
  preview: TransactionPreview;
  policyDecision: PolicyEvaluationResult;
  signerAddress: string;
}

/**
 * POST /api/transactions/prepare/q402 - Response
 */
export interface PrepareQ402Response {
  success: boolean;
  requestId: string;
  typedData: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: string;
    };
    types: {
      Witness: Array<{ name: string; type: string }>;
    };
    primaryType: string;
    message: {
      owner: string;
      token: string;
      amount: string;
      to: string;
      deadline: number;
      paymentId: string;
      nonce: number;
    };
  };
  expiresAt: string;
  error?: string;
}

/**
 * GET /api/transactions/[txHash] - Response
 */
export interface GetTransactionResponse {
  actionLog: ActionLog;
  txReceipt?: {
    blockNumber: number;
    gasUsed: string;
    status: 'success' | 'failed';
  };
}

// ============================================
// PORTFOLIO API
// ============================================

/**
 * GET /api/portfolio - Query params
 */
export interface PortfolioQueryParams {
  address: string;
  network: NetworkType;
}

/**
 * GET /api/portfolio - Response
 */
export interface PortfolioResponse {
  portfolio: Portfolio;
}

// ============================================
// POLICIES API
// ============================================

/**
 * GET /api/policies - Response
 */
export interface GetPoliciesResponse {
  policy: PolicyWithLists;
}

/**
 * PUT /api/policies - Request
 */
export interface UpdatePolicyRequest {
  sessionId: string;
  securityLevel?: SecurityLevel;
  maxPerTxUsd?: number | null;
  maxDailyUsd?: number | null;
  requireVerifiedContracts?: boolean;
  largeTransactionThresholdPct?: number;
  maxSlippageBps?: number;
  allowedTokens?: string[];
  deniedTokens?: string[];
  allowedContracts?: string[];
  deniedContracts?: string[];
}

/**
 * PUT /api/policies - Response
 */
export interface UpdatePolicyResponse {
  success: boolean;
  policy: PolicyWithLists;
}

/**
 * POST /api/policies/allow-list - Request
 */
export interface AddToListRequest {
  sessionId: string;
  address: string;
  type: 'token' | 'contract';
  listType: 'allowed' | 'denied';
}

/**
 * DELETE /api/policies/allow-list - Request
 */
export interface RemoveFromListRequest {
  sessionId: string;
  address: string;
  type: 'token' | 'contract';
  listType: 'allowed' | 'denied';
}

// ============================================
// SESSIONS API
// ============================================

/**
 * POST /api/sessions - Request
 */
export interface CreateSessionRequest {
  walletAddress: string;
  network: NetworkType;
}

/**
 * POST /api/sessions - Response
 */
export interface CreateSessionResponse {
  session: {
    id: string;
    walletAddress: string;
    currentNetwork: NetworkType;
    createdAt: string;
    updatedAt: string;
  };
  policy: PolicyWithLists;
}

/**
 * PUT /api/sessions/[id] - Request
 */
export interface UpdateSessionRequest {
  currentNetwork?: NetworkType;
}

// ============================================
// ACTIVITY API
// ============================================

/**
 * GET /api/activity - Query params
 */
export interface ActivityQueryParams {
  sessionId: string;
  limit?: number;
  offset?: number;
  status?: string;
  intentType?: string;
}

/**
 * GET /api/activity - Response
 */
export interface ActivityResponse {
  logs: ActionLog[];
  total: number;
  hasMore: boolean;
}

// ============================================
// ERROR RESPONSE
// ============================================

/**
 * Standard error response
 */
export interface ErrorResponse {
  error: string;
  code: string;
  details?: Record<string, unknown>;
}

// ============================================
// PAGINATION
// ============================================

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

