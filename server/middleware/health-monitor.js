// Comprehensive Health Monitoring System for Multi-User CRM
const os = require('os');
const { healthCheck: dbHealthCheck } = require('../config/database-pool');
const cacheManager = require('../config/redis-cache');

class HealthMonitor {
  constructor() {
    this.metrics = {
      system: {},
      database: {},
      cache: {},
      application: {},
      users: {}
    };

    this.alerts = [];
    this.thresholds = {
      cpu: 80,           // CPU usage %
      memory: 85,        // Memory usage %
      disk: 90,          // Disk usage %
      responseTime: 2000, // Response time ms
      errorRate: 5,      // Error rate %
      activeUsers: 1000  // Max concurrent users
    };

    this.startMonitoring();
  }

  // Start continuous monitoring
  startMonitoring() {
    // System metrics every 30 seconds
    setInterval(() => {
      this.collectSystemMetrics();
    }, 30000);

    // Application metrics every minute
    setInterval(() => {
      this.collectApplicationMetrics();
    }, 60000);

    // Health check every 5 minutes
    setInterval(() => {
      this.performHealthCheck();
    }, 300000);
  }

  // Collect system performance metrics
  collectSystemMetrics() {
    const metrics = {
      timestamp: Date.now(),
      cpu: {
        usage: this.getCpuUsage(),
        loadAverage: os.loadavg(),
        cores: os.cpus().length
      },
      memory: {
        total: os.totalmem(),
        used: os.totalmem() - os.freemem(),
        free: os.freemem(),
        usage: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100
      },
      disk: this.getDiskUsage(),
      network: {
        interfaces: os.networkInterfaces()
      },
      uptime: os.uptime()
    };

    this.metrics.system = metrics;

    // Check for alerts
    this.checkSystemAlerts(metrics);

    return metrics;
  }

  // Get CPU usage percentage
  getCpuUsage() {
    const cpus = os.cpus();
    const usage = cpus.map(cpu => {
      const total = Object.values(cpu.times).reduce((acc, val) => acc + val, 0);
      const idle = cpu.times.idle;
      return ((total - idle) / total) * 100;
    });

    return {
      average: usage.reduce((acc, val) => acc + val, 0) / usage.length,
      cores: usage
    };
  }

  // Get disk usage (Node.js approximation)
  getDiskUsage() {
    try {
      const fs = require('fs');
      const stats = fs.statSync(process.cwd());

      return {
        total: stats.size || 0,
        used: 0, // Would need platform-specific implementation
        free: 0,
        usage: 0
      };
    } catch (error) {
      return { error: 'Unable to get disk usage' };
    }
  }

  // Collect application-specific metrics
  async collectApplicationMetrics() {
    const metrics = {
      timestamp: Date.now(),
      database: await this.getDatabaseMetrics(),
      cache: await this.getCacheMetrics(),
      activeUsers: await this.getActiveUserCount(),
      requestStats: this.getRequestStats(),
      errorStats: this.getErrorStats(),
      memoryHeap: process.memoryUsage()
    };

    this.metrics.application = metrics;

    // Check for application alerts
    this.checkApplicationAlerts(metrics);

    return metrics;
  }

  // Get database performance metrics
  async getDatabaseMetrics() {
    try {
      const dbHealth = await dbHealthCheck();

      return {
        status: dbHealth.status,
        responseTime: dbHealth.responseTime,
        pool: dbHealth.pool,
        queries: dbHealth.metrics || {}
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  // Get cache performance metrics
  async getCacheMetrics() {
    try {
      return cacheManager.getStats();
    } catch (error) {
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  // Get active user count
  async getActiveUserCount() {
    try {
      // Count active sessions (last 30 minutes)
      const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);

      const activeUsers = await cacheManager.redis?.eval(`
        local keys = redis.call('KEYS', 'crm:session:*')
        local count = 0
        for i=1,#keys do
          local session = redis.call('GET', keys[i])
          if session then
            local data = cjson.decode(session)
            if data.lastActivity and data.lastActivity > ARGV[1] then
              count = count + 1
            end
          end
        end
        return count
      `, 0, thirtyMinutesAgo);

      return activeUsers || 0;
    } catch (error) {
      return 0;
    }
  }

  // Get request statistics
  getRequestStats() {
    // This would be populated by request middleware
    return global.requestStats || {
      total: 0,
      successful: 0,
      failed: 0,
      averageResponseTime: 0,
      lastMinute: 0
    };
  }

  // Get error statistics
  getErrorStats() {
    return global.errorStats || {
      total: 0,
      rate: 0,
      byType: {},
      recent: []
    };
  }

  // Check for system-level alerts
  checkSystemAlerts(metrics) {
    const alerts = [];

    // CPU usage alert
    if (metrics.cpu.usage.average > this.thresholds.cpu) {
      alerts.push({
        type: 'cpu',
        level: 'warning',
        message: `High CPU usage: ${metrics.cpu.usage.average.toFixed(2)}%`,
        value: metrics.cpu.usage.average,
        threshold: this.thresholds.cpu
      });
    }

    // Memory usage alert
    if (metrics.memory.usage > this.thresholds.memory) {
      alerts.push({
        type: 'memory',
        level: 'warning',
        message: `High memory usage: ${metrics.memory.usage.toFixed(2)}%`,
        value: metrics.memory.usage,
        threshold: this.thresholds.memory
      });
    }

    // Process alerts
    if (alerts.length > 0) {
      this.processAlerts(alerts);
    }
  }

  // Check for application-level alerts
  checkApplicationAlerts(metrics) {
    const alerts = [];

    // Database response time alert
    if (metrics.database.responseTime > this.thresholds.responseTime) {
      alerts.push({
        type: 'database',
        level: 'warning',
        message: `Slow database response: ${metrics.database.responseTime}ms`,
        value: metrics.database.responseTime,
        threshold: this.thresholds.responseTime
      });
    }

    // High error rate alert
    const errorRate = metrics.errorStats?.rate || 0;
    if (errorRate > this.thresholds.errorRate) {
      alerts.push({
        type: 'errors',
        level: 'critical',
        message: `High error rate: ${errorRate}%`,
        value: errorRate,
        threshold: this.thresholds.errorRate
      });
    }

    // Too many active users alert
    if (metrics.activeUsers > this.thresholds.activeUsers) {
      alerts.push({
        type: 'users',
        level: 'info',
        message: `High user activity: ${metrics.activeUsers} active users`,
        value: metrics.activeUsers,
        threshold: this.thresholds.activeUsers
      });
    }

    // Process alerts
    if (alerts.length > 0) {
      this.processAlerts(alerts);
    }
  }

  // Process and store alerts
  processAlerts(alerts) {
    const timestamp = Date.now();

    alerts.forEach(alert => {
      const alertWithTimestamp = {
        ...alert,
        timestamp,
        id: `${alert.type}-${timestamp}`
      };

      this.alerts.push(alertWithTimestamp);

      // Log alert
      console.warn(`🚨 ALERT [${alert.level.toUpperCase()}]: ${alert.message}`);

      // Send notifications (implement based on your needs)
      this.sendAlert(alertWithTimestamp);
    });

    // Keep only last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }
  }

  // Send alert notifications
  async sendAlert(alert) {
    try {
      // Store in cache for dashboard
      await cacheManager.set(`alert:${alert.id}`, alert, 86400); // 24 hours

      // Send to monitoring service (implement based on your setup)
      if (process.env.MONITORING_WEBHOOK) {
        // Example: Send to Slack, Discord, etc.
        const response = await fetch(process.env.MONITORING_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `CRM Alert: ${alert.message}`,
            level: alert.level,
            timestamp: alert.timestamp
          })
        });
      }

      // Email notifications for critical alerts
      if (alert.level === 'critical' && process.env.ALERT_EMAIL) {
        // Implement email notification
        console.log('Would send critical alert email:', alert.message);
      }
    } catch (error) {
      console.error('Failed to send alert:', error);
    }
  }

  // Perform comprehensive health check
  async performHealthCheck() {
    console.log('🏥 Performing health check...');

    const health = {
      timestamp: Date.now(),
      overall: 'healthy',
      services: {}
    };

    try {
      // Database health
      const dbHealth = await dbHealthCheck();
      health.services.database = {
        status: dbHealth.status,
        responseTime: dbHealth.responseTime
      };

      // Cache health
      const cacheStats = cacheManager.getStats();
      health.services.cache = {
        status: cacheStats.connected ? 'healthy' : 'unhealthy',
        hitRate: cacheStats.hitRate
      };

      // System health
      const systemMetrics = this.collectSystemMetrics();
      health.services.system = {
        status: systemMetrics.cpu.usage.average < 90 && systemMetrics.memory.usage < 90 ? 'healthy' : 'degraded',
        cpu: systemMetrics.cpu.usage.average,
        memory: systemMetrics.memory.usage
      };

      // Overall health determination
      const serviceStatuses = Object.values(health.services).map(s => s.status);
      if (serviceStatuses.includes('unhealthy')) {
        health.overall = 'unhealthy';
      } else if (serviceStatuses.includes('degraded')) {
        health.overall = 'degraded';
      }

      console.log(`🏥 Health check complete: ${health.overall}`);

      // Store health status
      await cacheManager.set('system:health', health, 300); // 5 minutes

      return health;

    } catch (error) {
      console.error('Health check failed:', error);
      health.overall = 'unhealthy';
      health.error = error.message;

      return health;
    }
  }

  // Get health status for API endpoint
  async getHealthStatus() {
    const cached = await cacheManager.get('system:health');
    if (cached) return cached;

    return this.performHealthCheck();
  }

  // Get metrics for dashboard
  getMetricsSummary() {
    return {
      system: this.metrics.system,
      application: this.metrics.application,
      alerts: this.alerts.slice(-10), // Last 10 alerts
      timestamp: Date.now()
    };
  }

  // Cleanup old data
  cleanup() {
    // Remove old alerts
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    this.alerts = this.alerts.filter(alert => alert.timestamp > oneWeekAgo);
  }
}

// Singleton instance
const healthMonitor = new HealthMonitor();

// Express middleware for request tracking
const requestTracker = (req, res, next) => {
  const startTime = Date.now();

  // Initialize global stats if not exists
  if (!global.requestStats) {
    global.requestStats = {
      total: 0,
      successful: 0,
      failed: 0,
      averageResponseTime: 0,
      lastMinute: 0,
      responseTimes: []
    };
  }

  // Track request completion
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    const stats = global.requestStats;

    stats.total++;
    stats.responseTimes.push(responseTime);

    // Keep only last 1000 response times
    if (stats.responseTimes.length > 1000) {
      stats.responseTimes.shift();
    }

    // Calculate average
    stats.averageResponseTime = stats.responseTimes.reduce((a, b) => a + b, 0) / stats.responseTimes.length;

    // Track success/failure
    if (res.statusCode < 400) {
      stats.successful++;
    } else {
      stats.failed++;
    }
  });

  next();
};

// Express middleware for error tracking
const errorTracker = (err, req, res, next) => {
  if (!global.errorStats) {
    global.errorStats = {
      total: 0,
      rate: 0,
      byType: {},
      recent: []
    };
  }

  const errorStats = global.errorStats;
  const errorType = err.name || 'UnknownError';

  errorStats.total++;
  errorStats.byType[errorType] = (errorStats.byType[errorType] || 0) + 1;
  errorStats.recent.push({
    type: errorType,
    message: err.message,
    timestamp: Date.now(),
    url: req.url,
    method: req.method
  });

  // Keep only last 50 errors
  if (errorStats.recent.length > 50) {
    errorStats.recent.shift();
  }

  // Calculate error rate
  const totalRequests = global.requestStats?.total || 1;
  errorStats.rate = (errorStats.total / totalRequests) * 100;

  next(err);
};

module.exports = {
  healthMonitor,
  requestTracker,
  errorTracker
};