'use client';

import { useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BrowserProvider } from 'ethers';
import { Bot, User, Loader2, PenLine } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { QuickActions } from './QuickActions';
import { TransactionPreview } from '../transactions/TransactionPreview';
import { RiskPanel } from '../transactions/RiskPanel';
import { useChat } from '@/hooks/useChat';
import { useWeb3Context } from '@/components/providers';
import { cn } from '@/lib/utils';

interface ChatInterfaceProps {
  sessionId: string;
  conversationId?: string | null;
  onConversationCreated?: (conversationId: string) => void;
  className?: string;
}

export function ChatInterface({ 
  sessionId, 
  conversationId,
  onConversationCreated,
  className 
}: ChatInterfaceProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { address, isConnected } = useWeb3Context();
  
  // Create BrowserProvider from window.ethereum if available
  const provider = useMemo(() => {
    if (typeof window !== 'undefined' && window.ethereum && isConnected) {
      console.log('[ChatInterface] Creating BrowserProvider, isConnected:', isConnected);
      return new BrowserProvider(window.ethereum);
    }
    console.log('[ChatInterface] No provider - window.ethereum:', !!window?.ethereum, 'isConnected:', isConnected);
    return null;
  }, [isConnected]);
  
  const handleConversationCreated = useCallback((newConversationId: string) => {
    onConversationCreated?.(newConversationId);
  }, [onConversationCreated]);

  const {
    messages,
    isLoading,
    isLoadingHistory,
    isSigning,
    error,
    pendingTransaction,
    policyDecision,
    currentConversationId,
    sendMessage,
    confirmTransaction,
    rejectTransaction,
    clearMessages,
  } = useChat({ 
    sessionId, 
    conversationId,
    provider,
    signerAddress: address,
    onConversationCreated: handleConversationCreated,
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleQuickAction = (action: string) => {
    sendMessage(action);
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Loading history indicator */}
        {isLoadingHistory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center justify-center py-12"
          >
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="ml-3 text-foreground-muted">Loading conversation...</span>
          </motion.div>
        )}

        {/* Welcome message if no messages and not loading */}
        {!isLoadingHistory && messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-12"
          >
            <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
              <Bot className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold mb-2">Welcome to ChainPilot</h2>
            <p className="text-foreground-muted max-w-md mx-auto mb-6">
              I can help you research tokens, generate smart contracts, audit code, 
              and execute transactions on BNB Chain.
            </p>
            <QuickActions onAction={handleQuickAction} />
          </motion.div>
        )}

        {/* Messages */}
        <AnimatePresence mode="popLayout">
          {messages.map((message, index) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ delay: index * 0.05 }}
            >
              <MessageBubble message={message} />
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Loading indicator */}
        {isLoading && !isSigning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-start gap-3 p-4"
          >
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="flex items-center gap-2 text-foreground-muted">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Thinking...</span>
            </div>
          </motion.div>
        )}

        {/* Signing indicator */}
        {isSigning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-start gap-3 p-4"
          >
            <div className="w-8 h-8 rounded-lg bg-accent-amber/20 flex items-center justify-center shrink-0">
              <PenLine className="w-4 h-4 text-accent-amber" />
            </div>
            <div className="flex items-center gap-2 text-accent-amber">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Waiting for wallet signature...</span>
            </div>
          </motion.div>
        )}

        {/* Transaction preview */}
        <AnimatePresence>
          {pendingTransaction && !isSigning && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-4"
            >
              <TransactionPreview 
                preview={pendingTransaction}
                onConfirm={confirmTransaction}
                onReject={rejectTransaction}
                isLoading={isLoading}
              />
              {policyDecision && (
                <RiskPanel decision={policyDecision} />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-border p-4">
        <MessageInput 
          onSend={sendMessage} 
          disabled={isLoading}
          placeholder="Ask me anything about Web3 or BNB Chain..."
        />
      </div>
    </div>
  );
}

