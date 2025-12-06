import { type NetworkType } from '@/lib/utils/constants';
import { logger } from '@/lib/utils';
import { ExternalApiError } from '@/lib/utils/errors';

// Etherscan v2 API (unified API for all chains)
const ETHERSCAN_V2_API_URL = 'https://api.etherscan.io/v2/api';

// Chain IDs for Etherscan v2 API
const CHAIN_IDS: Record<NetworkType, string> = {
  mainnet: '56',   // BSC Mainnet
  testnet: '97',   // BSC Testnet
};

interface EtherscanSourceResponse {
  status: string;
  message: string;
  result: Array<{
    SourceCode: string;
    ABI: string;
    ContractName: string;
    CompilerVersion: string;
    CompilerType?: string;
    OptimizationUsed: string;
    Runs: string;
    ConstructorArguments: string;
    EVMVersion: string;
    Library: string;
    ContractFileName?: string;
    LicenseType: string;
    Proxy: string;
    Implementation: string;
    SwarmSource: string;
    SimilarMatch?: string;
  }>;
}

export interface ContractSourceResult {
  success: boolean;
  sourceCode?: string;
  contractName?: string;
  compilerVersion?: string;
  abi?: string;
  isVerified: boolean;
  error?: string;
}

/**
 * Fetch verified contract source code using Etherscan v2 API
 * @param address - Contract address to fetch source for
 * @param network - Network (testnet or mainnet)
 * @returns Contract source code and metadata
 */
export async function fetchContractSource(
  address: string,
  network: NetworkType
): Promise<ContractSourceResult> {
  const apiKey = process.env.BSCSCAN_API_KEY;
  const chainId = CHAIN_IDS[network];

  if (!apiKey) {
    logger.warn('BSCSCAN_API_KEY not configured, contract source fetch may fail');
  }

  logger.debug('Fetching contract source from Etherscan v2 API', { address, network, chainId });

  // Build API URL with Etherscan v2 format
  const params = new URLSearchParams({
    chainid: chainId,
    module: 'contract',
    action: 'getsourcecode',
    address: address,
    ...(apiKey && { apikey: apiKey }),
  });

  const url = `${ETHERSCAN_V2_API_URL}?${params.toString()}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new ExternalApiError('Etherscan', `HTTP ${response.status}: ${response.statusText}`);
    }

    const data: EtherscanSourceResponse = await response.json();

    // Check if the API call was successful
    if (data.status !== '1') {
      logger.warn('Etherscan API returned error', { status: data.status, message: data.message });
      return {
        success: false,
        isVerified: false,
        error: data.message || 'Failed to fetch contract source',
      };
    }

    // Check if we got results
    if (!data.result || data.result.length === 0) {
      return {
        success: false,
        isVerified: false,
        error: 'No contract found at this address',
      };
    }

    const contractData = data.result[0];

    // Check if contract is verified (SourceCode will be empty if not verified)
    if (!contractData.SourceCode || contractData.SourceCode === '') {
      return {
        success: false,
        isVerified: false,
        error: 'Contract source code is not verified',
      };
    }

    // Handle multi-file contracts (source code starts with {{ or {)
    let sourceCode = contractData.SourceCode;
    
    // Etherscan sometimes wraps multi-file contracts in double braces
    if (sourceCode.startsWith('{{')) {
      try {
        // Remove outer braces and parse as JSON
        const innerJson = sourceCode.slice(1, -1);
        const parsed = JSON.parse(innerJson);
        
        // Combine all source files
        if (parsed.sources) {
          const sources = parsed.sources as Record<string, { content: string }>;
          sourceCode = Object.entries(sources)
            .map(([filename, file]) => `// File: ${filename}\n${file.content}`)
            .join('\n\n');
        }
      } catch (e) {
        // If parsing fails, use as-is
        logger.debug('Could not parse multi-file source, using raw', { error: e });
      }
    } else if (sourceCode.startsWith('{')) {
      // Single brace - might be JSON format
      try {
        const parsed = JSON.parse(sourceCode);
        if (parsed.sources) {
          const sources = parsed.sources as Record<string, { content: string }>;
          sourceCode = Object.entries(sources)
            .map(([filename, file]) => `// File: ${filename}\n${file.content}`)
            .join('\n\n');
        }
      } catch {
        // Not JSON, use as-is
      }
    }

    logger.info('Successfully fetched contract source', {
      address,
      contractName: contractData.ContractName,
      sourceLength: sourceCode.length,
      chainId,
    });

    return {
      success: true,
      sourceCode,
      contractName: contractData.ContractName,
      compilerVersion: contractData.CompilerVersion,
      abi: contractData.ABI,
      isVerified: true,
    };
  } catch (error) {
    if (error instanceof ExternalApiError) {
      throw error;
    }

    logger.error('Failed to fetch contract source from Etherscan', error);
    return {
      success: false,
      isVerified: false,
      error: error instanceof Error ? error.message : 'Unknown error fetching contract source',
    };
  }
}

/**
 * Check if a contract is verified
 * @param address - Contract address to check
 * @param network - Network (testnet or mainnet)
 * @returns Whether the contract is verified
 */
export async function isContractVerified(
  address: string,
  network: NetworkType
): Promise<boolean> {
  const result = await fetchContractSource(address, network);
  return result.isVerified;
}
