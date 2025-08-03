/**
 * Frontend webhook processor for real-time updates.
 * Handles WebSocket connections and polling for webhook status.
 */

import { eventBus } from './eventBus';
import { apiService } from './api';

class WebhookProcessor {
  constructor() {
    this.websocket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // Start with 1 second
    this.pollingInterval = null;
    this.webhookStats = null;
    this.listeners = new Map();
    
    this.initializeConnection();
    this.startStatsPolling();
  }
  
  /**
   * Initializes WebSocket connection for real-time updates.
   */
  initializeConnection() {
    const wsUrl = `${import.meta.env.VITE_WS_URL || 'ws://localhost:8080'}/ws/webhooks`;
    
    try {
      this.websocket = new WebSocket(wsUrl);
      
      this.websocket.onopen = () => {
        console.log('WebSocket connected for webhook updates');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        
        // Notify listeners
        this.emit('connected');
      };
      
      this.websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleWebhookUpdate(data);
        } catch (error) {
          console.error('Error parsing webhook message:', error);
        }
      };
      
      this.websocket.onclose = () => {
        console.log('WebSocket disconnected');
        this.isConnected = false;
        this.emit('disconnected');
        
        // Attempt reconnection if not intentionally closed
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };
      
      this.websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.emit('error', error);
      };
      
    } catch (error) {
      console.error('Failed to initialize WebSocket:', error);
      // Fall back to polling only
      this.startPollingFallback();
    }
  }
  
  /**
   * Handles incoming webhook updates from WebSocket.
   */
  handleWebhookUpdate(data) {
    console.log('Received webhook update:', data);
    
    switch (data.type) {
      case 'webhook_processed':
        this.handleWebhookProcessed(data.payload);
        break;
      case 'webhook_failed':
        this.handleWebhookFailed(data.payload);
        break;
      case 'sync_status_update':
        this.handleSyncStatusUpdate(data.payload);
        break;
      case 'stats_update':
        this.handleStatsUpdate(data.payload);
        break;
      default:
        console.log('Unknown webhook update type:', data.type);
    }
  }
  
  /**
   * Handles successful webhook processing notification.
   */
  handleWebhookProcessed(payload) {
    const { correlationId, eventType, service, processingTime } = payload;
    
    console.log(`Webhook processed: ${service}.${eventType} (${processingTime}ms)`);
    
    this.emit('webhook_processed', {
      correlationId,
      eventType,
      service,
      processingTime,
      timestamp: new Date()
    });
    
    // Update UI with success notification
    this.showNotification({
      type: 'success',
      title: 'Sync Complete',
      message: `${service} ${eventType} processed successfully`,
      duration: 3000
    });
  }
  
  /**
   * Handles failed webhook processing notification.
   */
  handleWebhookFailed(payload) {
    const { correlationId, eventType, service, error } = payload;
    
    console.error(`Webhook failed: ${service}.${eventType} - ${error}`);
    
    this.emit('webhook_failed', {
      correlationId,
      eventType,
      service,
      error,
      timestamp: new Date()
    });
    
    // Update UI with error notification
    this.showNotification({
      type: 'error',
      title: 'Sync Failed',
      message: `${service} ${eventType} failed: ${error}`,
      duration: 5000,
      action: {
        label: 'Retry',
        callback: () => this.retryWebhook(correlationId)
      }
    });
  }
  
  /**
   * Handles sync status updates.
   */
  handleSyncStatusUpdate(payload) {
    const { syncId, status, progress, details } = payload;
    
    this.emit('sync_status_update', {
      syncId,
      status,
      progress,
      details,
      timestamp: new Date()
    });
    
    // Update progress indicators in UI
    if (status === 'completed') {
      this.showNotification({
        type: 'success',
        title: 'Sync Complete',
        message: `${details.itemsProcessed} items synchronized`,
        duration: 3000
      });
    }
  }
  
  /**
   * Handles webhook statistics updates.
   */
  handleStatsUpdate(payload) {
    this.webhookStats = {
      ...payload,
      lastUpdated: new Date()
    };
    
    this.emit('stats_updated', this.webhookStats);
  }
  
  /**
   * Starts polling for webhook statistics as fallback.
   */
  startStatsPolling() {
    this.pollingInterval = setInterval(async () => {
      try {
        const stats = await apiService.get('/api/webhooks/stats');
        if (stats && !this.isConnected) {
          // Only use polling data if WebSocket is not connected
          this.handleStatsUpdate(stats);
        }
      } catch (error) {
        console.error('Error polling webhook stats:', error);
      }
    }, 30000); // Poll every 30 seconds
  }
  
  /**
   * Starts polling fallback when WebSocket fails.
   */
  startPollingFallback() {
    console.log('Starting polling fallback for webhook updates');
    
    // More frequent polling when WebSocket is unavailable
    this.pollingInterval = setInterval(async () => {
      try {
        const stats = await apiService.get('/api/webhooks/stats');
        this.handleStatsUpdate(stats);
        
        // Check for recent webhook activity
        // This would require backend endpoint for recent webhooks
        // const recentWebhooks = await apiService.get('/api/webhooks/recent');
        // this.handleRecentWebhooks(recentWebhooks);
        
      } catch (error) {
        console.error('Error in polling fallback:', error);
      }
    }, 10000); // Poll every 10 seconds
  }
  
  /**
   * Schedules WebSocket reconnection with exponential backoff.
   */
  scheduleReconnect() {
    this.reconnectAttempts++;
    
    console.log(`Scheduling WebSocket reconnection attempt ${this.reconnectAttempts} in ${this.reconnectDelay}ms`);
    
    setTimeout(() => {
      this.initializeConnection();
    }, this.reconnectDelay);
    
    // Exponential backoff with jitter
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2 + Math.random() * 1000,
      30000 // Max 30 seconds
    );
  }
  
  /**
   * Manually retries a failed webhook.
   */
  async retryWebhook(correlationId) {
    try {
      const response = await apiService.post(`/api/webhooks/reprocess/${correlationId}`);
      
      this.showNotification({
        type: 'info',
        title: 'Retry Initiated',
        message: 'Webhook queued for reprocessing',
        duration: 3000
      });
      
      return response;
    } catch (error) {
      console.error('Error retrying webhook:', error);
      
      this.showNotification({
        type: 'error',
        title: 'Retry Failed',
        message: 'Failed to retry webhook processing',
        duration: 3000
      });
      
      throw error;
    }
  }
  
  /**
   * Gets current webhook statistics.
   */
  getStats() {
    return this.webhookStats;
  }
  
  /**
   * Checks WebSocket connection status.
   */
  isWebSocketConnected() {
    return this.isConnected;
  }
  
  /**
   * Adds event listener for webhook events.
   */
  addEventListener(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }
  
  /**
   * Removes event listener.
   */
  removeEventListener(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }
  
  /**
   * Emits event to all listeners.
   */
  emit(event, data = null) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in webhook event listener for ${event}:`, error);
        }
      });
    }
    
    // Also emit to global event bus
    eventBus.emit(`webhook_${event}`, data);
  }
  
  /**
   * Shows notification to user.
   */
  showNotification(notification) {
    // This would integrate with your notification system
    eventBus.emit('show_notification', notification);
  }
  
  /**
   * Cleans up resources.
   */
  disconnect() {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
    
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    
    this.listeners.clear();
  }
}

// React hook for webhook status
export function useWebhookStatus() {
  const [stats, setStats] = React.useState(null);
  const [isConnected, setIsConnected] = React.useState(false);
  const [recentEvents, setRecentEvents] = React.useState([]);
  
  React.useEffect(() => {
    const handleStatsUpdate = (newStats) => {
      setStats(newStats);
    };
    
    const handleConnected = () => {
      setIsConnected(true);
    };
    
    const handleDisconnected = () => {
      setIsConnected(false);
    };
    
    const handleWebhookProcessed = (event) => {
      setRecentEvents(prev => [event, ...prev.slice(0, 9)]); // Keep last 10 events
    };
    
    const handleWebhookFailed = (event) => {
      setRecentEvents(prev => [{ ...event, failed: true }, ...prev.slice(0, 9)]);
    };
    
    webhookProcessor.addEventListener('stats_updated', handleStatsUpdate);
    webhookProcessor.addEventListener('connected', handleConnected);
    webhookProcessor.addEventListener('disconnected', handleDisconnected);
    webhookProcessor.addEventListener('webhook_processed', handleWebhookProcessed);
    webhookProcessor.addEventListener('webhook_failed', handleWebhookFailed);
    
    // Initial state
    setStats(webhookProcessor.getStats());
    setIsConnected(webhookProcessor.isWebSocketConnected());
    
    return () => {
      webhookProcessor.removeEventListener('stats_updated', handleStatsUpdate);
      webhookProcessor.removeEventListener('connected', handleConnected);
      webhookProcessor.removeEventListener('disconnected', handleDisconnected);
      webhookProcessor.removeEventListener('webhook_processed', handleWebhookProcessed);
      webhookProcessor.removeEventListener('webhook_failed', handleWebhookFailed);
    };
  }, []);
  
  return {
    stats,
    isConnected,
    recentEvents,
    retryWebhook: webhookProcessor.retryWebhook.bind(webhookProcessor)
  };
}

// Webhook status dashboard component
export function WebhookStatusDashboard() {
  const { stats, isConnected, recentEvents, retryWebhook } = useWebhookStatus();
  
  if (!stats) {
    return <div>Loading webhook status...</div>;
  }
  
  return (
    <div className="webhook-dashboard">
      <div className="connection-status">
        <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
          {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
        </span>
      </div>
      
      <div className="webhook-stats">
        <div className="stat-card">
          <h3>Total Webhooks</h3>
          <p>{stats.totalWebhooks}</p>
        </div>
        <div className="stat-card">
          <h3>Success Rate</h3>
          <p>{stats.successRate?.toFixed(1)}%</p>
        </div>
        <div className="stat-card">
          <h3>Failed</h3>
          <p>{stats.failedWebhooks}</p>
        </div>
      </div>
      
      <div className="recent-events">
        <h3>Recent Events</h3>
        {recentEvents.map((event, index) => (
          <div key={index} className={`event-item ${event.failed ? 'failed' : 'success'}`}>
            <span className="service">{event.service}</span>
            <span className="event-type">{event.eventType}</span>
            <span className="timestamp">{event.timestamp.toLocaleTimeString()}</span>
            {event.failed && (
              <button 
                onClick={() => retryWebhook(event.correlationId)}
                className="retry-button"
              >
                Retry
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Export singleton instance
export const webhookProcessor = new WebhookProcessor();
export default webhookProcessor;
