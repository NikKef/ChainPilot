'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, 
  Wallet, 
  ExternalLink, 
  AlertTriangle,
  CheckCircle,
  Loader2,
  Copy,
  LogOut
} from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import { useWeb3Context } from '@/components/providers';
import { truncateAddress } from '@/lib/utils/formatting';
import { NETWORKS, type NetworkType } from '@/lib/utils/constants';
import { cn } from '@/lib/utils';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WalletModal({ isOpen, onClose }: WalletModalProps) {
  const {
    isConnected,
    isConnecting,
    address,
    network,
    chainId,
    balance,
    error,
    walletType,
    isCorrectNetwork,
    connect,
    disconnect,
    switchNetwork,
  } = useWeb3Context();

  const [copied, setCopied] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  const handleConnect = async () => {
    await connect();
  };

  const handleDisconnect = () => {
    disconnect();
    onClose();
  };

  const handleSwitchNetwork = async (targetNetwork: NetworkType) => {
    setIsSwitching(true);
    await switchNetwork(targetNetwork);
    setIsSwitching(false);
  };

  const handleCopyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getWalletIcon = () => {
    switch (walletType) {
      case 'metamask':
        return '🦊';
      case 'trust':
        return '🛡️';
      case 'coinbase':
        return '🔵';
      default:
        return '👛';
    }
  };

  const getWalletName = () => {
    switch (walletType) {
      case 'metamask':
        return 'MetaMask';
      case 'trust':
        return 'Trust Wallet';
      case 'coinbase':
        return 'Coinbase Wallet';
      default:
        return 'Wallet';
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div className="bg-background-secondary border border-border rounded-2xl shadow-2xl overflow-hidden w-full max-w-md pointer-events-auto max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-primary" />
                  {isConnected ? 'Wallet Connected' : 'Connect Wallet'}
                </h2>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-background-tertiary rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="p-6">
                {/* Error message */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 p-3 bg-risk-high/10 border border-risk-high/30 rounded-lg flex items-start gap-2"
                  >
                    <AlertTriangle className="w-5 h-5 text-risk-high shrink-0 mt-0.5" />
                    <p className="text-sm text-risk-high">{error.message}</p>
                  </motion.div>
                )}

                {isConnected && address ? (
                  // Connected state
                  <div className="space-y-4">
                    {/* Wallet info */}
                    <div className="p-4 bg-background rounded-xl border border-border">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center text-2xl">
                          {getWalletIcon()}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{getWalletName()}</span>
                            <Badge variant="success" size="sm">Connected</Badge>
                          </div>
                          <button
                            onClick={handleCopyAddress}
                            className="flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground transition-colors mt-1"
                          >
                            <span className="font-mono">{truncateAddress(address, 8, 6)}</span>
                            {copied ? (
                              <CheckCircle className="w-3.5 h-3.5 text-accent-emerald" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Balance */}
                      {balance && (
                        <div className="flex items-center justify-between pt-3 border-t border-border">
                          <span className="text-sm text-foreground-muted">Balance</span>
                          <span className="font-mono font-medium">
                            {parseFloat(balance).toFixed(4)} {network === 'testnet' ? 'tBNB' : 'BNB'}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Network status */}
                    <div className="p-4 bg-background rounded-xl border border-border">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm text-foreground-muted">Network</span>
                        {isCorrectNetwork ? (
                          <Badge variant="success" size="sm">BNB Chain</Badge>
                        ) : (
                          <Badge variant="high" size="sm">Wrong Network</Badge>
                        )}
                      </div>

                      {!isCorrectNetwork && (
                        <div className="p-3 bg-accent-amber/10 border border-accent-amber/30 rounded-lg mb-3">
                          <p className="text-sm text-accent-amber flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" />
                            Please switch to BNB Chain
                          </p>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => handleSwitchNetwork('testnet')}
                          disabled={isSwitching}
                          className={cn(
                            'p-3 rounded-lg border transition-all text-sm font-medium',
                            network === 'testnet'
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border hover:border-primary/50 hover:bg-background-tertiary'
                          )}
                        >
                          {isSwitching ? (
                            <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                          ) : (
                            <>Testnet</>
                          )}
                        </button>
                        <button
                          onClick={() => handleSwitchNetwork('mainnet')}
                          disabled={isSwitching}
                          className={cn(
                            'p-3 rounded-lg border transition-all text-sm font-medium',
                            network === 'mainnet'
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border hover:border-primary/50 hover:bg-background-tertiary'
                          )}
                        >
                          {isSwitching ? (
                            <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                          ) : (
                            <>Mainnet</>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Disconnect button */}
                    <Button
                      variant="secondary"
                      className="w-full"
                      onClick={handleDisconnect}
                    >
                      <LogOut className="w-4 h-4" />
                      Disconnect Wallet
                    </Button>
                  </div>
                ) : (
                  // Not connected state
                  <div className="space-y-4">
                    <p className="text-foreground-muted text-center mb-6">
                      Connect your wallet to interact with BNB Chain through ChainPilot.
                    </p>

                    {/* Connect button */}
                    <Button
                      variant="primary"
                      size="lg"
                      className="w-full"
                      onClick={handleConnect}
                      loading={isConnecting}
                    >
                      <Wallet className="w-5 h-5" />
                      {isConnecting ? 'Connecting...' : 'Connect Wallet'}
                    </Button>

                    {/* Supported wallets */}
                    <div className="pt-4 border-t border-border">
                      <p className="text-xs text-foreground-muted text-center mb-3">
                        Supported wallets
                      </p>
                      <div className="flex justify-center gap-4">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-2xl">🦊</span>
                          <span className="text-xs text-foreground-muted">MetaMask</span>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-2xl">🛡️</span>
                          <span className="text-xs text-foreground-muted">Trust</span>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-2xl">🔵</span>
                          <span className="text-xs text-foreground-muted">Coinbase</span>
                        </div>
                      </div>
                    </div>

                    {/* No wallet installed hint */}
                    <div className="text-center">
                      <a
                        href="https://metamask.io/download/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                      >
                        Don&apos;t have a wallet? Get MetaMask
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

