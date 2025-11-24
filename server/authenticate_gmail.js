require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { google } = require('googleapis');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
  console.error('❌ Missing Google OAuth credentials in .env:');
  console.error('   GOOGLE_CLIENT_ID:', GOOGLE_CLIENT_ID ? '✅' : '❌');
  console.error('   GOOGLE_CLIENT_SECRET:', GOOGLE_CLIENT_SECRET ? '✅' : '❌');
  console.error('   GOOGLE_REDIRECT_URI:', GOOGLE_REDIRECT_URI ? '✅' : '❌');
  process.exit(1);
}

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid'
];

function createOAuthClient() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

console.log('📧 Gmail API Authentication Helper (Camry Models)\n');
console.log('This script will generate the authentication URL for Camry Models Gmail account.\n');

const oAuth2Client = createOAuthClient();

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: GMAIL_SCOPES
});

console.log('🔗 Gmail Authentication URL:');
console.log('\n' + authUrl + '\n');
console.log('📋 Instructions:');
console.log('   1. Copy the URL above');
console.log('   2. Open it in your browser');
console.log('   3. Sign in with: camrymodels.co.uk.crm.bookings@gmail.com');
console.log('   4. Grant the requested permissions');
console.log('   5. You will be redirected to a success page');
console.log('\n⚠️  Make sure your server is running on http://localhost:5000');
console.log('    Run: npm start (in a separate terminal)\n');
