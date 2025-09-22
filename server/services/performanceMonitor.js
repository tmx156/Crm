const Database = require('better-sqlite3');
const path = require('path');

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      queries: new Map(),
      apiCalls: new Map(),
      slowQueries: [],
      errors: []
    };
    this.startTime = Date.now();
  }

  /**
   * Start timing a database query
   * @param {string} query - SQL query being executed
   * @returns {string} - Unique ID for this query
   */
  startQuery(query) {
    const queryId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.metrics.queries.set(queryId, {
      query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
      startTime: Date.now(),
      endTime: null,
      duration: null
    });
    return queryId;
  }

  /**
   * End timing a database query
   * @param {string} queryId - Query ID from startQuery
   * @param {Error} error - Any error that occurred
   */
  endQuery(queryId, error = null) {
    const query = this.metrics.queries.get(queryId);
    if (query) {
      query.endTime = Date.now();
      query.duration = query.endTime - query.startTime;
      query.error = error;

      // Track slow queries (>100ms)
      if (query.duration > 100) {
        this.metrics.slowQueries.push({
          ...query,
          timestamp: new Date().toISOString()
        });

        // Keep only last 100 slow queries
        if (this.metrics.slowQueries.length > 100) {
          this.metrics.slowQueries = this.metrics.slowQueries.slice(-100);
        }

        console.warn(`🐌 Slow query detected (${query.duration}ms): ${query.query}`);
      }

      this.metrics.queries.delete(queryId);
    }
  }

  /**
   * Track API call performance
   * @param {string} endpoint - API endpoint
   * @param {number} duration - Response time in ms
   * @param {number} statusCode - HTTP status code
   */
  trackApiCall(endpoint, duration, statusCode) {
    if (!this.metrics.apiCalls.has(endpoint)) {
      this.metrics.apiCalls.set(endpoint, {
        count: 0,
        totalDuration: 0,
        avgDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        errorCount: 0,
        lastCall: null
      });
    }

    const stats = this.metrics.apiCalls.get(endpoint);
    stats.count++;
    stats.totalDuration += duration;
    stats.avgDuration = stats.totalDuration / stats.count;
    stats.minDuration = Math.min(stats.minDuration, duration);
    stats.maxDuration = Math.max(stats.maxDuration, duration);
    stats.lastCall = new Date().toISOString();

    if (statusCode >= 400) {
      stats.errorCount++;
    }

    // Log slow API calls
    if (duration > 500) {
      console.warn(`🐌 Slow API call detected (${duration}ms): ${endpoint}`);
    }
  }

  /**
   * Track error
   * @param {Error} error - Error object
   * @param {string} context - Context where error occurred
   */
  trackError(error, context) {
    this.metrics.errors.push({
      message: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString()
    });

    // Keep only last 100 errors
    if (this.metrics.errors.length > 100) {
      this.metrics.errors = this.metrics.errors.slice(-100);
    }
  }

  /**
   * Get performance statistics
   * @returns {Object} - Performance metrics
   */
  getStats() {
    const uptime = Date.now() - this.startTime;
    const apiStats = Array.from(this.metrics.apiCalls.entries()).map(([endpoint, stats]) => ({
      endpoint,
      ...stats
    }));

    return {
      uptime: {
        total: uptime,
        formatted: this.formatDuration(uptime)
      },
      apiCalls: apiStats,
      slowQueries: this.metrics.slowQueries.slice(-10), // Last 10 slow queries
      errors: this.metrics.errors.slice(-10), // Last 10 errors
      summary: {
        totalApiCalls: apiStats.reduce((sum, stat) => sum + stat.count, 0),
        avgApiResponseTime: apiStats.length > 0 
          ? apiStats.reduce((sum, stat) => sum + stat.avgDuration, 0) / apiStats.length 
          : 0,
        slowQueryCount: this.metrics.slowQueries.length,
        errorCount: this.metrics.errors.length
      }
    };
  }

  /**
   * Format duration in human readable format
   * @param {number} ms - Duration in milliseconds
   * @returns {string} - Formatted duration
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    if (seconds > 0) return `${seconds}s`;
    return `${ms}ms`;
  }

  /**
   * Get database performance recommendations
   * @returns {Array} - Array of recommendations
   */
  getRecommendations() {
    const recommendations = [];
    const stats = this.getStats();

    // Check for slow queries
    if (stats.slowQueries.length > 0) {
      const avgSlowQueryTime = stats.slowQueries.reduce((sum, q) => sum + q.duration, 0) / stats.slowQueries.length;
      recommendations.push({
        type: 'slow_queries',
        severity: 'high',
        message: `${stats.slowQueries.length} slow queries detected (avg: ${Math.round(avgSlowQueryTime)}ms)`,
        action: 'Consider adding database indexes or optimizing query patterns'
      });
    }

    // Check for slow API calls
    const slowApis = stats.apiCalls.filter(api => api.avgDuration > 200);
    if (slowApis.length > 0) {
      recommendations.push({
        type: 'slow_apis',
        severity: 'medium',
        message: `${slowApis.length} slow API endpoints detected`,
        action: 'Consider implementing caching or query optimization',
        details: slowApis.map(api => `${api.endpoint}: ${Math.round(api.avgDuration)}ms avg`)
      });
    }

    // Check for high error rates
    const highErrorApis = stats.apiCalls.filter(api => api.errorCount > 0 && (api.errorCount / api.count) > 0.1);
    if (highErrorApis.length > 0) {
      recommendations.push({
        type: 'high_errors',
        severity: 'high',
        message: `${highErrorApis.length} APIs with high error rates`,
        action: 'Investigate and fix error patterns',
        details: highErrorApis.map(api => `${api.endpoint}: ${api.errorCount}/${api.count} errors`)
      });
    }

    return recommendations;
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics = {
      queries: new Map(),
      apiCalls: new Map(),
      slowQueries: [],
      errors: []
    };
    this.startTime = Date.now();
  }
}

module.exports = new PerformanceMonitor();
