import { Contract, Interface, AbiCoder } from 'ethers';
import type { ContractAbi, AbiItem } from '@/lib/types';
import { getProvider, getContractCode, isContract } from './provider';
import { type NetworkType } from '@/lib/utils/constants';
import { logger } from '@/lib/utils';
import { Web3Error, NotFoundError } from '@/lib/utils/errors';

/**
 * Get contract ABI from a known contract (if verified on explorer)
 * Note: In production, this would call BSCScan API
 */
export async function fetchContractAbi(
  address: string,
  network: NetworkType
): Promise<ContractAbi | null> {
  // For now, return null - would integrate with BSCScan API
  logger.debug('fetchContractAbi called - would call BSCScan API', { address, network });
  return null;
}

/**
 * Parse ABI from JSON string or array
 */
export function parseAbi(abi: string | unknown[]): ContractAbi {
  if (typeof abi === 'string') {
    try {
      return JSON.parse(abi);
    } catch {
      // Try to parse as human-readable ABI
      const iface = new Interface([abi]);
      return iface.format('json') as unknown as ContractAbi;
    }
  }
  return abi as ContractAbi;
}

/**
 * Create a contract instance for reading
 */
export function createReadContract(
  address: string,
  abi: ContractAbi | string[],
  network: NetworkType
): Contract {
  const provider = getProvider(network);
  return new Contract(address, abi, provider);
}

/**
 * Get contract methods (read and write functions)
 */
export function getContractMethods(abi: ContractAbi): {
  readMethods: AbiItem[];
  writeMethods: AbiItem[];
  events: AbiItem[];
} {
  const readMethods: AbiItem[] = [];
  const writeMethods: AbiItem[] = [];
  const events: AbiItem[] = [];

  for (const item of abi) {
    if (item.type === 'function') {
      if (item.stateMutability === 'view' || item.stateMutability === 'pure') {
        readMethods.push(item);
      } else {
        writeMethods.push(item);
      }
    } else if (item.type === 'event') {
      events.push(item);
    }
  }

  return { readMethods, writeMethods, events };
}

/**
 * Get function signature
 */
export function getFunctionSignature(func: AbiItem): string {
  if (func.type !== 'function' || !func.name) {
    return '';
  }

  const params = func.inputs?.map(p => p.type).join(',') || '';
  return `${func.name}(${params})`;
}

/**
 * Get function selector (first 4 bytes of keccak256 hash)
 */
export function getFunctionSelector(signature: string): string {
  const iface = new Interface([`function ${signature}`]);
  const fragment = iface.getFunction(signature.split('(')[0]);
  if (!fragment) return '';
  return iface.getFunction(fragment.name)?.selector || '';
}

/**
 * Decode function call data
 */
export function decodeFunctionCall(
  data: string,
  abi: ContractAbi
): {
  name: string;
  args: unknown[];
  signature: string;
} | null {
  try {
    const iface = new Interface(abi);
    const parsed = iface.parseTransaction({ data });
    
    if (!parsed) return null;

    return {
      name: parsed.name,
      args: [...parsed.args],
      signature: parsed.signature,
    };
  } catch (error) {
    logger.error('Failed to decode function call', error);
    return null;
  }
}

/**
 * Encode function call data
 */
export function encodeFunctionCall(
  abi: ContractAbi,
  functionName: string,
  args: unknown[]
): string {
  const iface = new Interface(abi);
  return iface.encodeFunctionData(functionName, args);
}

/**
 * Encode constructor arguments
 */
export function encodeConstructorArgs(
  abi: ContractAbi,
  args: unknown[]
): string {
  const constructor = abi.find(item => item.type === 'constructor');
  if (!constructor || !constructor.inputs?.length) {
    return '';
  }

  const types = constructor.inputs.map(input => input.type);
  const coder = AbiCoder.defaultAbiCoder();
  
  // Remove '0x' prefix from encoded data
  return coder.encode(types, args).slice(2);
}

/**
 * Call a read-only contract function
 */
export async function callContractMethod(
  address: string,
  abi: ContractAbi,
  methodName: string,
  args: unknown[],
  network: NetworkType
): Promise<unknown> {
  const contract = createReadContract(address, abi, network);
  
  try {
    return await contract[methodName](...args);
  } catch (error) {
    logger.error('Contract call failed', error, { address, methodName });
    throw new Web3Error(
      `Failed to call ${methodName}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Check if address is a valid contract
 */
export async function validateContract(
  address: string,
  network: NetworkType
): Promise<{
  valid: boolean;
  isContract: boolean;
  codeSize: number;
}> {
  const contractCheck = await isContract(address, network);
  
  if (!contractCheck) {
    return { valid: false, isContract: false, codeSize: 0 };
  }

  const code = await getContractCode(address, network);
  const codeSize = (code.length - 2) / 2; // Remove '0x' and divide by 2 (hex chars)

  return {
    valid: true,
    isContract: true,
    codeSize,
  };
}

/**
 * Get deployed contract address from creation transaction
 */
export function getContractAddressFromTx(
  from: string,
  nonce: number
): string {
  // This is a simplified version - in practice, use ethers.js getCreateAddress
  const { getCreateAddress } = require('ethers');
  return getCreateAddress({ from, nonce });
}

/**
 * Simple bytecode validation
 */
export function validateBytecode(bytecode: string): {
  valid: boolean;
  error?: string;
} {
  if (!bytecode) {
    return { valid: false, error: 'Bytecode is empty' };
  }

  if (!bytecode.startsWith('0x')) {
    return { valid: false, error: 'Bytecode must start with 0x' };
  }

  if (bytecode.length < 10) {
    return { valid: false, error: 'Bytecode too short' };
  }

  // Check if valid hex
  if (!/^0x[0-9a-fA-F]+$/.test(bytecode)) {
    return { valid: false, error: 'Bytecode contains invalid hex characters' };
  }

  return { valid: true };
}

/**
 * Extract contract metadata from bytecode
 */
export function extractBytecodeMetadata(bytecode: string): {
  hasMetadata: boolean;
  solcVersion?: string;
} {
  // CBOR-encoded metadata is at the end of bytecode
  // Look for common patterns
  if (bytecode.includes('a265627a7a72')) {
    // Pre-0.5.9 metadata
    return { hasMetadata: true };
  }

  if (bytecode.includes('a264697066')) {
    // IPFS metadata (0.5.9+)
    return { hasMetadata: true };
  }

  return { hasMetadata: false };
}

