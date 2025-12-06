'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { BrowserProvider, parseEther, formatEther } from 'ethers';
import type { ChatMessage, ChatResponse, TransactionPreview, PolicyEvaluationResult, Intent } from '@/lib/types';
import { useQ402 } from './useQ402';
import { getNativeBalance } from '@/lib/services/web3/provider';
import { 
  logTransactionSuccess, 
  logTransactionFailure, 
  logTransactionCancelled 
} from '@/lib/services/activity';

/**
 * Check if a transaction is a native BNB transfer (not a contract interaction)
 * Native transfers must be executed directly by the user's wallet, not via facilitator
 */
function isNativeBnbTransfer(preview: TransactionPreview): boolean {
  // It's a native transfer if:
  // 1. Type is 'transfer'
  // 2. No token address (or token is native BNB zero address)
  // 3. Has native value
  const isTransferType = preview.type === 'transfer';
  const isNativeToken = !preview.tokenAddress || 
    preview.tokenAddress === '0x0000000000000000000000000000000000000000';
  const hasNativeValue = Boolean(preview.nativeValue && parseFloat(preview.nativeValue) > 0);
  
  return isTransferType && isNativeToken && hasNativeValue;
}

/**
 * Get intent type from transaction preview
 */
function getIntentTypeFromPreview(preview: TransactionPreview): Intent['type'] {
  switch (preview.type) {
    case 'transfer':
      return 'transfer';
    case 'token_transfer':
      return 'transfer';
    case 'swap':
      return 'swap';
    case 'contract_call':
      return 'contract_call';
    case 'deploy':
      return 'deploy';
    default:
      return 'transfer';
  }
}

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
  const [lastUserMessage, setLastUserMessage] = useState<string | undefined>(undefined);
  
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

    // Store the user message for activity logging
    setLastUserMessage(content);

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
    
    const intentType = getIntentTypeFromPreview(pendingTransaction);
    
    try {
      // Check if this is a native BNB transfer - must be executed directly by user
      if (isNativeBnbTransfer(pendingTransaction)) {
        console.log('[Chat] Native BNB transfer detected - executing directly from user wallet');

        // Check balance before proceeding
        if (signerAddress) {
          const balance = await getNativeBalance(signerAddress, pendingTransaction.network);
          const transferAmount = BigInt(pendingTransaction.nativeValue || '0');
          const estimatedGas = BigInt(pendingTransaction.estimatedGas || '21000');
          const gasPrice = BigInt(pendingTransaction.estimatedGasPrice || '5000000000'); // 5 gwei fallback
          const gasCost = estimatedGas * gasPrice;
          const totalCost = transferAmount + gasCost;

          if (balance < totalCost) {
            const balanceFormatted = formatEther(balance);
            const costFormatted = formatEther(totalCost);
            const gasCostFormatted = formatEther(gasCost);

            // Log failed transaction to activity
            await logTransactionFailure({
              sessionId,
              intentType,
              network: pendingTransaction.network,
              userMessage: lastUserMessage,
              preview: pendingTransaction,
              policyDecision,
              errorMessage: 'Insufficient balance for transfer',
            });

            setMessages(prev => [...prev, {
              id: `msg_${Date.now()}_error`,
              sessionId,
              role: 'assistant',
              content: `❌ Insufficient balance for transfer\n\n**Required:** ${costFormatted} BNB\n**Available:** ${balanceFormatted} BNB\n**Transfer:** ${formatEther(transferAmount)} BNB\n**Gas Cost:** ${gasCostFormatted} BNB\n\nPlease add more BNB to your wallet and try again.`,
              createdAt: new Date().toISOString(),
            }]);
            setPendingTransaction(null);
            setIsLoading(false);
            return;
          }
        }

        // Add signing prompt message
        setMessages(prev => [...prev, {
          id: `msg_${Date.now()}_signing`,
          sessionId,
          role: 'assistant',
          content: '🔐 Please confirm the transaction in your wallet...\n\n⚠️ This native BNB transfer will be executed directly from your wallet (you pay gas).',
          createdAt: new Date().toISOString(),
        }]);

        // Execute directly from user's wallet
        const signer = await provider.getSigner();
        const tx = await signer.sendTransaction({
          to: pendingTransaction.preparedTx.to,
          value: BigInt(pendingTransaction.nativeValue || '0'),
          data: pendingTransaction.preparedTx.data || '0x',
        });
        
        console.log('[Chat] Direct transaction submitted:', tx.hash);
        
        // Wait for confirmation
        const receipt = await tx.wait(1);
        
        if (receipt?.status === 1) {
          // Log successful transaction to activity
          await logTransactionSuccess({
            sessionId,
            intentType,
            network: pendingTransaction.network,
            userMessage: lastUserMessage,
            preview: pendingTransaction,
            policyDecision,
            txHash: tx.hash,
            estimatedValueUsd: pendingTransaction.valueUsd ? parseFloat(pendingTransaction.valueUsd) : undefined,
          });

          setMessages(prev => {
            const filtered = prev.filter(m => !m.content.includes('Please confirm the transaction'));
            return [...filtered, {
              id: `msg_${Date.now()}_tx`,
              sessionId,
              role: 'assistant',
              content: `✅ Transaction confirmed!\n\nTransaction Hash: \`${tx.hash}\`\n\nYou can view it on the [block explorer](${pendingTransaction.network === 'mainnet' ? 'https://bscscan.com' : 'https://testnet.bscscan.com'}/tx/${tx.hash}).`,
              createdAt: new Date().toISOString(),
            }];
          });
          onTransactionSuccess?.(tx.hash);
        } else {
          // Log failed transaction
          await logTransactionFailure({
            sessionId,
            intentType,
            network: pendingTransaction.network,
            userMessage: lastUserMessage,
            preview: pendingTransaction,
            policyDecision,
            errorMessage: 'Transaction failed on-chain',
          });
          throw new Error('Transaction failed on-chain');
        }
        
        setPendingTransaction(null);
        setPolicyDecision(null);
        setIsLoading(false);
        return;
      }

      // For other transactions (ERC20, swaps, etc.), use Q402 gas sponsorship
      // Add signing prompt message
      setMessages(prev => [...prev, {
        id: `msg_${Date.now()}_signing`,
        sessionId,
        role: 'assistant',
        content: '🔐 Please sign the transaction in your wallet...\n\n✨ Gas will be sponsored - you only need to sign!',
        createdAt: new Date().toISOString(),
      }]);

      console.log('[Chat] Calling prepareAndSign with:', {
        pendingTransaction,
        policyDecision,
        sessionId,
        providerAvailable: !!provider,
      });

      // Use Q402 to prepare, sign, and execute (gas sponsored)
      const result = await prepareAndSign(
        pendingTransaction,
        policyDecision,
        sessionId,
        provider
      );
      
      console.log('[Chat] prepareAndSign result:', result);

      if (result?.success && result.txHash) {
        // Log successful transaction to activity
        await logTransactionSuccess({
          sessionId,
          intentType,
          network: pendingTransaction.network,
          userMessage: lastUserMessage,
          preview: pendingTransaction,
          policyDecision,
          txHash: result.txHash,
          q402RequestId: result.q402RequestId,
          estimatedValueUsd: pendingTransaction.valueUsd ? parseFloat(pendingTransaction.valueUsd) : undefined,
        });

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
        // User cancelled signing
        await logTransactionCancelled({
          sessionId,
          intentType,
          network: pendingTransaction.network,
          userMessage: lastUserMessage,
        });

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
        await logTransactionFailure({
          sessionId,
          intentType,
          network: pendingTransaction.network,
          userMessage: lastUserMessage,
          preview: pendingTransaction,
          policyDecision,
          errorMessage: result?.error || 'Transaction status unknown',
          q402RequestId: result?.q402RequestId,
        });

        setMessages(prev => {
          const filtered = prev.filter(m => !m.content.includes('Please sign the transaction'));
          return [...filtered, {
            id: `msg_${Date.now()}_result`,
            sessionId,
            role: 'assistant',
            content: result?.error 
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

      // Provide more specific error messages for common issues
      let errorMessage = error.message;
      if (error.message.includes('CALL_EXCEPTION') || error.message.includes('missing revert data')) {
        if (error.message.includes('missing revert data')) {
          errorMessage = 'Transaction would fail - likely insufficient balance or invalid recipient';
        } else {
          errorMessage = 'Transaction execution failed - please check your balance and try again';
        }
      } else if (error.message.includes('insufficient funds')) {
        errorMessage = 'Insufficient funds to cover transaction and gas fees';
      } else if (error.message.includes('user rejected')) {
        errorMessage = 'Transaction cancelled by user';
      }

      // Log failed transaction to activity
      await logTransactionFailure({
        sessionId,
        intentType,
        network: pendingTransaction.network,
        userMessage: lastUserMessage,
        preview: pendingTransaction,
        policyDecision,
        errorMessage,
      });

      setError(error);
      onError?.(error);

      setMessages(prev => {
        const filtered = prev.filter(m => !m.content.includes('Please sign the transaction') && !m.content.includes('Please confirm the transaction'));
        return [...filtered, {
          id: `msg_${Date.now()}_error`,
          sessionId,
          role: 'assistant',
          content: `❌ Transaction failed: ${errorMessage}`,
          createdAt: new Date().toISOString(),
        }];
      });
    } finally {
      setIsLoading(false);
    }
  }, [pendingTransaction, policyDecision, sessionId, provider, signerAddress, lastUserMessage, onError, onTransactionSuccess, prepareAndSign, resetQ402]);

  const rejectTransaction = useCallback(async () => {
    // Log cancelled transaction to activity
    if (pendingTransaction) {
      const intentType = getIntentTypeFromPreview(pendingTransaction);
      await logTransactionCancelled({
        sessionId,
        intentType,
        network: pendingTransaction.network,
        userMessage: lastUserMessage,
      });
    }

    setPendingTransaction(null);
    setPolicyDecision(null);

    setMessages(prev => [...prev, {
      id: `msg_${Date.now()}_reject`,
      sessionId,
      role: 'assistant',
      content: 'Transaction cancelled. Let me know if you\'d like to try something else.',
      createdAt: new Date().toISOString(),
    }]);
  }, [sessionId, pendingTransaction, lastUserMessage]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setPendingTransaction(null);
    setPolicyDecision(null);
    setError(null);
    setCurrentConversationId(null);
    loadedConversationRef.current = null;
    setLastUserMessage(undefined);
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
