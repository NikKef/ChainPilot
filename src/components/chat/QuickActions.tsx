'use client';

import { motion } from 'framer-motion';
import { 
  Search, 
  Code, 
  Shield, 
  ArrowLeftRight, 
  Send,
  Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuickActionsProps {
  onAction: (action: string) => void;
  className?: string;
}

const quickActions = [
  {
    icon: Search,
    label: 'Research',
    action: 'What is the current state of DeFi on BNB Chain?',
    color: 'text-accent-cyan',
    bgColor: 'bg-accent-cyan/10 hover:bg-accent-cyan/20',
  },
  {
    icon: Code,
    label: 'Generate Contract',
    action: 'Create a simple ERC20 token contract',
    color: 'text-primary',
    bgColor: 'bg-primary/10 hover:bg-primary/20',
  },
  {
    icon: Shield,
    label: 'Audit Contract',
    action: 'Audit a smart contract for security issues',
    color: 'text-accent-emerald',
    bgColor: 'bg-accent-emerald/10 hover:bg-accent-emerald/20',
  },
  {
    icon: ArrowLeftRight,
    label: 'Swap Tokens',
    action: 'Swap 10 USDT to BNB on testnet',
    color: 'text-accent-amber',
    bgColor: 'bg-accent-amber/10 hover:bg-accent-amber/20',
  },
];

export function QuickActions({ onAction, className }: QuickActionsProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 max-w-md mx-auto', className)}>
      {quickActions.map((action, index) => (
        <motion.button
          key={action.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
          onClick={() => onAction(action.action)}
          className={cn(
            'flex items-center gap-3 p-4 rounded-xl border border-border',
            'transition-all duration-200',
            action.bgColor
          )}
        >
          <action.icon className={cn('w-5 h-5', action.color)} />
          <span className="text-sm font-medium">{action.label}</span>
        </motion.button>
      ))}
    </div>
  );
}

