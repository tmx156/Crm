/**
 * Connect a Gmail account to the CRM (send + receive).
 *
 *   node server/connect_gmail_account.js [--client=<name>]
 *
 * --client selects an entry from GMAIL_OAUTH_CLIENTS, for accounts that live in
 * a different Google Cloud project than the primary one. Defaults to primary.
 *
 * Requests the full scope set the CRM needs (send, readonly, userinfo.email),
 * exchanges the code, and upserts the tokens into `gmail_accounts` so both the
 * sender (utils/emailService.js) and the poller (utils/gmailPoller.js) can use
 * the account.
 *
 * Use this instead of gmail_manual_auth.js when adding a NEW account —
 * that script only asks for gmail.send, so the poller can't read the inbox.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { google } = require('googleapis');
const readline = require('readline');
const config = require('./config');
const { getOAuthClientByName, resolveOAuthClient } = require('./utils/gmailClient');
const { createClient } = require('@supabase/supabase-js');

// Must match SCOPES in routes/gmail-auth.js
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email'
];

/** Accept either a bare code or the whole redirect URL pasted from the browser. */
function parseCode(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      return new URL(trimmed).searchParams.get('code');
    } catch {
      return null;
    }
  }
  return trimmed;
}

async function main() {
  const clientArg = (process.argv.find(a => a.startsWith('--client=')) || '').split('=')[1] || 'primary';
  const creds = getOAuthClientByName(clientArg);

  if (!creds) {
    console.error(`❌ Unknown OAuth client "${clientArg}". Configured:`,
      ['primary', ...(config.google.extraClients || []).map(c => c.name)].join(', '));
    process.exit(1);
  }

  if (!creds.clientId || !creds.clientSecret) {
    console.error(`❌ OAuth client "${creds.name}" has no clientId/clientSecret configured`);
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(
    creds.clientId,
    creds.clientSecret,
    creds.redirectUri
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // forces a refresh_token even on re-auth
    scope: SCOPES
  });

  console.log('\n' + '='.repeat(80));
  console.log('🔐 CONNECT A GMAIL ACCOUNT TO THE CRM');
  console.log('='.repeat(80));
  console.log();
  console.log('OAuth client:      ', creds.name, `(${creds.clientId.split('-')[0]}…)`);
  console.log('Redirect URI in use:', creds.redirectUri);
  console.log('(This exact URI must be listed in the Google Cloud OAuth client.)');
  console.log();
  console.log('1️⃣  Open this URL in a browser where you are signed OUT of other Google accounts:');
  console.log();
  console.log(authUrl);
  console.log();
  console.log('2️⃣  Sign in as the account you want to add and click Allow.');
  console.log('3️⃣  You land on the redirect URI. If the server is running it saves automatically');
  console.log('    and you can Ctrl+C here. Otherwise the page errors — that is fine.');
  console.log('4️⃣  Copy the full address-bar URL (or just the ?code=... value).');
  console.log();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve =>
    rl.question('5️⃣  Paste the code or redirect URL here: ', resolve)
  );
  rl.close();

  const code = parseCode(answer);
  if (!code) {
    console.error('❌ No code found in that input.');
    process.exit(1);
  }

  console.log('\nExchanging code for tokens...');
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  if (!tokens.refresh_token) {
    console.warn('⚠️  No refresh_token returned. Revoke CRM access for this account at');
    console.warn('    https://myaccount.google.com/permissions and run this again.');
  }

  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data: userInfo } = await oauth2.userinfo.get();
  const email = userInfo.email;
  console.log(`✅ Authorised: ${email}`);

  const supabase = createClient(
    config.supabase.url,
    config.supabase.serviceRoleKey || config.supabase.anonKey
  );

  const row = {
    email,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
    updated_at: new Date().toISOString()
  };

  const { data: existing } = await supabase
    .from('gmail_accounts')
    .select('email')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from('gmail_accounts').update(row).eq('email', email);
    if (error) throw error;
    console.log('✅ Updated existing gmail_accounts row');
  } else {
    row.created_at = new Date().toISOString();
    const { error } = await supabase.from('gmail_accounts').insert(row);
    if (error) throw error;
    console.log('✅ Inserted new gmail_accounts row');
  }

  // Sanity check both directions the CRM relies on.
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const { data: profile } = await gmail.users.getProfile({ userId: 'me' });
  console.log(`✅ Gmail API reachable (${profile.messagesTotal} messages in mailbox)`);

  const allowlist = (process.env.GMAIL_POLL_ACCOUNTS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  console.log('\nNext steps:');

  const owningClient = resolveOAuthClient(email);
  if (owningClient.name !== creds.name) {
    console.log(`  • ⚠️  REQUIRED: add "${email}" to the "${creds.name}" entry's accounts list`);
    console.log('    in GMAIL_OAUTH_CLIENTS. Without it, token refresh uses the');
    console.log(`    "${owningClient.name}" client and will fail with invalid_grant.`);
  }

  if (allowlist.length > 0 && !allowlist.includes(email.toLowerCase())) {
    console.log(`  • Add ${email} to GMAIL_POLL_ACCOUNTS in .env (and Railway) or its inbox`);
    console.log('    will NOT be polled. Current allowlist:', allowlist.join(', '));
  }
  console.log(`  • Add a display name for ${email} to GMAIL_ACCOUNT_NAMES in .env`);
  console.log('    (otherwise outbound mail falls back to the default sender name).');
  console.log('  • Restart the server, then pick the account per-template under "Send From".');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ Failed:', err.message);
    if (err.response?.data) console.error(err.response.data);
    process.exit(1);
  });
