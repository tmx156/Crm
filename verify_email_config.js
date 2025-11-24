require('dotenv').config();
const path = require('path');

console.log('\n📧 Verifying Email Configuration...\n');

const emailUser = process.env.EMAIL_USER || process.env.GMAIL_USER;
const emailPass = process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS;

console.log('Email Configuration:');
console.log(`  EMAIL_USER: ${emailUser || '❌ NOT SET'}`);
console.log(`  GMAIL_USER: ${process.env.GMAIL_USER || '❌ NOT SET'}`);
console.log(`  EMAIL_PASSWORD: ${emailPass ? '✅ SET (' + emailPass.length + ' chars)' : '❌ NOT SET'}`);
console.log(`  GMAIL_PASS: ${process.env.GMAIL_PASS ? '✅ SET (' + process.env.GMAIL_PASS.length + ' chars)' : '❌ NOT SET'}`);

if (!emailUser) {
  console.log('\n❌ ERROR: Email address not configured!');
  console.log('   Set EMAIL_USER or GMAIL_USER in .env file');
  process.exit(1);
}

if (!emailPass) {
  console.log('\n❌ ERROR: Email password not configured!');
  console.log('   Set EMAIL_PASSWORD or GMAIL_PASS in .env file');
  console.log('   This should be your Gmail App Password (16 characters)');
  process.exit(1);
}

if (emailPass.length !== 16) {
  console.log(`\n⚠️  WARNING: Password length is ${emailPass.length} characters`);
  console.log('   Gmail App Passwords are typically 16 characters');
  console.log('   Make sure you copied the full app password (no spaces)');
}

console.log('\n✅ Email configuration looks good!');
console.log(`   Primary email: ${emailUser}`);
console.log(`   Password: ${emailPass.length} characters\n`);
