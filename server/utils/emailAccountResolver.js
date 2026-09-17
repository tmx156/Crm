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
 * Whatever is chosen is checked against the accounts that can actually send —
 * a mailbox that was disconnected, or whose Gmail access has lapsed, would
 * otherwise fail at send time.
 */

const { getSupabaseClient } = require('../config/supabase-client');
const { getLiveAccounts, clearCache: clearHealthCache } = require('./gmailAccountHealth');

// Kept in step with emailService's own default; GMAIL_USER moves both.
const DEFAULT_ACCOUNT = (process.env.GMAIL_USER || 'bookings@camrymodels.co.uk').trim().toLowerCase();

// 'primary' is a legacy sentinel meaning "just use the default", stored on some
// older leads and templates. It is not a real address, so treat it as no signal.
const SENTINELS = new Set(['primary', 'default', '']);

let _cache = { accounts: null, at: 0 };
const CACHE_MS = 60 * 1000;

function normalise(value) {
  const v = (value || '').trim().toLowerCase();
  return SENTINELS.has(v) ? null : v;
}

/**
 * Addresses that can actually send right now (60s cache over the health check's
 * own). A row in gmail_accounts is not enough: a mailbox whose OAuth grant has
 * gone fails every send, so it must never be picked.
 */
async function getConnectedAccounts() {
  if (_cache.accounts && Date.now() - _cache.at < CACHE_MS) return _cache.accounts;

  try {
    const live = await getLiveAccounts();
    _cache = { accounts: live, at: Date.now() };
    return live;
  } catch (e) {
    console.warn('⚠️ [account-resolver] could not check account health:', e.message);
    return _cache.accounts || new Set();
  }
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

  const connected = await getConnectedAccounts();

  for (const c of candidates) {
    if (connected.size === 0 || connected.has(c.account)) return c;
    console.warn(
      `⚠️ [account-resolver] ${c.account} (${c.source}) cannot send right now, trying next`
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

/**
 * The account a template pins with its "Send From" setting, or null when it is
 * left on "Match customer's brand".
 *
 * Send paths that work the account out for themselves can get it wrong, so this
 * is checked again right before the send: whatever a caller decided, an explicit
 * per-template choice wins.
 *
 * @param {string} templateId
 * @returns {Promise<{account: string|null, senderName: string|null}>}
 */
async function getTemplateSendFrom(templateId) {
  if (!templateId) return { account: null, senderName: null };

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('templates')
      .select('email_account, sender_name')
      .eq('id', templateId)
      .maybeSingle();

    if (error || !data) return { account: null, senderName: null };

    const account = normalise(data.email_account);
    const senderName = data.sender_name || null;

    // A mailbox that has since been disconnected would throw at send time, so
    // leave the caller's own choice in place instead.
    if (account) {
      const connected = await getConnectedAccounts();
      if (connected.size > 0 && !connected.has(account)) {
        console.warn(`⚠️ [account-resolver] template account ${account} cannot send right now, ignoring`);
        return { account: null, senderName };
      }
    }

    return { account, senderName };
  } catch (e) {
    console.warn('⚠️ [account-resolver] template lookup failed:', e.message);
    return { account: null, senderName: null };
  }
}

/** Test hook / used after connecting or removing an account. */
function clearCache() {
  _cache = { accounts: null, at: 0 };
  clearHealthCache();
}

module.exports = { resolveReplyAccount, getTemplateSendFrom, clearCache, DEFAULT_ACCOUNT };
