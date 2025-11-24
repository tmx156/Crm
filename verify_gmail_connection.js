require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
const config = require('./server/config');

(async () => {
  console.log('\n🔍 VERIFYING GMAIL API CONNECTION\n');
  console.log('='.repeat(80));

  const email = 'camrymodels.co.uk.crm.bookings@gmail.com';

  try {
    // Check database for tokens
    const supabase = createClient(
      config.supabase.url,
      config.supabase.serviceRoleKey || config.supabase.anonKey
    );

    console.log('\n1️⃣ Checking OAuth tokens in database...');
    const { data: account, error } = await supabase
      .from('gmail_accounts')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (error) {
      console.log('   ❌ Error:', error.message);
      process.exit(1);
    }

    if (!account) {
      console.log('   ❌ No tokens found for', email);
      console.log('   📝 Please authenticate first: http://localhost:5000/api/gmail/auth-url');
      process.exit(1);
    }

    console.log('   ✅ Tokens found in database');
    console.log('      Access Token:', account.access_token ? '✅ Present' : '❌ Missing');
    console.log('      Refresh Token:', account.refresh_token ? '✅ Present' : '❌ Missing');

    // Test Gmail API connection
    console.log('\n2️⃣ Testing Gmail API connection...');
    const oauth2Client = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      config.google.redirectUri
    );

    oauth2Client.setCredentials({
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      token_type: account.token_type || 'Bearer',
      expiry_date: account.expiry_date
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Test connection
    const profile = await gmail.users.getProfile({ userId: 'me' });
    console.log('   ✅ Gmail API connection successful!');
    console.log('      Email:', profile.data.emailAddress);
    console.log('      Total messages:', profile.data.messagesTotal);
    console.log('      Threads:', profile.data.threadsTotal);

    // Test listing messages
    console.log('\n3️⃣ Testing message retrieval...');
    const messages = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 5
    });

    console.log('   ✅ Can retrieve messages');
    console.log('      Found', messages.data.messages?.length || 0, 'recent messages');

    console.log('\n' + '='.repeat(80));
    console.log('\n✅ ALL CHECKS PASSED!');
    console.log('   Gmail API is fully configured and working');
    console.log('   Your server can now poll emails using Gmail API\n');

  } catch (error) {
    console.log('\n❌ ERROR:', error.message);
    if (error.code === 401) {
      console.log('   ⚠️  Token may be expired. Try re-authenticating.');
    }
    process.exit(1);
  }

  process.exit(0);
})();

