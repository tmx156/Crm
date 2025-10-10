/**
 * API Configuration
 * Centralized API configuration for the CRM frontend
 */

// API Base URL configuration
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// API endpoints
export const API_ENDPOINTS = {
  // Health check
  HEALTH: `${API_BASE_URL}/api/health`,
  
  // Authentication
  LOGIN: `${API_BASE_URL}/api/auth/login`,
  REGISTER: `${API_BASE_URL}/api/auth/register`,
  REFRESH: `${API_BASE_URL}/api/auth/refresh`,
  
  // Leads
  LEADS: `${API_BASE_URL}/api/leads`,
  LEADS_UPLOAD: `${API_BASE_URL}/api/leads/upload`,
  
  // Sales
  SALES: `${API_BASE_URL}/api/sales`,
  
  // Users
  USERS: `${API_BASE_URL}/api/users`,
  
  // Messages
  MESSAGES: `${API_BASE_URL}/api/messages`,
  
  // Templates
  TEMPLATES: `${API_BASE_URL}/api/templates`,
  
  // Stats
  STATS: `${API_BASE_URL}/api/stats`,
  
  // SMS
  SMS: `${API_BASE_URL}/api/sms`,
  
  // Finance
  FINANCE: `${API_BASE_URL}/api/finance`,
  
  // Upload
  UPLOAD: `${API_BASE_URL}/api/upload`
};

// Cache-busting helper
export const addCacheBuster = (url) => {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_t=${Date.now()}`;
};

// Helper function to get full API URL
export const getApiUrl = (endpoint, bustCache = false) => {
  const url = `${API_BASE_URL}${endpoint}`;
  return bustCache ? addCacheBuster(url) : url;
};

// Default export
export default {
  API_BASE_URL,
  API_ENDPOINTS,
  getApiUrl,
  addCacheBuster
};
