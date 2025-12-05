'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Shield, 
  DollarSign, 
  Sliders, 
  AlertTriangle,
} from 'lucide-react';
import { Card, Badge } from '@/components/ui';
import { NetworkToggle } from '@/components/layout';
import { PolicyEditor } from './PolicyEditor';
import { AllowDenyList } from './AllowDenyList';
import { SecurityLevelSelector } from './SecurityLevelSelector';
import type { PolicyWithLists, NetworkType, SecurityLevel } from '@/lib/types';
import { cn } from '@/lib/utils';

interface SettingsPanelProps {
  policy: PolicyWithLists;
  network: NetworkType;
  onPolicyUpdate: (updates: Partial<PolicyWithLists>) => Promise<void>;
  onNetworkChange: (network: NetworkType) => void;
  className?: string;
}

export function SettingsPanel({
  policy,
  network,
  onPolicyUpdate,
  onNetworkChange,
  className,
}: SettingsPanelProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'limits' | 'lists' | 'advanced'>('limits');

  const tabs = [
    { id: 'limits' as const, label: 'Spend Limits', icon: DollarSign },
    { id: 'lists' as const, label: 'Allow/Deny Lists', icon: Shield },
    { id: 'advanced' as const, label: 'Advanced', icon: Sliders },
  ];

  const handleSecurityLevelChange = async (level: SecurityLevel) => {
    await onPolicyUpdate({ securityLevel: level });
  };

  return (
    <div className={cn('space-y-6', className)}>
      {/* Network Toggle */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold mb-1">Network</h3>
            <p className="text-sm text-foreground-muted">
              Select which network to use for transactions
            </p>
          </div>
          <NetworkToggle network={network} onChange={onNetworkChange} />
        </div>
      </Card>

      {/* Security Level Selector */}
      <SecurityLevelSelector
        value={policy.securityLevel}
        onChange={handleSecurityLevelChange}
      />

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              activeTab === tab.id
                ? 'bg-primary text-white'
                : 'text-foreground-muted hover:bg-background-tertiary'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {activeTab === 'limits' && (
          <PolicyEditor 
            policy={policy} 
            onUpdate={onPolicyUpdate}
            isSaving={isSaving}
          />
        )}

        {activeTab === 'lists' && (
          <AllowDenyList 
            policy={policy} 
            onUpdate={onPolicyUpdate}
            securityLevel={policy.securityLevel}
          />
        )}

        {activeTab === 'advanced' && (
          <Card>
            <h3 className="font-semibold mb-4">Advanced Settings</h3>
            
            <div className="space-y-4">
              {/* Require Verified Contracts (NORMAL mode only) */}
              {policy.securityLevel === 'NORMAL' && (
              <div className="flex items-center justify-between p-4 bg-background rounded-xl">
                <div>
                    <div className="font-medium text-sm">Require Verified Contracts</div>
                  <div className="text-xs text-foreground-muted">
                      Block all interactions with unverified contracts
                  </div>
                </div>
                <button
                  onClick={() => onPolicyUpdate({ 
                      requireVerifiedContracts: !policy.requireVerifiedContracts 
                  })}
                  className={cn(
                    'relative w-12 h-6 rounded-full transition-colors',
                      policy.requireVerifiedContracts ? 'bg-primary' : 'bg-border'
                  )}
                >
                  <motion.div
                    className="absolute top-1 w-4 h-4 rounded-full bg-white"
                      animate={{ left: policy.requireVerifiedContracts ? 28 : 4 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                </button>
              </div>
              )}

              {/* Large Transaction Warning Threshold (NORMAL mode only) */}
              {policy.securityLevel === 'NORMAL' && (
                <div className="p-4 bg-background rounded-xl">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="font-medium text-sm">Large Transaction Warning</div>
                      <div className="text-xs text-foreground-muted">
                        Warn when moving more than this % of token balance
                      </div>
                    </div>
                    <Badge variant="secondary">
                      {policy.largeTransactionThresholdPct}%
                    </Badge>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="5"
                    value={policy.largeTransactionThresholdPct}
                    onChange={(e) => onPolicyUpdate({ 
                      largeTransactionThresholdPct: parseInt(e.target.value) 
                    })}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-xs text-foreground-subtle mt-1">
                    <span>10%</span>
                    <span>100%</span>
                  </div>
                </div>
              )}

              {/* Max slippage */}
              <div className="p-4 bg-background rounded-xl">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="font-medium text-sm">Max Slippage</div>
                    <div className="text-xs text-foreground-muted">
                      Maximum allowed slippage for swaps
                    </div>
                  </div>
                  <Badge variant="secondary">
                    {(policy.maxSlippageBps / 100).toFixed(1)}%
                  </Badge>
                </div>
                <input
                  type="range"
                  min="10"
                  max="1000"
                  step="10"
                  value={policy.maxSlippageBps}
                  onChange={(e) => onPolicyUpdate({ 
                    maxSlippageBps: parseInt(e.target.value) 
                  })}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-xs text-foreground-subtle mt-1">
                  <span>0.1%</span>
                  <span>10%</span>
                </div>
              </div>

              {/* Security level specific notes */}
              {policy.securityLevel === 'STRICT' && (
                <div className="p-4 bg-accent-red/10 border border-accent-red/20 rounded-xl">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-accent-red flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <strong className="text-accent-red">Strict Mode:</strong>{' '}
                      Only whitelisted tokens and contracts are allowed. 
                      Make sure to add your frequently used addresses to the allow lists.
                    </div>
                  </div>
                </div>
              )}

              {policy.securityLevel === 'PERMISSIVE' && (
                <div className="p-4 bg-accent-amber/10 border border-accent-amber/20 rounded-xl">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-accent-amber flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <strong className="text-accent-amber">Permissive Mode:</strong>{' '}
                      Most security checks are disabled. Only spend caps are enforced. 
                      You accept full responsibility for your transactions.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}
      </motion.div>
    </div>
  );
}

