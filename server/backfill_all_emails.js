const { ImapFlow } = require('imapflow');
const { createClient } = require('@supabase/supabase-js');
const { simpleParser } = require('mailparser');
const { randomUUID } = require('crypto');
require('dotenv').config();

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const EMAIL_USER = process.env.EMAIL_USER || process.env.GMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Stats
const stats = {
  total: 0,
  processed: 0,
  skipped: 0,
  duplicates: 0,
  noLead: 0,
  errors: 0
};

async function findLead(email) {
  if (!email) return null;

  const { data: leadData, error: leadError } = await supabase
    .from('leads')
    .select('*')
    .ilike('email', email.trim())
    .single();

  if (leadError && leadError.code === 'PGRST116') {
    return null; // No rows found
  }

  if (leadError) {
    console.error(`❌ Database error finding lead for ${email}:`, leadError.message);
    return null;
  }

  return leadData;
}

async function extractEmailBody(rawContent) {
  try {
    // Parse the email content using mailparser
    const parsed = await simpleParser(rawContent);

    // Extract text content (prefer text over HTML)
    let body = parsed.text || '';

    // If no text, try to extract from HTML
    if (!body && parsed.html) {
      body = parsed.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    return body || 'No content available';
  } catch (error) {
    console.warn('⚠️ Error parsing email body:', error.message);
    return rawContent || 'No content available';
  }
}

async function processMessage(message, lead) {
  const uid = message.uid;
  const envelope = message.envelope;
  const fromAddr = envelope?.from?.[0]?.address || '';
  const subject = envelope?.subject || '';
  const internalDate = message.internalDate;

  try {
    if (!fromAddr) {
      console.warn(`⚠️ Skipping email with missing from address (UID: ${uid})`);
      stats.skipped++;
      return;
    }

    // Check for duplicate using IMAP_UID
    const { data: existingMessages, error: checkError } = await supabase
      .from('messages')
      .select('id')
      .eq('imap_uid', uid.toString())
      .eq('lead_id', lead.id)
      .limit(1);

    if (checkError) {
      console.error(`❌ Error checking for duplicate UID ${uid}:`, checkError.message);
      stats.errors++;
      return;
    }

    if (existingMessages && existingMessages.length > 0) {
      console.log(`📧 ⚠️ Duplicate: UID ${uid} already exists for lead ${lead.name}`);
      stats.duplicates++;
      return;
    }

    // Get text content from bodyParts
    let bodyContent = null;
    if (message.bodyParts && message.bodyParts.size > 0) {
      bodyContent = message.bodyParts.get('TEXT') ||
                    message.bodyParts.get('text') ||
                    message.bodyParts.get('1') ||
                    message.bodyParts.get('1.1') ||
                    Array.from(message.bodyParts.values())[0];
    }

    if (!bodyContent || !Buffer.isBuffer(bodyContent)) {
      bodyContent = Buffer.from(subject || 'No content available');
    }

    // Determine actual received date
    const emailReceivedDate = (internalDate && internalDate instanceof Date && !isNaN(internalDate.getTime()))
      ? internalDate.toISOString()
      : (envelope?.date && envelope.date instanceof Date && !isNaN(envelope.date.getTime()))
      ? envelope.date.toISOString()
      : new Date().toISOString();

    const processingDate = new Date().toISOString();

    // Extract email body
    let body = await extractEmailBody(bodyContent.toString('utf8'));

    // Insert to messages table
    const messageId = randomUUID();
    const { error: insertError } = await supabase
      .from('messages')
      .insert({
        id: messageId,
        lead_id: lead.id,
        type: 'email',
        subject: subject,
        content: body,
        recipient_email: fromAddr,
        status: 'received',
        imap_uid: uid.toString(),
        sent_at: emailReceivedDate,
        created_at: processingDate,
        updated_at: processingDate,
        read_status: false
      });

    if (insertError) {
      console.error(`❌ Error inserting message UID ${uid}:`, insertError.message);
      stats.errors++;
      return;
    }

    // Update lead's booking history
    let history = [];
    try {
      history = JSON.parse(lead.booking_history || '[]');
    } catch (e) {
      console.warn('⚠️ Error parsing existing booking history:', e.message);
    }

    history.unshift({
      action: 'EMAIL_RECEIVED',
      timestamp: emailReceivedDate,
      details: {
        subject,
        body: body.substring(0, 150) + '...',
      }
    });

    // Keep only last 100 history entries
    if (history.length > 100) history = history.slice(0, 100);

    await supabase
      .from('leads')
      .update({
        booking_history: JSON.stringify(history),
        updated_at: processingDate
      })
      .eq('id', lead.id);

    console.log(`✅ Processed: UID ${uid} - "${subject}" from ${fromAddr} -> ${lead.name}`);
    stats.processed++;

  } catch (error) {
    console.error(`❌ Error processing message UID ${uid}:`, error.message);
    stats.errors++;
  }
}

async function backfillEmails() {
  console.log('📧 Starting email backfill script...');
  console.log('📧 This will fetch ALL emails from your inbox and link them to leads');
  console.log('📧 Duplicates will be automatically skipped\n');

  if (!EMAIL_USER || !EMAIL_PASS) {
    console.error('❌ EMAIL_USER or EMAIL_PASSWORD not set in environment variables');
    process.exit(1);
  }

  let client = null;

  try {
    // Connect to IMAP
    console.log('📧 Connecting to IMAP...');
    client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: EMAIL_USER, pass: EMAIL_PASS },
      logger: false,
      tls: {
        rejectUnauthorized: true,
        servername: 'imap.gmail.com',
        minVersion: 'TLSv1.2'
      },
    });

    await client.connect();
    console.log('✅ Connected to IMAP successfully');

    await client.mailboxOpen('INBOX');
    console.log('✅ INBOX opened successfully');

    // Get mailbox status
    const status = await client.status('INBOX', { messages: true, uidNext: true });
    console.log(`📧 Mailbox has ${status.messages} total messages\n`);

    if (status.messages === 0) {
      console.log('📧 No messages in mailbox');
      return;
    }

    stats.total = status.messages;

    // Process ALL messages in batches to avoid memory issues
    const BATCH_SIZE = 100;
    const totalBatches = Math.ceil(status.messages / BATCH_SIZE);

    console.log(`📧 Processing ${status.messages} messages in ${totalBatches} batches of ${BATCH_SIZE}\n`);

    for (let batch = 0; batch < totalBatches; batch++) {
      const startSeq = batch * BATCH_SIZE + 1;
      const endSeq = Math.min((batch + 1) * BATCH_SIZE, status.messages);
      const range = `${startSeq}:${endSeq}`;

      console.log(`\n📧 === Batch ${batch + 1}/${totalBatches}: Processing messages ${range} ===`);

      const messages = [];
      for await (const message of client.fetch(range, {
        uid: true,
        envelope: true,
        internalDate: true,
        bodyStructure: true,
        bodyParts: ['1', 'TEXT']
      })) {
        messages.push(message);
      }

      console.log(`📧 Fetched ${messages.length} messages from batch ${batch + 1}`);

      // Process each message in the batch
      for (const message of messages) {
        const fromAddr = message.envelope?.from?.[0]?.address || 'Unknown';
        const subject = message.envelope?.subject || 'No subject';

        // Find lead for this email
        const lead = await findLead(fromAddr);

        if (!lead) {
          console.log(`📧 ⚠️ No lead found for ${fromAddr}, skipping UID ${message.uid}`);
          stats.noLead++;
          continue;
        }

        // Process the message
        await processMessage(message, lead);
      }

      // Print progress
      console.log(`\n📊 Progress: ${stats.processed} processed, ${stats.duplicates} duplicates, ${stats.noLead} no lead, ${stats.errors} errors`);

      // Small delay between batches to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    console.error(error.stack);
  } finally {
    // Cleanup
    if (client) {
      try {
        await client.logout();
        console.log('📧 Disconnected from IMAP');
      } catch (e) {
        console.error('Error during logout:', e.message);
      }
    }

    // Print final stats
    console.log('\n' + '='.repeat(60));
    console.log('📊 BACKFILL COMPLETE - Final Statistics:');
    console.log('='.repeat(60));
    console.log(`Total emails in inbox:     ${stats.total}`);
    console.log(`Successfully processed:    ${stats.processed}`);
    console.log(`Duplicates (skipped):      ${stats.duplicates}`);
    console.log(`No matching lead:          ${stats.noLead}`);
    console.log(`Errors:                    ${stats.errors}`);
    console.log(`Total skipped:             ${stats.skipped}`);
    console.log('='.repeat(60));
  }
}

// Run the backfill
backfillEmails()
  .then(() => {
    console.log('\n✅ Backfill script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Backfill script failed:', error);
    process.exit(1);
  });
