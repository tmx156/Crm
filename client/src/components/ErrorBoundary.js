import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
    
    // Add global error handler for unhandled promise rejections
    this.handleGlobalError = this.handleGlobalError.bind(this);
    this.handleUnhandledRejection = this.handleUnhandledRejection.bind(this);
  }

  componentDidMount() {
    // Add global error handlers
    window.addEventListener('error', this.handleGlobalError);
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  componentWillUnmount() {
    // Remove global error handlers
    window.removeEventListener('error', this.handleGlobalError);
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  handleGlobalError(event) {
    // Check if it's a Chrome extension error
    const isChromeExtensionError = event.error?.message?.includes('chrome-extension://') || 
                                  event.error?.stack?.includes('chrome-extension://') ||
                                  event.filename?.includes('chrome-extension://');
    
    if (isChromeExtensionError) {
      console.warn('🔌 Chrome extension error caught by global handler, ignoring:', event.error?.message);
      event.preventDefault();
      return;
    }
  }

  handleUnhandledRejection(event) {
    // Check if it's a Chrome extension error
    const isChromeExtensionError = event.reason?.message?.includes('chrome-extension://') || 
                                  event.reason?.stack?.includes('chrome-extension://') ||
                                  event.reason?.toString().includes('chrome-extension://');
    
    if (isChromeExtensionError) {
      console.warn('🔌 Chrome extension promise rejection caught by global handler, ignoring:', event.reason?.message);
      event.preventDefault();
      return;
    }
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log error details
    console.error('🚨 Error Boundary caught an error:', error, errorInfo);
    
    // Filter out Chrome extension errors
    const isChromeExtensionError = error?.message?.includes('chrome-extension://') || 
                                  error?.stack?.includes('chrome-extension://') ||
                                  errorInfo?.componentStack?.includes('chrome-extension://');
    
    if (isChromeExtensionError) {
      console.warn('🔌 Chrome extension error detected, ignoring:', error.message);
      // Don't show error UI for Chrome extension errors
      return;
    }
    
    // Store error details for debugging
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
  }

  render() {
    if (this.state.hasError) {
      // Check if it's a Chrome extension error
      const isChromeExtensionError = this.state.error?.message?.includes('chrome-extension://') || 
                                    this.state.error?.stack?.includes('chrome-extension://');
      
      if (isChromeExtensionError) {
        // Don't show error UI for Chrome extension errors, just render children
        return this.props.children;
      }
      
      // Show error UI for actual application errors
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6">
            <div className="flex items-center mb-4">
              <div className="flex-shrink-0">
                <svg className="h-8 w-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-lg font-medium text-gray-900">
                  Something went wrong
                </h3>
              </div>
            </div>
            <div className="mt-2">
              <p className="text-sm text-gray-500">
                We're sorry, but something unexpected happened. Please try refreshing the page.
              </p>
            </div>
            <div className="mt-4">
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Refresh Page
              </button>
            </div>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mt-4">
                <summary className="text-sm text-gray-600 cursor-pointer">Error Details (Development)</summary>
                <pre className="mt-2 text-xs text-gray-500 bg-gray-100 p-2 rounded overflow-auto">
                  {this.state.error.toString()}
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
