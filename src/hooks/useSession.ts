'use client';

import { useState, useCallback, useRef } from 'react';
import type { PolicyWithLists } from '@/lib/types';
import type { NetworkType } from '@/lib/utils/constants';

interface Session {
  id: string;
  walletAddress: string;
  currentNetwork: NetworkType;
  createdAt: string;
}

interface UseSessionReturn {
  session: Session | null;
  policy: PolicyWithLists | null;
  isLoading: boolean;
  error: Error | null;
  createSession: (walletAddress: string, network: NetworkType) => Promise<void>;
  updateNetwork: (network: NetworkType) => Promise<void>;
  updatePolicy: (updates: Partial<PolicyWithLists>) => Promise<void>;
  clearSession: () => void;
}

/**
 * Get the localStorage key for a specific wallet address
 */
function getSessionStorageKey(walletAddress: string): string {
  return `chainpilot_session_${walletAddress.toLowerCase()}`;
}

/**
 * Get the localStorage key for active conversation for a specific wallet
 */
export function getConversationStorageKey(walletAddress: string): string {
  return `chainpilot_conversation_${walletAddress.toLowerCase()}`;
}

export function useSession(): UseSessionReturn {
  const [session, setSession] = useState<Session | null>(null);
  const [policy, setPolicy] = useState<PolicyWithLists | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  // Track the current wallet to detect changes
  const currentWalletRef = useRef<string | null>(null);

  /**
   * Clear all session state
   * Called when wallet disconnects or changes
   */
  const clearSession = useCallback(() => {
    setSession(null);
    setPolicy(null);
    setError(null);
    currentWalletRef.current = null;
  }, []);

  /**
   * Restore session for a specific wallet from localStorage
   */
  const restoreSessionForWallet = useCallback(async (walletAddress: string, network: NetworkType): Promise<boolean> => {
    const normalizedAddress = walletAddress.toLowerCase();
    const storageKey = getSessionStorageKey(normalizedAddress);
    const storedSessionId = localStorage.getItem(storageKey);
    
    if (!storedSessionId) {
      return false;
    }

    try {
      // Fetch session and verify it belongs to this wallet
      const sessionRes = await fetch(`/api/sessions?sessionId=${storedSessionId}`);
      
      if (sessionRes.status === 404) {
        // Session no longer exists, clear it
        localStorage.removeItem(storageKey);
        return false;
      }

      const sessionData = await sessionRes.json();
      
      // Verify the session belongs to this wallet
      if (sessionData?.session?.walletAddress?.toLowerCase() !== normalizedAddress) {
        // Session doesn't belong to this wallet, clear it
        localStorage.removeItem(storageKey);
        return false;
      }

      // Check if network matches, if not we'll need to create/get new session
      if (sessionData.session.currentNetwork !== network) {
        // Network mismatch - don't restore, let createSession handle it
        return false;
      }

      // Session is valid and belongs to this wallet
      setSession(sessionData.session);

      // Fetch policy for this session
      const policyRes = await fetch(`/api/policies?sessionId=${storedSessionId}`);
      if (policyRes.ok) {
        const policyData = await policyRes.json();
        if (policyData?.policy) {
          setPolicy(policyData.policy);
        }
      }

      return true;
    } catch (error) {
      console.error('Error restoring session:', error);
      localStorage.removeItem(storageKey);
      return false;
    }
  }, []);

  const createSession = useCallback(async (walletAddress: string, network: NetworkType) => {
    const normalizedAddress = walletAddress.toLowerCase();
    
    // Check if this is a different wallet than before
    if (currentWalletRef.current && currentWalletRef.current !== normalizedAddress) {
      // Wallet changed, clear old session first
      clearSession();
    }
    
    // Update current wallet reference
    currentWalletRef.current = normalizedAddress;

    setIsLoading(true);
    setError(null);

    try {
      // First, try to restore existing session for this wallet
      const restored = await restoreSessionForWallet(walletAddress, network);
      if (restored) {
        setIsLoading(false);
        return;
      }

      // Create or get session from backend
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, network }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create session');
      }

      const data = await response.json();
      setSession(data.session);
      setPolicy(data.policy);
      
      // Store session ID with wallet-specific key
      const storageKey = getSessionStorageKey(normalizedAddress);
      localStorage.setItem(storageKey, data.session.id);
      
      // Clear any global legacy key
      localStorage.removeItem('chainpilot_session_id');
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to create session');
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [clearSession, restoreSessionForWallet]);

  const updateNetwork = useCallback(async (network: NetworkType) => {
    if (!session) return;

    // Skip if already on this network
    if (session.currentNetwork === network) return;

    setIsLoading(true);
    setError(null);

    try {
      // Create/get session for the new network (same wallet)
      // The backend handles returning existing sessions for wallet+network combos
      await createSession(session.walletAddress, network);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to update network');
      setError(error);
    } finally {
      setIsLoading(false);
    }
  }, [session, createSession]);

  const updatePolicy = useCallback(async (updates: Partial<PolicyWithLists>) => {
    if (!session) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, ...updates }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update policy');
      }

      const data = await response.json();
      setPolicy(data.policy);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to update policy');
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  return {
    session,
    policy,
    isLoading,
    error,
    createSession,
    updateNetwork,
    updatePolicy,
    clearSession,
  };
}
