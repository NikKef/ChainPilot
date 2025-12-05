import type { Metadata } from 'next';
import { Space_Grotesk, Fira_Code } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
});

const firaCode = Fira_Code({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'ChainPilot - Web3 AI Copilot',
  description: 'Chat-based Web3 copilot for BNB Chain. Research, build, audit, and execute on-chain actions through natural language.',
  keywords: ['Web3', 'AI', 'BNB Chain', 'Smart Contracts', 'DeFi', 'Blockchain'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${spaceGrotesk.variable} ${firaCode.variable} font-sans min-h-screen`}>
        <div className="fixed inset-0 bg-gradient-radial from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="fixed inset-0 bg-[url('/grid.svg')] bg-center opacity-[0.02] pointer-events-none" />
        <Providers>
          <main className="relative z-10">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}

