'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Shield, Ban, Coins, FileCode, Info, Check, Loader2, Copy, ExternalLink } from 'lucide-react';
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
  const [isAdding, setIsAdding] = useState(false);
  const [removingAddress, setRemovingAddress] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const lists: Array<{
    id: ListType;
    label: string;
    shortLabel: string;
    icon: React.ElementType;
    type: 'allow' | 'deny';
    category: 'token' | 'contract';
  }> = [
    { id: 'allowedTokens', label: 'Allowed Tokens', shortLabel: 'Allow', icon: Shield, type: 'allow', category: 'token' },
    { id: 'deniedTokens', label: 'Denied Tokens', shortLabel: 'Deny', icon: Ban, type: 'deny', category: 'token' },
    { id: 'allowedContracts', label: 'Allowed Contracts', shortLabel: 'Allow', icon: Shield, type: 'allow', category: 'contract' },
    { id: 'deniedContracts', label: 'Denied Contracts', shortLabel: 'Deny', icon: Ban, type: 'deny', category: 'contract' },
  ];

  const currentList = lists.find(l => l.id === activeList)!;
  const addresses = policy[activeList];

  const handleCopyAddress = useCallback(async (address: string) => {
    await navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    setTimeout(() => setCopiedAddress(null), 2000);
  }, []);

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

    setIsAdding(true);
    try {
      await onUpdate({
        [activeList]: [...addresses, newAddress],
      });
      setNewAddress('');
    } catch {
      setError('Failed to add address');
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemove = async (address: string) => {
    setRemovingAddress(address);
    try {
      await onUpdate({
        [activeList]: addresses.filter(a => a.toLowerCase() !== address.toLowerCase()),
      });
    } catch {
      // Silently fail, address stays
    } finally {
      setRemovingAddress(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newAddress && !isAdding) {
      handleAdd();
    }
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
        'flex items-start gap-2 p-3 rounded-xl mb-5 text-sm',
        contextInfo.type === 'info' && 'bg-primary/10 text-primary',
        contextInfo.type === 'warning' && 'bg-accent-amber/10 text-accent-amber',
        contextInfo.type === 'muted' && 'bg-background text-foreground-muted',
      )}>
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>{contextInfo.message}</span>
      </div>

      {/* Category Selector */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setActiveList(activeList.includes('Token') ? 'allowedTokens' : 'allowedContracts')}
          className={cn(
            'flex-1 py-2.5 rounded-xl text-sm font-medium transition-all',
            activeList.includes('Token')
              ? 'bg-primary text-white shadow-lg shadow-primary/25'
              : 'bg-background-tertiary text-foreground-muted hover:bg-primary/10 hover:text-primary'
          )}
        >
          <Coins className="w-4 h-4 inline-block mr-1.5" />
          Tokens
        </button>
        <button
          onClick={() => setActiveList(activeList.includes('Contract') ? 'allowedContracts' : 'deniedContracts')}
          className={cn(
            'flex-1 py-2.5 rounded-xl text-sm font-medium transition-all',
            activeList.includes('Contract')
              ? 'bg-primary text-white shadow-lg shadow-primary/25'
              : 'bg-background-tertiary text-foreground-muted hover:bg-primary/10 hover:text-primary'
          )}
        >
          <FileCode className="w-4 h-4 inline-block mr-1.5" />
          Contracts
        </button>
      </div>

      {/* Allow/Deny Toggle */}
      <div className="flex gap-2 mb-6">
        {lists
          .filter(l => l.category === (activeList.includes('Token') ? 'token' : 'contract'))
          .map((list) => (
          <button
            key={list.id}
            onClick={() => setActiveList(list.id)}
            className={cn(
              'flex items-center justify-center gap-2 flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border-2',
              activeList === list.id
                ? list.type === 'allow'
                  ? 'bg-accent-emerald/10 border-accent-emerald text-accent-emerald'
                  : 'bg-accent-red/10 border-accent-red text-accent-red'
                : 'border-transparent bg-background text-foreground-muted hover:bg-background-tertiary',
              securityLevel === 'PERMISSIVE' && 'opacity-50',
            )}
          >
            <list.icon className="w-4 h-4" />
            {list.shortLabel}
            <Badge 
              variant="secondary" 
              className={cn(
                'text-xs',
                activeList === list.id && list.type === 'allow' && 'bg-accent-emerald/20',
                activeList === list.id && list.type === 'deny' && 'bg-accent-red/20',
              )}
            >
              {policy[list.id].length}
            </Badge>
          </button>
        ))}
      </div>

      {/* Add new address */}
      <div className="flex gap-2 mb-5">
        <div className="flex-1">
          <Input
            value={newAddress}
            onChange={(e) => {
              setNewAddress(e.target.value);
              setError('');
            }}
            onKeyDown={handleKeyDown}
            placeholder={`Add ${currentList.category} address (0x...)`}
            error={error}
            disabled={isAdding}
          />
        </div>
        <Button 
          onClick={handleAdd} 
          disabled={!newAddress || isAdding}
          loading={isAdding}
        >
          <Plus className="w-4 h-4" />
          Add
        </Button>
      </div>

      {/* Address list */}
      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
        <AnimatePresence mode="popLayout">
          {addresses.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-10 text-foreground-muted"
            >
              <div className={cn(
                'w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-3',
                currentList.type === 'allow' ? 'bg-accent-emerald/10' : 'bg-accent-red/10'
              )}>
                {currentList.category === 'token' ? (
                  <Coins className={cn(
                    'w-7 h-7',
                    currentList.type === 'allow' ? 'text-accent-emerald' : 'text-accent-red'
                  )} />
                ) : (
                  <FileCode className={cn(
                    'w-7 h-7',
                    currentList.type === 'allow' ? 'text-accent-emerald' : 'text-accent-red'
                  )} />
                )}
              </div>
              <p className="text-sm font-medium mb-1">No {currentList.category}s in this list</p>
              <p className="text-xs text-foreground-subtle">
                Add addresses using the input above
              </p>
            </motion.div>
          ) : (
            addresses.map((address, index) => (
              <motion.div
                key={address}
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: 8 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{ delay: index * 0.03 }}
                className="flex items-center justify-between p-3 bg-background rounded-xl group border border-border/50 hover:border-border transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                    currentList.type === 'allow' 
                      ? 'bg-accent-emerald/10' 
                      : 'bg-accent-red/10'
                  )}>
                    {currentList.category === 'token' ? (
                      <Coins className={cn(
                        'w-4 h-4',
                        currentList.type === 'allow' ? 'text-accent-emerald' : 'text-accent-red'
                      )} />
                    ) : (
                      <FileCode className={cn(
                        'w-4 h-4',
                        currentList.type === 'allow' ? 'text-accent-emerald' : 'text-accent-red'
                      )} />
                    )}
                  </div>
                  <span className="font-mono text-sm truncate">{truncateAddress(address, 10, 8)}</span>
                </div>
                
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {/* Copy button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleCopyAddress(address)}
                    className="h-8 w-8"
                  >
                    {copiedAddress === address ? (
                      <Check className="w-4 h-4 text-accent-emerald" />
                    ) : (
                      <Copy className="w-4 h-4 text-foreground-muted" />
                    )}
                  </Button>
                  
                  {/* Explorer link */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => window.open(`https://bscscan.com/address/${address}`, '_blank')}
                    className="h-8 w-8"
                  >
                    <ExternalLink className="w-4 h-4 text-foreground-muted" />
                  </Button>
                  
                  {/* Delete button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemove(address)}
                    disabled={removingAddress === address}
                    className="h-8 w-8"
                  >
                    {removingAddress === address ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 text-accent-red" />
                    )}
                  </Button>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </Card>
  );
}
