'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Header, Sidebar } from '@/components/layout';
import { SettingsPanel } from '@/components/settings';
import { WalletModal } from '@/components/wallet';
import { useWeb3Context } from '@/components/providers';
import { Loader2, Settings, Wallet, AlertTriangle } from 'lucide-react';
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
                Connect your wallet to manage your settings and policies.
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
                Please switch to BNB Chain to manage your settings.
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

  // Loading state for session/policy
  if (isSessionLoading || !isSessionReady || !policy) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        
        <div className="flex flex-1">
          <Sidebar />
          
          <main className="flex-1 lg:ml-64 flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
              <p className="text-foreground-muted">Loading settings...</p>
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
        
        <main className="flex-1 lg:ml-64 p-6">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <Settings className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Settings</h1>
                <p className="text-foreground-muted">Manage your policies and preferences</p>
              </div>
            </div>

            <SettingsPanel
              policy={policy}
              network={network || 'testnet'}
              onPolicyUpdate={updatePolicy}
              onNetworkChange={handleNetworkChange}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
