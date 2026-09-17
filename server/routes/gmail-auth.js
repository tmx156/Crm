const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { makeOAuth2Client, getOAuthClientByName, resolveOAuthClient } = require('../utils/gmailClient');
const config = require('../config');
const { getSupabaseClient } = require('../config/supabase-client');
const { getAccountHealth, clearCache: clearHealthCache } = require('../utils/gmailAccountHealth');
const { clearCache: clearResolverCache } = require('../utils/emailAccountResolver');

const supabase = getSupabaseClient();

const SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/userinfo.email'];

/**
 * GET /api/gmail/auth-url
 * Returns the Google OAuth consent URL. Open it in a browser to authorise.
 *
 * Query params:
 *   client - name of an entry in GMAIL_OAUTH_CLIENTS. Use this when the account
 *            being added lives in a different Google Cloud project than the
 *            primary one. Defaults to the primary client.
 */
router.get('/auth-url', (req, res) => {
  try {
    const clientName = req.query.client || 'primary';
    const creds = getOAuthClientByName(clientName);

    if (!creds) {
      return res.status(400).json({
        error: `Unknown OAuth client "${clientName}". Configured: ` +
          ['primary', ...(config.google.extraClients || []).map(c => c.name)].join(', ')
      });
    }

    console.log(`[Gmail] Generating auth URL using "${creds.name}" client...`);
    console.log('[Gmail] Config check:', {
      clientId: creds.clientId ? 'Set' : 'Not set',
      clientSecret: creds.clientSecret ? 'Set' : 'Not set',
      redirectUri: creds.redirectUri
    });

    const oauth2 = makeOAuth2Client(creds);
    const url = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      // Carried through the redirect so the callback exchanges the code with
      // the same client that issued it.
      state: creds.name
    });

    console.log('[Gmail] Auth URL generated successfully');
    res.json({ url, client: creds.name });
  } catch (err) {
    console.error('[Gmail] Error generating auth URL:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/gmail/callback
 * Google redirects here after the user consents.
 * Exchanges the code for tokens and stores them in Supabase.
 */
router.get('/callback', async (req, res) => {
  const { code, state, error: oauthError, error_description } = req.query;

  console.log('[Gmail] Callback received:', {
    hasCode: !!code,
    client: state || 'primary',
    hasError: !!oauthError,
    error: oauthError,
    error_description: error_description
  });

  if (oauthError) {
    return res.status(400).send(`OAuth Error: ${oauthError} - ${error_description || 'No description'}`);
  }
  
  if (!code) return res.status(400).send('Missing code parameter');

  try {
    const creds = getOAuthClientByName(state) || getOAuthClientByName('primary');
    const oauth2 = makeOAuth2Client(creds);
    console.log(`[Gmail] Exchanging code for tokens using "${creds.name}" client...`);
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

    // A freshly connected account must show up in the pickers straight away,
    // and one that was failing is live again.
    clearHealthCache();
    clearResolverCache();

    // A refresh token only works with the client that issued it. If this
    // account isn't mapped to that client, every later refresh would be
    // attempted with the primary client and fail with invalid_grant.
    let warning = '';
    const owningClient = resolveOAuthClient(email);
    if (owningClient.name !== creds.name) {
      warning =
        `Authorised with the "${creds.name}" OAuth client, but ${email} currently ` +
        `resolves to "${owningClient.name}". Add "${email}" to the "${creds.name}" ` +
        `entry's accounts list in GMAIL_OAUTH_CLIENTS and restart, or token refresh will fail.`;
      console.warn(`[Gmail] ⚠️ ${warning}`);
    }

    res.send(
      `Gmail account ${email} connected successfully. You can close this tab.` +
      (warning ? `<br><br><strong>Warning:</strong> ${warning}` : '')
    );
  } catch (err) {
    console.error('[Gmail] OAuth callback error:', err.message);
    console.error('[Gmail] Full error:', err);
    res.status(500).send('OAuth error: ' + err.message + '<br><br>If this persists, try running: node server/gmail_manual_auth.js');
  }
});

/**
 * GET /api/gmail/accounts
 * Connected Gmail accounts that can actually send. A mailbox whose OAuth grant
 * has gone is left out of `accounts` — offering it in a "Send From" picker only
 * gets it chosen and every send from it fails — and reported in `unavailable`
 * so the reason can be shown.
 *
 * ?all=true      keep unusable accounts in the list (diagnostics)
 * ?refresh=true  re-check with Google instead of using the 5 minute cache
 */
router.get('/accounts', async (req, res) => {
  try {
    const includeDead = req.query.all === 'true';
    const health = await getAccountHealth({ force: req.query.refresh === 'true' });

    const usable = health.filter(a => a.live).map(a => a.email);
    const unavailable = health
      .filter(a => !a.live)
      .map(a => ({ email: a.email, error: a.error }));

    if (unavailable.length > 0) {
      console.warn(`[Gmail] ${unavailable.length} connected account(s) cannot send: ` +
        unavailable.map(a => a.email).join(', '));
    }

    res.json({
      accounts: includeDead ? health.map(a => a.email) : usable,
      unavailable
    });
  } catch (err) {
    console.error('[Gmail] Error listing accounts:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
