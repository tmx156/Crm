/**
 * REPOLL ALL EMAILS USING GMAIL API
 * 
 * This script will:
 * 1. Fetch ALL emails from Gmail using Gmail API
 * 2. Process each email and import into CRM
 * 3. Ensure attachments are included
 * 4. Match emails to leads by email address
 * 5. Create message records in the database
 * 
 * USAGE:
 *   node server/repoll_all_emails_gmail_api.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');
const gmailApiService = require('./utils/gmailApiService');
const { simpleParser } = require('mailparser');
const { randomUUID } = require('crypto');
const config = require('./config');

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

const EMAIL_ACCOUNT = process.env.EMAIL_USER || process.env.GMAIL_USER;

if (!EMAIL_ACCOUNT) {
  console.error('❌ EMAIL_USER not set in environment variables');
  process.exit(1);
}

// Statistics
const stats = {
  totalMessages: 0,
  processed: 0,
  imported: 0,
  skipped: 0,
  errors: 0,
  attachments: 0
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
 * Get header value from message
 */
function getHeader(headers, name) {
  const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return header ? header.value : null;
}

/**
 * Decode base64url string
 */
function decodeBase64Url(str) {
  if (!str) return '';
  try {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    return Buffer.from(base64 + padding, 'base64').toString('utf8');
  } catch (error) {
    return '';
  }
}

/**
 * Extract email body from Gmail message
 */
function extractEmailBody(message) {
  let body = '';

  const getBodyFromPart = (part) => {
    if (!part) return '';

    if (part.mimeType === 'text/plain' && part.body && part.body.data) {
      return decodeBase64Url(part.body.data);
    }

    if (part.mimeType === 'text/html' && part.body && part.body.data) {
      const html = decodeBase64Url(part.body.data);
      // Simple HTML to text conversion
      return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    }

    if (part.parts) {
      for (const subPart of part.parts) {
        const text = getBodyFromPart(subPart);
        if (text) return text;
      }
    }

    return '';
  };

  if (message.payload) {
    body = getBodyFromPart(message.payload);
  }

  return body || 'No content available';
}

/**
 * Process a single email message
 */
async function processMessage(message) {
  try {
    const headers = message.payload.headers;
    const from = getHeader(headers, 'From');
    const to = getHeader(headers, 'To');
    const subject = getHeader(headers, 'Subject') || '(No Subject)';
    const date = getHeader(headers, 'Date');
    const messageId = getHeader(headers, 'Message-ID');

    const fromEmail = extractEmail(from);
    const toEmail = extractEmail(to);

    if (!fromEmail) {
      console.log(`⚠️  Skipping message ${message.id}: No from email`);
      stats.skipped++;
      return;
    }

    // Extract body
    const body = extractEmailBody(message);

    // Get attachments
    const attachments = await gmailApiService.getAttachments(EMAIL_ACCOUNT, message.id);
    stats.attachments += attachments.length;

    // Find matching lead by email
    const { data: leads, error: leadError } = await supabase
      .from('leads')
      .select('id, name, email, booker_id')
      .or(`email.eq.${fromEmail},email.eq.${toEmail}`)
      .limit(1);

    let leadId = null;
    let leadName = null;

    if (!leadError && leads && leads.length > 0) {
      leadId = leads[0].id;
      leadName = leads[0].name;
    } else {
      // Try to find by name in email
      const nameMatch = from.match(/"([^"]+)"/) || from.match(/([^<]+)/);
      if (nameMatch) {
        const possibleName = nameMatch[1].trim();
        const { data: nameLeads } = await supabase
          .from('leads')
          .select('id, name')
          .ilike('name', `%${possibleName}%`)
          .limit(1);
        
        if (nameLeads && nameLeads.length > 0) {
          leadId = nameLeads[0].id;
          leadName = nameLeads[0].name;
        }
      }
    }

    // Check if message already exists
    const { data: existing } = await supabase
      .from('messages')
      .select('id')
      .eq('gmail_message_id', message.id)
      .maybeSingle();

    if (existing) {
      console.log(`⏭️  Message ${message.id} already imported, skipping`);
      stats.skipped++;
      return;
    }

    // Create message record
    const messageData = {
      id: randomUUID(),
      lead_id: leadId,
      type: 'email',
      subject: subject,
      content: body,
      status: 'received',
      email_status: 'received',
      recipient_email: toEmail,
      sender_email: fromEmail,
      sent_at: date ? new Date(date).toISOString() : new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      gmail_message_id: message.id,
      gmail_thread_id: message.threadId
    };

    // Add attachment info if present
    if (attachments.length > 0) {
      messageData.attachments = JSON.stringify(attachments.map(a => ({
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size
      })));
    }

    const { error: insertError } = await supabase
      .from('messages')
      .insert(messageData);

    if (insertError) {
      console.error(`❌ Failed to insert message ${message.id}:`, insertError.message);
      stats.errors++;
      return;
    }

    stats.imported++;
    console.log(`✅ Imported: ${subject.substring(0, 50)}${subject.length > 50 ? '...' : ''} ${leadName ? `→ ${leadName}` : '(no lead match)'} ${attachments.length > 0 ? `[${attachments.length} attachments]` : ''}`);

    // Update lead if matched
    if (leadId) {
      // Emit real-time update if needed
      console.log(`📧 Message linked to lead: ${leadName} (${leadId})`);
    }

  } catch (error) {
    console.error(`❌ Error processing message ${message.id}:`, error.message);
    stats.errors++;
  }
}

/**
 * Main repoll function
 */
async function repollAllEmails() {
  console.log('\n🔄 REPOLLING ALL EMAILS USING GMAIL API\n');
  console.log('='.repeat(80));
  console.log(`📧 Account: ${EMAIL_ACCOUNT}`);
  console.log('='.repeat(80) + '\n');

  try {
    // Get all messages
    console.log('📥 Fetching all messages from Gmail...');
    const messages = await gmailApiService.getAllMessages(EMAIL_ACCOUNT, {
      maxResults: 10000, // Adjust as needed
      query: '', // Get all messages
      includeSpamTrash: false
    });

    stats.totalMessages = messages.length;
    console.log(`✅ Found ${messages.length} messages to process\n`);

    // Process in batches to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(messages.length / batchSize)} (${i + 1}-${Math.min(i + batchSize, messages.length)} of ${messages.length})`);

      for (const messageRef of batch) {
        try {
          // Get full message details
          const fullMessage = await gmailApiService.getMessage(EMAIL_ACCOUNT, messageRef.id);
          await processMessage(fullMessage);
          stats.processed++;
        } catch (error) {
          console.error(`❌ Error fetching message ${messageRef.id}:`, error.message);
          stats.errors++;
          stats.skipped++;
          // Wait a bit before continuing
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Rate limiting - wait between batches
      if (i + batchSize < messages.length) {
        console.log('⏳ Waiting 2 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('\n📊 REPOLL SUMMARY:\n');
    console.log(`   Total messages found: ${stats.totalMessages}`);
    console.log(`   Processed: ${stats.processed}`);
    console.log(`   Imported: ${stats.imported}`);
    console.log(`   Skipped (already imported): ${stats.skipped}`);
    console.log(`   Errors: ${stats.errors}`);
    console.log(`   Attachments found: ${stats.attachments}`);
    console.log('\n' + '='.repeat(80) + '\n');

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the repoll
repollAllEmails().then(() => {
  console.log('✅ Repoll complete!\n');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Repoll failed:', error);
  process.exit(1);
});

