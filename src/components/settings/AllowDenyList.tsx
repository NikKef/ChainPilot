'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Shield, Ban, Coins, FileCode, Info } from 'lucide-react';
import { Card, Button, Input, Badge } from '@/components/ui';
import type { PolicyWithLists, SecurityLevel } from '@/lib/types';
import { truncateAddress } from '@/lib/utils/formatting';
import { isValidAddress } from '@/lib/utils/validation';
import { cn } from '@/lib/utils';

interface AllowDenyListProps {
  policy: PolicyWithLists;
  onUpdate: (updates: Partial<PolicyWithLists>) => Promise<void>;
  securityLevel?: SecurityLevel;
}

type ListType = 'allowedTokens' | 'deniedTokens' | 'allowedContracts' | 'deniedContracts';

export function AllowDenyList({ policy, onUpdate, securityLevel = 'NORMAL' }: AllowDenyListProps) {
  const [activeList, setActiveList] = useState<ListType>('allowedTokens');
  const [newAddress, setNewAddress] = useState('');
  const [error, setError] = useState('');

  const lists: Array<{
    id: ListType;
    label: string;
    icon: React.ElementType;
    type: 'allow' | 'deny';
    category: 'token' | 'contract';
  }> = [
    { id: 'allowedTokens', label: 'Allowed Tokens', icon: Shield, type: 'allow', category: 'token' },
    { id: 'deniedTokens', label: 'Denied Tokens', icon: Ban, type: 'deny', category: 'token' },
    { id: 'allowedContracts', label: 'Allowed Contracts', icon: Shield, type: 'allow', category: 'contract' },
    { id: 'deniedContracts', label: 'Denied Contracts', icon: Ban, type: 'deny', category: 'contract' },
  ];

  const currentList = lists.find(l => l.id === activeList)!;
  const addresses = policy[activeList];

  const handleAdd = async () => {
    setError('');

    if (!newAddress) {
      setError('Address is required');
      return;
    }

    if (!isValidAddress(newAddress)) {
      setError('Invalid address format');
      return;
    }

    const normalizedAddress = newAddress.toLowerCase();
    if (addresses.some(a => a.toLowerCase() === normalizedAddress)) {
      setError('Address already in list');
      return;
    }

    await onUpdate({
      [activeList]: [...addresses, newAddress],
    });

    setNewAddress('');
  };

  const handleRemove = async (address: string) => {
    await onUpdate({
      [activeList]: addresses.filter(a => a.toLowerCase() !== address.toLowerCase()),
    });
  };

  // Get contextual help text based on security level
  const getSecurityLevelContext = () => {
    const isAllowList = currentList.type === 'allow';
    
    if (securityLevel === 'STRICT') {
      if (isAllowList) {
        return {
          type: 'info' as const,
          message: `In Strict mode, only addresses in allow lists can be used. Add your trusted ${currentList.category}s here.`,
        };
      } else {
        return {
          type: 'muted' as const,
          message: `Deny lists are also checked in Strict mode for extra protection.`,
        };
      }
    } else if (securityLevel === 'NORMAL') {
      if (isAllowList) {
        return {
          type: 'muted' as const,
          message: `Allow lists are optional in Normal mode. Addresses here skip verification warnings.`,
        };
      } else {
        return {
          type: 'warning' as const,
          message: `${currentList.category.charAt(0).toUpperCase() + currentList.category.slice(1)}s in this list will be blocked.`,
        };
      }
    } else {
      return {
        type: 'warning' as const,
        message: `Lists are ignored in Permissive mode. Switch to Normal or Strict to enforce them.`,
      };
    }
  };

  const contextInfo = getSecurityLevelContext();

  return (
    <Card>
      {/* Security Level Context */}
      <div className={cn(
        'flex items-start gap-2 p-3 rounded-lg mb-4 text-sm',
        contextInfo.type === 'info' && 'bg-primary/10 text-primary',
        contextInfo.type === 'warning' && 'bg-accent-amber/10 text-accent-amber',
        contextInfo.type === 'muted' && 'bg-background text-foreground-muted',
      )}>
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>{contextInfo.message}</span>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {lists.map((list) => (
          <button
            key={list.id}
            onClick={() => setActiveList(list.id)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors',
              activeList === list.id
                ? list.type === 'allow'
                  ? 'bg-accent-emerald/20 text-accent-emerald'
                  : 'bg-risk-high/20 text-risk-high'
                : 'text-foreground-muted hover:bg-background-tertiary',
              // Dim deny lists in PERMISSIVE mode
              securityLevel === 'PERMISSIVE' && 'opacity-50',
            )}
          >
            <list.icon className="w-4 h-4" />
            {list.label}
            <Badge variant="secondary" className="ml-1 text-xs">
              {policy[list.id].length}
            </Badge>
          </button>
        ))}
      </div>

      {/* Add new address */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1">
          <Input
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder={`Add ${currentList.category} address (0x...)`}
            error={error}
          />
        </div>
        <Button onClick={handleAdd}>
          <Plus className="w-4 h-4" />
          Add
        </Button>
      </div>

      {/* Address list */}
      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {addresses.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-8 text-foreground-muted"
            >
              <div className="w-12 h-12 rounded-full bg-background-tertiary flex items-center justify-center mx-auto mb-3">
                {currentList.category === 'token' ? (
                  <Coins className="w-6 h-6" />
                ) : (
                  <FileCode className="w-6 h-6" />
                )}
              </div>
              <p className="text-sm">No {currentList.category}s in this list</p>
            </motion.div>
          ) : (
            addresses.map((address, index) => (
              <motion.div
                key={address}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ delay: index * 0.05 }}
                className="flex items-center justify-between p-3 bg-background rounded-lg group"
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center',
                    currentList.type === 'allow' 
                      ? 'bg-accent-emerald/20' 
                      : 'bg-risk-high/20'
                  )}>
                    {currentList.category === 'token' ? (
                      <Coins className={cn(
                        'w-4 h-4',
                        currentList.type === 'allow' ? 'text-accent-emerald' : 'text-risk-high'
                      )} />
                    ) : (
                      <FileCode className={cn(
                        'w-4 h-4',
                        currentList.type === 'allow' ? 'text-accent-emerald' : 'text-risk-high'
                      )} />
                    )}
                  </div>
                  <span className="font-mono text-sm">{truncateAddress(address, 10, 8)}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemove(address)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8"
                >
                  <Trash2 className="w-4 h-4 text-risk-high" />
                </Button>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </Card>
  );
}

