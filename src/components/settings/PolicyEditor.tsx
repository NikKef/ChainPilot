'use client';

import { useState, useEffect } from 'react';
import { DollarSign, Calendar, Save } from 'lucide-react';
import { Card, Button, Input } from '@/components/ui';
import type { PolicyWithLists } from '@/lib/types';
import { cn } from '@/lib/utils';

interface PolicyEditorProps {
  policy: PolicyWithLists;
  onUpdate: (updates: Partial<PolicyWithLists>) => Promise<void>;
  isSaving?: boolean;
}

export function PolicyEditor({ policy, onUpdate, isSaving }: PolicyEditorProps) {
  const [perTxLimit, setPerTxLimit] = useState(policy.maxPerTxUsd?.toString() || '');
  const [dailyLimit, setDailyLimit] = useState(policy.maxDailyUsd?.toString() || '');
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    const perTxChanged = perTxLimit !== (policy.maxPerTxUsd?.toString() || '');
    const dailyChanged = dailyLimit !== (policy.maxDailyUsd?.toString() || '');
    setHasChanges(perTxChanged || dailyChanged);
  }, [perTxLimit, dailyLimit, policy]);

  const handleSave = async () => {
    await onUpdate({
      maxPerTxUsd: perTxLimit ? parseFloat(perTxLimit) : null,
      maxDailyUsd: dailyLimit ? parseFloat(dailyLimit) : null,
    });
    setHasChanges(false);
  };

  return (
    <Card>
      <h3 className="font-semibold mb-4">Spend Limits</h3>
      <p className="text-sm text-foreground-muted mb-6">
        Set limits to protect yourself from accidental large transactions
      </p>

      <div className="space-y-4">
        {/* Per Transaction Limit */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium mb-2">
            <DollarSign className="w-4 h-4 text-foreground-muted" />
            Per Transaction Limit (USD)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted">$</span>
            <input
              type="number"
              value={perTxLimit}
              onChange={(e) => setPerTxLimit(e.target.value)}
              placeholder="No limit"
              className={cn(
                'w-full pl-8 pr-4 py-3 bg-background-secondary border border-border rounded-lg',
                'text-foreground placeholder:text-foreground-subtle',
                'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary',
                'transition-all duration-200'
              )}
            />
          </div>
          <p className="text-xs text-foreground-subtle mt-1">
            Maximum value for a single transaction
          </p>
        </div>

        {/* Daily Limit */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium mb-2">
            <Calendar className="w-4 h-4 text-foreground-muted" />
            Daily Limit (USD)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted">$</span>
            <input
              type="number"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              placeholder="No limit"
              className={cn(
                'w-full pl-8 pr-4 py-3 bg-background-secondary border border-border rounded-lg',
                'text-foreground placeholder:text-foreground-subtle',
                'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary',
                'transition-all duration-200'
              )}
            />
          </div>
          <p className="text-xs text-foreground-subtle mt-1">
            Maximum total spend per day
          </p>
        </div>

        {/* Save Button */}
        {hasChanges && (
          <Button
            onClick={handleSave}
            loading={isSaving}
            className="w-full mt-4"
          >
            <Save className="w-4 h-4" />
            Save Changes
          </Button>
        )}
      </div>
    </Card>
  );
}

