/**
 * Secure Token Storage Service
 * Handles OAuth token storage with encryption and automatic cleanup
 */

class TokenStorageService {
  constructor() {
    this.storageKey = import.meta.env.VITE_TOKEN_STORAGE_KEY || 'worksync_tokens';
    this.encryptionEnabled = import.meta.env.VITE_TOKEN_ENCRYPTION_ENABLED === 'true';
    this.debugLogging = import.meta.env.VITE_ENABLE_DEBUG_LOGGING === 'true';
    
    // Initialize cleanup on instantiation
    this.cleanupExpiredTokens();
  }

  /**
   * Simple encryption/decryption using base64 encoding
   * Note: This is basic obfuscation, not true encryption
   * For production, consider using Web Crypto API
   */
  encrypt(data) {
    if (!this.encryptionEnabled) return data;
    try {
      return btoa(JSON.stringify(data));
    } catch (error) {
      this.log('Encryption failed:', error);
      return data;
    }
  }

  decrypt(encryptedData) {
    if (!this.encryptionEnabled) return encryptedData;
    try {
      return JSON.parse(atob(encryptedData));
    } catch (error) {
      this.log('Decryption failed:', error);
      return encryptedData;
    }
  }

  /**
   * Store OAuth token with metadata
   */
  storeToken(provider, tokenData) {
    try {
      const tokens = this.getAllTokens();
      
      const tokenInfo = {
        ...tokenData,
        provider,
        storedAt: new Date().toISOString(),
        lastUsed: new Date().toISOString()
      };

      tokens[provider] = tokenInfo;
      
      const dataToStore = this.encrypt(tokens);
      localStorage.setItem(this.storageKey, JSON.stringify(dataToStore));
      
      this.log(`Token stored for provider: ${provider}`);
      return true;
    } catch (error) {
      console.error('Failed to store token:', error);
      return false;
    }
  }

  /**
   * Retrieve OAuth token for a specific provider
   */
  getToken(provider) {
    try {
      const tokens = this.getAllTokens();
      const tokenInfo = tokens[provider];
      
      if (!tokenInfo) {
        this.log(`No token found for provider: ${provider}`);
        return null;
      }

      // Check if token is expired
      if (this.isTokenExpired(tokenInfo)) {
        this.log(`Token expired for provider: ${provider}`);
        this.removeToken(provider);
        return null;
      }

      // Update last used timestamp
      tokenInfo.lastUsed = new Date().toISOString();
      this.storeToken(provider, tokenInfo);

      this.log(`Token retrieved for provider: ${provider}`);
      return tokenInfo;
    } catch (error) {
      console.error('Failed to retrieve token:', error);
      return null;
    }
  }

  /**
   * Remove token for a specific provider
   */
  removeToken(provider) {
    try {
      const tokens = this.getAllTokens();
      delete tokens[provider];
      
      const dataToStore = this.encrypt(tokens);
      localStorage.setItem(this.storageKey, JSON.stringify(dataToStore));
      
      this.log(`Token removed for provider: ${provider}`);
      return true;
    } catch (error) {
      console.error('Failed to remove token:', error);
      return false;
    }
  }

  /**
   * Get all stored tokens
   */
  getAllTokens() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return {};
      
      const parsed = JSON.parse(stored);
      return this.decrypt(parsed) || {};
    } catch (error) {
      console.error('Failed to retrieve all tokens:', error);
      return {};
    }
  }

  /**
   * Clear all stored tokens
   */
  clearAllTokens() {
    try {
      localStorage.removeItem(this.storageKey);
      this.log('All tokens cleared');
      return true;
    } catch (error) {
      console.error('Failed to clear tokens:', error);
      return false;
    }
  }

  /**
   * Check if a token is expired
   */
  isTokenExpired(tokenInfo) {
    if (!tokenInfo || !tokenInfo.expiresAt) {
      return false; // No expiration info, assume valid
    }

    const expirationTime = new Date(tokenInfo.expiresAt);
    const now = new Date();
    const bufferTime = 5 * 60 * 1000; // 5 minutes buffer

    return (expirationTime.getTime() - bufferTime) <= now.getTime();
  }

  /**
   * Check if token needs refresh (within 10 minutes of expiration)
   */
  needsRefresh(tokenInfo) {
    if (!tokenInfo || !tokenInfo.expiresAt) {
      return false;
    }

    const expirationTime = new Date(tokenInfo.expiresAt);
    const now = new Date();
    const refreshBufferTime = 10 * 60 * 1000; // 10 minutes buffer

    return (expirationTime.getTime() - refreshBufferTime) <= now.getTime();
  }

  /**
   * Get token status for UI display
   */
  getTokenStatus(provider) {
    const token = this.getToken(provider);
    
    if (!token) {
      return {
        connected: false,
        authenticated: false,
        expired: false,
        needsRefresh: false,
        expiresAt: null,
        lastUsed: null
      };
    }

    const expired = this.isTokenExpired(token);
    const needsRefresh = this.needsRefresh(token);

    return {
      connected: true,
      authenticated: !expired,
      expired,
      needsRefresh,
      expiresAt: token.expiresAt,
      lastUsed: token.lastUsed,
      storedAt: token.storedAt
    };
  }

  /**
   * Clean up expired tokens
   */
  cleanupExpiredTokens() {
    try {
      const tokens = this.getAllTokens();
      let cleaned = false;

      Object.keys(tokens).forEach(provider => {
        if (this.isTokenExpired(tokens[provider])) {
          delete tokens[provider];
          cleaned = true;
          this.log(`Cleaned up expired token for provider: ${provider}`);
        }
      });

      if (cleaned) {
        const dataToStore = this.encrypt(tokens);
        localStorage.setItem(this.storageKey, JSON.stringify(dataToStore));
      }
    } catch (error) {
      console.error('Failed to cleanup expired tokens:', error);
    }
  }

  /**
   * Get storage statistics
   */
  getStorageStats() {
    const tokens = this.getAllTokens();
    const providers = Object.keys(tokens);
    
    return {
      totalTokens: providers.length,
      providers: providers.map(provider => ({
        provider,
        status: this.getTokenStatus(provider)
      })),
      storageSize: this.getStorageSize(),
      lastCleanup: new Date().toISOString()
    };
  }

  /**
   * Get approximate storage size
   */
  getStorageSize() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      return stored ? stored.length : 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Validate token structure
   */
  validateToken(tokenData) {
    const requiredFields = ['accessToken'];
    const optionalFields = ['refreshToken', 'expiresAt', 'tokenType', 'scope'];
    
    for (const field of requiredFields) {
      if (!tokenData[field]) {
        return {
          valid: false,
          error: `Missing required field: ${field}`
        };
      }
    }

    return { valid: true };
  }

  /**
   * Debug logging
   */
  log(...args) {
    if (this.debugLogging) {
      console.log('[TokenStorage]', ...args);
    }
  }

  /**
   * Create a token refresh callback for automatic token renewal
   */
  createRefreshCallback(provider, refreshFunction) {
    return async () => {
      try {
        const token = this.getToken(provider);
        if (!token || !this.needsRefresh(token)) {
          return token;
        }

        this.log(`Attempting to refresh token for provider: ${provider}`);
        const newToken = await refreshFunction(token.refreshToken);
        
        if (newToken && this.validateToken(newToken).valid) {
          this.storeToken(provider, newToken);
          this.log(`Token successfully refreshed for provider: ${provider}`);
          return newToken;
        } else {
          this.log(`Token refresh failed for provider: ${provider}`);
          this.removeToken(provider);
          return null;
        }
      } catch (error) {
        console.error(`Token refresh error for provider ${provider}:`, error);
        return null;
      }
    };
  }
}

// Create singleton instance
export const tokenStorage = new TokenStorageService();

// Export class for testing
export { TokenStorageService };

// Legacy compatibility exports
export const TokenService = tokenStorage;