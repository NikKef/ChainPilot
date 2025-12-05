import { NETWORKS, type NetworkType } from './constants';

/**
 * Truncate an address for display
 */
export function truncateAddress(address: string, startChars = 6, endChars = 4): string {
  if (!address) return '';
  if (address.length <= startChars + endChars) return address;
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Format a number with commas and decimal places
 */
export function formatNumber(
  value: number | string,
  decimals = 2,
  options?: { compact?: boolean }
): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  
  if (isNaN(num)) return '0';
  
  if (options?.compact && Math.abs(num) >= 1000) {
    const formatter = new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: decimals,
    });
    return formatter.format(num);
  }
  
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(num);
}

/**
 * Format token amount with proper decimals
 */
export function formatTokenAmount(
  amount: bigint | string,
  decimals: number,
  displayDecimals = 4
): string {
  const amountBigInt = typeof amount === 'string' ? BigInt(amount) : amount;
  const divisor = BigInt(10 ** decimals);
  const wholePart = amountBigInt / divisor;
  const fractionalPart = amountBigInt % divisor;
  
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0').slice(0, displayDecimals);
  const formattedWhole = formatNumber(Number(wholePart), 0);
  
  if (parseInt(fractionalStr) === 0) {
    return formattedWhole;
  }
  
  return `${formattedWhole}.${fractionalStr.replace(/0+$/, '')}`;
}

/**
 * Parse token amount from human-readable to wei
 */
export function parseTokenAmount(amount: string, decimals: number): bigint {
  const [whole, fraction = ''] = amount.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole + paddedFraction);
}

/**
 * Format USD value
 */
export function formatUsd(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  
  if (isNaN(num)) return '$0.00';
  
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Format gas in Gwei
 */
export function formatGwei(wei: bigint): string {
  const gwei = Number(wei) / 1e9;
  return `${formatNumber(gwei, 2)} Gwei`;
}

/**
 * Format timestamp to relative time
 */
export function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const then = typeof date === 'string' ? new Date(date) : date;
  const diffMs = now.getTime() - then.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffSecs < 60) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return then.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: then.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

/**
 * Format timestamp to full date/time
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Get block explorer URL for transaction
 */
export function getExplorerTxUrl(txHash: string, network: NetworkType): string {
  return `${NETWORKS[network].explorerUrl}/tx/${txHash}`;
}

/**
 * Get block explorer URL for address
 */
export function getExplorerAddressUrl(address: string, network: NetworkType): string {
  return `${NETWORKS[network].explorerUrl}/address/${address}`;
}

/**
 * Format slippage from basis points to percentage
 */
export function formatSlippage(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/**
 * Format risk level with proper casing
 */
export function formatRiskLevel(level: string): string {
  return level.charAt(0).toUpperCase() + level.slice(1).toLowerCase();
}

