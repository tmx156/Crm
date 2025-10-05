/**
 * Service Worker Error Fix
 * Handles service worker errors during development
 */

// Suppress service worker errors in development
if (process.env.NODE_ENV === 'development') {
  // Override console.error to filter out service worker frame errors
  const originalError = console.error;
  console.error = (...args) => {
    const message = args[0];
    
    // Filter out service worker frame removal errors
    if (typeof message === 'string' && 
        (message.includes('Frame with ID') && message.includes('was removed')) ||
        message.includes('serviceWorker.js')) {
      // Suppress these errors in development
      return;
    }
    
    // Log all other errors normally
    originalError.apply(console, args);
  };

  // Handle unhandled promise rejections from service workers
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && 
        typeof event.reason === 'object' && 
        event.reason.message && 
        event.reason.message.includes('Frame with ID')) {
      // Suppress service worker frame errors
      event.preventDefault();
      return;
    }
  });

  console.log('🔧 Service worker error suppression enabled for development');
}

// Service worker registration (only in production)
export const registerServiceWorker = () => {
  if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('✅ Service worker registered:', registration);
        })
        .catch((error) => {
          console.log('❌ Service worker registration failed:', error);
        });
    });
  }
};

// Unregister service worker (for development)
export const unregisterServiceWorker = () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        registration.unregister();
        console.log('🧹 Service worker unregistered');
      });
    });
  }
};
