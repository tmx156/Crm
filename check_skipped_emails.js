/**
 * Check which emails were skipped and why
 */

require('dotenv').config();

const { google } = require('./server/node_modules/googleapis');
const { createClient } = require('./server/node_modules/@supabase/supabase-js');

const SUPABASE_URL = 'https://tnltvfzltdeilanxhlvy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function extractEmail(header) {
  if (!header) return null;
  const match = header.match(/<(.+?)>/) || header.match(/([^\s]+@[^\s]+)/);
  return match ? match[1].toLowerCase().trim() : header.toLowerCase().trim();
}

function getHeader(headers, name) {
  const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return header ? header.value : null;
}

async function checkSkippedEmails() {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 INVESTIGATING SKIPPED EMAILS');
  console.log('='.repeat(80) + '\n');

  // 1. Get Gmail OAuth tokens
  const { data: gmailAccount } = await supabase
    .from('gmail_accounts')
    .select('*')
    .eq('email', 'camrymodels.co.uk.crm.bookings@gmail.com')
    .single();

  if (!gmailAccount) {
    console.error('❌ No Gmail account found');
    return;
  }

  // 2. Create Gmail API client
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    'http://localhost:5000/api/gmail/callback'
  );

  oauth2Client.setCredentials({
    access_token: gmailAccount.access_token,
    refresh_token: gmailAccount.refresh_token,
    expiry_date: gmailAccount.expiry_date
  });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // 3. Fetch unread messages
  console.log('📧 Fetching unread messages from Gmail...\n');

  const listResponse = await gmail.users.messages.list({
    userId: 'me',
    labelIds: ['INBOX'],
    maxResults: 20,
    q: 'is:unread'
  });

  const messages = listResponse.data.messages || [];
  console.log(`Found ${messages.length} unread messages\n`);

  if (messages.length === 0) {
    console.log('✅ No unread messages - email poller is working!\n');
    return;
  }

  console.log('Checking each unread message:\n');

  let hasLead = 0;
  let noLead = 0;
  const noLeadEmails = [];

  for (const message of messages) {
    const fullMessage = await gmail.users.messages.get({
      userId: 'me',
      id: message.id,
      format: 'full'
    });

    const headers = fullMessage.data.payload.headers;
    const from = getHeader(headers, 'From');
    const subject = getHeader(headers, 'Subject') || 'No subject';
    const fromEmail = extractEmail(from);

    // Check if lead exists
    const { data: lead } = await supabase
      .from('leads')
      .select('id, name, email')
      .ilike('email', fromEmail)
      .limit(1)
      .maybeSingle();

    if (lead) {
      console.log(`✅ ${fromEmail} -> Lead: ${lead.name}`);
      hasLead++;
    } else {
      console.log(`❌ ${fromEmail} -> NO LEAD FOUND`);
      noLead++;
      noLeadEmails.push({ email: fromEmail, subject });
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('📊 SUMMARY');
  console.log('='.repeat(80) + '\n');

  console.log(`Total unread messages: ${messages.length}`);
  console.log(`✅ With matching lead: ${hasLead}`);
  console.log(`❌ Without matching lead: ${noLead}\n`);

  if (noLead > 0) {
    console.log('⚠️  EMAILS THAT CANNOT BE IMPORTED (No matching lead):\n');
    noLeadEmails.forEach((item, i) => {
      console.log(`${i + 1}. ${item.email}`);
      console.log(`   Subject: ${item.subject}`);
      console.log(`   Fix: Create a lead with email "${item.email}" in CRM\n`);
    });
  }

  if (hasLead > 0) {
    console.log('⚠️  EMAIL POLLER NOT RUNNING!');
    console.log(`   ${hasLead} emails are ready to import but poller is not processing them.\n`);
    console.log('   Possible causes:');
    console.log('   1. Server not running');
    console.log('   2. Email poller not started');
    console.log('   3. Poller crashed or stopped\n');
  }
}

checkSkippedEmails().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
