/**
 * IMPORT ALL EMAILS FROM CAMRY MODELS ACCOUNT
 * 
 * This script will:
 * 1. Connect to Gmail IMAP for Camry Models account
 * 2. Fetch ALL emails from inbox
 * 3. Process each email and import into CRM
 * 4. Match emails to leads by email address
 * 5. Handle attachments
 * 6. Create message records in database
 * 
 * USAGE:
 *   node server/import_all_camry_emails.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { ImapFlow } = require('imapflow');
const { createClient } = require('@supabase/supabase-js');
const { simpleParser } = require('mailparser');
const { randomUUID } = require('crypto');
const config = require('./config');

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

const EMAIL_USER = process.env.EMAIL_USER || process.env.GMAIL_USER;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS;

if (!EMAIL_USER || !EMAIL_PASSWORD) {
  console.error('❌ EMAIL_USER or EMAIL_PASSWORD not set in .env');
  process.exit(1);
}

// Statistics
const stats = {
  totalMessages: 0,
  processed: 0,
  imported: 0,
  skipped: 0,
  errors: 0,
  attachments: 0,
  leadsMatched: 0
};

/**
 * Extract email address from header
 */
function extractEmail(header) {
  if (!header) return null;
  const match = header.match(/<(.+?)>/) || header.match(/([^\s]+@[^\s]+)/);
  return match ? match[1] : header.trim();
}

/**
 * Find lead by email
 */
async function findLead(email) {
  if (!email) return null;

  try {
    const { data: leadData, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .ilike('email', email.trim())
      .single();

    if (leadError && leadError.code === 'PGRST116') {
      return null;
    }

    if (leadError) {
      console.error(`❌ Database error finding lead for ${email}:`, leadError.message);
      return null;
    }

    return leadData;
  } catch (error) {
    console.error(`❌ Error finding lead:`, error.message);
    return null;
  }
}

/**
 * Process a single email message
 */
async function processMessage(message, uid) {
  try {
    // Parse email
    const parsed = await simpleParser(message.source);

    const fromEmail = extractEmail(parsed.from?.text || parsed.from?.value?.[0]?.address);
    const toEmail = extractEmail(parsed.to?.text || parsed.to?.value?.[0]?.address);
    const subject = parsed.subject || '(No Subject)';
    const body = parsed.text || parsed.html || 'No content';
    const date = parsed.date || new Date();

    if (!fromEmail) {
      console.log(`⚠️  Skipping message UID ${uid}: No from email`);
      stats.skipped++;
      return;
    }

    // Find matching lead
    const lead = await findLead(fromEmail);

    if (!lead) {
      // Import as orphaned message (no lead match) - especially for Google notifications
      console.log(`📧 No lead found for ${fromEmail}, importing as orphaned message UID ${uid}`);
      
      try {
        const dbMessageId = randomUUID();
        const parsed = await simpleParser(message.source);
        const subject = parsed.subject || '(No Subject)';
        const body = parsed.text || parsed.html || 'No content';
        const date = parsed.date || new Date();

        const { error: insertError } = await supabase
          .from('messages')
          .insert({
            id: dbMessageId,
            lead_id: null, // NULL = orphaned message
            type: 'email',
            subject: subject,
            content: body,
            recipient_email: fromEmail,
            status: 'received',
            sent_at: date.toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            read_status: false
          });

        if (insertError) {
          console.error(`❌ Failed to insert orphaned message UID ${uid}:`, insertError.message);
          stats.errors++;
          return;
        }

        stats.imported++;
        stats.skipped--; // Don't count as skipped since we imported it
        console.log(`✅ Imported orphaned: "${subject.substring(0, 50)}${subject.length > 50 ? '...' : ''}" from ${fromEmail}`);
        return;
      } catch (error) {
        console.error(`❌ Error processing orphaned message UID ${uid}:`, error.message);
        stats.errors++;
        return;
      }
    }

    stats.leadsMatched++;

    // Check for duplicate content
    const crypto = require('crypto');
    const contentHash = crypto.createHash('md5').update(body).digest('hex');

    // Check if message already exists
    const { data: existing } = await supabase
      .from('messages')
      .select('id, content')
      .eq('lead_id', lead.id)
      .eq('type', 'email')
      .eq('subject', subject)
      .limit(10);

    if (existing && existing.length > 0) {
      // Check content hash
      for (const msg of existing) {
        if (msg.content) {
          const existingHash = crypto.createHash('md5').update(msg.content).digest('hex');
          if (existingHash === contentHash) {
            console.log(`⏭️  Duplicate message found for ${lead.name}, skipping UID ${uid}`);
            stats.skipped++;
            return;
          }
        }
      }
    }

    // Process attachments
    const attachments = [];
    if (parsed.attachments && parsed.attachments.length > 0) {
      for (const att of parsed.attachments) {
        attachments.push({
          filename: att.filename || 'attachment',
          mimeType: att.contentType,
          size: att.size || 0
        });
      }
      stats.attachments += attachments.length;
    }

    // Insert message to database
    const dbMessageId = randomUUID();
    const insertData = {
      id: dbMessageId,
      lead_id: lead.id,
      type: 'email',
      subject: subject,
      content: body,
      recipient_email: fromEmail,
      status: 'received',
      sent_at: date.toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      read_status: false
    };

    // Note: attachments info is logged but not stored (metadata column may not exist)
    const { error: insertError } = await supabase
      .from('messages')
      .insert(insertData);

    if (insertError) {
      console.error(`❌ Failed to insert message UID ${uid}:`, insertError.message);
      stats.errors++;
      return;
    }

    stats.imported++;
    console.log(`✅ Imported: "${subject.substring(0, 50)}${subject.length > 50 ? '...' : ''}" → ${lead.name} ${attachments.length > 0 ? `[${attachments.length} attachments]` : ''}`);

  } catch (error) {
    console.error(`❌ Error processing message UID ${uid}:`, error.message);
    stats.errors++;
  }
}

/**
 * Main import function
 */
async function importAllEmails() {
  console.log('\n🔄 IMPORTING ALL EMAILS FROM CAMRY MODELS\n');
  console.log('='.repeat(80));
  console.log(`📧 Account: ${EMAIL_USER}`);
  console.log('='.repeat(80) + '\n');

  let client = null;

  try {
    // Connect to IMAP
    console.log('📥 Connecting to Gmail IMAP...');
    client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: EMAIL_USER, pass: EMAIL_PASSWORD },
      logger: false,
      socketTimeout: 120000,
      tls: {
        rejectUnauthorized: true,
        servername: 'imap.gmail.com',
        minVersion: 'TLSv1.2'
      },
    });

    await client.connect();
    console.log('✅ Connected to IMAP successfully\n');

    await client.mailboxOpen('INBOX');
    console.log('✅ INBOX opened\n');

    // Get mailbox status
    const status = await client.status('INBOX', { messages: true, uidNext: true });
    stats.totalMessages = status.messages;

    console.log(`📊 Total messages in inbox: ${stats.totalMessages}\n`);

    if (stats.totalMessages === 0) {
      console.log('ℹ️  No messages in mailbox');
      return;
    }

    // Fetch ALL messages in batches
    const batchSize = 50;
    const totalBatches = Math.ceil(stats.totalMessages / batchSize);

    console.log(`📦 Processing in ${totalBatches} batch(es) of ${batchSize} messages...\n`);

    for (let batch = 0; batch < totalBatches; batch++) {
      const start = batch * batchSize + 1;
      const end = Math.min((batch + 1) * batchSize, stats.totalMessages);
      const range = `${start}:${end}`;

      console.log(`\n📦 Batch ${batch + 1}/${totalBatches}: Messages ${start}-${end}`);

      try {
        for await (const message of client.fetch(range, {
          uid: true,
          envelope: true,
          bodyStructure: true,
          source: true
        })) {
          await processMessage(message, message.uid);
          stats.processed++;

          // Small delay to avoid overwhelming the system
          if (stats.processed % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      } catch (batchError) {
        console.error(`❌ Error in batch ${batch + 1}:`, batchError.message);
        stats.errors++;
      }

      // Progress update
      console.log(`   Progress: ${stats.processed}/${stats.totalMessages} processed, ${stats.imported} imported, ${stats.skipped} skipped`);

      // Rate limiting between batches
      if (batch < totalBatches - 1) {
        console.log('   ⏳ Waiting 2 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('\n📊 IMPORT SUMMARY:\n');
    console.log(`   Total messages in inbox: ${stats.totalMessages}`);
    console.log(`   Processed: ${stats.processed}`);
    console.log(`   Imported: ${stats.imported}`);
    console.log(`   Skipped (duplicates/no lead): ${stats.skipped}`);
    console.log(`   Errors: ${stats.errors}`);
    console.log(`   Leads matched: ${stats.leadsMatched}`);
    console.log(`   Attachments found: ${stats.attachments}`);
    console.log('\n' + '='.repeat(80) + '\n');

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  } finally {
    if (client) {
      try {
        await client.close();
        console.log('✅ IMAP connection closed');
      } catch (e) {
        // Ignore
      }
    }
  }
}

// Run the import
importAllEmails().then(() => {
  console.log('✅ Import complete!\n');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Import failed:', error);
  process.exit(1);
});

