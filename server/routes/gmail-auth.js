const express = require('express');
const router = express.Router();
const { makeOAuth2Client } = require('../utils/gmailClient');
const config = require('../config');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(config.supabase.url, config.supabase.anonKey);

const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

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
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code parameter');

  try {
    const oauth2 = makeOAuth2Client();
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);

    // Discover which email address was just authorised
    const oauth2Api = require('googleapis').google.oauth2({ version: 'v2', auth: oauth2 });
    const { data: profile } = await oauth2Api.userinfo.get();
    const email = profile.email;

    // Upsert tokens into gmail_accounts
    const row = {
      email,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      updated_at: new Date().toISOString()
    };

    // Try update first, then insert if not found
    const { data: existing } = await supabase
      .from('gmail_accounts')
      .select('email')
      .eq('email', email)
      .single();

    if (existing) {
      await supabase.from('gmail_accounts').update(row).eq('email', email);
    } else {
      row.created_at = new Date().toISOString();
      await supabase.from('gmail_accounts').insert(row);
    }

    console.log(`[Gmail] OAuth tokens stored for ${email}`);
    res.send(`Gmail account ${email} connected successfully. You can close this tab.`);
  } catch (err) {
    console.error('[Gmail] OAuth callback error:', err.message);
    res.status(500).send('OAuth error: ' + err.message);
  }
});

module.exports = router;
