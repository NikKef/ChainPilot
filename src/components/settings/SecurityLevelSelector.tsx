'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, Shield, ShieldOff, Check, AlertTriangle } from 'lucide-react';
import { Card, Button } from '@/components/ui';
import type { SecurityLevel } from '@/lib/types';
import { SECURITY_LEVELS } from '@/lib/types';
import { cn } from '@/lib/utils';

interface SecurityLevelSelectorProps {
  value: SecurityLevel;
  onChange: (level: SecurityLevel) => Promise<void>;
  className?: string;
}

const icons = {
  'shield-alert': ShieldAlert,
  'shield': Shield,
  'shield-off': ShieldOff,
};

export function SecurityLevelSelector({
  value,
  onChange,
  className,
}: SecurityLevelSelectorProps) {
  const [isChanging, setIsChanging] = useState(false);
  const [showPermissiveWarning, setShowPermissiveWarning] = useState(false);
  const [pendingLevel, setPendingLevel] = useState<SecurityLevel | null>(null);

  const handleSelect = async (level: SecurityLevel) => {
    if (level === value) return;

    // Show warning when switching to PERMISSIVE
    if (level === 'PERMISSIVE') {
      setPendingLevel(level);
      setShowPermissiveWarning(true);
      return;
    }

    setIsChanging(true);
    try {
      await onChange(level);
    } finally {
      setIsChanging(false);
    }
  };

  const confirmPermissive = async () => {
    if (!pendingLevel) return;
    
    setShowPermissiveWarning(false);
    setIsChanging(true);
    try {
      await onChange(pendingLevel);
    } finally {
      setIsChanging(false);
      setPendingLevel(null);
    }
  };

  const cancelPermissive = () => {
    setShowPermissiveWarning(false);
    setPendingLevel(null);
  };

  return (
    <>
      <Card className={className}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">Security Level</h3>
            <p className="text-sm text-foreground-muted">
              Choose how strictly transactions are validated
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(Object.keys(SECURITY_LEVELS) as SecurityLevel[]).map((level) => {
            const config = SECURITY_LEVELS[level];
            const Icon = icons[config.icon];
            const isSelected = value === level;

            return (
              <motion.button
                key={level}
                onClick={() => handleSelect(level)}
                disabled={isChanging}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={cn(
                  'relative p-4 rounded-xl border-2 text-left transition-all',
                  'focus:outline-none focus:ring-2 focus:ring-primary/50',
                  isSelected
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-background-secondary hover:border-primary/50',
                  isChanging && 'opacity-50 cursor-not-allowed'
                )}
              >
                {/* Selected indicator */}
                {isSelected && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center"
                  >
                    <Check className="w-3 h-3 text-white" />
                  </motion.div>
                )}

                <div className={cn(
                  'w-10 h-10 rounded-lg flex items-center justify-center mb-3',
                  level === 'STRICT' && 'bg-accent-red/20',
                  level === 'NORMAL' && 'bg-accent-amber/20',
                  level === 'PERMISSIVE' && 'bg-accent-green/20',
                )}>
                  <Icon className={cn(
                    'w-5 h-5',
                    level === 'STRICT' && 'text-accent-red',
                    level === 'NORMAL' && 'text-accent-amber',
                    level === 'PERMISSIVE' && 'text-accent-green',
                  )} />
                </div>

                <div className="font-semibold mb-1">{config.label}</div>
                <div className="text-xs text-foreground-muted leading-relaxed">
                  {config.description}
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* Current level explanation */}
        <div className={cn(
          'mt-4 p-4 rounded-xl',
          value === 'STRICT' && 'bg-accent-red/10 border border-accent-red/20',
          value === 'NORMAL' && 'bg-accent-amber/10 border border-accent-amber/20',
          value === 'PERMISSIVE' && 'bg-accent-green/10 border border-accent-green/20',
        )}>
          <div className="text-sm">
            {value === 'STRICT' && (
              <>
                <strong className="text-accent-red">Strict Mode Active:</strong>{' '}
                Only tokens and contracts you&apos;ve explicitly added to your allow lists will work. 
                All other transactions will be blocked.
              </>
            )}
            {value === 'NORMAL' && (
              <>
                <strong className="text-accent-amber">Normal Mode Active:</strong>{' '}
                Transactions are allowed unless explicitly denied. You&apos;ll see warnings for 
                unverified contracts, large transactions, and other risky patterns.
              </>
            )}
            {value === 'PERMISSIVE' && (
              <>
                <strong className="text-accent-green">Permissive Mode Active:</strong>{' '}
                All transactions proceed without warnings. Deny lists are ignored. 
                Only spend caps are enforced.
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Permissive mode warning modal */}
      <AnimatePresence>
        {showPermissiveWarning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={cancelPermissive}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-background-secondary border border-border rounded-2xl p-6 max-w-md w-full"
            >
              <div className="flex items-start gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-accent-amber/20 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-6 h-6 text-accent-amber" />
                </div>
                <div>
                  <h3 className="text-lg font-bold mb-1">Enable Permissive Mode?</h3>
                  <p className="text-sm text-foreground-muted">
                    This will disable most security protections.
                  </p>
                </div>
              </div>

              <div className="bg-accent-amber/10 border border-accent-amber/20 rounded-xl p-4 mb-6">
                <ul className="text-sm space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-accent-amber">•</span>
                    <span>Deny lists will be ignored</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-accent-amber">•</span>
                    <span>No warnings for risky transactions</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-accent-amber">•</span>
                    <span>Unverified contracts will be allowed without warning</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-accent-amber">•</span>
                    <span>Only spend caps will be enforced</span>
                  </li>
                </ul>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  onClick={cancelPermissive}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={confirmPermissive}
                  loading={isChanging}
                  className="flex-1"
                >
                  I Understand, Enable
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

