import { NextRequest, NextResponse } from 'next/server';
import { createTransactionExecutor } from '@/lib/services/q402';
import { createPolicyEngine } from '@/lib/services/policy';
import { applyTokenPolicy } from '@/lib/services/policy/enforcer';
import { getPolicyForSession } from '@/lib/services/policy/server';
import type { PrepareQ402Request, PrepareQ402Response } from '@/lib/types';
import { formatErrorResponse, getErrorStatusCode, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/utils';
import { type NetworkType } from '@/lib/utils/constants';

/**
 * POST /api/transactions/prepare/q402
 * 
 * Prepare a transaction for Q402 signing
 * Returns EIP-712 typed data for the user to sign
 * 
 * This is the first step in the Q402 sign-to-pay flow:
 * 1. Client sends transaction preview and policy decision
 * 2. Server creates Q402 payment request with EIP-712 typed data
 * 3. Client signs the typed data with user's wallet
 * 4. Client submits signature to /api/transactions/execute
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body: PrepareQ402Request = await request.json();

    // Validate required fields
    if (!body.sessionId) {
      throw new ValidationError('Session ID is required');
    }

    if (!body.preview) {
      throw new ValidationError('Transaction preview is required');
    }

    if (!body.policyDecision) {
      throw new ValidationError('Policy decision is required');
    }

    if (!body.signerAddress) {
      throw new ValidationError('Signer address is required');
    }

    logger.apiRequest('POST', '/api/transactions/prepare/q402', { 
      sessionId: body.sessionId,
      type: body.preview.type,
      signerAddress: body.signerAddress,
    });

    const network: NetworkType = body.preview.network;
    const policy = await getPolicyForSession(body.sessionId);
    const policyEngine = createPolicyEngine(policy, network);

    const baseDecision = await policyEngine.evaluate(
      body.preview.type,
      {
        tokenAddress: body.preview.tokenAddress || body.preview.tokenInAddress || undefined,
        targetAddress: body.preview.contractAddress || body.preview.to,
        slippageBps: body.preview.slippageBps,
      },
      0,
      body.signerAddress
    );

    const policyDecision = applyTokenPolicy(baseDecision, policy, [
      body.preview.tokenAddress,
      body.preview.tokenInAddress,
      body.preview.tokenOutAddress,
    ]);

    if (!policyDecision.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: policyDecision.reasons.join('; '),
          policyDecision,
        },
        { status: 403 }
      );
    }
    
    // Create transaction executor
    const executor = createTransactionExecutor(network);

    // Convert PolicyEvaluationResult to PolicyDecision format
    const policyDecisionForExecutor = {
      allowed: policyDecision.allowed,
      riskLevel: policyDecision.riskLevel,
      reasons: policyDecision.reasons,
      warnings: policyDecision.warnings.map(w => w.message),
    };

    // Prepare for Q402 execution
    // For transfers, body.preview.to is the actual recipient address
    const preparation = await executor.prepareForExecution(
      body.preview.preparedTx,
      body.preview.type,
      `${body.preview.type}: ${body.preview.tokenAmount || body.preview.nativeValue} ${body.preview.tokenSymbol || 'BNB'}`,
      policyDecisionForExecutor,
      {
        valueUsd: body.preview.valueUsd ? parseFloat(body.preview.valueUsd) : undefined,
        ownerAddress: body.signerAddress,
        tokenAddress: body.preview.tokenAddress,
        amount: body.preview.tokenAmount || body.preview.nativeValue,
        recipientAddress: body.preview.to, // The actual recipient of the transfer
      }
    );

    // Check if allowed by policy
    if (!preparation.allowed) {
      return NextResponse.json({
        success: false,
        error: preparation.rejectionReason || 'Transaction rejected by policy',
        riskLevel: preparation.riskLevel,
        warnings: preparation.warnings,
      }, { status: 403 });
    }

    // Build response with typed data for signing
    const response: PrepareQ402Response = {
      success: true,
      requestId: preparation.request!.id,
      typedData: {
        domain: preparation.typedData!.domain,
        types: preparation.typedData!.types,
        primaryType: preparation.typedData!.primaryType,
        message: preparation.typedData!.message,
      },
      expiresAt: preparation.request!.expiresAt,
    };

    const duration = Date.now() - startTime;
    logger.apiResponse('POST', '/api/transactions/prepare/q402', 200, duration);
    logger.q402('Transaction prepared for signing', {
      requestId: preparation.request!.id,
      type: body.preview.type,
      signerAddress: body.signerAddress,
      duration,
    });
    
    // Debug logging
    console.log('[Q402 Prepare] Response:', JSON.stringify(response, null, 2));

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Q402 prepare API error', error);
    logger.apiResponse('POST', '/api/transactions/prepare/q402', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

