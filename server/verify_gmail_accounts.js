/**
 * Verify every connected Gmail account can both SEND and RECEIVE.
 *
 *   node server/verify_gmail_accounts.js
 *
 * Read-only — it never sends mail. For each account it:
 *   1. resolves which OAuth client owns it (GMAIL_OAUTH_CLIENTS),
 *   2. forces a token refresh, proving the refresh_token still pairs with
 *      that client (a mismatch fails here with invalid_grant),
 *   3. checks the granted scopes include gmail.send and gmail.readonly,
 *   4. runs the poller's own inbox query.
 *
 * Run this after connecting a new account, and any time mail silently stops.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { google } = require('googleapis');
const { getAuthedClient, resolveOAuthClient } = require('./utils/gmailClient');
const { getSupabaseClient } = require('./config/supabase-client');

const SCOPE_SEND = 'https://www.googleapis.com/auth/gmail.send';
const SCOPE_READ = 'https://www.googleapis.com/auth/gmail.readonly';

async function main() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('gmail_accounts').select('email').order('email');
  if (error) throw new Error(`Could not read gmail_accounts: ${error.message}`);

  const accounts = (data || []).map(r => r.email);
  if (accounts.length === 0) {
    console.log('No accounts in gmail_accounts. Connect one via /api/gmail/auth-url.');
    return;
  }

  const allowlist = (process.env.GMAIL_POLL_ACCOUNTS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  let failures = 0;

  for (const email of accounts) {
    console.log(`\n=== ${email} ===`);
    const owner = resolveOAuthClient(email);
    console.log(`  oauth client : ${owner.name} (${String(owner.clientId || '').split('-')[0]}…)`);

    const polled = allowlist.length === 0 || allowlist.includes(email.toLowerCase());
    console.log(`  polled       : ${polled ? '✅ yes' : '⚠️  NO — not in GMAIL_POLL_ACCOUNTS'}`);

    try {
      const auth = await getAuthedClient(email);

      const { token } = await auth.getAccessToken();
      if (!token) throw new Error('no access token returned');

      const info = await auth.getTokenInfo(token);
      const scopes = info.scopes || [];
      const canSend = scopes.includes(SCOPE_SEND);
      const canRead = scopes.includes(SCOPE_READ);
      console.log(`  SEND scope   : ${canSend ? '✅' : '❌ MISSING'}`);
      console.log(`  READ scope   : ${canRead ? '✅' : '❌ MISSING'}`);
      if (!canSend || !canRead) failures++;

      const gmail = google.gmail({ version: 'v1', auth });
      const { data: profile } = await gmail.users.getProfile({ userId: 'me' });
      console.log(`  mailbox      : ${profile.emailAddress} (${profile.messagesTotal} messages)`);
      if (String(profile.emailAddress).toLowerCase() !== email.toLowerCase()) {
        console.log('  ❌ MAILBOX MISMATCH — these tokens belong to a different account');
        failures++;
      }

      // The exact query gmailPoller.scanNewMessages() uses.
      const since = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
      const { data: list } = await gmail.users.messages.list({
        userId: 'me', q: `in:inbox after:${since}`, maxResults: 5
      });
      console.log(`  inbox read   : ✅ (${(list.messages || []).length} sampled from last 30d)`);
    } catch (e) {
      failures++;
      console.log(`  ❌ FAILED: ${e.message}`);
      if (e.message.includes('invalid_grant')) {
        console.log('     → refresh_token no longer valid for this OAuth client.');
        console.log(`     → reconnect: node server/connect_gmail_account.js --client=${owner.name}`);
      }
    }
  }

  console.log(failures === 0
    ? '\n✅ All accounts can send and receive.'
    : `\n❌ ${failures} problem(s) found.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch(e => {
  console.error('\n❌ Fatal:', e.message);
  process.exit(1);
});
