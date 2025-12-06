# ChainPilot - AI-Powered Web3 Copilot for BNB Chain

ChainPilot is a chat-based Web3 copilot that enables users to interact with the BNB Chain & BNB Chain Testnet through natural language. Research protocols, generate smart contracts, audit code, and execute on-chain actions — all through conversation.

<p align="center">
  <img src="assets/ChainPilotLogo-min.png" width="350">
</p>

## Overview

**Target User:**
 - DeFi enthusiasts who want to manage their on-chain activities more efficiently using AI assistance
 - New DeFi users who do not have experience using dApps
 - Founders looking to easily deploy their own tokens with no need to code smart contracts themselves
 - DAOs and Treasury Managers looking to manage their funds in a safe democratic way while enforcing a specific policy.

**Key Features:**
- Natural language chat interface for Web3 interactions
- Smart contract generation from plain English descriptions
- Automated security auditing of smart contracts
- Token swaps via PancakeSwap integration
- Native and BEP20 token transfers
- Policy-based transaction protection (spend caps, allow/deny lists)
- One-click execution via Q402 sign-to-pay (where possible)

## Tech Stack Architecture

- **Frontend:** Next.js 14 (App Router), React, TypeScript, Tailwind CSS, Shadcn UI, Framer Motion
- **Backend:** Next.js API Routes, Supabase (PostgreSQL)
- **Database:** Supabase (PostgreSQL)
- **AI:** ChainGPT API (Web3 LLM, Contract Generator, Auditor)
- **Blockchain:** Ethers.js v6, BNB Chain (testnet/mainnet), Hardhat
- **DEX:** PancakeSwap V2/V3 Router
- **Execution/Facilitator:** Q402 sign-to-pay protocol with Custom Smart Contracts


## ⚙️ Key Integrations

### ChainGPT Integration
1. **Web3 LLM**
 - Natural language understanding and context extraction for intent parsing.
 - Used in `src/lib/services/chaingpt/web3-llm.ts` to process natural language, understand DeFi intent, and explain concepts to the user.
2. **Smart Contract Generator** 
 - Generate Solidity contracts from natural language specifications
 - Integrated in `src/lib/services/chaingpt/generator.ts`
3. **Smart Contract Auditor**
 - Automated security analysis with risk scoring
 - Integrated in `src/lib/services/chaingpt/auditor.ts` to analyze contracts for vulnerabilities (reentrancy, overflow, etc.) before the user interacts with them.

### Quack Q402 Integration
We use Quack's infrastructure to handle the "Action" layer securely:
- **Sign-to-pay execution** - Gasless transaction execution with signature-based approval
- **Transaction batching** - Execute multiple operations atomically
- **Policy Engine**: The agent checks transactions against `src/lib/services/policy` (Spend Caps, Allow/Deny Lists) before they are sent to the user for signature.
- **Gas Sponsorship**: Transactions are routed through the Quack execution layer, abstracting gas complexities.

## Project Structure

```
src/
├── app/                   # Next.js App Router
│   ├── api/               # API Routes
│   │   ├── chat/          # Chat endpoint
│   │   ├── contracts/     # Contract generation/audit
│   │   ├── transactions/  # Transaction prepare/execute
│   │   ├── portfolio/     # Wallet balances
│   │   ├── policies/      # Policy management
│   │   ├── activity/      # Activity logs
│   │   └── sessions/      # Session management
│   ├── chat/              # Chat page
│   ├── portfolio/         # Portfolio page
│   ├── activity/          # Activity page
│   ├── settings/          # Settings page
│   └── page.tsx           # Landing page
├── components/
│   ├── ui/                # Reusable UI components
│   ├── layout/            # Header, Sidebar, Navigation
│   ├── chat/              # Chat interface components
│   ├── contracts/         # Contract viewer, audit results
│   ├── transactions/      # Transaction preview, risk panel
│   └── settings/          # Policy editor, allow/deny lists
├── hooks/                  # React hooks
├── lib/
│   ├── services/
│   │   ├── chaingpt/      # ChainGPT SDK wrappers
│   │   ├── web3/          # ethers.js providers and builders
│   │   ├── q402/          # Q402 sign-to-pay client
│   │   ├── policy/        # Policy evaluation engine
│   │   └── intent-parser/ # Natural language intent extraction
│   ├── types/             # TypeScript type definitions
│   ├── utils/             # Utility functions
│   └── supabase/          # Database client
└── supabase/
    └── migrations/        # Database schema
```

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm/npm/yarn
- ChainGPT API key
- Supabase project
- BNB testnet wallet with test BNB

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/chainpilot.git
cd chainpilot
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp env.example .env.local
```

Edit `.env.local` with your credentials.

4. Set up the database:
   - Go to your Supabase project
   - Run the migration sin `supabase/migrations/`

5. Deploy Contracts (BNB Testnet)
Deploy the Quack Vault and Executors:
```bash
npx hardhat run scripts/deploy-q402.js --network bscTestnet
```
*Make sure to update src/lib/utils/constants.ts with the new contract addresses if they change.*


6. Start the development server:
```bash
npm run dev
```

7. Open [http://localhost:3000](http://localhost:3000)

## How to Demo
1. Connect Wallet: Click "Connect Wallet" (top right) and switch to BNB Chain Testnet.

2. Set Policies: Go to Settings, customise your policy according to your needs.

3. Research: Ask the chat: "Explain how Uniswap v3 liquidity works." (Uses ChainGPT).

4. Generate Contract: Ask: "Write a simple ERC20 token contract called PilotToken."

5. Audit: Copy the generated code (or an existing address) and ask: "Audit this contract for me."

6. Execute (Sign-to-Pay):
- Ask: "Swap 0.01 BNB for USDT."
- Review the Risk Panel and Transaction Preview.
- Click Approve & Execute. Note that Quack handles the execution flow.

## Usage Examples

### Research
```
"What is the current state of DeFi on BNB Chain?"
"Explain how liquidity pools work on PancakeSwap"
```

### Contract Generation
```
"Create an ERC20 token called MyToken with symbol MTK and 1 million supply"
"Generate a simple staking contract with 7-day lock period"
```

### Contract Auditing
```
"Audit the contract at 0x..."
"Check this contract for security issues: [paste code]"
```

### Transactions
```
"Send 10 USDT to 0x123..."
"Swap 50 USDT for BNB"
```

## Architecture

### Intent Flow
1. User sends message
2. ChainGPT extracts intent and parameters
3. Intent parser validates and normalizes data
4. For transactions: build PreparedTx, evaluate policy
5. Display preview with risk assessment
6. User confirms → Q402 executes with signature

### Policy Engine
- Per-transaction USD limits
- Daily USD limits
- Token/contract allow/deny lists
- Unknown contract blocking
- Slippage limits
- Risk level assessment

## Deployed Smart Contracts (BNB Testnet)
Q402 Verifier = 0xe109A69825d8D8a15776788d34fA1FB49ED115De
Q402 Implementation = 0xe109A69825d8D8a15776788d34fA1FB49ED115De
Batch Executor = 0x61d2dd9121963Ab7be95befDb74Aad4C030C6186
Q402 Vault = Q402_VAULT_TESTNET=0x30D282A8a5046e46Eb7Ad4174Fa851B1624ed8D2
*These are the only official ChainPilot facilitator smart contracts.*

## License

© 2025 Nikolas Kefalonitis. All rights reserved.

## Acknowledgments

- [ChainGPT](https://chaingpt.org) for Web3 AI capabilities
- [Quack](https://quack.ai) for Q402 payment protocol
- [PancakeSwap](https://pancakeswap.finance) for DEX integration
- [BNB Chain](https://bnbchain.org) for the blockchain infrastructure
