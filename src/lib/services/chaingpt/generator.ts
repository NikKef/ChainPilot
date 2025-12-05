import { GeneralChat } from '@chaingpt/generalchat';
import { logger } from '@/lib/utils';
import { ExternalApiError } from '@/lib/utils/errors';
import type { ContractGenerationResult } from '@/lib/types';
import { CONTRACT_GENERATION_PROMPT } from './prompts';

// Lazy initialization of the GeneralChat client
let generatorClient: GeneralChat | null = null;

function getGeneratorClient(): GeneralChat {
  if (!generatorClient) {
    const apiKey = process.env.CHAINGPT_API_KEY;
    
    if (!apiKey) {
      throw new ExternalApiError('ChainGPT', 'API key not configured');
    }

    generatorClient = new GeneralChat({
      apiKey,
    });
  }
  
  return generatorClient;
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
 * Generate a smart contract from natural language specification
 */
export async function generateContract(
  specText: string,
  options?: {
    contractType?: string;
    features?: string[];
    optimize?: boolean;
  }
): Promise<ContractGenerationResult> {
  // Validate specText is provided
  if (!specText || typeof specText !== 'string' || specText.trim().length === 0) {
    logger.warn('generateContract called with invalid specText', { specText });
    return {
      success: false,
      error: 'Please provide a description of the contract you want to generate.',
    };
  }

  const apiKey = process.env.CHAINGPT_API_KEY;
  
  if (!apiKey) {
    throw new ExternalApiError('ChainGPT', 'API key not configured');
  }

  logger.chainGptCall('contract-generator', { specLength: specText.length });

  // Build enhanced specification
  const enhancedSpec = buildEnhancedSpec(specText, options);

  try {
    const client = getGeneratorClient();

    // Build the full question with system context
    const fullQuestion = `${CONTRACT_GENERATION_PROMPT}

---

User Request:
${enhancedSpec}`;

    // Use createChatBlob for non-streaming response
    const response = await client.createChatBlob({
      question: fullQuestion,
      chatHistory: 'off',
      useCustomContext: false,
    });

    // Extract the response content using helper function
    const generatedCode = extractContentFromResponse(response);

    if (!generatedCode) {
      throw new ExternalApiError('ChainGPT', 'Empty response from contract generator');
    }

    // Extract and validate the Solidity code
    const sourceCode = extractSolidityCode(generatedCode);
    const contractName = extractContractName(sourceCode);
    const warnings = validateGeneratedCode(sourceCode);

    return {
      success: true,
      sourceCode,
      contractName,
      description: `Generated contract based on: ${specText.slice(0, 100)}...`,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    if (error instanceof ExternalApiError) {
      throw error;
    }

    logger.error('Contract generation failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during contract generation',
    };
  }
}

/**
 * Build enhanced specification with additional context
 */
function buildEnhancedSpec(
  specText: string,
  options?: {
    contractType?: string;
    features?: string[];
    optimize?: boolean;
  }
): string {
  let enhanced = `Generate a Solidity smart contract with the following requirements:

${specText}

`;

  if (options?.contractType) {
    enhanced += `Contract Type: ${options.contractType}\n`;
  }

  if (options?.features?.length) {
    enhanced += `Required Features:\n${options.features.map(f => `- ${f}`).join('\n')}\n`;
  }

  if (options?.optimize) {
    enhanced += `\nOptimization: Please optimize for gas efficiency.\n`;
  }

  enhanced += `
Additional Requirements:
- Use Solidity ^0.8.19
- Include comprehensive NatSpec documentation
- Add events for state changes
- Include access control using OpenZeppelin if needed
- Make the contract secure and production-ready

Return ONLY the complete Solidity code starting with the pragma statement.`;

  return enhanced;
}

/**
 * Extract Solidity code from response (handles markdown code blocks)
 */
function extractSolidityCode(response: string): string {
  // Check for markdown code blocks
  const codeBlockMatch = response.match(/```(?:solidity)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Check if response starts with pragma (direct code)
  if (response.trim().startsWith('//') || response.trim().startsWith('pragma')) {
    return response.trim();
  }

  // Try to find pragma statement and extract from there
  const pragmaIndex = response.indexOf('pragma solidity');
  if (pragmaIndex !== -1) {
    return response.slice(pragmaIndex).trim();
  }

  // Return as-is if no clear pattern
  return response.trim();
}

/**
 * Extract contract name from source code
 */
function extractContractName(sourceCode: string): string {
  const contractMatch = sourceCode.match(/contract\s+(\w+)/);
  return contractMatch ? contractMatch[1] : 'GeneratedContract';
}

/**
 * Validate generated code for common issues
 */
function validateGeneratedCode(sourceCode: string): string[] {
  const warnings: string[] = [];

  // Check for pragma
  if (!sourceCode.includes('pragma solidity')) {
    warnings.push('Missing pragma statement');
  }

  // Check for SPDX license
  if (!sourceCode.includes('SPDX-License-Identifier')) {
    warnings.push('Missing SPDX license identifier');
  }

  // Check for potential security issues (basic)
  if (sourceCode.includes('selfdestruct')) {
    warnings.push('Contract uses selfdestruct - review carefully');
  }

  if (sourceCode.includes('delegatecall')) {
    warnings.push('Contract uses delegatecall - potential security risk');
  }

  if (sourceCode.includes('tx.origin')) {
    warnings.push('Contract uses tx.origin - consider using msg.sender instead');
  }

  return warnings;
}

/**
 * Generate contract template for common use cases
 */
export async function generateContractTemplate(
  templateType: 'token' | 'nft' | 'staking' | 'vesting' | 'multisig' | 'governance',
  params: Record<string, unknown>
): Promise<ContractGenerationResult> {
  const templateSpecs: Record<string, string> = {
    token: `Create an ERC20 token with:
- Name: ${params.name || 'MyToken'}
- Symbol: ${params.symbol || 'MTK'}
- Initial Supply: ${params.initialSupply || '1000000'}
- Decimals: ${params.decimals || 18}
- Features: ${(params.features as string[])?.join(', ') || 'mintable, burnable, pausable'}`,

    nft: `Create an ERC721 NFT collection with:
- Name: ${params.name || 'MyNFT'}
- Symbol: ${params.symbol || 'MNFT'}
- Max Supply: ${params.maxSupply || 10000}
- Features: ${(params.features as string[])?.join(', ') || 'mintable, enumerable, URI storage'}`,

    staking: `Create a staking contract with:
- Staking Token: ${params.stakingToken || 'address to be set'}
- Reward Token: ${params.rewardToken || 'same as staking token'}
- Reward Rate: ${params.rewardRate || '100 tokens per day'}
- Lock Period: ${params.lockPeriod || '7 days'}`,

    vesting: `Create a token vesting contract with:
- Token: ${params.token || 'address to be set'}
- Vesting Duration: ${params.duration || '12 months'}
- Cliff Period: ${params.cliff || '3 months'}
- Release Schedule: ${params.schedule || 'linear'}
- Beneficiaries: ${params.beneficiaries || 'configurable'}`,

    multisig: `Create a multi-signature wallet with:
- Required Signatures: ${params.requiredSignatures || 2}
- Max Owners: ${params.maxOwners || 5}
- Features: daily limits, transaction queueing, owner management`,

    governance: `Create a governance contract with:
- Voting Token: ${params.votingToken || 'address to be set'}
- Proposal Threshold: ${params.proposalThreshold || '1% of supply'}
- Voting Period: ${params.votingPeriod || '3 days'}
- Timelock Delay: ${params.timelockDelay || '2 days'}`,
  };

  const spec = templateSpecs[templateType];
  if (!spec) {
    return {
      success: false,
      error: `Unknown template type: ${templateType}`,
    };
  }

  return generateContract(spec, {
    contractType: templateType,
    optimize: true,
  });
}
