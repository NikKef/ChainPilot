'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { 
  Bot, 
  Menu, 
  X, 
  Wallet,
  ChevronDown,
  Loader2,
  AlertTriangle
} from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import { WalletModal } from '@/components/wallet';
import { cn, truncateAddress } from '@/lib/utils';
import { NetworkToggle } from './NetworkToggle';
import { useWeb3Context } from '@/components/providers';

export function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const pathname = usePathname();

  const {
    isConnected,
    isConnecting,
    address,
    network,
    balance,
    isCorrectNetwork,
    switchNetwork,
  } = useWeb3Context();

  const navItems = [
    { href: '/chat', label: 'Chat' },
    { href: '/portfolio', label: 'Portfolio' },
    { href: '/activity', label: 'Activity' },
    { href: '/settings', label: 'Settings' },
  ];

  const handleNetworkChange = async (newNetwork: 'testnet' | 'mainnet') => {
    if (isConnected) {
      await switchNetwork(newNetwork);
    }
  };

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center group-hover:bg-primary/30 transition-colors">
                <Bot className="w-5 h-5 text-primary" />
              </div>
              <span className="font-bold text-lg hidden sm:block">ChainPilot</span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    pathname === item.href
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground-muted hover:text-foreground hover:bg-background-tertiary'
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* Right side */}
            <div className="flex items-center gap-3">
              {/* Network Toggle - only show if connected */}
              {isConnected && (
                <NetworkToggle 
                  network={network || 'testnet'} 
                  onChange={handleNetworkChange} 
                />
              )}

              {/* Wrong network warning */}
              {isConnected && !isCorrectNetwork && (
                <Badge variant="high" className="hidden sm:flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Wrong Network
                </Badge>
              )}

              {/* Wallet Button */}
              {isConnected && address ? (
                <Button 
                  variant="secondary" 
                  size="sm" 
                  className="hidden sm:flex"
                  onClick={() => setIsWalletModalOpen(true)}
                >
                  <Wallet className="w-4 h-4" />
                  <span className="font-mono">{truncateAddress(address)}</span>
                  {balance && (
                    <span className="text-foreground-muted text-xs ml-1">
                      {parseFloat(balance).toFixed(3)} {network === 'testnet' ? 'tBNB' : 'BNB'}
                    </span>
                  )}
                </Button>
              ) : (
                <Button 
                  variant="primary" 
                  size="sm" 
                  onClick={() => setIsWalletModalOpen(true)}
                  loading={isConnecting}
                  className="hidden sm:flex"
                >
                  <Wallet className="w-4 h-4" />
                  {isConnecting ? 'Connecting...' : 'Connect'}
                </Button>
              )}

              {/* Mobile menu button */}
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              >
                {isMobileMenuOpen ? (
                  <X className="w-5 h-5" />
                ) : (
                  <Menu className="w-5 h-5" />
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation */}
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-t border-border bg-background"
          >
            <nav className="px-4 py-4 space-y-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={cn(
                    'block px-4 py-3 rounded-lg text-sm font-medium transition-colors',
                    pathname === item.href
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground-muted hover:text-foreground hover:bg-background-tertiary'
                  )}
                >
                  {item.label}
                </Link>
              ))}
              
              {/* Mobile network toggle */}
              {isConnected && (
                <div className="px-4 py-2">
                  <NetworkToggle 
                    network={network || 'testnet'} 
                    onChange={handleNetworkChange} 
                  />
                </div>
              )}
              
              {/* Mobile wallet button */}
              <div className="pt-2 border-t border-border mt-2">
                {isConnected && address ? (
                  <Button 
                    variant="secondary" 
                    className="w-full justify-start"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      setIsWalletModalOpen(true);
                    }}
                  >
                    <Wallet className="w-4 h-4" />
                    <span className="font-mono">{truncateAddress(address)}</span>
                  </Button>
                ) : (
                  <Button 
                    variant="primary" 
                    className="w-full"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      setIsWalletModalOpen(true);
                    }}
                    loading={isConnecting}
                  >
                    <Wallet className="w-4 h-4" />
                    {isConnecting ? 'Connecting...' : 'Connect Wallet'}
                  </Button>
                )}
              </div>
            </nav>
          </motion.div>
        )}
      </header>

      {/* Wallet Modal */}
      <WalletModal 
        isOpen={isWalletModalOpen} 
        onClose={() => setIsWalletModalOpen(false)} 
      />
    </>
  );
}
