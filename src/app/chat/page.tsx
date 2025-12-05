'use client';

import { Header, Sidebar } from '@/components/layout';
import { ChatInterface } from '@/components/chat';
import { useWeb3Context } from '@/components/providers';
import { Loader2, Wallet, AlertTriangle, Bot } from 'lucide-react';
import { Button } from '@/components/ui';
import { WalletModal } from '@/components/wallet';
import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';

export default function ChatPage() {
  const { 
    isConnected, 
    isCorrectNetwork, 
    sessionId, 
    isSessionReady,
    address,
    network,
    activeConversationId,
    setActiveConversation,
    refreshConversations,
  } = useWeb3Context();
  
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  // Handle when a new conversation is created from within the chat
  const handleConversationCreated = useCallback((newConversationId: string) => {
    setActiveConversation(newConversationId);
    refreshConversations();
  }, [setActiveConversation, refreshConversations]);

  // Show connect wallet prompt if not connected
  if (!isConnected) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        
        <div className="flex flex-1">
          <Sidebar />
          
          <main className="flex-1 lg:ml-64 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center max-w-md"
            >
              <div className="w-20 h-20 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-6">
                <Wallet className="w-10 h-10 text-primary" />
              </div>
              <h2 className="text-2xl font-bold mb-3">Connect Your Wallet</h2>
              <p className="text-foreground-muted mb-6">
                Connect your wallet to start chatting with ChainPilot and interact with BNB Chain through natural language.
              </p>
              <Button 
                variant="primary" 
                size="lg"
                onClick={() => setIsWalletModalOpen(true)}
              >
                <Wallet className="w-5 h-5" />
                Connect Wallet
              </Button>
            </motion.div>
          </main>
        </div>

        <WalletModal 
          isOpen={isWalletModalOpen} 
          onClose={() => setIsWalletModalOpen(false)} 
        />
      </div>
    );
  }

  // Show wrong network warning
  if (!isCorrectNetwork) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        
        <div className="flex flex-1">
          <Sidebar />
          
          <main className="flex-1 lg:ml-64 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center max-w-md"
            >
              <div className="w-20 h-20 rounded-2xl bg-accent-amber/20 flex items-center justify-center mx-auto mb-6">
                <AlertTriangle className="w-10 h-10 text-accent-amber" />
              </div>
              <h2 className="text-2xl font-bold mb-3">Wrong Network</h2>
              <p className="text-foreground-muted mb-6">
                Please switch to BNB Chain (Testnet or Mainnet) to use ChainPilot.
              </p>
              <Button 
                variant="primary" 
                size="lg"
                onClick={() => setIsWalletModalOpen(true)}
              >
                Switch Network
              </Button>
            </motion.div>
          </main>
        </div>

        <WalletModal 
          isOpen={isWalletModalOpen} 
          onClose={() => setIsWalletModalOpen(false)} 
        />
      </div>
    );
  }

  // Show loading while session is being created
  if (!isSessionReady || !sessionId) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        
        <div className="flex flex-1">
          <Sidebar />
          
          <main className="flex-1 lg:ml-64 flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
              <p className="text-foreground-muted">Initializing session...</p>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      
      <div className="flex flex-1">
        <Sidebar />
        
        <main className="flex-1 lg:ml-64">
          <div className="h-[calc(100vh-4rem)]">
            <ChatInterface 
              sessionId={sessionId} 
              conversationId={activeConversationId}
              onConversationCreated={handleConversationCreated}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
