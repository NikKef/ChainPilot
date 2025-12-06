'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, Shield, ShieldOff, Check, AlertTriangle, Loader2 } from 'lucide-react';
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
    if (level === value || isChanging) return;

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
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-semibold">Security Level</h3>
            <p className="text-sm text-foreground-muted">
              Choose how strictly transactions are validated
            </p>
          </div>
          {isChanging && (
            <div className="flex items-center gap-2 text-primary text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Updating...
            </div>
          )}
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
                whileHover={!isChanging ? { scale: 1.02 } : undefined}
                whileTap={!isChanging ? { scale: 0.98 } : undefined}
                className={cn(
                  'relative p-4 rounded-xl border-2 text-left transition-all',
                  'focus:outline-none focus:ring-2 focus:ring-primary/50',
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-background hover:border-primary/40 hover:bg-background-secondary',
                  isChanging && 'opacity-60 cursor-not-allowed'
                )}
              >
                {/* Selected indicator */}
                <AnimatePresence>
                  {isSelected && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0 }}
                      className="absolute top-3 right-3 w-6 h-6 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/30"
                    >
                      <Check className="w-3.5 h-3.5 text-white" />
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className={cn(
                  'w-12 h-12 rounded-xl flex items-center justify-center mb-3 transition-colors',
                  level === 'STRICT' && (isSelected ? 'bg-accent-red/20' : 'bg-accent-red/10'),
                  level === 'NORMAL' && (isSelected ? 'bg-accent-amber/20' : 'bg-accent-amber/10'),
                  level === 'PERMISSIVE' && (isSelected ? 'bg-accent-green/20' : 'bg-accent-green/10'),
                )}>
                  <Icon className={cn(
                    'w-6 h-6',
                    level === 'STRICT' && 'text-accent-red',
                    level === 'NORMAL' && 'text-accent-amber',
                    level === 'PERMISSIVE' && 'text-accent-green',
                  )} />
                </div>

                <div className="font-semibold mb-1.5">{config.label}</div>
                <div className="text-xs text-foreground-muted leading-relaxed">
                  {config.description}
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* Current level explanation */}
        <motion.div 
          layout
          className={cn(
            'mt-5 p-4 rounded-xl transition-colors',
            value === 'STRICT' && 'bg-accent-red/10 border border-accent-red/20',
            value === 'NORMAL' && 'bg-accent-amber/10 border border-accent-amber/20',
            value === 'PERMISSIVE' && 'bg-accent-green/10 border border-accent-green/20',
          )}
        >
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
        </motion.div>
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
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-background-secondary border border-border rounded-2xl p-6 max-w-md w-full shadow-2xl"
            >
              <div className="flex items-start gap-4 mb-5">
                <div className="w-14 h-14 rounded-xl bg-accent-amber/20 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-7 h-7 text-accent-amber" />
                </div>
                <div>
                  <h3 className="text-xl font-bold mb-1">Enable Permissive Mode?</h3>
                  <p className="text-sm text-foreground-muted">
                    This will disable most security protections.
                  </p>
                </div>
              </div>

              <div className="bg-accent-amber/10 border border-accent-amber/20 rounded-xl p-4 mb-6">
                <ul className="text-sm space-y-2.5">
                  <li className="flex items-start gap-2">
                    <span className="text-accent-amber mt-0.5">•</span>
                    <span>Deny lists will be ignored</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-accent-amber mt-0.5">•</span>
                    <span>No warnings for risky transactions</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-accent-amber mt-0.5">•</span>
                    <span>Unverified contracts will be allowed without warning</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-accent-amber mt-0.5">•</span>
                    <span>Only spend caps will be enforced</span>
                  </li>
                </ul>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  onClick={cancelPermissive}
                  className="flex-1"
                  size="lg"
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={confirmPermissive}
                  loading={isChanging}
                  className="flex-1"
                  size="lg"
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
