/**
 * Works out which Gmail account an outbound email should be sent FROM, so a
 * conversation always stays on the account it started on. Without this, every
 * reply UI falls back to the default account and a lead who wrote to Antara
 * gets answered by Camry.
 *
 * Resolution order, most specific first:
 *   0. preferredAccount              (an explicit per-template "Send From")
 *   1. the message being replied to  (messages.gmail_account_key)
 *   2. the most recent message on the lead that has an account recorded
 *   3. lead.booking_account          (locked at first booking confirmation)
 *   4. DEFAULT_ACCOUNT
 *
 * A template left on "Match customer's brand" stores no account (or the legacy
 * 'primary' sentinel), which means steps 1-3 decide — so one shared template
 * can serve every brand.
 *
 * Whatever is chosen is checked against gmail_accounts — an account that was
 * disconnected would otherwise throw "No Gmail tokens found" at send time.
 */

const { getSupabaseClient } = require('../config/supabase-client');

const DEFAULT_ACCOUNT = 'bookings@camrymodels.co.uk';

// 'primary' is a legacy sentinel meaning "just use the default", stored on some
// older leads and templates. It is not a real address, so treat it as no signal.
const SENTINELS = new Set(['primary', 'default', '']);

let _cache = { accounts: null, at: 0 };
const CACHE_MS = 60 * 1000;

function normalise(value) {
  const v = (value || '').trim().toLowerCase();
  return SENTINELS.has(v) ? null : v;
}

/** Addresses currently connected in gmail_accounts (60s cache). */
async function getConnectedAccounts(supabase) {
  if (_cache.accounts && Date.now() - _cache.at < CACHE_MS) return _cache.accounts;

  const { data, error } = await supabase.from('gmail_accounts').select('email');
  if (error) {
    console.warn('⚠️ [account-resolver] could not read gmail_accounts:', error.message);
    return _cache.accounts || new Set();
  }

  _cache = {
    accounts: new Set((data || []).map(r => String(r.email).toLowerCase())),
    at: Date.now()
  };
  return _cache.accounts;
}

/**
 * @param {object}  opts
 * @param {string}  opts.leadId
 * @param {object} [opts.originalMessage] - row being replied to; only
 *                  gmail_account_key is read.
 * @param {string} [opts.preferredAccount] - explicit override, e.g. a
 *                  template's email_account. Sentinels are ignored.
 * @returns {Promise<{account: string, source: string}>}
 */
async function resolveReplyAccount({
  leadId,
  originalMessage = null,
  preferredAccount = null
} = {}) {
  const supabase = getSupabaseClient();
  const candidates = [];

  // 0. Explicit choice on the template beats everything else.
  const preferred = normalise(preferredAccount);
  if (preferred) candidates.push({ account: preferred, source: 'template Send From' });

  // 1. The exact message being replied to.
  const fromOriginal = normalise(originalMessage?.gmail_account_key);
  if (fromOriginal) candidates.push({ account: fromOriginal, source: 'original message' });

  if (leadId) {
    // 2. Most recent message on this lead carrying an account.
    try {
      const { data } = await supabase
        .from('messages')
        .select('gmail_account_key')
        .eq('lead_id', leadId)
        .not('gmail_account_key', 'is', null)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const recent = normalise(data?.gmail_account_key);
      if (recent) candidates.push({ account: recent, source: 'most recent thread message' });
    } catch (e) {
      console.warn('⚠️ [account-resolver] thread lookup failed:', e.message);
    }

    // 3. Account locked on the lead at first booking confirmation.
    try {
      const { data } = await supabase
        .from('leads')
        .select('booking_account')
        .eq('id', leadId)
        .maybeSingle();

      const locked = normalise(data?.booking_account);
      if (locked) candidates.push({ account: locked, source: 'lead.booking_account' });
    } catch (e) {
      console.warn('⚠️ [account-resolver] lead lookup failed:', e.message);
    }
  }

  candidates.push({ account: DEFAULT_ACCOUNT, source: 'default' });

  const connected = await getConnectedAccounts(supabase);

  for (const c of candidates) {
    if (connected.size === 0 || connected.has(c.account)) return c;
    console.warn(
      `⚠️ [account-resolver] ${c.account} (${c.source}) is not connected, trying next`
    );
  }

  // Every candidate is disconnected — fall back to anything that works rather
  // than throwing at send time.
  const anyConnected = [...connected][0];
  if (anyConnected) {
    console.warn(`⚠️ [account-resolver] falling back to ${anyConnected}`);
    return { account: anyConnected, source: 'fallback (no candidate connected)' };
  }

  return { account: DEFAULT_ACCOUNT, source: 'default (nothing connected)' };
}

/** Test hook / used after connecting or removing an account. */
function clearCache() {
  _cache = { accounts: null, at: 0 };
}

module.exports = { resolveReplyAccount, clearCache, DEFAULT_ACCOUNT };
