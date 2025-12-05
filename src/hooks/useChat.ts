'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { BrowserProvider } from 'ethers';
import type { ChatMessage, ChatResponse, TransactionPreview, PolicyEvaluationResult } from '@/lib/types';
import { useQ402 } from './useQ402';

interface UseChatOptions {
  sessionId: string;
  conversationId?: string | null;
  provider?: BrowserProvider | null;
  signerAddress?: string | null;
  onError?: (error: Error) => void;
  onConversationCreated?: (conversationId: string) => void;
  onTransactionSuccess?: (txHash: string) => void;
}

interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  isLoadingHistory: boolean;
  isSigning: boolean;
  error: Error | null;
  pendingTransaction: TransactionPreview | null;
  policyDecision: PolicyEvaluationResult | null;
  currentConversationId: string | null;
  sendMessage: (content: string) => Promise<void>;
  confirmTransaction: () => Promise<void>;
  rejectTransaction: () => void;
  clearMessages: () => void;
  loadMessages: (conversationId: string) => Promise<void>;
}

export function useChat({ 
  sessionId, 
  conversationId, 
  provider,
  signerAddress,
  onError, 
  onConversationCreated,
  onTransactionSuccess,
}: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [pendingTransaction, setPendingTransaction] = useState<TransactionPreview | null>(null);
  const [policyDecision, setPolicyDecision] = useState<PolicyEvaluationResult | null>(null);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(conversationId || null);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const loadedConversationRef = useRef<string | null>(null);

  // Q402 signing hook
  const { 
    state: q402State, 
    prepareAndSign, 
    reset: resetQ402 
  } = useQ402({
    onError: (err) => {
      setError(err);
      onError?.(err);
    },
    onExecuted: (result) => {
      if (result.txHash) {
        onTransactionSuccess?.(result.txHash);
      }
    },
  });

  // Load messages from a conversation
  const loadMessages = useCallback(async (convId: string) => {
    if (loadedConversationRef.current === convId) return;
    
    setIsLoadingHistory(true);
    setError(null);

    try {
      const response = await fetch(`/api/conversations/messages?conversationId=${convId}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to load messages');
      }

      const data = await response.json();
      setMessages(data.messages || []);
      setCurrentConversationId(convId);
      loadedConversationRef.current = convId;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to load messages');
      setError(error);
      onError?.(error);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [onError]);

  // Load messages when conversationId changes
  useEffect(() => {
    if (conversationId && conversationId !== loadedConversationRef.current) {
      loadMessages(conversationId);
    } else if (!conversationId) {
      // Clear messages if no conversation is selected
      setMessages([]);
      setCurrentConversationId(null);
      loadedConversationRef.current = null;
    }
  }, [conversationId, loadMessages]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    // Add user message immediately
    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}_user`,
      sessionId,
      conversationId: currentConversationId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: content, 
          sessionId,
          conversationId: currentConversationId,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send message');
      }

      const data: ChatResponse = await response.json();

      // Update conversationId if a new one was created
      if (data.conversationId && data.conversationId !== currentConversationId) {
        setCurrentConversationId(data.conversationId);
        loadedConversationRef.current = data.conversationId;
        onConversationCreated?.(data.conversationId);
      }

      // Add assistant message
      setMessages(prev => [...prev, data.message]);

      // Handle transaction preview
      if (data.transactionPreview) {
        setPendingTransaction(data.transactionPreview);
        setPolicyDecision(data.policyDecision || null);
      } else {
        setPendingTransaction(null);
        setPolicyDecision(null);
      }

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      const error = err instanceof Error ? err : new Error('Unknown error');
      setError(error);
      onError?.(error);

      // Add error message
      setMessages(prev => [...prev, {
        id: `msg_${Date.now()}_error`,
        sessionId,
        conversationId: currentConversationId,
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error.message}`,
        createdAt: new Date().toISOString(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, currentConversationId, isLoading, onError, onConversationCreated]);

  const confirmTransaction = useCallback(async () => {
    console.log('[Chat] confirmTransaction called');
    console.log('[Chat] pendingTransaction:', pendingTransaction);
    console.log('[Chat] policyDecision:', policyDecision);
    console.log('[Chat] provider:', provider);
    
    if (!pendingTransaction || !policyDecision) {
      console.log('[Chat] Missing pendingTransaction or policyDecision');
      return;
    }

    // Check if provider is available
    if (!provider) {
      console.log('[Chat] No provider available');
      const error = new Error('Please connect your wallet to sign the transaction');
      setError(error);
      onError?.(error);
      
      setMessages(prev => [...prev, {
        id: `msg_${Date.now()}_error`,
        sessionId,
        role: 'assistant',
        content: 'Please connect your wallet to sign and execute the transaction.',
        createdAt: new Date().toISOString(),
      }]);
      return;
    }

    console.log('[Chat] Starting transaction flow...');
    setIsLoading(true);
    
    try {
      // Add signing prompt message
      setMessages(prev => [...prev, {
        id: `msg_${Date.now()}_signing`,
        sessionId,
        role: 'assistant',
        content: '🔐 Please sign the transaction in your wallet...',
        createdAt: new Date().toISOString(),
      }]);

      console.log('[Chat] Calling prepareAndSign with:', {
        pendingTransaction,
        policyDecision,
        sessionId,
        providerAvailable: !!provider,
      });

      // Use Q402 to prepare, sign, and execute
      const result = await prepareAndSign(
        pendingTransaction,
        policyDecision,
        sessionId,
        provider
      );
      
      console.log('[Chat] prepareAndSign result:', result);

      if (result?.success && result.txHash) {
        // Add success message
        setMessages(prev => {
          // Remove the signing message
          const filtered = prev.filter(m => !m.content.includes('Please sign the transaction'));
          return [...filtered, {
            id: `msg_${Date.now()}_tx`,
            sessionId,
            role: 'assistant',
            content: `✅ Transaction submitted successfully!\n\nTransaction Hash: \`${result.txHash}\`\n\nYou can view it on the [block explorer](${pendingTransaction.network === 'mainnet' ? 'https://bscscan.com' : 'https://testnet.bscscan.com'}/tx/${result.txHash}).`,
            createdAt: new Date().toISOString(),
          }];
        });
      } else if (result === null) {
        // User cancelled signing or there was an error
        setMessages(prev => {
          const filtered = prev.filter(m => !m.content.includes('Please sign the transaction'));
          return [...filtered, {
            id: `msg_${Date.now()}_cancelled`,
            sessionId,
            role: 'assistant',
            content: 'Transaction signing was cancelled or failed. Let me know if you\'d like to try again.',
            createdAt: new Date().toISOString(),
          }];
        });
      } else {
        // Transaction submitted but may have failed on-chain
        setMessages(prev => {
          const filtered = prev.filter(m => !m.content.includes('Please sign the transaction'));
          return [...filtered, {
            id: `msg_${Date.now()}_result`,
            sessionId,
            role: 'assistant',
            content: result.error 
              ? `Transaction failed: ${result.error}`
              : 'Transaction submitted but status unknown. Please check the activity log.',
            createdAt: new Date().toISOString(),
          }];
        });
      }

      setPendingTransaction(null);
      setPolicyDecision(null);
      resetQ402();

    } catch (err) {
      console.error('[Chat] Transaction error:', err);
      const error = err instanceof Error ? err : new Error('Transaction failed');
      setError(error);
      onError?.(error);

      setMessages(prev => {
        const filtered = prev.filter(m => !m.content.includes('Please sign the transaction'));
        return [...filtered, {
          id: `msg_${Date.now()}_error`,
          sessionId,
          role: 'assistant',
          content: `❌ Transaction failed: ${error.message}`,
          createdAt: new Date().toISOString(),
        }];
      });
    } finally {
      setIsLoading(false);
    }
  }, [pendingTransaction, policyDecision, sessionId, provider, onError, prepareAndSign, resetQ402]);

  const rejectTransaction = useCallback(() => {
    setPendingTransaction(null);
    setPolicyDecision(null);

    setMessages(prev => [...prev, {
      id: `msg_${Date.now()}_reject`,
      sessionId,
      role: 'assistant',
      content: 'Transaction cancelled. Let me know if you\'d like to try something else.',
      createdAt: new Date().toISOString(),
    }]);
  }, [sessionId]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setPendingTransaction(null);
    setPolicyDecision(null);
    setError(null);
    setCurrentConversationId(null);
    loadedConversationRef.current = null;
  }, []);

  return {
    messages,
    isLoading,
    isLoadingHistory,
    isSigning: q402State.isSigning,
    error,
    pendingTransaction,
    policyDecision,
    currentConversationId,
    sendMessage,
    confirmTransaction,
    rejectTransaction,
    clearMessages,
    loadMessages,
  };
}

