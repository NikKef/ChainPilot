import { NextRequest, NextResponse } from 'next/server';
import { generateContract, auditContract } from '@/lib/services/chaingpt';
import type { GenerateContractRequest, GenerateContractResponse } from '@/lib/types';
import { formatErrorResponse, getErrorStatusCode, ValidationError } from '@/lib/utils/errors';
import { validateContractSpec, isValidNetwork } from '@/lib/utils/validation';
import { logger } from '@/lib/utils';

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body: GenerateContractRequest = await request.json();

    // Validate input
    const validation = validateContractSpec(body.specText);
    if (!validation.valid) {
      throw new ValidationError(validation.error || 'Invalid specification');
    }

    if (!body.sessionId) {
      throw new ValidationError('Session ID is required');
    }

    if (!isValidNetwork(body.network)) {
      throw new ValidationError('Invalid network');
    }

    logger.apiRequest('POST', '/api/contracts/generate', { 
      sessionId: body.sessionId,
      specLength: body.specText.length 
    });

    // Generate contract
    const result = await generateContract(body.specText);

    if (!result.success || !result.sourceCode) {
      const response: GenerateContractResponse = {
        success: false,
        error: result.error || 'Failed to generate contract',
      };
      return NextResponse.json(response);
    }

    // Auto-audit the generated contract
    const auditResult = await auditContract(result.sourceCode, {
      contractName: result.contractName,
      network: body.network,
    });

    const response: GenerateContractResponse = {
      success: true,
      contract: {
        id: generateId(),
        sessionId: body.sessionId,
        contractId: null,
        specText: body.specText,
        sourceCode: result.sourceCode,
        network: body.network,
        deployedAddress: null,
        deploymentTxHash: null,
        createdAt: new Date().toISOString(),
        deployedAt: null,
      },
      auditResult,
    };

    const duration = Date.now() - startTime;
    logger.apiResponse('POST', '/api/contracts/generate', 200, duration);

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Contract generation API error', error);
    logger.apiResponse('POST', '/api/contracts/generate', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

function generateId(): string {
  return `gen_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

