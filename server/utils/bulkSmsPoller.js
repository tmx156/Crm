const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load centralized configuration
const config = require('../config');

// Simple BulkSMS reply poller that periodically fetches recent messages
// and forwards new inbound (MO) items into our unified webhook so that
// storage, booking_history and realtime events are handled centrally.
// LOGGING DISABLED FOR RAILWAY RATE LIMITS

let pollingTimer = null;
let lastProcessedIso = null; // ISO timestamp cutoff
const processedIds = new Set();

// Persistent storage file path for tracking processed messages
const PROCESSED_MSGS_FILE = path.join(__dirname, '../data/processed_sms_messages.json');

// Load processed messages from persistent storage
function loadProcessedMessages() {
  try {
    // Ensure data directory exists
    const dataDir = path.dirname(PROCESSED_MSGS_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    if (fs.existsSync(PROCESSED_MSGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROCESSED_MSGS_FILE, 'utf8'));
      lastProcessedIso = data.lastProcessedIso || null;
      if (data.processedIds && Array.isArray(data.processedIds)) {
        data.processedIds.forEach(id => processedIds.add(id));
      }
      // console.log(`📂 SMS Poller: Loaded ${processedIds.size} processed message IDs, last processed: ${lastProcessedIso}`);
    } else {
      // console.log('📂 SMS Poller: No existing processed messages file found, starting fresh');
    }
  } catch (error) {
    console.error('❌ Failed to load processed messages:', error.message);
  }
}

// Save processed messages to persistent storage
function saveProcessedMessages() {
  try {
    const data = {
      lastProcessedIso,
      processedIds: Array.from(processedIds)
    };
    fs.writeFileSync(PROCESSED_MSGS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('❌ Failed to save processed messages:', error.message);
  }
}

// Clean up old processed IDs to prevent memory bloat (keep only last 30 days)
function cleanupOldProcessedIds() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let removedCount = 0;
  
  for (const id of processedIds) {
    // If ID contains timestamp (format: timestamp|sender), check if it's old
    if (id.includes('|')) {
      const timestamp = id.split('|')[0];
      if (timestamp < thirtyDaysAgo) {
        processedIds.delete(id);
        removedCount++;
      }
    }
  }
  
  if (removedCount > 0) {
    // console.log(`🧹 SMS Poller: Cleaned up ${removedCount} old processed message IDs`);
    saveProcessedMessages();
  }
}

function isConfigured() {
  return Boolean(process.env.BULKSMS_USERNAME && process.env.BULKSMS_PASSWORD);
}

function isInboundMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;

  const type = String(msg.type || msg.messageType || '').toLowerCase();
  const direction = String(msg.direction || msg.messageDirection || '').toLowerCase();
  const statusType = String(msg?.status?.type || '').toLowerCase();

  // Explicit inbound indicators first
  if (type === 'received' || type === 'inbound' || type === 'mo') return true;
  if (direction === 'inbound' || direction === 'mo' || direction.includes('in')) return true;

  // Explicit outbound indicators
  if (type === 'sent' || type === 'mt' || type === 'outbound') return false;
  if (statusType && ['accepted', 'sent', 'delivered', 'submitted'].includes(statusType)) return false;
  if (direction === 'outbound' || direction === 'mt' || direction.includes('out')) return false;

  // Heuristic:
  // - Inbound typically has numeric sender (msisdn). Treat as inbound only if sender looks numeric.
  const sender = (msg.msisdn || msg.from || '').toString();
  const to = (msg.to || '').toString();
  const hasText = Boolean(msg.text || msg.message || msg.body || msg.content);
  const digitsInSender = (sender.match(/\d/g) || []).length;
  const senderLooksNumeric = digitsInSender >= 7; // UK/local typical msisdn length

  // If "to" exists and sender is alphanumeric (brand name), it's almost certainly outbound
  if (to && hasText && !senderLooksNumeric) return false;

  // Otherwise, only treat as inbound if sender looks like a phone number and there is body
  if (senderLooksNumeric && hasText) return true;

  return false;
}

function getMessageId(msg) {
  return (
    msg.id || msg.messageId || msg.message_id || msg.uuid || null
  );
}

function getMessageText(msg) {
  // Debug: log the message structure to see what fields are available
  if (msg && !msg._logged) {
    // console.log('🔍 BulkSMS message structure:', Object.keys(msg));
    // console.log('🔍 BulkSMS message sample:', JSON.stringify(msg, null, 2));
    msg._logged = true; // Only log once per message
  }

  // Try multiple possible field names for message text
  return msg.text || msg.message || msg.body || msg.content || msg.msg || msg.sms || '';
}

function getSender(ms) {
  return ms.from || ms.msisdn || ms.sender || '';
}

function getTimestamp(ms) {
  const candidates = [
    ms.timestamp,
    ms.createdAt,
    ms.created_at,
    ms.updatedAt,
    ms.receivedAt,
    ms.date,
    ms.time,
  ];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const d = new Date(c);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    } catch {}
  }
  return new Date().toISOString();
}

// Phone number normalization (same as SMS webhook)
function normalizePhone(phone) {
  if (!phone) return '';
  const cleaned = phone.replace(/[^\d]/g, '');
  return cleaned;
}

// Build deterministic deduplication ID (same as SMS webhook)
function buildDeterministicId(sender, text, timestampIso) {
  const base = `${normalizePhone(sender)}|${(timestampIso || '').trim()}|${(text || '').trim()}`;
  return 'sms_' + crypto.createHash('sha1').update(base).digest('hex');
}

async function pollOnce() {
  if (!isConfigured()) {
    // Avoid spamming logs: only log once every 2 minutes
    const now = Date.now();
    if (!global.__bulksms_missing_log_ts || now - global.__bulksms_missing_log_ts > 120000) {
      console.warn('⚠️ BulkSMS poller: credentials not configured');
      global.__bulksms_missing_log_ts = now;
    }
    return;
  }

  try {
    // Fetch recent messages with pagination to reduce egress
    // BulkSMS v1 returns both MT and MO items from /v1/messages
    // We fetch a limited page and filter inbound locally
    const resp = await axios.get('https://api.bulksms.com/v1/messages', {
      auth: {
        username: process.env.BULKSMS_USERNAME,
        password: process.env.BULKSMS_PASSWORD,
      },
      headers: { 'Content-Type': 'application/json' },
      params: {
        limit: 20 // Limit to 20 messages per poll to reduce egress (was unlimited, filter inbound locally)
      },
      timeout: 10000,
    });

    const list = Array.isArray(resp.data) ? resp.data : (resp.data?.data || resp.data?.resources || []);
    if (!Array.isArray(list)) return;

    // Sort newest first if timestamps present
    const sorted = list.slice().sort((a, b) => {
      const ta = new Date(getTimestamp(a)).getTime();
      const tb = new Date(getTimestamp(b)).getTime();
      return tb - ta;
    });

    for (const item of sorted) {
      if (!isInboundMessage(item)) continue;

      // Use the same deduplication key as the SMS webhook for consistency
      const sender = getSender(item);
      const text = getMessageText(item);
      const tsIso = getTimestamp(item);
      const providerId = getMessageId(item);

      // Build the same deduplication key used by SMS webhook
      const dedupKey = (providerId && String(providerId).trim()) || buildDeterministicId(sender, text, tsIso);

      if (processedIds.has(dedupKey)) {
        // console.log(`⚠️ SMS poller: Message already processed (key: ${dedupKey})`);
        continue;
      }

      if (lastProcessedIso && new Date(tsIso).getTime() <= new Date(lastProcessedIso).getTime()) {
        // Already processed in previous runs
        continue;
      }

      // Forward to our own webhook for unified handling
      try {
        const port = process.env.PORT || '5000';
        const base = (process.env.INTERNAL_SERVER_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '');
        const url = `${base}/api/sms/webhook`;
        await axios.post(url, {
          text: getMessageText(item),
          sender: getSender(item),
          messageId: getMessageId(item) || undefined,
          timestamp: tsIso,
        }, { timeout: 8000 });
        processedIds.add(dedupKey);
        if (!lastProcessedIso || new Date(tsIso) > new Date(lastProcessedIso)) {
          lastProcessedIso = tsIso;
        }

        // Save processed messages after each successful processing
        saveProcessedMessages();
        
        // console.log(`✅ BulkSMS poller ingested SMS from ${getSender(item)} via ${url}`);
      } catch (err) {
        console.error('❌ BulkSMS poller webhook forward failed:', err?.message || err);
      }
    }
  } catch (error) {
    // Log concise error to avoid noisy output
    const msg = error?.response?.data || error?.message || String(error);
    console.error('❌ BulkSMS poller fetch failed:', msg);
  }
}

function startBulkSmsPolling() {
  if (pollingTimer) return; // already running
  const enabled = config.sms.pollEnabled;
  if (!enabled) {
    // console.log('⏸️ BulkSMS polling disabled');
    return;
  }
  
  // Load processed messages from persistent storage to prevent duplicates on restart
  loadProcessedMessages();
  
  // Clean up old processed IDs to prevent memory bloat
  cleanupOldProcessedIds();
  
  const intervalMs = config.sms.pollInterval;
  // console.log(`🚀 Starting BulkSMS reply poller (every ${Math.round(intervalMs / 1000)}s)`);
  // console.log(`📊 SMS Poller: Will skip ${processedIds.size} previously processed messages`);
  
  // Initial fetch
  pollOnce();
  pollingTimer = setInterval(pollOnce, intervalMs);
}

function stopBulkSmsPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    // console.log('🛑 BulkSMS reply poller stopped');
  }
}

module.exports = { startBulkSmsPolling, stopBulkSmsPolling };


