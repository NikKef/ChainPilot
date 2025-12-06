import { GeneralChat } from '@chaingpt/generalchat';
import { logger } from '@/lib/utils';
import { ExternalApiError } from '@/lib/utils/errors';
import { WEB3_LLM_SYSTEM_PROMPT } from './prompts';

// Lazy initialization of the GeneralChat client
let generalChatClient: GeneralChat | null = null;

/**
 * Get or create the GeneralChat client instance
 */
function getGeneralChatClient(): GeneralChat {
  if (!generalChatClient) {
    const apiKey = process.env.CHAINGPT_API_KEY;
    
    if (!apiKey) {
      throw new ExternalApiError('ChainGPT', 'API key not configured. Set CHAINGPT_API_KEY in your environment variables.');
    }

    generalChatClient = new GeneralChat({
      apiKey,
    });
  }
  
  return generalChatClient;
}

/**
 * Reset the client (useful for testing or API key changes)
 */
export function resetGeneralChatClient(): void {
  generalChatClient = null;
}

interface ChatOptions {
  systemPrompt?: string;
  chatHistory?: 'on' | 'off';
  useCustomContext?: boolean;
  contextInjection?: Record<string, string>;
  /** Unique identifier for the conversation - enables follow-up questions with context */
  sdkUniqueId?: string;
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
 * Call ChainGPT Web3 LLM for research and explanations
 * Uses the official ChainGPT SDK with createChatBlob method
 */
export async function callWeb3LLM(
  prompt: string,
  options?: ChatOptions
): Promise<string> {
  logger.chainGptCall('web3-llm', { promptLength: prompt.length });

  try {
    const client = getGeneralChatClient();

    // Build the full question including system context if provided
    let fullQuestion = prompt;
    if (options?.systemPrompt) {
      fullQuestion = `${options.systemPrompt}\n\n---\n\nUser Query: ${prompt}`;
    }

    // Use createChatBlob for non-streaming response
    // When sdkUniqueId is provided and chatHistory is 'on', the API maintains conversation context
    const response = await client.createChatBlob({
      question: fullQuestion,
      chatHistory: options?.chatHistory || 'off',
      useCustomContext: options?.useCustomContext || false,
      contextInjection: options?.contextInjection || {},
      ...(options?.sdkUniqueId && { sdkUniqueId: options.sdkUniqueId }),
    });

    // Log the raw response for debugging
    logger.debug('ChainGPT raw SDK response', { 
      responseType: typeof response,
      responseKeys: response && typeof response === 'object' ? Object.keys(response as object) : null,
      responsePreview: JSON.stringify(response).slice(0, 1000)
    });

    // Extract the response content using helper function
    const content = extractContentFromResponse(response);
    
    if (!content) {
      throw new ExternalApiError('ChainGPT', 'Empty response from API');
    }

    logger.debug('ChainGPT response received', { 
      promptLength: prompt.length,
      responseLength: content.length 
    });

    return content;
  } catch (error) {
    if (error instanceof ExternalApiError) {
      throw error;
    }
    
    logger.error('ChainGPT Web3 LLM call failed', error);
    throw new ExternalApiError(
      'ChainGPT',
      error instanceof Error ? error.message : 'Unknown error occurred'
    );
  }
}

/**
 * Stream response from ChainGPT Web3 LLM
 * Useful for real-time chat experiences
 */
export async function* streamWeb3LLM(
  prompt: string,
  options?: ChatOptions
): AsyncGenerator<string, void, unknown> {
  logger.chainGptCall('web3-llm-stream', { promptLength: prompt.length });

  try {
    const client = getGeneralChatClient();

    let fullQuestion = prompt;
    if (options?.systemPrompt) {
      fullQuestion = `${options.systemPrompt}\n\n---\n\nUser Query: ${prompt}`;
    }

    const stream = await client.createChatStream({
      question: fullQuestion,
      chatHistory: options?.chatHistory || 'off',
      useCustomContext: options?.useCustomContext || false,
      contextInjection: options?.contextInjection || {},
      ...(options?.sdkUniqueId && { sdkUniqueId: options.sdkUniqueId }),
    });

    // Handle the stream
    for await (const chunk of stream) {
      const text = typeof chunk === 'string' ? chunk : chunk.toString();
      if (text) {
        yield text;
      }
    }
  } catch (error) {
    logger.error('ChainGPT stream failed', error);
    throw new ExternalApiError(
      'ChainGPT',
      error instanceof Error ? error.message : 'Stream error occurred'
    );
  }
}

/**
 * Research Web3 topics using ChainGPT
 * @param query The research query
 * @param topics Optional topics to consider
 * @param conversationId Optional conversation ID for follow-up context - enables the AI to remember previous questions
 */
export async function researchTopic(
  query: string,
  topics?: string[],
  conversationId?: string
): Promise<{
  answer: string;
  relatedTopics?: string[];
}> {
  const topicsContext = topics?.length 
    ? `\n\nRelevant topics to consider: ${topics.join(', ')}`
    : '';

  const systemPrompt = `${WEB3_LLM_SYSTEM_PROMPT}

You are helping the user research Web3 topics on BNB Chain. Provide accurate, helpful information.`;

  const prompt = `${query}${topicsContext}

Please provide a comprehensive but concise answer. Include:
1. Direct answer to the question
2. Key considerations or risks (if applicable)
3. Practical examples if relevant
4. Suggest related topics they might want to explore`;

  // When conversationId is provided, enable chat history to maintain context for follow-up questions
  const answer = await callWeb3LLM(prompt, { 
    systemPrompt,
    chatHistory: conversationId ? 'on' : 'off',
    sdkUniqueId: conversationId,
  });

  return {
    answer,
    relatedTopics: topics,
  };
}

/**
 * Explain a contract or token
 * @param address Contract address to explain
 * @param network The network ('testnet' or 'mainnet')
 * @param sourceCode Optional contract source code
 * @param conversationId Optional conversation ID for follow-up context
 */
export async function explainContract(
  address: string,
  network: 'testnet' | 'mainnet',
  sourceCode?: string,
  conversationId?: string
): Promise<{
  explanation: string;
  riskHints: string[];
  mainFunctions: string[];
}> {
  const codeContext = sourceCode 
    ? `\n\nContract source code:\n\`\`\`solidity\n${sourceCode}\n\`\`\``
    : '';

  const systemPrompt = `${WEB3_LLM_SYSTEM_PROMPT}

You are analyzing smart contracts on BNB Chain. Be thorough in identifying potential risks and explaining functionality clearly.`;

  const prompt = `Analyze and explain the contract at ${address} on BNB ${network}.${codeContext}

Please provide:
1. **Overview**: What does this contract do?
2. **Main Functions**: List and briefly explain key public functions
3. **Risk Assessment**: Any obvious red flags or concerns?
4. **Recommendations**: Should users interact with this contract?

Format your response in clear markdown.`;

  // When conversationId is provided, enable chat history to maintain context for follow-up questions
  const explanation = await callWeb3LLM(prompt, { 
    systemPrompt,
    chatHistory: conversationId ? 'on' : 'off',
    sdkUniqueId: conversationId,
  });

  // Extract risk hints from the explanation
  const riskHints: string[] = [];
  const lowerExplanation = explanation.toLowerCase();
  
  if (lowerExplanation.includes('critical') || lowerExplanation.includes('severe')) {
    riskHints.push('Contains critical risk factors - exercise extreme caution');
  }
  if (lowerExplanation.includes('risk') || lowerExplanation.includes('vulnerable')) {
    riskHints.push('Contains potential risk factors - review carefully');
  }
  if (lowerExplanation.includes('caution') || lowerExplanation.includes('warning')) {
    riskHints.push('Exercise caution when interacting');
  }
  if (lowerExplanation.includes('unverified') || lowerExplanation.includes('not verified')) {
    riskHints.push('Contract source code may not be verified');
  }
  if (lowerExplanation.includes('upgradeable') || lowerExplanation.includes('proxy')) {
    riskHints.push('Contract may be upgradeable - owner can modify behavior');
  }

  // Extract function names (improved heuristic)
  const functionMatches = explanation.match(/`(\w+)\s*\(/g) || [];
  const functionNames = new Set<string>();
  functionMatches.forEach(m => {
    const name = m.replace(/[`(]/g, '').trim();
    if (name && name.length > 1 && !['if', 'for', 'while'].includes(name)) {
      functionNames.add(name);
    }
  });
  const mainFunctions = Array.from(functionNames).slice(0, 10);

  return {
    explanation,
    riskHints,
    mainFunctions,
  };
}

/**
 * Explain a DeFi strategy
 * @param strategyDescription Description of the strategy to analyze
 * @param protocols Optional list of protocols involved
 * @param conversationId Optional conversation ID for follow-up context
 */
export async function explainStrategy(
  strategyDescription: string,
  protocols?: string[],
  conversationId?: string
): Promise<string> {
  const protocolContext = protocols?.length
    ? `\n\nProtocols involved: ${protocols.join(', ')}`
    : '';

  const systemPrompt = `${WEB3_LLM_SYSTEM_PROMPT}

You are a DeFi strategy analyst helping users understand complex yield farming and trading strategies on BNB Chain.`;

  const prompt = `Analyze this DeFi strategy on BNB Chain:

${strategyDescription}${protocolContext}

Please provide:
1. **Strategy Breakdown**: Step-by-step explanation
2. **Expected Returns**: Realistic APY/profit expectations
3. **Risks**: What could go wrong? Include impermanent loss, smart contract risks, liquidation risks
4. **Gas Costs**: Estimated transaction costs
5. **Recommendation**: Is this strategy advisable? For what type of user?`;

  return callWeb3LLM(prompt, { 
    systemPrompt,
    chatHistory: conversationId ? 'on' : 'off',
    sdkUniqueId: conversationId,
  });
}

/**
 * Get crypto news and analysis
 * @param topic The topic to get insights about
 * @param network The network context ('testnet' or 'mainnet')
 * @param conversationId Optional conversation ID for follow-up context
 */
export async function getCryptoInsights(
  topic: string,
  network: 'testnet' | 'mainnet' = 'mainnet',
  conversationId?: string
): Promise<string> {
  const systemPrompt = `${WEB3_LLM_SYSTEM_PROMPT}

You are providing current crypto market insights and analysis. Be factual and balanced in your assessments.`;

  const prompt = `Provide current insights and analysis about: ${topic}

Focus on:
1. Recent developments and news
2. Market sentiment
3. Technical analysis if relevant
4. Impact on BNB Chain ecosystem
5. Key takeaways for traders/developers

Note: This is for ${network === 'testnet' ? 'testnet/development' : 'mainnet/production'} context.`;

  return callWeb3LLM(prompt, { 
    systemPrompt,
    chatHistory: conversationId ? 'on' : 'off',
    sdkUniqueId: conversationId,
  });
}

/**
 * Ask a general Web3 question
 * @param question The question to ask
 * @param context Optional context including network, address, previous messages, and conversationId
 */
export async function askWeb3Question(
  question: string,
  context?: {
    network?: 'testnet' | 'mainnet';
    relatedAddress?: string;
    previousMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
    conversationId?: string;
  }
): Promise<string> {
  let systemPrompt = WEB3_LLM_SYSTEM_PROMPT;
  
  if (context?.network) {
    systemPrompt += `\n\nCurrent network: BNB ${context.network}`;
  }
  
  if (context?.relatedAddress) {
    systemPrompt += `\n\nRelated address being discussed: ${context.relatedAddress}`;
  }

  // Include conversation context if available (for local context backup)
  // Note: When conversationId is provided with chatHistory: 'on', the API maintains its own context
  let fullQuestion = question;
  if (context?.previousMessages?.length && !context?.conversationId) {
    const conversationContext = context.previousMessages
      .slice(-3) // Last 3 messages for context
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');
    fullQuestion = `Previous conversation:\n${conversationContext}\n\nNew question: ${question}`;
  }

  return callWeb3LLM(fullQuestion, { 
    systemPrompt,
    chatHistory: context?.conversationId ? 'on' : 'off',
    sdkUniqueId: context?.conversationId,
  });
}
