import { NextRequest, NextResponse } from 'next/server';
import { createIntentParser } from '@/lib/services/intent-parser';
import { chainGPT, researchTopic, explainContract } from '@/lib/services/chaingpt';
import { createPolicyEngine, getDefaultPolicy } from '@/lib/services/policy';
import { 
  buildNativeTransfer, 
  buildTokenTransfer, 
  buildSwap,
  createTransactionPreview,
  getTokenInfo 
} from '@/lib/services/web3';
import { createAdminClient } from '@/lib/supabase/server';
import { 
  isIntentComplete,
  type ChatRequest, 
  type ChatResponse, 
  type Intent,
  type TransferIntent,
  type SwapIntent,
  type TransactionPreview,
  type ChatMessage,
} from '@/lib/types';
import { formatErrorResponse, getErrorStatusCode, ValidationError } from '@/lib/utils/errors';
import { validateChatMessage, isValidNetwork } from '@/lib/utils/validation';
import { logger } from '@/lib/utils';
import { type NetworkType } from '@/lib/utils/constants';

function intentNeedsFollowUp(intent: Intent): boolean {
  // Base check using required fields
  if (!isIntentComplete(intent)) return true;

  // Additional heuristics for symbol-only tokens
  if (intent.type === 'transfer') {
    const t = intent as TransferIntent;
    if (t.tokenSymbol && !t.tokenAddress) return true;
  }

  if (intent.type === 'swap') {
    const s = intent as SwapIntent;
    if ((s.tokenInSymbol && !s.tokenIn) || (s.tokenOutSymbol && !s.tokenOut)) {
      return true;
    }
  }

  return false;
}

// Extended chat request with conversation support
interface ExtendedChatRequest extends ChatRequest {
  conversationId?: string;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body: ExtendedChatRequest = await request.json();

    // Validate input
    const validation = validateChatMessage(body.message);
    if (!validation.valid) {
      throw new ValidationError(validation.error || 'Invalid message');
    }

    if (!body.sessionId) {
      throw new ValidationError('Session ID is required');
    }

    logger.apiRequest('POST', '/api/chat', { sessionId: body.sessionId, conversationId: body.conversationId });

    const supabase = createAdminClient();

    // Get session context from database
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', body.sessionId)
      .single();

    if (sessionError || !sessionData) {
      throw new ValidationError('Invalid session ID');
    }

    const network: NetworkType = sessionData.current_network as NetworkType;
    const walletAddress = sessionData.wallet_address;

    // Get or create conversation
    let conversationId = body.conversationId;
    
    if (!conversationId) {
      // Create a new conversation
      const { data: newConversation, error: convError } = await supabase
        .from('conversations')
        .insert({
          session_id: body.sessionId,
          title: 'New Chat',
          is_active: true,
        })
        .select()
        .single();

      if (convError) {
        logger.error('Error creating conversation', convError);
        throw new Error('Failed to create conversation');
      }

      conversationId = newConversation.id;
      logger.info('Created new conversation', { conversationId });
    }

    // Save user message to database (let DB generate UUID)
    const { data: savedUserMsg, error: userMsgError } = await supabase
      .from('chat_messages')
      .insert({
        session_id: body.sessionId,
        conversation_id: conversationId,
        role: 'user',
        content: body.message,
      })
      .select('id')
      .single();

    if (userMsgError) {
      logger.error('Error saving user message', userMsgError);
      // Don't throw - continue with the chat
    }

    // Load recent conversation context to support follow-ups
    const { data: recentMessages } = await supabase
      .from('chat_messages')
      .select('role, content, intent, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(10);

    let partialIntent: Partial<Intent> | undefined;
    let chatHistory: { role: 'user' | 'assistant'; content: string }[] | undefined;

    if (recentMessages && recentMessages.length > 0) {
      chatHistory = recentMessages
        .map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        }))
        .reverse(); // Oldest to newest for context

      const lastAssistantWithIntent = recentMessages.find(
        (msg) => msg.role === 'assistant' && msg.intent
      );

      if (lastAssistantWithIntent?.intent) {
        try {
          const parsedIntent =
            typeof lastAssistantWithIntent.intent === 'string'
              ? (JSON.parse(lastAssistantWithIntent.intent) as Intent)
              : (lastAssistantWithIntent.intent as Intent);

          if (parsedIntent && intentNeedsFollowUp(parsedIntent)) {
            partialIntent = parsedIntent;
          }
        } catch (error) {
          logger.warn('Failed to parse intent from history', error);
        }
      }
    }

    // Parse user intent (or follow-up)
    const intentParser = createIntentParser(body.sessionId, network, walletAddress, {
      partialIntent,
      chatHistory,
    });

    const extractionResult = partialIntent
      ? await intentParser.processFollowUp(body.message)
      : await intentParser.parse(body.message);

    // Build response based on intent
    const response = await buildResponse(
      body.message,
      extractionResult,
      network,
      walletAddress,
      body.sessionId,
      conversationId
    );

    // Save assistant message to database (let DB generate UUID)
    const { data: savedAssistantMsg, error: assistantMsgError } = await supabase
      .from('chat_messages')
      .insert({
        session_id: body.sessionId,
        conversation_id: conversationId,
        role: 'assistant',
        content: response.message.content,
        intent: response.intent ? JSON.stringify(response.intent) : null,
      })
      .select('id')
      .single();

    if (assistantMsgError) {
      logger.error('Error saving assistant message', assistantMsgError);
      // Don't throw - message already generated
    }

    // Update response message ID with the database-generated UUID
    if (savedAssistantMsg?.id) {
      response.message.id = savedAssistantMsg.id;
    }

    // Add conversationId to response
    response.conversationId = conversationId;

    const duration = Date.now() - startTime;
    logger.apiResponse('POST', '/api/chat', 200, duration);

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Chat API error', error);
    logger.apiResponse('POST', '/api/chat', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

async function buildResponse(
  userMessage: string,
  extractionResult: Awaited<ReturnType<typeof createIntentParser.prototype.parse>>,
  network: NetworkType,
  walletAddress: string,
  sessionId: string,
  conversationId: string
): Promise<ChatResponse> {
  const { intent, missingFields, questions, requiresFollowUp, confidence } = extractionResult;

  // If follow-up is required, return questions
  if (requiresFollowUp) {
    return {
      message: {
        id: generateId(),
        sessionId,
        role: 'assistant',
        content: questions.join('\n'),
        intent,
        createdAt: new Date().toISOString(),
      },
      intent,
      requiresFollowUp: true,
      followUpQuestions: questions,
    };
  }

  // Handle different intent types
  switch (intent.type) {
    case 'research': {
      // Use the original user message as the query if intent.query is empty
      const query = intent.query || userMessage;
      logger.debug('Research query', { query, intentQuery: intent.query, userMessage });
      
      const result = await researchTopic(query, intent.topics);
      return {
        message: {
          id: generateId(),
          sessionId,
          role: 'assistant',
          content: result.answer,
          intent,
          createdAt: new Date().toISOString(),
        },
        intent,
        requiresFollowUp: false,
        explanation: result.answer,
      };
    }

    case 'explain': {
      let content = '';
      // Use the original user message as the query if intent.query is empty
      const query = intent.query || userMessage;
      logger.debug('Explain query', { query, intentQuery: intent.query, userMessage, address: intent.address });
      
      if (intent.address) {
        const result = await explainContract(intent.address, network);
        content = result.explanation;
      } else {
        const result = await researchTopic(query);
        content = result.answer;
      }
      return {
        message: {
          id: generateId(),
          sessionId,
          role: 'assistant',
          content,
          intent,
          createdAt: new Date().toISOString(),
        },
        intent,
        requiresFollowUp: false,
        explanation: content,
      };
    }

    case 'generate_contract': {
      // Use intent.specText if available, otherwise fall back to the original user message
      const specText = intent.specText || userMessage;
      logger.debug('Generating contract', { specText, intentSpecText: intent.specText, userMessage });
      
      const result = await chainGPT.generateContract(specText);
      let content = '';
      if (result.success && result.sourceCode) {
        // Show full contract code (no truncation)
        const warningsSection = result.warnings?.length 
          ? `\n\n**⚠️ Warnings:**\n${result.warnings.map(w => `- ${w}`).join('\n')}` 
          : '';
        
        content = `I've generated a **${result.contractName || 'smart contract'}** based on your requirements.\n\n\`\`\`solidity\n${result.sourceCode}\n\`\`\`${warningsSection}`;
        
        // Auto-audit the generated contract
        const auditResult = await chainGPT.auditContract(result.sourceCode);
        
        return {
          message: {
            id: generateId(),
            sessionId,
            role: 'assistant',
            content,
            intent,
            createdAt: new Date().toISOString(),
          },
          intent,
          requiresFollowUp: false,
          generatedContract: {
            id: generateId(),
            sessionId,
            contractId: null,
            specText: specText,
            sourceCode: result.sourceCode,
            network,
            deployedAddress: null,
            deploymentTxHash: null,
            createdAt: new Date().toISOString(),
            deployedAt: null,
          },
          auditResult,
        };
      } else {
        content = `Sorry, I couldn't generate the contract: ${result.error || 'Unknown error'}`;
        return {
          message: {
            id: generateId(),
            sessionId,
            role: 'assistant',
            content,
            intent,
            createdAt: new Date().toISOString(),
          },
          intent,
          requiresFollowUp: false,
        };
      }
    }

    case 'audit_contract': {
      if (!intent.address && !intent.sourceCode) {
        return {
          message: {
            id: generateId(),
            sessionId,
            role: 'assistant',
            content: 'Please provide a contract address or source code to audit.',
            intent,
            createdAt: new Date().toISOString(),
          },
          intent,
          requiresFollowUp: true,
          followUpQuestions: ['Which contract would you like to audit?'],
        };
      }

      const sourceCode = intent.sourceCode || '';
      // In production, fetch source code from address if not provided
      const auditResult = await chainGPT.auditContract(sourceCode);

      const content = `## Audit Results\n\n**Risk Level:** ${auditResult.riskLevel}\n\n${auditResult.summary}\n\n` +
        (auditResult.majorFindings.length > 0 
          ? `### Major Findings\n${auditResult.majorFindings.map(f => `- **${f.title}**: ${f.description}`).join('\n')}\n\n`
          : '') +
        (auditResult.recommendations.length > 0
          ? `### Recommendations\n${auditResult.recommendations.map(r => `- ${r}`).join('\n')}`
          : '');

      return {
        message: {
          id: generateId(),
          sessionId,
          role: 'assistant',
          content,
          intent,
          createdAt: new Date().toISOString(),
        },
        intent,
        requiresFollowUp: false,
        auditResult,
      };
    }

    case 'transfer': {
      const transferIntent = intent as TransferIntent;
      if (!transferIntent.to || !transferIntent.amount) {
        return {
          message: {
            id: generateId(),
            sessionId,
            role: 'assistant',
            content: 'Please provide both recipient address and amount.',
            intent,
            createdAt: new Date().toISOString(),
          },
          intent,
          requiresFollowUp: true,
          followUpQuestions: missingFields.map(f => 
            f === 'to' ? 'What address would you like to send to?' : `How much would you like to send?`
          ),
        };
      }

      // Build transaction
      let preparedTx;
      let tokenSymbol = transferIntent.tokenSymbol || 'BNB';
      
      if (transferIntent.tokenAddress) {
        preparedTx = await buildTokenTransfer(
          walletAddress,
          transferIntent.to,
          transferIntent.tokenAddress,
          transferIntent.amount,
          network
        );
        const tokenInfo = await getTokenInfo(transferIntent.tokenAddress, network);
        tokenSymbol = tokenInfo.symbol;
      } else {
        preparedTx = await buildNativeTransfer(
          walletAddress,
          transferIntent.to,
          transferIntent.amount,
          network
        );
      }

      const preview = await createTransactionPreview(
        transferIntent.tokenAddress ? 'token_transfer' : 'transfer',
        preparedTx,
        {
          from: walletAddress,
          network,
          tokenSymbol,
          tokenAddress: transferIntent.tokenAddress || undefined,
          amount: transferIntent.amount,
        }
      );

      // Evaluate policy
      const policy = getDefaultPolicy(sessionId);
      const policyEngine = createPolicyEngine(policy, network);
      const policyDecision = await policyEngine.evaluate(
        'transfer',
        { targetAddress: transferIntent.to },
        0,
        walletAddress
      );

      const content = `Ready to transfer ${transferIntent.amount} ${tokenSymbol} to ${transferIntent.to.slice(0, 10)}...${transferIntent.to.slice(-8)}`;

      return {
        message: {
          id: generateId(),
          sessionId,
          role: 'assistant',
          content,
          intent,
          createdAt: new Date().toISOString(),
        },
        intent,
        requiresFollowUp: false,
        transactionPreview: preview,
        policyDecision,
      };
    }

    case 'swap': {
      const swapIntent = intent as SwapIntent;
      if (!swapIntent.amount) {
        return {
          message: {
            id: generateId(),
            sessionId,
            role: 'assistant',
            content: 'How much would you like to swap?',
            intent,
            createdAt: new Date().toISOString(),
          },
          intent,
          requiresFollowUp: true,
          followUpQuestions: ['How much would you like to swap?'],
        };
      }

      const swapResult = await buildSwap(
        walletAddress,
        swapIntent.tokenIn || null,
        swapIntent.tokenOut || null,
        swapIntent.amount,
        network,
        swapIntent.slippageBps || 300
      );

      const preview = await createTransactionPreview(
        'swap',
        swapResult.preparedTx,
        {
          from: walletAddress,
          network,
          amount: swapIntent.amount,
          tokenInSymbol: swapIntent.tokenInSymbol || 'Token',
          tokenOutSymbol: swapIntent.tokenOutSymbol || 'Token',
          tokenOutAmount: swapResult.quote.amountOut,
          slippageBps: swapIntent.slippageBps || 300,
        }
      );

      const policy = getDefaultPolicy(sessionId);
      const policyEngine = createPolicyEngine(policy, network);
      const policyDecision = await policyEngine.evaluate(
        'swap',
        { slippageBps: swapIntent.slippageBps || 300 },
        0,
        walletAddress
      );

      const content = `Ready to swap ${swapIntent.amount} ${swapIntent.tokenInSymbol || 'tokens'} for approximately ${swapResult.quote.amountOut} ${swapIntent.tokenOutSymbol || 'tokens'}`;

      return {
        message: {
          id: generateId(),
          sessionId,
          role: 'assistant',
          content,
          intent,
          createdAt: new Date().toISOString(),
        },
        intent,
        requiresFollowUp: false,
        transactionPreview: preview,
        policyDecision,
      };
    }

    default:
      return {
        message: {
          id: generateId(),
          sessionId,
          role: 'assistant',
          content: "I'm not sure how to help with that. Try asking me to research a token, generate a contract, or execute a transaction.",
          intent,
          createdAt: new Date().toISOString(),
        },
        intent,
        requiresFollowUp: false,
      };
  }
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

