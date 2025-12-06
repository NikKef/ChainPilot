import axios from 'axios';
import { logger } from '@/lib/utils';
import { ExternalApiError } from '@/lib/utils/errors';
import type { ContractGenerationResult } from '@/lib/types';
import { CONTRACT_GENERATION_PROMPT } from './prompts';

// Smart Contract Generator API endpoint (per ChainGPT documentation)
const SMART_CONTRACT_GENERATOR_API_URL = 'https://api.chaingpt.org/chat/stream';
const SMART_CONTRACT_GENERATOR_MODEL = 'smart_contract_generator';

/**
 * Interface for Smart Contract Generator API response
 */
interface SmartContractGeneratorResponse {
  status: string;
  data: {
    user: string;
    bot: string;
  };
}

/**
 * Extract content from ChainGPT Smart Contract Generator API response
 * The API returns { status: "success", data: { user: string, bot: string } } format
 */
function extractContentFromResponse(response: unknown): string {
  // Handle string response
  if (typeof response === 'string') {
    return response;
  }
  
  // Handle object response - API returns { status, data: { user, bot } }
  if (response && typeof response === 'object') {
    const obj = response as Record<string, unknown>;
    
    // Check for nested data.bot structure (official API format)
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
 * Generate a smart contract from natural language specification using the ChainGPT Smart Contract Generator API
 * Uses the dedicated smart_contract_generator model for production-ready contracts
 */
export async function generateContract(
  specText: string,
  options?: {
    contractType?: string;
    features?: string[];
    optimize?: boolean;
    chatHistory?: 'on' | 'off';
    sdkUniqueId?: string;
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

  logger.chainGptCall('smart-contract-generator', { 
    specLength: specText.length,
    contractType: options?.contractType,
    hasFeatures: !!options?.features?.length,
  });

  // Build enhanced specification
  const enhancedSpec = buildEnhancedSpec(specText, options);

  // Build the full question with system context
  const fullQuestion = `${CONTRACT_GENERATION_PROMPT}

---

User Request:
${enhancedSpec}`;

  try {
    logger.debug('Sending generation request to ChainGPT Smart Contract Generator API', { 
      promptLength: fullQuestion.length,
      model: SMART_CONTRACT_GENERATOR_MODEL,
    });

    // Call the Smart Contract Generator API directly (per documentation)
    const response = await axios.post<SmartContractGeneratorResponse>(
      SMART_CONTRACT_GENERATOR_API_URL,
      {
        model: SMART_CONTRACT_GENERATOR_MODEL,
        question: fullQuestion,
        chatHistory: options?.chatHistory || 'off',
        ...(options?.sdkUniqueId && { sdkUniqueId: options.sdkUniqueId }),
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        // Don't use streaming for blob response - wait for full response
        responseType: 'json',
      }
    );

    // Extract the response content
    const generatedCode = extractContentFromResponse(response.data);

    if (!generatedCode) {
      throw new ExternalApiError('ChainGPT', 'Empty response from Smart Contract Generator');
    }

    logger.debug('Received generation response from ChainGPT', { 
      responseLength: generatedCode.length,
      status: response.data.status,
    });

    // Extract and validate the Solidity code
    const sourceCode = extractSolidityCode(generatedCode);
    const contractName = extractContractName(sourceCode);
    const warnings = validateGeneratedCode(sourceCode);

    logger.info('Contract generation completed', {
      contractName,
      sourceLength: sourceCode.length,
      warningsCount: warnings.length,
    });

    return {
      success: true,
      sourceCode,
      contractName,
      description: `Generated contract based on: ${specText.slice(0, 100)}${specText.length > 100 ? '...' : ''}`,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    if (error instanceof ExternalApiError) {
      throw error;
    }

    // Handle axios errors
    if (axios.isAxiosError(error)) {
      const errorMessage = error.response?.data?.message || error.response?.data?.error || error.message;
      logger.error('Smart Contract Generator API call failed', { 
        status: error.response?.status,
        error: errorMessage,
      });
      return {
        success: false,
        error: `Smart Contract Generator API error: ${errorMessage}`,
      };
    }

    logger.error('Contract generation failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during contract generation',
    };
  }
}

/**
 * Generate a smart contract with streaming support
 * Useful for real-time feedback during contract generation
 */
export async function* streamContractGeneration(
  specText: string,
  options?: {
    contractType?: string;
    features?: string[];
    optimize?: boolean;
    chatHistory?: 'on' | 'off';
    sdkUniqueId?: string;
  }
): AsyncGenerator<string, ContractGenerationResult, unknown> {
  // Validate specText is provided
  if (!specText || typeof specText !== 'string' || specText.trim().length === 0) {
    logger.warn('streamContractGeneration called with invalid specText', { specText });
    return {
      success: false,
      error: 'Please provide a description of the contract you want to generate.',
    };
  }

  const apiKey = process.env.CHAINGPT_API_KEY;
  
  if (!apiKey) {
    throw new ExternalApiError('ChainGPT', 'API key not configured');
  }

  logger.chainGptCall('smart-contract-generator-stream', { 
    specLength: specText.length,
    contractType: options?.contractType,
  });

  // Build enhanced specification
  const enhancedSpec = buildEnhancedSpec(specText, options);

  const fullQuestion = `${CONTRACT_GENERATION_PROMPT}

---

User Request:
${enhancedSpec}`;

  try {
    logger.debug('Sending streaming request to ChainGPT Smart Contract Generator API');

    // Call the API with streaming enabled
    const response = await axios.post(
      SMART_CONTRACT_GENERATOR_API_URL,
      {
        model: SMART_CONTRACT_GENERATOR_MODEL,
        question: fullQuestion,
        chatHistory: options?.chatHistory || 'off',
        ...(options?.sdkUniqueId && { sdkUniqueId: options.sdkUniqueId }),
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        responseType: 'stream',
      }
    );

    let fullContent = '';

    // Process the stream
    for await (const chunk of response.data) {
      const chunkStr = chunk.toString();
      fullContent += chunkStr;
      yield chunkStr;
    }

    // Extract and validate the complete code
    const sourceCode = extractSolidityCode(fullContent);
    const contractName = extractContractName(sourceCode);
    const warnings = validateGeneratedCode(sourceCode);

    logger.info('Streaming contract generation completed', {
      contractName,
      sourceLength: sourceCode.length,
    });

    return {
      success: true,
      sourceCode,
      contractName,
      description: `Generated contract based on: ${specText.slice(0, 100)}${specText.length > 100 ? '...' : ''}`,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    logger.error('Streaming contract generation failed', error);
    
    if (axios.isAxiosError(error)) {
      const errorMessage = error.response?.data?.message || error.response?.data?.error || error.message;
      return {
        success: false,
        error: `Smart Contract Generator API error: ${errorMessage}`,
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during contract generation',
    };
  }
}

/**
 * Get chat history for contract generation sessions
 * Retrieves previous contract generation conversations for a given session
 */
export async function getContractGenerationHistory(options?: {
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}): Promise<{
  success: boolean;
  history?: Array<{ user: string; bot: string; createdAt: string }>;
  error?: string;
}> {
  const apiKey = process.env.CHAINGPT_API_KEY;
  
  if (!apiKey) {
    throw new ExternalApiError('ChainGPT', 'API key not configured');
  }

  try {
    const response = await axios.get(SMART_CONTRACT_GENERATOR_API_URL, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      params: {
        limit: options?.limit || 10,
        offset: options?.offset || 0,
        sortBy: options?.sortBy || 'createdAt',
        sortOrder: options?.sortOrder || 'desc',
      },
    });

    return {
      success: true,
      history: response.data.data?.rows || [],
    };
  } catch (error) {
    logger.error('Failed to get contract generation history', error);
    
    if (axios.isAxiosError(error)) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
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
