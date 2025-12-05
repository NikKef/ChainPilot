import { Contract, Interface, parseUnits, formatUnits } from 'ethers';
import type { PreparedTx, SwapQuote } from '@/lib/types';
import { getProvider, getFeeData, estimateGas } from './provider';
import { getTokenInfo, getAllowance } from './transactions';
import { 
  PANCAKE_ROUTER, 
  PANCAKE_ROUTER_ABI, 
  TOKENS, 
  type NetworkType 
} from '@/lib/utils/constants';
import { logger } from '@/lib/utils';
import { Web3Error } from '@/lib/utils/errors';

/**
 * Get PancakeSwap router contract
 */
function getRouterContract(network: NetworkType): Contract {
  const provider = getProvider(network);
  const routerAddress = PANCAKE_ROUTER[network];
  return new Contract(routerAddress, PANCAKE_ROUTER_ABI, provider);
}

/**
 * Get WBNB address for the network
 */
function getWBNBAddress(network: NetworkType): string {
  return TOKENS[network].WBNB;
}

/**
 * Get a swap quote from PancakeSwap
 */
export async function getSwapQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  network: NetworkType,
  slippageBps: number = 300 // 3% default
): Promise<SwapQuote> {
  logger.web3Tx('getSwapQuote', { tokenIn, tokenOut, amountIn, network });

  const router = getRouterContract(network);
  const WBNB = getWBNBAddress(network);

  // Handle native BNB
  const actualTokenIn = tokenIn === 'native' ? WBNB : tokenIn;
  const actualTokenOut = tokenOut === 'native' ? WBNB : tokenOut;

  // Get token info for decimals
  const [tokenInInfo, tokenOutInfo] = await Promise.all([
    actualTokenIn === WBNB 
      ? { decimals: 18 } 
      : getTokenInfo(actualTokenIn, network),
    actualTokenOut === WBNB 
      ? { decimals: 18 } 
      : getTokenInfo(actualTokenOut, network),
  ]);

  const amountInWei = parseUnits(amountIn, tokenInInfo.decimals);

  // Build path
  const path = buildPath(actualTokenIn, actualTokenOut, WBNB);

  try {
    // Get amounts out
    const amounts: bigint[] = await router.getAmountsOut(amountInWei, path);
    const amountOutWei = amounts[amounts.length - 1];

    // Calculate minimum output with slippage
    const slippageMultiplier = BigInt(10000 - slippageBps);
    const amountOutMinWei = (amountOutWei * slippageMultiplier) / 10000n;

    // Calculate price impact (simplified)
    const priceImpact = calculatePriceImpact(amountInWei, amountOutWei, path.length);

    // Set deadline (20 minutes from now)
    const deadline = Math.floor(Date.now() / 1000) + 1200;

    return {
      tokenIn: actualTokenIn,
      tokenOut: actualTokenOut,
      amountIn: amountInWei.toString(),
      amountOut: amountOutWei.toString(),
      amountOutMin: amountOutMinWei.toString(),
      path,
      priceImpact,
      executionPrice: formatUnits(
        (amountOutWei * parseUnits('1', tokenInInfo.decimals)) / amountInWei,
        tokenOutInfo.decimals
      ),
      deadline,
    };
  } catch (error) {
    logger.error('Failed to get swap quote', error);
    throw new Web3Error(
      `Failed to get swap quote: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Build swap path
 */
function buildPath(tokenIn: string, tokenOut: string, WBNB: string): string[] {
  // If both tokens are different from WBNB, route through WBNB
  if (tokenIn !== WBNB && tokenOut !== WBNB) {
    return [tokenIn, WBNB, tokenOut];
  }
  return [tokenIn, tokenOut];
}

/**
 * Calculate approximate price impact
 */
function calculatePriceImpact(
  amountIn: bigint,
  amountOut: bigint,
  hops: number
): number {
  // Simplified price impact calculation
  // In reality, this would compare against spot price
  const impactPerHop = 0.3; // 0.3% per hop (rough estimate)
  return impactPerHop * (hops - 1);
}

/**
 * Build swap transaction for tokens
 */
export async function buildSwapExactTokensForTokens(
  from: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  network: NetworkType,
  slippageBps: number = 300
): Promise<PreparedTx> {
  logger.web3Tx('buildSwapExactTokensForTokens', { from, tokenIn, tokenOut, amountIn, network });

  const quote = await getSwapQuote(tokenIn, tokenOut, amountIn, network, slippageBps);
  const router = getRouterContract(network);
  const routerAddress = PANCAKE_ROUTER[network];

  const iface = new Interface(PANCAKE_ROUTER_ABI);
  const data = iface.encodeFunctionData('swapExactTokensForTokens', [
    quote.amountIn,
    quote.amountOutMin,
    quote.path,
    from,
    quote.deadline,
  ]);

  // Estimate gas
  const gasEstimate = await estimateGas(
    { from, to: routerAddress, data },
    network
  );

  const feeData = await getFeeData(network);

  return {
    to: routerAddress,
    data,
    value: '0',
    gasLimit: (gasEstimate * 130n / 100n).toString(),
    gasPrice: feeData.gasPrice.toString(),
  };
}

/**
 * Build swap transaction for BNB to tokens
 */
export async function buildSwapExactETHForTokens(
  from: string,
  tokenOut: string,
  amountIn: string,
  network: NetworkType,
  slippageBps: number = 300
): Promise<PreparedTx> {
  logger.web3Tx('buildSwapExactETHForTokens', { from, tokenOut, amountIn, network });

  const quote = await getSwapQuote('native', tokenOut, amountIn, network, slippageBps);
  const routerAddress = PANCAKE_ROUTER[network];

  const iface = new Interface(PANCAKE_ROUTER_ABI);
  const data = iface.encodeFunctionData('swapExactETHForTokens', [
    quote.amountOutMin,
    quote.path,
    from,
    quote.deadline,
  ]);

  // Estimate gas with value
  const gasEstimate = await estimateGas(
    { from, to: routerAddress, data, value: BigInt(quote.amountIn) },
    network
  );

  const feeData = await getFeeData(network);

  return {
    to: routerAddress,
    data,
    value: quote.amountIn,
    gasLimit: (gasEstimate * 130n / 100n).toString(),
    gasPrice: feeData.gasPrice.toString(),
  };
}

/**
 * Build swap transaction for tokens to BNB
 */
export async function buildSwapExactTokensForETH(
  from: string,
  tokenIn: string,
  amountIn: string,
  network: NetworkType,
  slippageBps: number = 300
): Promise<PreparedTx> {
  logger.web3Tx('buildSwapExactTokensForETH', { from, tokenIn, amountIn, network });

  const quote = await getSwapQuote(tokenIn, 'native', amountIn, network, slippageBps);
  const routerAddress = PANCAKE_ROUTER[network];

  const iface = new Interface(PANCAKE_ROUTER_ABI);
  const data = iface.encodeFunctionData('swapExactTokensForETH', [
    quote.amountIn,
    quote.amountOutMin,
    quote.path,
    from,
    quote.deadline,
  ]);

  // Estimate gas
  const gasEstimate = await estimateGas(
    { from, to: routerAddress, data },
    network
  );

  const feeData = await getFeeData(network);

  return {
    to: routerAddress,
    data,
    value: '0',
    gasLimit: (gasEstimate * 130n / 100n).toString(),
    gasPrice: feeData.gasPrice.toString(),
  };
}

/**
 * Build the appropriate swap transaction based on token types
 */
export async function buildSwap(
  from: string,
  tokenIn: string | null, // null = native BNB
  tokenOut: string | null, // null = native BNB
  amountIn: string,
  network: NetworkType,
  slippageBps: number = 300
): Promise<{
  preparedTx: PreparedTx;
  quote: SwapQuote;
  needsApproval: boolean;
  approvalTx?: PreparedTx;
}> {
  const isNativeIn = !tokenIn || tokenIn === 'native';
  const isNativeOut = !tokenOut || tokenOut === 'native';
  const WBNB = getWBNBAddress(network);
  const routerAddress = PANCAKE_ROUTER[network];

  let quote: SwapQuote;
  let preparedTx: PreparedTx;
  let needsApproval = false;
  let approvalTx: PreparedTx | undefined;

  if (isNativeIn && isNativeOut) {
    throw new Web3Error('Cannot swap BNB to BNB');
  }

  if (isNativeIn) {
    // BNB -> Token
    quote = await getSwapQuote('native', tokenOut!, amountIn, network, slippageBps);
    preparedTx = await buildSwapExactETHForTokens(from, tokenOut!, amountIn, network, slippageBps);
  } else if (isNativeOut) {
    // Token -> BNB
    quote = await getSwapQuote(tokenIn!, 'native', amountIn, network, slippageBps);
    preparedTx = await buildSwapExactTokensForETH(from, tokenIn!, amountIn, network, slippageBps);

    // Check approval
    const allowance = await getAllowance(tokenIn!, from, routerAddress, network);
    if (allowance < BigInt(quote.amountIn)) {
      needsApproval = true;
      // Build max approval
      const { buildApproval } = await import('./transactions');
      approvalTx = await buildApproval(
        from,
        tokenIn!,
        routerAddress,
        '115792089237316195423570985008687907853269984665640564039457584007913129639935', // Max uint256
        network
      );
    }
  } else {
    // Token -> Token
    quote = await getSwapQuote(tokenIn!, tokenOut!, amountIn, network, slippageBps);
    preparedTx = await buildSwapExactTokensForTokens(from, tokenIn!, tokenOut!, amountIn, network, slippageBps);

    // Check approval
    const allowance = await getAllowance(tokenIn!, from, routerAddress, network);
    if (allowance < BigInt(quote.amountIn)) {
      needsApproval = true;
      const { buildApproval } = await import('./transactions');
      approvalTx = await buildApproval(
        from,
        tokenIn!,
        routerAddress,
        '115792089237316195423570985008687907853269984665640564039457584007913129639935',
        network
      );
    }
  }

  return {
    preparedTx,
    quote,
    needsApproval,
    approvalTx,
  };
}

