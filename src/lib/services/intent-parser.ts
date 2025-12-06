import type {
  Intent,
  ContextExtractionResult,
  SessionContext,
  TransferIntent,
  SwapIntent,
  ContractCallIntent,
  ChatMessage,
  BatchIntent,
  BatchOperation,
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
      // Check for batch intent patterns first
      const batchResult = this.detectBatchIntent(message);
      if (batchResult && batchResult.intent.type === 'batch') {
        const batchIntent = batchResult.intent as BatchIntent;
        logger.debug('Detected batch intent', { operationCount: batchIntent.operations.length });
        return batchResult;
      }

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
   * Detect batch intent patterns in a message
   * Looks for phrases like "and then", "after that", "also", etc.
   */
  private detectBatchIntent(message: string): ContextExtractionResult | null {
    const lowerMessage = message.toLowerCase();
    
    // Connectors that indicate multiple operations
    const batchConnectors = [
      ' and then ',
      ' then ',
      ' after that ',
      ' also ',
      ' and also ',
      ', then ',
      '; ',
      ' followed by ',
      ' afterwards ',
    ];
    
    // Check if message contains any batch connector
    const hasBatchConnector = batchConnectors.some(c => lowerMessage.includes(c));
    
    if (!hasBatchConnector) {
      return null;
    }
    
    // Split message by connectors
    let parts: string[] = [message];
    for (const connector of batchConnectors) {
      const newParts: string[] = [];
      for (const part of parts) {
        const split = part.toLowerCase().includes(connector.toLowerCase())
          ? part.split(new RegExp(connector, 'i'))
          : [part];
        newParts.push(...split.map(s => s.trim()).filter(s => s.length > 0));
      }
      parts = newParts;
    }
    
    // If we have multiple parts, try to parse each as an operation
    if (parts.length < 2) {
      return null;
    }
    
    const operations: BatchOperation[] = [];
    const missingFields: string[] = [];
    
    for (const part of parts) {
      // Pass the previous operation for "send that to" detection
      const previousOp = operations.length > 0 ? operations[operations.length - 1] : undefined;
      const op = this.parseOperationFromText(part, previousOp);
      if (op) {
        operations.push(op);
        
        // Check for missing fields
        if (op.type === 'transfer') {
          if (!op.recipient) missingFields.push(`recipient for "${part.substring(0, 30)}..."`);
          // Don't require amount if it uses previous output
          const usesPrevious = (op as BatchOperation & { _usesPreviousOutput?: boolean })._usesPreviousOutput;
          if (!op.amount && !usesPrevious) missingFields.push(`amount for "${part.substring(0, 30)}..."`);
        } else if (op.type === 'swap') {
          if (!op.tokenInSymbol && !op.tokenIn) missingFields.push(`token to swap from in "${part.substring(0, 30)}..."`);
          if (!op.tokenOutSymbol && !op.tokenOut) missingFields.push(`token to receive in "${part.substring(0, 30)}..."`);
          if (!op.amount) missingFields.push(`amount for swap "${part.substring(0, 30)}..."`);
        }
      }
    }
    
    if (operations.length < 2) {
      return null;
    }
    
    const batchIntent: BatchIntent = {
      type: 'batch',
      operations,
      network: this.sessionContext.network,
      description: `Batch of ${operations.length} operations`,
    };
    
    return {
      intent: batchIntent,
      missingFields,
      questions: missingFields.length > 0 
        ? ['Please provide the missing details for the batch operations.']
        : [],
      requiresFollowUp: missingFields.length > 0,
      confidence: missingFields.length === 0 ? 0.85 : 0.6,
    };
  }

  /**
   * Parse a single operation from text
   * @param text - The text to parse
   * @param previousOperation - The previous operation (for "send that to" patterns)
   */
  private parseOperationFromText(text: string, previousOperation?: BatchOperation): BatchOperation | null {
    const lowerText = text.toLowerCase().trim();
    
    // Detect "send that to" / "send it to" patterns (uses output from previous operation)
    const sendThatPatterns = [
      /(?:send|transfer)\s+(?:that|it|the\s+(?:result|output))\s+to\s+(0x[a-fA-F0-9]{40})/i,
      /(?:send|transfer)\s+(?:that|it|them)\s+to\s+(\S+)/i,
    ];
    
    for (const pattern of sendThatPatterns) {
      const match = text.match(pattern);
      if (match) {
        const recipient = match[1];
        // This is a transfer that uses the output of the previous operation
        // Mark it with a special flag
        return {
          type: 'transfer',
          recipient: isValidAddress(recipient) ? recipient : undefined,
          // Use previous operation's output token and amount
          tokenSymbol: previousOperation?.tokenOutSymbol,
          tokenAddress: previousOperation?.tokenOut,
          amount: undefined, // Will be determined from swap output
          _usesPreviousOutput: true, // Special flag
        } as BatchOperation & { _usesPreviousOutput?: boolean };
      }
    }
    
    // Detect swap operations
    const swapPatterns = [
      /swap\s+(\d+(?:\.\d+)?)\s*(\w+)\s+(?:for|to)\s+(\w+)/i,
      /exchange\s+(\d+(?:\.\d+)?)\s*(\w+)\s+(?:for|to)\s+(\w+)/i,
      /convert\s+(\d+(?:\.\d+)?)\s*(\w+)\s+(?:to|into)\s+(\w+)/i,
    ];
    
    for (const pattern of swapPatterns) {
      const match = text.match(pattern);
      if (match) {
        const tokenInSymbol = match[2].toUpperCase();
        const tokenOutSymbol = match[3].toUpperCase();
        return {
          type: 'swap',
          amount: match[1],
          tokenInSymbol,
          tokenIn: this.resolveTokenSymbol(tokenInSymbol) || undefined,
          tokenOutSymbol,
          tokenOut: this.resolveTokenSymbol(tokenOutSymbol) || undefined,
          slippageBps: 300,
        };
      }
    }
    
    // Detect transfer operations
    const transferPatterns = [
      /(?:send|transfer)\s+(\d+(?:\.\d+)?)\s*(\w+)\s+to\s+(0x[a-fA-F0-9]{40})/i,
      /(?:send|transfer)\s+(\d+(?:\.\d+)?)\s*(\w+)\s+to\s+(\S+)/i,
    ];
    
    for (const pattern of transferPatterns) {
      const match = text.match(pattern);
      if (match) {
        const tokenSymbol = match[2].toUpperCase();
        const recipient = match[3];
        return {
          type: 'transfer',
          amount: match[1],
          tokenSymbol,
          tokenAddress: tokenSymbol === 'BNB' ? null : this.resolveTokenSymbol(tokenSymbol) || undefined,
          recipient: isValidAddress(recipient) ? recipient : undefined,
        };
      }
    }
    
    return null;
  }

  /**
   * Post-process extraction result
   */
  private postProcess(result: ContextExtractionResult): ContextExtractionResult {
    const { intent } = result;

    // Resolve token symbols to addresses ONLY if address is not already set
    if ('tokenSymbol' in intent && intent.tokenSymbol) {
      const transferIntent = intent as TransferIntent;
      // Skip resolution if tokenAddress is already provided (e.g., from follow-up)
      if (!transferIntent.tokenAddress) {
        const resolved = this.resolveTokenSymbol(intent.tokenSymbol);
        if (resolved) {
          transferIntent.tokenAddress = resolved;
        } else if (intent.tokenSymbol.toUpperCase() !== 'BNB') {
          this.markUnknownToken(
            intent.tokenSymbol,
            result,
            'tokenAddress',
            `I couldn't find ${intent.tokenSymbol} on ${this.sessionContext.network}. Please provide the contract address.`
          );
        }
      }
    }

    if ('tokenInSymbol' in intent && intent.tokenInSymbol) {
      const swapIntent = intent as SwapIntent;
      // Skip resolution if tokenIn is already provided
      if (!swapIntent.tokenIn) {
        const resolved = this.resolveTokenSymbol(intent.tokenInSymbol);
        if (resolved) {
          swapIntent.tokenIn = resolved;
        } else if (intent.tokenInSymbol.toUpperCase() !== 'BNB') {
          this.markUnknownToken(
            intent.tokenInSymbol,
            result,
            'tokenIn',
            `I couldn't find ${intent.tokenInSymbol} on ${this.sessionContext.network}. Please provide the token address for the token you're swapping from.`
          );
        }
      }
    }

    if ('tokenOutSymbol' in intent && intent.tokenOutSymbol) {
      const swapIntent = intent as SwapIntent;
      // Skip resolution if tokenOut is already provided
      if (!swapIntent.tokenOut) {
        const resolved = this.resolveTokenSymbol(intent.tokenOutSymbol);
        if (resolved) {
          swapIntent.tokenOut = resolved;
        } else if (intent.tokenOutSymbol.toUpperCase() !== 'BNB') {
          this.markUnknownToken(
            intent.tokenOutSymbol,
            result,
            'tokenOut',
            `I couldn't find ${intent.tokenOutSymbol} on ${this.sessionContext.network}. Please provide the token address for the token you're swapping to.`
          );
        }
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
    // Check if token exists on mainnet but not testnet
    const upperSymbol = symbol.toUpperCase();
    const mapping = TOKEN_SYMBOLS[upperSymbol];
    const network = this.sessionContext.network;
    
    let customQuestion = question;
    
    if (mapping) {
      // Token is known but not available on current network
      if (network === 'testnet' && mapping.mainnet && !mapping.testnet) {
        customQuestion = `${symbol} is available on mainnet but not on testnet. If you have a testnet version of this token, please provide its contract address.`;
      } else if (network === 'mainnet' && mapping.testnet && !mapping.mainnet) {
        customQuestion = `${symbol} is available on testnet but not on mainnet. Please provide the contract address if you have one.`;
      }
    }
    
    if (!result.missingFields.includes(missingField)) {
      result.missingFields.push(missingField);
    }
    // Replace the generic question with our custom one
    const existingQuestionIndex = result.questions.findIndex(q => q.includes(symbol));
    if (existingQuestionIndex >= 0) {
      result.questions[existingQuestionIndex] = customQuestion;
    } else if (!result.questions.includes(customQuestion)) {
      result.questions.push(customQuestion);
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
    
    logger.debug('Processing follow-up with partial intent', { 
      partialIntentType: partialIntent.type,
      message: message.slice(0, 100)
    });

    // Try to extract just the missing field from the follow-up
    const extractedValue = this.extractFollowUpValue(message, partialIntent);

    if (extractedValue) {
      logger.debug('Extracted follow-up value', { extractedValue });
      
      // Merge with partial intent
      const mergedIntent = {
        ...partialIntent,
        ...extractedValue,
        network: this.sessionContext.network,
      } as Intent;

      // Check completeness AFTER merge, considering the new tokenAddress
      const missingFields = this.checkMissingFieldsExtended(mergedIntent);

      const result: ContextExtractionResult = {
        intent: mergedIntent,
        missingFields,
        questions: missingFields.length > 0 
          ? this.generateQuestions(mergedIntent.type, missingFields)
          : [],
        requiresFollowUp: missingFields.length > 0,
        confidence: 0.9,
      };

      // Post-process (this will now skip symbol resolution since address is set)
      const processed = this.postProcess(result);
      
      // Update context
      this.updateContext(processed);
      
      return processed;
    }

    // Couldn't extract simple value, but check if message looks like it's providing missing info
    // If the message is just an address and we need an address, extract it directly
    const addressMatch = message.trim().match(/^(0x[a-fA-F0-9]{40})$/);
    if (addressMatch) {
      logger.debug('Follow-up appears to be just an address', { address: addressMatch[1] });
      
      // Determine which field needs this address based on missing fields
      let fieldToFill: Partial<Intent> | null = null;
      
      if (partialIntent.type === 'transfer') {
        const t = partialIntent as Partial<TransferIntent>;
        if (!t.tokenAddress && t.tokenSymbol) {
          // User is providing token address for unknown token
          fieldToFill = { tokenAddress: addressMatch[1] };
        } else if (!t.to) {
          fieldToFill = { to: addressMatch[1] };
        }
      } else if (partialIntent.type === 'swap') {
        const s = partialIntent as Partial<SwapIntent>;
        if (s.tokenInSymbol && !s.tokenIn) {
          fieldToFill = { tokenIn: addressMatch[1] };
        } else if (s.tokenOutSymbol && !s.tokenOut) {
          fieldToFill = { tokenOut: addressMatch[1] };
        }
      } else if (partialIntent.type === 'contract_call') {
        const c = partialIntent as Partial<ContractCallIntent>;
        if (!c.contractAddress) {
          fieldToFill = { contractAddress: addressMatch[1] };
        }
      } else if (partialIntent.type === 'audit_contract') {
        if (!('address' in partialIntent)) {
          fieldToFill = { address: addressMatch[1] };
        }
      }
      
      if (fieldToFill) {
        const mergedIntent = {
          ...partialIntent,
          ...fieldToFill,
          network: this.sessionContext.network,
        } as Intent;
        
        const missingFields = this.checkMissingFieldsExtended(mergedIntent);
        
        const result: ContextExtractionResult = {
          intent: mergedIntent,
          missingFields,
          questions: missingFields.length > 0 
            ? this.generateQuestions(mergedIntent.type, missingFields)
            : [],
          requiresFollowUp: missingFields.length > 0,
          confidence: 0.95,
        };
        
        const processed = this.postProcess(result);
        this.updateContext(processed);
        return processed;
      }
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

    // Check for address - this is the primary extraction for follow-ups
    const addressMatch = trimmed.match(/(0x[a-fA-F0-9]{40})/);
    if (addressMatch) {
      const address = addressMatch[1];
      
      // Determine which field needs this address based on intent type and what's missing
      if (partialIntent.type === 'transfer') {
        const transferIntent = partialIntent as Partial<TransferIntent>;
        
        // Priority 1: If we have a tokenSymbol that couldn't be resolved, this is likely the token address
        if (transferIntent.tokenSymbol && transferIntent.tokenSymbol.toUpperCase() !== 'BNB') {
          const resolved = this.resolveTokenSymbol(transferIntent.tokenSymbol);
          if (!resolved && !transferIntent.tokenAddress) {
            logger.debug('Matched address to missing tokenAddress for unresolved symbol', { 
              symbol: transferIntent.tokenSymbol, 
              address 
            });
            return { tokenAddress: address };
          }
        }
        
        // Priority 2: If 'to' is missing, this could be the recipient
        if (!transferIntent.to) {
          return { to: address };
        }
        
        // Priority 3: If tokenAddress is explicitly missing
        if (!transferIntent.tokenAddress) {
          return { tokenAddress: address };
        }
      }
      
      if (partialIntent.type === 'swap') {
        const swapIntent = partialIntent as Partial<SwapIntent>;
        
        // Check if tokenIn needs to be resolved
        if (swapIntent.tokenInSymbol && swapIntent.tokenInSymbol.toUpperCase() !== 'BNB') {
          const resolved = this.resolveTokenSymbol(swapIntent.tokenInSymbol);
          if (!resolved && !swapIntent.tokenIn) {
            return { tokenIn: address };
          }
        }
        
        // Check if tokenOut needs to be resolved
        if (swapIntent.tokenOutSymbol && swapIntent.tokenOutSymbol.toUpperCase() !== 'BNB') {
          const resolved = this.resolveTokenSymbol(swapIntent.tokenOutSymbol);
          if (!resolved && !swapIntent.tokenOut) {
            return { tokenOut: address };
          }
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
   * Extended check for missing fields that includes tokenAddress validation
   * This accounts for tokens that couldn't be resolved from symbol
   */
  private checkMissingFieldsExtended(intent: Intent): string[] {
    const missing: string[] = [];

    switch (intent.type) {
      case 'transfer': {
        const t = intent as TransferIntent;
        if (!t.to) missing.push('to');
        if (!t.amount) missing.push('amount');
        // Check if we have a symbol but no resolved address (and it's not native BNB)
        if (t.tokenSymbol && t.tokenSymbol.toUpperCase() !== 'BNB' && !t.tokenAddress) {
          // Only mark as missing if we can't resolve the symbol
          const resolved = this.resolveTokenSymbol(t.tokenSymbol);
          if (!resolved) {
            missing.push('tokenAddress');
          }
        }
        break;
      }
      case 'swap': {
        const s = intent as SwapIntent;
        // Check tokenIn
        if (!s.tokenIn) {
          if (!s.tokenInSymbol) {
            missing.push('tokenIn');
          } else if (s.tokenInSymbol.toUpperCase() !== 'BNB') {
            const resolved = this.resolveTokenSymbol(s.tokenInSymbol);
            if (!resolved) {
              missing.push('tokenIn');
            }
          }
        }
        // Check tokenOut
        if (!s.tokenOut) {
          if (!s.tokenOutSymbol) {
            missing.push('tokenOut');
          } else if (s.tokenOutSymbol.toUpperCase() !== 'BNB') {
            const resolved = this.resolveTokenSymbol(s.tokenOutSymbol);
            if (!resolved) {
              missing.push('tokenOut');
            }
          }
        }
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
      case 'batch': {
        const b = intent as BatchIntent;
        if (!b.operations || b.operations.length === 0) {
          missing.push('operations');
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

