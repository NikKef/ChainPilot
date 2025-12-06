import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import type { CreateSessionRequest, CreateSessionResponse } from '@/lib/types';
import { formatErrorResponse, getErrorStatusCode, ValidationError } from '@/lib/utils/errors';
import { isValidAddress, isValidNetwork } from '@/lib/utils/validation';
import { logger } from '@/lib/utils';

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body: CreateSessionRequest = await request.json();

    if (!body.walletAddress) {
      throw new ValidationError('Wallet address is required');
    }

    if (!isValidAddress(body.walletAddress)) {
      throw new ValidationError('Invalid wallet address');
    }

    if (!isValidNetwork(body.network)) {
      throw new ValidationError('Invalid network');
    }

    logger.apiRequest('POST', '/api/sessions', { 
      walletAddress: body.walletAddress.slice(0, 10),
      network: body.network 
    });

    const supabase = createAdminClient();
    const normalizedAddress = body.walletAddress.toLowerCase();

    // First, check if a session already exists for this wallet + network
    const { data: existingSession, error: fetchError } = await supabase
      .from('sessions')
      .select('*')
      .eq('wallet_address', normalizedAddress)
      .eq('current_network', body.network)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 means no rows returned, which is expected for new users
      logger.error('Error fetching existing session', fetchError);
      throw new Error('Database error');
    }

    let session;

    if (existingSession) {
      // Existing session found - return it and update the timestamp
      const { data: updatedSession, error: updateError } = await supabase
        .from('sessions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', existingSession.id)
        .select()
        .single();

      if (updateError) {
        logger.error('Error updating session', updateError);
        throw new Error('Failed to update session');
      }

      session = {
        id: updatedSession.id,
        walletAddress: updatedSession.wallet_address,
        currentNetwork: updatedSession.current_network,
        createdAt: updatedSession.created_at,
        updatedAt: updatedSession.updated_at,
      };

      logger.info('Returning existing session', { sessionId: session.id });
    } else {
      // Create new session
      const { data: newSession, error: insertError } = await supabase
        .from('sessions')
        .insert({
          wallet_address: normalizedAddress,
          current_network: body.network,
        })
        .select()
        .single();

      if (insertError) {
        logger.error('Error creating session', insertError);
        throw new Error('Failed to create session');
      }

      session = {
        id: newSession.id,
        walletAddress: newSession.wallet_address,
        currentNetwork: newSession.current_network,
        createdAt: newSession.created_at,
        updatedAt: newSession.updated_at,
      };

      // Create default policy for new session
      const { error: policyError } = await supabase
        .from('policies')
        .insert({
          session_id: newSession.id,
          max_per_tx_usd: 1000,
          max_daily_usd: 5000,
          allow_unknown_contracts: false,
          max_slippage_bps: 300,
        });

      if (policyError) {
        logger.error('Error creating default policy', policyError);
        // Don't throw - session was created, policy can be created later
      }

      logger.info('Created new session with default policy', { sessionId: session.id });
    }

    // Fetch the policy for this session
    const { data: policyData } = await supabase
      .from('policies')
      .select('*')
      .eq('session_id', session.id)
      .single();

    // Fetch token and contract lists
    const [tokenListsResult, contractListsResult] = await Promise.all([
      supabase
        .from('policy_token_lists')
        .select('*')
        .eq('policy_id', policyData?.id || ''),
      supabase
        .from('policy_contract_lists')
        .select('*')
        .eq('policy_id', policyData?.id || ''),
    ]);

    const tokenLists = tokenListsResult.data || [];
    const contractLists = contractListsResult.data || [];

    const policy = policyData ? {
      id: policyData.id,
      sessionId: policyData.session_id,
      securityLevel: policyData.security_level,
      maxPerTxUsd: policyData.max_per_tx_usd,
      maxDailyUsd: policyData.max_daily_usd,
      requireVerifiedContracts: policyData.require_verified_contracts,
      largeTransactionThresholdPct: policyData.large_transaction_threshold_pct,
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
    } : null;

    const response: CreateSessionResponse = {
      session,
      policy: policy || {
        id: '',
        sessionId: session.id,
        securityLevel: 'NORMAL',
        maxPerTxUsd: 1000,
        maxDailyUsd: 5000,
        requireVerifiedContracts: false,
        largeTransactionThresholdPct: 30,
        maxSlippageBps: 300,
        allowedTokens: [],
        deniedTokens: [],
        allowedContracts: [],
        deniedContracts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };

    const duration = Date.now() - startTime;
    logger.apiResponse('POST', '/api/sessions', 200, duration);

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Create session API error', error);
    logger.apiResponse('POST', '/api/sessions', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      throw new ValidationError('Session ID is required');
    }

    logger.apiRequest('GET', '/api/sessions', { sessionId });

    const supabase = createAdminClient();

    const { data: sessionData, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error || !sessionData) {
      return NextResponse.json(
        { error: 'Session not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const session = {
      id: sessionData.id,
      walletAddress: sessionData.wallet_address,
      currentNetwork: sessionData.current_network,
      createdAt: sessionData.created_at,
      updatedAt: sessionData.updated_at,
    };

    const duration = Date.now() - startTime;
    logger.apiResponse('GET', '/api/sessions', 200, duration);

    return NextResponse.json({ session });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Get session API error', error);
    logger.apiResponse('GET', '/api/sessions', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { sessionId, network } = body;

    if (!sessionId) {
      throw new ValidationError('Session ID is required');
    }

    if (!isValidNetwork(network)) {
      throw new ValidationError('Invalid network');
    }

    logger.apiRequest('PATCH', '/api/sessions', { sessionId, network });

    const supabase = createAdminClient();

    // Get current session to get wallet address
    const { data: currentSession, error: fetchError } = await supabase
      .from('sessions')
      .select('wallet_address')
      .eq('id', sessionId)
      .single();

    if (fetchError || !currentSession) {
      return NextResponse.json(
        { error: 'Session not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Check if a session already exists for this wallet + new network
    const { data: existingSession } = await supabase
      .from('sessions')
      .select('*')
      .eq('wallet_address', currentSession.wallet_address)
      .eq('current_network', network)
      .single();

    if (existingSession && existingSession.id !== sessionId) {
      // Return the existing session for the new network instead
      const session = {
        id: existingSession.id,
        walletAddress: existingSession.wallet_address,
        currentNetwork: existingSession.current_network,
        createdAt: existingSession.created_at,
        updatedAt: existingSession.updated_at,
      };

      const duration = Date.now() - startTime;
      logger.apiResponse('PATCH', '/api/sessions', 200, duration);
      logger.info('Switched to existing session for network', { sessionId: session.id, network });

      return NextResponse.json({ session, switched: true });
    }

    // Update the current session's network
    const { data: updatedSession, error: updateError } = await supabase
      .from('sessions')
      .update({ 
        current_network: network,
        updated_at: new Date().toISOString() 
      })
      .eq('id', sessionId)
      .select()
      .single();

    if (updateError) {
      logger.error('Error updating session network', updateError);
      throw new Error('Failed to update session');
    }

    const session = {
      id: updatedSession.id,
      walletAddress: updatedSession.wallet_address,
      currentNetwork: updatedSession.current_network,
      createdAt: updatedSession.created_at,
      updatedAt: updatedSession.updated_at,
    };

    const duration = Date.now() - startTime;
    logger.apiResponse('PATCH', '/api/sessions', 200, duration);

    return NextResponse.json({ session });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Update session API error', error);
    logger.apiResponse('PATCH', '/api/sessions', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}
