const { google } = require('googleapis');
const config = require('../config');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(config.supabase.url, config.supabase.anonKey);

/**
 * Build an OAuth2 client (no tokens yet).
 */
function makeOAuth2Client() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

/**
 * Load tokens from the Supabase `gmail_accounts` table for the given email,
 * attach them to an OAuth2 client, and auto-refresh if expired.
 *
 * @param {string} email - The Gmail address whose tokens we want.
 * @returns {Promise<import('googleapis').Auth.OAuth2Client>}
 */
async function getAuthedClient(email) {
  const { data: row, error } = await supabase
    .from('gmail_accounts')
    .select('access_token, refresh_token, expiry_date')
    .eq('email', email)
    .single();

  if (error || !row) {
    throw new Error(
      `No Gmail tokens found for ${email}. ` +
      'Visit /api/gmail/auth-url to connect the account.'
    );
  }

  const oauth2 = makeOAuth2Client();
  oauth2.setCredentials({
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    expiry_date: row.expiry_date
  });

  // When googleapis auto-refreshes, persist the new tokens
  oauth2.on('tokens', async (tokens) => {
    console.log(`[Gmail] Token refreshed for ${email}`);
    const update = {
      access_token: tokens.access_token,
      updated_at: new Date().toISOString()
    };
    if (tokens.refresh_token) update.refresh_token = tokens.refresh_token;
    if (tokens.expiry_date) update.expiry_date = tokens.expiry_date;

    const { error: updateErr } = await supabase
      .from('gmail_accounts')
      .update(update)
      .eq('email', email);

    if (updateErr) {
      console.error(`[Gmail] Failed to persist refreshed tokens for ${email}:`, updateErr.message);
    }
  });

  return oauth2;
}

module.exports = { makeOAuth2Client, getAuthedClient };
