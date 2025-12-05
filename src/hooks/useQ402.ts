'use client';

import { useState, useCallback } from 'react';
import { BrowserProvider, parseEther } from 'ethers';
import type { Q402PaymentRequest, Q402SignedMessage, Q402Witness } from '@/lib/services/q402/types';
import type { TransactionPreview, TransactionResult, PolicyEvaluationResult } from '@/lib/types';

/**
 * Q402 signing state
 */
export interface Q402SigningState {
  isLoading: boolean;
  isPreparing: boolean;
  isSigning: boolean;
  isExecuting: boolean;
  error: Error | null;
  request: Q402PaymentRequest | null;
  typedData: Q402SignedMessage | null;
  signature: string | null;
  result: TransactionResult | null;
}

/**
 * Q402 signing options
 */
export interface Q402SigningOptions {
  onPrepared?: (request: Q402PaymentRequest) => void;
  onSigned?: (signature: string) => void;
  onExecuted?: (result: TransactionResult) => void;
  onError?: (error: Error) => void;
}

/**
 * Hook return type
 */
export interface UseQ402Return {
  state: Q402SigningState;
  prepareAndSign: (
    preview: TransactionPreview,
    policyDecision: PolicyEvaluationResult,
    sessionId: string,
    provider: BrowserProvider
  ) => Promise<TransactionResult | null>;
  signTypedData: (
    provider: BrowserProvider,
    typedData: Q402SignedMessage
  ) => Promise<string | null>;
  executeTransaction: (
    sessionId: string,
    requestId: string,
    signature: string,
    signerAddress: string
  ) => Promise<TransactionResult | null>;
  reset: () => void;
}

const initialState: Q402SigningState = {
  isLoading: false,
  isPreparing: false,
  isSigning: false,
  isExecuting: false,
  error: null,
  request: null,
  typedData: null,
  signature: null,
  result: null,
};

/**
 * React hook for Q402 sign-to-pay flow
 * 
 * Usage:
 * ```tsx
 * const { state, prepareAndSign, reset } = useQ402({
 *   onExecuted: (result) => console.log('Transaction executed:', result.txHash),
 * });
 * 
 * // Execute a transaction
 * const handleConfirm = async () => {
 *   const result = await prepareAndSign(preview, policyDecision, sessionId, provider);
 *   if (result?.success) {
 *     // Handle success
 *   }
 * };
 * ```
 */
export function useQ402(options: Q402SigningOptions = {}): UseQ402Return {
  const [state, setState] = useState<Q402SigningState>(initialState);

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  /**
   * Sign EIP-712 typed data using the user's wallet
   */
  const signTypedData = useCallback(async (
    provider: BrowserProvider,
    typedData: Q402SignedMessage
  ): Promise<string | null> => {
    setState(prev => ({ ...prev, isSigning: true, error: null }));

    try {
      console.log('[Q402] Starting signature request with typed data:', JSON.stringify(typedData, null, 2));
      
      if (!provider) {
        throw new Error('No provider available');
      }

      const signer = await provider.getSigner();
      if (!signer) {
        throw new Error('Could not get signer from provider');
      }
      
      const signerAddress = await signer.getAddress();
      console.log('[Q402] Got signer:', signerAddress);
      
      // Validate typed data structure
      if (!typedData?.domain || !typedData?.types?.Witness || !typedData?.message) {
        console.error('[Q402] Invalid typed data structure:', typedData);
        throw new Error('Invalid typed data structure');
      }
      
      // Prepare typed data for signing
      // ethers.js v6 uses signTypedData with domain, types, and value
      const domain = {
        name: typedData.domain.name,
        version: typedData.domain.version,
        chainId: Number(typedData.domain.chainId), // Ensure it's a number
        verifyingContract: typedData.domain.verifyingContract,
      };

      // Ensure types are in the correct format for ethers.js
      const types = {
        Witness: typedData.types.Witness.map((field: { name: string; type: string }) => ({
          name: field.name,
          type: field.type,
        })),
      };

      // Convert amount to wei if it's a decimal value
      let amountInWei = String(typedData.message.amount);
      if (amountInWei.includes('.') || (parseFloat(amountInWei) < 1000 && parseFloat(amountInWei) > 0)) {
        try {
          amountInWei = parseEther(amountInWei).toString();
          console.log('[Q402] Converted amount to wei:', typedData.message.amount, '->', amountInWei);
        } catch (e) {
          console.warn('[Q402] Failed to convert amount to wei, using as-is:', e);
        }
      }

      // Ensure numeric values are properly formatted for EIP-712
      const value = {
        ...typedData.message,
        amount: amountInWei,
        deadline: Number(typedData.message.deadline),
        nonce: Number(typedData.message.nonce),
      };

      console.log('[Q402] Signing with domain:', domain);
      console.log('[Q402] Signing with types:', types);
      console.log('[Q402] Signing with value:', value);

      // Sign the typed data
      const signature = await signer.signTypedData(domain, types, value);
      console.log('[Q402] Signature received:', signature);

      setState(prev => ({ ...prev, isSigning: false, signature }));
      options.onSigned?.(signature);

      return signature;
    } catch (error) {
      console.error('[Q402] Signing error:', error);
      // Check if user rejected
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('user rejected') || errorMessage.includes('User denied')) {
        console.log('[Q402] User rejected the signature request');
      }
      const err = error instanceof Error ? error : new Error('Failed to sign message');
      setState(prev => ({ ...prev, isSigning: false, error: err }));
      options.onError?.(err);
      return null;
    }
  }, [options]);

  /**
   * Execute a signed transaction through the API
   */
  const executeTransaction = useCallback(async (
    sessionId: string,
    requestId: string,
    signature: string,
    signerAddress: string
  ): Promise<TransactionResult | null> => {
    setState(prev => ({ ...prev, isExecuting: true, error: null }));

    try {
      const response = await fetch('/api/transactions/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          actionLogId: requestId,
          signature,
          signerAddress,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Transaction execution failed');
      }

      const data = await response.json();
      const result: TransactionResult = data.result;

      setState(prev => ({ ...prev, isExecuting: false, result }));
      options.onExecuted?.(result);

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to execute transaction');
      setState(prev => ({ ...prev, isExecuting: false, error: err }));
      options.onError?.(err);
      return null;
    }
  }, [options]);

  /**
   * Full flow: prepare -> sign -> execute
   */
  const prepareAndSign = useCallback(async (
    preview: TransactionPreview,
    policyDecision: PolicyEvaluationResult,
    sessionId: string,
    provider: BrowserProvider
  ): Promise<TransactionResult | null> => {
    setState(prev => ({ ...prev, isLoading: true, isPreparing: true, error: null }));

    try {
      // Get signer address
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();

      // Step 1: Prepare transaction via API (this creates and stores the Q402 request)
      setState(prev => ({ ...prev, isPreparing: true }));
      
      const prepareResponse = await fetch('/api/transactions/prepare/q402', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          preview,
          policyDecision,
          signerAddress,
        }),
      });

      let requestId: string;
      let typedData: Q402SignedMessage;

      console.log('[Q402] Prepare response status:', prepareResponse.status);

      if (prepareResponse.ok) {
        // Use the server-prepared request and typed data
        const prepareData = await prepareResponse.json();
        console.log('[Q402] Prepare response data:', prepareData);
        
        if (!prepareData.success) {
          throw new Error(prepareData.error || 'Transaction rejected by policy');
        }

        requestId = prepareData.requestId;
        typedData = prepareData.typedData;
        
        console.log('[Q402] Using server request ID:', requestId);
        console.log('[Q402] Using server typed data:', typedData);
      } else {
        // If Q402 prepare fails, try fallback with client-side typed data
        const errorData = await prepareResponse.json().catch(() => ({}));
        console.error('[Q402] Prepare failed:', prepareResponse.status, errorData);
        
        // If it's a policy rejection, throw the error
        if (prepareResponse.status === 403) {
          throw new Error(errorData.error || 'Transaction rejected by policy');
        }

        // Otherwise, create client-side typed data as fallback
        console.warn('[Q402] Using client-side fallback');
        typedData = createClientSideTypedData(preview, signerAddress);
        requestId = `q402_${Date.now().toString(36)}_${Math.random().toString(36).substring(2)}`;
      }
      
      const request: Q402PaymentRequest = {
        id: requestId,
        chainId: preview.network === 'mainnet' ? 56 : 97,
        transaction: preview.preparedTx,
        metadata: {
          action: preview.type,
          description: `${preview.type}: ${preview.tokenAmount || preview.nativeValue} ${preview.tokenSymbol || 'BNB'}`,
        },
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      };

      setState(prev => ({ 
        ...prev, 
        isPreparing: false, 
        request,
        typedData,
      }));
      options.onPrepared?.(request);

      // Step 2: Sign the typed data
      console.log('[Q402] About to call signTypedData...');
      console.log('[Q402] Provider available:', !!provider);
      console.log('[Q402] TypedData:', JSON.stringify(typedData, null, 2));
      
      const signature = await signTypedData(provider, typedData);
      console.log('[Q402] Signature result:', signature ? 'received' : 'null');
      
      if (!signature) {
        console.log('[Q402] No signature received, returning null');
        setState(prev => ({ ...prev, isLoading: false }));
        return null;
      }

      // Step 3: Execute the transaction with the server-generated requestId
      console.log('[Q402] Executing transaction with requestId:', requestId);
      const result = await executeTransaction(sessionId, requestId, signature, signerAddress);
      
      setState(prev => ({ ...prev, isLoading: false }));
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Transaction failed');
      setState(prev => ({ 
        ...prev, 
        isLoading: false, 
        isPreparing: false,
        error: err 
      }));
      options.onError?.(err);
      return null;
    }
  }, [options, signTypedData, executeTransaction]);

  return {
    state,
    prepareAndSign,
    signTypedData,
    executeTransaction,
    reset,
  };
}

/**
 * Create client-side typed data for immediate signing
 * This allows the UI to prompt for signature immediately
 */
function createClientSideTypedData(
  preview: TransactionPreview,
  signerAddress: string
): Q402SignedMessage {
  const chainId = preview.network === 'mainnet' ? 56 : 97;
  const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes
  const paymentId = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')}`;

  const witness: Q402Witness = {
    owner: signerAddress,
    token: preview.tokenAddress || '0x0000000000000000000000000000000000000000',
    amount: preview.preparedTx.value || '0',
    to: preview.to,
    deadline,
    paymentId,
    nonce: 0, // Would be fetched from contract in production
  };

  return {
    domain: {
      name: 'q402',
      version: '1',
      chainId,
      verifyingContract: preview.network === 'mainnet' 
        ? '0x0000000000000000000000000000000000000002'  // Mainnet verifier
        : '0x0000000000000000000000000000000000000002', // Testnet verifier
    },
    types: {
      Witness: [
        { name: 'owner', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'to', type: 'address' },
        { name: 'deadline', type: 'uint256' },
        { name: 'paymentId', type: 'bytes32' },
        { name: 'nonce', type: 'uint256' },
      ],
    },
    primaryType: 'Witness',
    message: witness,
  };
}

export default useQ402;

