require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

/**
 * Centralized Configuration Module
 * Provides secure access to environment variables with fallbacks
 * This ensures credentials are not hardcoded in multiple places
 */

const config = {
  // Environment
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 5000,

  // JWT Configuration - Maintain backward compatibility
  JWT_SECRET: process.env.JWT_SECRET || 'your-fallback-secret-key',
  JWT_EXPIRE: process.env.JWT_EXPIRE || '30d',

  // Supabase Configuration
  supabase: {
    url: process.env.SUPABASE_URL || 'https://ziqsvwoyafespvaychlg.supabase.co',
    anonKey: process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InppcXN2d295YWZlc3B2YXljaGxnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0MjI1MjYsImV4cCI6MjA3ODk5ODUyNn0.KvfjYdS-Nv4i33p4X-IqMvwDVqbj5XbIe5-KR6ZL0WM',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InppcXN2d295YWZlc3B2YXljaGxnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzQyMjUyNiwiZXhwIjoyMDc4OTk4NTI2fQ.VT-JI3OAZ_ecZO28mW7YUmVXKltk3ENXwSe_yvnK2kQ'
  },

  // SMS Configuration (BulkSMS) - DISABLED
  sms: {
    username: process.env.BULKSMS_USERNAME || null,
    password: process.env.BULKSMS_PASSWORD || null,
    fromNumber: process.env.BULKSMS_FROM_NUMBER || null,
    pollEnabled: false, // SMS functionality disabled
    pollInterval: parseInt(process.env.BULKSMS_POLL_INTERVAL_MS) || 60000
  },

  // Email Configuration - Use EMAIL_USER/EMAIL_PASSWORD as primary
  email: {
    user: process.env.EMAIL_USER || process.env.GMAIL_USER || null,
    password: process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS || null,
    // Aliases for backward compatibility - all point to same credentials
    gmailUser: process.env.EMAIL_USER || process.env.GMAIL_USER || null,
    gmailPass: process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS || null
  },

  // Google OAuth Configuration (Gmail API)
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '624909188074-r4s5bdbf628krnethdr3ngclnuao6l5h.apps.googleusercontent.com',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/gmail/callback'
  },

  // Client Configuration
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:3000',

  // Redis (if needed)
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};

// Validation function
config.validate = function() {
  const required = ['JWT_SECRET'];

  const missing = required.filter(key => !this[key]);

  if (missing.length > 0) {
    console.warn(`⚠️ Missing required environment variables: ${missing.join(', ')}`);
    console.warn('Using fallback values - please set proper environment variables in production');
  }

  // Warn about hardcoded credentials (updated for new database)
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.warn('⚠️ Using fallback Supabase credentials - set SUPABASE_URL and SUPABASE_ANON_KEY in .env for production');
  }

  return missing.length === 0;
};

// Initialize validation
config.validate();

module.exports = config;
