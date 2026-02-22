const crypto = require('crypto');
const config = require('../config');

const FB_API_VERSION = 'v21.0';
const FB_BASE_URL = `https://graph.facebook.com/${FB_API_VERSION}`;

/**
 * Facebook Conversions API (CAPI) Service
 *
 * Sends server-side events to Facebook when leads convert in the CRM.
 * This helps Facebook optimize ad delivery for your campaigns.
 *
 * Events sent:
 *  - Lead: when a new lead is created (from webhook or CRM)
 *  - Schedule: when a lead gets booked for an appointment
 *  - Purchase: when a sale is completed
 */

// SHA-256 hash helper (Facebook requires hashed PII)
function hashValue(value) {
  if (!value) return null;
  return crypto.createHash('sha256')
    .update(value.toString().trim().toLowerCase())
    .digest('hex');
}

// Normalize and hash phone number (E.164 format)
function hashPhone(phone) {
  if (!phone) return null;
  // Strip everything except digits and leading +
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  // Ensure UK numbers have country code
  if (cleaned.startsWith('0')) {
    cleaned = '44' + cleaned.slice(1);
  }
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  }
  return hashValue(cleaned);
}

// Build user_data object for Facebook
function buildUserData(lead) {
  const userData = {};

  if (lead.email) userData.em = [hashValue(lead.email)];
  if (lead.phone) userData.ph = [hashPhone(lead.phone)];

  // Split name if available
  if (lead.name) {
    const parts = lead.name.trim().split(/\s+/);
    if (parts.length > 0) userData.fn = [hashValue(parts[0])];
    if (parts.length > 1) userData.ln = [hashValue(parts[parts.length - 1])];
  }

  if (lead.postcode) {
    userData.zp = [hashValue(lead.postcode)];
  }

  // Country defaults to UK
  userData.country = [hashValue('gb')];

  return userData;
}

/**
 * Send an event to Facebook Conversions API
 */
async function sendEvent(eventName, lead, customData = {}) {
  const { pixelId, accessToken, testEventCode } = config.facebook;

  if (!pixelId || !accessToken || pixelId === 'your_pixel_id_here') {
    // Silently skip if not configured
    return null;
  }

  const eventData = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'system_generated',
    user_data: buildUserData(lead),
  };

  // Add custom data if provided (e.g., sale amount)
  if (Object.keys(customData).length > 0) {
    eventData.custom_data = customData;
  }

  // Add event_id for deduplication
  eventData.event_id = `${eventName}_${lead.id || 'unknown'}_${Date.now()}`;

  const payload = {
    data: [eventData],
    access_token: accessToken,
  };

  // Add test event code if configured (for testing in Events Manager)
  if (testEventCode) {
    payload.test_event_code = testEventCode;
  }

  try {
    const url = `${FB_BASE_URL}/${pixelId}/events`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error(`[FB CAPI] Error sending ${eventName}:`, result.error?.message || result);
      return null;
    }

    console.log(`[FB CAPI] ${eventName} event sent for lead "${lead.name}" - events_received: ${result.events_received}`);
    return result;
  } catch (error) {
    console.error(`[FB CAPI] Failed to send ${eventName} event:`, error.message);
    return null;
  }
}

// ---- Public API ----

/**
 * Track a new lead created (from webhook, manual entry, etc.)
 */
function trackLead(lead) {
  return sendEvent('Lead', lead, {
    content_name: 'CRM Lead',
    lead_event_source: lead.notes || 'crm',
  });
}

/**
 * Track when a lead gets booked for an appointment
 */
function trackBooking(lead, dateBooked) {
  return sendEvent('Schedule', lead, {
    content_name: 'Appointment Booking',
    appointment_date: dateBooked,
  });
}

/**
 * Track when a sale is completed
 */
function trackPurchase(lead, sale) {
  return sendEvent('Purchase', lead, {
    currency: 'GBP',
    value: parseFloat(sale.amount) || 0,
    content_name: 'Sale',
    payment_method: sale.payment_method || 'unknown',
  });
}

/**
 * Send a batch of pre-built event objects to Facebook CAPI.
 * Facebook allows up to 1000 events per request, so this function
 * chunks the array and sends multiple requests if needed.
 *
 * @param {Array} events - Array of event objects (event_name, event_time, user_data, etc.)
 * @returns {Object} { sent: number, errors: number }
 */
async function sendBatch(events) {
  const { pixelId, accessToken, testEventCode } = config.facebook;

  if (!pixelId || !accessToken || pixelId === 'your_pixel_id_here') {
    console.error('[FB CAPI] Not configured — cannot send batch');
    return { sent: 0, errors: 0 };
  }

  const CHUNK_SIZE = 1000;
  let totalSent = 0;
  let totalErrors = 0;

  for (let i = 0; i < events.length; i += CHUNK_SIZE) {
    const chunk = events.slice(i, i + CHUNK_SIZE);

    const payload = {
      data: chunk,
      access_token: accessToken,
    };

    if (testEventCode) {
      payload.test_event_code = testEventCode;
    }

    try {
      const url = `${FB_BASE_URL}/${pixelId}/events`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        console.error(`[FB CAPI] Batch error (chunk ${i / CHUNK_SIZE + 1}):`, result.error?.message || result);
        totalErrors += chunk.length;
      } else {
        totalSent += result.events_received || chunk.length;
        console.log(`[FB CAPI] Batch chunk ${i / CHUNK_SIZE + 1}: ${result.events_received} events received`);
      }
    } catch (error) {
      console.error(`[FB CAPI] Batch chunk ${i / CHUNK_SIZE + 1} failed:`, error.message);
      totalErrors += chunk.length;
    }
  }

  return { sent: totalSent, errors: totalErrors };
}

module.exports = {
  trackLead,
  trackBooking,
  trackPurchase,
  sendBatch,
  buildUserData,
  hashValue,
};
