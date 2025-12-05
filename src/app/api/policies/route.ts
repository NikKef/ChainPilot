import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { validatePolicy } from '@/lib/services/policy';
import type { 
  GetPoliciesResponse, 
  UpdatePolicyRequest, 
  UpdatePolicyResponse,
  PolicyWithLists 
} from '@/lib/types';
import { formatErrorResponse, getErrorStatusCode, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/utils';

// Helper to fetch a policy with all lists
async function fetchPolicyWithLists(
  supabase: ReturnType<typeof createAdminClient>,
  sessionId: string
): Promise<PolicyWithLists | null> {
  const { data: policyData, error } = await supabase
    .from('policies')
    .select('*')
    .eq('session_id', sessionId)
    .single();

  if (error || !policyData) {
    return null;
  }

  // Fetch token and contract lists in parallel
  const [tokenListsResult, contractListsResult] = await Promise.all([
    supabase
      .from('policy_token_lists')
      .select('*')
      .eq('policy_id', policyData.id),
    supabase
      .from('policy_contract_lists')
      .select('*')
      .eq('policy_id', policyData.id),
  ]);

  const tokenLists = tokenListsResult.data || [];
  const contractLists = contractListsResult.data || [];

  return {
    id: policyData.id,
    sessionId: policyData.session_id,
    securityLevel: policyData.security_level || 'NORMAL',
    maxPerTxUsd: policyData.max_per_tx_usd,
    maxDailyUsd: policyData.max_daily_usd,
    requireVerifiedContracts: policyData.require_verified_contracts ?? false,
    largeTransactionThresholdPct: policyData.large_transaction_threshold_pct ?? 30,
    maxSlippageBps: policyData.max_slippage_bps,
    allowedTokens: tokenLists
      .filter(t => t.list_type === 'allowed')
      .map(t => t.token_address),
    deniedTokens: tokenLists
      .filter(t => t.list_type === 'denied')
      .map(t => t.token_address),
    allowedContracts: contractLists
      .filter(c => c.list_type === 'allowed')
      .map(c => c.contract_address),
    deniedContracts: contractLists
      .filter(c => c.list_type === 'denied')
      .map(c => c.contract_address),
    createdAt: policyData.created_at,
    updatedAt: policyData.updated_at,
  };
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      throw new ValidationError('Session ID is required');
    }

    logger.apiRequest('GET', '/api/policies', { sessionId });

    const supabase = createAdminClient();

    // Verify session exists
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('id')
      .eq('id', sessionId)
      .single();

    if (sessionError || !sessionData) {
      return NextResponse.json(
        { error: 'Session not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Get or create policy
    let policy = await fetchPolicyWithLists(supabase, sessionId);

    if (!policy) {
      // Create default policy with NORMAL security level
      const { data: newPolicy, error: insertError } = await supabase
        .from('policies')
        .insert({
          session_id: sessionId,
          security_level: 'NORMAL',
          max_per_tx_usd: 1000,
          max_daily_usd: 5000,
          require_verified_contracts: false,
          large_transaction_threshold_pct: 30,
          max_slippage_bps: 300,
        })
        .select()
        .single();

      if (insertError) {
        logger.error('Error creating default policy', insertError);
        throw new Error('Failed to create policy');
      }

      policy = {
        id: newPolicy.id,
        sessionId: newPolicy.session_id,
        securityLevel: newPolicy.security_level || 'NORMAL',
        maxPerTxUsd: newPolicy.max_per_tx_usd,
        maxDailyUsd: newPolicy.max_daily_usd,
        requireVerifiedContracts: newPolicy.require_verified_contracts ?? false,
        largeTransactionThresholdPct: newPolicy.large_transaction_threshold_pct ?? 30,
        maxSlippageBps: newPolicy.max_slippage_bps,
        allowedTokens: [],
        deniedTokens: [],
        allowedContracts: [],
        deniedContracts: [],
        createdAt: newPolicy.created_at,
        updatedAt: newPolicy.updated_at,
      };

      logger.info('Created default policy for session', { sessionId });
    }

    const response: GetPoliciesResponse = { policy };

    const duration = Date.now() - startTime;
    logger.apiResponse('GET', '/api/policies', 200, duration);

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Get policies API error', error);
    logger.apiResponse('GET', '/api/policies', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

export async function PUT(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body: UpdatePolicyRequest = await request.json();

    if (!body.sessionId) {
      throw new ValidationError('Session ID is required');
    }

    logger.apiRequest('PUT', '/api/policies', { sessionId: body.sessionId });

    // Validate updates
    const validation = validatePolicy(body);
    if (!validation.valid) {
      throw new ValidationError(validation.errors.join(', '));
    }

    const supabase = createAdminClient();

    // Get current policy
    const { data: currentPolicy, error: fetchError } = await supabase
      .from('policies')
      .select('*')
      .eq('session_id', body.sessionId)
      .single();

    if (fetchError || !currentPolicy) {
      return NextResponse.json(
        { error: 'Policy not found for session', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Update policy fields
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.securityLevel !== undefined) {
      updateData.security_level = body.securityLevel;
    }
    if (body.maxPerTxUsd !== undefined) {
      updateData.max_per_tx_usd = body.maxPerTxUsd;
    }
    if (body.maxDailyUsd !== undefined) {
      updateData.max_daily_usd = body.maxDailyUsd;
    }
    if (body.requireVerifiedContracts !== undefined) {
      updateData.require_verified_contracts = body.requireVerifiedContracts;
    }
    if (body.largeTransactionThresholdPct !== undefined) {
      updateData.large_transaction_threshold_pct = body.largeTransactionThresholdPct;
    }
    if (body.maxSlippageBps !== undefined) {
      updateData.max_slippage_bps = body.maxSlippageBps;
    }

    const { error: updateError } = await supabase
      .from('policies')
      .update(updateData)
      .eq('id', currentPolicy.id);

    if (updateError) {
      logger.error('Error updating policy', updateError);
      throw new Error('Failed to update policy');
    }

    // Update token lists if provided
    if (body.allowedTokens !== undefined || body.deniedTokens !== undefined) {
      // Delete existing token lists
      await supabase
        .from('policy_token_lists')
        .delete()
        .eq('policy_id', currentPolicy.id);

      // Insert new allowed tokens
      if (body.allowedTokens && body.allowedTokens.length > 0) {
        const allowedTokenEntries = body.allowedTokens.map(address => ({
          policy_id: currentPolicy.id,
          token_address: address.toLowerCase(),
          list_type: 'allowed' as const,
        }));
        await supabase.from('policy_token_lists').insert(allowedTokenEntries);
      }

      // Insert new denied tokens
      if (body.deniedTokens && body.deniedTokens.length > 0) {
        const deniedTokenEntries = body.deniedTokens.map(address => ({
          policy_id: currentPolicy.id,
          token_address: address.toLowerCase(),
          list_type: 'denied' as const,
        }));
        await supabase.from('policy_token_lists').insert(deniedTokenEntries);
      }
    }

    // Update contract lists if provided
    if (body.allowedContracts !== undefined || body.deniedContracts !== undefined) {
      // Delete existing contract lists
      await supabase
        .from('policy_contract_lists')
        .delete()
        .eq('policy_id', currentPolicy.id);

      // Insert new allowed contracts
      if (body.allowedContracts && body.allowedContracts.length > 0) {
        const allowedContractEntries = body.allowedContracts.map(address => ({
          policy_id: currentPolicy.id,
          contract_address: address.toLowerCase(),
          list_type: 'allowed' as const,
        }));
        await supabase.from('policy_contract_lists').insert(allowedContractEntries);
      }

      // Insert new denied contracts
      if (body.deniedContracts !== undefined && body.deniedContracts.length > 0) {
        const deniedContractEntries = body.deniedContracts.map(address => ({
          policy_id: currentPolicy.id,
          contract_address: address.toLowerCase(),
          list_type: 'denied' as const,
        }));
        await supabase.from('policy_contract_lists').insert(deniedContractEntries);
      }
    }

    // Fetch updated policy with all lists
    const updatedPolicy = await fetchPolicyWithLists(supabase, body.sessionId);

    if (!updatedPolicy) {
      throw new Error('Failed to fetch updated policy');
    }

    const response: UpdatePolicyResponse = {
      success: true,
      policy: updatedPolicy,
    };

    const duration = Date.now() - startTime;
    logger.apiResponse('PUT', '/api/policies', 200, duration);

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Update policies API error', error);
    logger.apiResponse('PUT', '/api/policies', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}
