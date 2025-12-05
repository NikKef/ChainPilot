import { NextRequest, NextResponse } from 'next/server';
import { initializeFacilitator, type SettleRequest } from '@/lib/services/facilitator';
import { formatErrorResponse, getErrorStatusCode, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/utils';

/**
 * POST /api/facilitator/settle
 * 
 * Submit a signed payment for on-chain settlement
 * 
 * This endpoint:
 * 1. Verifies the signature
 * 2. Checks budget limits
 * 3. Submits the transaction with gas sponsorship
 * 4. Returns the transaction hash
 * 
 * Request body:
 * {
 *   networkId: "bsc-testnet" | "bsc-mainnet",
 *   requestId: "unique-request-id",
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
 *   signerAddress: "0x...",
 *   transaction?: {  // Optional: for custom transactions
 *     to: "0x...",
 *     data: "0x...",
 *     value: "0"
 *   }
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

    if (!body.requestId) {
      throw new ValidationError('requestId is required');
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

    logger.apiRequest('POST', '/api/facilitator/settle', {
      networkId: body.networkId,
      requestId: body.requestId,
      signerAddress: body.signerAddress,
    });

    // Initialize facilitator for the network
    const network = body.networkId === 'bsc-mainnet' ? 'mainnet' : 'testnet';
    const facilitator = await initializeFacilitator(network);

    // Build settle request
    const settleRequest: SettleRequest = {
      networkId: body.networkId,
      requestId: body.requestId,
      witness: body.witness,
      signature: body.signature,
      signerAddress: body.signerAddress,
      transaction: body.transaction,
    };

    // Execute settlement
    const result = await facilitator.settle(settleRequest);

    const duration = Date.now() - startTime;
    const statusCode = result.success ? 200 : 400;
    logger.apiResponse('POST', '/api/facilitator/settle', statusCode, duration);

    if (result.success) {
      logger.info('Settlement successful', {
        requestId: body.requestId,
        txHash: result.txHash,
        gasUsed: result.gasUsed,
        duration,
      });
    } else {
      logger.warn('Settlement failed', {
        requestId: body.requestId,
        error: result.error,
        duration,
      });
    }

    return NextResponse.json(result, { status: statusCode });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Facilitator settle API error', { error: String(error) });
    logger.apiResponse('POST', '/api/facilitator/settle', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

