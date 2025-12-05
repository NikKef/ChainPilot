'use client';

import { type ReactNode } from 'react';
import { Web3Provider } from './Web3Provider';

interface ProvidersProps {
  children: ReactNode;
}

/**
 * Root providers wrapper for the application.
 * Wraps all global context providers.
 */
export function Providers({ children }: ProvidersProps) {
  return (
    <Web3Provider>
      {children}
    </Web3Provider>
  );
}

