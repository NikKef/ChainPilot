# ChainPilot - AI-Powered Web3 Copilot for BNB Chain

ChainPilot is a chat-based Web3 copilot that enables users to interact with the BNB Chain through natural language. Research protocols, generate smart contracts, audit code, and execute on-chain actions — all through conversation.

## Overview

**Target User:** Retail DeFi enthusiasts who want to manage their on-chain activities more efficiently using AI assistance.

**Key Features:**
- Natural language chat interface for Web3 interactions
- Smart contract generation from plain English descriptions
- Automated security auditing of smart contracts
- Token swaps via PancakeSwap integration
- Native and BEP20 token transfers
- Policy-based transaction protection (spend caps, allow/deny lists)
- One-click execution via Q402 sign-to-pay

## Tech Stack

- **Frontend:** Next.js 14 (App Router), React, TypeScript, Tailwind CSS, Framer Motion
- **Backend:** Next.js API Routes, Supabase (PostgreSQL)
- **AI:** ChainGPT SDK (Web3 LLM, Contract Generator, Auditor)
- **Blockchain:** ethers.js v6, BNB Chain (testnet/mainnet)
- **DEX:** PancakeSwap V2/V3 Router
- **Execution:** Q402 sign-to-pay protocol

## ChainGPT + Quack Components Used

### ChainGPT Integration
1. **Web3 LLM** - Natural language understanding and context extraction for intent parsing
2. **Smart Contract Generator** - Generate Solidity contracts from natural language specifications
3. **Smart Contract Auditor** - Automated security analysis with risk scoring

### Quack Q402 Integration
- **Sign-to-pay execution** - Gasless transaction execution with signature-based approval
- **Transaction batching** - Execute multiple operations atomically

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
   - Run the migration in `supabase/migrations/001_initial_schema.sql`

5. Start the development server:
```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000)

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

## Demo Flows

### Flow 1: Research + Swap
1. "What's the best token to buy on BNB right now?"
2. ChainGPT provides analysis
3. "Swap 10 USDT for WBNB"
4. Preview shown with risk assessment
5. User confirms, transaction executes

### Flow 2: Contract Generation + Audit + Deploy
1. "Create an NFT collection contract with max 10000 supply"
2. Contract generated and auto-audited
3. Risk findings displayed
4. User reviews and deploys

### Flow 3: Policy Protection
1. User sets daily limit to $100
2. "Send 200 USDT to 0x..."
3. Transaction blocked by policy
4. Clear explanation provided

## License

No License. © 2025 Nikolas Kefalonitis. All rights reserved.

## Acknowledgments

- [ChainGPT](https://chaingpt.org) for Web3 AI capabilities
- [Quack](https://quack.ai) for Q402 payment protocol
- [PancakeSwap](https://pancakeswap.finance) for DEX integration
- [BNB Chain](https://bnbchain.org) for the blockchain infrastructure
