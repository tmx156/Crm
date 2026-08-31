/**
 * Gmail API Diagnostic - Comprehensive troubleshooting
 * Run this to identify OAuth issues
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { google } = require('googleapis');
const config = require('./config');

console.log('\n' + '='.repeat(80));
console.log('🔍 GMAIL API DIAGNOSTIC - Checking for OAuth Issues');
console.log('='.repeat(80) + '\n');

// 1. Check Environment Variables
console.log('1️⃣  ENVIRONMENT VARIABLES:');
console.log('   GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID || '❌ NOT SET');
console.log('   GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? '✅ SET (hidden)' : '❌ NOT SET');
console.log('   GOOGLE_REDIRECT_URI:', process.env.GOOGLE_REDIRECT_URI || '❌ NOT SET');
console.log('   EMAIL_USER:', process.env.EMAIL_USER || '❌ NOT SET');
console.log();

// 2. Extract Project Number from Client ID
const clientId = process.env.GOOGLE_CLIENT_ID;
if (clientId) {
  const match = clientId.match(/^([0-9]+)-/);
  if (match) {
    const projectNumber = match[1];
    console.log('2️⃣  GOOGLE CLOUD PROJECT INFO:');
    console.log('   Project Number:', projectNumber);
    console.log('   Console URL: https://console.cloud.google.com/home/dashboard?project=' + projectNumber);
    console.log('   OAuth URL: https://console.cloud.google.com/apis/credentials?project=' + projectNumber);
    console.log();
  }
}

// 3. Test OAuth2 Client Creation
console.log('3️⃣  OAUTH2 CLIENT TEST:');
try {
  const oauth2Client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
  console.log('   ✅ OAuth2 client created successfully');
  
  // Generate auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.send']
  });
  console.log('   ✅ Auth URL generated successfully');
  console.log('   URL Length:', authUrl.length, 'characters');
  console.log();
  
  // Parse and display URL components
  const url = new URL(authUrl);
  console.log('4️⃣  AUTH URL COMPONENTS:');
  console.log('   Base URL:', url.origin + url.pathname);
  console.log('   client_id:', url.searchParams.get('client_id'));
  console.log('   redirect_uri:', url.searchParams.get('redirect_uri'));
  console.log('   scope:', url.searchParams.get('scope'));
  console.log('   access_type:', url.searchParams.get('access_type'));
  console.log('   response_type:', url.searchParams.get('response_type'));
  console.log();
  
} catch (error) {
  console.log('   ❌ FAILED:', error.message);
  console.log();
}

// 4. Common Issues Check
console.log('5️⃣  COMMON ISSUES CHECKLIST:');
console.log();
console.log('   ⬜ Check 1: Is Gmail API enabled?');
console.log('      → Go to: https://console.cloud.google.com/apis/library/gmail.googleapis.com');
console.log('      → Make sure it says "API enabled"');
console.log();
console.log('   ⬜ Check 2: Is OAuth consent screen configured?');
console.log('      → Go to: https://console.cloud.google.com/apis/credentials/consent');
console.log('      → App name, user support email, and developer email must be filled');
console.log('      → Look at top: should say "Testing" or "In production"');
console.log();
console.log('   ⬜ Check 3: Is the email added as a test user?');
console.log('      → Go to: https://console.cloud.google.com/apis/credentials/consent');
console.log('      → Scroll to "Test users" section');
console.log('      → Must have:', process.env.EMAIL_USER || 'your email here');
console.log();
console.log('   ⬜ Check 4: Is the redirect URI exactly correct?');
console.log('      → Go to: https://console.cloud.google.com/apis/credentials');
console.log('      → Click your OAuth 2.0 Client ID');
console.log('      → Check "Authorized redirect URIs"');
console.log('      → Must have EXACTLY:', config.google.redirectUri);
console.log('      → NO trailing slash, use http not https, localhost not 127.0.0.1');
console.log();

// 5. Direct Auth URL for testing
console.log('='.repeat(80));
console.log('🔗 DIRECT AUTH URL (Copy this entire URL and open in browser):');
console.log('='.repeat(80));
console.log();

const directUrl = `https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&prompt=consent&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.send&response_type=code&client_id=${encodeURIComponent(config.google.clientId)}&redirect_uri=${encodeURIComponent(config.google.redirectUri)}`;

console.log(directUrl);
console.log();
console.log('='.repeat(80));

// 6. Manual test instructions
console.log('\n6️⃣  MANUAL TEST INSTRUCTIONS:');
console.log();
console.log('   Step 1: Make sure you are signed into Google with:');
console.log('           ', process.env.EMAIL_USER || 'your email');
console.log('   Step 2: Copy the URL above');
console.log('   Step 3: Open a NEW incognito/private browser window');
console.log('   Step 4: Go to https://gmail.com and sign in first');
console.log('   Step 5: Then paste the URL in the same window');
console.log();
console.log('   If you get "Request is missing required authentication credential":');
console.log('   → The email is NOT in the test users list');
console.log('   → OR the OAuth consent screen is incomplete');
console.log('   → OR the Gmail API is not enabled');
console.log();

console.log('='.repeat(80));
console.log('End of diagnostic');
console.log('='.repeat(80) + '\n');

process.exit(0);
