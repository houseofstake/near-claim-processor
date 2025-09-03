/**
 * Base error class for application-specific errors
 */
export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly isOperational: boolean;

  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = this.constructor.name;
    
    // Ensure the correct stack trace is captured
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Validation error for invalid input data
 */
export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly isOperational = true;

  constructor(message: string, cause?: Error) {
    super(message, cause);
  }
}

/**
 * Not found error for missing resources
 */
export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly isOperational = true;

  constructor(resource: string, identifier?: string, cause?: Error) {
    const message = identifier 
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;
    super(message, cause);
  }
}

/**
 * Conflict error for duplicate resources
 */
export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly isOperational = true;

  constructor(message: string, cause?: Error) {
    super(message, cause);
  }
}

/**
 * Processing error for business logic failures
 */
export class ProcessingError extends AppError {
  readonly statusCode = 422;
  readonly isOperational = true;

  constructor(message: string, cause?: Error) {
    super(message, cause);
  }
}

/**
 * Storage error for storage operation failures
 */
export class StorageError extends AppError {
  readonly statusCode = 500;
  readonly isOperational = true;

  constructor(operation: string, cause?: Error) {
    super(`Storage operation failed: ${operation}`, cause);
  }
}

/**
 * Database error for database operation failures
 */
export class DatabaseError extends AppError {
  readonly statusCode = 500;
  readonly isOperational = true;

  constructor(operation: string, cause?: Error) {
    super(`Database operation failed: ${operation}`, cause);
  }
}

/**
 * Configuration error for missing or invalid configuration
 */
export class ConfigurationError extends AppError {
  readonly statusCode = 500;
  readonly isOperational = false;

  constructor(message: string, cause?: Error) {
    super(`Configuration error: ${message}`, cause);
  }
}

/**
 * Utility functions for error handling
 */
export class ErrorUtils {
  /**
   * Check if an error is operational (expected) or programming error
   */
  static isOperationalError(error: Error): boolean {
    if (error instanceof AppError) {
      return error.isOperational;
    }
    return false;
  }

  /**
   * Create a safe error response object for API responses
   */
  static toErrorResponse(error: Error): { error: string; message: string; statusCode?: number } {
    if (error instanceof AppError) {
      return {
        error: error.name,
        message: error.message,
        statusCode: error.statusCode
      };
    }

    // For non-operational errors, don't expose internal details
    return {
      error: 'InternalError',
      message: 'An unexpected error occurred'
    };
  }

  /**
   * Log error with appropriate level based on error type
   */
  static logError(error: Error, context?: string): void {
    const isOperational = this.isOperationalError(error);
    const logLevel = isOperational ? 'warn' : 'error';
    const contextInfo = context ? ` [${context}]` : '';
    
    console[logLevel](`${error.name}${contextInfo}:`, error.message);
    
    if (!isOperational || process.env.NODE_ENV === 'development') {
      console[logLevel]('Stack trace:', error.stack);
    }

    // Log the cause if it exists
    if (error instanceof AppError && error.cause) {
      console[logLevel]('Caused by:', error.cause.message);
    }
  }

  /**
   * Wrap a function to catch and convert errors to appropriate types
   */
  static async safeAsync<T>(
    operation: () => Promise<T>,
    context: string,
    errorMapper?: (error: Error) => AppError
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const appError = errorMapper 
        ? errorMapper(error as Error)
        : new ProcessingError(`Operation failed: ${context}`, error as Error);
      
      this.logError(appError, context);
      throw appError;
    }
  }
}