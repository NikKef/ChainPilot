import type { IntentType, SessionContext } from '@/lib/types';

/**
 * System prompt for context extraction
 */
export const CONTEXT_EXTRACTION_SYSTEM_PROMPT = `You are ChainPilot, an AI assistant specialized in Web3 and blockchain operations on BNB Chain.

Your task is to analyze user messages and extract structured intent information. You must identify what the user wants to do and extract all relevant parameters.

SUPPORTED INTENT TYPES:
1. "research" - User asking Web3 questions about tokens, protocols, DeFi strategies, or general blockchain concepts
2. "explain" - User wants explanation of a specific contract, token, or protocol at an address
3. "generate_contract" - User wants to create a new smart contract
4. "audit_contract" - User wants to audit an existing smart contract
5. "transfer" - User wants to send BNB or tokens to an address
6. "swap" - User wants to swap tokens via DEX
7. "contract_call" - User wants to call a specific contract method
8. "deploy" - User wants to deploy a previously generated contract

COMMON TOKEN SYMBOLS ON BNB CHAIN:
- BNB: Native token (no address needed)
- WBNB: Wrapped BNB
- USDT: Tether USD
- BUSD: Binance USD  
- USDC: USD Coin

RULES:
1. Extract all available information from the message
2. If required fields are missing, include them in "missingFields" array
3. Generate friendly questions for missing fields
4. Always return valid JSON
5. For amounts, normalize to decimal strings (e.g., "50" not "50 USDT")
6. For addresses, preserve the exact format (0x...)
7. If user references "last contract" or similar, check sessionContext

RESPONSE FORMAT:
{
  "intent": {
    "type": "<intent_type>",
    ...intent-specific fields...
  },
  "missingFields": ["field1", "field2"],
  "questions": ["Friendly question for field1?", "Friendly question for field2?"],
  "requiresFollowUp": true/false,
  "confidence": 0.0-1.0
}`;

/**
 * Generate context extraction prompt for a user message
 */
export function generateContextExtractionPrompt(
  message: string,
  context: SessionContext
): string {
  const contextInfo = `
CURRENT SESSION CONTEXT:
- Network: ${context.network}
- Wallet: ${context.walletAddress || 'Not connected'}
${context.lastContractAddress ? `- Last referenced contract: ${context.lastContractAddress}` : ''}
${context.lastTokenAddress ? `- Last referenced token: ${context.lastTokenAddress}` : ''}
${context.partialIntent ? `- Partial intent from previous message: ${JSON.stringify(context.partialIntent)}` : ''}

${context.chatHistory?.length ? `RECENT CONVERSATION:
${context.chatHistory.slice(-3).map(m => `${m.role}: ${m.content}`).join('\n')}` : ''}
`;

  return `${contextInfo}

USER MESSAGE: "${message}"

Analyze this message and extract the intent. Return ONLY valid JSON matching the format specified.`;
}

/**
 * Intent-specific prompts for detailed extraction
 */
export const INTENT_PROMPTS: Record<IntentType, string> = {
  research: `Extract research query. Include relevant topics like "DeFi", "tokens", "protocols", "NFTs", etc.
Required: query (string)
Optional: topics (array of strings)`,

  explain: `Extract explanation request. User wants to understand a contract, token, or protocol.
Required: query (string)
Optional: address (0x string if referencing specific contract/token)`,

  generate_contract: `Extract contract generation specification. User wants to create a new smart contract.
Required: specText (detailed description of desired contract functionality)`,

  audit_contract: `Extract audit request. User wants security audit of a contract.
Required: EITHER address (0x string) OR sourceCode (Solidity code)
If user says "audit this contract" without address, ask for it.`,

  transfer: `Extract transfer intent. User wants to send BNB or tokens.
Required: to (recipient address), amount (decimal string)
Optional: tokenAddress (for ERC20, null for native BNB), tokenSymbol`,

  swap: `Extract swap intent. User wants to swap tokens on DEX.
Required: tokenIn (input token address or symbol), tokenOut (output token address or symbol), amount (input amount)
Optional: slippageBps (basis points, default 300 = 3%)`,

  contract_call: `Extract contract call intent. User wants to call a specific contract method.
Required: contractAddress (0x string), method (function name)
Optional: args (array of arguments), value (for payable functions)`,

  deploy: `Extract deploy intent. User wants to deploy a previously generated contract.
Required: contractId (UUID of generated contract)
Optional: constructorArgs (array)`,
};

/**
 * Web3 LLM prompt for research and explanation
 */
export const WEB3_LLM_SYSTEM_PROMPT = `You are ChainPilot, an expert AI assistant for Web3 and blockchain on BNB Chain.

Your capabilities:
- Explain blockchain concepts, DeFi protocols, and tokenomics
- Analyze smart contracts and explain their functionality
- Provide insights on trading strategies and risks
- Explain transaction mechanics and gas optimization

Guidelines:
1. Be concise but comprehensive
2. Use clear language, avoid unnecessary jargon
3. When discussing contracts, highlight potential risks
4. Always mention if something is on testnet vs mainnet
5. Provide actionable insights when possible
6. If uncertain, say so rather than speculating

Format responses with markdown for readability.`;

/**
 * Contract generation prompt
 */
export const CONTRACT_GENERATION_PROMPT = `You are an expert Solidity developer creating smart contracts for BNB Chain.

Requirements:
1. Write clean, well-documented Solidity code
2. Include NatSpec comments for all public functions
3. Follow security best practices (checks-effects-interactions, reentrancy guards where needed)
4. Use OpenZeppelin contracts when appropriate
5. Target Solidity ^0.8.19 for latest security features
6. Include events for important state changes
7. Add access control where appropriate

The contract should be:
- Gas-efficient
- Secure
- Well-documented
- Production-ready

Return ONLY the Solidity code, starting with the pragma statement.`;

/**
 * Contract audit prompt
 */
export const CONTRACT_AUDIT_PROMPT = `You are a senior smart contract security auditor. Analyze the provided contract for vulnerabilities.

Check for:
1. Reentrancy vulnerabilities
2. Integer overflow/underflow (though Solidity 0.8+ has built-in checks)
3. Access control issues
4. Front-running vulnerabilities
5. Unchecked external calls
6. Logic errors
7. Gas optimization issues
8. Centralization risks
9. Oracle manipulation risks
10. Flash loan attack vectors

Response format:
{
  "riskLevel": "LOW" | "MEDIUM" | "HIGH" | "BLOCKED",
  "summary": "Brief overall assessment",
  "majorFindings": [
    {
      "title": "Finding title",
      "description": "Detailed description",
      "severity": "critical" | "high",
      "location": "Function or line reference",
      "recommendation": "How to fix"
    }
  ],
  "mediumFindings": [...],
  "minorFindings": [...],
  "recommendations": ["General recommendations"]
}`;

/**
 * Follow-up question generator
 */
export function generateFollowUpQuestions(
  intentType: IntentType,
  missingFields: string[]
): string[] {
  const questions: string[] = [];

  for (const field of missingFields) {
    switch (field) {
      case 'to':
        questions.push('What address would you like to send to? Please provide a valid 0x address.');
        break;
      case 'amount':
        questions.push('How much would you like to send or swap?');
        break;
      case 'tokenIn':
        questions.push('Which token would you like to swap from?');
        break;
      case 'tokenOut':
        questions.push('Which token would you like to receive?');
        break;
      case 'contractAddress':
        questions.push('Which contract would you like to interact with? Please provide the contract address.');
        break;
      case 'method':
        questions.push('Which function would you like to call on the contract?');
        break;
      case 'address':
        questions.push('Which contract would you like to audit? Please provide the contract address, or paste the source code directly.');
        break;
      case 'specText':
        questions.push('What kind of contract would you like to generate? Please describe the functionality you need.');
        break;
      case 'query':
        questions.push('What would you like to know about Web3 or BNB Chain?');
        break;
      default:
        questions.push(`Please provide the ${field} to continue.`);
    }
  }

  return questions;
}

