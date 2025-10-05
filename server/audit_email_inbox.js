const { ImapFlow } = require('imapflow');
require('dotenv').config();

const EMAIL_USER = process.env.EMAIL_USER || process.env.GMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS;

(async () => {
  console.log('📧 AUDITING EMAIL INBOX\n');
  console.log('='.repeat(80));

  console.log('\n🔑 Email Configuration:');
  console.log(`Email: ${EMAIL_USER}`);
  console.log(`Password: ${EMAIL_PASS ? '✅ Set' : '❌ Not set'}\n`);

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS
    },
    logger: false
  });

  try {
    console.log('📧 Connecting to Gmail IMAP...');
    await client.connect();
    console.log('✅ Connected successfully\n');

    // Open INBOX
    await client.mailboxOpen('INBOX');
    const status = await client.status('INBOX', { messages: true, unseen: true });

    console.log('📊 INBOX STATUS:');
    console.log(`Total messages in inbox: ${status.messages}`);
    console.log(`Unseen messages: ${status.unseen}\n`);

    // Fetch last 50 emails to see what's there
    console.log('📋 FETCHING LAST 50 EMAILS FROM INBOX:\n');

    const messagesToFetch = Math.min(status.messages, 50);
    const startSeq = Math.max(1, status.messages - messagesToFetch + 1);
    const range = `${startSeq}:${status.messages}`;

    console.log(`Fetching messages ${range}...\n`);

    const messages = [];
    for await (const message of client.fetch(range, {
      uid: true,
      envelope: true,
      internalDate: true
    })) {
      messages.push(message);
    }

    console.log(`✅ Fetched ${messages.length} emails\n`);
    console.log('='.repeat(80));
    console.log('EMAIL LIST (Most Recent 50):\n');

    messages.reverse().forEach((msg, i) => {
      const from = msg.envelope?.from?.[0]?.address || 'Unknown';
      const subject = msg.envelope?.subject || 'No subject';
      const date = msg.internalDate || msg.envelope?.date || 'Unknown date';

      console.log(`${i + 1}. UID: ${msg.uid}`);
      console.log(`   From: ${from}`);
      console.log(`   Subject: ${subject}`);
      console.log(`   Date: ${date}`);
      console.log('');
    });

    console.log('='.repeat(80));
    console.log('\n📊 SENDER ANALYSIS:\n');

    const senders = {};
    messages.forEach(msg => {
      const from = msg.envelope?.from?.[0]?.address || 'Unknown';
      senders[from] = (senders[from] || 0) + 1;
    });

    const sortedSenders = Object.entries(senders).sort((a, b) => b[1] - a[1]);
    console.log('Top senders:');
    sortedSenders.slice(0, 20).forEach(([email, count]) => {
      console.log(`  ${email}: ${count} emails`);
    });

    console.log('\n='.repeat(80));
    console.log('\n📅 DATE RANGE:\n');

    const dates = messages.map(m => m.internalDate || m.envelope?.date).filter(Boolean);
    if (dates.length > 0) {
      dates.sort();
      console.log(`Oldest email: ${dates[0]}`);
      console.log(`Newest email: ${dates[dates.length - 1]}`);
    }

    await client.logout();
    console.log('\n✅ Disconnected from IMAP\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }

  process.exit(0);
})();
