/**
 * Server-side Activity Logging
 * 
 * Direct database operations for logging activity from API routes.
 * This is used by server-side routes like /api/transactions/execute.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { logger } from '@/lib/utils';
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

/**
 * Transform database row to ActionLog format
 */
function transformActionLog(row: Record<string, unknown>): ActionLog {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    intentType: row.intent_type as ActionLog['intentType'],
    network: row.network as ActionLog['network'],
    userMessage: (row.user_message as string | null) ?? undefined,
    parsedIntent: row.parsed_intent as ActionLog['parsedIntent'],
    preparedTx: row.prepared_tx as ActionLog['preparedTx'],
    policyDecision: row.policy_decision as ActionLog['policyDecision'],
    estimatedValueUsd: row.estimated_value_usd ? parseFloat(row.estimated_value_usd as string) : undefined,
    txHash: (row.tx_hash as string | null) ?? undefined,
    q402RequestId: (row.q402_request_id as string | null) ?? undefined,
    status: row.status as ActionLog['status'],
    errorMessage: (row.error_message as string | null) ?? undefined,
    createdAt: row.created_at as string,
    executedAt: (row.executed_at as string | null) ?? undefined,
  };
}

export interface ServerActivityLogParams {
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

/**
 * Create an activity log entry directly in the database (server-side)
 */
export async function createServerActivityLog(params: ServerActivityLogParams): Promise<ActionLog | null> {
  try {
    const supabase = createAdminClient();

    const insertData = {
      session_id: params.sessionId,
      intent_type: params.intentType,
      network: params.network,
      user_message: params.userMessage,
      parsed_intent: params.parsedIntent,
      prepared_tx: params.preparedTx,
      policy_decision: params.policyDecision,
      estimated_value_usd: params.estimatedValueUsd,
      tx_hash: params.txHash,
      q402_request_id: params.q402RequestId,
      status: params.status,
      error_message: params.errorMessage,
      executed_at: params.status === 'executed' ? new Date().toISOString() : null,
    };

    const { data: logData, error } = await supabase
      .from('action_logs')
      .insert(insertData as never)
      .select()
      .single();

    if (error) {
      logger.error('Error creating server activity log', error);
      return null;
    }

    const log = transformActionLog(logData as Record<string, unknown>);
    logger.info('Created server activity log', { logId: log.id, intentType: params.intentType, status: params.status });
    return log;
  } catch (error) {
    logger.error('Error in createServerActivityLog', error);
    return null;
  }
}

/**
 * Update an existing activity log entry (server-side)
 */
export async function updateServerActivityLog(params: {
  logId: string;
  txHash?: string;
  status?: ActionStatus;
  errorMessage?: string;
}): Promise<ActionLog | null> {
  try {
    const supabase = createAdminClient();

    const updates: Record<string, unknown> = {};
    
    if (params.txHash !== undefined) updates.tx_hash = params.txHash;
    if (params.status !== undefined) updates.status = params.status;
    if (params.errorMessage !== undefined) updates.error_message = params.errorMessage;
    
    if (params.status === 'executed') {
      updates.executed_at = new Date().toISOString();
    }

    if (Object.keys(updates).length === 0) {
      return null;
    }

    const { data: logData, error } = await supabase
      .from('action_logs')
      .update(updates as never)
      .eq('id', params.logId)
      .select()
      .single();

    if (error) {
      logger.error('Error updating server activity log', error);
      return null;
    }

    return transformActionLog(logData as Record<string, unknown>);
  } catch (error) {
    logger.error('Error in updateServerActivityLog', error);
    return null;
  }
}

/**
 * Get session info including wallet address
 */
export async function getSessionInfo(sessionId: string): Promise<{ walletAddress: string; network: NetworkType } | null> {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('sessions')
      .select('wallet_address, current_network')
      .eq('id', sessionId)
      .single();

    if (error || !data) {
      return null;
    }

    const row = data as Record<string, unknown>;
    return {
      walletAddress: row.wallet_address as string,
      network: row.current_network as NetworkType,
    };
  } catch (error) {
    logger.error('Error getting session info', error);
    return null;
  }
}
