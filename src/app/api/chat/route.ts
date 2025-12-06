import { NextRequest, NextResponse } from 'next/server';
import { createIntentParser } from '@/lib/services/intent-parser';
import { chainGPT, researchTopic, explainContract } from '@/lib/services/chaingpt';
import { createPolicyEngine, getDefaultPolicy } from '@/lib/services/policy';
import { 
  buildNativeTransfer, 
  buildTokenTransfer, 
  buildSwap,
  createTransactionPreview,
  getTokenInfo,
  checkQ402ApprovalNeeded,
  buildQ402Approval,
  checkSwapApprovalNeeded,
  buildSwapApproval,
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
import { type NetworkType, Q402_FACILITATOR } from '@/lib/utils/constants';
import { storePendingTransfer, storePendingSwap } from '@/lib/services/q402';
import { formatUnits } from 'ethers';

function intentNeedsFollowUp(intent: Intent): boolean {
  // Base check using required fields
  if (!isIntentComplete(intent)) return true;

  // Additional heuristics for symbol-only tokens that couldn't be resolved
  if (intent.type === 'transfer') {
    const t = intent as TransferIntent;
    // Only needs follow-up if there's a non-native token symbol without an address
    if (t.tokenSymbol && 
        t.tokenSymbol.toUpperCase() !== 'BNB' && 
        !t.tokenAddress) {
      return true;
    }
  }

  if (intent.type === 'swap') {
    const s = intent as SwapIntent;
    // Check tokenIn - needs follow-up if symbol exists but no address and not native
    const tokenInNeedsAddress = s.tokenInSymbol && 
                                s.tokenInSymbol.toUpperCase() !== 'BNB' && 
                                !s.tokenIn;
    // Check tokenOut - needs follow-up if symbol exists but no address and not native
    const tokenOutNeedsAddress = s.tokenOutSymbol && 
                                 s.tokenOutSymbol.toUpperCase() !== 'BNB' && 
                                 !s.tokenOut;
    if (tokenInNeedsAddress || tokenOutNeedsAddress) {
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
              : (lastAssistantWithIntent.intent as unknown as Intent);

          if (parsedIntent && intentNeedsFollowUp(parsedIntent)) {
            partialIntent = parsedIntent;
          }
        } catch (e) {
          logger.warn('Failed to parse intent from history', { error: e instanceof Error ? e.message : String(e) });
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
          followUpQuestions: missingFields.map((f: string) => 
            f === 'to' ? 'What address would you like to send to?' : `How much would you like to send?`
          ),
        };
      }

      // Build transaction
      let preparedTx;
      let tokenSymbol = transferIntent.tokenSymbol || 'BNB';
      
      // Validate tokenAddress is different from recipient (ChainGPT sometimes confuses them)
      let effectiveTokenAddress = transferIntent.tokenAddress;
      if (effectiveTokenAddress && effectiveTokenAddress.toLowerCase() === transferIntent.to.toLowerCase()) {
        // Token address was incorrectly set to recipient address - clear it
        logger.debug('Clearing tokenAddress that matches recipient address', { 
          tokenAddress: effectiveTokenAddress, 
          to: transferIntent.to 
        });
        effectiveTokenAddress = undefined;
      }
      
      if (effectiveTokenAddress) {
        // Validate the token contract first
        try {
          const tokenInfo = await getTokenInfo(effectiveTokenAddress, network);
          tokenSymbol = tokenInfo.symbol;
        } catch (error) {
          // Invalid ERC20 contract - ask user to verify
          const errorMessage = error instanceof Error ? error.message : 'Invalid token contract';
          logger.warn('Failed to get token info', { 
            tokenAddress: effectiveTokenAddress, 
            network, 
            error: errorMessage 
          });
          
          // Clear the invalid token address so user can try again
          const updatedIntent = { ...transferIntent, tokenAddress: undefined };
          
          return {
            message: {
              id: generateId(),
              sessionId,
              role: 'assistant',
              content: errorMessage,
              intent: updatedIntent,
              createdAt: new Date().toISOString(),
            },
            intent: updatedIntent,
            requiresFollowUp: true,
            followUpQuestions: ['Please provide a valid ERC20 token contract address.'],
          };
        }
        
        // Check if user needs to approve Q402 contract before token transfer
        const approvalCheck = await checkQ402ApprovalNeeded(
          effectiveTokenAddress,
          walletAddress,
          transferIntent.amount,
          network
        );
        
        if (approvalCheck.needsApproval) {
          // User needs to approve Q402 contract first
          logger.info('Q402 approval needed', {
            tokenAddress: effectiveTokenAddress,
            walletAddress,
            requiredAmount: approvalCheck.requiredAmount.toString(),
            currentAllowance: approvalCheck.currentAllowance.toString(),
            q402Contract: approvalCheck.q402ContractAddress,
          });
          
          // Build approval transaction
          const approvalTx = await buildQ402Approval(
            walletAddress,
            effectiveTokenAddress,
            transferIntent.amount,
            network
          );
          
          const approvalPreview = await createTransactionPreview(
            'contract_call',
            approvalTx,
            {
              from: walletAddress,
              network,
              tokenSymbol,
              tokenAddress: effectiveTokenAddress,
              amount: transferIntent.amount,
              methodName: 'approve',
            }
          );
          
          // Evaluate policy for approval
          const policy = getDefaultPolicy(sessionId);
          const policyEngine = createPolicyEngine(policy, network);
          const approvalPolicyDecision = await policyEngine.evaluate(
            'contract_call',
            { targetAddress: effectiveTokenAddress },
            0,
            walletAddress
          );
          
          const content = `Before transferring ${transferIntent.amount} ${tokenSymbol}, you need to approve the ChainPilot contract to spend your tokens.\n\n` +
            `**Step 1 of 2**: Approve ${tokenSymbol} spending\n` +
            `Contract: ${approvalCheck.q402ContractAddress.slice(0, 10)}...${approvalCheck.q402ContractAddress.slice(-8)}\n\n` +
            `⚠️ **Note**: You will need to pay gas for this approval transaction (approvals must come directly from your wallet).\n\n` +
            `After approval, the transfer will be gas-free and proceed automatically.`;
          
          // Generate a pending transfer ID
          const pendingTransferId = `pending_${sessionId}_${Date.now()}`;
          
          // Store the pending transfer for automatic follow-up after approval
          const now = new Date();
          const expiresAt = new Date(now.getTime() + Q402_FACILITATOR.requestExpiryMs);
          
          storePendingTransfer({
            approvalRequestId: pendingTransferId, // Will be updated when Q402 request is created
            sessionId,
            network,
            walletAddress,
            tokenAddress: effectiveTokenAddress,
            tokenSymbol,
            recipientAddress: transferIntent.to,
            amount: transferIntent.amount,
            createdAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
          });
          
          logger.info('Stored pending transfer for automatic follow-up', {
            pendingTransferId,
            tokenAddress: effectiveTokenAddress,
            recipient: transferIntent.to,
            amount: transferIntent.amount,
          });
          
          // Store the pending transfer intent for follow-up
          const pendingTransferIntent = {
            ...transferIntent,
            _pendingApproval: true,
            _pendingTransferId: pendingTransferId,
          };
          
          return {
            message: {
              id: generateId(),
              sessionId,
              role: 'assistant',
              content,
              intent: pendingTransferIntent,
              createdAt: new Date().toISOString(),
            },
            intent: pendingTransferIntent,
            requiresFollowUp: false, // User needs to sign approval first
            transactionPreview: approvalPreview,
            policyDecision: approvalPolicyDecision,
            approvalRequired: {
              tokenAddress: effectiveTokenAddress,
              tokenSymbol,
              spenderAddress: approvalCheck.q402ContractAddress,
              amount: transferIntent.amount,
              currentAllowance: approvalCheck.currentAllowance.toString(),
              requiredAmount: approvalCheck.requiredAmount.toString(),
              pendingTransferId, // Include ID so frontend can pass it through
              isDirectTransaction: true, // User must send this directly (pays gas) - approvals cannot be gas-sponsored
            },
          };
        }
        
        preparedTx = await buildTokenTransfer(
          walletAddress,
          transferIntent.to,
          effectiveTokenAddress,
          transferIntent.amount,
          network
        );
      } else if (transferIntent.tokenSymbol && 
                 transferIntent.tokenSymbol.toUpperCase() !== 'BNB' && 
                 transferIntent.tokenSymbol.toUpperCase() !== 'TBNB') {
        // User specified a non-native token but we don't have the address - ask for it
        const updatedIntent = { ...transferIntent };
        return {
          message: {
            id: generateId(),
            sessionId,
            role: 'assistant',
            content: `I need the contract address for ${transferIntent.tokenSymbol} to proceed with the transfer.`,
            intent: updatedIntent,
            createdAt: new Date().toISOString(),
          },
          intent: updatedIntent,
          requiresFollowUp: true,
          followUpQuestions: [`What is the contract address for ${transferIntent.tokenSymbol}?`],
        };
      } else {
        // Native BNB transfer
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
          recipient: transferIntent.to, // The actual recipient address
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

      // Determine if this is a native BNB input (no approval needed) or token input (may need approval)
      const isNativeIn = !swapIntent.tokenIn || swapIntent.tokenInSymbol?.toUpperCase() === 'BNB';
      const tokenInSymbol = swapIntent.tokenInSymbol || (isNativeIn ? 'BNB' : 'Token');
      const tokenOutSymbol = swapIntent.tokenOutSymbol || 'Token';
      const slippageBps = swapIntent.slippageBps || 300;

      // If token input (not native BNB), check if approval is needed for PancakeSwap router
      if (!isNativeIn && swapIntent.tokenIn) {
        const approvalCheck = await checkSwapApprovalNeeded(
          swapIntent.tokenIn,
          walletAddress,
          swapIntent.amount,
          network
        );
        
        if (approvalCheck.needsApproval) {
          // User needs to approve PancakeSwap router first
          logger.info('Swap approval needed', {
            tokenIn: swapIntent.tokenIn,
            walletAddress,
            requiredAmount: approvalCheck.requiredAmount.toString(),
            currentAllowance: approvalCheck.currentAllowance.toString(),
            routerAddress: approvalCheck.routerAddress,
          });
          
          // Build approval transaction (user pays gas for approval)
          const approvalTx = await buildSwapApproval(
            walletAddress,
            swapIntent.tokenIn,
            network
          );
          
          const approvalPreview = await createTransactionPreview(
            'contract_call',
            approvalTx,
            {
              from: walletAddress,
              network,
              tokenSymbol: tokenInSymbol,
              tokenAddress: swapIntent.tokenIn,
              amount: swapIntent.amount,
              methodName: 'approve',
            }
          );
          
          // Evaluate policy for approval
          const policy = getDefaultPolicy(sessionId);
          const policyEngine = createPolicyEngine(policy, network);
          const approvalPolicyDecision = await policyEngine.evaluate(
            'contract_call',
            { targetAddress: swapIntent.tokenIn },
            0,
            walletAddress
          );
          
          // Generate a pending swap ID
          const pendingSwapId = `pending_swap_${sessionId}_${Date.now()}`;
          
          // Store the pending swap for automatic follow-up after approval
          const now = new Date();
          const expiresAt = new Date(now.getTime() + Q402_FACILITATOR.requestExpiryMs);
          
          storePendingSwap({
            approvalRequestId: pendingSwapId,
            sessionId,
            network,
            walletAddress,
            tokenIn: swapIntent.tokenIn,
            tokenInSymbol,
            tokenOut: swapIntent.tokenOut || null,
            tokenOutSymbol,
            amount: swapIntent.amount,
            slippageBps,
            createdAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
          });
          
          logger.info('Stored pending swap for automatic follow-up', {
            pendingSwapId,
            tokenIn: swapIntent.tokenIn,
            tokenOut: swapIntent.tokenOut,
            amount: swapIntent.amount,
          });
          
          // Get swap quote for display
          const { getSwapQuote } = await import('@/lib/services/web3/swaps');
          let estimatedOutput = '0';
          try {
            const quote = await getSwapQuote(
              swapIntent.tokenIn,
              swapIntent.tokenOut || 'native',
              swapIntent.amount,
              network,
              slippageBps
            );
            // Get token decimals for formatting
            const tokenOutInfo = swapIntent.tokenOut 
              ? await getTokenInfo(swapIntent.tokenOut, network)
              : { decimals: 18 };
            estimatedOutput = formatUnits(quote.amountOut, tokenOutInfo.decimals);
          } catch (e) {
            logger.warn('Failed to get swap quote for preview', { error: e instanceof Error ? e.message : String(e) });
          }
          
          // Store the pending swap intent for follow-up
          const pendingSwapIntent = {
            ...swapIntent,
            _pendingApproval: true,
            _pendingSwapId: pendingSwapId,
          };
          
          const content = `Before swapping ${swapIntent.amount} ${tokenInSymbol} for ${tokenOutSymbol}, you need to approve the PancakeSwap router to spend your tokens.\n\n` +
            `**Step 1 of 2**: Approve ${tokenInSymbol} spending\n` +
            `Router: ${approvalCheck.routerAddress.slice(0, 10)}...${approvalCheck.routerAddress.slice(-8)}\n\n` +
            `⚠️ **Note**: You will need to pay gas for both the approval and swap transactions.\n\n` +
            `After approval, the swap will proceed automatically.\n\n` +
            `📊 **Estimated swap**: ~${estimatedOutput} ${tokenOutSymbol}`;
          
          return {
            message: {
              id: generateId(),
              sessionId,
              role: 'assistant',
              content,
              intent: pendingSwapIntent,
              createdAt: new Date().toISOString(),
            },
            intent: pendingSwapIntent,
            requiresFollowUp: false,
            transactionPreview: approvalPreview,
            policyDecision: approvalPolicyDecision,
            swapApprovalRequired: {
              tokenInAddress: swapIntent.tokenIn,
              tokenInSymbol,
              tokenOutAddress: swapIntent.tokenOut || null,
              tokenOutSymbol,
              routerAddress: approvalCheck.routerAddress,
              amount: swapIntent.amount,
              currentAllowance: approvalCheck.currentAllowance.toString(),
              requiredAmount: approvalCheck.requiredAmount.toString(),
              pendingSwapId,
              isDirectTransaction: true, // User must pay gas for approval
              slippageBps,
              estimatedOutput,
            },
          };
        }
      }

      // No approval needed (native BNB input or already approved)
      // Build the swap transaction
      // NOTE: Swaps must be executed directly by the user (not via facilitator)
      // because DEX routers pull tokens from msg.sender, which would be the facilitator
      const swapResult = await buildSwap(
        walletAddress,
        swapIntent.tokenIn || null,
        swapIntent.tokenOut || null,
        swapIntent.amount,
        network,
        slippageBps
      );

      // Get formatted output amount
      const tokenOutInfo = swapIntent.tokenOut 
        ? await getTokenInfo(swapIntent.tokenOut, network)
        : { decimals: 18, symbol: 'BNB' };
      const formattedOutput = formatUnits(swapResult.quote.amountOut, tokenOutInfo.decimals);

      const preview = await createTransactionPreview(
        'swap',
        swapResult.preparedTx,
        {
          from: walletAddress,
          network,
          amount: swapIntent.amount,
          tokenInSymbol,
          tokenOutSymbol,
          tokenOutAmount: formattedOutput,
          slippageBps,
        }
      );

      const policy = getDefaultPolicy(sessionId);
      const policyEngine = createPolicyEngine(policy, network);
      const policyDecision = await policyEngine.evaluate(
        'swap',
        { slippageBps },
        0,
        walletAddress
      );

      // Note: Swaps require direct execution because DEX routers pull tokens from msg.sender
      const content = `Ready to swap ${swapIntent.amount} ${tokenInSymbol} for approximately ${formattedOutput} ${tokenOutSymbol}.\n\n` +
        `⚠️ **Note**: You will need to pay gas for this swap transaction.\n\n` +
        `📊 **Slippage tolerance**: ${slippageBps / 100}%`;

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
        // Flag to indicate this must be executed directly, not via facilitator
        isDirectTransaction: true,
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

