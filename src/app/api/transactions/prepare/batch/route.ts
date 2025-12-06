import { NextRequest, NextResponse } from 'next/server';
import { createQ402Client, createQ402Service } from '@/lib/services/q402';
import type { BatchOperation, BatchPaymentRequest, BatchSignedMessage } from '@/lib/services/q402/types';
import { buildSwap, getSwapQuote, getTokenInfo } from '@/lib/services/web3';
import { createPolicyEngine } from '@/lib/services/policy';
import { applyTokenPolicy } from '@/lib/services/policy/enforcer';
import { getPolicyForSession } from '@/lib/services/policy/server';
import { formatErrorResponse, getErrorStatusCode, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/utils';
import { type NetworkType, PANCAKE_ROUTER, TOKENS } from '@/lib/utils/constants';
import { parseUnits, formatUnits, Interface } from 'ethers';
import type { PolicyEvaluationResult, RiskLevel } from '@/lib/types';

/**
 * Operation input from client
 */
interface OperationInput {
  type: 'transfer' | 'swap' | 'call';
  // For transfers
  tokenAddress?: string;
  tokenSymbol?: string;
  recipient?: string;
  amount?: string;
  // For swaps
  tokenIn?: string;
  tokenInSymbol?: string;
  tokenOut?: string;
  tokenOutSymbol?: string;
  slippageBps?: number;
  swapRecipient?: string; // Optional: send swap output to different address
  // For calls
  contractAddress?: string;
  methodName?: string;
  params?: unknown[];
  data?: string;
  // For linked operations (e.g., transfer using swap output)
  _linkedToSwapOutput?: boolean;
}

/**
 * Batch prepare request
 */
interface BatchPrepareRequest {
  sessionId: string;
  network: NetworkType;
  signerAddress: string;
  operations: OperationInput[];
}

/**
 * Batch prepare response
 */
interface BatchPrepareResponse {
  success: boolean;
  requestId?: string;
  typedData?: BatchSignedMessage;
  operations?: BatchOperation[];
  preview?: {
    operationCount: number;
    totalValueUsd?: number;
    estimatedGasSaved?: string;
    operations: Array<{
      type: string;
      description: string;
      tokenIn?: string;
      tokenInSymbol?: string;
      amountIn?: string;
      tokenOut?: string;
      tokenOutSymbol?: string;
      amountOut?: string;
    }>;
  };
  expiresAt?: string;
  error?: string;
  approvalNeeded?: {
    tokenAddress: string;
    tokenSymbol: string;
    batchExecutorAddress: string;
    currentAllowance: string;
    requiredAmount: string;
  };
}

/**
 * POST /api/transactions/prepare/batch
 * 
 * Prepare a batch of operations for Q402 signing
 * Returns EIP-712 typed data for the user to sign once for all operations
 * 
 * This enables gas-sponsored execution of multiple operations (transfers, swaps, calls)
 * in a single transaction, with the user only signing once.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body: BatchPrepareRequest = await request.json();

    // Validate required fields
    if (!body.sessionId) {
      throw new ValidationError('Session ID is required');
    }

    if (!body.network) {
      throw new ValidationError('Network is required');
    }

    if (!body.signerAddress) {
      throw new ValidationError('Signer address is required');
    }

    if (!body.operations || body.operations.length === 0) {
      throw new ValidationError('At least one operation is required');
    }

    if (body.operations.length > 10) {
      throw new ValidationError('Maximum 10 operations per batch');
    }

    logger.apiRequest('POST', '/api/transactions/prepare/batch', { 
      sessionId: body.sessionId,
      network: body.network,
      signerAddress: body.signerAddress,
      operationCount: body.operations.length,
    });

    const network: NetworkType = body.network;
    const client = createQ402Client(network);
    const routerAddress = PANCAKE_ROUTER[network];
    const policy = await getPolicyForSession(body.sessionId);
    const policyEngine = createPolicyEngine(policy, network);
    const RISK_ORDER: Record<RiskLevel, number> = {
      LOW: 0,
      MEDIUM: 1,
      HIGH: 2,
      BLOCKED: 3,
    };
    const evaluateWithPolicy = async (
      transactionType: string,
      params: Parameters<typeof policyEngine.evaluate>[1] & { extraTokenAddresses?: Array<string | null | undefined> }
    ) => {
      const { extraTokenAddresses = [], ...policyParams } = params;
      const decision = await policyEngine.evaluate(
        transactionType,
        policyParams,
        0,
        body.signerAddress
      );
      return applyTokenPolicy(decision, policy, [
        policyParams.tokenAddress,
        ...extraTokenAddresses,
      ]);
    };
    const mergeDecisions = (decisions: PolicyEvaluationResult[]): PolicyEvaluationResult => {
      const violations = decisions.flatMap(d => d.violations);
      const warnings = decisions.flatMap(d => d.warnings);
      const riskLevel = decisions.reduce<RiskLevel>(
        (current, d) => (RISK_ORDER[d.riskLevel] > RISK_ORDER[current] ? d.riskLevel : current),
        'LOW'
      );
      const allowed = !violations.some(v => v.severity === 'blocking');
      const reasons = [
        ...violations.map(v => v.message),
        ...warnings.map(w => w.message),
      ];
      return { allowed, riskLevel, violations, warnings, reasons };
    };

    // Check if BatchExecutor is deployed
    const batchExecutorAddress = client.getBatchExecutorAddress();
    if (!batchExecutorAddress) {
      throw new ValidationError('BatchExecutor not deployed on this network. Please use individual transactions.');
    }

    // Build operations
    const batchOperations: BatchOperation[] = [];
    const previewOperations: Array<{
      type: string;
      description: string;
      tokenIn?: string;
      tokenInSymbol?: string;
      amountIn?: string;
      tokenOut?: string;
      tokenOutSymbol?: string;
      amountOut?: string;
    }> = [];
    let totalValueUsd = 0;
    const tokensNeedingApproval: Set<string> = new Set();

    // Track previous swap output for linked transfers
    let lastSwapOutput: {
      tokenAddress: string;
      tokenSymbol: string;
      amountOutMin: string;
      decimals: number;
      formattedAmount: string;
    } | null = null;

    for (const op of body.operations) {
      if (op.type === 'transfer') {
        // Check if this transfer is linked to the previous swap's output
        const isLinkedToSwap = op._linkedToSwapOutput && lastSwapOutput;
        
        // Use swap output token and amount if linked
        const tokenIn = isLinkedToSwap 
          ? lastSwapOutput!.tokenAddress 
          : (op.tokenAddress || '0x0000000000000000000000000000000000000000');
        const isNative = tokenIn === '0x0000000000000000000000000000000000000000';
        
        let amountInWei: string;
        let decimals = 18;
        let tokenSymbol = op.tokenSymbol || 'BNB';
        let formattedAmount = op.amount || '0';

        if (isLinkedToSwap && lastSwapOutput) {
          // Use the swap output amount (minAmountOut ensures we have at least this much)
          amountInWei = lastSwapOutput.amountOutMin;
          decimals = lastSwapOutput.decimals;
          tokenSymbol = lastSwapOutput.tokenSymbol;
          formattedAmount = lastSwapOutput.formattedAmount;
          // No need to check approval - we'll receive these tokens from the swap
        } else if (!isNative && op.tokenAddress) {
          const tokenInfo = await getTokenInfo(op.tokenAddress, network);
          decimals = tokenInfo.decimals;
          tokenSymbol = tokenInfo.symbol;
          amountInWei = parseUnits(op.amount || '0', decimals).toString();
          
          // Check approval
          const approvalCheck = await client.checkBatchApprovalNeeded(
            op.tokenAddress,
            body.signerAddress,
            amountInWei
          );
          if (approvalCheck.needsApproval) {
            tokensNeedingApproval.add(op.tokenAddress);
          }
        } else {
          amountInWei = parseUnits(op.amount || '0', 18).toString();
        }

        batchOperations.push({
          type: 'transfer',
          tokenIn,
          amountIn: amountInWei,
          tokenOut: '0x0000000000000000000000000000000000000000',
          minAmountOut: '0',
          target: op.recipient || '0x0000000000000000000000000000000000000000',
          data: '0x',
          description: `Transfer ${isLinkedToSwap ? '~' : ''}${formattedAmount} ${tokenSymbol} to ${op.recipient?.slice(0, 10)}...`,
          tokenInSymbol: tokenSymbol,
          formattedAmountIn: formattedAmount,
        });

        previewOperations.push({
          type: 'transfer',
          description: `Transfer ${isLinkedToSwap ? '~' : ''}${formattedAmount} ${tokenSymbol}`,
          tokenIn,
          tokenInSymbol: tokenSymbol,
          amountIn: formattedAmount,
        });

      } else if (op.type === 'swap') {
        // Build swap operation
        const tokenInAddress = op.tokenIn || '0x0000000000000000000000000000000000000000';
        const tokenOutAddress = op.tokenOut || '0x0000000000000000000000000000000000000000';
        const isNativeIn = !op.tokenIn || tokenInAddress === '0x0000000000000000000000000000000000000000';
        const isNativeOut = !op.tokenOut || tokenOutAddress === '0x0000000000000000000000000000000000000000';
        const slippageBps = op.slippageBps || 300;

        // Get swap quote
        const quote = await getSwapQuote(
          isNativeIn ? 'native' : tokenInAddress,
          isNativeOut ? 'native' : tokenOutAddress,
          op.amount || '0',
          network,
          slippageBps
        );

        // Get token info
        let tokenInSymbol = op.tokenInSymbol || 'BNB';
        let tokenOutSymbol = op.tokenOutSymbol || 'BNB';
        let tokenInDecimals = 18;
        let tokenOutDecimals = 18;

        if (!isNativeIn && op.tokenIn) {
          const tokenInfo = await getTokenInfo(op.tokenIn, network);
          tokenInSymbol = tokenInfo.symbol;
          tokenInDecimals = tokenInfo.decimals;
          
          // Check approval for swap
          const approvalCheck = await client.checkBatchApprovalNeeded(
            op.tokenIn,
            body.signerAddress,
            quote.amountIn
          );
          if (approvalCheck.needsApproval) {
            tokensNeedingApproval.add(op.tokenIn);
          }
        }

        if (!isNativeOut && op.tokenOut) {
          const tokenInfo = await getTokenInfo(op.tokenOut, network);
          tokenOutSymbol = tokenInfo.symbol;
          tokenOutDecimals = tokenInfo.decimals;
        }

        // Build swap calldata for PancakeSwap router
        const WBNB = TOKENS[network].WBNB;
        const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes
        
        // LIMITATION: BatchExecutor contract checks owner's balance before/after swaps
        // Custom recipients don't work because output goes to recipient, not owner
        // Always send output to the signer (user) for BatchExecutor compatibility
        const swapOutputRecipient = body.signerAddress;
        
        let swapData: string;
        const routerIface = new Interface([
          'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
          'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
          'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
        ]);

        if (isNativeIn) {
          // BNB -> Token
          swapData = routerIface.encodeFunctionData('swapExactETHForTokens', [
            quote.amountOutMin,
            quote.path,
            swapOutputRecipient, // Output goes to specified recipient
            deadline,
          ]);
        } else if (isNativeOut) {
          // Token -> BNB
          swapData = routerIface.encodeFunctionData('swapExactTokensForETH', [
            quote.amountIn,
            quote.amountOutMin,
            quote.path,
            swapOutputRecipient,
            deadline,
          ]);
        } else {
          // Token -> Token
          swapData = routerIface.encodeFunctionData('swapExactTokensForTokens', [
            quote.amountIn,
            quote.amountOutMin,
            quote.path,
            swapOutputRecipient,
            deadline,
          ]);
        }

        const formattedAmountOut = formatUnits(quote.amountOut, tokenOutDecimals);

        batchOperations.push({
          type: 'swap',
          tokenIn: isNativeIn ? '0x0000000000000000000000000000000000000000' : op.tokenIn!,
          amountIn: quote.amountIn,
          tokenOut: isNativeOut ? '0x0000000000000000000000000000000000000000' : op.tokenOut!,
          minAmountOut: quote.amountOutMin,
          target: routerAddress,
          data: swapData,
          description: `Swap ${op.amount} ${tokenInSymbol} for ~${formattedAmountOut} ${tokenOutSymbol}`,
          tokenInSymbol,
          tokenOutSymbol,
          formattedAmountIn: op.amount,
          formattedAmountOut,
          slippageBps,
        });

        previewOperations.push({
          type: 'swap',
          description: `Swap ${op.amount} ${tokenInSymbol} → ${tokenOutSymbol}`,
          tokenIn: isNativeIn ? '0x0000000000000000000000000000000000000000' : op.tokenIn,
          tokenInSymbol,
          amountIn: op.amount,
          tokenOut: isNativeOut ? '0x0000000000000000000000000000000000000000' : op.tokenOut,
          tokenOutSymbol,
          amountOut: formattedAmountOut,
        });

        // Track swap output for linked transfers
        lastSwapOutput = {
          tokenAddress: isNativeOut ? '0x0000000000000000000000000000000000000000' : op.tokenOut!,
          tokenSymbol: tokenOutSymbol,
          amountOutMin: quote.amountOutMin,
          decimals: tokenOutDecimals,
          formattedAmount: formattedAmountOut,
        };

      } else if (op.type === 'call') {
        // Build arbitrary call operation
        batchOperations.push({
          type: 'call',
          tokenIn: op.tokenAddress || '0x0000000000000000000000000000000000000000',
          amountIn: op.amount ? parseUnits(op.amount, 18).toString() : '0',
          tokenOut: '0x0000000000000000000000000000000000000000',
          minAmountOut: '0',
          target: op.contractAddress || '0x0000000000000000000000000000000000000000',
          data: op.data || '0x',
          description: `Call ${op.methodName || 'function'} on ${op.contractAddress?.slice(0, 10)}...`,
        });

        previewOperations.push({
          type: 'call',
          description: `Call ${op.methodName || 'contract function'}`,
        });
      }
    }

    const opPolicyDecisions = await Promise.all(
      batchOperations.map(op => {
        if (op.type === 'swap') {
          return evaluateWithPolicy('swap', {
            tokenAddress: op.tokenIn || undefined,
            targetAddress: op.target,
            slippageBps: (op as unknown as { slippageBps?: number }).slippageBps,
            extraTokenAddresses: [op.tokenOut],
          });
        }

        if (op.type === 'transfer') {
          return evaluateWithPolicy('transfer', {
            tokenAddress: op.tokenIn || undefined,
            targetAddress: op.target,
          });
        }

        // Default to contract call evaluation
        return evaluateWithPolicy('contract_call', {
          tokenAddress: op.tokenIn || undefined,
          targetAddress: op.target,
        });
      })
    );

    const policyDecision = mergeDecisions(opPolicyDecisions);
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

    // Check if any tokens need approval first
    if (tokensNeedingApproval.size > 0) {
      const firstToken = Array.from(tokensNeedingApproval)[0];
      const tokenInfo = await getTokenInfo(firstToken, network);
      const approvalCheck = await client.checkBatchApprovalNeeded(
        firstToken,
        body.signerAddress,
        batchOperations.find(op => op.tokenIn === firstToken)?.amountIn || '0'
      );

      const response: BatchPrepareResponse = {
        success: false,
        error: 'Token approval required before batch execution',
        approvalNeeded: {
          tokenAddress: firstToken,
          tokenSymbol: tokenInfo.symbol,
          batchExecutorAddress: approvalCheck.batchExecutorAddress,
          currentAllowance: approvalCheck.currentAllowance.toString(),
          requiredAmount: approvalCheck.requiredAmount.toString(),
        },
      };

      return NextResponse.json(response);
    }

    // Create batch payment request
    const batchRequest = await client.createBatchPaymentRequest(
      batchOperations,
      body.signerAddress,
      {
        action: 'batch_execution',
        description: `Batch of ${batchOperations.length} operations`,
        totalValueUsd,
      }
    );

    // Create typed data for signing
    const typedData = client.createBatchTypedDataForSigning(batchRequest);

    // Build response
    const response: BatchPrepareResponse = {
      success: true,
      requestId: batchRequest.id,
      typedData,
      operations: batchOperations,
      preview: {
        operationCount: batchOperations.length,
        totalValueUsd: totalValueUsd > 0 ? totalValueUsd : undefined,
        estimatedGasSaved: `~${(batchOperations.length - 1) * 21000} gas`,
        operations: previewOperations,
      },
      expiresAt: batchRequest.expiresAt,
    };

    const duration = Date.now() - startTime;
    logger.apiResponse('POST', '/api/transactions/prepare/batch', 200, duration);
    logger.q402('Batch prepared for signing', {
      requestId: batchRequest.id,
      operationCount: batchOperations.length,
      signerAddress: body.signerAddress,
      duration,
    });

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Batch prepare API error', error);
    logger.apiResponse('POST', '/api/transactions/prepare/batch', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

