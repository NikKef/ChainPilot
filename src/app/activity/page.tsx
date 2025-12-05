'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Header, Sidebar } from '@/components/layout';
import { Card, Badge, Button } from '@/components/ui';
import { WalletModal } from '@/components/wallet';
import { useWeb3Context } from '@/components/providers';
import { 
  Loader2, 
  History, 
  ArrowUpRight, 
  ArrowLeftRight,
  Code,
  Shield,
  Search,
  ExternalLink,
  RefreshCw,
  Wallet,
  AlertTriangle
} from 'lucide-react';
import type { ActionLog } from '@/lib/types';
import { truncateAddress, formatRelativeTime } from '@/lib/utils/formatting';
import { getExplorerTxUrl } from '@/lib/services/web3/provider';
import { cn } from '@/lib/utils';

const intentIcons: Record<string, React.ElementType> = {
  research: Search,
  explain: Search,
  generate_contract: Code,
  audit_contract: Shield,
  transfer: ArrowUpRight,
  swap: ArrowLeftRight,
  contract_call: Code,
  deploy: Code,
};

const statusColors: Record<string, string> = {
  pending: 'warning',
  approved: 'info',
  rejected: 'danger',
  executed: 'success',
  failed: 'danger',
  cancelled: 'secondary',
};

export default function ActivityPage() {
  const { 
    isConnected, 
    isCorrectNetwork, 
    sessionId, 
    isSessionReady,
    network 
  } = useWeb3Context();
  
  const [logs, setLogs] = useState<ActionLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  // Fetch activity logs
  const fetchLogs = async () => {
    if (!sessionId) return;

    setIsLoading(true);

    try {
      const url = new URL('/api/activity', window.location.origin);
      url.searchParams.set('sessionId', sessionId);
      if (filter !== 'all') {
        url.searchParams.set('status', filter);
      }

      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setLogs(data.logs);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isSessionReady && sessionId) {
      fetchLogs();
    }
  }, [isSessionReady, sessionId, filter]);

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
                Connect your wallet to view your activity history.
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
                Please switch to BNB Chain to view your activity.
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

  // Loading state
  if (!isSessionReady) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        
        <div className="flex flex-1">
          <Sidebar />
          
          <main className="flex-1 lg:ml-64 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
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
          <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                  <History className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">Activity</h1>
                  <p className="text-foreground-muted">Your transaction history</p>
                </div>
              </div>
              <Button 
                variant="secondary" 
                onClick={fetchLogs}
                loading={isLoading}
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </Button>
            </div>

            {/* Filters */}
            <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
              {['all', 'executed', 'pending', 'failed'].map((status) => (
                <button
                  key={status}
                  onClick={() => setFilter(status)}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
                    filter === status
                      ? 'bg-primary text-white'
                      : 'bg-background-tertiary text-foreground-muted hover:bg-border'
                  )}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              ))}
            </div>

            {/* Activity list */}
            {isLoading && logs.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : logs.length === 0 ? (
              <Card>
                <div className="text-center py-12 text-foreground-muted">
                  <History className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p className="font-medium">No activity yet</p>
                  <p className="text-sm">Your transactions and actions will appear here</p>
                </div>
              </Card>
            ) : (
              <div className="space-y-3">
                {logs.map((log, index) => (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <ActivityCard log={log} />
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function ActivityCard({ log }: { log: ActionLog }) {
  const Icon = intentIcons[log.intentType] || History;
  const explorerUrl = log.txHash ? getExplorerTxUrl(log.txHash, log.network) : null;

  return (
    <Card className="hover:border-border-hover transition-colors">
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
          log.status === 'executed' && 'bg-accent-emerald/20',
          log.status === 'failed' && 'bg-risk-high/20',
          log.status === 'pending' && 'bg-accent-amber/20',
          log.status === 'rejected' && 'bg-risk-high/20',
          log.status === 'cancelled' && 'bg-background-tertiary',
          log.status === 'approved' && 'bg-primary/20',
        )}>
          <Icon className={cn(
            'w-5 h-5',
            log.status === 'executed' && 'text-accent-emerald',
            log.status === 'failed' && 'text-risk-high',
            log.status === 'pending' && 'text-accent-amber',
            log.status === 'rejected' && 'text-risk-high',
            log.status === 'cancelled' && 'text-foreground-muted',
            log.status === 'approved' && 'text-primary',
          )} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium capitalize">{log.intentType.replace('_', ' ')}</span>
            <Badge variant={statusColors[log.status] as 'success' | 'warning' | 'danger' | 'info' | 'secondary'}>
              {log.status}
            </Badge>
            <Badge variant="secondary">{log.network}</Badge>
          </div>
          
          {log.userMessage && (
            <p className="text-sm text-foreground-muted truncate mb-2">
              &quot;{log.userMessage}&quot;
            </p>
          )}

          <div className="flex items-center gap-4 text-xs text-foreground-subtle">
            <span>{formatRelativeTime(log.createdAt)}</span>
            {log.estimatedValueUsd && (
              <span>${log.estimatedValueUsd.toFixed(2)}</span>
            )}
            {log.txHash && explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-primary hover:text-primary-hover"
              >
                <span className="font-mono">{truncateAddress(log.txHash, 6, 4)}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {log.errorMessage && (
            <p className="text-xs text-risk-high mt-2">
              Error: {log.errorMessage}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
