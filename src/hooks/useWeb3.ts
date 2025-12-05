'use client';

import { useState, useEffect, useCallback } from 'react';
import { BrowserProvider, formatEther, type Eip1193Provider } from 'ethers';
import { NETWORKS, type NetworkType } from '@/lib/utils/constants';

// Extend window type for ethereum
declare global {
  interface Window {
    ethereum?: Eip1193Provider & {
      isMetaMask?: boolean;
      isTrust?: boolean;
      isCoinbaseWallet?: boolean;
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, callback: (...args: unknown[]) => void) => void;
      removeListener: (event: string, callback: (...args: unknown[]) => void) => void;
    };
  }
}

export interface Web3State {
  isConnected: boolean;
  isConnecting: boolean;
  address: string | null;
  network: NetworkType | null;
  chainId: number | null;
  balance: string | null;
  error: Error | null;
  walletType: 'metamask' | 'trust' | 'coinbase' | 'unknown' | null;
}

export interface UseWeb3Return extends Web3State {
  connect: () => Promise<string | null>;
  disconnect: () => void;
  switchNetwork: (network: NetworkType) => Promise<boolean>;
  isCorrectNetwork: boolean;
  provider: BrowserProvider | null;
}

const BNB_CHAIN_IDS = {
  testnet: 97,
  mainnet: 56,
};

export function useWeb3(): UseWeb3Return {
  const [state, setState] = useState<Web3State>({
    isConnected: false,
    isConnecting: false,
    address: null,
    network: null,
    chainId: null,
    balance: null,
    error: null,
    walletType: null,
  });

  const [provider, setProvider] = useState<BrowserProvider | null>(null);

  // Detect wallet type
  const detectWalletType = useCallback((): Web3State['walletType'] => {
    if (typeof window === 'undefined' || !window.ethereum) return null;
    if (window.ethereum.isMetaMask) return 'metamask';
    if (window.ethereum.isTrust) return 'trust';
    if (window.ethereum.isCoinbaseWallet) return 'coinbase';
    return 'unknown';
  }, []);

  // Get network from chain ID
  const getNetworkFromChainId = useCallback((chainId: number): NetworkType | null => {
    if (chainId === BNB_CHAIN_IDS.testnet) return 'testnet';
    if (chainId === BNB_CHAIN_IDS.mainnet) return 'mainnet';
    return null;
  }, []);

  // Check if on correct network (any BNB Chain network)
  const isCorrectNetwork = state.chainId !== null && 
    (state.chainId === BNB_CHAIN_IDS.testnet || state.chainId === BNB_CHAIN_IDS.mainnet);

  // Fetch balance
  const fetchBalance = useCallback(async (address: string, browserProvider: BrowserProvider) => {
    try {
      const balance = await browserProvider.getBalance(address);
      return formatEther(balance);
    } catch (error) {
      console.error('Error fetching balance:', error);
      return null;
    }
  }, []);

  // Update state with current wallet info
  const updateWalletState = useCallback(async (browserProvider: BrowserProvider) => {
    try {
      const signer = await browserProvider.getSigner();
      const address = await signer.getAddress();
      const network = await browserProvider.getNetwork();
      const chainId = Number(network.chainId);
      const detectedNetwork = getNetworkFromChainId(chainId);
      const balance = await fetchBalance(address, browserProvider);

      setState(prev => ({
        ...prev,
        isConnected: true,
        isConnecting: false,
        address,
        network: detectedNetwork,
        chainId,
        balance,
        error: null,
        walletType: detectWalletType(),
      }));

      setProvider(browserProvider);
    } catch (error) {
      console.error('Error updating wallet state:', error);
      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: error instanceof Error ? error : new Error('Failed to update wallet state'),
      }));
    }
  }, [getNetworkFromChainId, fetchBalance, detectWalletType]);

  // Connect wallet
  const connect = useCallback(async (): Promise<string | null> => {
    if (typeof window === 'undefined' || !window.ethereum) {
      setState(prev => ({
        ...prev,
        error: new Error('No Web3 wallet found. Please install MetaMask or another wallet.'),
      }));
      return null;
    }

    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      // Request account access
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      
      const browserProvider = new BrowserProvider(window.ethereum);
      await updateWalletState(browserProvider);
      
      const signer = await browserProvider.getSigner();
      return await signer.getAddress();
    } catch (error) {
      console.error('Error connecting wallet:', error);
      const err = error instanceof Error ? error : new Error('Failed to connect wallet');
      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: err,
      }));
      return null;
    }
  }, [updateWalletState]);

  // Disconnect wallet
  const disconnect = useCallback(() => {
    setState({
      isConnected: false,
      isConnecting: false,
      address: null,
      network: null,
      chainId: null,
      balance: null,
      error: null,
      walletType: null,
    });
    setProvider(null);
    
    // Clear stored session
    localStorage.removeItem('chainpilot_session_id');
    localStorage.removeItem('chainpilot_wallet_connected');
  }, []);

  // Switch network
  const switchNetwork = useCallback(async (network: NetworkType): Promise<boolean> => {
    if (typeof window === 'undefined' || !window.ethereum) {
      setState(prev => ({
        ...prev,
        error: new Error('No Web3 wallet found'),
      }));
      return false;
    }

    const targetChainId = BNB_CHAIN_IDS[network];
    const chainIdHex = `0x${targetChainId.toString(16)}`;
    const networkConfig = NETWORKS[network];

    try {
      // Try to switch to the network
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainIdHex }],
      });
      
      // Create a fresh provider after network switch to avoid NETWORK_ERROR
      // ethers.js v6 caches network info and throws if it changes
      const newProvider = new BrowserProvider(window.ethereum);
      setProvider(newProvider);
      await updateWalletState(newProvider);
      
      return true;
    } catch (switchError: unknown) {
      // If the chain hasn't been added to the wallet, add it
      if ((switchError as { code?: number })?.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: chainIdHex,
                chainName: networkConfig.name,
                nativeCurrency: networkConfig.nativeCurrency,
                rpcUrls: [networkConfig.rpcUrl],
                blockExplorerUrls: [networkConfig.explorerUrl],
              },
            ],
          });
          
          // Create a fresh provider after adding chain
          const newProvider = new BrowserProvider(window.ethereum);
          setProvider(newProvider);
          await updateWalletState(newProvider);
          
          return true;
        } catch (addError) {
          console.error('Error adding chain:', addError);
          setState(prev => ({
            ...prev,
            error: addError instanceof Error ? addError : new Error('Failed to add network'),
          }));
          return false;
        }
      }
      
      console.error('Error switching chain:', switchError);
      setState(prev => ({
        ...prev,
        error: switchError instanceof Error ? switchError : new Error('Failed to switch network'),
      }));
      return false;
    }
  }, [updateWalletState]);

  // Handle account changes
  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return;

    const handleAccountsChanged = async (accounts: unknown) => {
      const accountsArray = accounts as string[];
      if (accountsArray.length === 0) {
        // User disconnected
        disconnect();
      } else if (state.isConnected && window.ethereum) {
        // Account changed, create fresh provider and update state
        const newProvider = new BrowserProvider(window.ethereum);
        setProvider(newProvider);
        await updateWalletState(newProvider);
      }
    };

    const handleChainChanged = async () => {
      // Chain changed, refresh provider and state
      if (state.isConnected && window.ethereum) {
        const newProvider = new BrowserProvider(window.ethereum);
        setProvider(newProvider);
        await updateWalletState(newProvider);
      }
    };

    const handleDisconnect = () => {
      disconnect();
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);
    window.ethereum.on('disconnect', handleDisconnect);

    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
        window.ethereum.removeListener('disconnect', handleDisconnect);
      }
    };
  }, [state.isConnected, provider, disconnect, updateWalletState]);

  // Auto-connect if previously connected
  useEffect(() => {
    const autoConnect = async () => {
      if (typeof window === 'undefined' || !window.ethereum) return;
      
      const wasConnected = localStorage.getItem('chainpilot_wallet_connected');
      if (wasConnected === 'true') {
        try {
          // Check if we already have permission
          const accounts = await window.ethereum.request({ 
            method: 'eth_accounts' 
          }) as string[];
          
          if (accounts.length > 0) {
            const browserProvider = new BrowserProvider(window.ethereum);
            await updateWalletState(browserProvider);
          }
        } catch (error) {
          console.error('Auto-connect failed:', error);
          localStorage.removeItem('chainpilot_wallet_connected');
        }
      }
    };

    autoConnect();
  }, [updateWalletState]);

  // Save connection state
  useEffect(() => {
    if (state.isConnected) {
      localStorage.setItem('chainpilot_wallet_connected', 'true');
    }
  }, [state.isConnected]);

  return {
    ...state,
    connect,
    disconnect,
    switchNetwork,
    isCorrectNetwork,
    provider,
  };
}

