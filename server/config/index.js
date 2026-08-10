require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

/**
 * Centralized Configuration Module
 * Provides secure access to environment variables with fallbacks
 * This ensures credentials are not hardcoded in multiple places
 */

/**
 * Parse GMAIL_OAUTH_CLIENTS. Bad JSON must not take the server down — the
 * primary OAuth client keeps working, so warn loudly and carry on.
 */
function parseExtraOAuthClients() {
  const raw = process.env.GMAIL_OAUTH_CLIENTS;
  if (!raw || !raw.trim()) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('⚠️ GMAIL_OAUTH_CLIENTS is not valid JSON, ignoring:', e.message);
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.error('⚠️ GMAIL_OAUTH_CLIENTS must be a JSON array, ignoring');
    return [];
  }

  return parsed
    .filter(c => {
      if (c && c.name && c.clientId && c.clientSecret) return true;
      console.error('⚠️ GMAIL_OAUTH_CLIENTS entry missing name/clientId/clientSecret, skipping');
      return false;
    })
    .map(c => ({
      name: String(c.name),
      clientId: c.clientId,
      clientSecret: c.clientSecret,
      redirectUri: c.redirectUri || process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/gmail/callback',
      accounts: (Array.isArray(c.accounts) ? c.accounts : []).map(a => String(a).toLowerCase())
    }));
}

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
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null,
    // Server-side operations should use serviceRoleKey to bypass RLS
    serverKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc'
  },

  // SMS Configuration (BulkSMS) - reads from .env only, no fallback credentials
  sms: {
    username: process.env.BULKSMS_USERNAME || null,
    password: process.env.BULKSMS_PASSWORD || null,
    fromNumber: process.env.BULKSMS_FROM_NUMBER || '+447786201100',
    pollEnabled: (process.env.BULKSMS_POLL_ENABLED || 'false').toLowerCase() === 'true',
    pollInterval: parseInt(process.env.BULKSMS_POLL_INTERVAL_MS) || 60000
  },

  // Email Configuration
  email: {
    user: process.env.EMAIL_USER || null,
    password: process.env.EMAIL_PASSWORD || null,
    gmailUser: process.env.GMAIL_USER || null,
    gmailPass: process.env.GMAIL_PASS || null
  },

  // Google OAuth / Gmail API
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || null,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/gmail/callback',
    // Extra OAuth clients, for Gmail accounts that live in a different Google
    // Cloud project than the primary one. A refresh token only works with the
    // client that issued it, so each account must always be refreshed through
    // the client it was authorised with.
    //
    // GMAIL_OAUTH_CLIENTS is a JSON array:
    //   [{"name":"secondary","clientId":"...","clientSecret":"...",
    //     "redirectUri":"https://host/api/gmail/callback",
    //     "accounts":["someone@example.com"]}]
    extraClients: parseExtraOAuthClients()
  },

  // Google Sheets Sync
  googleSheets: {
    spreadsheetId: process.env.GOOGLE_SHEETS_ID || null,
    serviceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || null,
    serviceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || null
  },

  // Gmail Poller (reads from env directly, these are for reference)
  gmail: {
    email: process.env.GMAIL_EMAIL || process.env.GMAIL_USER || null,
    clientId: process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || null,
    clientSecret: process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || null,
    refreshToken: process.env.GMAIL_REFRESH_TOKEN || null,
    pollIntervalMs: parseInt(process.env.GMAIL_POLL_INTERVAL_MS) || 180000
  },

  // Webhook Configuration (for external lead sources like landing pages)
  webhook: {
    apiKey: process.env.WEBHOOK_API_KEY || 'a861c0da361d0723faeac04f0d39fa01129152a7b006dd1885e41eb2d8ceb558'
  },

  // Facebook Conversions API
  facebook: {
    pixelId: process.env.FB_PIXEL_ID || null,
    accessToken: process.env.FB_ACCESS_TOKEN || null,
    testEventCode: process.env.FB_TEST_EVENT_CODE || null,
    eventSourceUrl: process.env.FB_EVENT_SOURCE_URL || null
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
