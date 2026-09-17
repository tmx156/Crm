/**
 * Which connected Gmail accounts can actually send right now.
 *
 * A row in `gmail_accounts` only means someone connected that mailbox once. The
 * mailbox can since have been closed, had its OAuth grant revoked, or had its
 * password changed — Google then answers `invalid_grant` and every send from
 * that address fails. Anything that offers a list of accounts to pick from, or
 * picks one itself, asks here first so a dead mailbox is never chosen.
 *
 * Only genuine authentication failures count as dead. A rate limit, an outage
 * or a network blip leaves the account live: rerouting a customer's email to a
 * different brand because Gmail was briefly slow would be far worse than
 * letting the send fail and retry.
 */

const { google } = require('googleapis');
const { getAuthedClient } = require('./gmailClient');
const { getSupabaseClient } = require('../config/supabase-client');

const CACHE_MS = 5 * 60 * 1000;

let _cache = { at: 0, accounts: null };
let _inFlight = null;

// Google's wording for "this grant is gone" — re-connecting is the only fix.
const AUTH_FAILURE = /invalid_grant|invalid_client|unauthorized_client|account has been deleted|token has been expired or revoked|no gmail tokens found/i;

function isAuthFailure(err) {
  const status = err?.response?.status || err?.code;
  if (status === 401 || status === 403) return true;

  const detail = [
    err?.message,
    err?.response?.data?.error,
    err?.response?.data?.error_description
  ].filter(Boolean).join(' ');

  return AUTH_FAILURE.test(detail);
}

/** Ask Gmail whether this mailbox will still talk to us. */
async function checkAccount(email) {
  try {
    const auth = await getAuthedClient(email);
    const gmail = google.gmail({ version: 'v1', auth });
    await gmail.users.getProfile({ userId: 'me' });
    return { email, live: true, error: null };
  } catch (err) {
    const dead = isAuthFailure(err);
    const error = err?.response?.data?.error_description || err?.message || 'unknown error';
    if (dead) {
      console.warn(`⚠️ [gmail-health] ${email} cannot send: ${error}`);
    } else {
      console.warn(`⚠️ [gmail-health] ${email} check inconclusive, treating as live: ${error}`);
    }
    return { email, live: !dead, error };
  }
}

/**
 * Every connected account with its current state.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.force] - skip the cache and re-check with Google
 * @returns {Promise<Array<{email: string, live: boolean, error: string|null}>>}
 */
async function getAccountHealth({ force = false } = {}) {
  if (!force && _cache.accounts && Date.now() - _cache.at < CACHE_MS) {
    return _cache.accounts;
  }

  // Several sends can land at once; they share one round of checks.
  if (_inFlight) return _inFlight;

  _inFlight = (async () => {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.from('gmail_accounts').select('email');

      if (error) {
        console.warn('⚠️ [gmail-health] could not read gmail_accounts:', error.message);
        return _cache.accounts || [];
      }

      const emails = (data || []).map(r => String(r.email).toLowerCase());
      const accounts = await Promise.all(emails.map(checkAccount));

      _cache = { at: Date.now(), accounts };
      return accounts;
    } finally {
      _inFlight = null;
    }
  })();

  return _inFlight;
}

/** Addresses that can send right now. */
async function getLiveAccounts(opts) {
  const accounts = await getAccountHealth(opts);
  return new Set(accounts.filter(a => a.live).map(a => a.email));
}

/** Connected but unusable, with the reason — for warning the user. */
async function getDeadAccounts(opts) {
  const accounts = await getAccountHealth(opts);
  return accounts.filter(a => !a.live);
}

/** Called after an account is connected or removed. */
function clearCache() {
  _cache = { at: 0, accounts: null };
}

module.exports = { getAccountHealth, getLiveAccounts, getDeadAccounts, clearCache };
