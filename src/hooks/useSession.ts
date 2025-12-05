'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { PolicyWithLists, NetworkType } from '@/lib/types';

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
}

export function useSession(): UseSessionReturn {
  const [session, setSession] = useState<Session | null>(null);
  const [policy, setPolicy] = useState<PolicyWithLists | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  // Ref to prevent duplicate restore attempts
  const isRestoring = useRef(false);
  const hasRestored = useRef(false);

  // Try to restore session from localStorage on mount
  useEffect(() => {
    // Prevent duplicate restore attempts (React Strict Mode, fast refresh, etc.)
    if (isRestoring.current || hasRestored.current) {
      return;
    }
    
    const storedSessionId = localStorage.getItem('chainpilot_session_id');
    if (!storedSessionId) {
      hasRestored.current = true;
      return;
    }
    
    isRestoring.current = true;
    
    // Fetch session data
    fetch(`/api/sessions?sessionId=${storedSessionId}`)
      .then(res => {
        // If session not found (404), clear localStorage and don't try again
        if (res.status === 404) {
          localStorage.removeItem('chainpilot_session_id');
          return null;
        }
        return res.json();
      })
      .then(data => {
        if (data?.session) {
          setSession(data.session);
          // Also fetch policy
          return fetch(`/api/policies?sessionId=${storedSessionId}`);
        }
        return null;
      })
      .then(res => res?.json())
      .then(data => {
        if (data?.policy) {
          setPolicy(data.policy);
        }
      })
      .catch(() => {
        // On any error, clear the stale session ID
        localStorage.removeItem('chainpilot_session_id');
      })
      .finally(() => {
        isRestoring.current = false;
        hasRestored.current = true;
      });
  }, []);

  const createSession = useCallback(async (walletAddress: string, network: NetworkType) => {
    setIsLoading(true);
    setError(null);

    try {
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
      
      // Store session ID
      localStorage.setItem('chainpilot_session_id', data.session.id);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to create session');
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

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
  };
}

