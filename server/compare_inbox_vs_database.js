const { ImapFlow } = require('imapflow');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const EMAIL_USER = process.env.EMAIL_USER || process.env.GMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

(async () => {
  console.log('🔍 COMPARING INBOX VS DATABASE\n');
  console.log('='.repeat(80));

  // 1. GET ALL EMAILS FROM INBOX
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    logger: false
  });

  await client.connect();
  await client.mailboxOpen('INBOX');
  const status = await client.status('INBOX', { messages: true });

  console.log(`\n📧 Gmail Inbox: ${status.messages} total emails`);

  // Fetch ALL emails (just UIDs and envelopes)
  const inboxEmails = [];
  for await (const message of client.fetch(`1:${status.messages}`, {
    uid: true,
    envelope: true,
    internalDate: true
  })) {
    inboxEmails.push({
      uid: message.uid,
      from: message.envelope?.from?.[0]?.address,
      subject: message.envelope?.subject,
      date: message.internalDate || message.envelope?.date
    });
  }

  await client.logout();

  console.log(`✅ Fetched ${inboxEmails.length} emails from inbox\n`);

  // 2. GET ALL EMAILS FROM DATABASE
  const { data: dbEmails } = await supabase
    .from('messages')
    .select('*')
    .eq('type', 'email');

  console.log(`💾 Database: ${dbEmails.length} emails\n`);

  // 3. COMPARE
  console.log('='.repeat(80));
  console.log('\n🔍 ANALYSIS:\n');

  // Check which inbox emails are NOT in database
  const inboxByUID = new Map(inboxEmails.map(e => [e.uid, e]));
  const dbByUID = new Map(dbEmails.map(e => [e.imap_uid, e]));

  const missingFromDB = [];
  inboxEmails.forEach(email => {
    if (!dbByUID.has(email.uid.toString())) {
      missingFromDB.push(email);
    }
  });

  console.log(`❌ Emails in inbox but NOT in database: ${missingFromDB.length}\n`);

  if (missingFromDB.length > 0) {
    console.log('Missing emails (showing last 20):');
    missingFromDB.slice(-20).forEach((email, i) => {
      console.log(`  ${i + 1}. UID ${email.uid}: From ${email.from}`);
      console.log(`     Subject: ${email.subject?.substring(0, 60)}`);
      console.log(`     Date: ${email.date}`);
      console.log('');
    });
  }

  // Check sender distribution
  console.log('\n📊 SENDER ANALYSIS (Missing emails):\n');
  const missingSenders = {};
  missingFromDB.forEach(email => {
    const sender = email.from || 'Unknown';
    missingSenders[sender] = (missingSenders[sender] || 0) + 1;
  });

  const sortedMissing = Object.entries(missingSenders).sort((a, b) => b[1] - a[1]);
  sortedMissing.slice(0, 20).forEach(([email, count]) => {
    console.log(`  ${email}: ${count} missing emails`);
  });

  // Check which senders ARE in database
  console.log('\n\n✅ SENDERS THAT ARE BEING IMPORTED:\n');
  const dbSenders = {};
  dbEmails.forEach(email => {
    const sender = email.sent_by || 'Unknown';
    dbSenders[sender] = (dbSenders[sender] || 0) + 1;
  });

  const sortedDB = Object.entries(dbSenders).sort((a, b) => b[1] - a[1]);
  sortedDB.slice(0, 20).forEach(([email, count]) => {
    console.log(`  ${email}: ${count} emails`);
  });

  // Check if missing senders have matching leads
  console.log('\n\n🔍 CHECKING IF MISSING SENDERS HAVE LEADS:\n');

  const { data: leads } = await supabase
    .from('leads')
    .select('id, name, email');

  const uniqueMissingSenders = [...new Set(missingFromDB.map(e => e.from))].filter(Boolean);

  console.log(`Checking ${uniqueMissingSenders.length} unique missing senders...\n`);

  uniqueMissingSenders.slice(0, 30).forEach(sender => {
    const matchingLead = leads.find(l =>
      l.email && l.email.toLowerCase() === sender.toLowerCase()
    );

    if (matchingLead) {
      console.log(`  ✅ ${sender}: HAS LEAD (${matchingLead.name})`);
    } else {
      console.log(`  ❌ ${sender}: NO MATCHING LEAD`);
    }
  });

  console.log('\n' + '='.repeat(80));
  console.log('\n📋 SUMMARY:\n');
  console.log(`Total emails in inbox: ${inboxEmails.length}`);
  console.log(`Total emails in database: ${dbEmails.length}`);
  console.log(`Missing from database: ${missingFromDB.length}`);
  console.log(`Import rate: ${((dbEmails.length / inboxEmails.length) * 100).toFixed(1)}%`);

  const withLeads = uniqueMissingSenders.filter(sender =>
    leads.find(l => l.email && l.email.toLowerCase() === sender.toLowerCase())
  ).length;

  console.log(`\nMissing senders with leads: ${withLeads}/${uniqueMissingSenders.length}`);
  console.log(`Missing senders WITHOUT leads: ${uniqueMissingSenders.length - withLeads}`);

  console.log('\n💡 LIKELY CAUSE:');
  if (withLeads > 0) {
    console.log(`  ⚠️  ${withLeads} senders have leads but emails not imported!`);
    console.log('  - Email poller may not be reaching older emails');
    console.log('  - Email poller only fetches last 5 messages per scan');
    console.log('  - May need to increase fetch count or do full sync');
  }
  if (uniqueMissingSenders.length - withLeads > 0) {
    console.log(`  ℹ️  ${uniqueMissingSenders.length - withLeads} senders have NO leads (correctly not imported)`);
  }

  process.exit(0);
})();
