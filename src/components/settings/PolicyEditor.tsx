'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DollarSign, Calendar, Save, Check, AlertCircle, Infinity } from 'lucide-react';
import { Card, Button } from '@/components/ui';
import type { PolicyWithLists } from '@/lib/types';
import { cn } from '@/lib/utils';

interface PolicyEditorProps {
  policy: PolicyWithLists;
  onUpdate: (updates: Partial<PolicyWithLists>) => Promise<void>;
  isSaving?: boolean;
  showToast?: (message: string, type: 'success' | 'error') => void;
}

// Preset buttons for quick selection
const PRESETS = {
  perTx: [100, 500, 1000, 5000],
  daily: [1000, 5000, 10000, 50000],
};

export function PolicyEditor({ policy, onUpdate, isSaving, showToast }: PolicyEditorProps) {
  const [perTxLimit, setPerTxLimit] = useState(policy.maxPerTxUsd?.toString() || '');
  const [dailyLimit, setDailyLimit] = useState(policy.maxDailyUsd?.toString() || '');
  const [hasChanges, setHasChanges] = useState(false);
  const [isLocalSaving, setIsLocalSaving] = useState(false);
  const [focusedField, setFocusedField] = useState<'perTx' | 'daily' | null>(null);

  // Sync with policy changes
  useEffect(() => {
    setPerTxLimit(policy.maxPerTxUsd?.toString() || '');
    setDailyLimit(policy.maxDailyUsd?.toString() || '');
  }, [policy.maxPerTxUsd, policy.maxDailyUsd]);

  useEffect(() => {
    const perTxChanged = perTxLimit !== (policy.maxPerTxUsd?.toString() || '');
    const dailyChanged = dailyLimit !== (policy.maxDailyUsd?.toString() || '');
    setHasChanges(perTxChanged || dailyChanged);
  }, [perTxLimit, dailyLimit, policy]);

  const handleSave = useCallback(async () => {
    setIsLocalSaving(true);
    try {
      await onUpdate({
        maxPerTxUsd: perTxLimit ? parseFloat(perTxLimit) : null,
        maxDailyUsd: dailyLimit ? parseFloat(dailyLimit) : null,
      });
      setHasChanges(false);
      showToast?.('Spend limits saved', 'success');
    } catch {
      showToast?.('Failed to save limits', 'error');
    } finally {
      setIsLocalSaving(false);
    }
  }, [perTxLimit, dailyLimit, onUpdate, showToast]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && hasChanges) {
      handleSave();
    }
  };

  const setPreset = (type: 'perTx' | 'daily', value: number | null) => {
    if (type === 'perTx') {
      setPerTxLimit(value?.toString() || '');
    } else {
      setDailyLimit(value?.toString() || '');
    }
  };

  const formatDisplayValue = (value: string) => {
    if (!value) return 'No limit';
    const num = parseFloat(value);
    if (isNaN(num)) return 'No limit';
    return `$${num.toLocaleString()}`;
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Spend Limits</h3>
        <AnimatePresence mode="wait">
          {hasChanges && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex items-center gap-1.5 text-xs text-accent-amber"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-accent-amber animate-pulse" />
              Unsaved changes
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <p className="text-sm text-foreground-muted mb-6">
        Set limits to protect yourself from accidental large transactions
      </p>

      <div className="space-y-6">
        {/* Per Transaction Limit */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium mb-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <DollarSign className="w-4 h-4 text-primary" />
            </div>
            <div>
              <div>Per Transaction Limit</div>
              <div className="text-xs text-foreground-muted font-normal">
                Maximum value for a single transaction
              </div>
            </div>
          </label>
          
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground-muted text-lg font-medium">$</span>
            <input
              type="number"
              value={perTxLimit}
              onChange={(e) => setPerTxLimit(e.target.value)}
              onFocus={() => setFocusedField('perTx')}
              onBlur={() => setFocusedField(null)}
              onKeyDown={handleKeyDown}
              placeholder="No limit"
              className={cn(
                'w-full pl-10 pr-4 py-3.5 bg-background border border-border rounded-xl',
                'text-foreground text-lg font-medium placeholder:text-foreground-subtle placeholder:font-normal',
                'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary',
                'transition-all duration-200'
              )}
            />
            {perTxLimit && (
              <button
                onClick={() => setPerTxLimit('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-foreground-subtle hover:text-foreground transition-colors"
              >
                <Infinity className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Quick presets */}
          <div className="flex flex-wrap gap-2 mt-3">
            {PRESETS.perTx.map((value) => (
              <button
                key={value}
                onClick={() => setPreset('perTx', value)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  perTxLimit === value.toString()
                    ? 'bg-primary text-white'
                    : 'bg-background-tertiary text-foreground-muted hover:bg-primary/10 hover:text-primary'
                )}
              >
                ${value.toLocaleString()}
              </button>
            ))}
            <button
              onClick={() => setPreset('perTx', null)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                !perTxLimit
                  ? 'bg-primary text-white'
                  : 'bg-background-tertiary text-foreground-muted hover:bg-primary/10 hover:text-primary'
              )}
            >
              No limit
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-border" />

        {/* Daily Limit */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium mb-3">
            <div className="w-8 h-8 rounded-lg bg-accent-amber/10 flex items-center justify-center">
              <Calendar className="w-4 h-4 text-accent-amber" />
            </div>
            <div>
              <div>Daily Limit</div>
              <div className="text-xs text-foreground-muted font-normal">
                Maximum total spend per 24 hours
              </div>
            </div>
          </label>
          
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground-muted text-lg font-medium">$</span>
            <input
              type="number"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              onFocus={() => setFocusedField('daily')}
              onBlur={() => setFocusedField(null)}
              onKeyDown={handleKeyDown}
              placeholder="No limit"
              className={cn(
                'w-full pl-10 pr-4 py-3.5 bg-background border border-border rounded-xl',
                'text-foreground text-lg font-medium placeholder:text-foreground-subtle placeholder:font-normal',
                'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary',
                'transition-all duration-200'
              )}
            />
            {dailyLimit && (
              <button
                onClick={() => setDailyLimit('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-foreground-subtle hover:text-foreground transition-colors"
              >
                <Infinity className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Quick presets */}
          <div className="flex flex-wrap gap-2 mt-3">
            {PRESETS.daily.map((value) => (
              <button
                key={value}
                onClick={() => setPreset('daily', value)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  dailyLimit === value.toString()
                    ? 'bg-primary text-white'
                    : 'bg-background-tertiary text-foreground-muted hover:bg-primary/10 hover:text-primary'
                )}
              >
                ${value.toLocaleString()}
              </button>
            ))}
            <button
              onClick={() => setPreset('daily', null)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                !dailyLimit
                  ? 'bg-primary text-white'
                  : 'bg-background-tertiary text-foreground-muted hover:bg-primary/10 hover:text-primary'
              )}
            >
              No limit
            </button>
          </div>
        </div>

        {/* Validation warning */}
        {perTxLimit && dailyLimit && parseFloat(perTxLimit) > parseFloat(dailyLimit) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="flex items-start gap-2 p-3 bg-accent-amber/10 border border-accent-amber/20 rounded-xl text-sm"
          >
            <AlertCircle className="w-4 h-4 text-accent-amber flex-shrink-0 mt-0.5" />
            <span className="text-accent-amber">
              Per-transaction limit is higher than daily limit. Consider adjusting.
            </span>
          </motion.div>
        )}

        {/* Save Button */}
        <AnimatePresence>
          {hasChanges && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
            >
              <Button
                onClick={handleSave}
                loading={isSaving || isLocalSaving}
                className="w-full"
                size="lg"
              >
                <Save className="w-4 h-4" />
                Save Changes
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Current limits summary */}
        {!hasChanges && (policy.maxPerTxUsd || policy.maxDailyUsd) && (
          <div className="flex items-center gap-2 p-3 bg-accent-emerald/10 border border-accent-emerald/20 rounded-xl text-sm">
            <Check className="w-4 h-4 text-accent-emerald" />
            <span className="text-accent-emerald">
              Limits active: {formatDisplayValue(policy.maxPerTxUsd?.toString() || '')} per tx, {formatDisplayValue(policy.maxDailyUsd?.toString() || '')} daily
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}
