import { NextRequest, NextResponse } from 'next/server';
import { getFacilitatorService, initializeFacilitator } from '@/lib/services/facilitator';
import { formatErrorResponse, getErrorStatusCode } from '@/lib/utils/errors';
import { logger } from '@/lib/utils';

/**
 * GET /api/facilitator/health
 * 
 * Health check endpoint for the facilitator service
 * 
 * Response:
 * {
 *   status: "healthy" | "degraded" | "unhealthy",
 *   timestamp: "2024-01-01T00:00:00.000Z",
 *   version: "1.0.0",
 *   uptime: 123456,
 *   checks: [
 *     {
 *       name: "bsc-testnet_sponsor_balance",
 *       status: "pass" | "warn" | "fail",
 *       message: "Balance: 1.5 BNB"
 *     }
 *   ]
 * }
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    logger.apiRequest('GET', '/api/facilitator/health', {});

    // Try to initialize facilitator
    try {
      await initializeFacilitator('testnet');
    } catch (error) {
      // Facilitator not configured - return unhealthy status
      const health = {
        status: 'unhealthy' as const,
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        uptime: 0,
        checks: [
          {
            name: 'initialization',
            status: 'fail' as const,
            message: `Facilitator not configured: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };

      return NextResponse.json(health, { status: 503 });
    }

    const facilitator = getFacilitatorService();
    const health = await facilitator.getHealth();

    const duration = Date.now() - startTime;
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
    logger.apiResponse('GET', '/api/facilitator/health', statusCode, duration);

    return NextResponse.json(health, { status: statusCode });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Facilitator health API error', { error: String(error) });
    logger.apiResponse('GET', '/api/facilitator/health', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

/**
 * GET /api/facilitator/health/stats
 * 
 * Get facilitator statistics
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    logger.apiRequest('POST', '/api/facilitator/health/stats', {});

    const facilitator = getFacilitatorService();
    const stats = facilitator.getStats();

    const duration = Date.now() - startTime;
    logger.apiResponse('POST', '/api/facilitator/health/stats', 200, duration);

    return NextResponse.json({
      success: true,
      stats,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Facilitator stats API error', { error: String(error) });
    logger.apiResponse('POST', '/api/facilitator/health/stats', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

