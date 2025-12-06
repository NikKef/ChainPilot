-- ChainPilot Database Schema Update
-- Migration to add security levels to policies

-- ============================================
-- MODIFY POLICIES TABLE
-- ============================================

-- Add security_level column with default 'NORMAL'
ALTER TABLE public.policies 
  ADD COLUMN IF NOT EXISTS security_level TEXT NOT NULL DEFAULT 'NORMAL' 
  CHECK (security_level IN ('STRICT', 'NORMAL', 'PERMISSIVE'));

-- Add require_verified_contracts column for NORMAL mode
ALTER TABLE public.policies 
  ADD COLUMN IF NOT EXISTS require_verified_contracts BOOLEAN DEFAULT false;

-- Add large_transaction_threshold_pct column for warning threshold
ALTER TABLE public.policies 
  ADD COLUMN IF NOT EXISTS large_transaction_threshold_pct INTEGER DEFAULT 30;

-- Remove the old allow_unknown_contracts column (replaced by security_level logic)
-- First check if it exists to avoid errors
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'policies' 
    AND column_name = 'allow_unknown_contracts'
  ) THEN
    ALTER TABLE public.policies DROP COLUMN allow_unknown_contracts;
  END IF;
END $$;

-- ============================================
-- INDEX FOR SECURITY LEVEL QUERIES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_policies_security_level 
  ON public.policies(security_level);

-- ============================================
-- COMMENT DOCUMENTATION
-- ============================================

COMMENT ON COLUMN public.policies.security_level IS 
  'Security enforcement level: STRICT (whitelist-only), NORMAL (blacklist + warnings), PERMISSIVE (allow all)';

COMMENT ON COLUMN public.policies.require_verified_contracts IS 
  'NORMAL mode only: if true, blocks all unverified contracts entirely';

COMMENT ON COLUMN public.policies.large_transaction_threshold_pct IS 
  'Percentage of token balance that triggers a large transaction warning (default 30%)';


