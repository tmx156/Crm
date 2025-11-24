/**
 * COMPREHENSIVE EMAIL SYSTEM REBUILD
 *
 * This script:
 * 1. Backs up all existing email messages
 * 2. Deletes all email messages from database
 * 3. Reimports ALL emails from Gmail using Gmail API
 * 4. Links emails to CORRECT current lead_ids (not orphaned ones)
 * 5. Handles duplicates properly
 *
 * IDENTIFIED ISSUES FIXED:
 * - Messages linked to orphaned/deleted lead_ids
 * - Emails not appearing in CRM due to wrong lead associations
 * - Duplicate detection using unreliable content hash
 */

require('dotenv').config();

// Load dependencies from server directory
let google, createClient;
try {
  ({ google } = require('googleapis'));
  ({ createClient } = require('@supabase/supabase-js'));
} catch (e) {
  // Try loading from server directory
  ({ google } = require('./server/node_modules/googleapis'));
  ({ createClient } = require('./server/node_modules/@supabase/supabase-js'));
}
const { randomUUID } = require('crypto');
const fs = require('fs');

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/gmail/callback';

// Email accounts
const EMAIL_ACCOUNTS = {
  primary: {
    user: process.env.EMAIL_USER || process.env.GMAIL_USER,
    name: 'Primary Account'
  },
  secondary: {
    user: process.env.EMAIL_USER_2 || process.env.GMAIL_USER_2,
    name: 'Secondary Account'
  }
};

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Statistics
const stats = {
  backupCount: 0,
  deletedCount: 0,
  reimportedCount: 0,
  skippedNoLead: 0,
  skippedDuplicate: 0,
  errorCount: 0,
  orphanedLeads: 0,
  startTime: Date.now()
};

// Track processed Gmail message IDs to avoid duplicates
const processedGmailIds = new Set();

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
    console.error('Error decoding base64url:', error.message);
    return '';
  }
}

/**
 * Convert HTML to plain text
 */
function htmlToText(html) {
  if (!html) return '';
  let text = html;
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<\/?(div|p|br|h[1-6]|li|tr)[^>]*>/gi, '\n');
  text = text.replace(/<\/td>/gi, '\t');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/^\s+|\s+$/gm, '');
  return text.trim();
}

/**
 * Clean email body (remove quoted replies, signatures)
 */
function cleanEmailBody(content) {
  let lines = content.split(/\r?\n/);
  let customerLines = [];
  let foundCustomerContent = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Stop at quoted reply markers
    if (
      line.match(/^On .+wrote:?/i) ||
      line.match(/^From:.*Sent:.*To:/i) ||
      line.match(/^----+ ?Original [Mm]essage ?----+/) ||
      line.match(/^_{5,}/) ||
      line.match(/^>+\s{2,}/)
    ) {
      if (foundCustomerContent) break;
      continue;
    }

    // Stop at signature markers
    if (foundCustomerContent && (
      line.match(/^Sent from/i) ||
      line.match(/^Get Outlook/i) ||
      line.match(/^(Regards|Kind regards|Best regards|Thanks|Thank you|Cheers|Sincerely)[\s,]*$/i)
    )) {
      break;
    }

    if (line.length > 0) {
      customerLines.push(lines[i]);
      foundCustomerContent = true;
    }
  }

  let response = customerLines.join('\n');
  response = response.replace(/\n{3,}/g, '\n\n');
  response = response.replace(/[ \t]+/g, ' ');
  response = response.trim();
  return response || 'No content available';
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
      return htmlToText(html);
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

  if (body) {
    body = cleanEmailBody(body);
  }

  return body || 'No content available';
}

/**
 * Get header value from message
 */
function getHeader(headers, name) {
  const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return header ? header.value : null;
}

/**
 * Extract email address from header
 */
function extractEmail(header) {
  if (!header) return null;
  const match = header.match(/<(.+?)>/) || header.match(/([^\s]+@[^\s]+)/);
  return match ? match[1].toLowerCase().trim() : header.toLowerCase().trim();
}

/**
 * Find lead by email - returns CURRENT lead only (not orphaned)
 */
async function findLead(email) {
  if (!email) return null;

  const { data: leadData, error: leadError } = await supabase
    .from('leads')
    .select('*')
    .ilike('email', email.trim())
    .limit(1)
    .maybeSingle();

  if (leadError) {
    console.error(`Error finding lead for ${email}:`, leadError.message);
    return null;
  }

  return leadData;
}

/**
 * Step 1: Backup existing emails
 */
async function backupExistingEmails() {
  console.log('\n📦 STEP 1: Backing up existing emails...\n');
  try {
    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .eq('type', 'email')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('❌ Error fetching messages for backup:', error);
      return false;
    }

    if (!messages || messages.length === 0) {
      console.log('ℹ️  No email messages found to backup.');
      return true;
    }

    // Check for orphaned leads
    const leadIds = [...new Set(messages.map(m => m.lead_id).filter(Boolean))];
    console.log(`📊 Found ${messages.length} emails linked to ${leadIds.length} unique lead IDs`);

    let orphanedCount = 0;
    for (const leadId of leadIds) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('id', leadId)
        .maybeSingle();

      if (!lead) {
        orphanedCount++;
        const orphanedMessages = messages.filter(m => m.lead_id === leadId);
        console.log(`⚠️  Orphaned lead_id: ${leadId} (${orphanedMessages.length} messages)`);
      }
    }

    stats.orphanedLeads = orphanedCount;
    if (orphanedCount > 0) {
      console.log(`\n❌ CRITICAL: Found ${orphanedCount} orphaned lead_ids!`);
      console.log(`   These emails are linked to leads that no longer exist.`);
      console.log(`   This is why emails don't appear correctly in the CRM.\n`);
    }

    const backupFilename = `email_backup_${new Date().toISOString().replace(/:/g, '-')}.json`;
    fs.writeFileSync(backupFilename, JSON.stringify(messages, null, 2));
    stats.backupCount = messages.length;
    console.log(`✅ Backed up ${messages.length} emails to ${backupFilename}`);
    return true;
  } catch (error) {
    console.error('❌ Error during backup:', error);
    return false;
  }
}

/**
 * Step 2: Delete all email messages
 */
async function deleteAllEmails() {
  console.log('\n🗑️  STEP 2: Deleting all email messages...\n');
  try {
    // Count first
    const { count } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'email');

    console.log(`📊 Found ${count} email messages to delete`);

    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('type', 'email');

    if (error) {
      console.error('❌ Error deleting messages:', error);
      return false;
    }

    stats.deletedCount = count;
    console.log(`✅ Deleted ${count} email messages from database`);

    // Clean up booking history
    console.log('\n🧹 Cleaning up email entries from booking history...\n');
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('id, booking_history');

    if (!leadsError && leads) {
      let cleanedCount = 0;
      for (const lead of leads) {
        try {
          const history = Array.isArray(lead.booking_history)
            ? lead.booking_history
            : (lead.booking_history ? JSON.parse(lead.booking_history) : []);

          const cleanedHistory = history.filter(entry =>
            !['EMAIL_SENT', 'EMAIL_RECEIVED'].includes(entry.action)
          );

          if (cleanedHistory.length !== history.length) {
            await supabase
              .from('leads')
              .update({ booking_history: cleanedHistory })
              .eq('id', lead.id);
            cleanedCount++;
          }
        } catch (e) {
          // Skip invalid history entries
        }
      }
      console.log(`✅ Cleaned booking history for ${cleanedCount} leads`);
    }

    // Clear processed messages file
    const processedFile = require('path').join(__dirname, 'server/data/processed_email_messages.json');
    if (fs.existsSync(processedFile)) {
      fs.unlinkSync(processedFile);
      console.log('✅ Cleared processed messages tracking file');
    }

    return true;
  } catch (error) {
    console.error('❌ Error during deletion:', error);
    return false;
  }
}

/**
 * Step 3: Reimport emails using Gmail API
 */
async function reimportEmailsFromGmail(accountKey = 'primary') {
  const accountConfig = EMAIL_ACCOUNTS[accountKey];
  if (!accountConfig || !accountConfig.user) {
    console.log(`⚠️  Skipping ${accountKey} account - not configured`);
    return true;
  }

  console.log(`\n📥 STEP 3: Reimporting emails from ${accountConfig.name} (${accountConfig.user})...\n`);

  try {
    // Get Gmail OAuth tokens from database
    const { data: gmailAccount, error: authError } = await supabase
      .from('gmail_accounts')
      .select('*')
      .eq('email', accountConfig.user)
      .maybeSingle();

    if (authError || !gmailAccount) {
      console.error(`❌ No Gmail API authentication found for ${accountConfig.user}`);
      console.error(`   Please authenticate first by visiting: http://localhost:5000/api/gmail/auth-url`);
      return false;
    }

    // Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: gmailAccount.access_token,
      refresh_token: gmailAccount.refresh_token,
      token_type: gmailAccount.token_type,
      expiry_date: gmailAccount.expiry_date,
      scope: gmailAccount.scope
    });

    // Create Gmail API client
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get profile
    const profile = await gmail.users.getProfile({ userId: 'me' });
    console.log(`✅ Connected to Gmail: ${profile.data.emailAddress}`);
    console.log(`📊 Total messages in account: ${profile.data.messagesTotal}`);

    // Fetch ALL messages from inbox
    console.log('\n📧 Fetching all messages from INBOX...\n');

    let allMessages = [];
    let pageToken = null;
    let pageCount = 0;

    do {
      const listResponse = await gmail.users.messages.list({
        userId: 'me',
        labelIds: ['INBOX'],
        maxResults: 500,
        pageToken: pageToken
      });

      const messages = listResponse.data.messages || [];
      allMessages = allMessages.concat(messages);
      pageToken = listResponse.data.nextPageToken;
      pageCount++;

      console.log(`📄 Page ${pageCount}: Fetched ${messages.length} messages (Total: ${allMessages.length})`);
    } while (pageToken);

    console.log(`\n✅ Fetched ${allMessages.length} total messages from Gmail`);
    console.log(`\n📧 Processing messages...\n`);

    let processedCount = 0;
    let skippedNoLead = 0;
    let skippedDuplicate = 0;
    let errorCount = 0;

    for (let i = 0; i < allMessages.length; i++) {
      const message = allMessages[i];
      const messageId = message.id;

      // Progress indicator
      if ((i + 1) % 10 === 0 || i === allMessages.length - 1) {
        process.stdout.write(`\r📧 Processing: ${i + 1}/${allMessages.length} (Imported: ${processedCount}, Skipped: ${skippedNoLead + skippedDuplicate}, Errors: ${errorCount})`);
      }

      try {
        // Skip if already processed
        if (processedGmailIds.has(messageId)) {
          skippedDuplicate++;
          continue;
        }

        // Get full message details
        const fullMessage = await gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'full'
        });

        const headers = fullMessage.data.payload.headers;
        const from = getHeader(headers, 'From');
        const to = getHeader(headers, 'To');
        const subject = getHeader(headers, 'Subject') || 'No subject';
        const dateHeader = getHeader(headers, 'Date');

        const fromEmail = extractEmail(from);
        if (!fromEmail) {
          skippedNoLead++;
          continue;
        }

        // Find CURRENT lead (not orphaned)
        const lead = await findLead(fromEmail);
        if (!lead) {
          skippedNoLead++;
          continue;
        }

        // Extract email body
        const body = extractEmailBody(fullMessage.data);

        // Determine received date
        const emailReceivedDate = dateHeader
          ? new Date(dateHeader).toISOString()
          : new Date(parseInt(fullMessage.data.internalDate)).toISOString();

        // Check if this exact message already exists for this lead
        const { data: existingMessage } = await supabase
          .from('messages')
          .select('id')
          .eq('lead_id', lead.id)
          .eq('provider_message_id', messageId)
          .maybeSingle();

        if (existingMessage) {
          skippedDuplicate++;
          processedGmailIds.add(messageId);
          continue;
        }

        // Insert message to database
        const dbMessageId = randomUUID();
        const { error: insertError } = await supabase
          .from('messages')
          .insert({
            id: dbMessageId,
            lead_id: lead.id,
            type: 'email',
            subject: subject,
            content: body,
            recipient_email: fromEmail,
            status: 'received',
            provider_message_id: messageId, // Store Gmail message ID here
            delivery_provider: 'gmail_api',
            sent_at: emailReceivedDate,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            read_status: false
          });

        if (insertError) {
          console.error(`\n❌ Error inserting message ${messageId}:`, insertError.message);
          errorCount++;
          continue;
        }

        // Update lead history
        const history = Array.isArray(lead.booking_history)
          ? lead.booking_history
          : (lead.booking_history ? JSON.parse(lead.booking_history) : []);

        history.unshift({
          action: 'EMAIL_RECEIVED',
          timestamp: emailReceivedDate,
          details: {
            subject,
            body: body.substring(0, 150) + '...',
            direction: 'received',
            channel: 'email',
            read: false
          }
        });

        await supabase
          .from('leads')
          .update({
            booking_history: history,
            updated_at: new Date().toISOString()
          })
          .eq('id', lead.id);

        processedGmailIds.add(messageId);
        processedCount++;

      } catch (error) {
        console.error(`\n❌ Error processing message ${messageId}:`, error.message);
        errorCount++;
      }
    }

    console.log(`\n\n✅ Reimport complete for ${accountConfig.name}:`);
    console.log(`   - Processed: ${processedCount}`);
    console.log(`   - Skipped (no lead): ${skippedNoLead}`);
    console.log(`   - Skipped (duplicate): ${skippedDuplicate}`);
    console.log(`   - Errors: ${errorCount}`);

    stats.reimportedCount += processedCount;
    stats.skippedNoLead += skippedNoLead;
    stats.skippedDuplicate += skippedDuplicate;
    stats.errorCount += errorCount;

    return true;

  } catch (error) {
    console.error(`\n❌ Error during reimport:`, error.message);
    return false;
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('📧 COMPREHENSIVE EMAIL SYSTEM REBUILD');
  console.log('='.repeat(80));
  console.log('\n🔧 This will:');
  console.log('   1. Backup all existing emails');
  console.log('   2. Delete all email messages');
  console.log('   3. Reimport ALL emails from Gmail');
  console.log('   4. Link emails to CORRECT current lead_ids');
  console.log('   5. Fix orphaned lead associations\n');

  // Step 1: Backup
  const backupSuccess = await backupExistingEmails();
  if (!backupSuccess) {
    console.error('\n❌ Backup failed! Aborting.');
    process.exit(1);
  }

  // Step 2: Delete
  const deleteSuccess = await deleteAllEmails();
  if (!deleteSuccess) {
    console.error('\n❌ Deletion failed! Aborting.');
    process.exit(1);
  }

  // Step 3: Reimport from both accounts
  for (const accountKey of ['primary', 'secondary']) {
    await reimportEmailsFromGmail(accountKey);
  }

  const elapsedTime = ((Date.now() - stats.startTime) / 1000).toFixed(2);
  console.log('\n' + '='.repeat(80));
  console.log('✅ EMAIL SYSTEM REBUILD COMPLETE!');
  console.log('='.repeat(80));
  console.log('\n📊 Final Statistics:');
  console.log(`   - Backed up: ${stats.backupCount} emails`);
  console.log(`   - Deleted: ${stats.deletedCount} emails`);
  console.log(`   - Orphaned leads found: ${stats.orphanedLeads}`);
  console.log(`   - Reimported: ${stats.reimportedCount} emails`);
  console.log(`   - Skipped (no lead): ${stats.skippedNoLead}`);
  console.log(`   - Skipped (duplicate): ${stats.skippedDuplicate}`);
  console.log(`   - Errors: ${stats.errorCount}`);
  console.log(`   - Time: ${elapsedTime}s\n`);

  process.exit(0);
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
