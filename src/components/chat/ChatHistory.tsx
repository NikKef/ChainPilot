'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MessageSquare, 
  Plus, 
  Trash2, 
  Edit2, 
  Check, 
  X, 
  Loader2,
  MoreVertical,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Conversation } from '@/hooks/useConversations';

interface ChatHistoryProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  isLoading: boolean;
  onSelectConversation: (conversationId: string) => void;
  onNewChat: () => void;
  onDeleteConversation: (conversationId: string) => void;
  onRenameConversation: (conversationId: string, title: string) => void;
  className?: string;
}

export function ChatHistory({
  conversations,
  activeConversationId,
  isLoading,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  onRenameConversation,
  className,
}: ChatHistoryProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus input when editing
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpenId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleStartEdit = (conversation: Conversation) => {
    setEditingId(conversation.id);
    setEditTitle(conversation.title);
    setMenuOpenId(null);
  };

  const handleSaveEdit = () => {
    if (editingId && editTitle.trim()) {
      onRenameConversation(editingId, editTitle.trim());
    }
    setEditingId(null);
    setEditTitle('');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const handleDelete = (conversationId: string) => {
    if (confirm('Are you sure you want to delete this conversation? This cannot be undone.')) {
      onDeleteConversation(conversationId);
    }
    setMenuOpenId(null);
  };

  // Group conversations by date
  const groupedConversations = groupConversationsByDate(conversations);

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header with New Chat button */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-border/50">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex items-center gap-2 text-sm font-medium text-foreground-muted hover:text-foreground transition-colors"
        >
          <MessageSquare className="w-4 h-4" />
          <span>Chat History</span>
          {isCollapsed ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronUp className="w-4 h-4" />
          )}
        </button>
        <button
          onClick={onNewChat}
          disabled={isLoading}
          className="p-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          title="New Chat"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Conversations list */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="py-2 space-y-4 max-h-[300px] overflow-y-auto scrollbar-thin">
              {isLoading && conversations.length === 0 ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-foreground-muted" />
                </div>
              ) : conversations.length === 0 ? (
                <div className="px-4 py-3 text-center">
                  <p className="text-sm text-foreground-muted">No conversations yet</p>
                  <button
                    onClick={onNewChat}
                    className="mt-2 text-sm text-primary hover:underline"
                  >
                    Start a new chat
                  </button>
                </div>
              ) : (
                Object.entries(groupedConversations).map(([dateLabel, convs]) => (
                  <div key={dateLabel}>
                    <h4 className="px-4 py-1 text-xs font-medium text-foreground-subtle uppercase tracking-wider">
                      {dateLabel}
                    </h4>
                    <div className="space-y-0.5">
                      {convs.map((conversation) => (
                        <ConversationItem
                          key={conversation.id}
                          conversation={conversation}
                          isActive={conversation.id === activeConversationId}
                          isEditing={editingId === conversation.id}
                          editTitle={editTitle}
                          menuOpen={menuOpenId === conversation.id}
                          onSelect={() => onSelectConversation(conversation.id)}
                          onStartEdit={() => handleStartEdit(conversation)}
                          onSaveEdit={handleSaveEdit}
                          onCancelEdit={handleCancelEdit}
                          onDelete={() => handleDelete(conversation.id)}
                          onEditTitleChange={setEditTitle}
                          onKeyDown={handleKeyDown}
                          onMenuToggle={() => setMenuOpenId(menuOpenId === conversation.id ? null : conversation.id)}
                          editInputRef={editInputRef}
                          menuRef={menuRef}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  isEditing: boolean;
  editTitle: string;
  menuOpen: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onEditTitleChange: (title: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onMenuToggle: () => void;
  editInputRef: React.RefObject<HTMLInputElement>;
  menuRef: React.RefObject<HTMLDivElement>;
}

function ConversationItem({
  conversation,
  isActive,
  isEditing,
  editTitle,
  menuOpen,
  onSelect,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onEditTitleChange,
  onKeyDown,
  onMenuToggle,
  editInputRef,
  menuRef,
}: ConversationItemProps) {
  const handleContainerClick = (e: React.MouseEvent) => {
    // Only trigger select if clicking on the main area (not menu or edit buttons)
    const target = e.target as HTMLElement;
    if (!target.closest('[data-menu-area]') && !target.closest('[data-edit-area]')) {
      onSelect();
    }
  };

  return (
    <div className="relative group px-2">
      <div
        role="button"
        tabIndex={0}
        onClick={handleContainerClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all duration-200 cursor-pointer',
          isActive
            ? 'bg-primary/10 text-foreground border border-primary/20'
            : 'hover:bg-background-tertiary text-foreground-muted hover:text-foreground'
        )}
      >
        <MessageSquare className={cn(
          'w-4 h-4 shrink-0',
          isActive && 'text-primary'
        )} />
        
        {isEditing ? (
          <div className="flex-1 flex items-center gap-1" data-edit-area onClick={e => e.stopPropagation()}>
            <input
              ref={editInputRef}
              type="text"
              value={editTitle}
              onChange={(e) => onEditTitleChange(e.target.value)}
              onKeyDown={onKeyDown}
              className="flex-1 bg-background-secondary rounded px-2 py-0.5 text-sm border border-border focus:outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={onSaveEdit}
              className="p-1 hover:bg-accent-green/20 rounded text-accent-green"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              className="p-1 hover:bg-accent-red/20 rounded text-accent-red"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <span className="flex-1 truncate text-sm">
            {conversation.title}
          </span>
        )}

        {!isEditing && (
          <div 
            data-menu-area
            className={cn(
              'opacity-0 group-hover:opacity-100 transition-opacity',
              menuOpen && 'opacity-100'
            )}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMenuToggle();
              }}
              className="p-1 hover:bg-background-tertiary rounded"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Dropdown menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="absolute right-4 top-full mt-1 z-50 bg-background-secondary border border-border rounded-lg shadow-lg overflow-hidden"
          >
            <button
              onClick={onStartEdit}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-background-tertiary transition-colors"
            >
              <Edit2 className="w-4 h-4" />
              Rename
            </button>
            <button
              onClick={onDelete}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-accent-red hover:bg-accent-red/10 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Helper function to group conversations by date
function groupConversationsByDate(conversations: Conversation[]): Record<string, Conversation[]> {
  const groups: Record<string, Conversation[]> = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const lastMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  conversations.forEach((conv) => {
    const convDate = new Date(conv.updatedAt);
    let label: string;

    if (convDate >= today) {
      label = 'Today';
    } else if (convDate >= yesterday) {
      label = 'Yesterday';
    } else if (convDate >= lastWeek) {
      label = 'This Week';
    } else if (convDate >= lastMonth) {
      label = 'This Month';
    } else {
      label = 'Older';
    }

    if (!groups[label]) {
      groups[label] = [];
    }
    groups[label].push(conv);
  });

  return groups;
}

