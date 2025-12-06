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
  const [pendingTransferId, setPendingTransferId] = useState<string | undefined>(undefined);
  const [pendingSwapId, setPendingSwapId] = useState<string | undefined>(undefined);
  const [isDirectTransaction, setIsDirectTransaction] = useState<boolean>(false);
  const [isSwapApproval, setIsSwapApproval] = useState<boolean>(false);
  const [isBatchSwap, setIsBatchSwap] = useState<boolean>(false);
  const [batchSwapDetails, setBatchSwapDetails] = useState<{
    tokenIn: string | null;
    tokenInSymbol: string;
    tokenOut: string | null;
    tokenOutSymbol: string;
    amountIn: string;
    minAmountOut: string;
    estimatedAmountOut: string;
    slippageBps: number;
    swapData: string;
    swapRecipient?: string; // Optional: send swap output to different address
  } | null>(null);
  const [isMultiOpBatch, setIsMultiOpBatch] = useState<boolean>(false);
  const [multiOpBatchDetails, setMultiOpBatchDetails] = useState<{
    operations: Array<{
      type: 'transfer' | 'swap';
      tokenIn?: string | null;
      tokenInSymbol?: string;
      tokenOut?: string | null;
      tokenOutSymbol?: string;
      amount?: string;
      slippageBps?: number;
      tokenAddress?: string | null;
      tokenSymbol?: string;
      recipient?: string;
      _linkedToSwapOutput?: boolean;
    }>;
    operationCount: number;
    estimatedSwapOutput: string;
    swapOutputToken: { address: string | null; symbol: string; decimals: number } | null;
  } | null>(null);
  const [pendingLinkedTransfer, setPendingLinkedTransfer] = useState<{
    recipient?: string;
    tokenAddress?: string | null;
    tokenSymbol?: string;
    estimatedAmount: string;
  } | null>(null);
  
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

    // Check if user wants to continue with pending linked transfer
    const continueKeywords = ['continue', 'transfer', 'yes', 'proceed', 'go ahead', 'send', 'ok', 'okay'];
    const wantsToContinue = pendingLinkedTransfer && 
      continueKeywords.some(kw => content.toLowerCase().includes(kw));
    
    if (wantsToContinue && pendingLinkedTransfer) {
      console.log('[Chat] User wants to continue with linked transfer:', pendingLinkedTransfer);
      
      // Add user message
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
      
      // Initiate the transfer
      try {
        const transferResponse = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            message: `transfer ${pendingLinkedTransfer.estimatedAmount} ${pendingLinkedTransfer.tokenSymbol} to ${pendingLinkedTransfer.recipient}`,
            sessionId,
            conversationId: currentConversationId,
            walletAddress: signerAddress,
            network: 'testnet', // TODO: get from context
          }),
        });
        
        const data = await transferResponse.json();
        
        // Clear the pending linked transfer
        setPendingLinkedTransfer(null);
        
        // Add assistant message
        setMessages(prev => [...prev, data.message]);
        
        // Handle transaction preview if present
        if (data.transactionPreview) {
          setPendingTransaction(data.transactionPreview);
          setPolicyDecision(data.policyDecision || null);
        }
        
        setIsLoading(false);
        return;
      } catch (err) {
        console.error('[Chat] Error initiating linked transfer:', err);
        setPendingLinkedTransfer(null);
        setIsLoading(false);
        return;
      }
    }

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
        
        // Store pending transfer ID if approval is required
        if (data.approvalRequired?.pendingTransferId) {
          console.log('[Chat] Storing pendingTransferId:', data.approvalRequired.pendingTransferId);
          setPendingTransferId(data.approvalRequired.pendingTransferId);
          setIsDirectTransaction(data.approvalRequired.isDirectTransaction || false);
          setIsSwapApproval(false);
          setPendingSwapId(undefined);
        } 
        // Store pending swap ID if swap approval is required
        else if (data.swapApprovalRequired?.pendingSwapId) {
          console.log('[Chat] Storing pendingSwapId:', data.swapApprovalRequired.pendingSwapId);
          setPendingSwapId(data.swapApprovalRequired.pendingSwapId);
          setIsDirectTransaction(data.swapApprovalRequired.isDirectTransaction || false);
          setIsSwapApproval(true);
          setIsBatchSwap(data.swapApprovalRequired.useBatchExecutor || false);
          setPendingTransferId(undefined);
        } 
        // Check for batch swap (gas-sponsored via BatchExecutor)
        else if (data.isBatchSwap && data.batchSwapDetails) {
          console.log('[Chat] Batch swap detected:', data.batchSwapDetails);
          setIsBatchSwap(true);
          setBatchSwapDetails(data.batchSwapDetails);
          setIsDirectTransaction(false);
          setIsSwapApproval(false);
          setIsMultiOpBatch(false);
          // Check for pending linked transfer (swap + transfer flow)
          if (data._pendingLinkedTransfer) {
            console.log('[Chat] Pending linked transfer detected:', data._pendingLinkedTransfer);
            setPendingLinkedTransfer(data._pendingLinkedTransfer);
          } else {
            setPendingLinkedTransfer(null);
          }
        }
        // Check for multi-operation batch (swap + transfer in one tx)
        else if (data.isMultiOpBatch && data.multiOpBatchDetails) {
          console.log('[Chat] Multi-operation batch detected:', data.multiOpBatchDetails);
          setIsMultiOpBatch(true);
          setMultiOpBatchDetails(data.multiOpBatchDetails);
          setIsBatchSwap(false);
          setBatchSwapDetails(null);
          setIsDirectTransaction(false);
          setIsSwapApproval(false);
          setPendingTransferId(undefined);
          setPendingSwapId(undefined);
        } else {
          setPendingTransferId(undefined);
          setPendingSwapId(undefined);
          setIsBatchSwap(false);
          setBatchSwapDetails(null);
          setIsDirectTransaction(false);
          setIsSwapApproval(false);
        }
      } else {
        setPendingTransaction(null);
        setPolicyDecision(null);
        setPendingTransferId(undefined);
        setPendingSwapId(undefined);
        setIsDirectTransaction(false);
        setIsSwapApproval(false);
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
  }, [sessionId, currentConversationId, isLoading, onError, onConversationCreated, pendingLinkedTransfer, signerAddress]);

  const confirmTransaction = useCallback(async () => {
    console.log('[Chat] confirmTransaction called');
    console.log('[Chat] pendingTransaction:', pendingTransaction);
    console.log('[Chat] policyDecision:', policyDecision);
    console.log('[Chat] provider:', provider);
    
    if (!pendingTransaction || !policyDecision) {
      console.log('[Chat] Missing pendingTransaction or policyDecision');
      return;
    }

    if (!policyDecision.allowed) {
      const reason = policyDecision.reasons?.join('; ') || 'Blocked by your security policy';
      setMessages(prev => [...prev, {
        id: `msg_${Date.now()}_policy_block`,
        sessionId,
        role: 'assistant',
        content: `🚫 Transaction blocked by your security policy.\n\n${reason}`,
        createdAt: new Date().toISOString(),
      }]);
      setPendingTransaction(null);
      setPolicyDecision(null);
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

      // Check if this is a direct transaction (approval - user must pay gas)
      // Handle both transfer approvals and swap approvals
      if (isDirectTransaction && (pendingTransferId || pendingSwapId)) {
        const isSwap = isSwapApproval && pendingSwapId;
        console.log(`[Chat] Direct transaction detected (${isSwap ? 'swap' : 'transfer'} approval) - user pays gas`);
        
        setMessages(prev => [...prev, {
          id: `msg_${Date.now()}_signing`,
          sessionId,
          role: 'assistant',
          content: isSwap
            ? '🔐 Please **confirm the approval** in your wallet...\n\n⚠️ You will pay gas for this approval (required for PancakeSwap to swap your tokens).\n\n📝 After approval, the swap will proceed automatically (you will also pay gas for the swap).'
            : '🔐 Please **confirm the approval** in your wallet...\n\n⚠️ You will pay gas for this approval (required for token spending permissions).\n\n📝 After approval, the transfer will be gas-free!',
          createdAt: new Date().toISOString(),
        }]);

        // Execute directly from user's wallet
        const signer = await provider.getSigner();
        const currentSignerAddress = signerAddress || await signer.getAddress();
        const tx = await signer.sendTransaction({
          to: pendingTransaction.preparedTx.to,
          data: pendingTransaction.preparedTx.data || '0x',
          value: BigInt(pendingTransaction.preparedTx.value || '0'),
        });
        
        console.log('[Chat] Approval transaction submitted:', tx.hash);
        
        // Wait for confirmation
        const receipt = await tx.wait(1);
        
        if (receipt?.status === 1) {
          // Log successful approval
          await logTransactionSuccess({
            sessionId,
            intentType: 'contract_call',
            network: pendingTransaction.network,
            userMessage: lastUserMessage,
            preview: pendingTransaction,
            policyDecision,
            txHash: tx.hash,
          });

          // Approval succeeded - now automatically prepare the next transaction
          setMessages(prev => {
            const filtered = prev.filter(m => !m.content.includes('confirm the approval'));
            return [...filtered, {
              id: `msg_${Date.now()}_approval_success`,
              sessionId,
              role: 'assistant',
              content: isSwap
                ? `✅ Approval confirmed! Transaction: \`${tx.hash.slice(0, 10)}...${tx.hash.slice(-8)}\`\n\n🔐 Now please confirm the **swap** in your wallet...`
                : `✅ Approval confirmed! Transaction: \`${tx.hash.slice(0, 10)}...${tx.hash.slice(-8)}\`\n\n🔐 Now please sign the **transfer** (gas-free)...`,
              createdAt: new Date().toISOString(),
            }];
          });

          // Reset direct transaction flag
          setIsDirectTransaction(false);
          
          // Handle swap approval follow-up
          if (isSwap && pendingSwapId) {
            try {
              const swapResponse = await fetch('/api/transactions/prepare/pending-swap', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  pendingSwapId,
                  sessionId,
                  signerAddress: currentSignerAddress,
                }),
              });
              
              if (swapResponse.ok) {
                const swapData = await swapResponse.json();
                
                if (swapData.success && swapData.preview?.preparedTx) {
                  // Execute swap directly from user's wallet
                  // NOTE: Swaps cannot be gas-sponsored because DEX routers pull tokens from msg.sender
                  console.log('[Chat] Executing swap directly from user wallet');
                  
                  setMessages(prev => {
                    const filtered = prev.filter(m => !m.content.includes('sign the **swap**'));
                    return [...filtered, {
                      id: `msg_${Date.now()}_swap_signing`,
                      sessionId,
                      role: 'assistant',
                      content: '🔐 Please **confirm the swap** in your wallet...\n\n⚠️ You will pay gas for this swap transaction.',
                      createdAt: new Date().toISOString(),
                    }];
                  });
                  
                  const swapTx = await signer.sendTransaction({
                    to: swapData.preview.preparedTx.to,
                    data: swapData.preview.preparedTx.data || '0x',
                    value: BigInt(swapData.preview.preparedTx.value || '0'),
                  });
                  
                  console.log('[Chat] Swap transaction submitted:', swapTx.hash);
                  
                  const swapReceipt = await swapTx.wait(1);
                  
                  if (swapReceipt?.status === 1) {
                    setMessages(prev => {
                      const filtered = prev.filter(m => !m.content.includes('confirm the swap'));
                      return [...filtered, {
                        id: `msg_${Date.now()}_swap_success`,
                        sessionId,
                        role: 'assistant',
                        content: `✅ Swap executed successfully!\n\n` +
                          `📊 **Swapped**: ${swapData.swapDetails?.amountIn || ''} ${swapData.swapDetails?.tokenInSymbol || ''} → ${swapData.swapDetails?.amountOut || ''} ${swapData.swapDetails?.tokenOutSymbol || ''}\n\n` +
                          `Transaction Hash: \`${swapTx.hash}\`\n\n` +
                          `You can view it on the [block explorer](${pendingTransaction.network === 'mainnet' ? 'https://bscscan.com' : 'https://testnet.bscscan.com'}/tx/${swapTx.hash}).`,
                        createdAt: new Date().toISOString(),
                      }];
                    });
                    onTransactionSuccess?.(swapTx.hash);
                  } else {
                    setMessages(prev => {
                      const filtered = prev.filter(m => !m.content.includes('confirm the swap'));
                      return [...filtered, {
                        id: `msg_${Date.now()}_swap_failed`,
                        sessionId,
                        role: 'assistant',
                        content: '❌ Swap transaction failed on-chain. Please try again.',
                        createdAt: new Date().toISOString(),
                      }];
                    });
                  }
                } else {
                  throw new Error(swapData.error || 'Failed to prepare swap');
                }
              } else {
                setMessages(prev => [...prev, {
                  id: `msg_${Date.now()}_retry`,
                  sessionId,
                  role: 'assistant',
                  content: `Please send your swap request again (e.g., "Swap ${pendingTransaction.tokenInAmount || ''} ${pendingTransaction.tokenInSymbol || 'tokens'} for ${pendingTransaction.tokenOutSymbol || ''}").`,
                  createdAt: new Date().toISOString(),
                }]);
              }
            } catch (swapError) {
              console.error('[Chat] Failed to execute swap:', swapError);
              const errorMessage = swapError instanceof Error ? swapError.message : 'Unknown error';
              setMessages(prev => [...prev, {
                id: `msg_${Date.now()}_swap_error`,
                sessionId,
                role: 'assistant',
                content: `❌ Swap failed: ${errorMessage}\n\nPlease try again.`,
                createdAt: new Date().toISOString(),
              }]);
            }
          } 
          // Handle transfer approval follow-up
          else if (pendingTransferId) {
            try {
              const transferResponse = await fetch('/api/transactions/prepare/pending', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  pendingTransferId,
                  sessionId,
                  signerAddress: currentSignerAddress,
                }),
              });
              
              if (transferResponse.ok) {
                const transferData = await transferResponse.json();
                
                if (transferData.success && transferData.typedData) {
                  // Sign the transfer using Q402
                  const transferResult = await prepareAndSign(
                    transferData.preview,
                    { allowed: true, riskLevel: 'LOW', reasons: [], warnings: [], violations: [] },
                    sessionId,
                    provider,
                    undefined
                  );
                  
                  if (transferResult?.success && transferResult.txHash) {
                    setMessages(prev => {
                      const filtered = prev.filter(m => !m.content.includes('sign the **transfer**'));
                      return [...filtered, {
                        id: `msg_${Date.now()}_transfer_success`,
                        sessionId,
                        role: 'assistant',
                        content: `✅ Transfer submitted successfully!\n\nTransaction Hash: \`${transferResult.txHash}\`\n\nYou can view it on the [block explorer](${pendingTransaction.network === 'mainnet' ? 'https://bscscan.com' : 'https://testnet.bscscan.com'}/tx/${transferResult.txHash}).`,
                        createdAt: new Date().toISOString(),
                      }];
                    });
                    onTransactionSuccess?.(transferResult.txHash);
                  } else {
                    setMessages(prev => {
                      const filtered = prev.filter(m => !m.content.includes('sign the **transfer**'));
                      return [...filtered, {
                        id: `msg_${Date.now()}_transfer_cancelled`,
                        sessionId,
                        role: 'assistant',
                        content: transferResult?.error 
                          ? `❌ Transfer failed: ${transferResult.error}`
                          : 'Transfer was cancelled. You can try again by sending another transfer request.',
                        createdAt: new Date().toISOString(),
                      }];
                    });
                  }
                } else {
                  throw new Error(transferData.error || 'Failed to prepare transfer');
                }
              } else {
                setMessages(prev => [...prev, {
                  id: `msg_${Date.now()}_retry`,
                  sessionId,
                  role: 'assistant',
                  content: `Please send your transfer request again (e.g., "Send ${pendingTransaction.tokenAmount || ''} ${pendingTransaction.tokenSymbol || 'tokens'} to ...") and it will be **gas-free**!`,
                  createdAt: new Date().toISOString(),
                }]);
              }
            } catch (transferError) {
              console.error('[Chat] Failed to auto-continue with transfer:', transferError);
              setMessages(prev => [...prev, {
                id: `msg_${Date.now()}_retry`,
                sessionId,
                role: 'assistant',
                content: `Please send your transfer request again (e.g., "Send ${pendingTransaction.tokenAmount || ''} ${pendingTransaction.tokenSymbol || 'tokens'} to ...") and it will be **gas-free**!`,
                createdAt: new Date().toISOString(),
              }]);
            }
          }

          // Reset all transaction states
          setPendingTransaction(null);
          setPolicyDecision(null);
          setPendingTransferId(undefined);
          setPendingSwapId(undefined);
          setIsSwapApproval(false);
          setIsLoading(false);
          
          return;
        } else {
          throw new Error('Approval transaction failed on-chain');
        }
      }

      // Check if this is a batch swap (gas-sponsored via BatchExecutor)
      if (isBatchSwap && batchSwapDetails && pendingTransaction.type === 'swap') {
        console.log('[Chat] Batch swap detected - using gas-sponsored BatchExecutor');
        
        setMessages(prev => [...prev, {
          id: `msg_${Date.now()}_signing`,
          sessionId,
          role: 'assistant',
          content: '🔐 Please **sign** the batch swap in your wallet...\n\n✨ Gas will be sponsored - you only need to sign!',
          createdAt: new Date().toISOString(),
        }]);
        
        // Prepare batch request
        const batchResponse = await fetch('/api/transactions/prepare/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            network: pendingTransaction.network,
            signerAddress,
            operations: [{
              type: 'swap',
              tokenIn: batchSwapDetails.tokenIn,
              tokenInSymbol: batchSwapDetails.tokenInSymbol,
              tokenOut: batchSwapDetails.tokenOut,
              tokenOutSymbol: batchSwapDetails.tokenOutSymbol,
              amount: batchSwapDetails.amountIn,
              slippageBps: batchSwapDetails.slippageBps,
              swapRecipient: batchSwapDetails.swapRecipient,
            }],
          }),
        });
        
        const batchData = await batchResponse.json();
        
        if (!batchData.success) {
          throw new Error(batchData.error || 'Failed to prepare batch swap');
        }
        
        // Sign the batch
        const signer = await provider.getSigner();
        const signature = await signer.signTypedData(
          batchData.typedData.domain,
          { BatchWitness: batchData.typedData.types.BatchWitness },
          batchData.typedData.message
        );
        
        // Execute via batch endpoint
        const executeResponse = await fetch('/api/transactions/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            actionLogId: batchData.requestId,
            signature,
            signerAddress,
            network: pendingTransaction.network,
            isBatch: true,
          }),
        });
        
        const executeResult = await executeResponse.json();
        
        if (executeResult.success && executeResult.result.txHash) {
          await logTransactionSuccess({
            sessionId,
            intentType,
            network: pendingTransaction.network,
            userMessage: lastUserMessage,
            preview: pendingTransaction,
            policyDecision,
            txHash: executeResult.result.txHash,
            estimatedValueUsd: pendingTransaction.valueUsd ? parseFloat(pendingTransaction.valueUsd) : undefined,
          });
          
          // Check if there's a pending linked transfer
          if (pendingLinkedTransfer) {
            console.log('[Chat] Swap complete, prompting for linked transfer:', pendingLinkedTransfer);
            
            setMessages(prev => {
              const filtered = prev.filter(m => !m.content.includes('sign') && !m.content.includes('confirm'));
              const recipientDisplay = pendingLinkedTransfer.recipient 
                ? `${pendingLinkedTransfer.recipient.slice(0, 10)}...${pendingLinkedTransfer.recipient.slice(-8)}`
                : 'recipient';
              return [...filtered, {
                id: `msg_${Date.now()}_tx`,
                sessionId,
                role: 'assistant',
                content: `✅ **Step 1 Complete!** Swap executed successfully (Gas-free)\n\n🔗 [View on Explorer](https://${pendingTransaction.network === 'mainnet' ? 'bscscan.com' : 'testnet.bscscan.com'}/tx/${executeResult.result.txHash})\n\n---\n\n**Step 2**: Now let's transfer ~${pendingLinkedTransfer.estimatedAmount} ${pendingLinkedTransfer.tokenSymbol || 'tokens'} to ${recipientDisplay}\n\nSay **"continue"** or **"transfer"** to proceed with the transfer.`,
                createdAt: new Date().toISOString(),
              }];
            });
            
            onTransactionSuccess?.(executeResult.result.txHash);
            
            // Reset batch swap state but keep pendingLinkedTransfer for the next step
            setPendingTransaction(null);
            setPolicyDecision(null);
            setIsBatchSwap(false);
            setBatchSwapDetails(null);
            setIsLoading(false);
            return;
          }
          
          setMessages(prev => {
            const filtered = prev.filter(m => !m.content.includes('sign') && !m.content.includes('confirm'));
            return [...filtered, {
              id: `msg_${Date.now()}_tx`,
              sessionId,
              role: 'assistant',
              content: `✅ **Swap executed successfully!** (Gas-free via BatchExecutor)\n\n🔗 [View on Explorer](https://${pendingTransaction.network === 'mainnet' ? 'bscscan.com' : 'testnet.bscscan.com'}/tx/${executeResult.result.txHash})`,
              createdAt: new Date().toISOString(),
            }];
          });
          
          onTransactionSuccess?.(executeResult.result.txHash);
        } else {
          throw new Error(executeResult.error || 'Batch swap execution failed');
        }
        
        setPendingTransaction(null);
        setPolicyDecision(null);
        setIsBatchSwap(false);
        setBatchSwapDetails(null);
        setPendingLinkedTransfer(null);
        setIsLoading(false);
        return;
      }

      // Check if this is a multi-operation batch (e.g., swap + transfer)
      if (isMultiOpBatch && multiOpBatchDetails) {
        console.log('[Chat] Multi-operation batch detected - executing via BatchExecutor');
        
        setMessages(prev => [...prev, {
          id: `msg_${Date.now()}_signing`,
          sessionId,
          role: 'assistant',
          content: `🔐 Please **sign** the batch of ${multiOpBatchDetails.operationCount} operations in your wallet...\n\n✨ Gas will be sponsored - you only need to sign once for all operations!`,
          createdAt: new Date().toISOString(),
        }]);
        
        // Prepare multi-operation batch request
        const batchResponse = await fetch('/api/transactions/prepare/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            network: pendingTransaction?.network || 'testnet',
            signerAddress,
            operations: multiOpBatchDetails.operations,
          }),
        });
        
        const batchData = await batchResponse.json();
        
        if (!batchData.success) {
          throw new Error(batchData.error || 'Failed to prepare multi-operation batch');
        }
        
        // Sign the batch
        const signer = await provider.getSigner();
        const signature = await signer.signTypedData(
          batchData.typedData.domain,
          { BatchWitness: batchData.typedData.types.BatchWitness },
          batchData.typedData.message
        );
        
        // Execute via batch endpoint
        const executeResponse = await fetch('/api/transactions/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            actionLogId: batchData.requestId,
            signature,
            signerAddress,
            network: pendingTransaction?.network || 'testnet',
            isBatch: true,
          }),
        });
        
        const executeResult = await executeResponse.json();
        
        if (executeResult.success && executeResult.result.txHash) {
          await logTransactionSuccess({
            sessionId,
            intentType: 'batch' as Intent['type'],
            network: pendingTransaction?.network || 'testnet',
            userMessage: lastUserMessage,
            preview: pendingTransaction || undefined,
            policyDecision,
            txHash: executeResult.result.txHash,
          });
          
          const opSummary = multiOpBatchDetails.operations.map((op, i) => {
            if (op.type === 'swap') {
              return `${i + 1}. Swapped ${op.amount} ${op.tokenInSymbol} → ${op.tokenOutSymbol}`;
            } else {
              return `${i + 1}. Transferred ${op.amount} ${op.tokenSymbol} → ${op.recipient?.slice(0, 10)}...`;
            }
          }).join('\n');
          
          setMessages(prev => {
            const filtered = prev.filter(m => !m.content.includes('sign') && !m.content.includes('confirm'));
            return [...filtered, {
              id: `msg_${Date.now()}_tx`,
              sessionId,
              role: 'assistant',
              content: `✅ **All ${multiOpBatchDetails.operationCount} operations executed successfully!** (Gas-free via BatchExecutor)\n\n${opSummary}\n\n🔗 [View on Explorer](https://${(pendingTransaction?.network || 'testnet') === 'mainnet' ? 'bscscan.com' : 'testnet.bscscan.com'}/tx/${executeResult.result.txHash})`,
              createdAt: new Date().toISOString(),
            }];
          });
          
          onTransactionSuccess?.(executeResult.result.txHash);
        } else {
          throw new Error(executeResult.error || 'Multi-operation batch execution failed');
        }
        
        setPendingTransaction(null);
        setPolicyDecision(null);
        setIsMultiOpBatch(false);
        setMultiOpBatchDetails(null);
        setIsLoading(false);
        return;
      }

      // Check if this is a swap that needs direct execution (not via Q402)
      // Swaps cannot use Q402 because DEX routers pull tokens from msg.sender
      const isSwapTransaction = pendingTransaction.type === 'swap' && !isBatchSwap && !isMultiOpBatch;
      if (isSwapTransaction || isDirectTransaction) {
        console.log('[Chat] Swap/Direct transaction detected - executing directly from user wallet');
        
        setMessages(prev => [...prev, {
          id: `msg_${Date.now()}_signing`,
          sessionId,
          role: 'assistant',
          content: '🔐 Please **confirm the transaction** in your wallet...\n\n⚠️ You will pay gas for this transaction.',
          createdAt: new Date().toISOString(),
        }]);
        
        const signer = await provider.getSigner();
        const swapTx = await signer.sendTransaction({
          to: pendingTransaction.preparedTx.to,
          data: pendingTransaction.preparedTx.data || '0x',
          value: BigInt(pendingTransaction.preparedTx.value || '0'),
        });
        
        console.log('[Chat] Direct transaction submitted:', swapTx.hash);
        
        const receipt = await swapTx.wait(1);
        
        if (receipt?.status === 1) {
          // Log successful transaction to activity
          await logTransactionSuccess({
            sessionId,
            intentType,
            network: pendingTransaction.network,
            userMessage: lastUserMessage,
            preview: pendingTransaction,
            policyDecision,
            txHash: swapTx.hash,
            estimatedValueUsd: pendingTransaction.valueUsd ? parseFloat(pendingTransaction.valueUsd) : undefined,
          });
          
          setMessages(prev => {
            const filtered = prev.filter(m => !m.content.includes('confirm the transaction'));
            return [...filtered, {
              id: `msg_${Date.now()}_tx`,
              sessionId,
              role: 'assistant',
              content: pendingTransaction.type === 'swap'
                ? `✅ Swap executed successfully!\n\n📊 **Swapped**: ${pendingTransaction.tokenInAmount || ''} ${pendingTransaction.tokenInSymbol || ''} → ${pendingTransaction.tokenOutAmount || ''} ${pendingTransaction.tokenOutSymbol || ''}\n\nTransaction Hash: \`${swapTx.hash}\`\n\nYou can view it on the [block explorer](${pendingTransaction.network === 'mainnet' ? 'https://bscscan.com' : 'https://testnet.bscscan.com'}/tx/${swapTx.hash}).`
                : `✅ Transaction confirmed!\n\nTransaction Hash: \`${swapTx.hash}\`\n\nYou can view it on the [block explorer](${pendingTransaction.network === 'mainnet' ? 'https://bscscan.com' : 'https://testnet.bscscan.com'}/tx/${swapTx.hash}).`,
              createdAt: new Date().toISOString(),
            }];
          });
          onTransactionSuccess?.(swapTx.hash);
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
        setPendingTransferId(undefined);
        setPendingSwapId(undefined);
        setIsDirectTransaction(false);
        setIsSwapApproval(false);
        setIsLoading(false);
        return;
      }

      // For other transactions (ERC20 transfers, etc.), use Q402 gas sponsorship
      // Add signing prompt message
      const isApproval = pendingTransferId !== undefined && !isDirectTransaction;
      setMessages(prev => [...prev, {
        id: `msg_${Date.now()}_signing`,
        sessionId,
        role: 'assistant',
        content: isApproval
          ? '🔐 Please sign the **approval** in your wallet...\n\n✨ Gas will be sponsored - you only need to sign!\n\n📝 After approval, the transfer will be presented for signing automatically.'
          : '🔐 Please sign the transaction in your wallet...\n\n✨ Gas will be sponsored - you only need to sign!',
        createdAt: new Date().toISOString(),
      }]);

      console.log('[Chat] Calling prepareAndSign with:', {
        pendingTransaction,
        policyDecision,
        sessionId,
        providerAvailable: !!provider,
        pendingTransferId,
      });

      // Use Q402 to prepare, sign, and execute (gas sponsored)
      // If pendingTransferId is present, this is an approval transaction
      // and the transfer will automatically follow after approval
      const result = await prepareAndSign(
        pendingTransaction,
        policyDecision,
        sessionId,
        provider,
        isApproval ? pendingTransferId : undefined
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
      setPendingTransferId(undefined);
      setPendingSwapId(undefined);
      setIsDirectTransaction(false);
      setIsSwapApproval(false);
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
  }, [pendingTransaction, policyDecision, sessionId, provider, signerAddress, lastUserMessage, pendingTransferId, pendingSwapId, isSwapApproval, isDirectTransaction, isBatchSwap, batchSwapDetails, isMultiOpBatch, multiOpBatchDetails, pendingLinkedTransfer, onError, onTransactionSuccess, prepareAndSign, resetQ402]);

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
    setPendingTransferId(undefined);
    setPendingSwapId(undefined);
    setIsDirectTransaction(false);
    setIsSwapApproval(false);
    setIsBatchSwap(false);
    setBatchSwapDetails(null);

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
    setPendingTransferId(undefined);
    setPendingSwapId(undefined);
    setIsDirectTransaction(false);
    setIsSwapApproval(false);
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
