'use client';

import { useState, useCallback, useEffect } from 'react';

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
}

export function useConversations({ 
  sessionId, 
  autoLoad = true 
}: UseConversationsOptions): UseConversationsReturn {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

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

      // Auto-select the most recent conversation if none is active
      if (!activeConversationId && data.conversations?.length > 0) {
        setActiveConversationId(data.conversations[0].id);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to load conversations');
      setError(error);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, activeConversationId]);

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
      
      // Set as active
      setActiveConversationId(newConversation.id);

      return newConversation;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to create conversation');
      setError(error);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

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
          setTimeout(() => setActiveConversationId(nextConversation), 0);
        }
        
        return remaining;
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to delete conversation');
      setError(error);
    } finally {
      setIsLoading(false);
    }
  }, [activeConversationId]);

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
    
    // Store in localStorage for persistence across page navigations
    if (conversationId) {
      localStorage.setItem('chainpilot_active_conversation', conversationId);
    } else {
      localStorage.removeItem('chainpilot_active_conversation');
    }
  }, []);

  // Start a new chat (create new conversation and set as active)
  const startNewChat = useCallback(async () => {
    const newConversation = await createConversation();
    if (newConversation) {
      setActiveConversation(newConversation.id);
    }
  }, [createConversation, setActiveConversation]);

  // Auto-load conversations when sessionId changes
  useEffect(() => {
    if (autoLoad && sessionId) {
      loadConversations();
    }
  }, [autoLoad, sessionId, loadConversations]);

  // Restore active conversation from localStorage
  useEffect(() => {
    if (!activeConversationId) {
      const stored = localStorage.getItem('chainpilot_active_conversation');
      if (stored && conversations.some(c => c.id === stored)) {
        setActiveConversationId(stored);
      }
    }
  }, [conversations, activeConversationId]);

  // Update local conversation data when it changes (e.g., new message updates title)
  const updateConversationInList = useCallback((updatedConversation: Conversation) => {
    setConversations(prev =>
      prev.map(c => c.id === updatedConversation.id ? updatedConversation : c)
    );
  }, []);

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
  };
}

