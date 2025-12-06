import { NextRequest, NextResponse } from 'next/server';
import { getPendingTransfer, deletePendingTransfer, createTransactionExecutor } from '@/lib/services/q402';
import { buildTokenTransfer, createTransactionPreview, getTokenInfo } from '@/lib/services/web3';
import { createPolicyEngine } from '@/lib/services/policy';
import { applyTokenPolicy } from '@/lib/services/policy/enforcer';
import { getPolicyForSession } from '@/lib/services/policy/server';
import { formatErrorResponse, getErrorStatusCode, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/utils';
import { type NetworkType } from '@/lib/utils/constants';

/**
 * POST /api/transactions/prepare/pending
 * 
 * Retrieve a pending transfer (stored after approval) and prepare it for Q402 signing
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    
    const { pendingTransferId, sessionId, signerAddress } = body;
    
    if (!pendingTransferId) {
      throw new ValidationError('Pending transfer ID is required');
    }
    
    if (!signerAddress) {
      throw new ValidationError('Signer address is required');
    }

    logger.apiRequest('POST', '/api/transactions/prepare/pending', { 
      pendingTransferId,
      sessionId,
      signerAddress,
    });

    // Get the pending transfer
    const pendingTransfer = getPendingTransfer(pendingTransferId);
    
    if (!pendingTransfer) {
      logger.warn('Pending transfer not found', { pendingTransferId });
      return NextResponse.json({
        success: false,
        error: 'Pending transfer not found or expired. Please send your transfer request again.',
      }, { status: 404 });
    }

    logger.info('Found pending transfer', {
      pendingTransferId,
      tokenAddress: pendingTransfer.tokenAddress,
      recipient: pendingTransfer.recipientAddress,
      amount: pendingTransfer.amount,
    });

    const network = pendingTransfer.network as NetworkType;

    // Build the token transfer transaction
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
    const preview = await createTransactionPreview(
      'token_transfer',
      transferTx,
      {
        from: pendingTransfer.walletAddress,
        network,
        recipient: pendingTransfer.recipientAddress,
        tokenSymbol: tokenInfo.symbol || pendingTransfer.tokenSymbol,
        tokenAddress: pendingTransfer.tokenAddress,
        amount: pendingTransfer.amount,
      }
    );

    // Prepare Q402 request
    const policy = await getPolicyForSession(sessionId);
    const policyEngine = createPolicyEngine(policy, network);
    const policyDecision = applyTokenPolicy(
      await policyEngine.evaluate(
        'token_transfer',
        { targetAddress: pendingTransfer.recipientAddress, tokenAddress: pendingTransfer.tokenAddress },
        0,
        signerAddress
      ),
      policy,
      [pendingTransfer.tokenAddress]
    );

    if (!policyDecision.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: policyDecision.reasons.join('; '),
          policyDecision,
          preview,
        },
        { status: 403 }
      );
    }

    const executor = createTransactionExecutor(network);
    const preparation = await executor.prepareForExecution(
      transferTx,
      'token_transfer',
      `Transfer ${pendingTransfer.amount} ${tokenInfo.symbol || pendingTransfer.tokenSymbol}`,
      { allowed: true, riskLevel: 'LOW', reasons: [], warnings: [] },
      {
        ownerAddress: signerAddress,
        tokenAddress: pendingTransfer.tokenAddress,
        amount: pendingTransfer.amount,
        recipientAddress: pendingTransfer.recipientAddress,
      }
    );

    if (!preparation.allowed || !preparation.request) {
      throw new Error(preparation.rejectionReason || 'Failed to prepare transfer');
    }

    // Delete the pending transfer now that it's being processed
    deletePendingTransfer(pendingTransferId);

    const duration = Date.now() - startTime;
    logger.apiResponse('POST', '/api/transactions/prepare/pending', 200, duration);

    return NextResponse.json({
      success: true,
      requestId: preparation.request.id,
      typedData: preparation.typedData,
      preview,
      expiresAt: preparation.request.expiresAt,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Prepare pending transfer API error', error);
    logger.apiResponse('POST', '/api/transactions/prepare/pending', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

