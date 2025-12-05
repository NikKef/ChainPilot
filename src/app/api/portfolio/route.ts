import { NextRequest, NextResponse } from 'next/server';
import { getNativeBalance, getTokenBalance, getTokenInfo } from '@/lib/services/web3';
import { TOKENS, type NetworkType } from '@/lib/utils/constants';
import { formatTokenAmount } from '@/lib/utils/formatting';
import type { PortfolioResponse, Portfolio, TokenBalance } from '@/lib/types';
import { formatErrorResponse, getErrorStatusCode, ValidationError } from '@/lib/utils/errors';
import { isValidAddress, isValidNetwork } from '@/lib/utils/validation';
import { logger } from '@/lib/utils';

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');
    const network = searchParams.get('network') as NetworkType;

    if (!address) {
      throw new ValidationError('Address is required');
    }

    if (!isValidAddress(address)) {
      throw new ValidationError('Invalid address format');
    }

    if (!network || !isValidNetwork(network)) {
      throw new ValidationError('Valid network (testnet or mainnet) is required');
    }

    logger.apiRequest('GET', '/api/portfolio', { address, network });

    // Get native balance
    const nativeBalance = await getNativeBalance(address, network);
    const nativeBalanceFormatted = formatTokenAmount(nativeBalance, 18, 4);

    // Get token balances for common tokens
    const tokenAddresses = Object.values(TOKENS[network]);
    const tokenBalances: TokenBalance[] = [];

    for (const tokenAddress of tokenAddresses) {
      try {
        const [tokenInfo, balance] = await Promise.all([
          getTokenInfo(tokenAddress, network),
          getTokenBalance(tokenAddress, address, network),
        ]);

        // Only include tokens with non-zero balance
        if (balance.balance > 0n) {
          tokenBalances.push({
            address: tokenAddress,
            symbol: tokenInfo.symbol,
            name: tokenInfo.name,
            decimals: tokenInfo.decimals,
            balance: balance.balance.toString(),
            balanceFormatted: balance.formatted,
          });
        }
      } catch (error) {
        // Skip tokens that fail to load
        logger.debug(`Failed to load token ${tokenAddress}`, { error });
      }
    }

    const portfolio: Portfolio = {
      address,
      network,
      nativeBalance: nativeBalance.toString(),
      nativeBalanceFormatted,
      tokens: tokenBalances,
      updatedAt: new Date().toISOString(),
    };

    const response: PortfolioResponse = { portfolio };

    const duration = Date.now() - startTime;
    logger.apiResponse('GET', '/api/portfolio', 200, duration);

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Portfolio API error', error);
    logger.apiResponse('GET', '/api/portfolio', getErrorStatusCode(error), duration);

    return NextResponse.json(
      formatErrorResponse(error),
      { status: getErrorStatusCode(error) }
    );
  }
}

