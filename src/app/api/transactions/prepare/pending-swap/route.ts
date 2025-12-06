import { NextRequest, NextResponse } from 'next/server';
import { getPendingSwap, deletePendingSwap, createTransactionExecutor } from '@/lib/services/q402';
import { buildSwap, createTransactionPreview, getTokenInfo } from '@/lib/services/web3';
import { formatErrorResponse, getErrorStatusCode, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/utils';
import { type NetworkType, PANCAKE_ROUTER } from '@/lib/utils/constants';
import { formatUnits } from 'ethers';

/**
 * POST /api/transactions/prepare/pending-swap
 * 
 * Retrieve a pending swap (stored after approval) and prepare it for Q402 signing
 * This is called after the user has approved the PancakeSwap router to spend their tokens
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    
    const { pendingSwapId, sessionId, signerAddress } = body;
    
    if (!pendingSwapId) {
      throw new ValidationError('Pending swap ID is required');
    }
    
    if (!signerAddress) {
      throw new ValidationError('Signer address is required');
    }

    logger.apiRequest('POST', '/api/transactions/prepare/pending-swap', { 
      pendingSwapId,
      sessionId,
      signerAddress,
    });

    // Get the pending swap
    const pendingSwap = getPendingSwap(pendingSwapId);
    
    if (!pendingSwap) {
      logger.warn('Pending swap not found', { pendingSwapId });
      return NextResponse.json({
        success: false,
        error: 'Pending swap not found or expired. Please send your swap request again.',
      }, { status: 404 });
    }

    logger.info('Found pending swap', {
      pendingSwapId,
      tokenIn: pendingSwap.tokenIn,
      tokenOut: pendingSwap.tokenOut,
      amount: pendingSwap.amount,
      slippageBps: pendingSwap.slippageBps,
    });

    const network = pendingSwap.network as NetworkType;

    // Build the swap transaction (this will go through Q402 - gas sponsored)
    const swapResult = await buildSwap(
      pendingSwap.walletAddress,
      pendingSwap.tokenIn,
      pendingSwap.tokenOut,
      pendingSwap.amount,
      network,
      pendingSwap.slippageBps
    );

    // Get token info for preview
    const tokenInInfo = await getTokenInfo(pendingSwap.tokenIn, network);
    const tokenOutInfo = pendingSwap.tokenOut 
      ? await getTokenInfo(pendingSwap.tokenOut, network)
      : { symbol: 'BNB', decimals: 18 };

    // Format output amount
    const formattedOutput = formatUnits(swapResult.quote.amountOut, tokenOutInfo.decimals);

    // Create preview
    const preview = await createTransactionPreview(
      'swap',
      swapResult.preparedTx,
      {
        from: pendingSwap.walletAddress,
        network,
        amount: pendingSwap.amount,
        tokenInSymbol: tokenInInfo.symbol || pendingSwap.tokenInSymbol,
        tokenOutSymbol: tokenOutInfo.symbol || pendingSwap.tokenOutSymbol,
        tokenOutAmount: formattedOutput,
        slippageBps: pendingSwap.slippageBps,
      }
    );

    // Prepare Q402 request for gas-sponsored execution
    const executor = createTransactionExecutor(network);
    const routerAddress = PANCAKE_ROUTER[network];
    
    const preparation = await executor.prepareForExecution(
      swapResult.preparedTx,
      'swap',
      `Swap ${pendingSwap.amount} ${tokenInInfo.symbol || pendingSwap.tokenInSymbol} for ${formattedOutput} ${tokenOutInfo.symbol || pendingSwap.tokenOutSymbol}`,
      { allowed: true, riskLevel: 'LOW', reasons: [], warnings: [] },
      {
        ownerAddress: signerAddress,
        tokenAddress: pendingSwap.tokenIn,
        amount: pendingSwap.amount,
        recipientAddress: routerAddress, // The swap goes to the router
      }
    );

    if (!preparation.allowed || !preparation.request) {
      throw new Error(preparation.rejectionReason || 'Failed to prepare swap');
    }

    // Delete the pending swap now that it's being processed
    deletePendingSwap(pendingSwapId);

    const duration = Date.now() - startTime;
    logger.apiResponse('POST', '/api/transactions/prepare/pending-swap', 200, duration);

    return NextResponse.json({
      success: true,
      requestId: preparation.request.id,
      typedData: preparation.typedData,
      preview,
      expiresAt: preparation.request.expiresAt,
      swapDetails: {
        tokenIn: pendingSwap.tokenIn,
        tokenInSymbol: tokenInInfo.symbol || pendingSwap.tokenInSymbol,
        tokenOut: pendingSwap.tokenOut,
        tokenOutSymbol: tokenOutInfo.symbol || pendingSwap.tokenOutSymbol,
        amountIn: pendingSwap.amount,
        amountOut: formattedOutput,
        amountOutMin: formatUnits(swapResult.quote.amountOutMin, tokenOutInfo.decimals),
        slippageBps: pendingSwap.slippageBps,
        priceImpact: swapResult.quote.priceImpact,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Prepare pending swap API error', error);
    logger.apiResponse('POST', '/api/transactions/prepare/pending-swap', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

