// 🚨 WARNING: SQLite functionality has been temporarily disabled during migration to Supabase
// This route needs to be updated to use Supabase instead of SQLite
// Many functions in this file will not work until properly migrated

const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { sendSMS, getSMSStatus, testSMSService, trackMessageDelivery } = require('../utils/smsService');
const crypto = require('crypto');

// @route   GET /api/sms/status
// @desc    Get SMS provider status and configuration
// @access  Private
router.get('/status', auth, async (req, res) => {
  try {
    const status = await getSMSStatus();
    res.json(status);
  } catch (error) {
    console.error('Error getting SMS status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/sms/test
// @desc    Test SMS service
// @access  Private
router.post('/test', auth, async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ message: 'Phone number is required' });
    }
    
    const result = await testSMSService(phoneNumber);
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: 'Test SMS sent successfully',
        provider: result.provider,
        messageId: result.messageId
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: 'Failed to send test SMS',
        error: result.error,
        provider: result.provider
      });
    }
  } catch (error) {
    console.error('Error testing SMS service:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/sms/send
// @desc    Send SMS via configured provider
// @access  Private
router.post('/send', auth, async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;
    
    if (!phoneNumber || !message) {
      return res.status(400).json({ message: 'Phone number and message are required' });
    }
    
    const result = await sendSMS(phoneNumber, message);

    // Track the message delivery in database (optional - only if we have a lead ID)
    let dbResult = null;
    if (req.body.leadId) {
      try {
        dbResult = await trackMessageDelivery({
          leadId: req.body.leadId,
          to: phoneNumber,
          message: message,
          deliveryResult: result,
          sentBy: req.user?.id,
          sentByName: req.user?.name
        });
      } catch (dbError) {
        console.error('Error tracking SMS delivery:', dbError);
        // Don't fail the SMS send if DB tracking fails
      }
    }

    if (result.success) {
      res.json({
        success: true,
        message: 'SMS sent successfully',
        provider: result.provider,
        messageId: result.messageId,
        dbTracked: !!dbResult?.data
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send SMS',
        error: result.error,
        provider: result.provider,
        dbTracked: false
      });
    }
  } catch (error) {
    console.error('Error sending SMS:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Helpers
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

function normalizePhone(phone) {
  if (!phone) return '';

  // Remove all non-digits except + at the start
  let cleaned = phone.replace(/[^\d+]/g, '');

  // Handle international formats
  if (cleaned.startsWith('+')) {
    cleaned = '00' + cleaned.slice(1);
  }

  // Remove leading zeros for UK numbers
  if (cleaned.startsWith('44')) {
    cleaned = cleaned.slice(2);
  }

  // Remove leading zero for UK local format
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.slice(1);
  }

  return cleaned;
}

/**
 * Generate all possible phone variations for matching
 */
function generatePhoneVariations(phone) {
  if (!phone) return [];

  const normalized = normalizePhone(phone);
  const variations = new Set();

  // Original normalized
  variations.add(normalized);

  // With leading zero (UK local format)
  if (normalized.length >= 10) {
    variations.add('0' + normalized);
  }

  // International format
  if (normalized.length >= 10) {
    variations.add('44' + normalized);
    variations.add('+44' + normalized);
  }

  // Various substring matches (for partial matches)
  if (normalized.length >= 7) {
    // Last 10 digits
    variations.add(normalized.slice(-10));
    // Last 9 digits
    variations.add(normalized.slice(-9));
    // Last 8 digits
    variations.add(normalized.slice(-8));
    // Last 7 digits
    variations.add(normalized.slice(-7));
  }

  // Handle double zero international dialing
  if (normalized.startsWith('00')) {
    variations.add(normalized.slice(2));
  }

  return Array.from(variations);
}

async function findLeadByPhone(phone) {
  console.log(`🔍 SMS Phone Matching: Searching for phone "${phone}"`);

  const variations = generatePhoneVariations(phone);
  console.log(`📱 SMS Phone Matching: Will try ${variations.length} variations`);

  // PHASE 1: Try EXACT matches first (highest priority)
  for (const variation of variations) {
    if (!variation || variation.length < 7) continue;

    console.log(`🎯 Trying EXACT phone match: ${variation}`);

    try {
      const { data, error } = await supabase
        .from('leads')
        .select('id, name, phone, email, status, booker_id, created_at, updated_at')
        .eq('phone', variation) // EXACT MATCH ONLY
        .order('created_at', { ascending: false })
        .limit(1);

      if (!error && data && data.length > 0) {
        console.log(`✅ SMS Phone EXACT Match SUCCESS: Found "${data[0].name}" (${data[0].phone}) - ID: ${data[0].id}`);
        return data[0];
      }
    } catch (error) {
      console.log(`⚠️ SMS Phone exact match error for "${variation}":`, error.message);
    }
  }

  // PHASE 2: Try substring matches ONLY if no exact match (lower priority)
  console.log(`🔍 No exact matches found, trying substring matches...`);

  for (const variation of variations) {
    if (!variation || variation.length < 10) continue; // Require longer numbers for substring matching

    console.log(`🔍 Trying substring phone match: ${variation}`);

    try {
      const { data, error } = await supabase
        .from('leads')
        .select('id, name, phone, email, status, booker_id, created_at, updated_at')
        .ilike('phone', `%${variation}%`)
        .order('created_at', { ascending: false })
        .limit(5);

      if (!error && data && data.length > 0) {
        // VALIDATE substring matches to prevent false positives
        const validMatches = data.filter(lead => {
          const leadVariations = generatePhoneVariations(lead.phone);
          const incomingVariations = generatePhoneVariations(phone);

          // Check if any variation from the lead matches any variation from incoming
          return leadVariations.some(lv => incomingVariations.some(iv => lv === iv));
        });

        if (validMatches.length > 0) {
          console.log(`✅ SMS Phone SUBSTRING Match SUCCESS: Found ${validMatches.length} validated matches`);
          validMatches.forEach((lead, i) => {
            console.log(`   ${i + 1}. ${lead.name} (${lead.phone}) - ID: ${lead.id}`);
          });
          return validMatches[0];
        } else {
          console.log(`⚠️ SMS Phone: Found ${data.length} substring matches but none validated - potential false positives avoided`);
        }
      }
    } catch (error) {
      console.log(`⚠️ SMS Phone substring match error for "${variation}":`, error.message);
    }
  }

  // PHASE 3: Create orphaned message entry for admin review
  console.log(`❌ SMS Phone Match FAILURE: No lead found for phone "${phone}"`);
  console.log(`📝 Creating orphaned message entry for admin review...`);

  try {
    // Insert orphaned message with null lead_id for admin to review later
    const messageId = require('crypto').randomUUID();
    await supabase.from('messages').insert({
      id: messageId,
      lead_id: null, // NULL = orphaned message
      type: 'sms',
      status: 'received',
      sms_body: `ORPHANED: ${phone}`, // Mark as orphaned for admin review
      recipient_phone: phone,
      sent_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      read_status: false,
      error_message: `No matching lead found for phone: ${phone}`
    });

    console.log(`📝 Orphaned message created with ID: ${messageId} for admin review`);
  } catch (orphanError) {
    console.error(`❌ Failed to create orphaned message entry:`, orphanError);
  }

  return null;
}

function buildDeterministicId(sender, text, timestampIso) {
  const base = `${normalizePhone(sender)}|${(timestampIso || '').trim()}|${(text || '').trim()}`;
  return 'sms_' + crypto.createHash('sha1').update(base).digest('hex');
}

// @route   POST /api/sms/webhook
// @desc    DISABLED - Webhook to receive SMS replies from provider
// @access  Public (called by provider)
router.post('/webhook', async (req, res) => {
  console.log('⚠️ SMS webhook is disabled');
  return res.status(200).json({ status: 'disabled' });
  try {
    // Initialize in-memory deduplication cache if not exists
    // Restore from persistent storage if available
    if (!global.__recentInboundSms) {
      global.__recentInboundSms = new Map();

      // Try to restore from BulkSMS poller persistent file
      try {
        const fs = require('fs');
        const path = require('path');
        const PROCESSED_MSGS_FILE = path.join(__dirname, '..', 'data', 'processed_sms_messages.json');

        if (fs.existsSync(PROCESSED_MSGS_FILE)) {
          const data = JSON.parse(fs.readFileSync(PROCESSED_MSGS_FILE, 'utf8'));
          if (data.processedIds && Array.isArray(data.processedIds)) {
            // Add recent entries to in-memory cache (last 24 hours)
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            data.processedIds.forEach(id => {
              // Only add IDs that look like they might be recent (contain timestamps)
              if (id.includes('|') || id.startsWith('sms_')) {
                global.__recentInboundSms.set(id, Date.now());
              }
            });
            console.log(`📱 SMS Webhook: Restored ${global.__recentInboundSms.size} deduplication keys from persistent storage`);
          }
        }
      } catch (restoreError) {
        console.warn('📱 SMS Webhook: Could not restore deduplication cache:', restoreError.message);
      }
    }
    // Accept both JSON and x-www-form-urlencoded with various key names
    const body = req.body || {};

    // Debug: log the incoming webhook payload
    console.log('📱 SMS Webhook received:', {
      headers: req.headers,
      body: body,
      bodyKeys: Object.keys(body),
      rawBody: req.rawBody ? req.rawBody.toString() : 'N/A'
    });

    const text = body.text || body.Body || body.message || body.messageText || body.sms || body.content;
    const sender = body.sender || body.From || body.from || body.phone || body.msisdn;
    const providerId = body.messageId || body.id || body.message_id || body.MessageSid || body.sid; // accept Twilio-style too
    const timestamp = body.timestamp || body.receivedAt || body.createdAt || body.dateTime || body.date || body.SmsTimestamp;

    console.log('📱 SMS Webhook extracted:', {
      text: text || 'EMPTY',
      sender: sender || 'EMPTY',
      providerId: providerId || 'EMPTY',
      timestamp: timestamp || 'EMPTY'
    });

    if (!text || !sender) {
      console.log('❌ SMS Webhook: Missing text or sender');
      return res.status(400).json({ message: 'Invalid payload' });
    }

    // Normalize timestamp
    const tsIso = (() => {
      if (!timestamp) return new Date().toISOString();
      const d = new Date(timestamp);
      return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    })();

    // Build a stable deduplication key
    const dedupKey = (providerId && String(providerId).trim()) || buildDeterministicId(sender, text, tsIso);

    console.log(`🔑 SMS Deduplication key: ${dedupKey}`);

    // In-memory dedup cache (survives within process lifetime)
    global.__recentInboundSms = global.__recentInboundSms || new Map();
    const nowMs = Date.now();

    // Purge old entries (> 15 minutes)
    let purged = 0;
    for (const [k, v] of global.__recentInboundSms.entries()) {
      if (nowMs - v > 15 * 60 * 1000) {
        global.__recentInboundSms.delete(k);
        purged++;
      }
    }
    if (purged > 0) {
      console.log(`🧹 Purged ${purged} old deduplication entries`);
    }

    // Check in-memory deduplication
    if (global.__recentInboundSms.has(dedupKey)) {
      const age = Math.round((nowMs - global.__recentInboundSms.get(dedupKey)) / 1000);
      console.log(`⚠️ SMS blocked by in-memory deduplication (${age}s ago)`);
      return res.status(200).json({ status: 'duplicate_ignored' });
    }

    console.log(`📱 SMS Webhook: Processing SMS from "${sender}": "${text}"`);
    
    try {
      const lead = await findLeadByPhone(sender);

      // Skip messages from unknown senders (no matching lead)
      if (!lead) {
        // Reduced logging for Railway rate limits
        console.log(`📱 SMS Webhook: SKIPPING - No lead found for sender "${sender}"`);
        console.log(`📱 SMS Webhook: Message "${text}" will NOT appear in CRM`);
        return res.status(200).json({ status: 'unknown_sender_skipped' });
      }
      
      console.log(`📱 SMS Webhook: ✅ PROCESSING - Found lead "${lead.name}" for sender "${sender}"`);
      console.log(`📱 SMS Webhook: Message "${text}" will appear in CRM`);

      // DB-level dedup within a 10-minute window for same body/lead
      try {
        // Calculate time window (10 minutes ago)
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

        console.log(`🔍 Checking database for duplicates (last 10 min)...`);
        console.log(`   Text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
        console.log(`   Lead ID: ${lead ? lead.id : 'null'}`);

        let dupQuery = supabase
          .from('messages')
          .select('id, created_at')
          .eq('type', 'sms')
          .eq('status', 'received')
          .eq('sms_body', text)
          .gte('created_at', tenMinutesAgo)
          .limit(1);

        if (lead) {
          dupQuery = dupQuery.eq('lead_id', lead.id);
        } else {
          dupQuery = dupQuery.is('lead_id', null);
        }

        const { data: dup, error } = await dupQuery;

        if (error) {
          console.error('❌ Database deduplication query error:', error);
        } else if (dup && dup.length > 0) {
          const age = Math.round((nowMs - new Date(dup[0].created_at).getTime()) / 1000);
          console.log(`⚠️ SMS blocked by database deduplication (duplicate ID: ${dup[0].id}, ${age}s ago)`);
          global.__recentInboundSms.set(dedupKey, nowMs);
          return res.status(200).json({ status: 'duplicate_ignored' });
        } else {
          console.log('✅ No database duplicates found');
        }
      } catch (error) {
        console.error('❌ Database deduplication error:', error);
      }

      // Insert into messages table with generated UUID
      let inserted = false;
      let newMessageId = null;
      try {
        // Generate a UUID for the message ID (required by Supabase table schema)
        const crypto = require('crypto');
        const messageId = crypto.randomUUID();

        const { data: newMessage, error: insertError } = await supabase
          .from('messages')
          .insert({
            id: messageId,
            lead_id: lead ? lead.id : null,
            type: 'sms',
            status: 'received',
            sms_body: text,
            recipient_phone: sender, // Store sender phone for debugging and future matching
            sent_at: tsIso,
            created_at: tsIso,
            updated_at: new Date().toISOString(),
            read_status: false, // New messages are always unread when received
            read_at: null // Will be set when message is read
          })
          .select()
          .single();

        if (insertError) {
          console.error('❌ Failed to insert SMS into messages table:', insertError.message);
          console.error('   Error details:', insertError);

          // If it's a duplicate key error, the message might already exist
          if (insertError.code === '23505') {
            console.log('⚠️ SMS might already exist - checking for existing message...');

            // Try to find the existing message
            const { data: existingMessage, error: findError } = await supabase
              .from('messages')
              .select('id')
              .eq('lead_id', lead ? lead.id : null)
              .eq('type', 'sms')
              .eq('status', 'received')
              .eq('sms_body', text)
              .gte('created_at', new Date(Date.now() - 60000).toISOString()) // Within last minute
              .limit(1);

            if (!findError && existingMessage && existingMessage.length > 0) {
              console.log('✅ Found existing SMS message:', existingMessage[0].id);
              newMessageId = existingMessage[0].id;
              inserted = true; // Consider it "inserted" since it already exists
            }
          }
        } else {
          console.log('✅ Successfully inserted SMS into messages table:', newMessage.id);
          newMessageId = messageId; // Use the generated UUID
          inserted = true;
        }
      } catch (e) {
        // If the table is legacy or schema mismatch, log and continue gracefully
        console.error('❌ Failed to insert SMS into messages table:', e.message);
      }

      // SMS is already stored in the messages table above.
      // No longer duplicating into booking_history to prevent bloat.
      // Messages are served via the messages-list API.

      // Realtime notify only for received SMS (consolidated to prevent duplication)
      const eventsEnabled = (process.env.SMS_EVENTS_ENABLED || 'true').toLowerCase() === 'true';
      if (eventsEnabled && global.io) {
        // Single consolidated notification payload
        const smsPayload = {
          type: 'SMS_RECEIVED',
          phone: sender,
          content: text,
          timestamp: tsIso,
          leadId: lead ? lead.id : null,
          leadName: lead ? lead.name : null,
          direction: 'received',
          channel: 'sms',
          shouldNotify: true,
          messageId: newMessageId
        };

        // Determine target rooms: assigned user and admins
        const rooms = [];
        if (lead && lead.booker_id) rooms.push(`user_${lead.booker_id}`);
        rooms.push('admins');

        console.log(`📡 Sending SMS notification to ${rooms.length} rooms:`, rooms);

        // Send single consolidated notification
        rooms.forEach(r => {
          try {
            global.io.to(r).emit('message_received', smsPayload);
            console.log(`   ✅ Notification sent to room: ${r}`);
          } catch (err) {
            console.error(`   ❌ Failed to send to room ${r}:`, err.message);
          }
        });

        // Optional: Send calendar update only if needed (not for every SMS)
        if (lead && process.env.CALENDAR_UPDATES_ENABLED === 'true') {
          try {
            global.io.emit('calendar_updated', {
              type: 'CALENDAR_UPDATED',
              data: {
                leadId: lead.id,
                action: 'SMS_RECEIVED',
                timestamp: tsIso
              }
            });
            console.log('   ✅ Calendar update sent');
          } catch (err) {
            console.error('   ❌ Calendar update failed:', err.message);
          }
        }
      }

      // Remember dedup key after successful processing
      global.__recentInboundSms.set(dedupKey, nowMs);
      return res.status(200).json({ status: 'received' });
    } catch (error) {
      console.error('❌ SMS processing error:', error);
      return res.status(200).json({ status: 'error', message: error.message });
    }
  } catch (error) {
    console.error('❌ SMS webhook error:', error);
    return res.status(200).json({ status: 'error', message: error.message });
  }
});

// Purge all SMS data (admin only). This clears messages table and removes SMS_* from leads.booking_history
router.post('/purge-all', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }
    
    let deleted = 0;
    let leadsUpdated = 0;
    
    // Delete all SMS messages
    const { error: deleteError, count: deletedCount } = await supabase
      .from('messages')
      .delete()
      .eq('type', 'sms');
      
    deleted = deletedCount || 0;
    
    if (deleteError && deleteError.code !== '42P01') { // 42P01 = table does not exist
      console.error('Error deleting SMS messages:', deleteError);
    }
    
    // Get all leads with booking_history
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('id, booking_history')
      .not('booking_history', 'is', null);
      
    if (leadsError) {
      console.error('Error fetching leads:', leadsError);
    }
    
    // Update leads to remove SMS entries from booking_history
    for (const lead of (leads || [])) {
      try {
        const hist = lead.booking_history ? JSON.parse(lead.booking_history) : [];
        const filtered = hist.filter((h) => !(h && typeof h.action === 'string' && h.action.startsWith('SMS_')));
        
        if (filtered.length !== hist.length) {
          const { error: updateError } = await supabase
            .from('leads')
            .update({
              booking_history: JSON.stringify(filtered),
              updated_at: new Date().toISOString()
            })
            .eq('id', lead.id);
            
          if (!updateError) {
            leadsUpdated++;
          }
        }
      } catch {}
    }
    
    return res.json({ success: true, deletedMessages: deleted, leadsUpdated });
  } catch (error) {
    console.error('Error purging SMS data:', error);
    return res.status(500).json({ success: false, message: 'Failed to purge SMS data' });
  }
});

module.exports = router; 