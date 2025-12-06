-- ChainPilot Database Schema Update
-- Migration to support wallet-based sessions without requiring auth.users

-- ============================================
-- DROP EXISTING RLS POLICIES (if they exist)
-- ============================================

-- Drop existing policies on sessions
DROP POLICY IF EXISTS "Users can view own sessions" ON public.sessions;
DROP POLICY IF EXISTS "Users can create own sessions" ON public.sessions;
DROP POLICY IF EXISTS "Users can update own sessions" ON public.sessions;
DROP POLICY IF EXISTS "Users can delete own sessions" ON public.sessions;

-- Drop existing policies on policies table
DROP POLICY IF EXISTS "Users can view own policies" ON public.policies;
DROP POLICY IF EXISTS "Users can manage own policies" ON public.policies;

-- Drop existing policies on policy lists
DROP POLICY IF EXISTS "Users can manage own policy token lists" ON public.policy_token_lists;
DROP POLICY IF EXISTS "Users can manage own policy contract lists" ON public.policy_contract_lists;

-- Drop existing policies on chat messages
DROP POLICY IF EXISTS "Users can view own chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can create own chat messages" ON public.chat_messages;

-- Drop existing policies on action logs
DROP POLICY IF EXISTS "Users can view own action logs" ON public.action_logs;
DROP POLICY IF EXISTS "Users can create own action logs" ON public.action_logs;
DROP POLICY IF EXISTS "Users can update own action logs" ON public.action_logs;

-- Drop existing policies on daily spend
DROP POLICY IF EXISTS "Users can view own daily spend" ON public.daily_spend;
DROP POLICY IF EXISTS "Users can manage own daily spend" ON public.daily_spend;

-- Drop existing policies on generated contracts
DROP POLICY IF EXISTS "Users can view own generated contracts" ON public.generated_contracts;
DROP POLICY IF EXISTS "Users can create own generated contracts" ON public.generated_contracts;
DROP POLICY IF EXISTS "Users can update own generated contracts" ON public.generated_contracts;

-- ============================================
-- MODIFY SESSIONS TABLE
-- ============================================

-- Make user_id optional for wallet-only sessions
ALTER TABLE public.sessions 
  ALTER COLUMN user_id DROP NOT NULL;

-- Drop the existing unique constraint
ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_user_id_wallet_address_current_network_key;

-- Create new unique constraint based on wallet_address + network only
-- This ensures one session per wallet per network
ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_wallet_network_unique UNIQUE (wallet_address, current_network);

-- ============================================
-- NEW RLS POLICIES (permissive for demo)
-- ============================================

-- Sessions: Allow all operations (for demo without auth)
-- In production, you would use wallet signature verification
CREATE POLICY "Allow all session operations" ON public.sessions
  FOR ALL USING (true) WITH CHECK (true);

-- Policies: Allow all operations
CREATE POLICY "Allow all policy operations" ON public.policies
  FOR ALL USING (true) WITH CHECK (true);

-- Policy Token Lists: Allow all operations
CREATE POLICY "Allow all token list operations" ON public.policy_token_lists
  FOR ALL USING (true) WITH CHECK (true);

-- Policy Contract Lists: Allow all operations
CREATE POLICY "Allow all contract list operations" ON public.policy_contract_lists
  FOR ALL USING (true) WITH CHECK (true);

-- Chat Messages: Allow all operations
CREATE POLICY "Allow all chat message operations" ON public.chat_messages
  FOR ALL USING (true) WITH CHECK (true);

-- Action Logs: Allow all operations
CREATE POLICY "Allow all action log operations" ON public.action_logs
  FOR ALL USING (true) WITH CHECK (true);

-- Daily Spend: Allow all operations
CREATE POLICY "Allow all daily spend operations" ON public.daily_spend
  FOR ALL USING (true) WITH CHECK (true);

-- Generated Contracts: Allow all operations
CREATE POLICY "Allow all generated contract operations" ON public.generated_contracts
  FOR ALL USING (true) WITH CHECK (true);

-- Q402 Transactions: Allow all operations
DROP POLICY IF EXISTS "Users can view own q402 transactions" ON public.q402_transactions;
DROP POLICY IF EXISTS "Service role can manage q402 transactions" ON public.q402_transactions;
CREATE POLICY "Allow all q402 transaction operations" ON public.q402_transactions
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- INDEX FOR WALLET LOOKUPS
-- ============================================

-- Add index for faster wallet address lookups
CREATE INDEX IF NOT EXISTS idx_sessions_wallet_network 
  ON public.sessions(wallet_address, current_network);

