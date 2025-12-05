'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { 
  MessageSquare, 
  Shield, 
  Zap, 
  Code, 
  ArrowRight,
  Wallet,
  Bot,
  LineChart
} from 'lucide-react';
import { Button } from '@/components/ui';
import { WalletModal } from '@/components/wallet';
import { useWeb3Context } from '@/components/providers';

const features = [
  {
    icon: MessageSquare,
    title: 'Natural Language Chat',
    description: 'Interact with BNB Chain using plain English. Ask questions, execute trades, and manage contracts conversationally.',
    color: 'text-accent-cyan',
  },
  {
    icon: Code,
    title: 'Smart Contract Generation',
    description: 'Generate custom Solidity contracts from descriptions. Built-in auditing catches vulnerabilities before deployment.',
    color: 'text-primary',
  },
  {
    icon: Shield,
    title: 'Policy Protection',
    description: 'Set spend caps, manage allow/deny lists, and get risk warnings before every transaction.',
    color: 'text-accent-emerald',
  },
  {
    icon: Zap,
    title: 'One-Click Execution',
    description: 'Execute swaps, transfers, and contract calls with a single signature via Q402 sign-to-pay.',
    color: 'text-accent-amber',
  },
];

const stats = [
  { label: 'Supported Actions', value: '10+' },
  { label: 'Gas Sponsored', value: '100%' },
  { label: 'Risk Checks', value: 'Real-time' },
];

export default function HomePage() {
  const { isConnected, address } = useWeb3Context();
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative pt-20 pb-32 px-6 overflow-hidden">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-8">
              <Bot className="w-4 h-4 text-primary" />
              <span className="text-sm text-foreground-muted">Powered by ChainGPT + Q402</span>
            </div>

            <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
              <span className="text-gradient">Your Web3</span>
              <br />
              <span className="text-foreground">AI Copilot</span>
            </h1>

            <p className="text-xl text-foreground-muted max-w-2xl mx-auto mb-10">
              Research protocols, generate smart contracts, audit code, and execute 
              on-chain actions — all through natural conversation on BNB Chain.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              {isConnected ? (
                <Link href="/chat" className="btn-primary flex items-center gap-2 text-lg px-8 py-4">
                  <MessageSquare className="w-5 h-5" />
                  Start Chatting
                  <ArrowRight className="w-5 h-5" />
                </Link>
              ) : (
                <Button 
                  variant="primary" 
                  size="lg"
                  className="text-lg px-8 py-4"
                  onClick={() => setIsWalletModalOpen(true)}
                >
                  <Wallet className="w-5 h-5" />
                  Connect Wallet
                  <ArrowRight className="w-5 h-5" />
                </Button>
              )}
              <Link href="/portfolio" className="btn-secondary flex items-center gap-2 text-lg px-8 py-4">
                <Wallet className="w-5 h-5" />
                View Portfolio
              </Link>
            </div>

            {/* Connected indicator */}
            {isConnected && address && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent-emerald/10 border border-accent-emerald/30"
              >
                <div className="w-2 h-2 rounded-full bg-accent-emerald animate-pulse" />
                <span className="text-sm text-accent-emerald">
                  Wallet Connected
                </span>
              </motion.div>
            )}
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="grid grid-cols-3 gap-8 mt-20 max-w-3xl mx-auto"
          >
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl md:text-4xl font-bold text-gradient mb-2">
                  {stat.value}
                </div>
                <div className="text-sm text-foreground-muted">{stat.label}</div>
              </div>
            ))}
          </motion.div>
        </div>

        {/* Background decorations */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent-cyan/10 rounded-full blur-3xl pointer-events-none" />
      </section>

      {/* Features Section */}
      <section className="py-24 px-6 bg-background-secondary/50">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Everything You Need to Navigate Web3
            </h2>
            <p className="text-foreground-muted max-w-2xl mx-auto">
              From research to execution, ChainPilot handles the complexity so you can focus on what matters.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="card group"
              >
                <div className={`w-12 h-12 rounded-lg bg-background flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                  <feature.icon className={`w-6 h-6 ${feature.color}`} />
                </div>
                <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                <p className="text-foreground-muted">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="glass-panel gradient-border p-12 text-center"
          >
            <LineChart className="w-12 h-12 text-primary mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Ready to Take Control?
            </h2>
            <p className="text-foreground-muted mb-8 max-w-xl mx-auto">
              Connect your wallet and start exploring the power of AI-assisted Web3 interactions on BNB Chain.
            </p>
            {isConnected ? (
              <Link href="/chat" className="btn-primary inline-flex items-center gap-2 text-lg px-8 py-4">
                Launch ChainPilot
                <ArrowRight className="w-5 h-5" />
              </Link>
            ) : (
              <Button 
                variant="primary" 
                size="lg"
                className="text-lg px-8 py-4"
                onClick={() => setIsWalletModalOpen(true)}
              >
                Connect & Launch
                <ArrowRight className="w-5 h-5" />
              </Button>
            )}
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-border">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Bot className="w-6 h-6 text-primary" />
            <span className="font-semibold">ChainPilot</span>
          </div>
          <div className="text-sm text-foreground-muted">
            Built for BNB Chain Hackathon • Powered by ChainGPT + Quack Q402
          </div>
        </div>
      </footer>

      {/* Wallet Modal */}
      <WalletModal 
        isOpen={isWalletModalOpen} 
        onClose={() => setIsWalletModalOpen(false)} 
      />
    </div>
  );
}
