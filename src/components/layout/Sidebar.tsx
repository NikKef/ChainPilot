'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { 
  MessageSquare, 
  Wallet, 
  History, 
  Settings, 
  Bot,
  ExternalLink,
  HelpCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWeb3Context } from '@/components/providers';
import { ChatHistory } from '@/components/chat';

const navItems = [
  { href: '/chat', label: 'Chat', icon: MessageSquare },
  { href: '/portfolio', label: 'Portfolio', icon: Wallet },
  { href: '/activity', label: 'Activity', icon: History },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const footerLinks = [
  { href: 'https://docs.chaingpt.org', label: 'ChainGPT Docs', icon: ExternalLink },
  { href: 'https://github.com/quackai-labs/Q402', label: 'Q402 Docs', icon: ExternalLink },
];

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const pathname = usePathname();
  const {
    isConnected,
    conversations,
    activeConversationId,
    isConversationsLoading,
    setActiveConversation,
    startNewChat,
    deleteConversation,
    renameConversation,
  } = useWeb3Context();

  const isOnChatPage = pathname === '/chat';

  return (
    <aside className={cn(
      'fixed left-0 top-16 bottom-0 w-64 border-r border-border bg-background-secondary/50 backdrop-blur-xl',
      'hidden lg:block',
      className
    )}>
      <div className="flex flex-col h-full">
        {/* Navigation */}
        <nav className="p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'text-foreground'
                    : 'text-foreground-muted hover:text-foreground hover:bg-background-tertiary'
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeNav"
                    className="absolute inset-0 bg-primary/10 border border-primary/20 rounded-xl"
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  />
                )}
                <item.icon className={cn(
                  'relative z-10 w-5 h-5',
                  isActive && 'text-primary'
                )} />
                <span className="relative z-10">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Chat History - Only show when connected and on chat page */}
        {isConnected && isOnChatPage && (
          <div className="flex-1 border-t border-border overflow-hidden">
            <ChatHistory
              conversations={conversations}
              activeConversationId={activeConversationId}
              isLoading={isConversationsLoading}
              onSelectConversation={setActiveConversation}
              onNewChat={startNewChat}
              onDeleteConversation={deleteConversation}
              onRenameConversation={renameConversation}
              className="h-full"
            />
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-border space-y-1 mt-auto">
          {footerLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-2 rounded-lg text-sm text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors"
            >
              <link.icon className="w-4 h-4" />
              {link.label}
            </a>
          ))}
          
          <div className="px-4 py-3 mt-2">
            <div className="flex items-center gap-2 text-xs text-foreground-subtle">
              <Bot className="w-4 h-4 text-primary" />
              <span>ChainPilot v0.1.0</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

