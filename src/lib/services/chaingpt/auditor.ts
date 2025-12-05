import { GeneralChat } from '@chaingpt/generalchat';
import { logger } from '@/lib/utils';
import { ExternalApiError } from '@/lib/utils/errors';
import type { AuditResult, AuditFinding, RiskLevel } from '@/lib/types';
import { CONTRACT_AUDIT_PROMPT } from './prompts';
import { calculateRiskFromFindings } from '@/lib/types/contract';

// Lazy initialization of the GeneralChat client
let auditorClient: GeneralChat | null = null;

function getAuditorClient(): GeneralChat {
  if (!auditorClient) {
    const apiKey = process.env.CHAINGPT_API_KEY;
    
    if (!apiKey) {
      throw new ExternalApiError('ChainGPT', 'API key not configured');
    }

    auditorClient = new GeneralChat({
      apiKey,
    });
  }
  
  return auditorClient;
}

/**
 * Extract content from ChainGPT SDK response
 * The SDK returns { data: { bot: string } } format
 */
function extractContentFromResponse(response: unknown): string {
  // Handle string response
  if (typeof response === 'string') {
    return response;
  }
  
  // Handle object response - SDK returns { data: { bot: string } }
  if (response && typeof response === 'object') {
    const obj = response as Record<string, unknown>;
    
    // Check for nested data.bot structure (official SDK format)
    if (obj.data && typeof obj.data === 'object') {
      const data = obj.data as Record<string, unknown>;
      if (typeof data.bot === 'string') return data.bot;
      if (typeof data.response === 'string') return data.response;
      if (typeof data.message === 'string') return data.message;
      if (typeof data.content === 'string') return data.content;
    }
    
    // Try common response field names (fallback)
    if (typeof obj.botResponse === 'string') return obj.botResponse;
    if (typeof obj.bot === 'string') return obj.bot;
    if (typeof obj.response === 'string') return obj.response;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.content === 'string') return obj.content;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.answer === 'string') return obj.answer;
    
    // If data is a string directly
    if (typeof obj.data === 'string') return obj.data;
    
    // If it has a toString method that's not the default Object.toString
    if (obj.toString && obj.toString !== Object.prototype.toString) {
      const str = obj.toString();
      if (str !== '[object Object]') return str;
    }
    
    // Last resort: stringify the object for debugging
    logger.debug('ChainGPT response structure', { responseKeys: Object.keys(obj), response: JSON.stringify(obj).slice(0, 500) });
    return JSON.stringify(response);
  }
  
  return '';
}

/**
 * Audit a smart contract for security vulnerabilities
 */
export async function auditContract(
  sourceCode: string,
  options?: {
    contractName?: string;
    network?: 'testnet' | 'mainnet';
    includeGasOptimization?: boolean;
  }
): Promise<AuditResult> {
  const apiKey = process.env.CHAINGPT_API_KEY;
  
  if (!apiKey) {
    throw new ExternalApiError('ChainGPT', 'API key not configured');
  }

  logger.chainGptCall('contract-auditor', { 
    codeLength: sourceCode.length,
    contractName: options?.contractName 
  });

  const auditPrompt = buildAuditPrompt(sourceCode, options);

  try {
    const client = getAuditorClient();

    // Build the full question with system context
    const fullQuestion = `${CONTRACT_AUDIT_PROMPT}

---

${auditPrompt}`;

    // Use createChatBlob for non-streaming response
    const response = await client.createChatBlob({
      question: fullQuestion,
      chatHistory: 'off',
      useCustomContext: false,
    });

    // Extract the response content using helper function
    const auditResponse = extractContentFromResponse(response);

    if (!auditResponse) {
      throw new ExternalApiError('ChainGPT', 'Empty response from auditor');
    }

    // Parse the audit response
    const auditResult = parseAuditResponse(auditResponse);

    return auditResult;
  } catch (error) {
    if (error instanceof ExternalApiError) {
      throw error;
    }

    logger.error('Contract audit failed', error);
    return {
      success: false,
      riskLevel: 'HIGH',
      summary: 'Audit failed due to an error',
      majorFindings: [],
      mediumFindings: [],
      minorFindings: [],
      recommendations: ['Please try auditing again or contact support'],
      error: error instanceof Error ? error.message : 'Unknown error during audit',
    };
  }
}

/**
 * Build audit prompt with context
 */
function buildAuditPrompt(
  sourceCode: string,
  options?: {
    contractName?: string;
    network?: 'testnet' | 'mainnet';
    includeGasOptimization?: boolean;
  }
): string {
  let prompt = `Please audit the following Solidity smart contract:\n\n`;
  
  if (options?.contractName) {
    prompt += `Contract Name: ${options.contractName}\n`;
  }
  
  if (options?.network) {
    prompt += `Target Network: BNB Chain ${options.network}\n`;
  }

  prompt += `\n\`\`\`solidity\n${sourceCode}\n\`\`\`\n\n`;

  prompt += `Perform a comprehensive security audit checking for:
1. Reentrancy vulnerabilities
2. Access control issues
3. Integer overflow/underflow
4. Front-running vulnerabilities
5. Unchecked external calls
6. Logic errors and edge cases
7. Centralization risks
8. Oracle manipulation (if applicable)
9. Flash loan attack vectors (if applicable)`;

  if (options?.includeGasOptimization) {
    prompt += `\n10. Gas optimization opportunities`;
  }

  prompt += `\n\nReturn the audit results in the specified JSON format.`;

  return prompt;
}

/**
 * Parse audit response from ChainGPT
 */
function parseAuditResponse(response: string): AuditResult {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Validate and normalize the response
      const majorFindings = normalizeFindings(parsed.majorFindings || []);
      const mediumFindings = normalizeFindings(parsed.mediumFindings || []);
      const minorFindings = normalizeFindings(parsed.minorFindings || []);
      
      // Calculate risk level if not provided
      const riskLevel = parsed.riskLevel || calculateRiskFromFindings(
        majorFindings,
        mediumFindings,
        minorFindings
      );

      return {
        success: true,
        riskLevel: normalizeRiskLevel(riskLevel),
        summary: parsed.summary || 'Audit completed',
        majorFindings,
        mediumFindings,
        minorFindings,
        recommendations: parsed.recommendations || [],
      };
    }

    // If no JSON, parse as text
    return parseTextAuditResponse(response);
  } catch (error) {
    logger.error('Failed to parse audit response', error);
    return parseTextAuditResponse(response);
  }
}

/**
 * Parse text-based audit response
 */
function parseTextAuditResponse(response: string): AuditResult {
  const findings: AuditFinding[] = [];
  const recommendations: string[] = [];

  // Simple heuristic parsing
  const lines = response.split('\n');
  let currentSection = '';

  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    
    if (lowerLine.includes('critical') || lowerLine.includes('high risk')) {
      currentSection = 'major';
    } else if (lowerLine.includes('medium') || lowerLine.includes('warning')) {
      currentSection = 'medium';
    } else if (lowerLine.includes('low') || lowerLine.includes('minor') || lowerLine.includes('info')) {
      currentSection = 'minor';
    } else if (lowerLine.includes('recommend')) {
      currentSection = 'recommendations';
    }

    if (line.trim().startsWith('-') || line.trim().startsWith('•')) {
      const content = line.trim().slice(1).trim();
      if (currentSection === 'recommendations') {
        recommendations.push(content);
      } else if (currentSection && content) {
        findings.push({
          title: content.slice(0, 50),
          description: content,
          severity: currentSection === 'major' ? 'high' : currentSection === 'medium' ? 'medium' : 'low',
        });
      }
    }
  }

  const majorFindings = findings.filter(f => f.severity === 'high' || f.severity === 'critical');
  const mediumFindings = findings.filter(f => f.severity === 'medium');
  const minorFindings = findings.filter(f => f.severity === 'low' || f.severity === 'informational');

  const riskLevel = calculateRiskFromFindings(majorFindings, mediumFindings, minorFindings);

  return {
    success: true,
    riskLevel,
    summary: 'Audit completed - findings extracted from analysis',
    majorFindings,
    mediumFindings,
    minorFindings,
    recommendations,
  };
}

/**
 * Normalize findings array
 */
function normalizeFindings(findings: unknown[]): AuditFinding[] {
  if (!Array.isArray(findings)) return [];

  return findings.map((f: unknown) => {
    if (typeof f === 'string') {
      return {
        title: f.slice(0, 50),
        description: f,
        severity: 'medium' as const,
      };
    }
    
    if (typeof f === 'object' && f !== null) {
      const finding = f as Record<string, unknown>;
      return {
        title: String(finding.title || finding.name || 'Finding'),
        description: String(finding.description || finding.details || ''),
        severity: normalizeSeverity(finding.severity),
        location: finding.location ? String(finding.location) : undefined,
        recommendation: finding.recommendation ? String(finding.recommendation) : undefined,
      };
    }

    return {
      title: 'Unknown Finding',
      description: String(f),
      severity: 'medium' as const,
    };
  });
}

/**
 * Normalize severity string
 */
function normalizeSeverity(severity: unknown): AuditFinding['severity'] {
  const s = String(severity).toLowerCase();
  if (s.includes('critical')) return 'critical';
  if (s.includes('high')) return 'high';
  if (s.includes('medium')) return 'medium';
  if (s.includes('low')) return 'low';
  if (s.includes('info')) return 'informational';
  return 'medium';
}

/**
 * Normalize risk level string
 */
function normalizeRiskLevel(level: unknown): RiskLevel {
  const l = String(level).toUpperCase();
  if (l === 'LOW' || l === 'MEDIUM' || l === 'HIGH' || l === 'BLOCKED') {
    return l as RiskLevel;
  }
  if (l.includes('CRITICAL') || l.includes('BLOCK')) return 'BLOCKED';
  if (l.includes('HIGH')) return 'HIGH';
  if (l.includes('MED')) return 'MEDIUM';
  return 'LOW';
}

/**
 * Quick security check for a contract (lighter than full audit)
 */
export async function quickSecurityCheck(
  sourceCode: string
): Promise<{
  safe: boolean;
  issues: string[];
  riskLevel: RiskLevel;
}> {
  const issues: string[] = [];

  // Check for dangerous patterns
  if (sourceCode.includes('selfdestruct')) {
    issues.push('Contract contains selfdestruct function');
  }

  if (sourceCode.includes('delegatecall')) {
    issues.push('Contract uses delegatecall - potential proxy vulnerability');
  }

  if (sourceCode.includes('tx.origin')) {
    issues.push('Contract uses tx.origin - vulnerable to phishing attacks');
  }

  if (!sourceCode.includes('require') && !sourceCode.includes('revert')) {
    issues.push('Contract may lack proper input validation');
  }

  if (sourceCode.includes('transfer(') && !sourceCode.includes('nonReentrant')) {
    issues.push('External calls without reentrancy protection');
  }

  // Check for missing access control
  if (sourceCode.includes('public') && !sourceCode.includes('onlyOwner') && !sourceCode.includes('AccessControl')) {
    issues.push('Public functions may lack access control');
  }

  // Determine risk level
  let riskLevel: RiskLevel = 'LOW';
  if (issues.length >= 3) {
    riskLevel = 'HIGH';
  } else if (issues.length >= 1) {
    riskLevel = 'MEDIUM';
  }

  if (sourceCode.includes('selfdestruct') || sourceCode.includes('delegatecall')) {
    riskLevel = 'HIGH';
  }

  return {
    safe: issues.length === 0,
    issues,
    riskLevel,
  };
}
