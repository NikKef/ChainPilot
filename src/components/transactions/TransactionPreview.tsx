'use client';

import { motion } from 'framer-motion';
import { 
  ArrowRight, 
  Fuel, 
  Clock, 
  CheckCircle, 
  XCircle,
  AlertTriangle,
  Wallet,
  ArrowLeftRight
} from 'lucide-react';
import { Button, Badge, Card } from '@/components/ui';
import type { TransactionPreview as TxPreview } from '@/lib/types';
import { truncateAddress, formatTokenAmount, formatSlippage } from '@/lib/utils/formatting';
import { cn } from '@/lib/utils';

interface TransactionPreviewProps {
  preview: TxPreview;
  onConfirm: () => void;
  onReject: () => void;
  isLoading?: boolean;
}

export function TransactionPreview({ 
  preview, 
  onConfirm, 
  onReject, 
  isLoading 
}: TransactionPreviewProps) {
  const isSwap = preview.type === 'swap';
  const isTransfer = preview.type === 'transfer' || preview.type === 'token_transfer';
  const isContractCall = preview.type === 'contract_call';

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {isSwap ? (
            <ArrowLeftRight className="w-5 h-5 text-accent-amber" />
          ) : isTransfer ? (
            <Wallet className="w-5 h-5 text-accent-cyan" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-primary" />
          )}
          <h3 className="font-semibold">
            {isSwap ? 'Swap Preview' : isTransfer ? 'Transfer Preview' : 'Transaction Preview'}
          </h3>
        </div>
        <Badge variant={preview.network === 'testnet' ? 'warning' : 'success'}>
          {preview.network}
        </Badge>
      </div>

      {/* Transaction details */}
      <div className="space-y-4">
        {isSwap && (
          <div className="flex items-center justify-between p-4 bg-background rounded-xl">
            <div className="text-center">
              <div className="text-lg font-semibold">{preview.tokenInAmount}</div>
              <div className="text-sm text-foreground-muted">{preview.tokenInSymbol}</div>
            </div>
            <ArrowRight className="w-5 h-5 text-foreground-muted" />
            <div className="text-center">
              <div className="text-lg font-semibold text-accent-emerald">{preview.tokenOutAmount}</div>
              <div className="text-sm text-foreground-muted">{preview.tokenOutSymbol}</div>
            </div>
          </div>
        )}

        {isTransfer && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-foreground-muted">Amount</span>
              <span className="font-mono font-medium">
                {preview.tokenAmount || preview.nativeValue} {preview.tokenSymbol || 'BNB'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-foreground-muted">To</span>
              <span className="font-mono text-sm">{truncateAddress(preview.to)}</span>
            </div>
          </div>
        )}

        {isContractCall && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-foreground-muted">Contract</span>
              <span className="font-mono text-sm">{truncateAddress(preview.to)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-foreground-muted">Method</span>
              <span className="font-mono text-sm">{preview.methodName}</span>
            </div>
          </div>
        )}

        {/* Common details */}
        <div className="pt-4 border-t border-border space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-foreground-muted flex items-center gap-2">
              <Wallet className="w-4 h-4" />
              From
            </span>
            <span className="font-mono text-sm">{truncateAddress(preview.from)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-foreground-muted flex items-center gap-2">
              <Fuel className="w-4 h-4" />
              Est. Gas Fee
            </span>
            <span className="font-mono text-sm">
              {preview.estimatedFee ? `${parseFloat(preview.estimatedFee) / 1e18} BNB` : '~0.001 BNB'}
            </span>
          </div>

          {isSwap && preview.slippageBps && (
            <div className="flex items-center justify-between">
              <span className="text-foreground-muted">Slippage</span>
              <span className="font-mono text-sm">{formatSlippage(preview.slippageBps)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 mt-6">
        <Button
          variant="secondary"
          onClick={onReject}
          disabled={isLoading}
          className="flex-1"
        >
          <XCircle className="w-4 h-4" />
          Reject
        </Button>
        <Button
          variant="primary"
          onClick={onConfirm}
          loading={isLoading}
          className="flex-1"
        >
          <CheckCircle className="w-4 h-4" />
          Confirm
        </Button>
      </div>
    </Card>
  );
}

