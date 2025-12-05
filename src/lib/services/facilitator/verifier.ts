/**
 * Q402 Signature Verifier
 * 
 * Verifies EIP-712 witness signatures to ensure:
 * 1. The signature is valid
 * 2. The signer matches the claimed owner
 * 3. The deadline hasn't passed
 * 4. The nonce is valid (not already used)
 * 
 * @see https://github.com/quackai-labs/Q402
 */

import { 
  verifyTypedData, 
  TypedDataDomain,
  getAddress,
  isAddress,
} from 'ethers';
import type { Q402Witness } from '../q402/types';
import type { 
  VerifyRequest, 
  VerifyResponse, 
  EIP712Domain,
  NonceRecord,
  NonceValidation,
} from './types';
import { WITNESS_TYPES, FacilitatorErrorCode } from './types';
import { logger } from '@/lib/utils';

/**
 * Signature Verifier Service
 * 
 * Responsible for verifying EIP-712 typed data signatures
 */
export class SignatureVerifier {
  private domain: EIP712Domain;
  private nonceRecords: Map<string, NonceRecord> = new Map();
  
  constructor(
    chainId: number,
    verifyingContract: string
  ) {
    this.domain = {
      name: 'q402',
      version: '1',
      chainId,
      verifyingContract: getAddress(verifyingContract),
    };
  }

  /**
   * Verify an EIP-712 witness signature
   */
  async verify(request: VerifyRequest): Promise<VerifyResponse> {
    const { witness, signature, signerAddress } = request;

    try {
      // 1. Validate addresses
      if (!isAddress(signerAddress)) {
        return {
          valid: false,
          error: 'Invalid signer address format',
        };
      }

      if (!isAddress(witness.owner)) {
        return {
          valid: false,
          error: 'Invalid owner address in witness',
        };
      }

      if (!isAddress(witness.token)) {
        return {
          valid: false,
          error: 'Invalid token address in witness',
        };
      }

      if (!isAddress(witness.to)) {
        return {
          valid: false,
          error: 'Invalid recipient address in witness',
        };
      }

      // 2. Check deadline
      const now = Math.floor(Date.now() / 1000);
      if (witness.deadline <= now) {
        return {
          valid: false,
          error: `Witness expired. Deadline: ${witness.deadline}, Current: ${now}`,
        };
      }

      // 3. Validate nonce
      const nonceValidation = this.validateNonce(witness.owner, witness.nonce);
      if (!nonceValidation.valid) {
        return {
          valid: false,
          error: nonceValidation.error,
        };
      }

      // 4. Recover signer from signature
      const recoveredAddress = await this.recoverSigner(witness, signature);
      
      if (!recoveredAddress) {
        return {
          valid: false,
          error: 'Failed to recover signer from signature',
        };
      }

      // 5. Verify signer matches claimed signer and owner
      const normalizedRecovered = getAddress(recoveredAddress);
      const normalizedSigner = getAddress(signerAddress);
      const normalizedOwner = getAddress(witness.owner);

      if (normalizedRecovered !== normalizedSigner) {
        return {
          valid: false,
          error: `Signature mismatch. Recovered: ${normalizedRecovered}, Claimed: ${normalizedSigner}`,
          recovered: normalizedRecovered,
        };
      }

      if (normalizedRecovered !== normalizedOwner) {
        return {
          valid: false,
          error: `Signer is not the owner. Signer: ${normalizedRecovered}, Owner: ${normalizedOwner}`,
          recovered: normalizedRecovered,
        };
      }

      // 6. All checks passed
      logger.info('Signature verified successfully', {
        owner: normalizedOwner,
        token: witness.token,
        amount: witness.amount,
        nonce: witness.nonce,
      });

      return {
        valid: true,
        payer: normalizedOwner,
        amount: witness.amount,
        token: witness.token,
        nonce: witness.nonce,
        deadline: witness.deadline,
        recovered: normalizedRecovered,
      };
    } catch (error) {
      logger.error('Signature verification error', { error: String(error) });
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown verification error',
      };
    }
  }

  /**
   * Recover the signer address from an EIP-712 signature
   */
  async recoverSigner(witness: Q402Witness, signature: string): Promise<string | null> {
    try {
      // Prepare the typed data domain
      const domain: TypedDataDomain = {
        name: this.domain.name,
        version: this.domain.version,
        chainId: this.domain.chainId,
        verifyingContract: this.domain.verifyingContract,
      };

      // Prepare the typed data types
      const types = {
        Witness: WITNESS_TYPES.Witness.map(field => ({
          name: field.name,
          type: field.type,
        })),
      };

      // Prepare the message value
      const value = {
        owner: witness.owner,
        token: witness.token,
        amount: witness.amount,
        to: witness.to,
        deadline: witness.deadline,
        paymentId: witness.paymentId,
        nonce: witness.nonce,
      };

      // Verify and recover signer
      const recoveredAddress = verifyTypedData(domain, types, value, signature);
      
      return recoveredAddress;
    } catch (error) {
      logger.error('Failed to recover signer', { error: String(error) });
      return null;
    }
  }

  /**
   * Validate nonce for an address
   */
  validateNonce(address: string, nonce: number): NonceValidation {
    const normalizedAddress = getAddress(address).toLowerCase();
    const record = this.nonceRecords.get(normalizedAddress);

    if (!record) {
      // First transaction from this address
      return {
        valid: true,
        currentNonce: 0,
      };
    }

    // Check if nonce was already used
    if (record.usedNonces.has(nonce)) {
      return {
        valid: false,
        currentNonce: record.currentNonce,
        error: `Nonce ${nonce} already used for address ${address}`,
      };
    }

    // Nonce should be >= current nonce (allow gaps for parallel transactions)
    if (nonce < record.currentNonce) {
      return {
        valid: false,
        currentNonce: record.currentNonce,
        error: `Nonce ${nonce} is less than current nonce ${record.currentNonce}`,
      };
    }

    return {
      valid: true,
      currentNonce: record.currentNonce,
    };
  }

  /**
   * Mark a nonce as used after successful settlement
   */
  markNonceUsed(address: string, nonce: number): void {
    const normalizedAddress = getAddress(address).toLowerCase();
    let record = this.nonceRecords.get(normalizedAddress);

    if (!record) {
      record = {
        address: normalizedAddress,
        currentNonce: 0,
        usedNonces: new Set(),
        lastUpdated: Date.now(),
      };
      this.nonceRecords.set(normalizedAddress, record);
    }

    record.usedNonces.add(nonce);
    record.currentNonce = Math.max(record.currentNonce, nonce + 1);
    record.lastUpdated = Date.now();

    logger.info('Nonce marked as used', {
      address: normalizedAddress,
      nonce,
      newCurrentNonce: record.currentNonce,
    });
  }

  /**
   * Get current nonce for an address
   */
  getCurrentNonce(address: string): number {
    const normalizedAddress = getAddress(address).toLowerCase();
    const record = this.nonceRecords.get(normalizedAddress);
    return record?.currentNonce ?? 0;
  }

  /**
   * Get the EIP-712 domain
   */
  getDomain(): EIP712Domain {
    return { ...this.domain };
  }

  /**
   * Update the domain (e.g., when switching networks)
   */
  updateDomain(chainId: number, verifyingContract: string): void {
    this.domain = {
      name: 'q402',
      version: '1',
      chainId,
      verifyingContract: getAddress(verifyingContract),
    };
  }

  /**
   * Clean up old nonce records (housekeeping)
   */
  cleanupOldRecords(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [address, record] of this.nonceRecords.entries()) {
      if (now - record.lastUpdated > maxAgeMs) {
        this.nonceRecords.delete(address);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info('Cleaned up old nonce records', { count: cleaned });
    }

    return cleaned;
  }
}

/**
 * Create a signature verifier instance
 */
export function createSignatureVerifier(
  chainId: number,
  verifyingContract: string
): SignatureVerifier {
  return new SignatureVerifier(chainId, verifyingContract);
}

