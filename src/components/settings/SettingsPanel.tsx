'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Shield, 
  DollarSign, 
  Sliders, 
  AlertTriangle,
  Check,
  Loader2,
  Save,
} from 'lucide-react';
import { Card, Badge, Button, Slider } from '@/components/ui';
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

// Toast notification component
function Toast({ 
  message, 
  type, 
  isVisible 
}: { 
  message: string; 
  type: 'success' | 'error'; 
  isVisible: boolean;
}) {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          className={cn(
            'fixed bottom-6 left-1/2 -translate-x-1/2 z-50',
            'flex items-center gap-2 px-4 py-3 rounded-xl shadow-xl',
            'border backdrop-blur-sm',
            type === 'success' 
              ? 'bg-accent-emerald/90 border-accent-emerald/50 text-white' 
              : 'bg-accent-red/90 border-accent-red/50 text-white'
          )}
        >
          {type === 'success' ? (
            <Check className="w-4 h-4" />
          ) : (
            <AlertTriangle className="w-4 h-4" />
          )}
          <span className="text-sm font-medium">{message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function SettingsPanel({
  policy,
  network,
  onPolicyUpdate,
  onNetworkChange,
  className,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<'limits' | 'lists' | 'advanced'>('limits');
  
  // Local state for advanced settings - prevents refresh on every slider move
  const [localSlippage, setLocalSlippage] = useState(policy.maxSlippageBps);
  const [localLargeTxThreshold, setLocalLargeTxThreshold] = useState(policy.largeTransactionThresholdPct);
  const [localRequireVerified, setLocalRequireVerified] = useState(policy.requireVerifiedContracts);
  
  // Track saving state
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  
  // Toast state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const tabs = [
    { id: 'limits' as const, label: 'Spend Limits', icon: DollarSign },
    { id: 'lists' as const, label: 'Allow/Deny Lists', icon: Shield },
    { id: 'advanced' as const, label: 'Advanced', icon: Sliders },
  ];

  // Sync local state when policy changes from external source
  useEffect(() => {
    setLocalSlippage(policy.maxSlippageBps);
    setLocalLargeTxThreshold(policy.largeTransactionThresholdPct);
    setLocalRequireVerified(policy.requireVerifiedContracts);
    setHasUnsavedChanges(false);
  }, [policy.maxSlippageBps, policy.largeTransactionThresholdPct, policy.requireVerifiedContracts]);

  // Check for unsaved changes
  useEffect(() => {
    const hasChanges = 
      localSlippage !== policy.maxSlippageBps ||
      localLargeTxThreshold !== policy.largeTransactionThresholdPct ||
      localRequireVerified !== policy.requireVerifiedContracts;
    setHasUnsavedChanges(hasChanges);
  }, [localSlippage, localLargeTxThreshold, localRequireVerified, policy]);

  // Show toast
  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Save a single setting immediately (for toggles)
  const saveSettingImmediately = useCallback(async (updates: Partial<PolicyWithLists>) => {
    setIsSaving(true);
    try {
      await onPolicyUpdate(updates);
      showToast('Setting saved', 'success');
    } catch {
      showToast('Failed to save', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [onPolicyUpdate, showToast]);

  // Save slider value on release
  const handleSlippageChangeEnd = useCallback(async (value: number) => {
    if (value === policy.maxSlippageBps) return;
    
    setIsSaving(true);
    try {
      await onPolicyUpdate({ maxSlippageBps: value });
      showToast('Slippage saved', 'success');
    } catch {
      showToast('Failed to save', 'error');
      setLocalSlippage(policy.maxSlippageBps);
    } finally {
      setIsSaving(false);
    }
  }, [policy.maxSlippageBps, onPolicyUpdate, showToast]);

  const handleLargeTxThresholdChangeEnd = useCallback(async (value: number) => {
    if (value === policy.largeTransactionThresholdPct) return;
    
    setIsSaving(true);
    try {
      await onPolicyUpdate({ largeTransactionThresholdPct: value });
      showToast('Threshold saved', 'success');
    } catch {
      showToast('Failed to save', 'error');
      setLocalLargeTxThreshold(policy.largeTransactionThresholdPct);
    } finally {
      setIsSaving(false);
    }
  }, [policy.largeTransactionThresholdPct, onPolicyUpdate, showToast]);

  // Handle verified contracts toggle
  const handleVerifiedContractsToggle = useCallback(async () => {
    const newValue = !localRequireVerified;
    setLocalRequireVerified(newValue);
    await saveSettingImmediately({ requireVerifiedContracts: newValue });
  }, [localRequireVerified, saveSettingImmediately]);

  const handleSecurityLevelChange = async (level: SecurityLevel) => {
    setIsSaving(true);
    try {
      await onPolicyUpdate({ securityLevel: level });
      showToast('Security level updated', 'success');
    } catch {
      showToast('Failed to update', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Get slippage variant based on value
  const getSlippageVariant = () => {
    if (localSlippage <= 100) return 'success';
    if (localSlippage <= 300) return 'default';
    if (localSlippage <= 500) return 'warning';
    return 'danger';
  };

  return (
    <>
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
        <div className="flex gap-2 border-b border-border pb-4 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap',
                activeTab === tab.id
                  ? 'bg-primary text-white shadow-lg shadow-primary/25'
                  : 'text-foreground-muted hover:bg-background-tertiary hover:text-foreground'
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
              showToast={showToast}
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
            <div className="space-y-4">
              <Card>
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-semibold">Advanced Settings</h3>
                  {isSaving && (
                    <div className="flex items-center gap-2 text-primary text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </div>
                  )}
                </div>
                
                <div className="space-y-6">
                  {/* Require Verified Contracts (NORMAL mode only) */}
                  {policy.securityLevel === 'NORMAL' && (
                    <div className="flex items-center justify-between p-4 bg-background rounded-xl border border-border/50">
                      <div className="pr-4">
                        <div className="font-medium text-sm">Require Verified Contracts</div>
                        <div className="text-xs text-foreground-muted mt-0.5">
                          Block all interactions with unverified contracts
                        </div>
                      </div>
                      <button
                        onClick={handleVerifiedContractsToggle}
                        disabled={isSaving}
                        className={cn(
                          'relative w-14 h-8 rounded-full transition-colors flex-shrink-0',
                          'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background-secondary',
                          localRequireVerified ? 'bg-primary' : 'bg-border',
                          isSaving && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        <motion.div
                          className="absolute top-1 w-6 h-6 rounded-full bg-white shadow-md"
                          animate={{ left: localRequireVerified ? 30 : 4 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      </button>
                    </div>
                  )}

                  {/* Large Transaction Warning Threshold (NORMAL mode only) */}
                  {policy.securityLevel === 'NORMAL' && (
                    <div className="p-4 bg-background rounded-xl border border-border/50">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <div className="font-medium text-sm">Large Transaction Warning</div>
                          <div className="text-xs text-foreground-muted mt-0.5">
                            Warn when moving more than this % of token balance
                          </div>
                        </div>
                        <Badge variant="secondary" className="text-base font-semibold px-3 py-1">
                          {localLargeTxThreshold}%
                        </Badge>
                      </div>
                      <Slider
                        value={localLargeTxThreshold}
                        min={10}
                        max={100}
                        step={5}
                        onChange={setLocalLargeTxThreshold}
                        onChangeEnd={handleLargeTxThresholdChangeEnd}
                        formatLabel={(v) => `${v}%`}
                        minLabel="10%"
                        maxLabel="100%"
                        variant="warning"
                        disabled={isSaving}
                      />
                    </div>
                  )}

                  {/* Max slippage */}
                  <div className="p-4 bg-background rounded-xl border border-border/50">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="font-medium text-sm">Max Slippage</div>
                        <div className="text-xs text-foreground-muted mt-0.5">
                          Maximum allowed slippage for swaps
                        </div>
                      </div>
                      <Badge 
                        variant="secondary" 
                        className={cn(
                          'text-base font-semibold px-3 py-1 transition-colors',
                          localSlippage > 500 && 'bg-accent-red/20 text-accent-red',
                          localSlippage > 300 && localSlippage <= 500 && 'bg-accent-amber/20 text-accent-amber',
                        )}
                      >
                        {(localSlippage / 100).toFixed(1)}%
                      </Badge>
                    </div>
                    <Slider
                      value={localSlippage}
                      min={10}
                      max={1000}
                      step={10}
                      onChange={setLocalSlippage}
                      onChangeEnd={handleSlippageChangeEnd}
                      formatLabel={(v) => `${(v / 100).toFixed(1)}%`}
                      minLabel="0.1%"
                      maxLabel="10%"
                      variant={getSlippageVariant()}
                      disabled={isSaving}
                    />
                    {localSlippage > 500 && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="flex items-center gap-2 mt-3 text-xs text-accent-amber"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        High slippage may result in worse trade outcomes
                      </motion.div>
                    )}
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
            </div>
          )}
        </motion.div>
      </div>

      {/* Toast Notification */}
      <Toast 
        message={toast?.message ?? ''} 
        type={toast?.type ?? 'success'} 
        isVisible={!!toast} 
      />
    </>
  );
}
