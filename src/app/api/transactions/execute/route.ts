import { NextRequest, NextResponse } from 'next/server';
import { createQ402Service, createTransactionExecutor } from '@/lib/services/q402';
import { createServerActivityLog, getSessionInfo } from '@/lib/services/activity/server';
import type { ExecuteTransactionRequest, ExecuteTransactionResponse, ActionLog } from '@/lib/types';
import { formatErrorResponse, getErrorStatusCode, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/utils';
import { type NetworkType, NETWORKS } from '@/lib/utils/constants';

/**
 * POST /api/transactions/execute
 * 
 * Execute a signed transaction through Q402 facilitator
 * This endpoint handles the final step of the sign-to-pay flow:
 * 1. Validates the signature
 * 2. Submits to Q402 facilitator for gas-sponsored execution
 * 3. Logs the activity to the database
 * 4. Returns the transaction hash and execution result
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body: ExecuteTransactionRequest = await request.json();

    // Validate required fields
    if (!body.sessionId) {
      throw new ValidationError('Session ID is required');
    }

    if (!body.actionLogId) {
      throw new ValidationError('Action log ID (Q402 request ID) is required');
    }

    if (!body.signature) {
      throw new ValidationError('Signature is required for Q402 execution');
    }

    if (!body.signerAddress) {
      throw new ValidationError('Signer address is required');
    }

    logger.apiRequest('POST', '/api/transactions/execute', { 
      sessionId: body.sessionId,
      actionLogId: body.actionLogId,
      signerAddress: body.signerAddress,
    });

    // Get session info to determine network
    const sessionInfo = await getSessionInfo(body.sessionId);
    const network: NetworkType = (body.network as NetworkType) || sessionInfo?.network || 'testnet';
    
    // Create Q402 service for the network
    const q402Service = createQ402Service(network);

    // Execute the transaction through Q402 facilitator
    // This handles:
    // - Signature verification
    // - Gas sponsorship
    // - On-chain execution
    const result = await q402Service.executeTransaction(
      body.actionLogId,
      body.signature,
      body.signerAddress
    );

    // Log the activity to the database
    const activityLog = await createServerActivityLog({
      sessionId: body.sessionId,
      intentType: 'transfer', // Default to transfer, ideally this would be passed from the client
      network,
      txHash: result.txHash,
      q402RequestId: result.q402RequestId,
      status: result.success ? 'executed' : 'failed',
      errorMessage: result.error,
    });

    // Create action log entry for response
    const actionLog: ActionLog = activityLog || {
      id: body.actionLogId,
      sessionId: body.sessionId,
      intentType: 'transfer', // Would be determined from original request
      network,
      txHash: result.txHash,
      q402RequestId: result.q402RequestId,
      status: result.success ? 'executed' : 'failed',
      errorMessage: result.error,
      createdAt: new Date().toISOString(),
      executedAt: result.success ? new Date().toISOString() : undefined,
    };

    // Build response
    const response: ExecuteTransactionResponse = {
      success: result.success,
      result: {
        success: result.success,
        txHash: result.txHash,
        blockNumber: result.blockNumber,
        gasUsed: result.gasUsed,
        error: result.error,
        q402RequestId: result.q402RequestId,
      },
      actionLog,
      // Include explorer URL for easy verification
      explorerUrl: result.txHash 
        ? `${NETWORKS[network].explorerUrl}/tx/${result.txHash}`
        : undefined,
    };

    const duration = Date.now() - startTime;
    logger.apiResponse('POST', '/api/transactions/execute', 200, duration);
    logger.q402('Transaction executed', {
      requestId: body.actionLogId,
      txHash: result.txHash,
      success: result.success,
      duration,
    });

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Transaction execute API error', error);
    logger.apiResponse('POST', '/api/transactions/execute', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

/**
 * GET /api/transactions/execute/status
 * 
 * Get the status of a Q402 transaction
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get('requestId');
    const network = (searchParams.get('network') as NetworkType) || 'testnet';

    if (!requestId) {
      throw new ValidationError('Request ID is required');
    }

    logger.apiRequest('GET', '/api/transactions/execute', { requestId });

    const q402Service = createQ402Service(network);
    const status = await q402Service.getStatus(requestId);

    const duration = Date.now() - startTime;
    logger.apiResponse('GET', '/api/transactions/execute', 200, duration);

    return NextResponse.json({
      success: true,
      ...status,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Transaction status API error', error);
    logger.apiResponse('GET', '/api/transactions/execute', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}
