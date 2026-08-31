// Lazy Loading & Code Splitting for CRM Components
import React, { Suspense, lazy } from 'react';

// Lazy load heavy components
const Calendar = lazy(() => import('../pages/Calendar'));
const LeadDetails = lazy(() => import('../pages/LeadDetails'));
const Analytics = lazy(() => import('../pages/Analytics'));
const Settings = lazy(() => import('../pages/Settings'));
const Reports = lazy(() => import('../pages/Reports'));

// Calendar optimizations
const OptimizedCalendar = lazy(() => import('../components/OptimizedCalendar'));
const VirtualizedEventHistory = lazy(() => import('../components/VirtualizedEventHistory'));

// Heavy third-party components
const Chart = lazy(() => import('recharts').then(module => ({ default: module.BarChart })));
const DatePicker = lazy(() => import('react-datepicker'));

// Loading components for better UX
const PageLoader = ({ message = "Loading..." }) => (
  <div className="flex items-center justify-center h-64">
    <div className="text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
      <p className="text-gray-600">{message}</p>
    </div>
  </div>
);

const ComponentLoader = ({ size = "sm" }) => {
  const sizeClasses = {
    sm: "h-8 w-8",
    md: "h-12 w-12",
    lg: "h-16 w-16"
  };

  return (
    <div className="flex items-center justify-center p-4">
      <div className={`animate-spin rounded-full border-b-2 border-blue-600 ${sizeClasses[size]}`}></div>
    </div>
  );
};

// Error Boundary for lazy loaded components
class LazyErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Lazy component loading error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="text-center p-8">
          <p className="text-red-600 mb-4">Failed to load component</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Higher-order component for lazy loading with error boundary
const withLazyLoading = (Component, fallback = <ComponentLoader />) => {
  return React.forwardRef((props, ref) => (
    <LazyErrorBoundary>
      <Suspense fallback={fallback}>
        <Component {...props} ref={ref} />
      </Suspense>
    </LazyErrorBoundary>
  ));
};

// Preload components on user interaction
const preloadComponent = (componentImport) => {
  const componentImporter = typeof componentImport === 'function'
    ? componentImport
    : () => componentImport;

  return componentImporter();
};

// Hook for preloading components
export const usePreloadComponents = () => {
  const preloadCalendar = () => preloadComponent(() => import('../pages/Calendar'));
  const preloadAnalytics = () => preloadComponent(() => import('../pages/Analytics'));
  const preloadReports = () => preloadComponent(() => import('../pages/Reports'));

  return {
    preloadCalendar,
    preloadAnalytics,
    preloadReports
  };
};

// Route-based code splitting components
export const LazyCalendar = withLazyLoading(Calendar, <PageLoader message="Loading Calendar..." />);
export const LazyLeadDetails = withLazyLoading(LeadDetails, <PageLoader message="Loading Lead Details..." />);
export const LazyAnalytics = withLazyLoading(Analytics, <PageLoader message="Loading Analytics..." />);
export const LazySettings = withLazyLoading(Settings, <PageLoader message="Loading Settings..." />);
export const LazyReports = withLazyLoading(Reports, <PageLoader message="Loading Reports..." />);

// Component-based code splitting
export const LazyOptimizedCalendar = withLazyLoading(OptimizedCalendar, <ComponentLoader />);
export const LazyVirtualizedEventHistory = withLazyLoading(VirtualizedEventHistory, <ComponentLoader />);
export const LazyChart = withLazyLoading(Chart, <ComponentLoader />);
export const LazyDatePicker = withLazyLoading(DatePicker, <ComponentLoader />);

// Bundle analyzer utility
export const BundleAnalyzer = () => {
  if (process.env.NODE_ENV !== 'development') return null;

  const logBundleInfo = () => {
    console.log('📦 Bundle Analysis:');
    console.log('- Main bundle loaded');
    console.log('- Lazy components:', Object.keys({
      Calendar,
      LeadDetails,
      Analytics,
      Settings,
      Reports
    }));

    // Memory usage
    if (performance.memory) {
      const memory = performance.memory;
      console.log('- Memory usage:', {
        used: `${(memory.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB`,
        total: `${(memory.totalJSHeapSize / 1024 / 1024).toFixed(2)}MB`,
        limit: `${(memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2)}MB`
      });
    }
  };

  React.useEffect(() => {
    logBundleInfo();
  }, []);

  return null;
};

export default {
  LazyCalendar,
  LazyLeadDetails,
  LazyAnalytics,
  LazySettings,
  LazyReports,
  LazyOptimizedCalendar,
  LazyVirtualizedEventHistory,
  LazyChart,
  LazyDatePicker,
  withLazyLoading,
  preloadComponent,
  usePreloadComponents,
  BundleAnalyzer
};