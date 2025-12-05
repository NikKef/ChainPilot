'use client';

import { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, Download, Maximize2 } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { cn } from '@/lib/utils';

interface CodeViewerProps {
  code: string;
  language?: string;
  title?: string;
  showLineNumbers?: boolean;
  maxHeight?: string;
  className?: string;
}

export function CodeViewer({
  code,
  language = 'solidity',
  title,
  showLineNumbers = true,
  maxHeight = '400px',
  className,
}: CodeViewerProps) {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contract.${language === 'solidity' ? 'sol' : language}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className={cn('rounded-xl border border-border overflow-hidden', className)}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-background-tertiary border-b border-border">
          <span className="text-sm font-medium text-foreground-muted">
            {title || language.charAt(0).toUpperCase() + language.slice(1)}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsExpanded(true)}
              className="h-7 w-7"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDownload}
              className="h-7 w-7"
            >
              <Download className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCopy}
              className="h-7 w-7"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-accent-emerald" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Code */}
        <div style={{ maxHeight }} className="overflow-auto">
          <SyntaxHighlighter
            language={language}
            style={oneDark}
            showLineNumbers={showLineNumbers}
            customStyle={{
              margin: 0,
              borderRadius: 0,
              fontSize: '0.8rem',
              background: 'transparent',
            }}
            lineNumberStyle={{
              minWidth: '3em',
              paddingRight: '1em',
              color: 'rgba(255,255,255,0.3)',
            }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      </div>

      {/* Expanded modal */}
      <Modal
        isOpen={isExpanded}
        onClose={() => setIsExpanded(false)}
        title={title || 'Code Viewer'}
        className="max-w-4xl"
      >
        <div className="max-h-[70vh] overflow-auto rounded-lg">
          <SyntaxHighlighter
            language={language}
            style={oneDark}
            showLineNumbers={showLineNumbers}
            customStyle={{
              margin: 0,
              fontSize: '0.8rem',
            }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={handleCopy}>
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied!' : 'Copy'}
          </Button>
          <Button variant="secondary" onClick={handleDownload}>
            <Download className="w-4 h-4" />
            Download
          </Button>
        </div>
      </Modal>
    </>
  );
}

