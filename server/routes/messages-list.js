// ✅ FIXED: Messages-list route now uses Supabase

const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const MessagingService = require('../utils/messagingService');
const dbManager = require('../database-connection-manager');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase using centralized config
const config = require('../config');
const supabase = createClient(config.supabase.url, config.supabase.anonKey);

// Import SMS service for sending
const { sendSMS } = require('../utils/smsService');
const crypto = require('crypto');

// Import addBookingHistoryEntry function
const addBookingHistoryEntry = async (leadId, action, userId, userName, details, leadData) => {
  try {
    const historyEntry = {
      action,
      performed_by: userId,
      performed_by_name: userName,
      details: details || {},
      lead_snapshot: leadData,
      timestamp: new Date().toISOString()
    };

    // Get current booking history
    const { data: currentLead, error: fetchError } = await supabase
      .from('leads')
      .select('booking_history')
      .eq('id', leadId)
      .single();

    if (fetchError) {
      console.error('❌ Error fetching current booking history:', fetchError);
      return null;
    }

    let currentHistory = currentLead.booking_history || [];

    // Cap history size to prevent database bloat
    const MAX_HISTORY_ENTRIES = 50;
    if (currentHistory.length >= MAX_HISTORY_ENTRIES) {
      currentHistory = currentHistory.slice(-MAX_HISTORY_ENTRIES + 1);
    }

    const updatedHistory = [...currentHistory, historyEntry];

    // Update the lead with new booking history
    const { error: updateError } = await supabase
      .from('leads')
      .update({ booking_history: updatedHistory })
      .eq('id', leadId);

    if (updateError) {
      console.error('❌ Error updating booking history:', updateError);
      throw updateError;
    }

    console.log(`✅ Booking history entry added to lead ${leadId}`);
    return updatedHistory.length - 1;
  } catch (error) {
    console.error('❌ Error adding booking history entry:', error);
    return null;
  }
};
// @route   GET /api/messages-list
// @desc    Get all SMS and email messages for leads (based on user role)
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { user } = req;
    // Query controls to cap egress
    const rawSince = req.query.since;
    const rawLimit = parseInt(req.query.limit, 10);
    const MAX_LIMIT = 100; // Reduced from 200 to optimize egress usage
    const validatedLimit = Math.min(Number.isFinite(rawLimit) ? rawLimit : MAX_LIMIT, MAX_LIMIT);
    const sinceIso = (() => {
      try { return rawSince ? new Date(rawSince).toISOString() : null; } catch { return null; }
    })();
    const defaultSinceIso = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(); // last 3 days by default (reduced from 7 for egress)
    const createdAfter = sinceIso || defaultSinceIso;

    const messagesData = [];
    const seenKeys = new Set();

    // SKIP LEGACY DATA - Only use Supabase data
    // 1) Skip leads.booking_history JSON (legacy source) - DISABLED
    console.log('ℹ️ Skipping legacy booking_history data - using only Supabase data');
    
    // Note: We're skipping the legacy booking_history parsing to avoid errors
    // All communication history should come from the messages table only

    // 2) Pull communications from messages table (primary source)
    try {
      const isAdmin = user.role === 'admin';
      
      // First get messages (bounded by time window and limit, trimmed columns)
      const { data: messageRows, error: messageError } = await supabase
        .from('messages')
        .select('id, lead_id, type, content, sms_body, subject, sent_by, sent_by_name, status, email_status, read_status, delivery_status, provider_message_id, delivery_provider, delivery_attempts, sent_at, created_at')
        .gte('created_at', createdAfter)
        .order('created_at', { ascending: false })
        .limit(validatedLimit);

      if (messageError) {
        console.error('Error fetching messages:', messageError);
      }

      const messageData = messageRows || [];
      
      if (messageData.length > 0) {
        // Get lead IDs from messages (filter out null values)
        const leadIds = [...new Set(messageData.map(msg => msg.lead_id).filter(id => id))];

        console.log(`📊 Messages: ${messageData.length}, Valid lead IDs: ${leadIds.length}`);

        // Fetch leads separately
        const { data: leads, error: leadsError } = await supabase
          .from('leads')
          .select('id, name, phone, email, status, booker_id')
          .in('id', leadIds);
        
        if (leadsError) {
          console.error('Error fetching leads for messages:', leadsError);
        }
        
        console.log(`👥 Leads fetched: ${leads?.length || 0}`);

        // Create a map of lead data
        const leadMap = new Map();
        (leads || []).forEach(lead => {
          leadMap.set(lead.id, lead);
        });

        console.log(`🗺️ Lead map size: ${leadMap.size}`);

        // Filter messages based on user permissions
        const filteredMessages = messageData.filter(msg => {
          if (isAdmin) return true;
          const lead = leadMap.get(msg.lead_id);
          return lead && lead.booker_id === user.id;
        });

        console.log(`📋 Filtered messages: ${filteredMessages.length} out of ${messageData.length}`);

        filteredMessages.forEach(row => {
          const lead = leadMap.get(row.lead_id);

          // Skip messages without leads (orphaned messages)
          if (!lead) {
            // Silently skip orphaned messages to reduce console noise
            // These are messages that couldn't be matched to leads during webhook processing
            return;
          }

          const leadData = lead;

          const content = row.content || row.sms_body || row.subject || 'No content';
          // Prioritize sent_at (actual message time) over created_at (processing time)
          const timestamp = row.sent_at || row.created_at || new Date().toISOString();
          const key = `${row.lead_id}_${new Date(timestamp).toISOString()}_${row.type}_${content.slice(0,30)}`;
          if (seenKeys.has(key)) return;
          seenKeys.add(key);

          // Determine direction based on message type and sent_by field
          // For messages: if sent_by exists, it's sent; otherwise received
          // Also check status field for additional context
          let direction = 'received'; // Default to received

          if (row.sent_by) {
            direction = 'sent';
          } else if (row.status === 'sent' || row.email_status === 'sent') {
            direction = 'sent';
          } else if (row.status === 'received') {
            direction = 'received';
          }

          const action = direction === 'received' ? `${row.type.toUpperCase()}_RECEIVED` : `${row.type.toUpperCase()}_SENT`;

          messagesData.push({
            id: row.id, // Use actual message UUID as primary ID (simplified format)
            messageId: row.id, // Include the actual message UUID for proper read status handling
            leadId: row.lead_id,
            leadName: leadData.name,
            leadPhone: leadData.phone,
            leadEmail: leadData.email,
            leadStatus: leadData.status,
            assignedTo: leadData.booker_id,
            type: row.type,
            direction: direction,
            action: action,
            timestamp,
            performedBy: row.sent_by,
            performedByName: row.sent_by_name,
            content,
            details: { body: content, subject: row.subject },
            isRead: row.read_status === true || direction === 'sent', // Use messages table read_status as source of truth
            // Add delivery status tracking fields
            delivery_status: row.delivery_status,
            error_message: row.error_message,
            provider_message_id: row.provider_message_id,
            delivery_provider: row.delivery_provider,
            delivery_attempts: row.delivery_attempts,
            email_status: row.email_status // For email delivery status
          });
        });
      }
    } catch (err) {
      console.error('Error loading messages table:', err);
    }

    // Note: Section 3 (booking_history JSONB column) was removed as it's redundant
    // Sections 1 and 2 already handle all booking_history data properly

    // Strong de-duplication across sources (JSON vs table) and minor timestamp skews
    const normalizeContent = (s) => String(s || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const windowMs = 2 * 60 * 1000; // 2-minute window
    const dedupMap = new Map();
    for (const m of messagesData) {
      const ts = (() => { try { return new Date(m.timestamp).getTime(); } catch { return Date.now(); } })();
      const bucket = Math.floor(ts / windowMs);
      const contentKey = normalizeContent(m.content).slice(0, 160);
      const key = `${m.leadId}|${m.type}|${m.direction}|${bucket}|${contentKey}`;
      const existing = dedupMap.get(key);
      if (!existing) {
        dedupMap.set(key, m);
      } else {
        const ets = (() => { try { return new Date(existing.timestamp).getTime(); } catch { return 0; } })();
        if (ts > ets) dedupMap.set(key, m);
      }
    }
    const deduped = Array.from(dedupMap.values());

    // Sort by timestamp (most recent first)
    deduped.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Compute cursors for incremental polling
    const latestCreatedAt = (() => {
      try {
        return (messagesData[0]?.timestamp) ? new Date(messagesData[0].timestamp).toISOString() : new Date().toISOString();
      } catch { return new Date().toISOString(); }
    })();
    
    // Filter for unread messages if requested
    const unreadOnly = req.query.unread === 'true' || req.query.unread === true;
    const filteredMessages = unreadOnly ? deduped.filter(m => !m.isRead && m.direction === 'received') : deduped;

    // Get summary stats
    const stats = {
      totalMessages: deduped.length,
      smsCount: deduped.filter(m => m.type === 'sms').length,
      emailCount: deduped.filter(m => m.type === 'email').length,
      unreadCount: deduped.filter(m => !m.isRead).length,
      sentCount: deduped.filter(m => m.direction === 'sent').length,
      receivedCount: deduped.filter(m => m.direction === 'received').length
    };

    console.log(`📨 Messages API: Returning ${filteredMessages.length} messages (unreadOnly: ${unreadOnly}, total: ${deduped.length})`);

    // No need to close connection with Supabase

    res.json({
      messages: filteredMessages,
      stats: stats,
      userRole: user.role,
      userName: user.name,
      meta: {
        since: createdAfter,
        limit: validatedLimit,
        latestCreatedAt
      }
    });
    
  } catch (error) {
    console.error('Error fetching messages:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Helper function to handle direct message UUID updates
const handleDirectMessageUpdate = async (messageId, res, req = null) => {
  try {
    let actualMessageId = messageId;
    let directMessage = null;

    console.log(`🔍 Backend: Searching for message ${messageId} in messages table...`);

    // Try to find the message - first with exact ID match
    let result = await supabase
      .from('messages')
      .select('id, lead_id, sms_body, content, subject, type, status, created_at, read_status, delivery_status, provider_message_id, error_message, delivery_provider, delivery_attempts')
      .eq('id', messageId)
      .single();

    if (result.data) {
      directMessage = result.data;
      console.log(`✅ Backend: Found message with exact ID: ${messageId}`);
    } else if (result.error?.code === 'PGRST116') {
      // Message not found with exact ID, try extracting UUID part if composite
      const uuidPart = messageId.includes('_') ? messageId.split('_')[0] : messageId;

      if (uuidPart !== messageId) {
        console.log(`🔄 Backend: Exact ID not found, trying UUID part: ${uuidPart}`);

        result = await supabase
          .from('messages')
          .select('id, lead_id, sms_body, content, subject, type, status, created_at, read_status, delivery_status, provider_message_id, error_message, delivery_provider, delivery_attempts')
          .eq('id', uuidPart)
          .single();

        if (result.data) {
          directMessage = result.data;
          actualMessageId = uuidPart;
          console.log(`✅ Backend: Found message with UUID part: ${uuidPart}`);
        }
      }
    }

    if (!directMessage) {
      console.log(`❌ Backend: Message ${messageId} not found in messages table`);
      console.log(`❌ Backend: Search error:`, result.error?.message || 'Unknown error');

      // More detailed debug info
      console.log(`🔍 Backend: Checking recent messages in database...`);
      const { data: sampleMessages, error: sampleError } = await supabase
        .from('messages')
        .select('id, created_at, type, lead_id')
        .order('created_at', { ascending: false })
        .limit(5);

      if (!sampleError && sampleMessages) {
        console.log(`📊 Backend: Found ${sampleMessages.length} recent messages in DB:`);
        sampleMessages.forEach((msg, i) => {
          console.log(`   ${i + 1}. ${msg.id} (${msg.type}, lead: ${msg.lead_id}, ${new Date(msg.created_at).toLocaleString()})`);
        });
      }

      return res.status(404).json({
        success: false,
        message: 'Message not found in messages table',
        details: `Message ${messageId} does not exist in the database. This may be stale UI data.`,
        debug: {
          originalId: messageId,
          searchedId: actualMessageId,
          recentMessages: sampleMessages?.length || 0
        }
      });
    }

    // Check if already read to avoid unnecessary updates
    if (directMessage.read_status === true) {
      console.log(`ℹ️ Backend: Message ${actualMessageId} already marked as read`);
      return res.json({
        success: true,
        message: 'Message was already marked as read',
        messageId: actualMessageId,
        method: 'direct',
        alreadyRead: true
      });
    }

    console.log(`✅ Backend: Found message ${actualMessageId} in messages table`);
    console.log(`📋 Backend: Message details:`, {
      id: directMessage.id,
      lead_id: directMessage.lead_id,
      type: directMessage.type,
      status: directMessage.status,
      read_status: directMessage.read_status,
      created_at: directMessage.created_at
    });

    // Update the message directly in the messages table
    const { error: updateError } = await supabase
      .from('messages')
      .update({
        read_status: true,
        read_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', actualMessageId);

    if (updateError) {
      console.log(`❌ Backend: Failed to update message directly:`, updateError.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to update message read status',
        details: updateError.message,
        errorCode: updateError.code
      });
    }

    console.log(`✅ Backend: Successfully updated message ${actualMessageId} read status in messages table`);

    // Emit socket event for real-time updates
    const ioInstance = req?.app?.get('io') || global.io;
    if (ioInstance) {
      const eventData = {
        messageId: actualMessageId,
        leadId: directMessage.lead_id,
        timestamp: new Date().toISOString(),
        content: directMessage.content || directMessage.sms_body || directMessage.subject || 'Message content',
        type: directMessage.type
      };

      ioInstance.emit('message_read', eventData);
      console.log(`📡 Emitted message_read event for direct update: ${actualMessageId}`);
    }

    return res.json({
      success: true,
      message: 'Message marked as read successfully',
      messageId: actualMessageId,
      method: 'direct',
      leadId: directMessage.lead_id,
      type: directMessage.type
    });

  } catch (error) {
    console.error(`❌ Backend: Direct update failed:`, error);
    return res.status(500).json({
      message: 'Failed to update message read status',
      details: error.message
    });
  }
};

// @route   PUT /api/messages-list/:messageId/read
// @desc    Mark a message as read
// @access  Private
router.put('/:messageId/read', auth, async (req, res) => {
  try {
    const { messageId } = req.params;
    console.log(`🔍 Backend: Received request to mark message as read: ${messageId}`);

    // Improved UUID detection with better validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const simpleUuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    let isDirectMessageId = false;
    let actualMessageId = messageId;
    let leadId, timestamp;

    // First, try direct UUID match (most common case for new messages)
    if (uuidRegex.test(messageId) || simpleUuidRegex.test(messageId)) {
      console.log(`✅ Backend: Direct UUID detected: ${messageId}`);
      isDirectMessageId = true;
      actualMessageId = messageId;
    } else {
      // Parse composite ID format
      const parts = messageId.split('_');

      if (parts.length >= 2) {
        const firstPart = parts[0];

        // Check if first part is UUID (messageId with timestamp suffix)
        if (uuidRegex.test(firstPart) || simpleUuidRegex.test(firstPart)) {
          console.log(`✅ Backend: UUID with timestamp detected: ${firstPart} (full: ${messageId})`);
          isDirectMessageId = true;
          actualMessageId = firstPart; // Use just the UUID part
        } else {
          // Legacy leadId_timestamp format
          leadId = firstPart;
          timestamp = parts.slice(1).join('_');
          console.log(`✅ Backend: Legacy format - leadId: ${leadId}, timestamp: ${timestamp}`);
        }
      } else {
        console.log(`❌ Backend: Invalid message ID format: ${messageId}`);
        return res.status(400).json({
          success: false,
          message: 'Invalid message ID format',
          details: `Expected UUID or leadId_timestamp format, got: ${messageId}`
        });
      }
    }

    // Handle direct message UUID case (preferred path)
    if (isDirectMessageId) {
      console.log(`🔄 Backend: Using direct message update for UUID: ${actualMessageId}`);
      return await handleDirectMessageUpdate(actualMessageId, res, req);
    }

    // Get the lead's current booking_history
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('booking_history, name')
      .eq('id', leadId)
      .single();

    console.log(`🔍 Backend: Lead lookup result:`, lead);

    if (!lead) {
      console.log(`❌ Backend: Lead not found for ID: ${leadId}`);
      return res.status(404).json({ message: 'Lead not found' });
    }
    
    try {
      // Safely parse booking_history (handle both string and array formats)
      let history = [];
      if (lead.booking_history) {
        try {
          // Handle array format (some leads store booking_history as array)
          if (Array.isArray(lead.booking_history)) {
            history = lead.booking_history;
            console.log(`📋 Lead ${lead.id} has booking_history as array (${history.length} entries)`);
          } else if (typeof lead.booking_history === 'string') {
            // Handle string format (most leads store as JSON string)
            history = JSON.parse(lead.booking_history);
            if (!Array.isArray(history)) {
              history = [];
            }
          } else {
            console.warn(`⚠️ Unexpected booking_history format for lead ${lead.id}:`, typeof lead.booking_history);
            history = [];
          }
        } catch (jsonError) {
          console.warn(`⚠️ Invalid JSON in booking_history for lead ${lead.id}:`, lead.booking_history?.toString()?.substring(0, 100));
          history = [];
        }
      } else {
        console.log(`ℹ️ No booking_history for lead ${lead.id}`);
      }
      
      console.log(`🔍 Backend: Looking for message with timestamp: ${timestamp}`);
      console.log(`🔍 Backend: Available timestamps in history:`);
      history.forEach((entry, index) => {
        console.log(`  ${index}: ${entry.timestamp} (action: ${entry.action}, channel: ${entry.details?.channel})`);
      });

      // Find the specific message entry and mark it as read
      let updated = false;
      let messageContent = '';
      const updatedHistory = history.map((entry, index) => {
        const entryTimestamp = entry.timestamp;
        const targetTimestamp = timestamp;

        // Skip corrupted entries (undefined timestamp or action)
        if (!entryTimestamp || entryTimestamp === 'undefined' || !entry.action) {
          console.log(`⚠️ Skipping corrupted entry ${index} (timestamp: ${entryTimestamp}, action: ${entry.action})`);
          return entry;
        }

        // Skip messages that are not SMS or EMAIL received
        if ((entry.action !== 'SMS_RECEIVED' && entry.action !== 'EMAIL_RECEIVED') ||
            (entry.details?.channel !== 'sms' && entry.details?.channel !== 'email')) {
          console.log(`⚠️ Skipping non-SMS/EMAIL entry ${index} (action: ${entry.action}, channel: ${entry.details?.channel})`);
          return entry;
        }

        console.log(`🔍 Comparing entry ${index}: ${entryTimestamp} vs ${targetTimestamp}`);

        // Normalize timestamps for comparison (handle timezone differences)
        let normalizedEntry = entryTimestamp;
        let normalizedTarget = targetTimestamp;

        // Remove 'Z' suffix for consistent comparison
        if (normalizedEntry && normalizedEntry.includes('Z')) {
          normalizedEntry = normalizedEntry.replace('Z', '');
        }
        if (normalizedTarget && normalizedTarget.includes('Z')) {
          normalizedTarget = normalizedTarget.replace('Z', '');
        }

        // Check for exact match after normalization
        if (normalizedEntry === normalizedTarget) {
          console.log(`✅ Found exact timestamp match: ${entryTimestamp}`);
          if (entry.details) {
            entry.details.read = true;
          } else {
            entry.details = { read: true };
          }
          messageContent = entry.details?.body || entry.details?.message || 'Message';
          updated = true;
          return entry;
        }

        // Check for millisecond match (handles timezone differences)
        try {
          const entryTime = new Date(entryTimestamp).getTime();
          const targetTime = new Date(targetTimestamp).getTime();
          const timeDiff = Math.abs(entryTime - targetTime);

          // Allow for small differences (up to 10 seconds for timezone issues)
          if (timeDiff <= 10000) {
            console.log(`✅ Found millisecond match: ${entryTimestamp} (diff: ${timeDiff}ms)`);
            if (entry.details) {
              entry.details.read = true;
            } else {
              entry.details = { read: true };
            }
            messageContent = entry.details?.body || entry.details?.message || 'Message';
            updated = true;
            return entry;
          }
        } catch (dateCompareError) {
          console.log(`❌ Error comparing dates:`, dateCompareError);
        }

        // Check for ISO date match
        try {
          const targetAsDate = new Date(timestamp).toISOString();
          if (entryTimestamp === targetAsDate) {
            console.log(`✅ Found ISO timestamp match: ${entryTimestamp}`);
            if (entry.details) {
              entry.details.read = true;
            } else {
              entry.details = { read: true };
            }
            messageContent = entry.details?.body || entry.details?.message || 'Message';
            updated = true;
            return entry;
          }
        } catch (dateError) {
          console.log(`❌ Error parsing timestamp as Date: ${timestamp}`, dateError);
        }

        return entry;
      });
      
      if (!updated) {
        console.log(`❌ Backend: No matching message found in booking_history for timestamp: ${timestamp}`);

        // Fallback: Try to update the message directly in the messages table
        // This handles messages that don't have booking_history entries
        console.log(`🔄 Backend: Attempting direct messages table update for messageId: ${messageId}`);

        try {
          console.log(`🔍 Backend: Searching for message ${messageId} in messages table...`);

          const { data: directMessage, error: directError } = await supabase
            .from('messages')
            .select('id, lead_id, sms_body, type, status, created_at')
            .eq('id', messageId)
            .single();

          if (directError || !directMessage) {
            console.log(`❌ Backend: Message ${messageId} not found in messages table`);
            console.log(`❌ Backend: Direct error:`, directError?.message);

            // Debug: Check what messages DO exist
            console.log(`🔍 Backend: Checking what messages exist in database...`);
            const { data: sampleMessages, error: sampleError } = await supabase
              .from('messages')
              .select('id, created_at, type')
              .limit(10);

            if (!sampleError && sampleMessages) {
              console.log(`📊 Backend: Found ${sampleMessages.length} messages in DB`);
              sampleMessages.forEach((msg, i) => {
                console.log(`   ${i + 1}. ${msg.id.substring(0, 8)}... (${msg.type}, ${msg.created_at})`);
              });
            }

            return res.status(404).json({
              message: 'Message not found in booking_history or messages table',
              details: `Message ${messageId} does not exist in the database. This may be stale UI data.`
            });
          }

          console.log(`✅ Backend: Found message ${messageId} in messages table`);
          console.log(`📋 Backend: Message details:`, {
            id: directMessage.id,
            lead_id: directMessage.lead_id,
            type: directMessage.type,
            status: directMessage.status,
            created_at: directMessage.created_at
          });

          console.log(`✅ Backend: Found message in messages table:`, directMessage.id);

          // Update the message directly in the messages table
          const { error: updateError } = await supabase
            .from('messages')
            .update({
              read_status: true,
              read_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', messageId);

          if (updateError) {
            console.log(`❌ Backend: Failed to update message directly:`, updateError.message);
            return res.status(500).json({
              message: 'Failed to update message read status',
              details: updateError.message
            });
          }

          console.log(`✅ Backend: Successfully updated message ${messageId} directly in messages table`);

          // Emit socket event for real-time updates
          if (req.app.get('io')) {
            req.app.get('io').emit('message_read', {
              messageId: messageId,
              leadId: directMessage.lead_id,
              timestamp: new Date().toISOString(),
              content: directMessage.sms_body || 'Message content'
            });
            console.log(`📡 Emitted message_read event for direct update: ${messageId}`);
          }

          return res.json({
            success: true,
            message: 'Message marked as read (direct update)',
            messageId: messageId,
            method: 'direct'
          });

        } catch (fallbackError) {
          console.error(`❌ Backend: Fallback update failed:`, fallbackError);
          return res.status(500).json({
            message: 'Failed to update message read status',
            details: fallbackError.message
          });
        }
      }
      
      // Update both the messages table and booking_history for consistency
      console.log('🔄 Updating message read status in database...');

      // First, try to update the messages table (if read_status column exists)
      try {
        const { error: msgUpdateError } = await supabase
          .from('messages')
          .update({
            read_status: true,
            read_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', messageId);

        if (!msgUpdateError) {
          console.log('✅ Updated read status in messages table');
        } else {
          console.log('⚠️ Messages table update failed (column may not exist):', msgUpdateError.message);
        }
      } catch (msgError) {
        console.log('⚠️ Messages table update failed:', msgError.message);
      }

      // Then update the booking_history
      const { error: updateError } = await supabase
        .from('leads')
        .update({ booking_history: JSON.stringify(updatedHistory) })
        .eq('id', leadId);

      if (updateError) {
        console.error('Error updating lead:', updateError);
        throw updateError;
      }
      
      console.log(`✅ Message marked as read: ${messageId} for lead ${lead.name}`);
      
      // Emit socket event to notify all clients about the read status change
      if (req.app.get('io')) {
        req.app.get('io').emit('message_read', {
          messageId: messageId,
          leadId: leadId,
          leadName: lead.name,
          timestamp: timestamp,
          content: messageContent
        });
        console.log(`📡 Emitted message_read event for message ${messageId}`);
      }
      
      res.json({ 
        success: true,
        message: 'Message marked as read',
        messageId: messageId,
        leadId: leadId,
        read: true
      });
      
    } catch (parseError) {
      console.error('Error parsing booking_history:', parseError);
      return res.status(500).json({ message: 'Error parsing lead history' });
    }
    
  } catch (error) {
    console.error('Error marking message as read:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   PUT /api/messages-list/bulk-read
// @desc    Mark multiple messages as read
// @access  Private
router.put('/bulk-read', auth, async (req, res) => {
  try {
    const { messageIds } = req.body;
    
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ message: 'Invalid messageIds array' });
    }
    
    const results = [];
    const socketEvents = [];
    
    for (const messageId of messageIds) {
      try {
        // Parse the messageId to extract leadId and timestamp
        const parts = messageId.split('_');
        if (parts.length < 2) {
          results.push({ messageId, success: false, error: 'Invalid message ID format' });
          continue;
        }
        
        const leadId = parts[0];
        const timestamp = parts.slice(1).join('_');
        
        // Get the lead's current booking_history
        const { data: lead, error: leadError } = await supabase
          .from('leads')
          .select('booking_history, name')
          .eq('id', leadId)
          .single();
        
        if (!lead) {
          results.push({ messageId, success: false, error: 'Lead not found' });
          continue;
        }

        // Safely parse booking_history
        let history = [];
        if (lead.booking_history) {
          try {
            history = JSON.parse(lead.booking_history);
            if (!Array.isArray(history)) {
              history = [];
            }
          } catch (jsonError) {
            console.warn(`⚠️ Invalid JSON in booking_history for lead ${leadId}:`, lead.booking_history?.substring(0, 100));
            history = [];
          }
        }
        
        // Find the specific message entry and mark it as read
        let updated = false;
        let messageContent = '';
        const updatedHistory = history.map(entry => {
          if (entry.timestamp === timestamp || entry.timestamp === new Date(timestamp).toISOString()) {
            if (entry.details) {
              entry.details.read = true;
            } else {
              entry.details = { read: true };
            }
            messageContent = entry.details?.body || entry.details?.message || 'Message';
            updated = true;
          }
          return entry;
        });
        
        if (!updated) {
          results.push({ messageId, success: false, error: 'Message not found' });
          continue;
        }
        
        // Update the database
        const { error: updateError } = await supabase
          .from('leads')
          .update({ booking_history: JSON.stringify(updatedHistory) })
          .eq('id', leadId);
        
        if (updateError) {
          throw updateError;
        }
        
        results.push({ messageId, success: true });
        socketEvents.push({
          messageId: messageId,
          leadId: leadId,
          leadName: lead.name,
          timestamp: timestamp,
          content: messageContent
        });
        
      } catch (itemError) {
        console.error(`Error processing message ${messageId}:`, itemError);
        results.push({ messageId, success: false, error: itemError.message });
      }
    }
    
    // Emit socket events for all successfully updated messages
    if (req.app.get('io') && socketEvents.length > 0) {
      socketEvents.forEach(event => {
        req.app.get('io').emit('message_read', event);
      });
      console.log(`📡 Emitted ${socketEvents.length} message_read events`);
    }
    
    const successCount = results.filter(r => r.success).length;
    console.log(`✅ Bulk read operation: ${successCount}/${messageIds.length} messages marked as read`);
    
    res.json({ 
      success: true,
      message: `${successCount}/${messageIds.length} messages marked as read`,
      results: results
    });
    
  } catch (error) {
    console.error('Error in bulk read operation:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/messages-list/bulk-delete
// @desc    Delete multiple messages across booking history (JSON/table) and messages table
// @access  Private
router.post('/bulk-delete', auth, async (req, res) => {
  console.log('🗑️ Bulk delete endpoint hit by user:', req.user?.name || req.user?.id);
  try {
    const { messageIds } = req.body;
    console.log('📋 Received request to delete', messageIds?.length || 0, 'messages');
    console.log('📝 Message IDs:', messageIds);
    
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      console.warn('⚠️ Invalid messageIds array received');
      return res.status(400).json({ message: 'Invalid messageIds array' });
    }

    const results = [];

    for (const messageId of messageIds) {
      try {
        console.log(`🔍 Processing deletion for message: ${messageId}`);
        
        // New approach: Message IDs are UUIDs from messages table
        // First, get the message details from the messages table
        const { data: message, error: messageError } = await supabase
          .from('messages')
          .select('id, lead_id, type, content, sms_body, subject, sent_at, created_at')
          .eq('id', messageId)
          .single();
        
        if (messageError || !message) {
          console.warn(`⚠️ Message not found in messages table: ${messageId}`);
          // Try to continue anyway - maybe it only exists in booking_history
        }
        
        const leadId = message?.lead_id;
        const messageTimestamp = message?.sent_at || message?.created_at;
        const messageContent = message?.content || message?.sms_body || message?.subject;
        const messageType = message?.type;
        
        console.log(`  📌 Message details - leadId: ${leadId}, type: ${messageType}, timestamp: ${messageTimestamp}`);

        // 1) Delete from messages table first (primary source)
        if (message) {
          try {
            const { error: deleteError } = await supabase
              .from('messages')
              .delete()
              .eq('id', messageId);
            
            if (deleteError) {
              console.error('  ❌ Error deleting from messages table:', deleteError);
              throw deleteError;
            } else {
              console.log(`  ✅ Successfully deleted from messages table`);
            }
          } catch (err) {
            console.error('  ❌ Error during messages table deletion:', err);
            throw err;
          }
        }

        // 2) Also remove from leads.booking_history JSON if it exists there
        if (leadId) {
          try {
            const { data: lead, error: leadError } = await supabase
              .from('leads')
              .select('id, booking_history')
              .eq('id', leadId)
              .single();
            
            if (lead && lead.booking_history) {
              let history = [];
              try {
                history = JSON.parse(lead.booking_history);
                if (!Array.isArray(history)) {
                  history = [];
                }
              } catch (jsonError) {
                console.warn(`⚠️ Invalid JSON in booking_history for lead ${leadId}`);
                history = [];
              }
              
              const originalLength = history.length;
              
              // Filter out entries that match this message
              const filtered = history.filter(entry => {
                // Match by timestamp and content
                if (!messageTimestamp) return true; // Keep if we don't know the timestamp
                
                const entryTs = entry.timestamp;
                const timestampMatch = (() => {
                  try {
                    return Math.abs(new Date(entryTs).getTime() - new Date(messageTimestamp).getTime()) < 5000; // 5 second window
                  } catch {
                    return entryTs === messageTimestamp;
                  }
                })();
                
                const contentMatch = messageContent && (
                  entry?.details?.body === messageContent ||
                  entry?.details?.message === messageContent ||
                  entry?.details?.subject === messageContent
                );
                
                const typeMatch = messageType && (
                  (messageType === 'sms' && entry?.action?.includes('SMS')) ||
                  (messageType === 'email' && entry?.action?.includes('EMAIL'))
                );
                
                // Remove if timestamp and (content or type) match
                const shouldRemove = timestampMatch && (contentMatch || typeMatch);
                return !shouldRemove;
              });
              
              if (filtered.length !== originalLength) {
                console.log(`  🗑️ Removed ${originalLength - filtered.length} entry from booking_history for lead ${leadId}`);
                const { error: updateError } = await supabase
                  .from('leads')
                  .update({ 
                    booking_history: JSON.stringify(filtered), 
                    updated_at: new Date().toISOString() 
                  })
                  .eq('id', leadId);
                
                if (updateError) {
                  console.error('  ⚠️ Error updating booking_history (non-critical):', updateError);
                } else {
                  console.log(`  ✅ Successfully updated booking_history for lead ${leadId}`);
                }
              } else {
                console.log(`  ℹ️ No matching entry found in booking_history for lead ${leadId}`);
              }
            }
          } catch (err) {
            console.warn('  ⚠️ Error processing booking_history (non-critical):', err);
          }
        }

        console.log(`  ✅ Message ${messageId} successfully deleted`);
        results.push({ messageId, success: true });
      } catch (err) {
        console.error(`  ❌ Failed to delete message ${messageId}:`, err);
        results.push({ messageId, success: false, error: err?.message || String(err) });
      }
    }

    // Emit realtime event for UI cleanup
    try {
      const io = req.app.get('io');
      if (io) {
        const deletedIds = results.filter(r => r.success).map(r => r.messageId);
        io.emit('messages_deleted', { messageIds: deletedIds });
        console.log('📡 Emitted messages_deleted event for', deletedIds.length, 'messages');
      }
    } catch (emitError) {
      console.warn('⚠️ Error emitting socket event:', emitError);
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    
    console.log(`✅ Bulk delete completed: ${successCount} succeeded, ${failureCount} failed`);
    
    if (failureCount > 0) {
      console.warn('⚠️ Failed deletions:', results.filter(r => !r.success));
    }
    
    return res.json({ 
      success: true, 
      deleted: successCount, 
      failed: failureCount,
      results 
    });
  } catch (error) {
    console.error('❌ Bulk delete error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/messages-list/cleanup-orphaned
// @desc    Clean up messages from leads that no longer exist
// @access  Private (Admin only)
router.post('/cleanup-orphaned', auth, async (req, res) => {
  try {
    const { user } = req;

    // Only allow admins to perform cleanup
    if (user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }

    console.log(`🧹 Admin ${user.name} initiated orphaned message cleanup`);

    // Step 1: Get all messages
    const { data: allMessages, error: messagesError } = await supabase
      .from('messages')
      .select('id, lead_id, type, sms_body, content, created_at')
      .order('created_at', { ascending: false });

    if (messagesError) {
      console.error('❌ Error fetching messages:', messagesError);
      return res.status(500).json({ message: 'Error fetching messages', error: messagesError });
    }

    const totalMessages = allMessages?.length || 0;
    console.log(`📨 Found ${totalMessages} total messages`);

    if (!allMessages || allMessages.length === 0) {
      return res.json({
        success: true,
        message: 'No messages found to clean',
        totalMessages: 0,
        orphanedMessages: 0,
        deletedCount: 0
      });
    }

    // Step 2: Get all existing lead IDs
    const { data: existingLeads, error: leadsError } = await supabase
      .from('leads')
      .select('id, name, phone, email');

    if (leadsError) {
      console.error('❌ Error fetching leads:', leadsError);
      return res.status(500).json({ message: 'Error fetching leads', error: leadsError });
    }

    const totalLeads = existingLeads?.length || 0;
    console.log(`👥 Found ${totalLeads} existing leads`);

    // Create a set of existing lead IDs for quick lookup
    const existingLeadIds = new Set(existingLeads?.map(lead => lead.id) || []);

    // Step 3: Identify orphaned messages
    const orphanedMessages = [];
    const validMessages = [];

    allMessages.forEach(message => {
      if (message.lead_id && existingLeadIds.has(message.lead_id)) {
        // Message belongs to existing lead
        validMessages.push(message);
      } else {
        // Message belongs to non-existent lead or has no lead_id
        orphanedMessages.push(message);
      }
    });

    const orphanedCount = orphanedMessages.length;
    const validCount = validMessages.length;

    console.log(`🗑️ Found ${orphanedCount} orphaned messages to delete`);
    console.log(`✅ Found ${validCount} valid messages to keep`);

    let deletedCount = 0;

    // Step 4: Delete orphaned messages in batches
    if (orphanedMessages.length > 0) {
      const batchSize = 50; // Smaller batch size for safety

      for (let i = 0; i < orphanedMessages.length; i += batchSize) {
        const batch = orphanedMessages.slice(i, i + batchSize);
        const idsToDelete = batch.map(msg => msg.id);

        console.log(`   Deleting batch ${Math.floor(i/batchSize) + 1}: ${idsToDelete.length} messages`);

        const { error: deleteError } = await supabase
          .from('messages')
          .delete()
          .in('id', idsToDelete);

        if (deleteError) {
          console.error('❌ Error deleting batch:', deleteError);
          return res.status(500).json({ message: 'Error deleting messages', error: deleteError });
        } else {
          deletedCount += idsToDelete.length;
          console.log(`   ✅ Deleted ${idsToDelete.length} messages`);
        }
      }
    }

    // Step 5: Emit realtime event for UI cleanup
    try {
      const io = req.app.get('io');
      if (io) {
        io.emit('messages_deleted', { cleanup: true, deletedCount });
      }
    } catch {}

    console.log(`🧹 Cleanup complete! Removed ${deletedCount} orphaned messages`);

    return res.json({
      success: true,
      message: `Successfully cleaned up orphaned messages`,
      totalMessages,
      totalLeads,
      orphanedMessages: orphanedCount,
      validMessages: validCount,
      deletedCount
    });

  } catch (error) {
    console.error('❌ Unexpected error during cleanup:', error);
    return res.status(500).json({ message: 'Server error during cleanup', error: error.message });
  }
});

// @route   POST /api/messages-list/reply
// @desc    Send a reply to a message (SMS or Email)
// @access  Private
router.post('/reply', auth, async (req, res) => {
  try {
    const { messageId, reply, replyType } = req.body;
    const { user } = req;

    if (!messageId || !reply || !replyType) {
      return res.status(400).json({
        message: 'messageId, reply, and replyType are required'
      });
    }

    if (!['sms', 'email'].includes(replyType)) {
      return res.status(400).json({
        message: 'replyType must be either "sms" or "email"'
      });
    }

    console.log(`📤 ${user.name} sending ${replyType} reply to message ${messageId}`);

    // First, get the original message to find the lead
    let leadId = null;
    let leadData = null;
    let originalMessage = null;

    // Try to find the message in the messages table first
    const { data: messageData, error: messageError } = await supabase
      .from('messages')
      .select('lead_id, type, sms_body, content, subject')
      .eq('id', messageId)
      .single();

    if (messageData) {
      leadId = messageData.lead_id;
      originalMessage = messageData;
      console.log(`✅ Found message in messages table: lead ${leadId}`);
    } else {
      // Parse composite messageId format for legacy messages
      const parts = messageId.split('_');
      if (parts.length >= 2) {
        leadId = parts[0];
        console.log(`✅ Parsed legacy message ID: lead ${leadId}`);
      } else {
        return res.status(400).json({
          message: 'Invalid message ID format'
        });
      }
    }

    // Get lead data
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single();

    if (!lead) {
      return res.status(404).json({
        message: 'Lead not found'
      });
    }

    leadData = lead;
    console.log(`📋 Replying to lead: ${leadData.name} (${leadData.phone})`);

    // Send the reply
    let result = null;
    let messageRecord = null;

    if (replyType === 'sms') {
      if (!leadData.phone) {
        return res.status(400).json({
          message: 'Lead has no phone number for SMS reply'
        });
      }

      // Send SMS using the SMS service
      result = await sendSMS(leadData.phone, reply);

      if (!result.success) {
        return res.status(500).json({
          message: 'Failed to send SMS',
          error: result.error
        });
      }

      // Create message record for SMS
      messageRecord = {
        id: result.messageId || crypto.randomUUID(),
        lead_id: leadId,
        type: 'sms',
        direction: 'sent',
        sms_body: reply,
        content: reply,
        sent_by: user.id,
        sent_by_name: user.name,
        status: 'sent',
        delivery_status: result.status || 'sent',
        provider_message_id: result.messageId,
        delivery_provider: result.provider || 'bulksms',
        sent_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        read_status: true // Sent messages are marked as read
      };

    } else if (replyType === 'email') {
      if (!leadData.email) {
        return res.status(400).json({
          message: 'Lead has no email address for email reply'
        });
      }

      // Import email service
      const { sendEmail } = require('../utils/emailService');

      // Send email
      result = await sendEmail(
        leadData.email,
        `Re: ${originalMessage?.subject || 'Your Inquiry'}`,
        reply
      );

      if (!result.success) {
        return res.status(500).json({
          message: 'Failed to send email',
          error: result.error
        });
      }

      // Create message record for Email
      messageRecord = {
        id: crypto.randomUUID(),
        lead_id: leadId,
        type: 'email',
        direction: 'sent',
        email_body: reply,
        content: reply,
        subject: `Re: ${originalMessage?.subject || 'Your Inquiry'}`,
        sent_by: user.id,
        sent_by_name: user.name,
        status: 'sent',
        email_status: 'sent',
        sent_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        read_status: true // Sent messages are marked as read
      };
    }

    // Save the sent message to the messages table
    const { error: insertError } = await supabase
      .from('messages')
      .insert(messageRecord);

    if (insertError) {
      console.error('❌ Error saving sent message:', insertError);
      // Don't fail the request if we can't save to messages table
      console.warn('⚠️ Reply sent successfully but failed to save to messages table');
    } else {
      console.log(`✅ Sent message saved to messages table: ${messageRecord.id}`);
    }

    // Add to booking history for tracking
    const historyDetails = {
      channel: replyType,
      body: reply,
      to: replyType === 'sms' ? leadData.phone : leadData.email,
      sent_by: user.name,
      message_id: messageRecord.id,
      reply_to: messageId
    };

    await addBookingHistoryEntry(
      leadId,
      `${replyType.toUpperCase()}_SENT`,
      user.id,
      user.name,
      historyDetails,
      leadData
    );

    // Emit socket event for real-time updates
    if (req.app.get('io')) {
      req.app.get('io').emit('message_sent', {
        messageId: messageRecord.id,
        leadId: leadId,
        leadName: leadData.name,
        type: replyType,
        content: reply,
        sentBy: user.name,
        timestamp: new Date().toISOString()
      });
      console.log(`📡 Emitted message_sent event`);
    }

    res.json({
      success: true,
      message: `${replyType.toUpperCase()} reply sent successfully`,
      messageId: messageRecord.id,
      leadId: leadId,
      leadName: leadData.name,
      type: replyType,
      deliveryStatus: result.status || 'sent'
    });

  } catch (error) {
    console.error('❌ Error sending reply:', error);
    res.status(500).json({
      message: 'Server error while sending reply',
      error: error.message
    });
  }
});

module.exports = router;