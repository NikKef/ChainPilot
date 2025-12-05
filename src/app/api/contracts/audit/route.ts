import { NextRequest, NextResponse } from 'next/server';
import { auditContract } from '@/lib/services/chaingpt';
import { getContractCode } from '@/lib/services/web3';
import type { AuditContractRequest, AuditContractResponse } from '@/lib/types';
import { formatErrorResponse, getErrorStatusCode, ValidationError } from '@/lib/utils/errors';
import { isValidAddress, isValidNetwork, isValidSolidityCode } from '@/lib/utils/validation';
import { logger } from '@/lib/utils';

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body: AuditContractRequest = await request.json();

    // Validate input
    if (!body.sessionId) {
      throw new ValidationError('Session ID is required');
    }

    if (!isValidNetwork(body.network)) {
      throw new ValidationError('Invalid network');
    }

    if (!body.address && !body.sourceCode) {
      throw new ValidationError('Either contract address or source code is required');
    }

    if (body.address && !isValidAddress(body.address)) {
      throw new ValidationError('Invalid contract address');
    }

    logger.apiRequest('POST', '/api/contracts/audit', { 
      sessionId: body.sessionId,
      hasAddress: !!body.address,
      hasSource: !!body.sourceCode 
    });

    let sourceCode = body.sourceCode;

    // If only address provided, try to fetch source code
    if (body.address && !sourceCode) {
      // In production, fetch from BSCScan API
      // For now, return an error
      const response: AuditContractResponse = {
        success: false,
        error: 'Source code fetching from address is not yet implemented. Please provide the source code directly.',
      };
      return NextResponse.json(response, { status: 400 });
    }

    if (!sourceCode || !isValidSolidityCode(sourceCode)) {
      throw new ValidationError('Invalid or empty Solidity source code');
    }

    // Perform audit
    const auditResult = await auditContract(sourceCode, {
      network: body.network,
    });

    // Create audit record
    const audit = {
      id: generateId(),
      contractId: '',
      riskLevel: auditResult.riskLevel,
      summary: auditResult.summary,
      majorFindings: auditResult.majorFindings,
      mediumFindings: auditResult.mediumFindings,
      minorFindings: auditResult.minorFindings,
      recommendations: auditResult.recommendations,
      createdAt: new Date().toISOString(),
    };

    const response: AuditContractResponse = {
      success: auditResult.success,
      audit,
      contract: body.address ? {
        id: generateId(),
        address: body.address,
        network: body.network,
        sourceCode,
        bytecode: null,
        abi: null,
        contractName: null,
        isGenerated: false,
        lastAuditId: audit.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } : undefined,
    };

    const duration = Date.now() - startTime;
    logger.apiResponse('POST', '/api/contracts/audit', 200, duration);

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Contract audit API error', error);
    logger.apiResponse('POST', '/api/contracts/audit', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

function generateId(): string {
  return `aud_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

