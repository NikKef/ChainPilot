import { logger } from '@/lib/utils';
import { ExternalApiError } from '@/lib/utils/errors';
import type { AuditResult, AuditFinding, RiskLevel } from '@/lib/types';
import { CONTRACT_AUDIT_PROMPT } from './prompts';
import { calculateRiskFromFindings } from '@/lib/types/contract';
import { fetchContractSource } from '@/lib/services/web3/contract-source';

// ChainGPT Smart Contract Auditor API endpoint
const CHAINGPT_AUDITOR_API_URL = 'https://api.chaingpt.org/chat/stream';
const CHAINGPT_AUDITOR_MODEL = 'smart_contract_auditor';

/**
 * Audit a smart contract for security vulnerabilities using ChainGPT Smart Contract Auditor API
 * Can audit by contract address (fetches source from block explorer) or by source code directly
 */
export async function auditContract(
  sourceCodeOrAddress: string,
  options?: {
    contractName?: string;
    network?: 'testnet' | 'mainnet';
    includeGasOptimization?: boolean;
    isContractAddress?: boolean; // If true, sourceCodeOrAddress is treated as a contract address
    chain?: string; // Explicit chain name (e.g., 'BNB', 'Ethereum', 'BSC Mainnet')
  }
): Promise<AuditResult> {
  const apiKey = process.env.CHAINGPT_API_KEY;
  
  if (!apiKey) {
    throw new ExternalApiError('ChainGPT', 'API key not configured');
  }

  // Validate input
  if (!sourceCodeOrAddress || sourceCodeOrAddress.trim().length === 0) {
    logger.warn('auditContract called with empty input');
    return {
      success: false,
      riskLevel: 'HIGH',
      summary: 'No contract address or source code provided for audit',
      majorFindings: [],
      mediumFindings: [],
      minorFindings: [],
      recommendations: ['Please provide a contract address or source code to audit'],
      error: 'No input provided',
    };
  }

  // Detect if input is a contract address
  const isAddress = options?.isContractAddress ?? /^0x[a-fA-F0-9]{40}$/.test(sourceCodeOrAddress.trim());
  
  logger.chainGptCall('contract-auditor', { 
    inputLength: sourceCodeOrAddress.length,
    isAddress,
    contractName: options?.contractName,
    network: options?.network,
    chain: options?.chain,
  });

  // If it's a contract address, we need to fetch the source code first
  // ChainGPT Smart Contract Auditor API requires actual Solidity code, not just an address
  let sourceCode = sourceCodeOrAddress;
  let contractName = options?.contractName;
  
  if (isAddress) {
    // Determine the network for fetching source code
    const fetchNetwork = getNetworkFromChain(options?.chain, options?.network);
    
    logger.info('Fetching contract source code from block explorer', { 
      address: sourceCodeOrAddress,
      network: fetchNetwork,
      chain: options?.chain,
    });
    
    const sourceResult = await fetchContractSource(sourceCodeOrAddress.trim(), fetchNetwork);
    
    if (!sourceResult.success || !sourceResult.sourceCode) {
      logger.warn('Failed to fetch contract source code', { 
        address: sourceCodeOrAddress,
        error: sourceResult.error,
      });
      
      return {
        success: false,
        riskLevel: 'HIGH',
        summary: `Unable to fetch contract source code: ${sourceResult.error || 'Contract not verified'}`,
        majorFindings: [],
        mediumFindings: [],
        minorFindings: [],
        recommendations: [
          'Verify the contract source code on BscScan/Etherscan',
          'Or paste the source code directly for auditing'
        ],
        error: sourceResult.error || 'Contract source code not available',
      };
    }
    
    sourceCode = sourceResult.sourceCode;
    contractName = contractName || sourceResult.contractName;
    
    logger.info('Successfully fetched contract source code', { 
      address: sourceCodeOrAddress,
      contractName,
      sourceLength: sourceCode.length,
    });
  }

  // Build the audit prompt with the source code
  const auditPrompt = buildAuditPrompt(sourceCode, {
    ...options,
    contractName,
  });

  try {
    logger.debug('Sending audit request to ChainGPT Smart Contract Auditor API', { 
      sourceCodeLength: sourceCode.length,
      contractName,
      model: CHAINGPT_AUDITOR_MODEL,
    });

    // Make direct HTTP request to ChainGPT Smart Contract Auditor API
    const response = await fetch(CHAINGPT_AUDITOR_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CHAINGPT_AUDITOR_MODEL,
        question: auditPrompt,
        chatHistory: 'off',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('ChainGPT Auditor API error', { status: response.status, error: errorText });
      throw new ExternalApiError('ChainGPT', `API error ${response.status}: ${errorText}`);
    }

    // Read the streaming response
    const auditResponse = await readStreamResponse(response);

    if (!auditResponse) {
      throw new ExternalApiError('ChainGPT', 'Empty response from auditor');
    }

    logger.debug('Received audit response from ChainGPT Smart Contract Auditor', { 
      responseLength: auditResponse.length,
      responsePreview: auditResponse.slice(0, 500),
    });

    // Parse the audit response
    const auditResult = parseAuditResponse(auditResponse);

    logger.info('Contract audit completed', {
      isAddress,
      contractAddress: isAddress ? sourceCodeOrAddress : undefined,
      contractName: options?.contractName,
      riskLevel: auditResult.riskLevel,
      majorFindingsCount: auditResult.majorFindings.length,
      mediumFindingsCount: auditResult.mediumFindings.length,
      minorFindingsCount: auditResult.minorFindings.length,
    });

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
 * Read streaming response from ChainGPT API
 */
async function readStreamResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new ExternalApiError('ChainGPT', 'No response body');
  }

  const decoder = new TextDecoder();
  let result = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
    }
    // Flush any remaining bytes
    result += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  return result;
}

/**
 * Get blockchain name from network type (for display/prompts)
 */
function getChainName(network?: 'testnet' | 'mainnet', explicitChain?: string): string {
  // If explicit chain provided, use it
  if (explicitChain) {
    return explicitChain;
  }
  
  // Default to BNB Chain based on network
  if (network === 'testnet') {
    return 'BNB Smart Chain Testnet';
  }
  return 'BNB Smart Chain'; // Default to mainnet
}

/**
 * Determine the network (testnet/mainnet) from chain name for fetching source code
 * Currently only supports BNB Chain, but can be extended for other chains
 */
function getNetworkFromChain(chain?: string, fallbackNetwork?: 'testnet' | 'mainnet'): 'testnet' | 'mainnet' {
  if (chain) {
    const normalizedChain = chain.toLowerCase();
    
    // Check for testnet indicators
    if (normalizedChain.includes('testnet') || normalizedChain.includes('test')) {
      return 'testnet';
    }
    
    // BSC/BNB Mainnet indicators
    if (normalizedChain.includes('mainnet') || 
        normalizedChain === 'bnb' || 
        normalizedChain === 'bsc' ||
        normalizedChain.includes('smart chain')) {
      return 'mainnet';
    }
  }
  
  // Fall back to provided network or default to mainnet
  return fallbackNetwork || 'mainnet';
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
    chain?: string;
  }
): string {
  const chainName = getChainName(options?.network, options?.chain);
  
  let prompt = `Please audit the following Solidity smart contract for ${chainName}:\n\n`;
  
  if (options?.contractName) {
    prompt += `Contract Name: ${options.contractName}\n`;
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
 * Parse audit response from ChainGPT Smart Contract Auditor API
 * Formats the response with vulnerabilities shown first
 */
function parseAuditResponse(response: string): AuditResult {
  logger.info('Parsing audit response', { responseLength: response.length });
  
  // Try to extract JSON from the response
  let jsonData: Record<string, unknown> | null = null;
  
  // Try to find JSON in code blocks first
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      jsonData = JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Not valid JSON in code block
    }
  }
  
  // Try to find raw JSON object
  if (!jsonData) {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        jsonData = JSON.parse(jsonMatch[0]);
      } catch {
        // Not valid JSON
      }
    }
  }
  
  // If we found JSON, format it properly
  if (jsonData) {
    const formatted = formatAuditJson(jsonData);
    const hasVulnerabilities = formatted.includes('🔴');
    
    return {
      success: true,
      riskLevel: hasVulnerabilities ? 'HIGH' : 'LOW',
      summary: formatted,
      majorFindings: [],
      mediumFindings: [],
      minorFindings: [],
      recommendations: [],
      rawResponse: response,
    };
  }
  
  // If no JSON found, return raw response
  return {
    success: true,
    riskLevel: 'MEDIUM',
    summary: response,
    majorFindings: [],
    mediumFindings: [],
    minorFindings: [],
    recommendations: [],
    rawResponse: response,
  };
}

/**
 * Format audit JSON into readable markdown
 * Outputs everything as-is without icons (ChainGPT response formats vary too much)
 */
function formatAuditJson(json: Record<string, unknown>): string {
  const lines: string[] = [];
  
  const contractName = json.contractName || 'Contract';
  lines.push(`### Security Audit: ${contractName}\n`);
  
  // Handle "issues" array format
  if (Array.isArray(json.issues)) {
    for (const issue of json.issues) {
      const item = issue as Record<string, unknown>;
      const type = (item.type || item.title || 'Issue') as string;
      const description = (item.description || item.details || '') as string;
      const recommendation = (item.recommendation || '') as string;
      
      lines.push(`#### ${type}`);
      if (description) {
        lines.push(`${description}\n`);
      }
      if (recommendation) {
        lines.push(`**Recommendation:** ${recommendation}\n`);
      }
    }
  }
  
  // Handle "auditResults" object format
  const auditResults = (json.auditResults || json.audit_results || json.audit) as Record<string, unknown> | undefined;
  if (auditResults && typeof auditResults === 'object' && !Array.isArray(json.issues)) {
    for (const [category, value] of Object.entries(auditResults)) {
      if (typeof value === 'object' && value !== null) {
        const item = value as Record<string, unknown>;
        const name = formatCategoryName(category);
        const details = (item.details || item.description || '') as string;
        const recommendation = (item.recommendation || '') as string;
        
        lines.push(`#### ${name}`);
        if (details) {
          lines.push(`${details}\n`);
        }
        if (recommendation) {
          lines.push(`**Recommendation:** ${recommendation}\n`);
        }
      }
    }
  }
  
  // Handle "findings" array format
  if (Array.isArray((json.audit as Record<string, unknown>)?.findings)) {
    const findings = (json.audit as { findings: Array<Record<string, unknown>> }).findings;
    for (const finding of findings) {
      const title = (finding.issue || finding.title || 'Finding') as string;
      const description = (finding.description || finding.details || '') as string;
      const recommendation = (finding.recommendation || '') as string;
      
      lines.push(`#### ${title}`);
      if (description) {
        lines.push(`${description}\n`);
      }
      if (recommendation) {
        lines.push(`**Recommendation:** ${recommendation}\n`);
      }
    }
  }
  
  // Show any top-level recommendations
  if (Array.isArray(json.recommendations)) {
    lines.push(`#### Recommendations\n`);
    for (const rec of json.recommendations) {
      lines.push(`- ${rec}`);
    }
  }
  
  // Show summary/conclusion if present
  if (json.summary) {
    lines.push(`\n#### Summary\n${json.summary}`);
  }
  if (json.conclusion) {
    lines.push(`\n#### Conclusion\n${json.conclusion}`);
  }
  
  return lines.join('\n');
}

/**
 * Format category name from camelCase/snake_case to Title Case
 */
function formatCategoryName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .trim();
}

/**
 * Parse ChainGPT's findings array format
 * Format: { audit: { contractName, findings: [{ issue, description, severity, recommendation }] } }
 */
function parseChainGPTFindingsFormat(parsed: Record<string, unknown>): AuditResult {
  const audit = parsed.audit as { contractName?: string; findings: Array<{ issue: string; description: string; severity: string; recommendation: string }> };
  const contractName = audit.contractName || 'Unknown';
  const findings = audit.findings || [];
  
  const allFindings: AuditFinding[] = findings.map(f => ({
    title: f.issue || 'Finding',
    description: f.description || '',
    severity: normalizeSeverityString(f.severity),
    recommendation: f.recommendation,
  }));
  
  // Categorize by severity
  const majorFindings = allFindings.filter(f => f.severity === 'high' || f.severity === 'critical');
  const mediumFindings = allFindings.filter(f => f.severity === 'medium');
  const minorFindings = allFindings.filter(f => f.severity === 'low' || f.severity === 'informational');
  
  // Collect all recommendations
  const recommendations = allFindings
    .filter(f => f.recommendation)
    .map(f => f.recommendation as string);
  
  // Calculate risk level
  const riskLevel = calculateRiskFromFindings(majorFindings, mediumFindings, minorFindings);
  
  // Build summary
  const summary = `Security audit of ${contractName} completed. Found ${allFindings.length} item(s): ${majorFindings.length} high, ${mediumFindings.length} medium, ${minorFindings.length} low severity.`;
  
  logger.info('Parsed ChainGPT findings format', {
    contractName,
    totalFindings: allFindings.length,
    majorCount: majorFindings.length,
    mediumCount: mediumFindings.length,
    minorCount: minorFindings.length,
  });
  
  return {
    success: true,
    riskLevel,
    summary,
    majorFindings,
    mediumFindings,
    minorFindings,
    recommendations: [...new Set(recommendations)],
  };
}

/**
 * Normalize severity string to standard format
 */
function normalizeSeverityString(severity: string): AuditFinding['severity'] {
  const lower = (severity || '').toLowerCase();
  if (lower.includes('critical')) return 'critical';
  if (lower.includes('high')) return 'high';
  if (lower.includes('medium') || lower.includes('moderate')) return 'medium';
  if (lower.includes('low') || lower.includes('minor')) return 'low';
  if (lower.includes('info') || lower.includes('note')) return 'informational';
  return 'medium';
}

/**
 * Parse ChainGPT's specific audit_results format
 * Format: { contract_name, audit_results: { category: { issue, recommendation } } }
 */
function parseChainGPTAuditFormat(parsed: Record<string, unknown>): AuditResult {
  const auditResults = parsed.audit_results as Record<string, { issue?: string; recommendation?: string }>;
  const contractName = parsed.contract_name as string || 'Unknown';
  
  const findings: AuditFinding[] = [];
  const recommendations: string[] = [];
  
  // Process each audit category
  for (const [category, result] of Object.entries(auditResults)) {
    if (!result || typeof result !== 'object') continue;
    
    const issue = result.issue || '';
    const recommendation = result.recommendation || '';
    
    // Determine severity based on category and issue content
    const severity = determineSeverityFromCategory(category, issue);
    
    // Create a readable title from the category
    const title = formatCategoryTitle(category);
    
    // Add finding if there's an actual issue (not just "no issues found")
    const hasIssue = issue && 
      !issue.toLowerCase().includes('no direct') &&
      !issue.toLowerCase().includes('no issues') &&
      !issue.toLowerCase().includes('not found') &&
      !issue.toLowerCase().includes('no vulnerabilities');
    
    if (hasIssue) {
      findings.push({
        title,
        description: issue,
        severity,
        recommendation,
      });
    }
    
    // Collect recommendations even if no issue
    if (recommendation && !recommendations.includes(recommendation)) {
      recommendations.push(recommendation);
    }
  }
  
  // Categorize findings by severity
  const majorFindings = findings.filter(f => f.severity === 'high' || f.severity === 'critical');
  const mediumFindings = findings.filter(f => f.severity === 'medium');
  const minorFindings = findings.filter(f => f.severity === 'low' || f.severity === 'informational');
  
  // Calculate risk level
  const riskLevel = calculateRiskFromFindings(majorFindings, mediumFindings, minorFindings);
  
  // Build summary
  const totalIssues = findings.length;
  const summary = totalIssues === 0 
    ? `Security audit of ${contractName} completed. No critical vulnerabilities found.`
    : `Security audit of ${contractName} identified ${totalIssues} issue(s): ${majorFindings.length} high, ${mediumFindings.length} medium, ${minorFindings.length} low severity.`;
  
  return {
    success: true,
    riskLevel,
    summary,
    majorFindings,
    mediumFindings,
    minorFindings,
    recommendations,
  };
}

/**
 * Format audit category name to readable title
 */
function formatCategoryTitle(category: string): string {
  return category
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Determine severity from category name and issue content
 */
function determineSeverityFromCategory(category: string, issue: string): AuditFinding['severity'] {
  const lowerCategory = category.toLowerCase();
  const lowerIssue = issue.toLowerCase();
  
  // High severity categories
  if (lowerCategory.includes('reentrancy') ||
      lowerCategory.includes('access_control') ||
      lowerCategory.includes('overflow') ||
      lowerCategory.includes('underflow') ||
      lowerIssue.includes('manipulate') ||
      lowerIssue.includes('without adequate checks') ||
      lowerIssue.includes('unauthorized')) {
    return 'high';
  }
  
  // Medium severity categories
  if (lowerCategory.includes('front_running') ||
      lowerCategory.includes('unchecked') ||
      lowerCategory.includes('logic_error') ||
      lowerCategory.includes('centralization')) {
    return 'medium';
  }
  
  // Low severity categories
  if (lowerCategory.includes('gas') ||
      lowerCategory.includes('optimization') ||
      lowerCategory.includes('oracle') ||
      lowerCategory.includes('flash_loan')) {
    return 'low';
  }
  
  return 'medium';
}

/**
 * Parse text-based audit response from ChainGPT Smart Contract Auditor
 * Handles structured text with sections like "Findings", "Recommendations", etc.
 */
function parseTextAuditResponse(response: string): AuditResult {
  const findings: AuditFinding[] = [];
  const recommendations: string[] = [];
  let summary = '';

  // Extract summary if present
  const summaryMatch = response.match(/(?:Audit Summary|Summary|Overview)[:\s]*\n?([\s\S]*?)(?=\n\n|Findings|$)/i);
  if (summaryMatch) {
    summary = summaryMatch[1].trim().split('\n')[0].trim();
  }

  // Split by double newlines or finding headers to identify sections
  const lines = response.split('\n');
  let currentFinding: { title: string; description: string; recommendation?: string } | null = null;
  let currentSection = '';
  let inRecommendationSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lowerLine = line.toLowerCase();
    
    // Detect section changes
    if (lowerLine.includes('findings') && !lowerLine.includes('no findings')) {
      currentSection = 'findings';
      inRecommendationSection = false;
      continue;
    } else if (lowerLine === 'conclusion' || lowerLine.startsWith('conclusion')) {
      // Extract conclusion as part of summary
      if (!summary) {
        const conclusionText = lines.slice(i + 1).join(' ').trim();
        summary = conclusionText.slice(0, 200);
      }
      break;
    }
    
    // Detect individual findings by numbered items or bold markers
    // e.g., "1. Unprotected Function:" or "**Unprotected Function:**"
    const findingMatch = line.match(/^(?:\d+\.\s*|\*\*)?([A-Z][^:]+)[:]\s*$/i) ||
                         line.match(/^(?:\d+\.\s*|\*\*)?(.+?)[:]\s*$/);
    
    if (findingMatch && line.endsWith(':') && currentSection === 'findings') {
      // Save previous finding
      if (currentFinding) {
        findings.push({
          title: currentFinding.title,
          description: currentFinding.description,
          severity: determineSeverity(currentFinding.title + ' ' + currentFinding.description),
          recommendation: currentFinding.recommendation,
        });
      }
      currentFinding = { title: findingMatch[1].replace(/\*\*/g, '').trim(), description: '' };
      inRecommendationSection = false;
      continue;
    }
    
    // Check for recommendation within a finding
    if (currentFinding && lowerLine.startsWith('recommendation:')) {
      inRecommendationSection = true;
      const recText = line.replace(/^recommendation:\s*/i, '').trim();
      if (recText) {
        currentFinding.recommendation = recText;
        recommendations.push(recText);
      }
      continue;
    }
    
    // Add content to current finding
    if (currentFinding && line && !lowerLine.startsWith('recommendation')) {
      if (inRecommendationSection) {
        currentFinding.recommendation = (currentFinding.recommendation || '') + ' ' + line;
        recommendations.push(line);
      } else {
        currentFinding.description += (currentFinding.description ? ' ' : '') + line;
      }
    }
  }
  
  // Don't forget the last finding
  if (currentFinding) {
    findings.push({
      title: currentFinding.title,
      description: currentFinding.description,
      severity: determineSeverity(currentFinding.title + ' ' + currentFinding.description),
      recommendation: currentFinding.recommendation,
    });
  }

  // Categorize findings by severity
  const majorFindings = findings.filter(f => f.severity === 'high' || f.severity === 'critical');
  const mediumFindings = findings.filter(f => f.severity === 'medium');
  const minorFindings = findings.filter(f => f.severity === 'low' || f.severity === 'informational');

  // Calculate risk level
  const riskLevel = calculateRiskFromFindings(majorFindings, mediumFindings, minorFindings);

  // Generate summary if not extracted
  if (!summary) {
    const totalFindings = findings.length;
    if (totalFindings === 0) {
      summary = 'No significant security issues were identified in the audit.';
    } else {
      summary = `Audit identified ${totalFindings} finding(s): ${majorFindings.length} critical/high, ${mediumFindings.length} medium, ${minorFindings.length} low severity.`;
    }
  }

  return {
    success: true,
    riskLevel,
    summary,
    majorFindings,
    mediumFindings,
    minorFindings,
    recommendations: [...new Set(recommendations)], // Deduplicate
  };
}

/**
 * Determine severity based on finding text
 */
function determineSeverity(text: string): AuditFinding['severity'] {
  const lowerText = text.toLowerCase();
  
  // Critical/High severity indicators
  if (lowerText.includes('reentrancy') || 
      lowerText.includes('infinite mint') ||
      lowerText.includes('unprotected') ||
      lowerText.includes('access control') ||
      lowerText.includes('overflow') ||
      lowerText.includes('underflow') ||
      lowerText.includes('arbitrary') ||
      lowerText.includes('unauthorized')) {
    return 'high';
  }
  
  // Medium severity indicators
  if (lowerText.includes('incorrect logic') ||
      lowerText.includes('redundant') ||
      lowerText.includes('potential') ||
      lowerText.includes('should be') ||
      lowerText.includes('lack of event') ||
      lowerText.includes('constructor')) {
    return 'medium';
  }
  
  // Low/informational indicators
  if (lowerText.includes('magic number') ||
      lowerText.includes('gas optimization') ||
      lowerText.includes('readability') ||
      lowerText.includes('safemath') ||
      lowerText.includes('best practice') ||
      lowerText.includes('clarity')) {
    return 'low';
  }
  
  // Default to medium if uncertain
  return 'medium';
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
