'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { getConversationStorageKey } from './useSession';

export interface Conversation {
  id: string;
  sessionId: string;
  title: string;
  summary: string | null;
  isActive: boolean;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface UseConversationsOptions {
  sessionId: string | null;
  walletAddress: string | null;
  autoLoad?: boolean;
}

interface UseConversationsReturn {
  conversations: Conversation[];
  activeConversationId: string | null;
  isLoading: boolean;
  error: Error | null;
  loadConversations: () => Promise<void>;
  createConversation: (title?: string) => Promise<Conversation | null>;
  deleteConversation: (conversationId: string) => Promise<void>;
  renameConversation: (conversationId: string, title: string) => Promise<void>;
  setActiveConversation: (conversationId: string | null) => void;
  startNewChat: () => Promise<void>;
  clearConversations: () => void;
}

export function useConversations({ 
  sessionId, 
  walletAddress,
  autoLoad = true 
}: UseConversationsOptions): UseConversationsReturn {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  // Track the previous session to detect changes
  const previousSessionRef = useRef<string | null>(null);

  /**
   * Get the storage key for active conversation (wallet-specific)
   */
  const getStorageKey = useCallback(() => {
    if (!walletAddress) return null;
    return getConversationStorageKey(walletAddress);
  }, [walletAddress]);

  /**
   * Clear all conversations state
   */
  const clearConversations = useCallback(() => {
    setConversations([]);
    setActiveConversationId(null);
    setError(null);
    previousSessionRef.current = null;
  }, []);

  // Load conversations from API
  const loadConversations = useCallback(async () => {
    if (!sessionId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/conversations?sessionId=${sessionId}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to load conversations');
      }

      const data = await response.json();
      setConversations(data.conversations || []);

      // Try to restore active conversation from wallet-specific storage
      const storageKey = getStorageKey();
      const storedConversationId = storageKey ? localStorage.getItem(storageKey) : null;
      
      if (storedConversationId && data.conversations?.some((c: Conversation) => c.id === storedConversationId)) {
        // Restore the stored conversation
        setActiveConversationId(storedConversationId);
      } else if (data.conversations?.length > 0) {
        // Auto-select the most recent conversation
        setActiveConversationId(data.conversations[0].id);
      } else {
        setActiveConversationId(null);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to load conversations');
      setError(error);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, getStorageKey]);

  // Create a new conversation
  const createConversation = useCallback(async (title?: string): Promise<Conversation | null> => {
    if (!sessionId) return null;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, title }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create conversation');
      }

      const data = await response.json();
      const newConversation = data.conversation;

      // Add to list
      setConversations(prev => [newConversation, ...prev]);
      
      // Set as active and store in wallet-specific key
      setActiveConversationId(newConversation.id);
      const storageKey = getStorageKey();
      if (storageKey) {
        localStorage.setItem(storageKey, newConversation.id);
      }

      return newConversation;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to create conversation');
      setError(error);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, getStorageKey]);

  // Delete a conversation
  const deleteConversation = useCallback(async (conversationId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/conversations?conversationId=${conversationId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete conversation');
      }

      // Remove from list and update active if needed
      setConversations(prev => {
        const remaining = prev.filter(c => c.id !== conversationId);
        
        // If this was the active conversation, select another one
        if (activeConversationId === conversationId) {
          const nextConversation = remaining.length > 0 ? remaining[0].id : null;
          // Use setTimeout to avoid state update during render
          setTimeout(() => {
            setActiveConversationId(nextConversation);
            const storageKey = getStorageKey();
            if (storageKey) {
              if (nextConversation) {
                localStorage.setItem(storageKey, nextConversation);
              } else {
                localStorage.removeItem(storageKey);
              }
            }
          }, 0);
        }
        
        return remaining;
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to delete conversation');
      setError(error);
    } finally {
      setIsLoading(false);
    }
  }, [activeConversationId, getStorageKey]);

  // Rename a conversation
  const renameConversation = useCallback(async (conversationId: string, title: string) => {
    setError(null);

    try {
      const response = await fetch('/api/conversations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, title }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to rename conversation');
      }

      const data = await response.json();
      
      // Update in list
      setConversations(prev => 
        prev.map(c => c.id === conversationId ? data.conversation : c)
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to rename conversation');
      setError(error);
    }
  }, []);

  // Set active conversation
  const setActiveConversation = useCallback((conversationId: string | null) => {
    setActiveConversationId(conversationId);
    
    // Store in wallet-specific localStorage key
    const storageKey = getStorageKey();
    if (storageKey) {
      if (conversationId) {
        localStorage.setItem(storageKey, conversationId);
      } else {
        localStorage.removeItem(storageKey);
      }
    }
    
    // Clear legacy global key
    localStorage.removeItem('chainpilot_active_conversation');
  }, [getStorageKey]);

  // Start a new chat (create new conversation and set as active)
  const startNewChat = useCallback(async () => {
    const newConversation = await createConversation();
    if (newConversation) {
      setActiveConversation(newConversation.id);
    }
  }, [createConversation, setActiveConversation]);

  // Handle session changes - reload conversations when session changes
  useEffect(() => {
    if (sessionId !== previousSessionRef.current) {
      // Session changed, clear old data and reload
      if (previousSessionRef.current !== null && sessionId !== previousSessionRef.current) {
        setConversations([]);
        setActiveConversationId(null);
      }
      
      previousSessionRef.current = sessionId;
      
      if (autoLoad && sessionId) {
        loadConversations();
      }
    }
  }, [autoLoad, sessionId, loadConversations]);

  return {
    conversations,
    activeConversationId,
    isLoading,
    error,
    loadConversations,
    createConversation,
    deleteConversation,
    renameConversation,
    setActiveConversation,
    startNewChat,
    clearConversations,
  };
}
