// Advanced Performance Monitoring for Calendar
class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.observers = {};
    this.setupObservers();
  }

  // Setup performance observers
  setupObservers() {
    // Long Task API - detect blocking operations
    if ('PerformanceObserver' in window) {
      try {
        const longTaskObserver = new PerformanceObserver(entries => {
          entries.getEntries().forEach(entry => {
            console.warn(`🐌 Long task detected: ${Math.round(entry.duration)}ms`);
            this.recordMetric('longTask', {
              duration: entry.duration,
              startTime: entry.startTime,
              name: entry.name
            });
          });
        });
        longTaskObserver.observe({ entryTypes: ['longtask'] });
        this.observers.longTask = longTaskObserver;
      } catch (e) {
        console.log('Long task observer not supported');
      }

      // Layout Shift API - detect visual stability issues
      try {
        const clsObserver = new PerformanceObserver(entries => {
          entries.getEntries().forEach(entry => {
            if (entry.hadRecentInput) return; // Ignore user-initiated shifts

            console.warn(`📐 Layout shift detected: ${entry.value.toFixed(4)}`);
            this.recordMetric('layoutShift', {
              value: entry.value,
              startTime: entry.startTime,
              sources: entry.sources
            });
          });
        });
        clsObserver.observe({ entryTypes: ['layout-shift'] });
        this.observers.layoutShift = clsObserver;
      } catch (e) {
        console.log('Layout shift observer not supported');
      }

      // Largest Contentful Paint
      try {
        const lcpObserver = new PerformanceObserver(entries => {
          const lastEntry = entries.getEntries().pop();
          if (lastEntry) {
            console.log(`🎯 LCP: ${Math.round(lastEntry.startTime)}ms`);
            this.recordMetric('lcp', {
              duration: lastEntry.startTime,
              element: lastEntry.element?.tagName || 'unknown'
            });
          }
        });
        lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
        this.observers.lcp = lcpObserver;
      } catch (e) {
        console.log('LCP observer not supported');
      }
    }

    // Memory monitoring (if available)
    if ('memory' in performance) {
      this.startMemoryMonitoring();
    }
  }

  // Record performance metric
  recordMetric(name, data) {
    const timestamp = Date.now();
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    this.metrics.get(name).push({
      ...data,
      timestamp
    });

    // Keep only last 100 entries per metric
    const entries = this.metrics.get(name);
    if (entries.length > 100) {
      entries.splice(0, entries.length - 100);
    }

    // Emit to analytics if configured
    this.sendToAnalytics(name, data);
  }

  // Monitor calendar-specific operations
  measureCalendarOperation(name, operation) {
    return new Promise((resolve, reject) => {
      const startTime = performance.now();
      const startMark = `${name}-start`;
      const endMark = `${name}-end`;

      performance.mark(startMark);

      Promise.resolve(operation())
        .then(result => {
          performance.mark(endMark);
          performance.measure(name, startMark, endMark);

          const duration = performance.now() - startTime;
          console.log(`⚡ ${name}: ${Math.round(duration)}ms`);

          this.recordMetric('calendarOperation', {
            name,
            duration,
            success: true
          });

          resolve(result);
        })
        .catch(error => {
          const duration = performance.now() - startTime;
          console.error(`❌ ${name} failed: ${Math.round(duration)}ms`, error);

          this.recordMetric('calendarOperation', {
            name,
            duration,
            success: false,
            error: error.message
          });

          reject(error);
        });
    });
  }

  // Memory monitoring
  startMemoryMonitoring() {
    setInterval(() => {
      if ('memory' in performance) {
        const memory = performance.memory;
        this.recordMetric('memory', {
          used: memory.usedJSHeapSize,
          total: memory.totalJSHeapSize,
          limit: memory.jsHeapSizeLimit
        });

        // Warn if memory usage is high
        const usagePercent = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;
        if (usagePercent > 75) {
          console.warn(`🧠 High memory usage: ${usagePercent.toFixed(1)}%`);
        }
      }
    }, 30000); // Every 30 seconds
  }

  // Get performance report
  getPerformanceReport() {
    const report = {
      timestamp: new Date().toISOString(),
      metrics: {}
    };

    this.metrics.forEach((entries, metricName) => {
      const recent = entries.slice(-10); // Last 10 entries

      if (metricName === 'calendarOperation') {
        // Group by operation name
        const byOperation = {};
        recent.forEach(entry => {
          if (!byOperation[entry.name]) {
            byOperation[entry.name] = [];
          }
          byOperation[entry.name].push(entry.duration);
        });

        Object.entries(byOperation).forEach(([opName, durations]) => {
          report.metrics[`${metricName}_${opName}`] = {
            count: durations.length,
            avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
            min: Math.min(...durations),
            max: Math.max(...durations)
          };
        });
      } else {
        // Generic metric aggregation
        report.metrics[metricName] = {
          count: recent.length,
          latest: recent[recent.length - 1]
        };
      }
    });

    // Add Core Web Vitals if available
    if ('getEntriesByType' in performance) {
      const paintEntries = performance.getEntriesByType('paint');
      const fcp = paintEntries.find(entry => entry.name === 'first-contentful-paint');
      if (fcp) {
        report.metrics.firstContentfulPaint = Math.round(fcp.startTime);
      }
    }

    return report;
  }

  // Send metrics to analytics service (placeholder)
  sendToAnalytics(metricName, data) {
    // Implement your analytics service here
    // Examples: Google Analytics, Mixpanel, custom endpoint

    if (window.gtag) {
      // Google Analytics 4
      window.gtag('event', 'performance_metric', {
        metric_name: metricName,
        metric_value: data.duration || data.value || 1,
        custom_parameters: data
      });
    }

    // Or send to your own analytics endpoint
    if (process.env.NODE_ENV === 'production') {
      // Only in production to avoid spam
      fetch('/api/analytics/performance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metric: metricName,
          data,
          timestamp: Date.now(),
          userAgent: navigator.userAgent,
          url: window.location.href
        })
      }).catch(() => {}); // Silent fail
    }
  }

  // Cleanup
  disconnect() {
    Object.values(this.observers).forEach(observer => {
      observer.disconnect();
    });
  }
}

// Singleton instance
const performanceMonitor = new PerformanceMonitor();

// Helper functions for easy use
export const measureOperation = (name, operation) => {
  return performanceMonitor.measureCalendarOperation(name, operation);
};

export const getPerformanceReport = () => {
  return performanceMonitor.getPerformanceReport();
};

export const recordCustomMetric = (name, data) => {
  performanceMonitor.recordMetric(name, data);
};

// React Hook for performance monitoring
export const usePerformanceMonitor = () => {
  const [report, setReport] = React.useState(null);

  React.useEffect(() => {
    const updateReport = () => {
      setReport(performanceMonitor.getPerformanceReport());
    };

    // Update every 30 seconds
    const interval = setInterval(updateReport, 30000);
    updateReport(); // Initial update

    return () => clearInterval(interval);
  }, []);

  return report;
};

export default performanceMonitor;