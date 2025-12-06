import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import type { ActivityResponse, ActionLog } from '@/lib/types';
import type { Database } from '@/lib/supabase/types';
import { formatErrorResponse, getErrorStatusCode, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/utils';

// Type for action_logs row from database
type ActionLogRow = Database['public']['Tables']['action_logs']['Row'];

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

/**
 * GET /api/activity - Get activity logs for a session
 * 
 * Activity logs are automatically scoped to the wallet that owns the session.
 * Each wallet only sees their own activity.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');
    const status = searchParams.get('status');
    const intentType = searchParams.get('intentType');

    if (!sessionId) {
      throw new ValidationError('Session ID is required');
    }

    logger.apiRequest('GET', '/api/activity', { sessionId, limit, offset, status, intentType });

    const supabase = createAdminClient();

    // Build query
    let query = supabase
      .from('action_logs')
      .select('*', { count: 'exact' })
      .eq('session_id', sessionId);

    // Apply filters
    if (status && status !== 'all') {
      query = query.eq('status', status as 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'cancelled');
    }

    if (intentType) {
      query = query.eq('intent_type', intentType as 'research' | 'explain' | 'generate_contract' | 'audit_contract' | 'transfer' | 'swap' | 'contract_call' | 'deploy');
    }

    // Sort and paginate
    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: logsData, error, count } = await query;

    if (error) {
      logger.error('Error fetching activity logs', error);
      throw new Error('Failed to fetch activity logs');
    }

    // Transform database records to ActionLog format
    const logs: ActionLog[] = (logsData as Record<string, unknown>[] || []).map(transformActionLog);

    const total = count || 0;
    const response: ActivityResponse = {
      logs,
      total,
      hasMore: offset + limit < total,
    };

    const duration = Date.now() - startTime;
    logger.apiResponse('GET', '/api/activity', 200, duration);

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Activity API error', error);
    logger.apiResponse('GET', '/api/activity', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

/**
 * POST /api/activity - Create a new activity log entry
 * 
 * Used to log on-chain actions like transfers, swaps, contract calls, etc.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const {
      sessionId,
      intentType,
      network,
      userMessage,
      parsedIntent,
      preparedTx,
      policyDecision,
      estimatedValueUsd,
      txHash,
      q402RequestId,
      status,
      errorMessage,
    } = body;

    if (!sessionId) {
      throw new ValidationError('Session ID is required');
    }

    if (!intentType) {
      throw new ValidationError('Intent type is required');
    }

    if (!network) {
      throw new ValidationError('Network is required');
    }

    if (!status) {
      throw new ValidationError('Status is required');
    }

    logger.apiRequest('POST', '/api/activity', { sessionId, intentType, network, status });

    const supabase = createAdminClient();

    // Verify session exists
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('id, wallet_address')
      .eq('id', sessionId)
      .single();

    if (sessionError || !sessionData) {
      throw new ValidationError('Invalid session ID');
    }

    // Build insert data
    const insertData = {
      session_id: sessionId,
      intent_type: intentType,
      network,
      user_message: userMessage,
      parsed_intent: parsedIntent,
      prepared_tx: preparedTx,
      policy_decision: policyDecision,
      estimated_value_usd: estimatedValueUsd,
      tx_hash: txHash,
      q402_request_id: q402RequestId,
      status,
      error_message: errorMessage,
      executed_at: status === 'executed' ? new Date().toISOString() : null,
    };

    // Insert activity log
    const { data: logData, error: insertError } = await supabase
      .from('action_logs')
      .insert(insertData as never)
      .select()
      .single();

    if (insertError) {
      logger.error('Error creating activity log', insertError);
      throw new Error('Failed to create activity log');
    }

    const log = transformActionLog(logData as Record<string, unknown>);

    const duration = Date.now() - startTime;
    logger.apiResponse('POST', '/api/activity', 201, duration);
    logger.info('Created activity log', { logId: log.id, intentType, status });

    return NextResponse.json({ success: true, log }, { status: 201 });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Create activity log API error', error);
    logger.apiResponse('POST', '/api/activity', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

/**
 * PATCH /api/activity - Update an existing activity log entry
 * 
 * Used to update the status of an activity log (e.g., pending -> executed)
 */
export async function PATCH(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { logId, txHash, status, errorMessage } = body;

    if (!logId) {
      throw new ValidationError('Log ID is required');
    }

    logger.apiRequest('PATCH', '/api/activity', { logId, status });

    const supabase = createAdminClient();

    const updates: Record<string, unknown> = {};
    
    if (txHash !== undefined) updates.tx_hash = txHash;
    if (status !== undefined) updates.status = status;
    if (errorMessage !== undefined) updates.error_message = errorMessage;
    
    // Set executed_at if status is executed
    if (status === 'executed') {
      updates.executed_at = new Date().toISOString();
    }

    if (Object.keys(updates).length === 0) {
      throw new ValidationError('No updates provided');
    }

    const { data: logData, error: updateError } = await supabase
      .from('action_logs')
      .update(updates as never)
      .eq('id', logId)
      .select()
      .single();

    if (updateError) {
      logger.error('Error updating activity log', updateError);
      throw new Error('Failed to update activity log');
    }

    const log = transformActionLog(logData as Record<string, unknown>);

    const duration = Date.now() - startTime;
    logger.apiResponse('PATCH', '/api/activity', 200, duration);

    return NextResponse.json({ success: true, log });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Update activity log API error', error);
    logger.apiResponse('PATCH', '/api/activity', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}
