const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { makeOAuth2Client } = require('../utils/gmailClient');
const config = require('../config');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(config.supabase.url, config.supabase.anonKey);

const SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/userinfo.email'];

/**
 * GET /api/gmail/auth-url
 * Returns the Google OAuth consent URL. Open it in a browser to authorise.
 */
router.get('/auth-url', (req, res) => {
  const oauth2 = makeOAuth2Client();
  const url = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });
  res.json({ url });
});

/**
 * GET /api/gmail/callback
 * Google redirects here after the user consents.
 * Exchanges the code for tokens and stores them in Supabase.
 */
router.get('/callback', async (req, res) => {
  const { code, error: oauthError, error_description } = req.query;
  
  console.log('[Gmail] Callback received:', { 
    hasCode: !!code, 
    hasError: !!oauthError,
    error: oauthError,
    error_description: error_description
  });
  
  if (oauthError) {
    return res.status(400).send(`OAuth Error: ${oauthError} - ${error_description || 'No description'}`);
  }
  
  if (!code) return res.status(400).send('Missing code parameter');

  try {
    const oauth2 = makeOAuth2Client();
    console.log('[Gmail] Exchanging code for tokens...');
    const { tokens } = await oauth2.getToken(code);
    console.log('[Gmail] Tokens received:', { 
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      expiryDate: tokens.expiry_date
    });
    
    // Set credentials on the OAuth client
    oauth2.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date
    });

    // Discover which email address was just authorised
    let email = null;
    try {
      console.log('[Gmail] Getting user info...');
      const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
      const { data: profile } = await oauth2Api.userinfo.get();
      console.log('[Gmail] User info received:', { email: profile.email });
      email = profile.email;
    } catch (userInfoErr) {
      console.log('[Gmail] userinfo.get() failed, using EMAIL_USER env var as fallback');
      email = config.email.user || process.env.EMAIL_USER;
      if (!email) {
        throw new Error('Could not get email from userinfo and EMAIL_USER not set');
      }
    }

    // Upsert tokens into gmail_accounts
    const row = {
      email,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      updated_at: new Date().toISOString()
    };

    // Try update first, then insert if not found
    console.log('[Gmail] Saving tokens to database...');
    const { data: existing, error: selectError } = await supabase
      .from('gmail_accounts')
      .select('email')
      .eq('email', email)
      .single();

    if (selectError && !selectError.message.includes('0 rows')) {
      console.log('[Gmail] Select error:', selectError.message);
    }

    if (existing) {
      console.log('[Gmail] Updating existing record...');
      const { error: updateError } = await supabase.from('gmail_accounts').update(row).eq('email', email);
      if (updateError) throw updateError;
    } else {
      console.log('[Gmail] Creating new record...');
      row.created_at = new Date().toISOString();
      const { error: insertError } = await supabase.from('gmail_accounts').insert(row);
      if (insertError) throw insertError;
    }

    console.log(`[Gmail] OAuth tokens stored for ${email}`);
    res.send(`Gmail account ${email} connected successfully. You can close this tab.`);
  } catch (err) {
    console.error('[Gmail] OAuth callback error:', err.message);
    console.error('[Gmail] Full error:', err);
    res.status(500).send('OAuth error: ' + err.message + '<br><br>If this persists, try running: node server/gmail_manual_auth.js');
  }
});

module.exports = router;
