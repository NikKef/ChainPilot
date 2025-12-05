import { isAddress } from 'ethers';

/**
 * Validate Ethereum address format
 */
export function isValidAddress(address: string): boolean {
  try {
    return isAddress(address);
  } catch {
    return false;
  }
}

/**
 * Validate amount string (positive number with optional decimals)
 */
export function isValidAmount(amount: string): boolean {
  if (!amount || amount.trim() === '') return false;
  const num = parseFloat(amount);
  return !isNaN(num) && num > 0 && isFinite(num);
}

/**
 * Validate transaction hash format
 */
export function isValidTxHash(hash: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
}

/**
 * Validate network type
 */
export function isValidNetwork(network: string): network is 'testnet' | 'mainnet' {
  return network === 'testnet' || network === 'mainnet';
}

/**
 * Validate slippage in basis points (0-10000)
 */
export function isValidSlippage(bps: number): boolean {
  return Number.isInteger(bps) && bps >= 0 && bps <= 10000;
}

/**
 * Validate Solidity source code (basic check)
 */
export function isValidSolidityCode(code: string): boolean {
  if (!code || code.trim() === '') return false;
  // Check for common Solidity patterns
  return (
    code.includes('pragma solidity') ||
    code.includes('contract ') ||
    code.includes('interface ') ||
    code.includes('library ')
  );
}

/**
 * Sanitize user input for display
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validate and normalize address to checksum format
 */
export function normalizeAddress(address: string): string | null {
  try {
    if (!isValidAddress(address)) return null;
    // ethers v6 getAddress returns checksum address
    const { getAddress } = require('ethers');
    return getAddress(address);
  } catch {
    return null;
  }
}

/**
 * Parse and validate amount with decimals
 */
export function parseAmount(
  amount: string,
  decimals: number
): { valid: boolean; value: bigint | null; error?: string } {
  if (!isValidAmount(amount)) {
    return { valid: false, value: null, error: 'Invalid amount format' };
  }

  try {
    const [whole, fraction = ''] = amount.split('.');
    
    if (fraction.length > decimals) {
      return { valid: false, value: null, error: `Too many decimal places (max ${decimals})` };
    }

    const paddedFraction = fraction.padEnd(decimals, '0');
    const value = BigInt(whole + paddedFraction);
    
    return { valid: true, value };
  } catch (error) {
    return { valid: false, value: null, error: 'Failed to parse amount' };
  }
}

/**
 * Validate chat message
 */
export function validateChatMessage(message: string): { valid: boolean; error?: string } {
  if (!message || message.trim() === '') {
    return { valid: false, error: 'Message cannot be empty' };
  }

  if (message.length > 4000) {
    return { valid: false, error: 'Message too long (max 4000 characters)' };
  }

  return { valid: true };
}

/**
 * Validate contract generation spec
 */
export function validateContractSpec(spec: string): { valid: boolean; error?: string } {
  if (!spec || spec.trim() === '') {
    return { valid: false, error: 'Contract specification cannot be empty' };
  }

  if (spec.length < 20) {
    return { valid: false, error: 'Please provide more details about the contract you want to generate' };
  }

  if (spec.length > 10000) {
    return { valid: false, error: 'Specification too long (max 10000 characters)' };
  }

  return { valid: true };
}

