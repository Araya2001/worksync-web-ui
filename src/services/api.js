import { tokenStorage } from './tokenStorage.js';
import { errorHandler } from './errorHandler.js';

class WorkSyncAPI {
  constructor() {
    this.baseUrl = import.meta.env.VITE_API_URL || 'https://worksync-integration-handler-625943711296.europe-west1.run.app';
    this.enableMockMode = import.meta.env.VITE_ENABLE_MOCK_MODE === 'true';
    this.debugLogging = import.meta.env.VITE_ENABLE_DEBUG_LOGGING === 'true';
    this.defaultUserId = import.meta.env.VITE_DEFAULT_USER_ID || 'default-user';
    
    this.log('WorkSyncAPI initialized with baseUrl:', this.baseUrl);
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const context = {
      url,
      endpoint,
      method: options.method || 'GET',
      provider: this.detectProviderFromEndpoint(endpoint)
    };

    // Check rate limiting before making request
    if (context.provider && errorHandler.isRateLimited(context.provider)) {
      const rateLimitStatus = errorHandler.getRateLimitStatus(context.provider);
      throw new Error(`Rate limited for ${context.provider}. Reset at: ${rateLimitStatus.resetTime}`);
    }

    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    this.log('Making request to:', url, 'with method:', config.method || 'GET');

    try {
      const response = await fetch(url, config);
      
      // Update rate limit status from response headers
      this.updateRateLimitFromResponse(response, context.provider);
      
      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        data = { message: 'Invalid JSON response' };
      }
      
      if (!response.ok) {
        const error = new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;
        error.statusText = response.statusText;
        error.headers = Object.fromEntries(response.headers.entries());
        error.body = data;
        throw error;
      }
      
      this.log('Request successful:', endpoint);
      return data;
      
    } catch (error) {
      this.log('Request failed:', endpoint, error.message);
      
      // Use error handler for comprehensive error handling
      const errorResult = await errorHandler.handleError(error, context);
      
      // Return mock data if backend is not available and mock mode is enabled
      if (this.enableMockMode && (error.name === 'TypeError' && error.message.includes('fetch'))) {
        console.warn('Backend not available, returning mock data for:', endpoint);
        return this.getMockData(endpoint);
      }
      
      // If error handler suggests retry, throw original error for retry logic
      if (errorResult.shouldRetry) {
        throw error;
      }
      
      // Throw enhanced error with user-friendly message
      throw errorHandler.createEnhancedError(error, errorResult);
    }
  }

  getMockData(endpoint) {
    if (endpoint.includes('/auth/status')) {
      return {
        success: true,
        jobber: {
          connected: false,
          authenticated: false,
          lastSync: null,
          expiresAt: null,
          expired: false,
          error: null
        },
        quickbooks: {
          connected: false,
          authenticated: false,
          lastSync: null,
          expiresAt: null,
          expired: false,
          companyId: null,
          error: null
        }
      };
    }
    
    if (endpoint.includes('/sync/stats')) {
      return {
        success: true,
        stats: {
          totalSyncs: 0,
          successfulSyncs: 0,
          failedSyncs: 0,
          pendingSyncs: 0,
          syncsLast24h: 0,
          syncsLast7days: 0,
          lastSyncTime: null
        }
      };
    }
    
    if (endpoint.includes('/jobs')) {
      return {
        success: true,
        jobs: [],
        pagination: {
          page: 1,
          perPage: 50,
          totalPages: 1,
          hasNext: false,
          hasPrevious: false
        },
        total: 0
      };
    }

    if (endpoint.includes('/health')) {
      return {
        success: true,
        status: 'Mock Mode - Backend not available',
        timestamp: new Date().toISOString()
      };
    }
    
    return { success: false, message: 'Backend not available - showing mock data' };
  }

  /**
   * Helper method to detect provider from endpoint
   */
  detectProviderFromEndpoint(endpoint) {
    if (endpoint.includes('jobber')) return 'jobber';
    if (endpoint.includes('quickbooks')) return 'quickbooks';
    return null;
  }

  /**
   * Update rate limit status from response headers
   */
  updateRateLimitFromResponse(response, provider) {
    if (!provider) return;

    // Check for standard rate limit headers
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = response.headers.get('x-ratelimit-reset');
    
    if (remaining !== null && reset !== null) {
      errorHandler.rateLimitStatus[provider] = {
        remaining: parseInt(remaining),
        resetTime: new Date(parseInt(reset) * 1000)
      };
    }
  }

  /**
   * Enhanced request with retry logic
   */
  async requestWithRetry(endpoint, options = {}) {
    const retryableRequest = errorHandler.withRetry(
      this.request.bind(this),
      { 
        endpoint,
        provider: this.detectProviderFromEndpoint(endpoint)
      }
    );
    
    return retryableRequest(endpoint, options);
  }

  /**
   * Debug logging
   */
  log(...args) {
    if (this.debugLogging) {
      console.log('[WorkSyncAPI]', ...args);
    }
  }

  // Health Check methods
  async checkHealth() {
    return this.request('/');
  }

  async getHealthStatus() {
    return this.request('/health');
  }

  // Auth methods with token storage integration
  async getAuthStatus(userId = null) {
    const actualUserId = userId || this.defaultUserId;
    
    try {
      // Get status from backend
      const backendStatus = await this.requestWithRetry(`/auth/status?userId=${actualUserId}`);
      
      // Enhance with local token storage status
      const jobberToken = tokenStorage.getTokenStatus('jobber');
      const quickbooksToken = tokenStorage.getTokenStatus('quickbooks');
      
      return {
        success: true,
        jobber: {
          ...backendStatus.jobber,
          ...jobberToken,
          tokenInStorage: jobberToken.connected
        },
        quickbooks: {
          ...backendStatus.quickbooks,
          ...quickbooksToken,
          tokenInStorage: quickbooksToken.connected
        }
      };
    } catch (error) {
      this.log('Failed to get auth status from backend, using local token storage only');
      
      // Fallback to local token storage only
      const jobberToken = tokenStorage.getTokenStatus('jobber');
      const quickbooksToken = tokenStorage.getTokenStatus('quickbooks');
      
      return {
        success: false,
        fallbackMode: true,
        jobber: jobberToken,
        quickbooks: quickbooksToken
      };
    }
  }

  async getJobberAuthUrl(userId = null) {
    const actualUserId = userId || this.defaultUserId;
    return this.requestWithRetry(`/auth/jobber?userId=${actualUserId}`);
  }

  async getQuickBooksAuthUrl(userId = null) {
    const actualUserId = userId || this.defaultUserId;
    return this.requestWithRetry(`/auth/quickbooks?userId=${actualUserId}`);
  }

  async disconnectProvider(provider, userId = null) {
    const actualUserId = userId || this.defaultUserId;
    
    try {
      // Disconnect from backend
      const result = await this.requestWithRetry('/auth/disconnect', {
        method: 'POST',
        body: JSON.stringify({ provider, userId: actualUserId }),
      });
      
      // Remove token from local storage
      tokenStorage.removeToken(provider);
      
      this.log(`Successfully disconnected ${provider} for user ${actualUserId}`);
      return result;
    } catch (error) {
      // Even if backend fails, remove local token
      tokenStorage.removeToken(provider);
      this.log(`Removed local token for ${provider}, backend disconnect may have failed`);
      throw error;
    }
  }

  /**
   * Store OAuth token after successful authentication
   */
  async storeAuthToken(provider, tokenData, userId = null) {
    const actualUserId = userId || this.defaultUserId;
    
    // Validate token data
    const validation = tokenStorage.validateToken(tokenData);
    if (!validation.valid) {
      throw new Error(`Invalid token data: ${validation.error}`);
    }
    
    // Store token with additional metadata
    const success = tokenStorage.storeToken(provider, {
      ...tokenData,
      userId: actualUserId,
      source: 'oauth_callback'
    });
    
    if (!success) {
      throw new Error(`Failed to store token for provider: ${provider}`);
    }
    
    this.log(`Token stored successfully for ${provider}`);
    return { success: true, provider, userId: actualUserId };
  }

  /**
   * Refresh OAuth token
   */
  async refreshToken(provider, userId = null) {
    const actualUserId = userId || this.defaultUserId;
    const tokenInfo = tokenStorage.getToken(provider);
    
    if (!tokenInfo || !tokenInfo.refreshToken) {
      throw new Error(`No refresh token available for provider: ${provider}`);
    }
    
    try {
      const refreshResult = await this.requestWithRetry('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({
          provider,
          refreshToken: tokenInfo.refreshToken,
          userId: actualUserId
        }),
      });
      
      if (refreshResult.success && refreshResult.tokenData) {
        tokenStorage.storeToken(provider, refreshResult.tokenData);
        this.log(`Token refreshed successfully for ${provider}`);
        return refreshResult.tokenData;
      } else {
        throw new Error('Token refresh failed');
      }
    } catch (error) {
      this.log(`Token refresh failed for ${provider}:`, error.message);
      tokenStorage.removeToken(provider);
      throw error;
    }
  }

  // Jobs methods with enhanced error handling
  async getJobs(params = {}) {
    const {
      userId = null,
      page = 1,
      perPage = 50,
      status,
      dateFrom,
      dateTo
    } = params;

    const actualUserId = userId || this.defaultUserId;
    const queryParams = new URLSearchParams({
      userId: actualUserId,
      page: page.toString(),
      perPage: perPage.toString(),
      ...(status && { status }),
      ...(dateFrom && { dateFrom }),
      ...(dateTo && { dateTo })
    });

    return this.requestWithRetry(`/jobs?${queryParams}`);
  }

  async getRecentJobs(userId = null) {
    const actualUserId = userId || this.defaultUserId;
    return this.requestWithRetry(`/jobs/recent?userId=${actualUserId}`);
  }

  async getPendingSyncJobs(userId = null) {
    const actualUserId = userId || this.defaultUserId;
    return this.requestWithRetry(`/jobs/pending?userId=${actualUserId}`);
  }

  // Sync methods with enhanced error handling
  async syncJob(jobId, userId = null) {
    const actualUserId = userId || this.defaultUserId;
    return this.requestWithRetry('/sync/job', {
      method: 'POST',
      body: JSON.stringify({ jobId, userId: actualUserId }),
    });
  }

  async syncMultipleJobs(jobIds, userId = null) {
    const actualUserId = userId || this.defaultUserId;
    return this.requestWithRetry('/sync/multiple', {
      method: 'POST',
      body: JSON.stringify({ jobIds, userId: actualUserId }),
    });
  }

  async syncPendingJobs(userId = null) {
    const actualUserId = userId || this.defaultUserId;
    return this.requestWithRetry('/sync/pending', {
      method: 'POST',
      body: JSON.stringify({ userId: actualUserId }),
    });
  }

  async getSyncStats(userId = null) {
    const actualUserId = userId || this.defaultUserId;
    return this.requestWithRetry(`/sync/stats?userId=${actualUserId}`);
  }

  /**
   * Get rate limit status for UI display
   */
  getRateLimitStatus() {
    return {
      jobber: errorHandler.getRateLimitStatus('jobber'),
      quickbooks: errorHandler.getRateLimitStatus('quickbooks')
    };
  }

  /**
   * Get token storage statistics for debugging
   */
  getTokenStorageStats() {
    return tokenStorage.getStorageStats();
  }

  /**
   * Force cleanup of expired tokens
   */
  cleanupExpiredTokens() {
    return tokenStorage.cleanupExpiredTokens();
  }
}

export const workSyncAPI = new WorkSyncAPI();

// Legacy exports for backward compatibility
export const authService = {
  async getAuthStatus(userId = null) {
    return workSyncAPI.getAuthStatus(userId);
  },
  async getJobberAuthUrl(userId = null) {
    return workSyncAPI.getJobberAuthUrl(userId);
  },
  async getQuickBooksAuthUrl(userId = null) {
    return workSyncAPI.getQuickBooksAuthUrl(userId);
  },
  async disconnectPlatform(platform, userId = null) {
    return workSyncAPI.disconnectProvider(platform, userId);
  },
  // New methods
  async storeAuthToken(provider, tokenData, userId = null) {
    return workSyncAPI.storeAuthToken(provider, tokenData, userId);
  },
  async refreshToken(provider, userId = null) {
    return workSyncAPI.refreshToken(provider, userId);
  }
};

export const jobsService = {
  async getRecentJobs(userId = null) {
    return workSyncAPI.getRecentJobs(userId);
  },
  async getJobs(params = {}) {
    return workSyncAPI.getJobs(params);
  },
  async getPendingSyncJobs(userId = null) {
    return workSyncAPI.getPendingSyncJobs(userId);
  }
};

export const syncService = {
  async syncJob(jobId, userId = null) {
    return workSyncAPI.syncJob(jobId, userId);
  },
  async syncMultipleJobs(jobIds, userId = null) {
    return workSyncAPI.syncMultipleJobs(jobIds, userId);
  },
  async syncPendingJobs(userId = null) {
    return workSyncAPI.syncPendingJobs(userId);
  },
  async getSyncStats(userId = null) {
    return workSyncAPI.getSyncStats(userId);
  }
};

// New service exports
export const tokenService = tokenStorage;
export const rateLimitService = {
  getStatus: () => workSyncAPI.getRateLimitStatus(),
  isLimited: (provider) => errorHandler.isRateLimited(provider)
};