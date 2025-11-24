const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');

console.log('\n🔄 Swapping to Camry Models email only...\n');

// Read current .env file
if (!fs.existsSync(envPath)) {
  console.error('❌ .env file not found!');
  process.exit(1);
}

let envContent = fs.readFileSync(envPath, 'utf8');

// Store current values
const camryEmail = 'camrymodels.co.uk.crm.bookings@gmail.com';
let camryPassword = null;

// Extract Camry password from EMAIL_USER_2 or EMAIL_PASSWORD_2
const password2Match = envContent.match(/EMAIL_PASSWORD_2=(.+)/);
if (password2Match) {
  camryPassword = password2Match[1].trim();
}

// If no EMAIL_PASSWORD_2, try to get from current EMAIL_USER_2 section
if (!camryPassword) {
  const passwordMatch = envContent.match(/EMAIL_PASSWORD=(.+)/);
  if (passwordMatch && envContent.includes('EMAIL_USER_2=camrymodels')) {
    // Might be using same password
    camryPassword = passwordMatch[1].trim();
  }
}

console.log('📧 Current configuration:');
const currentPrimary = envContent.match(/EMAIL_USER=(.+)/);
const currentSecondary = envContent.match(/EMAIL_USER_2=(.+)/);
console.log('   Primary (EMAIL_USER):', currentPrimary ? currentPrimary[1].trim() : 'NOT SET');
console.log('   Secondary (EMAIL_USER_2):', currentSecondary ? currentSecondary[1].trim() : 'NOT SET');

// Swap: Move Camry to primary, remove Avensis
console.log('\n🔄 Making changes...');

// Remove or comment out Avensis (primary)
envContent = envContent.replace(/^EMAIL_USER=avensismodels[^\n]*/gm, '# EMAIL_USER=avensismodels.co.uk.crm.bookings@gmail.com (REMOVED - using Camry only)');

// Move Camry from EMAIL_USER_2 to EMAIL_USER
if (envContent.includes('EMAIL_USER_2=camrymodels')) {
  envContent = envContent.replace(/^EMAIL_USER_2=camrymodels[^\n]*/gm, '# EMAIL_USER_2=camrymodels.co.uk.crm.bookings@gmail.com (MOVED TO PRIMARY)');
  
  // Add Camry as primary
  if (!envContent.includes('EMAIL_USER=camrymodels')) {
    // Find where to insert (after commented EMAIL_USER or at top)
    const emailUserIndex = envContent.indexOf('EMAIL_USER');
    if (emailUserIndex !== -1) {
      // Insert after the commented line
      const insertIndex = envContent.indexOf('\n', emailUserIndex);
      envContent = envContent.slice(0, insertIndex) + 
        '\nEMAIL_USER=' + camryEmail +
        envContent.slice(insertIndex);
    } else {
      // Add at end
      envContent += '\nEMAIL_USER=' + camryEmail + '\n';
    }
  }
}

// Update password if we found it
if (camryPassword && !envContent.includes('EMAIL_PASSWORD=' + camryPassword)) {
  // Comment out old EMAIL_PASSWORD if it was for Avensis
  envContent = envContent.replace(/^EMAIL_PASSWORD=(.+)/gm, (match, pwd) => {
    if (match.includes('avensis') || !match.includes('camry')) {
      return '# EMAIL_PASSWORD=' + pwd + ' (OLD - Avensis password)';
    }
    return match;
  });
  
  // Add new password
  if (!envContent.match(/^EMAIL_PASSWORD=/m)) {
    envContent += '\nEMAIL_PASSWORD=' + camryPassword + '\n';
  }
}

// Remove EMAIL_PASSWORD_2 if it exists
envContent = envContent.replace(/^EMAIL_PASSWORD_2=(.+)/gm, '# EMAIL_PASSWORD_2=$1 (REMOVED - using primary only)');

// Backup original
const backupPath = envPath + '.backup.' + Date.now();
fs.writeFileSync(backupPath, fs.readFileSync(envPath));
console.log('   ✅ Backup created:', backupPath);

// Write updated .env
fs.writeFileSync(envPath, envContent);
console.log('   ✅ .env file updated\n');

console.log('📋 Summary of changes:');
console.log('   ✅ EMAIL_USER now set to: camrymodels.co.uk.crm.bookings@gmail.com');
console.log('   ✅ EMAIL_USER_2 commented out/removed');
console.log('   ✅ Avensis Models email removed\n');

console.log('📝 Next steps:');
console.log('   1. Verify .env file looks correct');
console.log('   2. Restart your server');
console.log('   3. Authenticate Gmail API if needed: http://localhost:5000/api/gmail/auth-url');
console.log('   4. Sign in with: camrymodels.co.uk.crm.bookings@gmail.com\n');

console.log('✅ Done! Your CRM will now use only Camry Models email.\n');

