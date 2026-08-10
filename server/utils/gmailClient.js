const { google } = require('googleapis');
const config = require('../config');
const { getSupabaseClient } = require('../config/supabase-client');

const supabase = getSupabaseClient();

/**
 * Find the OAuth client credentials that own a given Gmail address.
 * Falls back to the primary client when the address isn't claimed by an
 * entry in GMAIL_OAUTH_CLIENTS.
 *
 * @param {string|null} email
 * @returns {{name: string, clientId: string, clientSecret: string, redirectUri: string}}
 */
function resolveOAuthClient(email) {
  if (email) {
    const lower = email.toLowerCase();
    const match = (config.google.extraClients || []).find(c => c.accounts.includes(lower));
    if (match) return match;
  }
  return {
    name: 'primary',
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
    redirectUri: config.google.redirectUri
  };
}

/** Look up an OAuth client set by its GMAIL_OAUTH_CLIENTS name. */
function getOAuthClientByName(name) {
  if (!name || name === 'primary') return resolveOAuthClient(null);
  return (config.google.extraClients || []).find(c => c.name === name) || null;
}

/**
 * Build an OAuth2 client (no tokens yet).
 *
 * @param {string|object|null} account - Gmail address the client is for, or an
 *   already-resolved credentials object. Omit for the primary client.
 */
function makeOAuth2Client(account = null) {
  const creds = (account && typeof account === 'object')
    ? account
    : resolveOAuthClient(account);

  return new google.auth.OAuth2(
    creds.clientId,
    creds.clientSecret,
    creds.redirectUri
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

  const oauth2 = makeOAuth2Client(email);
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

module.exports = { makeOAuth2Client, getAuthedClient, resolveOAuthClient, getOAuthClientByName };
