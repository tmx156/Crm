const express = require('express');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const router = express.Router();

// Initialize Supabase client
const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.anonKey);

// Get OAuth2 client configuration from centralized config
const GOOGLE_CLIENT_ID = config.google.clientId;
const GOOGLE_CLIENT_SECRET = config.google.clientSecret;
const GOOGLE_REDIRECT_URI = config.google.redirectUri;

// Create OAuth2 client
function createOAuthClient() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('Gmail OAuth credentials not configured. Check your .env file.');
  }
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

// @route   GET /api/gmail/auth-url
// @desc    Get Google OAuth authorization URL
// @access  Public
router.get('/auth-url', (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({
        error: 'Gmail OAuth not configured',
        message: 'Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in environment variables',
        config: {
          clientId: GOOGLE_CLIENT_ID ? 'SET' : 'NOT SET',
          clientSecret: GOOGLE_CLIENT_SECRET ? 'SET' : 'NOT SET',
          redirectUri: GOOGLE_REDIRECT_URI
        }
      });
    }

    const oauth2Client = createOAuthClient();

    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'openid'
    ];

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent' // Force consent screen to get refresh token
    });

    res.json({ 
      url: authUrl,
      instructions: [
        '1. Copy the "url" above',
        '2. Open it in your browser',
        '3. Sign in with your Gmail account',
        '4. Click "Allow" to grant permissions',
        '5. You will be redirected to a success page',
        '6. Restart your server after authentication'
      ]
    });
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({ error: 'Failed to generate auth URL', message: error.message });
  }
});

// @route   GET /api/gmail/callback
// @desc    Handle Google OAuth callback and store tokens
// @access  Public
router.get('/callback', async (req, res) => {
  try {
    const { code, error } = req.query;

    if (error) {
      return res.status(400).send(`
        <html>
          <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
            <h1 style="color: #ea4335;">❌ Gmail Authentication Failed</h1>
            <p>Error: ${error}</p>
            <p><a href="/api/gmail/auth-url">Try again</a></p>
          </body>
        </html>
      `);
    }

    if (!code) {
      return res.status(400).send(`
        <html>
          <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
            <h1 style="color: #ea4335;">❌ Missing authorization code</h1>
            <p>No authorization code received from Google.</p>
            <p><a href="/api/gmail/auth-url">Try again</a></p>
          </body>
        </html>
      `);
    }

    const oauth2Client = createOAuthClient();

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user's Gmail address
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    const email = userInfo.data.email;

    if (!email) {
      return res.status(400).send(`
        <html>
          <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
            <h1 style="color: #ea4335;">❌ Failed to get email address</h1>
            <p>Could not retrieve your Gmail address from Google.</p>
          </body>
        </html>
      `);
    }

    // Store tokens in Supabase
    const { data: existingAccount, error: fetchError } = await supabase
      .from('gmail_accounts')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    const accountData = {
      email: email,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || existingAccount?.refresh_token, // Preserve existing refresh token if new one not provided
      token_type: tokens.token_type || 'Bearer',
      expiry_date: tokens.expiry_date || null,
      scope: Array.isArray(tokens.scope) ? tokens.scope.join(' ') : (tokens.scope || ''),
      updated_at: new Date().toISOString()
    };

    if (existingAccount) {
      // Update existing account
      const { error: updateError } = await supabase
        .from('gmail_accounts')
        .update(accountData)
        .eq('email', email);

      if (updateError) {
        console.error('Error updating Gmail account:', updateError);
        return res.status(500).send(`
          <html>
            <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
              <h1 style="color: #ea4335;">❌ Failed to update Gmail account</h1>
              <p>Error: ${updateError.message}</p>
            </body>
          </html>
        `);
      }
    } else {
      // Insert new account
      accountData.created_at = new Date().toISOString();
      const { error: insertError } = await supabase
        .from('gmail_accounts')
        .insert(accountData);

      if (insertError) {
        console.error('Error inserting Gmail account:', insertError);
        // If table doesn't exist, provide helpful message
        if (insertError.message.includes('relation "gmail_accounts" does not exist')) {
          return res.status(500).send(`
            <html>
              <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
                <h1 style="color: #fbbc04;">⚠️ Database table missing</h1>
                <p>The <code>gmail_accounts</code> table doesn't exist in Supabase.</p>
                <p>Please run this SQL in your Supabase SQL Editor:</p>
                <pre style="background: #f5f5f5; padding: 15px; border-radius: 4px; overflow-x: auto;">
CREATE TABLE gmail_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_type TEXT DEFAULT 'Bearer',
  expiry_date BIGINT,
  scope TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_gmail_accounts_email ON gmail_accounts(email);
                </pre>
              </body>
            </html>
          `);
        }
        return res.status(500).send(`
          <html>
            <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
              <h1 style="color: #ea4335;">❌ Failed to save Gmail account</h1>
              <p>Error: ${insertError.message}</p>
            </body>
          </html>
        `);
      }
    }

    res.send(`
      <html>
        <head>
          <title>Gmail Connected ✅</title>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              max-width: 600px;
              margin: 50px auto;
              padding: 20px;
              background: #f5f5f5;
            }
            .card {
              background: white;
              padding: 30px;
              border-radius: 8px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            h1 { color: #34a853; }
            .email { 
              background: #f0f0f0;
              padding: 10px;
              border-radius: 4px;
              font-family: monospace;
              margin: 20px 0;
            }
            .success { color: #34a853; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>✅ Gmail Connected Successfully!</h1>
            <p>Your Gmail account has been connected to the CRM.</p>
            <div class="email">${email}</div>
            <p class="success">Next steps:</p>
            <ol>
              <li>Restart your server to activate Gmail API polling</li>
              <li>The email poller will now use Gmail API instead of IMAP</li>
              <li>Check server logs to confirm connection</li>
            </ol>
          </div>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('Error in Gmail callback:', error);
    res.status(500).send(`
      <html>
        <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
          <h1 style="color: #ea4335;">❌ Authentication Error</h1>
          <p>${error.message}</p>
        </body>
      </html>
    `);
  }
});

module.exports = router;
