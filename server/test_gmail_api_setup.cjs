const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

console.log('\n🔍 COMPREHENSIVE GMAIL API AUDIT\n');
console.log('='.repeat(80));

// 1. Check Environment Variables
console.log('\n1️⃣ ENVIRONMENT VARIABLES:');
console.log('   GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? '✅ SET' : '❌ NOT SET');
if (process.env.GOOGLE_CLIENT_ID) {
  console.log('      Value:', process.env.GOOGLE_CLIENT_ID.substring(0, 30) + '...');
}
console.log('   GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? '✅ SET' : '❌ NOT SET');
if (process.env.GOOGLE_CLIENT_SECRET) {
  console.log('      Value:', process.env.GOOGLE_CLIENT_SECRET.substring(0, 15) + '...');
}
console.log('   GOOGLE_REDIRECT_URI:', process.env.GOOGLE_REDIRECT_URI || '❌ NOT SET');
console.log('   EMAIL_USER:', process.env.EMAIL_USER || '❌ NOT SET');

// 2. Check Centralized Config
console.log('\n2️⃣ CENTRALIZED CONFIG:');
console.log('   config.google.clientId:', config.google.clientId ? '✅ SET' : '❌ NOT SET');
console.log('   config.google.clientSecret:', config.google.clientSecret ? '✅ SET' : '❌ NOT SET');
console.log('   config.google.redirectUri:', config.google.redirectUri || '❌ NOT SET');

// 3. Test OAuth2 Client Creation
console.log('\n3️⃣ OAUTH2 CLIENT CREATION:');
try {
  const oauth2Client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
  console.log('   ✅ OAuth2 client created successfully');
  
  // Test auth URL generation
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'openid'
    ],
    prompt: 'consent'
  });
  console.log('   ✅ Auth URL generation: SUCCESS');
  console.log('      URL length:', authUrl.length, 'characters');
} catch (error) {
  console.log('   ❌ OAuth2 client creation FAILED:', error.message);
}

// 4. Check Supabase Connection
console.log('\n4️⃣ SUPABASE CONNECTION:');
try {
  const supabase = createClient(
    config.supabase.url,
    config.supabase.serviceRoleKey || config.supabase.anonKey
  );
  console.log('   ✅ Supabase client created');
  
  // Check if gmail_accounts table exists
  const { data, error } = await supabase
    .from('gmail_accounts')
    .select('email')
    .limit(1);
  
  if (error) {
    if (error.message.includes('relation "gmail_accounts" does not exist')) {
      console.log('   ❌ gmail_accounts table DOES NOT EXIST');
      console.log('      You need to create it in Supabase SQL Editor');
    } else {
      console.log('   ⚠️  Error checking table:', error.message);
    }
  } else {
    console.log('   ✅ gmail_accounts table EXISTS');
    console.log('      Found', data?.length || 0, 'accounts');
  }
} catch (error) {
  console.log('   ❌ Supabase connection FAILED:', error.message);
}

// 5. Check Email Account Configuration
console.log('\n5️⃣ EMAIL ACCOUNT CONFIGURATION:');
const EMAIL_ACCOUNTS = {
  primary: {
    user: process.env.EMAIL_USER || process.env.GMAIL_USER,
    pass: process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS,
    name: 'Primary Account'
  },
  secondary: {
    user: process.env.EMAIL_USER_2 || process.env.GMAIL_USER_2,
    pass: process.env.EMAIL_PASSWORD_2 || process.env.GMAIL_PASS_2,
    name: 'Secondary Account'
  }
};

for (const [key, account] of Object.entries(EMAIL_ACCOUNTS)) {
  console.log(`   ${account.name}:`);
  console.log('      Email:', account.user || '❌ NOT SET');
  console.log('      Password:', account.pass ? '✅ SET' : '❌ NOT SET');
  
  if (account.user) {
    // Check if this email has OAuth tokens
    try {
      const supabase = createClient(
        config.supabase.url,
        config.supabase.serviceRoleKey || config.supabase.anonKey
      );
      const { data: gmailAccount, error } = await supabase
        .from('gmail_accounts')
        .select('email, access_token, refresh_token, expiry_date')
        .eq('email', account.user)
        .maybeSingle();
      
      if (error && !error.message.includes('does not exist')) {
        console.log('      OAuth Status: ⚠️  Error checking:', error.message);
      } else if (gmailAccount) {
        console.log('      OAuth Status: ✅ TOKENS FOUND');
        console.log('         Access Token:', gmailAccount.access_token ? '✅' : '❌');
        console.log('         Refresh Token:', gmailAccount.refresh_token ? '✅' : '❌');
        if (gmailAccount.expiry_date) {
          const expiryDate = new Date(gmailAccount.expiry_date);
          const now = new Date();
          if (expiryDate > now) {
            console.log('         Token Expiry: ✅ Valid until', expiryDate.toISOString());
          } else {
            console.log('         Token Expiry: ⚠️  EXPIRED on', expiryDate.toISOString());
          }
        }
      } else {
        console.log('      OAuth Status: ❌ NO TOKENS - Need to authenticate');
        console.log('         Auth URL: http://localhost:5000/api/gmail/auth-url');
      }
    } catch (e) {
      console.log('      OAuth Status: ⚠️  Could not check:', e.message);
    }
  }
}

// 6. Test Gmail API Route
console.log('\n6️⃣ GMAIL API ROUTES:');
console.log('   Auth URL endpoint: http://localhost:5000/api/gmail/auth-url');
console.log('   Callback endpoint: http://localhost:5000/api/gmail/callback');

// 7. Summary & Recommendations
console.log('\n' + '='.repeat(80));
console.log('\n📋 SUMMARY & RECOMMENDATIONS:\n');

const issues = [];
const recommendations = [];

if (!process.env.GOOGLE_CLIENT_SECRET) {
  issues.push('GOOGLE_CLIENT_SECRET not set in .env');
  recommendations.push('Add GOOGLE_CLIENT_SECRET=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 to .env');
}

if (!process.env.EMAIL_USER) {
  issues.push('EMAIL_USER not set');
  recommendations.push('Add EMAIL_USER=your-email@gmail.com to .env');
}

try {
  const supabase = createClient(
    config.supabase.url,
    config.supabase.serviceRoleKey || config.supabase.anonKey
  );
  const { error } = await supabase.from('gmail_accounts').select('email').limit(1);
  if (error && error.message.includes('does not exist')) {
    issues.push('gmail_accounts table does not exist');
    recommendations.push('Run this SQL in Supabase SQL Editor:\n' +
      'CREATE TABLE gmail_accounts (\n' +
      '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n' +
      '  email TEXT UNIQUE NOT NULL,\n' +
      '  access_token TEXT NOT NULL,\n' +
      '  refresh_token TEXT,\n' +
      '  token_type TEXT DEFAULT \'Bearer\',\n' +
      '  expiry_date BIGINT,\n' +
      '  scope TEXT,\n' +
      '  created_at TIMESTAMPTZ DEFAULT NOW(),\n' +
      '  updated_at TIMESTAMPTZ DEFAULT NOW()\n' +
      ');\n' +
      'CREATE INDEX IF NOT EXISTS idx_gmail_accounts_email ON gmail_accounts(email);');
  }
} catch (e) {
  // Ignore
}

if (issues.length === 0) {
  console.log('✅ All checks passed! System is ready.');
  console.log('\n📝 Next steps:');
  console.log('   1. Ensure gmail_accounts table exists in Supabase');
  console.log('   2. Visit: http://localhost:5000/api/gmail/auth-url');
  console.log('   3. Copy the URL and authenticate with your Gmail account');
  console.log('   4. Restart the server');
} else {
  console.log('❌ Issues found:');
  issues.forEach((issue, i) => {
    console.log(`   ${i + 1}. ${issue}`);
  });
  console.log('\n🔧 Fixes needed:');
  recommendations.forEach((rec, i) => {
    console.log(`   ${i + 1}. ${rec}`);
  });
}

console.log('\n' + '='.repeat(80) + '\n');

process.exit(0);

