import { createAdminClient } from '@/lib/supabase/server';
import type { PolicyWithLists } from '@/lib/types';
import { DEFAULT_POLICY_VALUES } from '@/lib/types/policy';
import { logger } from '@/lib/utils';

/**
 * Fetch the user's policy (with allow/deny lists) for a session.
 * If none exists yet, create a default one.
 */
export async function getPolicyForSession(sessionId: string): Promise<PolicyWithLists> {
  const supabase = createAdminClient();

  // Try to load existing policy
  const { data: policyRow, error: policyError } = await supabase
    .from('policies')
    .select('*')
    .eq('session_id', sessionId)
    .single();

  let policyId: string;
  let securityLevel = DEFAULT_POLICY_VALUES.securityLevel;
  let maxPerTxUsd = DEFAULT_POLICY_VALUES.maxPerTxUsd;
  let maxDailyUsd = DEFAULT_POLICY_VALUES.maxDailyUsd;
  let requireVerifiedContracts = DEFAULT_POLICY_VALUES.requireVerifiedContracts;
  let largeTransactionThresholdPct = DEFAULT_POLICY_VALUES.largeTransactionThresholdPct;
  let maxSlippageBps = DEFAULT_POLICY_VALUES.maxSlippageBps;
  let createdAt = new Date().toISOString();
  let updatedAt = createdAt;

  if (!policyError && policyRow) {
    policyId = policyRow.id;
    securityLevel = policyRow.security_level || securityLevel;
    maxPerTxUsd = policyRow.max_per_tx_usd ?? maxPerTxUsd;
    maxDailyUsd = policyRow.max_daily_usd ?? maxDailyUsd;
    requireVerifiedContracts = policyRow.require_verified_contracts ?? requireVerifiedContracts;
    largeTransactionThresholdPct =
      policyRow.large_transaction_threshold_pct ?? largeTransactionThresholdPct;
    maxSlippageBps = policyRow.max_slippage_bps ?? maxSlippageBps;
    createdAt = policyRow.created_at || createdAt;
    updatedAt = policyRow.updated_at || updatedAt;
  } else {
    // Create default policy if missing
    const { data: newPolicy, error: insertError } = await supabase
      .from('policies')
      .insert({
        session_id: sessionId,
        security_level: securityLevel,
        max_per_tx_usd: maxPerTxUsd,
        max_daily_usd: maxDailyUsd,
        require_verified_contracts: requireVerifiedContracts,
        large_transaction_threshold_pct: largeTransactionThresholdPct,
        max_slippage_bps: maxSlippageBps,
      })
      .select()
      .single();

    if (insertError || !newPolicy) {
      logger.error('Failed to create default policy', insertError);
      throw new Error('Unable to initialize security policy for this session');
    }

    policyId = newPolicy.id;
    createdAt = newPolicy.created_at;
    updatedAt = newPolicy.updated_at;
  }

  // Fetch lists
  const [tokenListsResult, contractListsResult] = await Promise.all([
    supabase.from('policy_token_lists').select('*').eq('policy_id', policyId),
    supabase.from('policy_contract_lists').select('*').eq('policy_id', policyId),
  ]);

  const tokenLists = tokenListsResult.data || [];
  const contractLists = contractListsResult.data || [];

  return {
    id: policyId,
    sessionId,
    securityLevel,
    maxPerTxUsd,
    maxDailyUsd,
    requireVerifiedContracts,
    largeTransactionThresholdPct,
    maxSlippageBps,
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
    createdAt,
    updatedAt,
  };
}


