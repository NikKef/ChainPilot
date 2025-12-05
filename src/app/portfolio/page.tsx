'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Header, Sidebar } from '@/components/layout';
import { Card, Badge, Button } from '@/components/ui';
import { WalletModal } from '@/components/wallet';
import { useWeb3Context } from '@/components/providers';
import { 
  Loader2, 
  Wallet, 
  Coins, 
  RefreshCw,
  ExternalLink,
  AlertTriangle
} from 'lucide-react';
import type { Portfolio, TokenBalance } from '@/lib/types';
import { truncateAddress } from '@/lib/utils/formatting';
import { getExplorerAddressUrl } from '@/lib/services/web3/provider';
import { cn } from '@/lib/utils';

export default function PortfolioPage() {
  const { 
    isConnected, 
    isCorrectNetwork, 
    address, 
    network, 
    balance: nativeBalance 
  } = useWeb3Context();
  
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  // Fetch portfolio
  const fetchPortfolio = async () => {
    if (!address || !network) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/portfolio?address=${address}&network=${network}`
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch portfolio');
      }

      const data = await response.json();
      setPortfolio(data.portfolio);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isConnected && isCorrectNetwork && address) {
      fetchPortfolio();
    }
  }, [isConnected, isCorrectNetwork, address, network]);

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
              <div className="w-20 h-20 rounded-2xl bg-accent-cyan/20 flex items-center justify-center mx-auto mb-6">
                <Wallet className="w-10 h-10 text-accent-cyan" />
              </div>
              <h2 className="text-2xl font-bold mb-3">Connect Your Wallet</h2>
              <p className="text-foreground-muted mb-6">
                Connect your wallet to view your portfolio and token balances on BNB Chain.
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
                Please switch to BNB Chain to view your portfolio.
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

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      
      <div className="flex flex-1">
        <Sidebar />
        
        <main className="flex-1 lg:ml-64 p-6">
          <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent-cyan/20 flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-accent-cyan" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">Portfolio</h1>
                  <p className="text-foreground-muted text-sm font-mono">
                    {truncateAddress(address || '', 8, 6)}
                  </p>
                </div>
              </div>
              <Button 
                variant="secondary" 
                onClick={fetchPortfolio}
                loading={isLoading}
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </Button>
            </div>

            {/* Error */}
            {error && (
              <Card className="mb-6 border-risk-high/50">
                <p className="text-risk-high">{error}</p>
              </Card>
            )}

            {/* Loading */}
            {isLoading && !portfolio && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            )}

            {/* Portfolio content */}
            <div className="space-y-6">
              {/* Native balance card */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <Card className="gradient-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-foreground-muted text-sm mb-1">Native Balance</p>
                      <p className="text-3xl font-bold">
                        {nativeBalance ? parseFloat(nativeBalance).toFixed(4) : '0'}{' '}
                        <span className="text-xl text-foreground-muted">
                          {network === 'testnet' ? 'tBNB' : 'BNB'}
                        </span>
                      </p>
                      {portfolio?.nativeValueUsd && (
                        <p className="text-foreground-muted text-sm mt-1">
                          ≈ ${portfolio.nativeValueUsd.toFixed(2)} USD
                        </p>
                      )}
                    </div>
                    <div className="w-16 h-16 rounded-2xl bg-accent-amber/20 flex items-center justify-center">
                      <img 
                        src="https://cryptologos.cc/logos/bnb-bnb-logo.svg?v=029" 
                        alt="BNB"
                        className="w-10 h-10"
                      />
                    </div>
                  </div>
                </Card>
              </motion.div>

              {/* Token list */}
              <div>
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Coins className="w-5 h-5 text-foreground-muted" />
                  Tokens
                  {portfolio && (
                    <Badge variant="secondary">{portfolio.tokens.length}</Badge>
                  )}
                </h2>

                {!portfolio || portfolio.tokens.length === 0 ? (
                  <Card>
                    <div className="text-center py-8 text-foreground-muted">
                      <Coins className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>No tokens found</p>
                      <p className="text-sm">Tokens will appear here when you hold any BEP20 tokens</p>
                    </div>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {portfolio.tokens.map((token, index) => (
                      <motion.div
                        key={token.address}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                      >
                        <TokenCard token={token} network={network || 'testnet'} />
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>

              {/* Last updated */}
              {portfolio && (
                <p className="text-center text-xs text-foreground-subtle">
                  Last updated: {new Date(portfolio.updatedAt).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function TokenCard({ token, network }: { token: TokenBalance; network: 'testnet' | 'mainnet' }) {
  const explorerUrl = getExplorerAddressUrl(token.address, network);

  return (
    <Card className="hover:border-primary/50 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-background flex items-center justify-center">
            {token.logoUrl ? (
              <img src={token.logoUrl} alt={token.symbol} className="w-6 h-6 rounded-full" />
            ) : (
              <Coins className="w-5 h-5 text-foreground-muted" />
            )}
          </div>
          <div>
            <div className="font-medium">{token.symbol}</div>
            <div className="text-xs text-foreground-muted">{token.name}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono">{token.balanceFormatted}</div>
          {token.valueUsd && (
            <div className="text-xs text-foreground-muted">
              ${token.valueUsd.toFixed(2)}
            </div>
          )}
        </div>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-4 p-2 hover:bg-background-tertiary rounded-lg transition-colors"
        >
          <ExternalLink className="w-4 h-4 text-foreground-muted" />
        </a>
      </div>
    </Card>
  );
}
