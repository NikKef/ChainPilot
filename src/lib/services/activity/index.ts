/**
 * Activity Logging Service
 * 
 * Service for logging on-chain activities to the database.
 * Each activity is associated with a session (which is tied to a specific wallet).
 * This ensures each wallet has its own activity history.
 */

import type { 
  ActionLog, 
  ActionStatus, 
  Intent, 
  PreparedTx, 
  PolicyDecision,
  TransactionPreview,
  PolicyEvaluationResult,
} from '@/lib/types';
import type { NetworkType } from '@/lib/utils/constants';

export interface CreateActivityLogParams {
  sessionId: string;
  intentType: Intent['type'];
  network: NetworkType;
  userMessage?: string;
  parsedIntent?: Intent;
  preparedTx?: PreparedTx;
  policyDecision?: PolicyDecision | PolicyEvaluationResult;
  estimatedValueUsd?: number;
  txHash?: string;
  q402RequestId?: string;
  status: ActionStatus;
  errorMessage?: string;
}

export interface UpdateActivityLogParams {
  logId: string;
  txHash?: string;
  status?: ActionStatus;
  errorMessage?: string;
}

/**
 * Create a new activity log entry
 * 
 * @param params - Activity log parameters
 * @returns The created activity log or null if failed
 */
export async function createActivityLog(params: CreateActivityLogParams): Promise<ActionLog | null> {
  try {
    const response = await fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[Activity] Failed to create activity log:', errorData);
      return null;
    }

    const data = await response.json();
    return data.log;
  } catch (error) {
    console.error('[Activity] Error creating activity log:', error);
    return null;
  }
}

/**
 * Update an existing activity log entry
 * 
 * @param params - Update parameters
 * @returns The updated activity log or null if failed
 */
export async function updateActivityLog(params: UpdateActivityLogParams): Promise<ActionLog | null> {
  try {
    const response = await fetch('/api/activity', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[Activity] Failed to update activity log:', errorData);
      return null;
    }

    const data = await response.json();
    return data.log;
  } catch (error) {
    console.error('[Activity] Error updating activity log:', error);
    return null;
  }
}

/**
 * Log a successful transaction execution
 * 
 * Helper function for the common case of logging a successful on-chain transaction.
 */
export async function logTransactionSuccess(params: {
  sessionId: string;
  intentType: Intent['type'];
  network: NetworkType;
  userMessage?: string;
  parsedIntent?: Intent;
  preview?: TransactionPreview;
  policyDecision?: PolicyEvaluationResult;
  txHash: string;
  q402RequestId?: string;
  estimatedValueUsd?: number;
}): Promise<ActionLog | null> {
  return createActivityLog({
    sessionId: params.sessionId,
    intentType: params.intentType,
    network: params.network,
    userMessage: params.userMessage,
    parsedIntent: params.parsedIntent,
    preparedTx: params.preview?.preparedTx,
    policyDecision: params.policyDecision,
    estimatedValueUsd: params.estimatedValueUsd,
    txHash: params.txHash,
    q402RequestId: params.q402RequestId,
    status: 'executed',
  });
}

/**
 * Log a failed transaction
 * 
 * Helper function for logging a failed on-chain transaction.
 */
export async function logTransactionFailure(params: {
  sessionId: string;
  intentType: Intent['type'];
  network: NetworkType;
  userMessage?: string;
  parsedIntent?: Intent;
  preview?: TransactionPreview;
  policyDecision?: PolicyEvaluationResult;
  errorMessage: string;
  q402RequestId?: string;
}): Promise<ActionLog | null> {
  return createActivityLog({
    sessionId: params.sessionId,
    intentType: params.intentType,
    network: params.network,
    userMessage: params.userMessage,
    parsedIntent: params.parsedIntent,
    preparedTx: params.preview?.preparedTx,
    policyDecision: params.policyDecision,
    errorMessage: params.errorMessage,
    q402RequestId: params.q402RequestId,
    status: 'failed',
  });
}

/**
 * Log a pending transaction (submitted but not yet confirmed)
 * 
 * Helper function for logging a pending transaction.
 */
export async function logTransactionPending(params: {
  sessionId: string;
  intentType: Intent['type'];
  network: NetworkType;
  userMessage?: string;
  parsedIntent?: Intent;
  preview?: TransactionPreview;
  policyDecision?: PolicyEvaluationResult;
  estimatedValueUsd?: number;
  q402RequestId?: string;
}): Promise<ActionLog | null> {
  return createActivityLog({
    sessionId: params.sessionId,
    intentType: params.intentType,
    network: params.network,
    userMessage: params.userMessage,
    parsedIntent: params.parsedIntent,
    preparedTx: params.preview?.preparedTx,
    policyDecision: params.policyDecision,
    estimatedValueUsd: params.estimatedValueUsd,
    q402RequestId: params.q402RequestId,
    status: 'pending',
  });
}

/**
 * Log a rejected transaction (blocked by policy)
 * 
 * Helper function for logging a policy-rejected transaction.
 */
export async function logTransactionRejected(params: {
  sessionId: string;
  intentType: Intent['type'];
  network: NetworkType;
  userMessage?: string;
  parsedIntent?: Intent;
  preview?: TransactionPreview;
  policyDecision?: PolicyEvaluationResult;
  reason: string;
}): Promise<ActionLog | null> {
  return createActivityLog({
    sessionId: params.sessionId,
    intentType: params.intentType,
    network: params.network,
    userMessage: params.userMessage,
    parsedIntent: params.parsedIntent,
    preparedTx: params.preview?.preparedTx,
    policyDecision: params.policyDecision,
    errorMessage: params.reason,
    status: 'rejected',
  });
}

/**
 * Log a cancelled transaction (user cancelled)
 */
export async function logTransactionCancelled(params: {
  sessionId: string;
  intentType: Intent['type'];
  network: NetworkType;
  userMessage?: string;
  parsedIntent?: Intent;
}): Promise<ActionLog | null> {
  return createActivityLog({
    sessionId: params.sessionId,
    intentType: params.intentType,
    network: params.network,
    userMessage: params.userMessage,
    parsedIntent: params.parsedIntent,
    status: 'cancelled',
  });
}

export default {
  createActivityLog,
  updateActivityLog,
  logTransactionSuccess,
  logTransactionFailure,
  logTransactionPending,
  logTransactionRejected,
  logTransactionCancelled,
};

