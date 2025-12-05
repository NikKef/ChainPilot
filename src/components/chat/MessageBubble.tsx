'use client';

import { Bot, User, Code, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ChatMessage } from '@/lib/types';
import { cn } from '@/lib/utils';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <div className={cn(
      'flex gap-3',
      isUser && 'flex-row-reverse'
    )}>
      {/* Avatar */}
      <div className={cn(
        'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
        isUser 
          ? 'bg-accent-cyan/20' 
          : isSystem 
            ? 'bg-accent-amber/20'
            : 'bg-primary/20'
      )}>
        {isUser ? (
          <User className="w-4 h-4 text-accent-cyan" />
        ) : isSystem ? (
          <AlertTriangle className="w-4 h-4 text-accent-amber" />
        ) : (
          <Bot className="w-4 h-4 text-primary" />
        )}
      </div>

      {/* Message content */}
      <div className={cn(
        'max-w-[80%] rounded-2xl px-4 py-3',
        isUser 
          ? 'bg-primary text-white rounded-br-md' 
          : 'bg-background-secondary border border-border rounded-bl-md'
      )}>
        {isUser ? (
          <p className="text-sm">{message.content}</p>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown
              components={{
                code({ node, inline, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '');
                  const language = match ? match[1] : '';
                  
                  if (!inline && language) {
                    return (
                      <div className="relative group my-3">
                        <div className="absolute top-2 right-2 text-xs text-foreground-subtle opacity-0 group-hover:opacity-100 transition-opacity">
                          {language}
                        </div>
                        <SyntaxHighlighter
                          style={oneDark}
                          language={language}
                          PreTag="div"
                          customStyle={{
                            margin: 0,
                            borderRadius: '0.5rem',
                            fontSize: '0.75rem',
                          }}
                          {...props}
                        >
                          {String(children).replace(/\n$/, '')}
                        </SyntaxHighlighter>
                      </div>
                    );
                  }

                  return (
                    <code 
                      className="px-1.5 py-0.5 bg-background-tertiary rounded text-accent-cyan text-xs font-mono"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                p({ children }) {
                  return <p className="mb-2 last:mb-0 text-sm leading-relaxed">{children}</p>;
                },
                ul({ children }) {
                  return <ul className="list-disc list-inside mb-2 text-sm">{children}</ul>;
                },
                ol({ children }) {
                  return <ol className="list-decimal list-inside mb-2 text-sm">{children}</ol>;
                },
                li({ children }) {
                  return <li className="mb-1">{children}</li>;
                },
                h1({ children }) {
                  return <h1 className="text-lg font-bold mb-2">{children}</h1>;
                },
                h2({ children }) {
                  return <h2 className="text-base font-semibold mb-2">{children}</h2>;
                },
                h3({ children }) {
                  return <h3 className="text-sm font-semibold mb-2">{children}</h3>;
                },
                a({ children, href }) {
                  return (
                    <a 
                      href={href} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-primary hover:text-primary-hover underline"
                    >
                      {children}
                    </a>
                  );
                },
                blockquote({ children }) {
                  return (
                    <blockquote className="border-l-2 border-primary pl-3 my-2 text-foreground-muted italic">
                      {children}
                    </blockquote>
                  );
                },
                strong({ children }) {
                  return <strong className="font-semibold text-foreground">{children}</strong>;
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {/* Intent badge */}
        {message.intent && !isUser && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <span className="text-xs text-foreground-subtle">
              Intent: {message.intent.type}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

