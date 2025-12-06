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
  type BatchIntent,
  type BatchOperation,
  type TransactionPreview,
  type ChatMessage,
} from '@/lib/types';
import { formatErrorResponse, getErrorStatusCode, ValidationError } from '@/lib/utils/errors';
import { validateChatMessage, isValidNetwork } from '@/lib/utils/validation';
import { logger } from '@/lib/utils';
import { type NetworkType, Q402_FACILITATOR, Q402_CONTRACTS } from '@/lib/utils/constants';
import { storePendingTransfer, storePendingSwap, createQ402Client } from '@/lib/services/q402';
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

      // No approval needed for PancakeSwap router (native BNB input or already approved)
      // Check if BatchExecutor is deployed for gas-sponsored swaps
      const batchExecutorAddress = Q402_CONTRACTS[network].batchExecutor;
      const useBatchExecutor = !!batchExecutorAddress && batchExecutorAddress.length > 2;

      // Check for batch recipient from follow-up context (e.g., "swap X for Y and send to Z")
      const batchRecipient = (swapIntent as SwapIntent & { _batchRecipient?: string })._batchRecipient;
      const isNativeOut = !swapIntent.tokenOut || swapIntent.tokenOutSymbol?.toUpperCase() === 'BNB';
      
      // LIMITATION: BatchExecutor contract checks owner's balance before/after swaps
      // Custom recipients don't work because output goes to recipient, not owner
      // For now, disable custom recipient for ALL BatchExecutor swaps
      // User will receive tokens and can transfer manually
      const effectiveSwapRecipient = undefined; // Disabled for BatchExecutor compatibility

      // Build the swap transaction (output goes to user)
      const swapResult = await buildSwap(
        walletAddress,
        swapIntent.tokenIn || null,
        swapIntent.tokenOut || null,
        swapIntent.amount,
        network,
        slippageBps
        // No recipient - always send to user for BatchExecutor compatibility
      );

      // Get formatted output amount
      const tokenOutInfo = swapIntent.tokenOut 
        ? await getTokenInfo(swapIntent.tokenOut, network)
        : { decimals: 18, symbol: 'BNB' };
      const formattedOutput = formatUnits(swapResult.quote.amountOut, tokenOutInfo.decimals);

      // If BatchExecutor is available and it's a token swap, check BatchExecutor approval
      if (useBatchExecutor && !isNativeIn && swapIntent.tokenIn) {
        const q402Client = createQ402Client(network);
        const batchApprovalCheck = await q402Client.checkBatchApprovalNeeded(
          swapIntent.tokenIn,
          walletAddress,
          swapResult.quote.amountIn
        );

        if (batchApprovalCheck.needsApproval) {
          // Need to approve BatchExecutor first
          logger.info('BatchExecutor approval needed for gas-sponsored swap', {
            tokenIn: swapIntent.tokenIn,
            walletAddress,
            requiredAmount: batchApprovalCheck.requiredAmount.toString(),
            currentAllowance: batchApprovalCheck.currentAllowance.toString(),
            batchExecutorAddress: batchApprovalCheck.batchExecutorAddress,
          });

          // Build approval for BatchExecutor (one-time, user pays gas)
          const { buildBatchExecutorApproval } = await import('@/lib/services/web3/transactions');
          const approvalTx = await buildBatchExecutorApproval(
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
          
          const policy = getDefaultPolicy(sessionId);
          const policyEngine = createPolicyEngine(policy, network);
          const approvalPolicyDecision = await policyEngine.evaluate(
            'contract_call',
            { targetAddress: swapIntent.tokenIn },
            0,
            walletAddress
          );
          
          // Store pending swap for auto-follow-up after approval
          const pendingSwapId = `pending_batch_swap_${sessionId}_${Date.now()}`;
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
          
          const pendingSwapIntent = {
            ...swapIntent,
            _pendingApproval: true,
            _pendingSwapId: pendingSwapId,
            _useBatchExecutor: true,
          };
          
          const content = `Before swapping ${swapIntent.amount} ${tokenInSymbol} for ${tokenOutSymbol}, you need to approve the ChainPilot BatchExecutor (one-time setup).\n\n` +
            `**One-time approval**: Approve ${tokenInSymbol} spending\n` +
            `BatchExecutor: ${batchApprovalCheck.batchExecutorAddress.slice(0, 10)}...${batchApprovalCheck.batchExecutorAddress.slice(-8)}\n\n` +
            `⚠️ **Note**: You pay gas for this one-time approval. After that, all swaps for ${tokenInSymbol} will be **gas-free**!\n\n` +
            `📊 **Estimated swap**: ~${formattedOutput} ${tokenOutSymbol}`;
          
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
              routerAddress: batchApprovalCheck.batchExecutorAddress, // Using BatchExecutor address
              amount: swapIntent.amount,
              currentAllowance: batchApprovalCheck.currentAllowance.toString(),
              requiredAmount: batchApprovalCheck.requiredAmount.toString(),
              pendingSwapId,
              isDirectTransaction: true, // User pays gas for approval
              slippageBps,
              estimatedOutput: formattedOutput,
              useBatchExecutor: true,
            },
          };
        }

        // BatchExecutor is approved - prepare gas-sponsored batch swap
        logger.info('Preparing gas-sponsored batch swap', {
          tokenIn: swapIntent.tokenIn,
          tokenOut: swapIntent.tokenOut,
          amount: swapIntent.amount,
        });

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

        // Gas-sponsored swap via BatchExecutor!
        // Note: Custom recipients are not supported due to BatchExecutor contract limitations
        const pendingTransferNote = batchRecipient 
          ? `\n\n📤 **Note:** After the swap, you'll need to manually transfer the ${tokenOutSymbol} to ${batchRecipient.slice(0, 10)}...${batchRecipient.slice(-8)}`
          : '';
        
        const content = `Ready to swap ${swapIntent.amount} ${tokenInSymbol} for approximately ${formattedOutput} ${tokenOutSymbol}.\n\n` +
          `✨ **Gas-free!** The swap will be executed via ChainPilot BatchExecutor.\n\n` +
          `📊 **Slippage tolerance**: ${slippageBps / 100}%${pendingTransferNote}`;

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
          // Use batch execution - NOT direct transaction
          isBatchSwap: true,
          batchSwapDetails: {
            tokenIn: swapIntent.tokenIn || null,
            tokenInSymbol,
            tokenOut: swapIntent.tokenOut || null,
            tokenOutSymbol,
            amountIn: swapIntent.amount,
            minAmountOut: swapResult.quote.amountOutMin,
            estimatedAmountOut: formattedOutput,
            slippageBps,
            swapData: swapResult.preparedTx.data,
            // No swapRecipient - BatchExecutor requires output to go to owner
          },
        };
      }

      // Fallback: No BatchExecutor or native BNB swap - use direct execution
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

      // Note: Native BNB swaps still require direct execution
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

    case 'batch': {
      const batchIntent = intent as BatchIntent;
      
      if (!batchIntent.operations || batchIntent.operations.length === 0) {
        return {
          message: {
            id: generateId(),
            sessionId,
            role: 'assistant',
            content: 'I detected a batch request but couldn\'t parse the operations. Please try again with clearer instructions.',
            intent,
            createdAt: new Date().toISOString(),
          },
          intent,
          requiresFollowUp: true,
        };
      }

      // Process batch operations
      // Keep operations separate - BatchExecutor will execute them atomically
      // For transfers that use previous swap output, link them properly
      const processedOperations: BatchOperation[] = [];
      
      for (let i = 0; i < batchIntent.operations.length; i++) {
        const op = batchIntent.operations[i];
        const prevOp = i > 0 ? processedOperations[processedOperations.length - 1] : undefined;
        
        // Check if this transfer uses the previous swap's output
        if (op.type === 'transfer' && op._usesPreviousOutput && prevOp?.type === 'swap') {
          // DON'T merge - keep as separate operation in batch
          // Link the transfer to the swap's output token
          op.tokenSymbol = prevOp.tokenOutSymbol;
          op.tokenAddress = prevOp.tokenOut;
          // Mark as using swap output (amount will be determined at execution)
          op._linkedToSwapOutput = true;
          logger.info('Linked transfer to swap output', {
            transferRecipient: op.recipient,
            tokenOut: prevOp.tokenOutSymbol,
            willExecuteAsBatch: true,
          });
        }
        
        processedOperations.push(op);
      }

      // If we only have one operation after merging, handle it as a single intent
      if (processedOperations.length === 1) {
        const singleOp = processedOperations[0];
        
        if (singleOp.type === 'swap') {
          // Handle as a swap with custom recipient
          const swapIntent: SwapIntent = {
            type: 'swap',
            network,
            tokenIn: singleOp.tokenIn || undefined,
            tokenInSymbol: singleOp.tokenInSymbol,
            tokenOut: singleOp.tokenOut || undefined,
            tokenOutSymbol: singleOp.tokenOutSymbol,
            amount: singleOp.amount,
            slippageBps: singleOp.slippageBps || 300,
          };
          
          // Build swap with custom recipient if specified
          const slippageBps = singleOp.slippageBps || 300;
          
          // Check if this is a native BNB output swap
          // IMPORTANT: Only treat as native if explicitly BNB symbol, not just missing tokenOut address
          const tokenOutUpperCase = singleOp.tokenOutSymbol?.toUpperCase();
          const isExplicitlyNativeBNB = tokenOutUpperCase === 'BNB' || tokenOutUpperCase === 'TBNB';
          const isNativeOut = isExplicitlyNativeBNB;
          const hasCustomRecipient = !!singleOp.swapRecipient;
          
          // If tokenOut is missing but symbol is NOT BNB (e.g., "ETH"), we need to ask for the address
          if (!singleOp.tokenOut && !isExplicitlyNativeBNB && singleOp.tokenOutSymbol) {
            const recipientNote = singleOp.swapRecipient 
              ? `\n\n📤 After swap, output will be sent to: ${singleOp.swapRecipient.slice(0, 10)}...${singleOp.swapRecipient.slice(-8)}`
              : '';
            
            const content = `${singleOp.tokenOutSymbol} is available on mainnet but not on testnet. If you have a testnet version of this token, please provide its contract address.\n\n` +
              `**Intent**: swap ${singleOp.tokenInSymbol || 'Token'} for ${singleOp.tokenOutSymbol}${recipientNote}`;
            
            // Build a proper partial swap intent that will be stored in the message
            // This is essential for follow-up processing to work correctly
            // Include swapRecipient as a custom extension field to preserve batch context
            const partialSwapIntent = {
              type: 'swap' as const,
              network,
              tokenIn: singleOp.tokenIn,
              tokenInSymbol: singleOp.tokenInSymbol,
              tokenOut: undefined, // Missing - needs follow-up
              tokenOutSymbol: singleOp.tokenOutSymbol,
              amount: singleOp.amount || '0',
              slippageBps: singleOp.slippageBps || 300,
              // Custom extension: preserve batch recipient for follow-up
              _batchRecipient: singleOp.swapRecipient,
            };
            
            return {
              message: {
                id: generateId(),
                sessionId,
                role: 'assistant',
                content,
                intent: partialSwapIntent, // Store full partial intent with batch context
                createdAt: new Date().toISOString(),
              },
              intent: partialSwapIntent,
              requiresFollowUp: true,
              partialIntent: partialSwapIntent,
            };
          }
          
          // LIMITATION: BatchExecutor contract checks owner's balance before/after swaps
          // Custom recipients don't work because output goes to recipient, not owner
          // For ALL swaps via BatchExecutor, output goes to user first
          // If there was a custom recipient, user will need to transfer manually
          const effectiveRecipient = undefined; // Disabled for BatchExecutor compatibility
          const pendingRecipient = singleOp.swapRecipient; // Remember for user message
          
          const swapResult = await buildSwap(
            walletAddress,
            singleOp.tokenIn || null,
            singleOp.tokenOut || null,
            singleOp.amount || '0',
            network,
            slippageBps,
            effectiveRecipient // Only pass recipient for token output swaps
          );

          const tokenOutInfo = singleOp.tokenOut 
            ? await getTokenInfo(singleOp.tokenOut, network)
            : { decimals: 18, symbol: 'BNB' };
          const formattedOutput = formatUnits(swapResult.quote.amountOut, tokenOutInfo.decimals);

          const preview = await createTransactionPreview(
            'swap',
            swapResult.preparedTx,
            {
              from: walletAddress,
              network,
              amount: singleOp.amount,
              tokenInSymbol: singleOp.tokenInSymbol,
              tokenOutSymbol: singleOp.tokenOutSymbol,
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

          // Check BatchExecutor availability for gas-sponsored execution
          const batchExecutorAddress = Q402_CONTRACTS[network].batchExecutor;
          const useBatchExecutor = !!batchExecutorAddress && batchExecutorAddress.length > 2;
          const isNativeIn = !singleOp.tokenIn || singleOp.tokenInSymbol?.toUpperCase() === 'BNB';

          // If there's a custom recipient, inform the user they'll need to transfer manually
          if (hasCustomRecipient) {
            const content = `I'll help you swap ${singleOp.amount} ${singleOp.tokenInSymbol} for approximately ${formattedOutput} ${singleOp.tokenOutSymbol}.\n\n` +
              `⚠️ **Note**: Due to smart contract limitations, this requires **two steps**:\n` +
              `1. First, I'll swap your ${singleOp.tokenInSymbol} for ${singleOp.tokenOutSymbol} (you'll receive it)\n` +
              `2. Then, you can send the ${singleOp.tokenOutSymbol} to ${pendingRecipient?.slice(0, 10)}...${pendingRecipient?.slice(-8)}\n\n` +
              `✨ **Step 1 is gas-free** via BatchExecutor!\n\n` +
              `📊 **Slippage tolerance**: ${slippageBps / 100}%\n\n` +
              `Ready to proceed with the swap?`;

            // For now, just do the swap to user
            if (useBatchExecutor && !isNativeIn && singleOp.tokenIn) {
              return {
                message: {
                  id: generateId(),
                  sessionId,
                  role: 'assistant',
                  content,
                  intent: swapIntent,
                  createdAt: new Date().toISOString(),
                },
                intent: swapIntent,
                requiresFollowUp: false,
                transactionPreview: preview,
                policyDecision,
                isBatchSwap: true,
                batchSwapDetails: {
                  tokenIn: singleOp.tokenIn || null,
                  tokenInSymbol: singleOp.tokenInSymbol || 'Token',
                  tokenOut: singleOp.tokenOut || null,
                  tokenOutSymbol: singleOp.tokenOutSymbol || 'Token',
                  amountIn: singleOp.amount || '0',
                  minAmountOut: swapResult.quote.amountOutMin,
                  estimatedAmountOut: formattedOutput,
                  slippageBps,
                  swapData: swapResult.preparedTx.data,
                  // No swapRecipient - output goes to user first
                },
              };
            }
            
            // Direct execution fallback
            return {
              message: {
                id: generateId(),
                sessionId,
                role: 'assistant',
                content,
                intent: swapIntent,
                createdAt: new Date().toISOString(),
              },
              intent: swapIntent,
              requiresFollowUp: false,
              transactionPreview: preview,
              policyDecision,
              isDirectTransaction: true,
            };
          }

          const pendingTransferNote = pendingRecipient 
            ? `\n\n📤 **Note:** After the swap, transfer ${singleOp.tokenOutSymbol} to ${pendingRecipient.slice(0, 10)}...${pendingRecipient.slice(-8)}`
            : '';

          if (useBatchExecutor && !isNativeIn && singleOp.tokenIn) {
            // Gas-sponsored swap
            const content = `Ready to swap ${singleOp.amount} ${singleOp.tokenInSymbol} for approximately ${formattedOutput} ${singleOp.tokenOutSymbol}.\n\n` +
              `✨ **Gas-free!** The swap will be executed via ChainPilot BatchExecutor.\n\n` +
              `📊 **Slippage tolerance**: ${slippageBps / 100}%${pendingTransferNote}`;

            return {
              message: {
                id: generateId(),
                sessionId,
                role: 'assistant',
                content,
                intent: swapIntent,
                createdAt: new Date().toISOString(),
              },
              intent: swapIntent,
              requiresFollowUp: false,
              transactionPreview: preview,
              policyDecision,
              isBatchSwap: true,
              batchSwapDetails: {
                tokenIn: singleOp.tokenIn || null,
                tokenInSymbol: singleOp.tokenInSymbol || 'Token',
                tokenOut: singleOp.tokenOut || null,
                tokenOutSymbol: singleOp.tokenOutSymbol || 'Token',
                amountIn: singleOp.amount || '0',
                minAmountOut: swapResult.quote.amountOutMin,
                estimatedAmountOut: formattedOutput,
                slippageBps,
                swapData: swapResult.preparedTx.data,
                // No swapRecipient - BatchExecutor requires output to go to owner
              },
            };
          }

          // Fallback: direct execution
          const content = `Ready to swap ${singleOp.amount} ${singleOp.tokenInSymbol} for approximately ${formattedOutput} ${singleOp.tokenOutSymbol}.${recipientDisplay}\n\n` +
            `⚠️ **Note**: You will need to pay gas for this swap transaction.\n\n` +
            `📊 **Slippage tolerance**: ${slippageBps / 100}%`;

          return {
            message: {
              id: generateId(),
              sessionId,
              role: 'assistant',
              content,
              intent: swapIntent,
              createdAt: new Date().toISOString(),
            },
            intent: swapIntent,
            requiresFollowUp: false,
            transactionPreview: preview,
            policyDecision,
            isDirectTransaction: true,
          };
        }
      }

      // Handle multiple operations (true batch) - e.g., swap + transfer
      // Check if any operation has unresolved tokens
      for (const op of processedOperations) {
        if (op.type === 'swap') {
          const tokenOutUpperCase = op.tokenOutSymbol?.toUpperCase();
          const isExplicitlyNativeBNB = tokenOutUpperCase === 'BNB' || tokenOutUpperCase === 'TBNB';
          if (!op.tokenOut && !isExplicitlyNativeBNB && op.tokenOutSymbol) {
            // Need token address for swap output
            const content = `${op.tokenOutSymbol} is available on mainnet but not on testnet. Please provide its contract address to continue.\n\n` +
              `**Intent**: ${processedOperations.map(o => o.type).join(' → ')}`;
            
            // Store full batch context for follow-up
            return {
              message: {
                id: generateId(),
                sessionId,
                role: 'assistant',
                content,
                intent: {
                  type: 'batch' as const,
                  network,
                  operations: processedOperations,
                  _unresolvedTokenIndex: processedOperations.indexOf(op),
                },
                createdAt: new Date().toISOString(),
              },
              intent: {
                type: 'batch',
                network,
                operations: processedOperations,
              },
              requiresFollowUp: true,
              partialIntent: {
                type: 'batch',
                operations: processedOperations,
                _unresolvedTokenIndex: processedOperations.indexOf(op),
              },
            };
          }
        }
      }

      // Build operation descriptions and prepare batch
      const opDescriptions: string[] = [];
      const batchOps: Array<{
        type: 'transfer' | 'swap';
        tokenIn?: string | null;
        tokenInSymbol?: string;
        tokenOut?: string | null;
        tokenOutSymbol?: string;
        amount?: string;
        slippageBps?: number;
        tokenAddress?: string | null;
        tokenSymbol?: string;
        recipient?: string;
        _linkedToSwapOutput?: boolean;
      }> = [];
      
      let estimatedSwapOutput = '0';
      let swapOutputToken: { address: string | null; symbol: string; decimals: number } | null = null;

      for (let i = 0; i < processedOperations.length; i++) {
        const op = processedOperations[i];
        
        if (op.type === 'swap') {
          const slippageBps = op.slippageBps || 300;
          const { getSwapQuote } = await import('@/lib/services/web3/swaps');
          
          const quote = await getSwapQuote(
            op.tokenIn || 'native',
            op.tokenOut || 'native',
            op.amount || '0',
            network,
            slippageBps
          );
          
          const tokenOutInfo = op.tokenOut 
            ? await getTokenInfo(op.tokenOut, network)
            : { decimals: 18, symbol: 'BNB' };
          
          estimatedSwapOutput = formatUnits(quote.amountOut, tokenOutInfo.decimals);
          swapOutputToken = { address: op.tokenOut || null, symbol: op.tokenOutSymbol || tokenOutInfo.symbol, decimals: tokenOutInfo.decimals };
          
          opDescriptions.push(`**${i + 1}. Swap** ${op.amount} ${op.tokenInSymbol} → ~${estimatedSwapOutput} ${op.tokenOutSymbol}`);
          
          batchOps.push({
            type: 'swap',
            tokenIn: op.tokenIn,
            tokenInSymbol: op.tokenInSymbol,
            tokenOut: op.tokenOut,
            tokenOutSymbol: op.tokenOutSymbol,
            amount: op.amount,
            slippageBps,
          });
        } else if (op.type === 'transfer') {
          const isLinkedToSwap = op._linkedToSwapOutput;
          const transferAmount = isLinkedToSwap ? estimatedSwapOutput : op.amount;
          const transferSymbol = isLinkedToSwap && swapOutputToken ? swapOutputToken.symbol : op.tokenSymbol;
          const transferToken = isLinkedToSwap && swapOutputToken ? swapOutputToken.address : op.tokenAddress;
          
          opDescriptions.push(`**${i + 1}. Transfer** ${isLinkedToSwap ? '~' : ''}${transferAmount} ${transferSymbol} → ${op.recipient?.slice(0, 10)}...${op.recipient?.slice(-8)}`);
          
          batchOps.push({
            type: 'transfer',
            tokenAddress: transferToken,
            tokenSymbol: transferSymbol,
            recipient: op.recipient,
            amount: transferAmount,
            _linkedToSwapOutput: isLinkedToSwap,
          });
        }
      }

      // Check BatchExecutor availability
      const batchExecutorAddress = Q402_CONTRACTS[network].batchExecutor;
      const useBatchExecutor = !!batchExecutorAddress && batchExecutorAddress.length > 2;

      const content = `Ready to execute **${processedOperations.length} operations** in a single transaction:\n\n` +
        opDescriptions.join('\n') + '\n\n' +
        (useBatchExecutor 
          ? `✨ **Gas-free!** All operations will be executed via ChainPilot BatchExecutor in one atomic transaction.`
          : `⚠️ Note: You will need to pay gas for this batch transaction.`) +
        '\n\n📝 Sign once to execute all operations.';

      const policy = getDefaultPolicy(sessionId);
      const policyEngine = createPolicyEngine(policy, network);
      const policyDecision = await policyEngine.evaluate(
        'batch',
        { operationCount: processedOperations.length },
        0,
        walletAddress
      );

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
        policyDecision,
        // Multi-operation batch
        isMultiOpBatch: true,
        multiOpBatchDetails: {
          operations: batchOps,
          operationCount: batchOps.length,
          estimatedSwapOutput,
          swapOutputToken,
        },
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

