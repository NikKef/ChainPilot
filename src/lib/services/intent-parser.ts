import type {
  Intent,
  ContextExtractionResult,
  SessionContext,
  TransferIntent,
  SwapIntent,
  ContractCallIntent,
  ChatMessage,
} from '@/lib/types';
import { extractContext } from './chaingpt';
import { isValidAddress, isValidAmount } from '@/lib/utils/validation';
import { TOKEN_SYMBOLS, type NetworkType } from '@/lib/utils/constants';
import { logger } from '@/lib/utils';

/**
 * Intent Parser Service
 * Processes user messages and extracts structured intents
 */
export class IntentParser {
  private sessionContext: SessionContext;

  constructor(sessionContext: SessionContext) {
    this.sessionContext = sessionContext;
  }

  /**
   * Parse a user message and extract intent
   */
  async parse(message: string): Promise<ContextExtractionResult> {
    logger.debug('Parsing message', { messageLength: message.length });

    try {
      // Use ChainGPT for context extraction
      const result = await extractContext(message, this.sessionContext);

      // Post-process the result
      const processedResult = this.postProcess(result);

      // Update session context with extracted info
      this.updateContext(processedResult);

      return processedResult;
    } catch (error) {
      logger.error('Intent parsing failed', error);
      // Return a safe fallback
      return {
        intent: {
          type: 'research',
          query: message,
          network: this.sessionContext.network,
        },
        missingFields: [],
        questions: [],
        requiresFollowUp: false,
        confidence: 0.3,
      };
    }
  }

  /**
   * Post-process extraction result
   */
  private postProcess(result: ContextExtractionResult): ContextExtractionResult {
    const { intent } = result;

    // Resolve token symbols to addresses
    if ('tokenSymbol' in intent && intent.tokenSymbol) {
      const resolved = this.resolveTokenSymbol(intent.tokenSymbol);
      if (resolved) {
        (intent as TransferIntent).tokenAddress = resolved;
      } else if (intent.tokenSymbol.toUpperCase() !== 'BNB') {
        this.markUnknownToken(
          intent.tokenSymbol,
          result,
          'tokenAddress',
          `I couldn't find ${intent.tokenSymbol} on ${this.sessionContext.network}. Please provide the contract address.`
        );
      }
    }

    if ('tokenInSymbol' in intent && intent.tokenInSymbol) {
      const resolved = this.resolveTokenSymbol(intent.tokenInSymbol);
      if (resolved) {
        (intent as SwapIntent).tokenIn = resolved;
      } else if (intent.tokenInSymbol.toUpperCase() !== 'BNB') {
        this.markUnknownToken(
          intent.tokenInSymbol,
          result,
          'tokenIn',
          `I couldn't find ${intent.tokenInSymbol} on ${this.sessionContext.network}. Please provide the token address for the token you're swapping from.`
        );
      }
    }

    if ('tokenOutSymbol' in intent && intent.tokenOutSymbol) {
      const resolved = this.resolveTokenSymbol(intent.tokenOutSymbol);
      if (resolved) {
        (intent as SwapIntent).tokenOut = resolved;
      } else if (intent.tokenOutSymbol.toUpperCase() !== 'BNB') {
        this.markUnknownToken(
          intent.tokenOutSymbol,
          result,
          'tokenOut',
          `I couldn't find ${intent.tokenOutSymbol} on ${this.sessionContext.network}. Please provide the token address for the token you're swapping to.`
        );
      }
    }

    // Validate addresses
    if ('to' in intent && intent.to && !isValidAddress(intent.to)) {
      // Invalid address, mark as missing
      if (!result.missingFields.includes('to')) {
        result.missingFields.push('to');
        result.questions.push('The address you provided is invalid. Please provide a valid 0x address.');
        result.requiresFollowUp = true;
      }
    }

    if ('contractAddress' in intent && intent.contractAddress && !isValidAddress(intent.contractAddress)) {
      if (!result.missingFields.includes('contractAddress')) {
        result.missingFields.push('contractAddress');
        result.questions.push('The contract address is invalid. Please provide a valid 0x address.');
        result.requiresFollowUp = true;
      }
    }

    // Validate amounts
    if ('amount' in intent && intent.amount && !isValidAmount(intent.amount)) {
      if (!result.missingFields.includes('amount')) {
        result.missingFields.push('amount');
        result.questions.push('The amount is invalid. Please provide a valid number.');
        result.requiresFollowUp = true;
      }
    }

    return result;
  }

  /**
   * Resolve token symbol to address
   */
  private resolveTokenSymbol(symbol: string): string | null {
    const upperSymbol = symbol.toUpperCase();
    const network = this.sessionContext.network;

    // Check if it's native BNB
    if (upperSymbol === 'BNB') {
      return null; // null indicates native token
    }

    // Check our token mapping
    const mapping = TOKEN_SYMBOLS[upperSymbol];
    if (mapping && mapping[network]) {
      return mapping[network];
    }

    return null;
  }

  /**
   * Handle unknown token symbols by asking for a contract address
   */
  private markUnknownToken(
    symbol: string,
    result: ContextExtractionResult,
    missingField: string,
    question: string
  ) {
    if (!result.missingFields.includes(missingField)) {
      result.missingFields.push(missingField);
    }
    if (!result.questions.includes(question)) {
      result.questions.push(question);
    }
    result.requiresFollowUp = true;
    logger.warn('Unknown token symbol', { symbol, network: this.sessionContext.network });
  }

  /**
   * Update session context with extracted information
   */
  private updateContext(result: ContextExtractionResult): void {
    const { intent } = result;

    // Track last referenced contract
    if ('contractAddress' in intent && intent.contractAddress) {
      this.sessionContext.lastContractAddress = intent.contractAddress;
    }

    if ('address' in intent && intent.address) {
      this.sessionContext.lastContractAddress = intent.address;
    }

    // Track last referenced token
    if ('tokenAddress' in intent && intent.tokenAddress) {
      this.sessionContext.lastTokenAddress = intent.tokenAddress;
    }

    // Store partial intent if follow-up is required
    if (result.requiresFollowUp) {
      this.sessionContext.partialIntent = intent;
    } else {
      this.sessionContext.partialIntent = undefined;
    }
  }

  /**
   * Process a follow-up message that provides missing information
   */
  async processFollowUp(message: string): Promise<ContextExtractionResult> {
    if (!this.sessionContext.partialIntent) {
      // No partial intent, treat as new message
      return this.parse(message);
    }

    // Add context about what we're expecting
    const partialIntent = this.sessionContext.partialIntent;

    // Try to extract just the missing field from the follow-up
    const extractedValue = this.extractFollowUpValue(message, partialIntent);

    if (extractedValue) {
      // Merge with partial intent
      const mergedIntent = {
        ...partialIntent,
        ...extractedValue,
        network: this.sessionContext.network,
      } as Intent;

      // Validate completeness
      const missingFields = this.checkMissingFields(mergedIntent);

      const result: ContextExtractionResult = {
        intent: mergedIntent,
        missingFields,
        questions: missingFields.length > 0 
          ? this.generateQuestions(mergedIntent.type, missingFields)
          : [],
        requiresFollowUp: missingFields.length > 0,
        confidence: 0.9,
      };

      // Post-process
      return this.postProcess(result);
    }

    // Couldn't extract value, parse as new message with context
    return this.parse(message);
  }

  /**
   * Extract value from follow-up message
   */
  private extractFollowUpValue(
    message: string,
    partialIntent: Partial<Intent>
  ): Partial<Intent> | null {
    const trimmed = message.trim();

    // Check for address
    const addressMatch = trimmed.match(/(0x[a-fA-F0-9]{40})/);
    if (addressMatch) {
      const address = addressMatch[1];
      
      // Determine which field needs this address
      if (partialIntent.type === 'transfer') {
        if (!('to' in partialIntent && partialIntent.to)) {
          return { to: address };
        }
        if (!('tokenAddress' in partialIntent && (partialIntent as Partial<TransferIntent>).tokenAddress)) {
          return { tokenAddress: address };
        }
      }
      if (partialIntent.type === 'swap') {
        const swapIntent = partialIntent as Partial<SwapIntent>;
        if (swapIntent.tokenInSymbol && !swapIntent.tokenIn) {
          return { tokenIn: address };
        }
        if (swapIntent.tokenOutSymbol && !swapIntent.tokenOut) {
          return { tokenOut: address };
        }
      }
      if (partialIntent.type === 'contract_call' && !('contractAddress' in partialIntent && partialIntent.contractAddress)) {
        return { contractAddress: address };
      }
      if (partialIntent.type === 'audit_contract' && !('address' in partialIntent && partialIntent.address)) {
        return { address };
      }
    }

    // Check for amount
    const amountMatch = trimmed.match(/^(\d+\.?\d*)\s*(\w+)?$/);
    if (amountMatch) {
      const [, amount, symbol] = amountMatch;
      const result: Partial<Intent> = { amount };
      if (symbol) {
        if (partialIntent.type === 'transfer') {
          return { ...result, tokenSymbol: symbol.toUpperCase() };
        }
        if (partialIntent.type === 'swap') {
          // Determine if this is tokenIn or tokenOut based on what's missing
          const swapIntent = partialIntent as Partial<SwapIntent>;
          if (!swapIntent.tokenInSymbol) {
            return { ...result, tokenInSymbol: symbol.toUpperCase() };
          }
        }
      }
      return result;
    }

    // Check for token symbol
    const symbolMatch = trimmed.match(/^(\w+)$/);
    if (symbolMatch && TOKEN_SYMBOLS[symbolMatch[1].toUpperCase()]) {
      const symbol = symbolMatch[1].toUpperCase();
      if (partialIntent.type === 'swap') {
        const swapIntent = partialIntent as Partial<SwapIntent>;
        if (!swapIntent.tokenInSymbol) {
          return { tokenInSymbol: symbol };
        }
        if (!swapIntent.tokenOutSymbol) {
          return { tokenOutSymbol: symbol };
        }
      }
    }

    return null;
  }

  /**
   * Check for missing required fields
   */
  private checkMissingFields(intent: Intent): string[] {
    const missing: string[] = [];

    switch (intent.type) {
      case 'transfer': {
        const t = intent as TransferIntent;
        if (!t.to) missing.push('to');
        if (!t.amount) missing.push('amount');
        break;
      }
      case 'swap': {
        const s = intent as SwapIntent;
        if (!s.tokenIn && !s.tokenInSymbol) missing.push('tokenIn');
        if (!s.tokenOut && !s.tokenOutSymbol) missing.push('tokenOut');
        if (!s.amount) missing.push('amount');
        break;
      }
      case 'contract_call': {
        const c = intent as ContractCallIntent;
        if (!c.contractAddress) missing.push('contractAddress');
        if (!c.method) missing.push('method');
        break;
      }
      case 'audit_contract': {
        if (!('address' in intent) && !('sourceCode' in intent)) {
          missing.push('address');
        }
        break;
      }
    }

    return missing;
  }

  /**
   * Generate follow-up questions
   */
  private generateQuestions(intentType: string, missingFields: string[]): string[] {
    const questions: string[] = [];

    for (const field of missingFields) {
      switch (field) {
        case 'to':
          questions.push('What address would you like to send to?');
          break;
        case 'amount':
          questions.push('How much would you like to send?');
          break;
        case 'tokenIn':
          questions.push('Which token would you like to swap from?');
          break;
        case 'tokenOut':
          questions.push('Which token would you like to receive?');
          break;
        case 'contractAddress':
          questions.push('Which contract would you like to interact with?');
          break;
        case 'method':
          questions.push('Which function would you like to call?');
          break;
        case 'address':
          questions.push('Which contract would you like to audit?');
          break;
        default:
          questions.push(`Please provide the ${field}.`);
      }
    }

    return questions;
  }

  /**
   * Get current session context
   */
  getContext(): SessionContext {
    return this.sessionContext;
  }

  /**
   * Update session context
   */
  updateSessionContext(updates: Partial<SessionContext>): void {
    Object.assign(this.sessionContext, updates);
  }

  /**
   * Add message to chat history
   */
  addToHistory(message: ChatMessage): void {
    if (!this.sessionContext.chatHistory) {
      this.sessionContext.chatHistory = [];
    }
    this.sessionContext.chatHistory.push({
      role: message.role as 'user' | 'assistant',
      content: message.content,
    });
    // Keep only last 10 messages for context
    if (this.sessionContext.chatHistory.length > 10) {
      this.sessionContext.chatHistory = this.sessionContext.chatHistory.slice(-10);
    }
  }

  /**
   * Clear partial intent
   */
  clearPartialIntent(): void {
    this.sessionContext.partialIntent = undefined;
  }
}

/**
 * Create an intent parser for a session
 */
export function createIntentParser(
  sessionId: string,
  network: NetworkType,
  walletAddress?: string,
  contextOverrides?: Partial<SessionContext>
): IntentParser {
  return new IntentParser({
    sessionId,
    network,
    walletAddress,
    ...contextOverrides,
  });
}

