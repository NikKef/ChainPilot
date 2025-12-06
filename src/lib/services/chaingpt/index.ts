import { GeneralChat } from '@chaingpt/generalchat';
import type { 
  Intent, 
  ContextExtractionResult, 
  SessionContext,
  TransferIntent,
} from '@/lib/types';
import { logger } from '@/lib/utils';
import { ExternalApiError } from '@/lib/utils/errors';
import { 
  CONTEXT_EXTRACTION_SYSTEM_PROMPT, 
  generateContextExtractionPrompt,
  generateFollowUpQuestions,
} from './prompts';
import { 
  callWeb3LLM, 
  streamWeb3LLM,
  researchTopic, 
  explainContract, 
  explainStrategy, 
  getCryptoInsights,
  askWeb3Question,
  resetGeneralChatClient,
} from './web3-llm';
import { 
  generateContract, 
  generateContractTemplate, 
  streamContractGeneration,
  getContractGenerationHistory,
} from './generator';
import { auditContract, quickSecurityCheck } from './auditor';

export {
  // Web3 LLM
  callWeb3LLM,
  streamWeb3LLM,
  researchTopic,
  explainContract,
  explainStrategy,
  getCryptoInsights,
  askWeb3Question,
  resetGeneralChatClient,
  
  // Contract Generation
  generateContract,
  generateContractTemplate,
  streamContractGeneration,
  getContractGenerationHistory,
  
  // Auditing
  auditContract,
  quickSecurityCheck,
};

// Lazy initialization of the GeneralChat client for context extraction
let contextExtractionClient: GeneralChat | null = null;

function getContextExtractionClient(): GeneralChat {
  if (!contextExtractionClient) {
    const apiKey = process.env.CHAINGPT_API_KEY;
    
    if (!apiKey) {
      throw new ExternalApiError('ChainGPT', 'API key not configured');
    }

    contextExtractionClient = new GeneralChat({
      apiKey,
    });
  }
  
  return contextExtractionClient;
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
 * Extract structured context from user message using ChainGPT
 */
export async function extractContext(
  message: string,
  sessionContext: SessionContext
): Promise<ContextExtractionResult> {
  const apiKey = process.env.CHAINGPT_API_KEY;
  
  if (!apiKey) {
    logger.warn('ChainGPT API key not configured, using fallback extraction');
    return fallbackExtraction(message, sessionContext);
  }

  logger.chainGptCall('context-extraction', { messageLength: message.length });

  const prompt = generateContextExtractionPrompt(message, sessionContext);

  try {
    const client = getContextExtractionClient();

    // Build the full question with system context
    const fullQuestion = `${CONTEXT_EXTRACTION_SYSTEM_PROMPT}

${prompt}

IMPORTANT: Return ONLY valid JSON. Do not include any text before or after the JSON object.`;

    const history =
      sessionContext.chatHistory && sessionContext.chatHistory.length
        ? JSON.stringify(sessionContext.chatHistory.map((m) => ({
            role: m.role,
            content: m.content,
          })))
        : 'off';

    const response = await client.createChatBlob({
      question: fullQuestion,
      chatHistory: history,
      useCustomContext: false,
    });

    // Extract content from response using helper function
    const content = extractContentFromResponse(response);

    if (!content) {
      logger.warn('Empty response from ChainGPT context extraction');
      return fallbackExtraction(message, sessionContext);
    }

    logger.debug('ChainGPT context extraction response', { contentLength: content.length });

    // Parse the JSON response - pass original message for fallback
    const result = parseExtractionResponse(content, sessionContext, message);
    
    // Merge with partial intent if exists
    if (sessionContext.partialIntent && result.intent) {
      result.intent = mergeIntents(sessionContext.partialIntent, result.intent);
    }

    return result;
  } catch (error) {
    logger.error('Context extraction failed', error);
    return fallbackExtraction(message, sessionContext);
  }
}

/**
 * Parse extraction response from ChainGPT
 */
function parseExtractionResponse(
  response: string,
  context: SessionContext,
  originalMessage: string
): ContextExtractionResult {
  try {
    // Ensure response is a string
    const responseStr = typeof response === 'string' ? response : String(response);
    
    // Extract JSON from response - try multiple patterns
    let jsonMatch = responseStr.match(/\{[\s\S]*\}/);
    
    // If no match, try to find JSON in code blocks
    if (!jsonMatch) {
      const codeBlockMatch = responseStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonMatch = codeBlockMatch[1].match(/\{[\s\S]*\}/);
      }
    }

    if (!jsonMatch) {
      logger.warn('No JSON found in ChainGPT response, using fallback');
      return fallbackExtraction(originalMessage, context);
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    // Normalize intent and ensure query is set for research/explain types
    const intent = normalizeIntent(parsed.intent, context, originalMessage);
    const missingFields = parsed.missingFields || [];
    const questions = parsed.questions || generateFollowUpQuestions(intent.type, missingFields);
    
    return {
      intent,
      missingFields,
      questions,
      requiresFollowUp: missingFields.length > 0,
      confidence: parsed.confidence || 0.8,
    };
  } catch (error) {
    logger.error('Failed to parse extraction response', error);
    return fallbackExtraction(originalMessage, context);
  }
}

/**
 * Normalize intent with network defaults
 */
function normalizeIntent(
  intent: Partial<Intent>, 
  context: SessionContext, 
  originalMessage?: string
): Intent {
  const baseIntent = {
    ...intent,
    network: intent.network || context.network,
  };

  // Ensure type is valid
  if (!baseIntent.type) {
    return {
      type: 'research',
      query: originalMessage || '',
      network: context.network,
    } as Intent;
  }

  // For research and explain intents, ensure query is set
  if (baseIntent.type === 'research' || baseIntent.type === 'explain') {
    if (!('query' in baseIntent) || !baseIntent.query) {
      (baseIntent as { query: string }).query = originalMessage || '';
    }
  }

  // For generate_contract intents, ensure specText is set
  if (baseIntent.type === 'generate_contract') {
    if (!('specText' in baseIntent) || !baseIntent.specText) {
      (baseIntent as { specText: string }).specText = originalMessage || '';
    }
  }

  return baseIntent as Intent;
}

/**
 * Merge partial intent with new intent
 * Handles the case where ChainGPT might misclassify a follow-up message
 */
function mergeIntents(partial: Partial<Intent>, newIntent: Intent): Intent {
  // Define action intents that should be preserved over research/explain
  const actionIntents = ['transfer', 'swap', 'contract_call', 'deploy', 'audit_contract', 'generate_contract'];
  const infoIntents = ['research', 'explain'];
  
  // If partial is an action intent and new is just info (explain/research),
  // the user likely provided info for the action - keep the partial type
  if (partial.type && actionIntents.includes(partial.type) && infoIntents.includes(newIntent.type)) {
    logger.debug('Preserving partial action intent over info intent', {
      partialType: partial.type,
      newType: newIntent.type
    });
    
    // Extract any useful values from the new intent (like addresses)
    const newValues: Record<string, unknown> = {};
    
    // If new intent has an address, use it to fill missing fields in partial
    if ('address' in newIntent && newIntent.address) {
      if (partial.type === 'transfer') {
        const t = partial as Partial<TransferIntent>;
        // If we have an unresolved token symbol, the address is likely the token address
        if (t.tokenSymbol && !t.tokenAddress) {
          newValues.tokenAddress = newIntent.address;
        } else if (!t.to) {
          newValues.to = newIntent.address;
        }
      } else if (partial.type === 'contract_call' && !('contractAddress' in partial)) {
        newValues.contractAddress = newIntent.address;
      } else if (partial.type === 'audit_contract' && !('address' in partial)) {
        newValues.address = newIntent.address;
      }
    }
    
    return {
      ...partial,
      ...newValues,
      network: newIntent.network || partial.network,
    } as Intent;
  }
  
  // Only merge if same type
  if (partial.type && partial.type !== newIntent.type) {
    return newIntent;
  }

  return {
    ...partial,
    ...newIntent,
    // Override undefined values from new with partial
    ...Object.fromEntries(
      Object.entries(partial).filter(([_, v]) => v !== undefined)
    ),
  } as Intent;
}

/**
 * Fallback regex-based extraction when ChainGPT fails
 */
function fallbackExtraction(
  message: string,
  context: SessionContext
): ContextExtractionResult {
  const lowerMessage = message.toLowerCase();

  // Transfer pattern: "send X TOKEN to ADDRESS"
  const transferMatch = message.match(
    /send\s+(\d+\.?\d*)\s*(\w+)?\s*(?:to\s+)?(0x[a-fA-F0-9]{40})?/i
  );
  if (transferMatch) {
    const [, amount, tokenSymbol, to] = transferMatch;
    const intent = {
      type: 'transfer' as const,
      amount,
      tokenSymbol: tokenSymbol?.toUpperCase(),
      to,
      network: context.network,
    };
    const missingFields = [];
    if (!to) missingFields.push('to');
    if (!amount) missingFields.push('amount');
    
    return {
      intent,
      missingFields,
      questions: generateFollowUpQuestions('transfer', missingFields),
      requiresFollowUp: missingFields.length > 0,
      confidence: 0.6,
    };
  }

  // Swap pattern: "swap X TOKEN for/to/into TOKEN" - handles various phrasings
  // Examples: "swap 0.1 BNB for ETH", "swap BNB to USDT", "convert 5 LINK into BNB"
  const swapPatterns = [
    // "swap/exchange/convert X TOKEN for/to/into TOKEN"
    /(?:swap|exchange|convert|trade)\s+(\d+\.?\d*)?\s*(\w+)\s+(?:for|to|into)\s+(\w+)/i,
    // "swap/exchange TOKEN to TOKEN" (no amount)
    /(?:swap|exchange|convert|trade)\s+(\w+)\s+(?:for|to|into)\s+(\w+)/i,
  ];
  
  for (const pattern of swapPatterns) {
    const swapMatch = message.match(pattern);
    if (swapMatch) {
      let amount: string | undefined;
      let tokenInSymbol: string | undefined;
      let tokenOutSymbol: string | undefined;
      
      // Check if first capture group is a number (amount) or token symbol
      if (swapMatch[1] && /^\d+\.?\d*$/.test(swapMatch[1])) {
        // Pattern with amount: groups are [amount, tokenIn, tokenOut]
        amount = swapMatch[1];
        tokenInSymbol = swapMatch[2]?.toUpperCase();
        tokenOutSymbol = swapMatch[3]?.toUpperCase();
      } else {
        // Pattern without amount: groups are [tokenIn, tokenOut]
        tokenInSymbol = swapMatch[1]?.toUpperCase();
        tokenOutSymbol = swapMatch[2]?.toUpperCase();
      }
      
      const intent = {
        type: 'swap' as const,
        amount,
        tokenInSymbol,
        tokenOutSymbol,
        network: context.network,
      };
      const missingFields = [];
      if (!amount) missingFields.push('amount');
      if (!tokenInSymbol) missingFields.push('tokenIn');
      if (!tokenOutSymbol) missingFields.push('tokenOut');
      
      return {
        intent,
        missingFields,
        questions: generateFollowUpQuestions('swap', missingFields),
        requiresFollowUp: missingFields.length > 0,
        confidence: 0.7,
      };
    }
  }

  // Audit pattern
  if (lowerMessage.includes('audit')) {
    const addressMatch = message.match(/(0x[a-fA-F0-9]{40})/);
    const intent = {
      type: 'audit_contract' as const,
      address: addressMatch?.[1] || context.lastContractAddress,
      network: context.network,
    };
    const missingFields = intent.address ? [] : ['address'];
    
    return {
      intent,
      missingFields,
      questions: generateFollowUpQuestions('audit_contract', missingFields),
      requiresFollowUp: missingFields.length > 0,
      confidence: 0.7,
    };
  }

  // Generate contract pattern
  if (lowerMessage.includes('create') || lowerMessage.includes('generate')) {
    if (lowerMessage.includes('contract') || lowerMessage.includes('token') || lowerMessage.includes('nft')) {
      return {
        intent: {
          type: 'generate_contract',
          specText: message,
          network: context.network,
        },
        missingFields: [],
        questions: [],
        requiresFollowUp: false,
        confidence: 0.7,
      };
    }
  }

  // Explain pattern
  if (lowerMessage.includes('explain') || lowerMessage.includes('what is') || lowerMessage.includes('how does')) {
    const addressMatch = message.match(/(0x[a-fA-F0-9]{40})/);
    return {
      intent: {
        type: 'explain',
        query: message,
        address: addressMatch?.[1],
        network: context.network,
      },
      missingFields: [],
      questions: [],
      requiresFollowUp: false,
      confidence: 0.7,
    };
  }

  // Default to research
  return {
    intent: {
      type: 'research',
      query: message,
      network: context.network,
    },
    missingFields: [],
    questions: [],
    requiresFollowUp: false,
    confidence: 0.5,
  };
}

/**
 * ChainGPT service class for organized access
 */
export class ChainGPTService {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.CHAINGPT_API_KEY || '';
    if (!this.apiKey) {
      logger.warn('ChainGPT API key not configured');
    }
  }

  /**
   * Check if the service is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Extract context from user message
   */
  async extractContext(message: string, context: SessionContext) {
    return extractContext(message, context);
  }

  /**
   * Call the Web3 LLM
   */
  async callWeb3LLM(prompt: string, options?: Parameters<typeof callWeb3LLM>[1]) {
    return callWeb3LLM(prompt, options);
  }

  /**
   * Stream response from Web3 LLM
   */
  streamWeb3LLM(prompt: string, options?: Parameters<typeof streamWeb3LLM>[1]) {
    return streamWeb3LLM(prompt, options);
  }

  /**
   * Generate a smart contract using the Smart Contract Generator API
   */
  async generateContract(spec: string, options?: Parameters<typeof generateContract>[1]) {
    return generateContract(spec, options);
  }

  /**
   * Stream smart contract generation for real-time feedback
   */
  streamContractGeneration(spec: string, options?: Parameters<typeof streamContractGeneration>[1]) {
    return streamContractGeneration(spec, options);
  }

  /**
   * Get contract generation history
   */
  async getContractGenerationHistory(options?: Parameters<typeof getContractGenerationHistory>[0]) {
    return getContractGenerationHistory(options);
  }

  /**
   * Audit a smart contract
   */
  async auditContract(source: string, options?: Parameters<typeof auditContract>[1]) {
    return auditContract(source, options);
  }

  /**
   * Research a Web3 topic
   * @param query The research query
   * @param topics Optional topics to consider
   * @param conversationId Optional conversation ID for follow-up context
   */
  async researchTopic(query: string, topics?: string[], conversationId?: string) {
    return researchTopic(query, topics, conversationId);
  }

  /**
   * Explain a contract
   * @param address Contract address to explain
   * @param network The network ('testnet' or 'mainnet')
   * @param sourceCode Optional contract source code
   * @param conversationId Optional conversation ID for follow-up context
   */
  async explainContract(address: string, network: 'testnet' | 'mainnet', sourceCode?: string, conversationId?: string) {
    return explainContract(address, network, sourceCode, conversationId);
  }

  /**
   * Explain a DeFi strategy
   * @param strategyDescription Description of the strategy to analyze
   * @param protocols Optional list of protocols involved
   * @param conversationId Optional conversation ID for follow-up context
   */
  async explainStrategy(strategyDescription: string, protocols?: string[], conversationId?: string) {
    return explainStrategy(strategyDescription, protocols, conversationId);
  }

  /**
   * Get crypto insights
   * @param topic The topic to get insights about
   * @param network The network context ('testnet' or 'mainnet')
   * @param conversationId Optional conversation ID for follow-up context
   */
  async getCryptoInsights(topic: string, network?: 'testnet' | 'mainnet', conversationId?: string) {
    return getCryptoInsights(topic, network, conversationId);
  }

  /**
   * Ask a general Web3 question
   * @param question The question to ask
   * @param context Optional context including conversationId for follow-up support
   */
  async askWeb3Question(question: string, context?: Parameters<typeof askWeb3Question>[1]) {
    return askWeb3Question(question, context);
  }
}

// Export singleton instance
export const chainGPT = new ChainGPTService();
