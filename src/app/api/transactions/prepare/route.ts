import { NextRequest, NextResponse } from 'next/server';
import { 
  buildNativeTransfer, 
  buildTokenTransfer, 
  buildSwap,
  buildContractCall,
  createTransactionPreview 
} from '@/lib/services/web3';
import { createPolicyEngine, getDefaultPolicy } from '@/lib/services/policy';
import type { 
  PrepareTransactionRequest, 
  PrepareTransactionResponse,
  TransferIntent,
  SwapIntent,
  ContractCallIntent,
} from '@/lib/types';
import { formatErrorResponse, getErrorStatusCode, ValidationError } from '@/lib/utils/errors';
import { isValidNetwork } from '@/lib/utils/validation';
import { logger } from '@/lib/utils';
import { type NetworkType } from '@/lib/utils/constants';

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body: PrepareTransactionRequest = await request.json();

    if (!body.sessionId) {
      throw new ValidationError('Session ID is required');
    }

    if (!body.intent) {
      throw new ValidationError('Intent is required');
    }

    const network: NetworkType = (body.intent.network as NetworkType) || 'testnet';
    const walletAddress = '0x0000000000000000000000000000000000000000'; // Placeholder

    logger.apiRequest('POST', '/api/transactions/prepare', { 
      sessionId: body.sessionId,
      intentType: body.intent.type 
    });

    let preview;
    const policy = getDefaultPolicy(body.sessionId);
    const policyEngine = createPolicyEngine(policy, network);

    switch (body.intent.type) {
      case 'transfer': {
        const intent = body.intent as TransferIntent;
        if (!intent.to || !intent.amount) {
          throw new ValidationError('Transfer requires to address and amount');
        }

        const preparedTx = intent.tokenAddress
          ? await buildTokenTransfer(walletAddress, intent.to, intent.tokenAddress, intent.amount, network)
          : await buildNativeTransfer(walletAddress, intent.to, intent.amount, network);

        preview = await createTransactionPreview(
          intent.tokenAddress ? 'token_transfer' : 'transfer',
          preparedTx,
          {
            from: walletAddress,
            network,
            tokenSymbol: intent.tokenSymbol || 'BNB',
            tokenAddress: intent.tokenAddress || undefined,
            amount: intent.amount,
          }
        );
        break;
      }

      case 'swap': {
        const intent = body.intent as SwapIntent;
        if (!intent.amount) {
          throw new ValidationError('Swap requires amount');
        }

        const swapResult = await buildSwap(
          walletAddress,
          intent.tokenIn || null,
          intent.tokenOut || null,
          intent.amount,
          network,
          intent.slippageBps || 300
        );

        preview = await createTransactionPreview(
          'swap',
          swapResult.preparedTx,
          {
            from: walletAddress,
            network,
            amount: intent.amount,
            tokenInSymbol: intent.tokenInSymbol || 'Token',
            tokenOutSymbol: intent.tokenOutSymbol || 'Token',
            tokenOutAmount: swapResult.quote.amountOut,
            slippageBps: intent.slippageBps || 300,
          }
        );
        break;
      }

      case 'contract_call': {
        const intent = body.intent as ContractCallIntent;
        if (!intent.contractAddress || !intent.method) {
          throw new ValidationError('Contract call requires address and method');
        }

        // For demo, use a basic ABI
        const basicAbi = [`function ${intent.method}() external`];
        const preparedTx = await buildContractCall(
          walletAddress,
          intent.contractAddress,
          basicAbi,
          intent.method,
          intent.args || [],
          intent.value || '0',
          network
        );

        preview = await createTransactionPreview(
          'contract_call',
          preparedTx,
          {
            from: walletAddress,
            network,
            methodName: intent.method,
            methodArgs: intent.args,
          }
        );
        break;
      }

      default:
        throw new ValidationError(`Unsupported intent type: ${body.intent.type}`);
    }

    // Evaluate policy
    const policyDecision = await policyEngine.evaluate(
      body.intent.type,
      {},
      0,
      walletAddress
    );

    const response: PrepareTransactionResponse = {
      success: true,
      preview,
      policyDecision,
    };

    const duration = Date.now() - startTime;
    logger.apiResponse('POST', '/api/transactions/prepare', 200, duration);

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Transaction prepare API error', error);
    logger.apiResponse('POST', '/api/transactions/prepare', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

