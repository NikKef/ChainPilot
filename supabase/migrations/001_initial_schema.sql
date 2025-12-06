-- ChainPilot Database Schema
-- Initial migration for Supabase PostgreSQL

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TABLES
-- ============================================

-- Users table (extends Supabase auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions table
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  current_network TEXT NOT NULL CHECK (current_network IN ('testnet', 'mainnet')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, wallet_address, current_network)
);

-- Policies table
CREATE TABLE public.policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  max_per_tx_usd DECIMAL(20, 8),
  max_daily_usd DECIMAL(20, 8),
  allow_unknown_contracts BOOLEAN DEFAULT false,
  max_slippage_bps INTEGER DEFAULT 300,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id)
);

-- Policy allow/deny lists for tokens
CREATE TABLE public.policy_token_lists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  policy_id UUID NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  token_address TEXT NOT NULL,
  list_type TEXT NOT NULL CHECK (list_type IN ('allowed', 'denied')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(policy_id, token_address, list_type)
);

-- Policy allow/deny lists for contracts
CREATE TABLE public.policy_contract_lists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  policy_id UUID NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  contract_address TEXT NOT NULL,
  list_type TEXT NOT NULL CHECK (list_type IN ('allowed', 'denied')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(policy_id, contract_address, list_type)
);

-- Contracts table
CREATE TABLE public.contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  address TEXT,
  network TEXT NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  source_code TEXT,
  bytecode TEXT,
  abi JSONB,
  contract_name TEXT,
  is_generated BOOLEAN DEFAULT false,
  last_audit_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(address, network)
);

-- Audits table
CREATE TABLE public.audits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'BLOCKED')),
  summary TEXT,
  major_findings JSONB DEFAULT '[]'::jsonb,
  medium_findings JSONB DEFAULT '[]'::jsonb,
  minor_findings JSONB DEFAULT '[]'::jsonb,
  recommendations JSONB DEFAULT '[]'::jsonb,
  raw_response JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat messages table
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  intent JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Action logs table
CREATE TABLE public.action_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  intent_type TEXT NOT NULL CHECK (intent_type IN ('research', 'explain', 'generate_contract', 'audit_contract', 'transfer', 'swap', 'contract_call', 'deploy')),
  network TEXT NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  user_message TEXT,
  parsed_intent JSONB,
  prepared_tx JSONB,
  policy_decision JSONB,
  estimated_value_usd DECIMAL(20, 8),
  tx_hash TEXT,
  q402_request_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'failed', 'cancelled')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ
);

-- Daily spend tracking
CREATE TABLE public.daily_spend (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_spent_usd DECIMAL(20, 8) DEFAULT 0,
  transaction_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, date)
);

-- Token metadata cache
CREATE TABLE public.token_metadata (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  address TEXT NOT NULL,
  network TEXT NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  symbol TEXT,
  name TEXT,
  decimals INTEGER,
  logo_url TEXT,
  price_usd DECIMAL(20, 8),
  price_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(address, network)
);

-- Generated contracts (user-created)
CREATE TABLE public.generated_contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  contract_id UUID REFERENCES public.contracts(id) ON DELETE SET NULL,
  spec_text TEXT NOT NULL,
  source_code TEXT NOT NULL,
  network TEXT NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  deployed_address TEXT,
  deployment_tx_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deployed_at TIMESTAMPTZ
);

-- Q402 transaction tracking
CREATE TABLE public.q402_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action_log_id UUID REFERENCES public.action_logs(id) ON DELETE SET NULL,
  q402_request_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'signed', 'executing', 'completed', 'failed')),
  tx_hash TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TRIGGERS
-- ============================================

-- Update contracts.last_audit_id trigger
CREATE OR REPLACE FUNCTION update_contract_last_audit()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.contracts
  SET last_audit_id = NEW.id, updated_at = NOW()
  WHERE id = NEW.contract_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_contract_audit_trigger
AFTER INSERT ON public.audits
FOR EACH ROW
EXECUTE FUNCTION update_contract_last_audit();

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_sessions_updated_at
BEFORE UPDATE ON public.sessions
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_policies_updated_at
BEFORE UPDATE ON public.policies
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_contracts_updated_at
BEFORE UPDATE ON public.contracts
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_daily_spend_updated_at
BEFORE UPDATE ON public.daily_spend
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_token_metadata_updated_at
BEFORE UPDATE ON public.token_metadata
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_q402_transactions_updated_at
BEFORE UPDATE ON public.q402_transactions
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX idx_sessions_wallet_address ON public.sessions(wallet_address);
CREATE INDEX idx_policies_session_id ON public.policies(session_id);
CREATE INDEX idx_contracts_address_network ON public.contracts(address, network);
CREATE INDEX idx_audits_contract_id ON public.audits(contract_id);
CREATE INDEX idx_audits_created_at ON public.audits(created_at DESC);
CREATE INDEX idx_chat_messages_session_id ON public.chat_messages(session_id);
CREATE INDEX idx_chat_messages_created_at ON public.chat_messages(created_at DESC);
CREATE INDEX idx_action_logs_session_id ON public.action_logs(session_id);
CREATE INDEX idx_action_logs_created_at ON public.action_logs(created_at DESC);
CREATE INDEX idx_action_logs_status ON public.action_logs(status);
CREATE INDEX idx_action_logs_tx_hash ON public.action_logs(tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX idx_daily_spend_session_date ON public.daily_spend(session_id, date DESC);
CREATE INDEX idx_token_metadata_address_network ON public.token_metadata(address, network);
CREATE INDEX idx_generated_contracts_session_id ON public.generated_contracts(session_id);
CREATE INDEX idx_q402_transactions_request_id ON public.q402_transactions(q402_request_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_token_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_contract_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_spend ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.q402_transactions ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES
-- ============================================

-- Profiles: Users can only access their own profile
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Sessions: Users can only access their own sessions
CREATE POLICY "Users can view own sessions" ON public.sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own sessions" ON public.sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions" ON public.sessions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sessions" ON public.sessions
  FOR DELETE USING (auth.uid() = user_id);

-- Policies: Users can manage their own policies
CREATE POLICY "Users can view own policies" ON public.policies
  FOR SELECT USING (
    session_id IN (SELECT id FROM public.sessions WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can manage own policies" ON public.policies
  FOR ALL USING (
    session_id IN (SELECT id FROM public.sessions WHERE user_id = auth.uid())
  );

-- Policy Token Lists
CREATE POLICY "Users can manage own policy token lists" ON public.policy_token_lists
  FOR ALL USING (
    policy_id IN (
      SELECT id FROM public.policies WHERE session_id IN (
        SELECT id FROM public.sessions WHERE user_id = auth.uid()
      )
    )
  );

-- Policy Contract Lists
CREATE POLICY "Users can manage own policy contract lists" ON public.policy_contract_lists
  FOR ALL USING (
    policy_id IN (
      SELECT id FROM public.policies WHERE session_id IN (
        SELECT id FROM public.sessions WHERE user_id = auth.uid()
      )
    )
  );

-- Contracts and audits are readable by all (public data)
CREATE POLICY "Contracts are viewable by all" ON public.contracts
  FOR SELECT USING (true);

CREATE POLICY "Audits are viewable by all" ON public.audits
  FOR SELECT USING (true);

-- Service role can insert contracts and audits
CREATE POLICY "Service role can insert contracts" ON public.contracts
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Service role can insert audits" ON public.audits
  FOR INSERT WITH CHECK (true);

-- Chat Messages: Users can only access their own messages
CREATE POLICY "Users can view own chat messages" ON public.chat_messages
  FOR SELECT USING (
    session_id IN (SELECT id FROM public.sessions WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can create own chat messages" ON public.chat_messages
  FOR INSERT WITH CHECK (
    session_id IN (SELECT id FROM public.sessions WHERE user_id = auth.uid())
  );

-- Action Logs: Users can only access their own logs
CREATE POLICY "Users can view own action logs" ON public.action_logs
  FOR SELECT USING (
    session_id IN (SELECT id FROM public.sessions WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can create own action logs" ON public.action_logs
  FOR INSERT WITH CHECK (
    session_id IN (SELECT id FROM public.sessions WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update own action logs" ON public.action_logs
  FOR UPDATE USING (
    session_id IN (SELECT id FROM public.sessions WHERE user_id = auth.uid())
  );

-- Daily Spend: Users can access their own spend data
CREATE POLICY "Users can view own daily spend" ON public.daily_spend
  FOR SELECT USING (
    session_id IN (SELECT id FROM public.sessions WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can manage own daily spend" ON public.daily_spend
  FOR ALL USING (
    session_id IN (SELECT id FROM public.sessions WHERE user_id = auth.uid())
  );

-- Token metadata is viewable by all (cached public data)
CREATE POLICY "Token metadata is viewable by all" ON public.token_metadata
  FOR SELECT USING (true);

CREATE POLICY "Service role can manage token metadata" ON public.token_metadata
  FOR ALL USING (true);

-- Generated Contracts: Users can only access their own
CREATE POLICY "Users can view own generated contracts" ON public.generated_contracts
  FOR SELECT USING (
    session_id IN (SELECT id FROM public.sessions WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can create own generated contracts" ON public.generated_contracts
  FOR INSERT WITH CHECK (
    session_id IN (SELECT id FROM public.sessions WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update own generated contracts" ON public.generated_contracts
  FOR UPDATE USING (
    session_id IN (SELECT id FROM public.sessions WHERE user_id = auth.uid())
  );

-- Q402 Transactions: Users can access their own
CREATE POLICY "Users can view own q402 transactions" ON public.q402_transactions
  FOR SELECT USING (
    action_log_id IN (
      SELECT id FROM public.action_logs WHERE session_id IN (
        SELECT id FROM public.sessions WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Service role can manage q402 transactions" ON public.q402_transactions
  FOR ALL USING (true);

-- ============================================
-- SEED DATA: Common token metadata
-- ============================================

INSERT INTO public.token_metadata (address, network, symbol, name, decimals) VALUES
-- Testnet tokens
('0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd', 'testnet', 'WBNB', 'Wrapped BNB', 18),
('0x337610d27c682E347C9cD60BD4b3b107C9d34dDd', 'testnet', 'USDT', 'Tether USD', 18),
('0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee', 'testnet', 'BUSD', 'Binance USD', 18),
('0x64544969ed7EBf5f083679233325356EbE738930', 'testnet', 'USDC', 'USD Coin', 18),
-- Mainnet tokens
('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', 'mainnet', 'WBNB', 'Wrapped BNB', 18),
('0x55d398326f99059fF775485246999027B3197955', 'mainnet', 'USDT', 'Tether USD', 18),
('0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', 'mainnet', 'BUSD', 'Binance USD', 18),
('0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 'mainnet', 'USDC', 'USD Coin', 18)
ON CONFLICT (address, network) DO NOTHING;

