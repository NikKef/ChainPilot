export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          wallet_address: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          wallet_address?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          wallet_address?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      sessions: {
        Row: {
          id: string;
          user_id: string | null;
          wallet_address: string;
          current_network: 'testnet' | 'mainnet';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          wallet_address: string;
          current_network: 'testnet' | 'mainnet';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          wallet_address?: string;
          current_network?: 'testnet' | 'mainnet';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      policies: {
        Row: {
          id: string;
          session_id: string;
          security_level: 'STRICT' | 'NORMAL' | 'PERMISSIVE';
          max_per_tx_usd: number | null;
          max_daily_usd: number | null;
          require_verified_contracts: boolean;
          large_transaction_threshold_pct: number;
          max_slippage_bps: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          security_level?: 'STRICT' | 'NORMAL' | 'PERMISSIVE';
          max_per_tx_usd?: number | null;
          max_daily_usd?: number | null;
          require_verified_contracts?: boolean;
          large_transaction_threshold_pct?: number;
          max_slippage_bps?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          security_level?: 'STRICT' | 'NORMAL' | 'PERMISSIVE';
          max_per_tx_usd?: number | null;
          max_daily_usd?: number | null;
          require_verified_contracts?: boolean;
          large_transaction_threshold_pct?: number;
          max_slippage_bps?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      policy_token_lists: {
        Row: {
          id: string;
          policy_id: string;
          token_address: string;
          list_type: 'allowed' | 'denied';
          created_at: string;
        };
        Insert: {
          id?: string;
          policy_id: string;
          token_address: string;
          list_type: 'allowed' | 'denied';
          created_at?: string;
        };
        Update: {
          id?: string;
          policy_id?: string;
          token_address?: string;
          list_type?: 'allowed' | 'denied';
          created_at?: string;
        };
        Relationships: [];
      };
      policy_contract_lists: {
        Row: {
          id: string;
          policy_id: string;
          contract_address: string;
          list_type: 'allowed' | 'denied';
          created_at: string;
        };
        Insert: {
          id?: string;
          policy_id: string;
          contract_address: string;
          list_type: 'allowed' | 'denied';
          created_at?: string;
        };
        Update: {
          id?: string;
          policy_id?: string;
          contract_address?: string;
          list_type?: 'allowed' | 'denied';
          created_at?: string;
        };
        Relationships: [];
      };
      contracts: {
        Row: {
          id: string;
          address: string | null;
          network: 'testnet' | 'mainnet';
          source_code: string | null;
          bytecode: string | null;
          abi: Json | null;
          contract_name: string | null;
          is_generated: boolean;
          last_audit_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          address?: string | null;
          network: 'testnet' | 'mainnet';
          source_code?: string | null;
          bytecode?: string | null;
          abi?: Json | null;
          contract_name?: string | null;
          is_generated?: boolean;
          last_audit_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          address?: string | null;
          network?: 'testnet' | 'mainnet';
          source_code?: string | null;
          bytecode?: string | null;
          abi?: Json | null;
          contract_name?: string | null;
          is_generated?: boolean;
          last_audit_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      audits: {
        Row: {
          id: string;
          contract_id: string;
          risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
          summary: string | null;
          major_findings: Json;
          medium_findings: Json;
          minor_findings: Json;
          recommendations: Json;
          raw_response: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          contract_id: string;
          risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
          summary?: string | null;
          major_findings?: Json;
          medium_findings?: Json;
          minor_findings?: Json;
          recommendations?: Json;
          raw_response?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          contract_id?: string;
          risk_level?: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
          summary?: string | null;
          major_findings?: Json;
          medium_findings?: Json;
          minor_findings?: Json;
          recommendations?: Json;
          raw_response?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      chat_messages: {
        Row: {
          id: string;
          session_id: string;
          conversation_id: string | null;
          role: 'user' | 'assistant' | 'system';
          content: string;
          intent: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          conversation_id?: string | null;
          role: 'user' | 'assistant' | 'system';
          content: string;
          intent?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          conversation_id?: string | null;
          role?: 'user' | 'assistant' | 'system';
          content?: string;
          intent?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          session_id: string;
          title: string;
          summary: string | null;
          is_active: boolean;
          message_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          title?: string;
          summary?: string | null;
          is_active?: boolean;
          message_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          title?: string;
          summary?: string | null;
          is_active?: boolean;
          message_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      action_logs: {
        Row: {
          id: string;
          session_id: string;
          intent_type: 'research' | 'explain' | 'generate_contract' | 'audit_contract' | 'transfer' | 'swap' | 'contract_call' | 'deploy';
          network: 'testnet' | 'mainnet';
          user_message: string | null;
          parsed_intent: Json | null;
          prepared_tx: Json | null;
          policy_decision: Json | null;
          estimated_value_usd: number | null;
          tx_hash: string | null;
          q402_request_id: string | null;
          status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'cancelled';
          error_message: string | null;
          created_at: string;
          executed_at: string | null;
        };
        Insert: {
          id?: string;
          session_id: string;
          intent_type: 'research' | 'explain' | 'generate_contract' | 'audit_contract' | 'transfer' | 'swap' | 'contract_call' | 'deploy';
          network: 'testnet' | 'mainnet';
          user_message?: string | null;
          parsed_intent?: Json | null;
          prepared_tx?: Json | null;
          policy_decision?: Json | null;
          estimated_value_usd?: number | null;
          tx_hash?: string | null;
          q402_request_id?: string | null;
          status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'cancelled';
          error_message?: string | null;
          created_at?: string;
          executed_at?: string | null;
        };
        Update: {
          id?: string;
          session_id?: string;
          intent_type?: 'research' | 'explain' | 'generate_contract' | 'audit_contract' | 'transfer' | 'swap' | 'contract_call' | 'deploy';
          network?: 'testnet' | 'mainnet';
          user_message?: string | null;
          parsed_intent?: Json | null;
          prepared_tx?: Json | null;
          policy_decision?: Json | null;
          estimated_value_usd?: number | null;
          tx_hash?: string | null;
          q402_request_id?: string | null;
          status?: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'cancelled';
          error_message?: string | null;
          created_at?: string;
          executed_at?: string | null;
        };
        Relationships: [];
      };
      daily_spend: {
        Row: {
          id: string;
          session_id: string;
          date: string;
          total_spent_usd: number;
          transaction_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          date: string;
          total_spent_usd?: number;
          transaction_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          date?: string;
          total_spent_usd?: number;
          transaction_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      token_metadata: {
        Row: {
          id: string;
          address: string;
          network: 'testnet' | 'mainnet';
          symbol: string | null;
          name: string | null;
          decimals: number | null;
          logo_url: string | null;
          price_usd: number | null;
          price_updated_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          address: string;
          network: 'testnet' | 'mainnet';
          symbol?: string | null;
          name?: string | null;
          decimals?: number | null;
          logo_url?: string | null;
          price_usd?: number | null;
          price_updated_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          address?: string;
          network?: 'testnet' | 'mainnet';
          symbol?: string | null;
          name?: string | null;
          decimals?: number | null;
          logo_url?: string | null;
          price_usd?: number | null;
          price_updated_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      generated_contracts: {
        Row: {
          id: string;
          session_id: string;
          contract_id: string | null;
          spec_text: string;
          source_code: string;
          network: 'testnet' | 'mainnet';
          deployed_address: string | null;
          deployment_tx_hash: string | null;
          created_at: string;
          deployed_at: string | null;
        };
        Insert: {
          id?: string;
          session_id: string;
          contract_id?: string | null;
          spec_text: string;
          source_code: string;
          network: 'testnet' | 'mainnet';
          deployed_address?: string | null;
          deployment_tx_hash?: string | null;
          created_at?: string;
          deployed_at?: string | null;
        };
        Update: {
          id?: string;
          session_id?: string;
          contract_id?: string | null;
          spec_text?: string;
          source_code?: string;
          network?: 'testnet' | 'mainnet';
          deployed_address?: string | null;
          deployment_tx_hash?: string | null;
          created_at?: string;
          deployed_at?: string | null;
        };
        Relationships: [];
      };
      q402_transactions: {
        Row: {
          id: string;
          action_log_id: string | null;
          q402_request_id: string;
          status: 'pending' | 'signed' | 'executing' | 'completed' | 'failed';
          tx_hash: string | null;
          error_message: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          action_log_id?: string | null;
          q402_request_id: string;
          status: 'pending' | 'signed' | 'executing' | 'completed' | 'failed';
          tx_hash?: string | null;
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          action_log_id?: string | null;
          q402_request_id?: string;
          status?: 'pending' | 'signed' | 'executing' | 'completed' | 'failed';
          tx_hash?: string | null;
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};


