const express = require('express');
const { auth } = require('../middleware/auth');
const performanceMonitor = require('../services/performanceMonitor');

const router = express.Router();

// @route   GET /api/performance/stats
// @desc    Get performance statistics
// @access  Admin only
router.get('/stats', auth, async (req, res) => {
  try {
    // Only allow admins to access performance data
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    const stats = performanceMonitor.getStats();
    const recommendations = performanceMonitor.getRecommendations();

    res.json({
      stats,
      recommendations,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Performance stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/performance/reset
// @desc    Reset performance metrics
// @access  Admin only
router.post('/reset', auth, async (req, res) => {
  try {
    // Only allow admins to reset performance data
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    performanceMonitor.reset();
    
    res.json({
      message: 'Performance metrics reset successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Performance reset error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/performance/health
// @desc    Get system health check
// @access  Private
router.get('/health', auth, async (req, res) => {
  try {
    const stats = performanceMonitor.getStats();
    const recommendations = performanceMonitor.getRecommendations();
    
    // Determine overall health status
    let healthStatus = 'healthy';
    let issues = [];

    // Check for critical issues
    if (stats.errors.length > 10) {
      healthStatus = 'critical';
      issues.push(`High error rate: ${stats.errors.length} errors in recent history`);
    }

    if (stats.slowQueries.length > 5) {
      healthStatus = healthStatus === 'critical' ? 'critical' : 'warning';
      issues.push(`Multiple slow queries detected: ${stats.slowQueries.length} slow queries`);
    }

    const slowApis = stats.apiCalls.filter(api => api.avgDuration > 500);
    if (slowApis.length > 0) {
      healthStatus = healthStatus === 'critical' ? 'critical' : 'warning';
      issues.push(`Slow API endpoints: ${slowApis.length} endpoints with >500ms avg response time`);
    }

    res.json({
      status: healthStatus,
      issues,
      summary: {
        uptime: stats.uptime.formatted,
        totalApiCalls: stats.summary.totalApiCalls,
        avgResponseTime: Math.round(stats.summary.avgApiResponseTime),
        errorRate: stats.summary.totalApiCalls > 0 
          ? Math.round((stats.summary.errorCount / stats.summary.totalApiCalls) * 100 * 100) / 100 
          : 0
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
