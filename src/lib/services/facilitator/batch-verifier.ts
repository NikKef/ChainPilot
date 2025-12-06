/**
 * Q402 Batch Signature Verifier
 * 
 * Verifies EIP-712 signatures for batch operations.
 * Ensures the signer authorized the specific batch of operations.
 * 
 * @see https://github.com/quackai-labs/Q402
 */

import { 
  verifyTypedData,
  getAddress,
  keccak256,
  solidityPacked,
  AbiCoder,
} from 'ethers';
import type { BatchWitness, BatchOperation } from '../q402/types';
import { BATCH_WITNESS_TYPES } from '../q402/types';
import { logger } from '@/lib/utils';

/**
 * Batch verification request
 */
export interface BatchVerifyRequest {
  witness: BatchWitness;
  operations: BatchOperation[];
  signature: string;
  signerAddress: string;
}

/**
 * Batch verification response
 */
export interface BatchVerifyResponse {
  valid: boolean;
  error?: string;
  recoveredAddress?: string;
  operationsHashValid?: boolean;
}

/**
 * Batch Signature Verifier
 * 
 * Verifies EIP-712 signatures for batch witness structures
 */
export class BatchSignatureVerifier {
  private chainId: number;
  private verifyingContract: string;
  
  // Track used nonces to prevent replay
  private usedNonces: Map<string, Set<number>> = new Map();

  constructor(chainId: number, verifyingContract: string) {
    this.chainId = chainId;
    this.verifyingContract = verifyingContract;
  }

  /**
   * Get the EIP-712 domain for batch signatures
   */
  getDomain() {
    return {
      name: 'q402-batch',
      version: '1',
      chainId: this.chainId,
      verifyingContract: this.verifyingContract,
    };
  }

  /**
   * Get the EIP-712 types for BatchWitness
   */
  getTypes() {
    return {
      BatchWitness: BATCH_WITNESS_TYPES.BatchWitness,
    };
  }

  /**
   * Compute the operations hash the same way the contract does
   */
  computeOperationsHash(operations: BatchOperation[]): string {
    const abiCoder = new AbiCoder();
    const OPERATION_TYPEHASH = keccak256(
      Buffer.from('Operation(uint8 opType,address tokenIn,uint256 amountIn,address tokenOut,uint256 minAmountOut,address target,bytes data)')
    );
    
    // Hash each operation
    const operationHashes: string[] = operations.map(op => {
      const opTypeCode = this.getOpTypeCode(op.type);
      const dataHash = keccak256(op.data || '0x');
      
      return keccak256(
        abiCoder.encode(
          ['bytes32', 'uint8', 'address', 'uint256', 'address', 'uint256', 'address', 'bytes32'],
          [
            OPERATION_TYPEHASH,
            opTypeCode,
            op.tokenIn,
            BigInt(op.amountIn),
            op.tokenOut,
            BigInt(op.minAmountOut),
            op.target,
            dataHash,
          ]
        )
      );
    });
    
    // Combine all operation hashes
    return keccak256(solidityPacked(['bytes32[]'], [operationHashes]));
  }

  /**
   * Convert operation type string to numeric code
   */
  private getOpTypeCode(type: string): number {
    switch (type) {
      case 'transfer': return 0;
      case 'swap': return 1;
      case 'call': return 2;
      default: return 0;
    }
  }

  /**
   * Verify a batch signature
   */
  async verify(request: BatchVerifyRequest): Promise<BatchVerifyResponse> {
    try {
      const { witness, operations, signature, signerAddress } = request;

      // Basic validation
      if (!signature || signature.length < 130) {
        return {
          valid: false,
          error: 'Invalid signature format',
        };
      }

      // Verify operations hash matches
      const computedHash = this.computeOperationsHash(operations);
      if (computedHash !== witness.operationsHash) {
        logger.warn('Operations hash mismatch', {
          computed: computedHash,
          provided: witness.operationsHash,
        });
        return {
          valid: false,
          error: 'Operations hash does not match witness',
          operationsHashValid: false,
        };
      }

      // Check deadline
      const now = Math.floor(Date.now() / 1000);
      if (witness.deadline < now) {
        return {
          valid: false,
          error: `Batch signature expired at ${new Date(witness.deadline * 1000).toISOString()}`,
        };
      }

      // Check nonce hasn't been used
      const normalizedOwner = getAddress(witness.owner).toLowerCase();
      const usedNoncesForOwner = this.usedNonces.get(normalizedOwner);
      if (usedNoncesForOwner?.has(witness.nonce)) {
        return {
          valid: false,
          error: `Nonce ${witness.nonce} has already been used`,
        };
      }

      // Verify the EIP-712 signature
      const domain = this.getDomain();
      const types = this.getTypes();
      
      // Message to verify (BatchWitness)
      const message = {
        owner: witness.owner,
        operationsHash: witness.operationsHash,
        deadline: witness.deadline,
        batchId: witness.batchId,
        nonce: witness.nonce,
      };

      logger.debug('Verifying batch signature', {
        domain,
        message,
        signatureLength: signature.length,
      });

      // Recover the signer address
      const recoveredAddress = verifyTypedData(domain, types, message, signature);
      const normalizedRecovered = getAddress(recoveredAddress).toLowerCase();
      const normalizedSigner = getAddress(signerAddress).toLowerCase();
      const normalizedWitnessOwner = getAddress(witness.owner).toLowerCase();

      // Check recovered address matches both signer and witness owner
      if (normalizedRecovered !== normalizedSigner) {
        logger.warn('Batch signature verification failed: signer mismatch', {
          recovered: recoveredAddress,
          expected: signerAddress,
        });
        return {
          valid: false,
          error: 'Signature does not match signer address',
          recoveredAddress,
        };
      }

      if (normalizedRecovered !== normalizedWitnessOwner) {
        logger.warn('Batch signature verification failed: owner mismatch', {
          recovered: recoveredAddress,
          witnessOwner: witness.owner,
        });
        return {
          valid: false,
          error: 'Signature does not match witness owner',
          recoveredAddress,
        };
      }

      logger.info('Batch signature verified successfully', {
        signer: signerAddress,
        batchId: witness.batchId,
        operationCount: operations.length,
        nonce: witness.nonce,
      });

      return {
        valid: true,
        recoveredAddress,
        operationsHashValid: true,
      };
    } catch (error) {
      logger.error('Batch signature verification error', { error: String(error) });
      return {
        valid: false,
        error: `Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Mark a nonce as used (call after successful settlement)
   */
  markNonceUsed(owner: string, nonce: number): void {
    const normalizedOwner = getAddress(owner).toLowerCase();
    let usedNoncesForOwner = this.usedNonces.get(normalizedOwner);
    
    if (!usedNoncesForOwner) {
      usedNoncesForOwner = new Set();
      this.usedNonces.set(normalizedOwner, usedNoncesForOwner);
    }
    
    usedNoncesForOwner.add(nonce);
    
    // Clean up old nonces (keep last 1000)
    if (usedNoncesForOwner.size > 1000) {
      const sorted = Array.from(usedNoncesForOwner).sort((a, b) => a - b);
      const toRemove = sorted.slice(0, sorted.length - 1000);
      toRemove.forEach(n => usedNoncesForOwner!.delete(n));
    }
  }

  /**
   * Check if a nonce has been used
   */
  isNonceUsed(owner: string, nonce: number): boolean {
    const normalizedOwner = getAddress(owner).toLowerCase();
    return this.usedNonces.get(normalizedOwner)?.has(nonce) ?? false;
  }

  /**
   * Get the current nonce tracker for an owner
   */
  getUsedNonces(owner: string): number[] {
    const normalizedOwner = getAddress(owner).toLowerCase();
    const nonces = this.usedNonces.get(normalizedOwner);
    return nonces ? Array.from(nonces) : [];
  }
}

/**
 * Create a batch signature verifier instance
 */
export function createBatchSignatureVerifier(
  chainId: number,
  verifyingContract: string
): BatchSignatureVerifier {
  return new BatchSignatureVerifier(chainId, verifyingContract);
}

