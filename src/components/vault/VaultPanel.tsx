'use client';

import { useState, useMemo } from 'react';
import { BrowserProvider } from 'ethers';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Vault, 
  ArrowDownToLine, 
  ArrowUpFromLine, 
  RefreshCw, 
  AlertCircle,
  CheckCircle,
  Loader2,
  Info,
  ExternalLink
} from 'lucide-react';
import { useVault } from '@/hooks/useVault';
import { useWeb3Context } from '@/components/providers';
import { NETWORKS, type NetworkType } from '@/lib/utils/constants';
import { cn } from '@/lib/utils';

interface VaultPanelProps {
  className?: string;
}

export function VaultPanel({ className }: VaultPanelProps) {
  const { address, isConnected } = useWeb3Context();
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [showSuccess, setShowSuccess] = useState<string | null>(null);
  
  // Default to testnet for now
  const network = 'testnet' as NetworkType;
  
  // Create provider from window.ethereum
  const provider = useMemo(() => {
    if (typeof window !== 'undefined' && window.ethereum && isConnected) {
      return new BrowserProvider(window.ethereum);
    }
    return null;
  }, [isConnected]);

  const {
    balance,
    isLoading,
    isDepositing,
    isWithdrawing,
    error,
    vaultConfigured,
    vaultAddress,
    refreshBalance,
    deposit,
    withdraw,
    withdrawAll,
  } = useVault({
    provider,
    address: address || null,
    network,
  });

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) return;
    
    const txHash = await deposit(depositAmount);
    if (txHash) {
      setDepositAmount('');
      setShowSuccess(`Deposited ${depositAmount} BNB successfully!`);
      setTimeout(() => setShowSuccess(null), 5000);
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) return;
    
    const txHash = await withdraw(withdrawAmount);
    if (txHash) {
      setWithdrawAmount('');
      setShowSuccess(`Withdrew ${withdrawAmount} BNB successfully!`);
      setTimeout(() => setShowSuccess(null), 5000);
    }
  };

  const handleWithdrawAll = async () => {
    const txHash = await withdrawAll();
    if (txHash) {
      setShowSuccess('Withdrew all BNB successfully!');
      setTimeout(() => setShowSuccess(null), 5000);
    }
  };

  const explorerUrl = network === 'mainnet' 
    ? `https://bscscan.com/address/${vaultAddress}`
    : `https://testnet.bscscan.com/address/${vaultAddress}`;

  if (!isConnected) {
    return (
      <div className={cn('rounded-xl border border-border/50 bg-card/50 p-6', className)}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <Vault className="w-5 h-5 text-primary" />
          </div>
          <h3 className="font-semibold">Q402 Vault</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Connect your wallet to manage your vault balance for gas-sponsored transfers.
        </p>
      </div>
    );
  }

  if (!vaultConfigured) {
    return (
      <div className={cn('rounded-xl border border-amber-500/30 bg-amber-500/5 p-6', className)}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <AlertCircle className="w-5 h-5 text-amber-500" />
          </div>
          <h3 className="font-semibold text-amber-500">Vault Not Configured</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          The Q402 Vault contract has not been deployed yet. Native BNB transfers will be 
          executed directly from your wallet (you pay gas).
        </p>
        <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 font-mono">
          <p className="mb-1">To enable gas-sponsored native transfers:</p>
          <p>1. Deploy the vault: <code>npx hardhat run scripts/deploy-vault.js --network bscTestnet</code></p>
          <p>2. Add to .env: <code>Q402_VAULT_TESTNET=0x...</code></p>
          <p>3. Restart the server</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border border-border/50 bg-card/50 p-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Vault className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">Q402 Vault</h3>
            <p className="text-xs text-muted-foreground">Gas-sponsored BNB transfers</p>
          </div>
        </div>
        <button
          onClick={refreshBalance}
          disabled={isLoading}
          className="p-2 rounded-lg hover:bg-muted transition-colors"
          title="Refresh balance"
        >
          <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
        </button>
      </div>

      {/* Balance Display */}
      <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-xl p-4 mb-6">
        <p className="text-sm text-muted-foreground mb-1">Your Vault Balance</p>
        <p className="text-3xl font-bold">
          {parseFloat(balance).toFixed(6)} <span className="text-lg text-muted-foreground">BNB</span>
        </p>
        <a 
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline flex items-center gap-1 mt-2"
        >
          View vault contract <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Info Box */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 mb-6">
        <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-muted-foreground">
          Deposit BNB to enable <strong>gasless native transfers</strong>. 
          The facilitator pays gas, and your vault balance is used for the actual transfer. 
          Policy enforcement is applied to all transfers.
        </p>
      </div>

      {/* Success Message */}
      <AnimatePresence>
        {showSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20 mb-4"
          >
            <CheckCircle className="w-4 h-4 text-green-500" />
            <p className="text-sm text-green-500">{showSuccess}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 mb-4">
          <AlertCircle className="w-4 h-4 text-red-500" />
          <p className="text-sm text-red-500">{error.message}</p>
        </div>
      )}

      {/* Deposit Section */}
      <div className="mb-4">
        <label className="text-sm font-medium mb-2 block">Deposit BNB</label>
        <div className="flex gap-2">
          <input
            type="number"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            placeholder="0.0"
            step="0.01"
            min="0"
            className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <button
            onClick={handleDeposit}
            disabled={isDepositing || !depositAmount || parseFloat(depositAmount) <= 0}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isDepositing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowDownToLine className="w-4 h-4" />
            )}
            Deposit
          </button>
        </div>
      </div>

      {/* Withdraw Section */}
      <div>
        <label className="text-sm font-medium mb-2 block">Withdraw BNB</label>
        <div className="flex gap-2">
          <input
            type="number"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            placeholder="0.0"
            step="0.01"
            min="0"
            max={balance}
            className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <button
            onClick={handleWithdraw}
            disabled={isWithdrawing || !withdrawAmount || parseFloat(withdrawAmount) <= 0 || parseFloat(withdrawAmount) > parseFloat(balance)}
            className="px-4 py-2 rounded-lg bg-muted text-foreground font-medium text-sm hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isWithdrawing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowUpFromLine className="w-4 h-4" />
            )}
            Withdraw
          </button>
        </div>
        {parseFloat(balance) > 0 && (
          <button
            onClick={handleWithdrawAll}
            disabled={isWithdrawing}
            className="text-xs text-primary hover:underline mt-2"
          >
            Withdraw all ({balance} BNB)
          </button>
        )}
      </div>
    </div>
  );
}

