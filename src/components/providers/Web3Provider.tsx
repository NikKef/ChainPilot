'use client';

import { createContext, useContext, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useWeb3, type UseWeb3Return } from '@/hooks/useWeb3';
import { useSession, getConversationStorageKey } from '@/hooks/useSession';
import { useConversations, type Conversation } from '@/hooks/useConversations';
import type { NetworkType } from '@/lib/utils/constants';
import type { PolicyWithLists } from '@/lib/types';

interface Web3ContextValue extends UseWeb3Return {
  // Session integration
  sessionId: string | null;
  isSessionReady: boolean;
  initializeSession: () => Promise<void>;
  // Policy integration
  policy: PolicyWithLists | null;
  updatePolicy: (updates: Partial<PolicyWithLists>) => Promise<void>;
  isSessionLoading: boolean;
  // Conversation integration
  conversations: Conversation[];
  activeConversationId: string | null;
  isConversationsLoading: boolean;
  setActiveConversation: (conversationId: string | null) => void;
  startNewChat: () => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  renameConversation: (conversationId: string, title: string) => Promise<void>;
  refreshConversations: () => Promise<void>;
}

const Web3Context = createContext<Web3ContextValue | null>(null);

interface Web3ProviderProps {
  children: ReactNode;
}

export function Web3Provider({ children }: Web3ProviderProps) {
  const web3 = useWeb3();
  const { 
    session, 
    policy, 
    createSession, 
    updateNetwork, 
    updatePolicy, 
    clearSession,
    isLoading: sessionLoading 
  } = useSession();
  
  // Track the previous wallet address to detect changes
  const previousAddressRef = useRef<string | null>(null);
  
  // Conversation management - pass wallet address for storage key
  const {
    conversations,
    activeConversationId,
    isLoading: conversationsLoading,
    setActiveConversation,
    startNewChat,
    deleteConversation,
    renameConversation,
    loadConversations,
    clearConversations,
  } = useConversations({ 
    sessionId: session?.id ?? null, 
    walletAddress: web3.address,
    autoLoad: true 
  });
  
  // Refs to prevent duplicate calls
  const isCreatingSession = useRef(false);
  const isUpdatingNetwork = useRef(false);

  // Initialize or update session when wallet connects
  const initializeSession = useCallback(async () => {
    if (web3.address && web3.network && !isCreatingSession.current) {
      isCreatingSession.current = true;
      try {
        await createSession(web3.address, web3.network);
      } catch (error) {
        console.error('Failed to create session:', error);
      } finally {
        isCreatingSession.current = false;
      }
    }
  }, [web3.address, web3.network, createSession]);

  // Handle wallet connection/change
  useEffect(() => {
    const currentAddress = web3.address?.toLowerCase() ?? null;
    const previousAddress = previousAddressRef.current;

    // Detect wallet change
    if (previousAddress !== null && currentAddress !== null && previousAddress !== currentAddress) {
      console.log('[Web3Provider] Wallet changed from', previousAddress, 'to', currentAddress);
      // Clear previous session data
      clearSession();
      clearConversations();
    }

    // Update previous address ref
    previousAddressRef.current = currentAddress;

    // Initialize session for connected wallet
    if (web3.isConnected && web3.address && web3.network && !session && !sessionLoading && !isCreatingSession.current) {
      initializeSession();
    }
  }, [web3.isConnected, web3.address, web3.network, session, sessionLoading, initializeSession, clearSession, clearConversations]);

  // Handle wallet disconnection
  useEffect(() => {
    if (!web3.isConnected && session) {
      console.log('[Web3Provider] Wallet disconnected, clearing session');
      clearSession();
      clearConversations();
      previousAddressRef.current = null;
    }
  }, [web3.isConnected, session, clearSession, clearConversations]);

  // Update session when network changes
  useEffect(() => {
    if (session && web3.network && session.currentNetwork !== web3.network && !isUpdatingNetwork.current) {
      isUpdatingNetwork.current = true;
      updateNetwork(web3.network).finally(() => {
        isUpdatingNetwork.current = false;
      });
    }
  }, [web3.network, session, updateNetwork]);

  const contextValue: Web3ContextValue = {
    ...web3,
    sessionId: session?.id ?? null,
    isSessionReady: !!session && !sessionLoading,
    initializeSession,
    // Expose policy from the shared session state
    policy,
    updatePolicy,
    isSessionLoading: sessionLoading,
    // Expose conversation management
    conversations,
    activeConversationId,
    isConversationsLoading: conversationsLoading,
    setActiveConversation,
    startNewChat,
    deleteConversation,
    renameConversation,
    refreshConversations: loadConversations,
  };

  return (
    <Web3Context.Provider value={contextValue}>
      {children}
    </Web3Context.Provider>
  );
}

export function useWeb3Context(): Web3ContextValue {
  const context = useContext(Web3Context);
  if (!context) {
    throw new Error('useWeb3Context must be used within a Web3Provider');
  }
  return context;
}

// Hook to check if wallet is connected and on correct network
export function useRequireWallet(): {
  isReady: boolean;
  isConnected: boolean;
  isCorrectNetwork: boolean;
  address: string | null;
  network: NetworkType | null;
} {
  const { isConnected, isCorrectNetwork, address, network } = useWeb3Context();
  
  return {
    isReady: isConnected && isCorrectNetwork,
    isConnected,
    isCorrectNetwork,
    address,
    network,
  };
}
