import axios from 'axios';

// Enhanced API client with retry logic for connection stability
const MAX_RETRIES = 2; // Reduced from 3 to prevent retry storms
const BASE_DELAY = 2000; // Increased to 2 seconds
const MAX_DELAY = 8000; // Reduced max delay

// Cache-busting for GET requests
axios.interceptors.request.use((config) => {
  // Add cache-busting timestamp to GET requests
  if (config.method === 'get') {
    config.params = {
      ...config.params,
      _t: Date.now()
    };
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

// Check if error is retryable
const isRetryableError = (error) => {
  if (!error.response) {
    // Network error, connection refused, etc.
    return true;
  }
  
  const status = error.response.status;
  const errorCode = error.response.data?.error;
  
  // Retry on server errors and database connection issues
  return (
    status >= 500 || 
    status === 503 || 
    errorCode === 'DB_CONNECTION_ERROR' || 
    errorCode === 'DB_DISCONNECTED'
  );
};

// Calculate delay with exponential backoff and jitter
const calculateDelay = (attempt) => {
  const delay = Math.min(BASE_DELAY * Math.pow(2, attempt), MAX_DELAY);
  // Add jitter to prevent thundering herd
  const jitter = Math.random() * 0.1 * delay;
  return delay + jitter;
};

// Sleep utility
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Main retry function
export const apiRetry = async (requestFn, options = {}) => {
  const {
    maxRetries = MAX_RETRIES,
    showNotifications = true,
    fallbackData = null
  } = options;

  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await requestFn();
      
      // Success - reset any previous error notifications
      if (attempt > 0 && showNotifications) {
        console.log('✅ API request succeeded after retries');
      }
      
      return result;
      
    } catch (error) {
      lastError = error;
      
      // Check if we should retry
      if (attempt < maxRetries && isRetryableError(error)) {
        const delay = calculateDelay(attempt);
        
        if (showNotifications) {
          console.warn(`⚠️ API request failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(delay)}ms...`);
        }
        
        await sleep(delay);
        continue;
      }
      
      // Max retries reached or non-retryable error
      break;
    }
  }
  
  // All retries failed
  if (showNotifications) {
    console.error('❌ API request failed after all retries:', lastError.message);
  }
  
  // Return fallback data if provided
  if (fallbackData !== null) {
    console.log('📋 Using fallback data due to API failure');
    return { data: fallbackData, isFromFallback: true };
  }
  
  throw lastError;
};

// Axios interceptors for automatic retry on critical errors only
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    
    // Don't retry if already retried, retry is disabled, or using custom retry
    if (config.__retryCount >= 1 || config.skipRetry || config.__usingCustomRetry) {
      return Promise.reject(error);
    }
    
    // Initialize retry count
    config.__retryCount = config.__retryCount || 0;
    
    // Only retry on critical network errors (not server errors)
    const isCriticalNetworkError = !error.response && (
      error.code === 'ECONNREFUSED' || 
      error.code === 'ENOTFOUND' ||
      error.message.includes('Network Error')
    );
    
    if (isCriticalNetworkError) {
      config.__retryCount++;
      const delay = 3000; // Fixed 3-second delay for network issues
      
      console.warn(`⚠️ Network error, retrying in ${delay}ms...`);
      
      await sleep(delay);
      return axios(config);
    }
    
    return Promise.reject(error);
  }
);

// Helper functions for common API patterns
export const fetchWithRetry = (url, options = {}) => {
  const axiosOptions = { ...options, __usingCustomRetry: true };
  return apiRetry(() => axios.get(url, axiosOptions), options);
};

export const postWithRetry = (url, data, options = {}) => {
  const axiosOptions = { ...options, __usingCustomRetry: true };
  return apiRetry(() => axios.post(url, data, axiosOptions), options);
};

export const putWithRetry = (url, data, options = {}) => {
  const axiosOptions = { ...options, __usingCustomRetry: true };
  return apiRetry(() => axios.put(url, data, axiosOptions), options);
};

export const deleteWithRetry = (url, options = {}) => {
  const axiosOptions = { ...options, __usingCustomRetry: true };
  return apiRetry(() => axios.delete(url, axiosOptions), options);
};

// Connection health checker
export const checkApiHealth = async () => {
  try {
    const startTime = Date.now();
    const response = await axios.get('/api/health', { 
      timeout: 5000,
      skipRetry: true 
    });
    const latency = Date.now() - startTime;
    
    // Check if response indicates healthy database
    const isDbHealthy = response.data?.database === 'connected';
    
    return { 
      healthy: response.status === 200 && isDbHealthy, 
      latency,
      databaseStatus: response.data?.database || 'unknown',
      serverStatus: response.data?.status || 'unknown'
    };
  } catch (error) {
    return { 
      healthy: false, 
      error: error.response?.status === 404 ? 'Health endpoint not found' : error.message,
      canRetry: isRetryableError(error)
    };
  }
};

export default apiRetry; 