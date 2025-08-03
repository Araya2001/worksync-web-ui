/**
 * Enhanced Error Handler Service
 * Provides comprehensive error handling with retry logic, user-friendly messages, and rate limiting awareness
 */

class ErrorHandlerService {
  constructor() {
    this.debugLogging = import.meta.env.VITE_ENABLE_DEBUG_LOGGING === 'true';
    this.rateLimits = {
      jobber: parseInt(import.meta.env.VITE_JOBBER_RATE_LIMIT) || 2500,
      quickbooks: parseInt(import.meta.env.VITE_QUICKBOOKS_RATE_LIMIT) || 500
    };
    
    // Retry configuration
    this.retryConfig = {
      maxRetries: 3,
      baseDelay: 1000, // 1 second
      maxDelay: 30000, // 30 seconds
      backoffMultiplier: 2
    };

    // Rate limiting tracking
    this.rateLimitStatus = {
      jobber: { remaining: this.rateLimits.jobber, resetTime: null },
      quickbooks: { remaining: this.rateLimits.quickbooks, resetTime: null }
    };
  }

  /**
   * Main error handling method
   */
  async handleError(error, context = {}) {
    const errorInfo = this.analyzeError(error, context);
    
    this.log('Handling error:', errorInfo);

    // Update rate limiting status if applicable
    if (errorInfo.isRateLimit) {
      this.updateRateLimitStatus(errorInfo.provider, errorInfo.retryAfter);
    }

    // Determine if retry is appropriate
    if (this.shouldRetry(errorInfo, context)) {
      return this.scheduleRetry(errorInfo, context);
    }

    // Handle authentication errors
    if (errorInfo.isAuthError) {
      return this.handleAuthError(errorInfo, context);
    }

    // Return processed error for UI display
    return {
      handled: true,
      userMessage: this.getUserFriendlyMessage(errorInfo),
      techMessage: errorInfo.message,
      canRetry: this.shouldRetry(errorInfo, context),
      isRateLimit: errorInfo.isRateLimit,
      retryAfter: errorInfo.retryAfter,
      errorCode: errorInfo.code,
      context: errorInfo.context
    };
  }

  /**
   * Analyze error to determine type and appropriate handling
   */
  analyzeError(error, context) {
    const errorInfo = {
      originalError: error,
      message: error.message || 'Unknown error',
      code: error.code || error.status || 'UNKNOWN',
      context: context,
      timestamp: new Date().toISOString(),
      isNetworkError: false,
      isRateLimit: false,
      isAuthError: false,
      isServerError: false,
      isClientError: false,
      retryAfter: null,
      provider: context.provider || this.detectProvider(error, context)
    };

    // Network errors
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      errorInfo.isNetworkError = true;
      errorInfo.category = 'NETWORK_ERROR';
    }

    // HTTP status code analysis
    if (error.status || error.code) {
      const statusCode = parseInt(error.status || error.code);
      
      if (statusCode === 401) {
        errorInfo.isAuthError = true;
        errorInfo.category = 'AUTH_ERROR';
      } else if (statusCode === 429) {
        errorInfo.isRateLimit = true;
        errorInfo.category = 'RATE_LIMIT';
        errorInfo.retryAfter = this.extractRetryAfter(error);
      } else if (statusCode >= 500) {
        errorInfo.isServerError = true;
        errorInfo.category = 'SERVER_ERROR';
      } else if (statusCode >= 400) {
        errorInfo.isClientError = true;
        errorInfo.category = 'CLIENT_ERROR';
      }
    }

    // GraphQL specific errors
    if (error.graphQLErrors || (error.message && error.message.includes('GraphQL'))) {
      errorInfo.category = 'GRAPHQL_ERROR';
      errorInfo.graphQLErrors = error.graphQLErrors || [];
    }

    return errorInfo;
  }

  /**
   * Determine if error should be retried
   */
  shouldRetry(errorInfo, context) {
    const retryCount = context.retryCount || 0;
    
    // Don't retry if max retries exceeded
    if (retryCount >= this.retryConfig.maxRetries) {
      return false;
    }

    // Don't retry client errors (4xx except 429)
    if (errorInfo.isClientError && !errorInfo.isRateLimit) {
      return false;
    }

    // Retry network errors, server errors, and rate limits
    return errorInfo.isNetworkError || errorInfo.isServerError || errorInfo.isRateLimit;
  }

  /**
   * Schedule retry with exponential backoff
   */
  async scheduleRetry(errorInfo, context) {
    const retryCount = (context.retryCount || 0) + 1;
    let delay = this.calculateRetryDelay(retryCount, errorInfo.retryAfter);

    // Add jitter to prevent thundering herd
    delay += Math.random() * 1000;

    this.log(`Scheduling retry ${retryCount} in ${delay}ms`);

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          shouldRetry: true,
          delay,
          retryCount,
          userMessage: `Retrying in ${Math.ceil(delay / 1000)} seconds... (Attempt ${retryCount}/${this.retryConfig.maxRetries})`
        });
      }, delay);
    });
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  calculateRetryDelay(retryCount, retryAfter = null) {
    // Use server-provided retry-after if available
    if (retryAfter) {
      return Math.min(retryAfter * 1000, this.retryConfig.maxDelay);
    }

    // Exponential backoff
    const delay = this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, retryCount - 1);
    return Math.min(delay, this.retryConfig.maxDelay);
  }

  /**
   * Handle authentication errors
   */
  async handleAuthError(errorInfo, context) {
    this.log('Handling authentication error:', errorInfo);
    
    // Trigger token refresh if available
    if (context.refreshToken && typeof context.refreshToken === 'function') {
      try {
        await context.refreshToken();
        return {
          handled: true,
          shouldRetry: true,
          userMessage: 'Authentication refreshed, retrying...',
          retryCount: (context.retryCount || 0) + 1
        };
      } catch (refreshError) {
        this.log('Token refresh failed:', refreshError);
      }
    }

    return {
      handled: true,
      userMessage: 'Please sign in again to continue',
      techMessage: errorInfo.message,
      requiresReauth: true,
      provider: errorInfo.provider
    };
  }

  /**
   * Get user-friendly error messages
   */
  getUserFriendlyMessage(errorInfo) {
    switch (errorInfo.category) {
      case 'NETWORK_ERROR':
        return 'Unable to connect to the server. Please check your internet connection and try again.';

      case 'AUTH_ERROR':
        return 'Your session has expired. Please sign in again.';

      case 'RATE_LIMIT':
        const waitTime = errorInfo.retryAfter ? Math.ceil(errorInfo.retryAfter) : 60;
        return `Too many requests. Please wait ${waitTime} seconds before trying again.`;

      case 'SERVER_ERROR':
        return 'The server encountered an error. Please try again in a few moments.';

      case 'GRAPHQL_ERROR':
        if (errorInfo.graphQLErrors && errorInfo.graphQLErrors.length > 0) {
          return errorInfo.graphQLErrors[0].message || 'A data processing error occurred.';
        }
        return 'A data processing error occurred.';

      case 'CLIENT_ERROR':
        if (errorInfo.code === 400) {
          return 'Invalid request. Please check your input and try again.';
        }
        if (errorInfo.code === 403) {
          return 'You do not have permission to perform this action.';
        }
        if (errorInfo.code === 404) {
          return 'The requested resource was not found.';
        }
        return 'There was a problem with your request.';

      default:
        return 'An unexpected error occurred. Please try again.';
    }
  }

  /**
   * Extract retry-after value from error
   */
  extractRetryAfter(error) {
    // Check headers if available
    if (error.headers && error.headers['retry-after']) {
      return parseInt(error.headers['retry-after']);
    }

    // Check response body
    if (error.body && error.body.retryAfter) {
      return parseInt(error.body.retryAfter);
    }

    return null;
  }

  /**
   * Detect provider from error or context
   */
  detectProvider(error, context) {
    if (context.url) {
      if (context.url.includes('jobber')) return 'jobber';
      if (context.url.includes('quickbooks')) return 'quickbooks';
    }

    if (error.message) {
      if (error.message.toLowerCase().includes('jobber')) return 'jobber';
      if (error.message.toLowerCase().includes('quickbooks')) return 'quickbooks';
    }

    return 'unknown';
  }

  /**
   * Update rate limit status tracking
   */
  updateRateLimitStatus(provider, retryAfter) {
    if (!this.rateLimitStatus[provider]) return;

    this.rateLimitStatus[provider] = {
      remaining: 0,
      resetTime: new Date(Date.now() + (retryAfter || 60) * 1000)
    };

    this.log(`Rate limit hit for ${provider}, reset at:`, this.rateLimitStatus[provider].resetTime);
  }

  /**
   * Check if provider is currently rate limited
   */
  isRateLimited(provider) {
    const status = this.rateLimitStatus[provider];
    if (!status || !status.resetTime) return false;

    const now = new Date();
    if (now >= status.resetTime) {
      // Reset the rate limit status
      status.remaining = this.rateLimits[provider];
      status.resetTime = null;
      return false;
    }

    return status.remaining <= 0;
  }

  /**
   * Get rate limit status for UI display
   */
  getRateLimitStatus(provider) {
    const status = this.rateLimitStatus[provider];
    if (!status) return null;

    return {
      provider,
      limit: this.rateLimits[provider],
      remaining: status.remaining,
      resetTime: status.resetTime,
      isLimited: this.isRateLimited(provider)
    };
  }

  /**
   * Create retry function with error handling
   */
  withRetry(asyncFunction, context = {}) {
    return async (...args) => {
      let lastError;
      let retryCount = 0;

      while (retryCount <= this.retryConfig.maxRetries) {
        try {
          return await asyncFunction(...args);
        } catch (error) {
          lastError = error;
          const errorResult = await this.handleError(error, { ...context, retryCount });

          if (!errorResult.shouldRetry && !errorResult.canRetry) {
            throw this.createEnhancedError(error, errorResult);
          }

          if (errorResult.shouldRetry) {
            retryCount++;
            if (errorResult.delay) {
              await new Promise(resolve => setTimeout(resolve, errorResult.delay));
            }
            continue;
          }

          throw this.createEnhancedError(error, errorResult);
        }
      }

      throw this.createEnhancedError(lastError, { userMessage: 'Maximum retries exceeded' });
    };
  }

  /**
   * Create enhanced error with user-friendly information
   */
  createEnhancedError(originalError, errorResult) {
    const enhancedError = new Error(errorResult.userMessage || originalError.message);
    enhancedError.originalError = originalError;
    enhancedError.userMessage = errorResult.userMessage;
    enhancedError.techMessage = errorResult.techMessage;
    enhancedError.canRetry = errorResult.canRetry;
    enhancedError.requiresReauth = errorResult.requiresReauth;
    enhancedError.isRateLimit = errorResult.isRateLimit;
    enhancedError.provider = errorResult.provider;
    return enhancedError;
  }

  /**
   * Debug logging
   */
  log(...args) {
    if (this.debugLogging) {
      console.log('[ErrorHandler]', ...args);
    }
  }
}

// Create singleton instance
export const errorHandler = new ErrorHandlerService();

// Export class for testing
export { ErrorHandlerService };