'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Header, Sidebar } from '@/components/layout';
import { SettingsPanel } from '@/components/settings';
import { WalletModal } from '@/components/wallet';
import { useWeb3Context } from '@/components/providers';
import { Loader2, Settings, Wallet, AlertTriangle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui';

export default function SettingsPage() {
  const { 
    isConnected, 
    isCorrectNetwork, 
    network,
    switchNetwork,
    policy,
    updatePolicy,
    isSessionLoading,
    isSessionReady
  } = useWeb3Context();
  
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  const handleNetworkChange = async (newNetwork: 'testnet' | 'mainnet') => {
    if (isConnected) {
      await switchNetwork(newNetwork);
    }
  };

  // Show connect wallet prompt if not connected
  if (!isConnected) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        
        <div className="flex flex-1">
          <Sidebar />
          
          <main className="flex-1 lg:ml-64 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center max-w-md"
            >
              <div className="relative w-24 h-24 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mx-auto mb-6 border border-primary/20">
                <Wallet className="w-12 h-12 text-primary" />
                <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                  <Sparkles className="w-3 h-3 text-white" />
                </div>
              </div>
              <h2 className="text-2xl font-bold mb-3">Connect Your Wallet</h2>
              <p className="text-foreground-muted mb-8">
                Connect your wallet to manage your security settings, spend limits, and transaction policies.
              </p>
              <Button 
                variant="primary" 
                size="lg"
                onClick={() => setIsWalletModalOpen(true)}
                className="shadow-lg shadow-primary/25"
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
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        
        <div className="flex flex-1">
          <Sidebar />
          
          <main className="flex-1 lg:ml-64 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center max-w-md"
            >
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-accent-amber/20 to-accent-amber/5 flex items-center justify-center mx-auto mb-6 border border-accent-amber/20">
                <AlertTriangle className="w-12 h-12 text-accent-amber" />
              </div>
              <h2 className="text-2xl font-bold mb-3">Wrong Network</h2>
              <p className="text-foreground-muted mb-8">
                Please switch to BNB Chain to manage your settings.
              </p>
              <Button 
                variant="primary" 
                size="lg"
                onClick={() => setIsWalletModalOpen(true)}
                className="shadow-lg shadow-primary/25"
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

  // Loading state for session/policy
  if (isSessionLoading || !isSessionReady || !policy) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        
        <div className="flex flex-1">
          <Sidebar />
          
          <main className="flex-1 lg:ml-64 flex items-center justify-center">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center"
            >
              <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
              <p className="text-foreground-muted">Loading settings...</p>
            </motion.div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      
      <div className="flex flex-1">
        <Sidebar />
        
        <main className="flex-1 lg:ml-64 p-6 pb-20">
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-3xl mx-auto"
          >
            {/* Page Header */}
            <div className="flex items-center gap-4 mb-8">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/20">
                <Settings className="w-7 h-7 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Settings</h1>
                <p className="text-foreground-muted">Manage your security policies and preferences</p>
              </div>
            </div>

            <SettingsPanel
              policy={policy}
              network={network || 'testnet'}
              onPolicyUpdate={updatePolicy}
              onNetworkChange={handleNetworkChange}
            />
          </motion.div>
        </main>
      </div>
    </div>
  );
}
