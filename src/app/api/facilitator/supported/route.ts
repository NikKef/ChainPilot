import { NextRequest, NextResponse } from 'next/server';
import { getFacilitatorService, initializeFacilitator } from '@/lib/services/facilitator';
import { formatErrorResponse, getErrorStatusCode } from '@/lib/utils/errors';
import { logger } from '@/lib/utils';

/**
 * GET /api/facilitator/supported
 * 
 * Get list of supported networks and tokens
 * 
 * Response:
 * {
 *   networks: [
 *     {
 *       network: "bsc-testnet",
 *       chainId: 97,
 *       rpcUrl: "https://...",
 *       explorerUrl: "https://testnet.bscscan.com",
 *       implementationContract: "0x...",
 *       verifyingContract: "0x...",
 *       tokens: [
 *         { address: "0x...", symbol: "USDT", decimals: 18, name: "Tether USD" }
 *       ]
 *     }
 *   ]
 * }
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    logger.apiRequest('GET', '/api/facilitator/supported', {});

    // Try to initialize at least testnet
    try {
      await initializeFacilitator('testnet');
    } catch (error) {
      // Log but don't fail - facilitator may not be configured
      logger.warn('Failed to initialize facilitator for testnet', { error: String(error) });
    }

    const facilitator = getFacilitatorService();
    const supported = facilitator.getSupported();

    const duration = Date.now() - startTime;
    logger.apiResponse('GET', '/api/facilitator/supported', 200, duration);

    return NextResponse.json(supported);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Facilitator supported API error', { error: String(error) });
    logger.apiResponse('GET', '/api/facilitator/supported', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

