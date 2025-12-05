'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface NetworkToggleProps {
  network: 'testnet' | 'mainnet';
  onChange?: (network: 'testnet' | 'mainnet') => void;
  disabled?: boolean;
}

export function NetworkToggle({ network, onChange, disabled }: NetworkToggleProps) {
  const handleToggle = () => {
    if (disabled) return;
    onChange?.(network === 'testnet' ? 'mainnet' : 'testnet');
  };

  return (
    <button
      onClick={handleToggle}
      disabled={disabled}
      className={cn(
        'relative flex items-center h-8 px-1 rounded-full bg-background-secondary border border-border transition-colors',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <div className="relative flex items-center">
        {/* Background indicator */}
        <motion.div
          className={cn(
            'absolute h-6 rounded-full',
            network === 'testnet' 
              ? 'bg-accent-amber/20 w-[4.5rem]' 
              : 'bg-accent-emerald/20 w-[4.5rem]'
          )}
          animate={{
            x: network === 'testnet' ? 0 : '4.5rem',
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />

        {/* Testnet */}
        <div
          className={cn(
            'relative z-10 px-3 py-1 text-xs font-medium transition-colors',
            network === 'testnet' ? 'text-accent-amber' : 'text-foreground-subtle'
          )}
        >
          Testnet
        </div>

        {/* Mainnet */}
        <div
          className={cn(
            'relative z-10 px-3 py-1 text-xs font-medium transition-colors',
            network === 'mainnet' ? 'text-accent-emerald' : 'text-foreground-subtle'
          )}
        >
          Mainnet
        </div>
      </div>

      {/* Status dot */}
      <div
        className={cn(
          'ml-1 w-2 h-2 rounded-full',
          network === 'testnet' ? 'bg-accent-amber' : 'bg-accent-emerald'
        )}
      />
    </button>
  );
}

