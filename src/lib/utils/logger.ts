type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CURRENT_LEVEL = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[CURRENT_LEVEL];
}

function formatMessage(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` ${JSON.stringify(context)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
}

/**
 * Logger utility for consistent logging across the application
 */
export const logger = {
  debug(message: string, context?: LogContext): void {
    if (shouldLog('debug')) {
      console.debug(formatMessage('debug', message, context));
    }
  },

  info(message: string, context?: LogContext): void {
    if (shouldLog('info')) {
      console.info(formatMessage('info', message, context));
    }
  },

  warn(message: string, context?: LogContext): void {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message, context));
    }
  },

  error(message: string, error?: unknown, context?: LogContext): void {
    if (shouldLog('error')) {
      const errorDetails = error instanceof Error 
        ? { errorMessage: error.message, stack: error.stack }
        : { error };
      console.error(formatMessage('error', message, { ...errorDetails, ...context }));
    }
  },

  /**
   * Log API request
   */
  apiRequest(method: string, path: string, context?: LogContext): void {
    this.info(`API ${method} ${path}`, context);
  },

  /**
   * Log API response
   */
  apiResponse(method: string, path: string, statusCode: number, durationMs: number): void {
    this.info(`API ${method} ${path} ${statusCode} ${durationMs}ms`);
  },

  /**
   * Log ChainGPT API call
   */
  chainGptCall(service: string, context?: LogContext): void {
    this.debug(`ChainGPT ${service}`, context);
  },

  /**
   * Log Web3 transaction
   */
  web3Tx(action: string, context?: LogContext): void {
    this.info(`Web3 ${action}`, context);
  },

  /**
   * Log policy evaluation
   */
  policyEval(decision: string, context?: LogContext): void {
    this.debug(`Policy ${decision}`, context);
  },

  /**
   * Log Q402 operation
   */
  q402(action: string, context?: LogContext): void {
    this.info(`Q402 ${action}`, context);
  },
};

export default logger;

