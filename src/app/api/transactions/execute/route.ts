import { NextRequest, NextResponse } from 'next/server';
import { createQ402Service, createTransactionExecutor, getPendingTransfer, deletePendingTransfer } from '@/lib/services/q402';
import { getSessionInfo } from '@/lib/services/activity/server';
import { buildTokenTransfer, createTransactionPreview, getTokenInfo } from '@/lib/services/web3';
import type { ExecuteTransactionRequest, ExecuteTransactionResponse, ActionLog, TransactionPreview } from '@/lib/types';
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
 * 3. Returns the transaction hash and execution result
 * 
 * NOTE: Activity logging is handled by the client (useChat hook) which has
 * access to more context like the user message and transaction preview.
 * This avoids duplicate logging.
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

    // Create action log entry for response (not persisted here - client handles logging)
    const actionLog: ActionLog = {
      id: body.actionLogId,
      sessionId: body.sessionId,
      intentType: 'transfer',
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

    // Check if there's a pending transfer to follow up on (after approval)
    if (result.success && body.pendingTransferId) {
      const pendingTransfer = getPendingTransfer(body.pendingTransferId);
      
      if (pendingTransfer) {
        logger.info('Found pending transfer after approval', {
          pendingTransferId: body.pendingTransferId,
          tokenAddress: pendingTransfer.tokenAddress,
          recipient: pendingTransfer.recipientAddress,
          amount: pendingTransfer.amount,
        });
        
        try {
          // Build the transfer transaction
          const transferTx = await buildTokenTransfer(
            pendingTransfer.walletAddress,
            pendingTransfer.recipientAddress,
            pendingTransfer.tokenAddress,
            pendingTransfer.amount,
            network
          );
          
          // Get token info for preview
          const tokenInfo = await getTokenInfo(pendingTransfer.tokenAddress, network);
          
          // Create preview
          const transferPreview: TransactionPreview = await createTransactionPreview(
            'token_transfer',
            transferTx,
            {
              from: pendingTransfer.walletAddress,
              network,
              recipient: pendingTransfer.recipientAddress,
              tokenSymbol: tokenInfo.symbol,
              tokenAddress: pendingTransfer.tokenAddress,
              amount: pendingTransfer.amount,
            }
          );
          
          // Prepare Q402 request for the transfer
          const executor = createTransactionExecutor(network);
          const transferPreparation = await executor.prepareForExecution(
            transferTx,
            'token_transfer',
            `Transfer ${pendingTransfer.amount} ${tokenInfo.symbol}`,
            { allowed: true, riskLevel: 'LOW', reasons: [], warnings: [] },
            {
              ownerAddress: pendingTransfer.walletAddress,
              tokenAddress: pendingTransfer.tokenAddress,
              amount: pendingTransfer.amount,
              recipientAddress: pendingTransfer.recipientAddress,
            }
          );
          
          if (transferPreparation.allowed && transferPreparation.request) {
            // Add the next transaction to the response
            response.nextTransaction = {
              message: `Approval confirmed! Now signing the transfer of ${pendingTransfer.amount} ${tokenInfo.symbol} to ${pendingTransfer.recipientAddress.slice(0, 10)}...`,
              requestId: transferPreparation.request.id,
              typedData: transferPreparation.typedData,
              preview: transferPreview,
              expiresAt: transferPreparation.request.expiresAt,
            };
            
            logger.info('Prepared follow-up transfer transaction', {
              transferRequestId: transferPreparation.request.id,
              recipient: pendingTransfer.recipientAddress,
              amount: pendingTransfer.amount,
            });
          }
          
          // Delete the pending transfer
          deletePendingTransfer(body.pendingTransferId);
        } catch (error) {
          logger.error('Failed to prepare follow-up transfer', { error });
          // Don't fail the response, just log the error
        }
      }
    }

    const duration = Date.now() - startTime;
    logger.apiResponse('POST', '/api/transactions/execute', 200, duration);
    logger.q402('Transaction executed', {
      requestId: body.actionLogId,
      txHash: result.txHash,
      success: result.success,
      hasNextTransaction: !!response.nextTransaction,
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
