'use client';

import { useState, useCallback, useEffect } from 'react';
import { BrowserProvider, Contract, parseEther, formatEther } from 'ethers';
import { Q402_VAULT_ABI } from '@/lib/services/facilitator/types';
import { Q402_CONTRACTS, type NetworkType } from '@/lib/utils/constants';

interface UseVaultOptions {
  provider: BrowserProvider | null;
  address: string | null;
  network: NetworkType;
}

interface UseVaultReturn {
  balance: string;
  isLoading: boolean;
  isDepositing: boolean;
  isWithdrawing: boolean;
  error: Error | null;
  vaultConfigured: boolean;
  vaultAddress: string | null;
  refreshBalance: () => Promise<void>;
  deposit: (amount: string) => Promise<string | null>;
  withdraw: (amount: string) => Promise<string | null>;
  withdrawAll: () => Promise<string | null>;
}

/**
 * Hook for interacting with the Q402Vault contract
 * Allows users to deposit and withdraw BNB for gas-sponsored transfers
 */
export function useVault({ 
  provider, 
  address, 
  network 
}: UseVaultOptions): UseVaultReturn {
  const [balance, setBalance] = useState<string>('0');
  const [isLoading, setIsLoading] = useState(false);
  const [isDepositing, setIsDepositing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Get vault address from constants
  const vaultAddress = Q402_CONTRACTS[network]?.vault || null;
  const vaultConfigured = !!vaultAddress && vaultAddress !== '';

  /**
   * Refresh the user's vault balance
   */
  const refreshBalance = useCallback(async () => {
    if (!provider || !address || !vaultConfigured || !vaultAddress) {
      setBalance('0');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const vault = new Contract(vaultAddress, Q402_VAULT_ABI, provider);
      const balanceWei = await vault.getBalance(address);
      setBalance(formatEther(balanceWei));
    } catch (err) {
      console.error('[Vault] Error fetching balance:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch vault balance'));
      setBalance('0');
    } finally {
      setIsLoading(false);
    }
  }, [provider, address, vaultAddress, vaultConfigured]);

  // Refresh balance when provider/address changes
  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  /**
   * Deposit BNB into the vault
   * @param amount Amount in BNB (e.g., "0.1")
   * @returns Transaction hash or null if failed
   */
  const deposit = useCallback(async (amount: string): Promise<string | null> => {
    if (!provider || !address || !vaultConfigured || !vaultAddress) {
      setError(new Error('Wallet not connected or vault not configured'));
      return null;
    }

    setIsDepositing(true);
    setError(null);

    try {
      const signer = await provider.getSigner();
      const vault = new Contract(vaultAddress, Q402_VAULT_ABI, signer);
      
      const amountWei = parseEther(amount);
      
      console.log('[Vault] Depositing:', amount, 'BNB');
      
      const tx = await vault.deposit({ value: amountWei });
      console.log('[Vault] Deposit tx:', tx.hash);
      
      // Wait for confirmation
      await tx.wait(1);
      console.log('[Vault] Deposit confirmed');
      
      // Refresh balance
      await refreshBalance();
      
      return tx.hash;
    } catch (err) {
      console.error('[Vault] Deposit error:', err);
      setError(err instanceof Error ? err : new Error('Failed to deposit'));
      return null;
    } finally {
      setIsDepositing(false);
    }
  }, [provider, address, vaultAddress, vaultConfigured, refreshBalance]);

  /**
   * Withdraw BNB from the vault
   * @param amount Amount in BNB (e.g., "0.1")
   * @returns Transaction hash or null if failed
   */
  const withdraw = useCallback(async (amount: string): Promise<string | null> => {
    if (!provider || !address || !vaultConfigured || !vaultAddress) {
      setError(new Error('Wallet not connected or vault not configured'));
      return null;
    }

    setIsWithdrawing(true);
    setError(null);

    try {
      const signer = await provider.getSigner();
      const vault = new Contract(vaultAddress, Q402_VAULT_ABI, signer);
      
      const amountWei = parseEther(amount);
      
      console.log('[Vault] Withdrawing:', amount, 'BNB');
      
      const tx = await vault.withdraw(amountWei);
      console.log('[Vault] Withdraw tx:', tx.hash);
      
      // Wait for confirmation
      await tx.wait(1);
      console.log('[Vault] Withdraw confirmed');
      
      // Refresh balance
      await refreshBalance();
      
      return tx.hash;
    } catch (err) {
      console.error('[Vault] Withdraw error:', err);
      setError(err instanceof Error ? err : new Error('Failed to withdraw'));
      return null;
    } finally {
      setIsWithdrawing(false);
    }
  }, [provider, address, vaultAddress, vaultConfigured, refreshBalance]);

  /**
   * Withdraw all BNB from the vault
   * @returns Transaction hash or null if failed
   */
  const withdrawAll = useCallback(async (): Promise<string | null> => {
    if (!provider || !address || !vaultConfigured || !vaultAddress) {
      setError(new Error('Wallet not connected or vault not configured'));
      return null;
    }

    setIsWithdrawing(true);
    setError(null);

    try {
      const signer = await provider.getSigner();
      const vault = new Contract(vaultAddress, Q402_VAULT_ABI, signer);
      
      console.log('[Vault] Withdrawing all');
      
      const tx = await vault.withdrawAll();
      console.log('[Vault] WithdrawAll tx:', tx.hash);
      
      // Wait for confirmation
      await tx.wait(1);
      console.log('[Vault] WithdrawAll confirmed');
      
      // Refresh balance
      await refreshBalance();
      
      return tx.hash;
    } catch (err) {
      console.error('[Vault] WithdrawAll error:', err);
      setError(err instanceof Error ? err : new Error('Failed to withdraw'));
      return null;
    } finally {
      setIsWithdrawing(false);
    }
  }, [provider, address, vaultAddress, vaultConfigured, refreshBalance]);

  return {
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
  };
}

