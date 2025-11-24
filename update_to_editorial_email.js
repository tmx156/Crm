const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '.env');
const NEW_EMAIL = 'theeditorialco.crm.bookings@gmail.com';

console.log('\n📧 Updating .env file to use new primary email...\n');

// Read current .env file
let envContent = '';
if (fs.existsSync(ENV_FILE)) {
  envContent = fs.readFileSync(ENV_FILE, 'utf8');
  console.log('✅ Found existing .env file');
} else {
  console.log('⚠️  .env file not found, will create new one');
}

// Backup current .env
const backupPath = `${ENV_FILE}.backup.${Date.now()}`;
if (fs.existsSync(ENV_FILE)) {
  fs.copyFileSync(ENV_FILE, backupPath);
  console.log(`✅ Backed up .env to ${path.basename(backupPath)}`);
}

// Parse existing env variables
const envLines = envContent.split('\n');
const envVars = {};
const newLines = [];

envLines.forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    newLines.push(line);
    return;
  }
  
  const match = trimmed.match(/^([^=]+)=(.*)$/);
  if (match) {
    const key = match[1].trim();
    const value = match[2].trim();
    envVars[key] = value;
  } else {
    newLines.push(line);
  }
});

// Update email variables
console.log('\n📝 Updating email configuration:');
console.log(`   Primary Email: ${NEW_EMAIL}`);

// Remove old email variables
const keysToRemove = [
  'EMAIL_USER',
  'GMAIL_USER',
  'EMAIL_USER_2',
  'GMAIL_USER_2',
  'EMAIL_PASSWORD_2',
  'GMAIL_PASS_2'
];

keysToRemove.forEach(key => {
  if (envVars[key]) {
    console.log(`   ❌ Removing: ${key}`);
    delete envVars[key];
  }
});

// Set new primary email
envVars['EMAIL_USER'] = NEW_EMAIL;
envVars['GMAIL_USER'] = NEW_EMAIL;
console.log(`   ✅ Set EMAIL_USER=${NEW_EMAIL}`);
console.log(`   ✅ Set GMAIL_USER=${NEW_EMAIL}`);

// Check if password is already set
if (!envVars['EMAIL_PASSWORD'] && !envVars['GMAIL_PASS']) {
  console.log('\n⚠️  WARNING: EMAIL_PASSWORD or GMAIL_PASS not found in .env');
  console.log('   Please add your Gmail App Password manually:');
  console.log(`   EMAIL_PASSWORD=your-app-password-here`);
  console.log(`   GMAIL_PASS=your-app-password-here`);
} else {
  console.log('   ✅ Email password already configured');
}

// Rebuild .env content
const updatedContent = [];

// Add all non-email variables first
Object.keys(envVars).forEach(key => {
  if (!key.includes('EMAIL') && !key.includes('GMAIL')) {
    updatedContent.push(`${key}=${envVars[key]}`);
  }
});

// Add email configuration section
updatedContent.push('');
updatedContent.push('# Email Configuration - Primary Account');
updatedContent.push(`EMAIL_USER=${NEW_EMAIL}`);
updatedContent.push(`GMAIL_USER=${NEW_EMAIL}`);
if (envVars['EMAIL_PASSWORD']) {
  updatedContent.push(`EMAIL_PASSWORD=${envVars['EMAIL_PASSWORD']}`);
}
if (envVars['GMAIL_PASS']) {
  updatedContent.push(`GMAIL_PASS=${envVars['GMAIL_PASS']}`);
}

// Write updated .env
fs.writeFileSync(ENV_FILE, updatedContent.join('\n') + '\n', 'utf8');

console.log('\n✅ .env file updated successfully!');
console.log(`\n📧 Primary email account: ${NEW_EMAIL}`);
console.log('\n⚠️  IMPORTANT: Make sure EMAIL_PASSWORD or GMAIL_PASS is set with your Gmail App Password');
console.log('   If not set, add it manually to the .env file\n');
