/**
 * Frontend rate limiter to coordinate with backend limits.
 * Provides UI feedback and prevents unnecessary requests.
 */

class RateLimiter {
  constructor() {
    this.limits = new Map();
    this.queues = new Map();
    this.monitoring = new Map();
    
    // Rate limit configurations matching backend
    this.configs = {
      jobber: {
        maxRequests: 2500,
        windowMs: 5 * 60 * 1000, // 5 minutes
        warningThreshold: 0.8
      },
      quickbooks: {
        maxRequests: 500,
        windowMs: 60 * 1000, // 1 minute
        warningThreshold: 0.8,
        maxConcurrent: 10
      }
    };
    
    this.initializeServices();
    this.startMonitoring();
  }
  
  initializeServices() {
    Object.keys(this.configs).forEach(service => {
      this.limits.set(service, {
        requests: [],
        concurrentRequests: 0,
        isWarning: false,
        isBlocked: false
      });
      
      this.queues.set(service, []);
    });
  }
  
  /**
   * Checks if a request can proceed immediately.
   * @param {string} service - 'jobber' or 'quickbooks'
   * @param {string} realmId - Optional realm ID for QuickBooks
   * @returns {Promise<boolean>} Whether request can proceed
   */
  async canProceed(service, realmId = null) {
    const config = this.configs[service];
    const limit = this.limits.get(service);
    
    if (!config || !limit) {
      throw new Error(`Unknown service: ${service}`);
    }
    
    // Clean old requests
    this.cleanupOldRequests(service);
    
    // Check rate limit
    if (limit.requests.length >= config.maxRequests) {
      console.warn(`Rate limit reached for ${service}. Queuing request.`);
      return this.queueRequest(service, realmId);
    }
    
    // Check concurrent limit for QuickBooks
    if (service === 'quickbooks' && limit.concurrentRequests >= config.maxConcurrent) {
      console.warn(`Concurrent limit reached for ${service}. Queuing request.`);
      return this.queueRequest(service, realmId);
    }
    
    return true;
  }
  
  /**
   * Records a request start.
   */
  recordRequestStart(service, realmId = null) {
    const limit = this.limits.get(service);
    if (limit) {
      limit.requests.push({
        timestamp: Date.now(),
        realmId
      });
      
      if (service === 'quickbooks') {
        limit.concurrentRequests++;
      }
      
      this.updateWarningStatus(service);
    }
  }
  
  /**
   * Records a request completion.
   */
  recordRequestComplete(service, realmId = null) {
    const limit = this.limits.get(service);
    if (limit && service === 'quickbooks') {
      limit.concurrentRequests = Math.max(0, limit.concurrentRequests - 1);
    }
    
    // Process queue if possible
    this.processQueue(service);
  }
  
  /**
   * Gets current rate limit status for UI display.
   */
  getRateLimitStatus(service) {
    const config = this.configs[service];
    const limit = this.limits.get(service);
    
    if (!config || !limit) {
      return null;
    }
    
    this.cleanupOldRequests(service);
    
    const usage = limit.requests.length / config.maxRequests;
    const timeUntilReset = this.getTimeUntilReset(service);
    
    return {
      service,
      currentRequests: limit.requests.length,
      maxRequests: config.maxRequests,
      usage: Math.round(usage * 100),
      isWarning: limit.isWarning,
      isBlocked: limit.isBlocked,
      timeUntilReset,
      concurrentRequests: limit.concurrentRequests || 0,
      maxConcurrent: config.maxConcurrent || 0,
      queuedRequests: this.queues.get(service)?.length || 0
    };
  }
  
  /**
   * Queues a request when limits are reached.
   */
  async queueRequest(service, realmId) {
    return new Promise((resolve) => {
      const queue = this.queues.get(service);
      queue.push({
        resolve,
        realmId,
        timestamp: Date.now()
      });
      
      console.log(`Request queued for ${service}. Queue length: ${queue.length}`);
    });
  }
  
  /**
   * Processes queued requests when capacity becomes available.
   */
  processQueue(service) {
    const queue = this.queues.get(service);
    const config = this.configs[service];
    const limit = this.limits.get(service);
    
    if (!queue.length) return;
    
    this.cleanupOldRequests(service);
    
    // Check if we can process queued requests
    const canProcessRate = limit.requests.length < config.maxRequests;
    const canProcessConcurrent = service !== 'quickbooks' || 
                                limit.concurrentRequests < config.maxConcurrent;
    
    if (canProcessRate && canProcessConcurrent) {
      const queuedRequest = queue.shift();
      if (queuedRequest) {
        console.log(`Processing queued request for ${service}. Queue length: ${queue.length}`);
        queuedRequest.resolve(true);
      }
    }
  }
  
  /**
   * Cleans up old requests outside the rate limit window.
   */
  cleanupOldRequests(service) {
    const config = this.configs[service];
    const limit = this.limits.get(service);
    const cutoffTime = Date.now() - config.windowMs;
    
    limit.requests = limit.requests.filter(req => req.timestamp > cutoffTime);
    this.updateWarningStatus(service);
  }
  
  /**
   * Updates warning status based on current usage.
   */
  updateWarningStatus(service) {
    const config = this.configs[service];
    const limit = this.limits.get(service);
    const usage = limit.requests.length / config.maxRequests;
    
    limit.isWarning = usage >= config.warningThreshold;
    limit.isBlocked = usage >= 1.0;
  }
  
  /**
   * Gets time until rate limit resets.
   */
  getTimeUntilReset(service) {
    const config = this.configs[service];
    const limit = this.limits.get(service);
    
    if (!limit.requests.length) return 0;
    
    const oldestRequest = Math.min(...limit.requests.map(r => r.timestamp));
    const resetTime = oldestRequest + config.windowMs;
    
    return Math.max(0, resetTime - Date.now());
  }
  
  /**
   * Starts background monitoring and cleanup.
   */
  startMonitoring() {
    setInterval(() => {
      Object.keys(this.configs).forEach(service => {
        this.cleanupOldRequests(service);
        this.processQueue(service);
      });
    }, 30000); // Every 30 seconds
  }
  
  /**
   * Gets all rate limit statuses for dashboard.
   */
  getAllStatuses() {
    return Object.keys(this.configs).map(service => 
      this.getRateLimitStatus(service)
    );
  }
  
  /**
   * Manually resets rate limits (for testing/admin).
   */
  reset(service = null) {
    if (service) {
      const limit = this.limits.get(service);
      if (limit) {
        limit.requests = [];
        limit.concurrentRequests = 0;
        limit.isWarning = false;
        limit.isBlocked = false;
        this.queues.set(service, []);
      }
    } else {
      this.initializeServices();
    }
  }
}

// Export singleton instance
export const rateLimiter = new RateLimiter();

// React hook for rate limit status
export function useRateLimitStatus(service) {
  const [status, setStatus] = React.useState(null);
  
  React.useEffect(() => {
    const updateStatus = () => {
      setStatus(rateLimiter.getRateLimitStatus(service));
    };
    
    updateStatus();
    const interval = setInterval(updateStatus, 5000); // Update every 5 seconds
    
    return () => clearInterval(interval);
  }, [service]);
  
  return status;
}

// Rate limit status component
export function RateLimitIndicator({ service }) {
  const status = useRateLimitStatus(service);
  
  if (!status) return null;
  
  const getStatusColor = () => {
    if (status.isBlocked) return 'red';
    if (status.isWarning) return 'orange';
    return 'green';
  };
  
  const formatTime = (ms) => {
    if (ms < 60000) return `${Math.ceil(ms / 1000)}s`;
    return `${Math.ceil(ms / 60000)}m`;
  };
  
  return (
    <div className={`rate-limit-indicator ${getStatusColor()}`}>
      <div className="service-name">{service.toUpperCase()}</div>
      <div className="usage">
        {status.currentRequests}/{status.maxRequests} ({status.usage}%)
      </div>
      {status.concurrentRequests > 0 && (
        <div className="concurrent">
          Concurrent: {status.concurrentRequests}/{status.maxConcurrent}
        </div>
      )}
      {status.queuedRequests > 0 && (
        <div className="queued">Queued: {status.queuedRequests}</div>
      )}
      {status.timeUntilReset > 0 && (
        <div className="reset">Resets in {formatTime(status.timeUntilReset)}</div>
      )}
    </div>
  );
}

export default rateLimiter;
