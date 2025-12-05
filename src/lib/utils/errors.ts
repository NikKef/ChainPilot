/**
 * Base error class for ChainPilot
 */
export class ChainPilotError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    statusCode = 500,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ChainPilotError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Validation error for invalid user input
 */
export class ValidationError extends ChainPilotError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

/**
 * Authentication error
 */
export class AuthError extends ChainPilotError {
  constructor(message = 'Authentication required') {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'AuthError';
  }
}

/**
 * Authorization error
 */
export class ForbiddenError extends ChainPilotError {
  constructor(message = 'Access denied') {
    super(message, 'FORBIDDEN', 403);
    this.name = 'ForbiddenError';
  }
}

/**
 * Not found error
 */
export class NotFoundError extends ChainPilotError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends ChainPilotError {
  public readonly retryAfter?: number;

  constructor(message = 'Rate limit exceeded', retryAfter?: number) {
    super(message, 'RATE_LIMIT', 429, { retryAfter });
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * External API error (ChainGPT, Q402, etc.)
 */
export class ExternalApiError extends ChainPilotError {
  public readonly service: string;

  constructor(service: string, message: string, details?: Record<string, unknown>) {
    super(`${service}: ${message}`, 'EXTERNAL_API_ERROR', 502, details);
    this.name = 'ExternalApiError';
    this.service = service;
  }
}

/**
 * Blockchain/Web3 error
 */
export class Web3Error extends ChainPilotError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'WEB3_ERROR', 500, details);
    this.name = 'Web3Error';
  }
}

/**
 * Policy violation error
 */
export class PolicyViolationError extends ChainPilotError {
  public readonly violations: string[];

  constructor(violations: string[]) {
    super('Transaction blocked by policy', 'POLICY_VIOLATION', 403, { violations });
    this.name = 'PolicyViolationError';
    this.violations = violations;
  }
}

/**
 * Transaction error
 */
export class TransactionError extends ChainPilotError {
  public readonly txHash?: string;

  constructor(message: string, txHash?: string, details?: Record<string, unknown>) {
    super(message, 'TRANSACTION_ERROR', 500, { ...details, txHash });
    this.name = 'TransactionError';
    this.txHash = txHash;
  }
}

/**
 * Format error for API response
 */
export function formatErrorResponse(error: unknown): {
  error: string;
  code: string;
  details?: Record<string, unknown>;
} {
  if (error instanceof ChainPilotError) {
    return {
      error: error.message,
      code: error.code,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      error: error.message,
      code: 'INTERNAL_ERROR',
    };
  }

  return {
    error: 'An unexpected error occurred',
    code: 'UNKNOWN_ERROR',
  };
}

/**
 * Get HTTP status code for error
 */
export function getErrorStatusCode(error: unknown): number {
  if (error instanceof ChainPilotError) {
    return error.statusCode;
  }
  return 500;
}

/**
 * Safely extract error message
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unexpected error occurred';
}

