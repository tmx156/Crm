/**
 * Manual Gmail OAuth - Step by Step
 * 
 * This script helps you manually complete the OAuth flow
 * when the automatic callback is having issues.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { google } = require('googleapis');
const config = require('./config');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\n' + '='.repeat(80));
console.log('🔐 GMAIL OAUTH - MANUAL AUTHORIZATION');
console.log('='.repeat(80));
console.log();
console.log('Email to authorize:', config.email.user || process.env.EMAIL_USER);
console.log();

// Create OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  config.google.clientId,
  config.google.clientSecret,
  config.google.redirectUri
);

// Generate auth URL
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/gmail.send']
});

console.log('1️⃣  Open this URL in your browser:');
console.log();
console.log(authUrl);
console.log();
console.log('2️⃣  Sign in with:', config.email.user || process.env.EMAIL_USER);
console.log('3️⃣  Click "Allow" when prompted');
console.log('4️⃣  You will be redirected to localhost (might show an error page - that\'s OK!)');
console.log('5️⃣  Look at the browser address bar and copy the CODE from the URL');
console.log('   The URL looks like: http://localhost:5000/api/gmail/callback?code=XXXXX');
console.log('   Copy ONLY the XXXXX part (the code)');
console.log();

rl.question('6️⃣  Paste the code here and press Enter: ', async (code) => {
  code = code.trim();
  
  if (!code) {
    console.log('❌ No code provided');
    rl.close();
    process.exit(1);
  }
  
  console.log();
  console.log('Exchanging code for tokens...');
  
  try {
    const { tokens } = await oauth2Client.getToken(code);
    
    console.log();
    console.log('✅ SUCCESS! Tokens received:');
    console.log('   Access Token:', tokens.access_token ? '✅ (present)' : '❌ (missing)');
    console.log('   Refresh Token:', tokens.refresh_token ? '✅ (present)' : '❌ (missing)');
    console.log('   Expiry Date:', tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'N/A');
    console.log();
    
    // Get user info
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();
    
    console.log('   Email:', userInfo.email);
    console.log('   Name:', userInfo.name);
    console.log();
    
    // Save to Supabase
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.anonKey);
    
    const row = {
      email: userInfo.email,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      updated_at: new Date().toISOString()
    };
    
    // Check if exists
    const { data: existing } = await supabase
      .from('gmail_accounts')
      .select('email')
      .eq('email', userInfo.email)
      .single();
    
    if (existing) {
      await supabase.from('gmail_accounts').update(row).eq('email', userInfo.email);
      console.log('✅ Updated existing record in Supabase');
    } else {
      row.created_at = new Date().toISOString();
      await supabase.from('gmail_accounts').insert(row);
      console.log('✅ Created new record in Supabase');
    }
    
    console.log();
    console.log('🎉 Gmail API is now authorized!');
    console.log('   You can now send emails via the Gmail API.');
    console.log();
    
  } catch (error) {
    console.log();
    console.log('❌ ERROR exchanging code:', error.message);
    console.log();
    console.log('Possible causes:');
    console.log('   - Code expired (codes are only valid for ~10 minutes)');
    console.log('   - Code was already used');
    console.log('   - Wrong redirect_uri configured in Google Cloud');
    console.log('   - Client ID/Secret mismatch');
    console.log();
    console.log('Full error:', error);
  }
  
  rl.close();
  process.exit(0);
});
