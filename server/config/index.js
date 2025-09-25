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
    url: process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co',
    anonKey: process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null
  },

  // SMS Configuration (BulkSMS) - Check credentials
  sms: {
    username: process.env.BULKSMS_USERNAME || 'tmx2566',
    password: process.env.BULKSMS_PASSWORD || 'Booker100',
    fromNumber: process.env.BULKSMS_FROM_NUMBER || '+447786201100',
    pollEnabled: true, // Always enabled for SMS reply polling
    pollInterval: parseInt(process.env.BULKSMS_POLL_INTERVAL_MS) || 5000
  },

  // Email Configuration
  email: {
    user: process.env.EMAIL_USER || null,
    password: process.env.EMAIL_PASSWORD || null,
    gmailUser: process.env.GMAIL_USER || null,
    gmailPass: process.env.GMAIL_PASS || null
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

  // Warn about hardcoded credentials
  if (this.supabase.anonKey.includes('tnltvfzltdeilanxhlvy')) {
    console.warn('⚠️ Using hardcoded Supabase credentials - create .env file for production');
  }

  return missing.length === 0;
};

// Initialize validation
config.validate();

module.exports = config;
