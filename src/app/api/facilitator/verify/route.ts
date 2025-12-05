import { NextRequest, NextResponse } from 'next/server';
import { initializeFacilitator, type VerifyRequest } from '@/lib/services/facilitator';
import { formatErrorResponse, getErrorStatusCode, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/utils';

/**
 * POST /api/facilitator/verify
 * 
 * Verify an EIP-712 witness signature
 * 
 * This endpoint verifies that:
 * 1. The signature is valid
 * 2. The signer matches the claimed owner
 * 3. The deadline hasn't passed
 * 4. The nonce is valid
 * 
 * Request body:
 * {
 *   networkId: "bsc-testnet" | "bsc-mainnet",
 *   witness: {
 *     owner: "0x...",
 *     token: "0x...",
 *     amount: "1000000",
 *     to: "0x...",
 *     deadline: 1735660000,
 *     paymentId: "0x...",
 *     nonce: 0
 *   },
 *   signature: "0x...",
 *   signerAddress: "0x..."
 * }
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();

    // Validate required fields
    if (!body.networkId) {
      throw new ValidationError('networkId is required');
    }

    if (!body.witness) {
      throw new ValidationError('witness is required');
    }

    if (!body.signature) {
      throw new ValidationError('signature is required');
    }

    if (!body.signerAddress) {
      throw new ValidationError('signerAddress is required');
    }

    logger.apiRequest('POST', '/api/facilitator/verify', {
      networkId: body.networkId,
      signerAddress: body.signerAddress,
    });

    // Initialize facilitator for the network
    const network = body.networkId === 'bsc-mainnet' ? 'mainnet' : 'testnet';
    const facilitator = await initializeFacilitator(network);

    // Verify the signature
    const verifyRequest: VerifyRequest = {
      networkId: body.networkId,
      witness: body.witness,
      signature: body.signature,
      signerAddress: body.signerAddress,
    };

    const result = await facilitator.verify(verifyRequest);

    const duration = Date.now() - startTime;
    logger.apiResponse('POST', '/api/facilitator/verify', result.valid ? 200 : 400, duration);

    if (!result.valid) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Facilitator verify API error', { error: String(error) });
    logger.apiResponse('POST', '/api/facilitator/verify', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

