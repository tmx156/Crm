const crypto = require('crypto');
const config = require('../config');

const FB_API_VERSION = 'v22.0';
const FB_BASE_URL = `https://graph.facebook.com/${FB_API_VERSION}`;

function hashValue(value) {
  if (!value) return null;
  return crypto.createHash('sha256')
    .update(value.toString().trim().toLowerCase())
    .digest('hex');
}

function hashPhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '44' + cleaned.slice(1);
  }
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  }
  return hashValue(cleaned);
}

function buildUserData(lead, options = {}) {
  const userData = {};

  if (lead.email) userData.em = [hashValue(lead.email)];
  if (lead.phone) userData.ph = [hashPhone(lead.phone)];

  if (lead.name) {
    const parts = lead.name.trim().split(/\s+/);
    if (parts.length > 0) userData.fn = [hashValue(parts[0])];
    if (parts.length > 1) userData.ln = [hashValue(parts[parts.length - 1])];
  }

  if (lead.postcode) {
    userData.zp = [hashValue(lead.postcode)];
  }

  userData.country = [hashValue('gb')];

  // fbc/fbp for matching server events to ad clicks
  if (options.fbc) userData.fbc = options.fbc;
  if (options.fbp) userData.fbp = options.fbp;

  // Client IP and user agent improve match quality
  if (options.clientIpAddress) userData.client_ip_address = options.clientIpAddress;
  if (options.clientUserAgent) userData.client_user_agent = options.clientUserAgent;

  return userData;
}

async function sendEvent(eventName, lead, customData = {}, options = {}) {
  const { pixelId, accessToken, testEventCode, eventSourceUrl } = config.facebook;

  if (!pixelId || !accessToken || pixelId === 'your_pixel_id_here') {
    console.warn(`[FB CAPI] Skipped ${eventName} — not configured (pixelId: ${pixelId ? 'set' : 'missing'}, token: ${accessToken ? 'set' : 'missing'})`);
    return null;
  }

  const actionSource = options.actionSource || 'system_generated';

  const eventData = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: actionSource,
    user_data: buildUserData(lead, options),
  };

  if (actionSource === 'website' && eventSourceUrl) {
    eventData.event_source_url = eventSourceUrl;
  }

  if (Object.keys(customData).length > 0) {
    eventData.custom_data = customData;
  }

  eventData.event_id = `${eventName}_${lead.id || 'unknown'}_${Date.now()}`;

  const payload = {
    data: [eventData],
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
      console.error(`[FB CAPI] ERROR ${response.status} sending ${eventName} for "${lead.name}" (${lead.id}):`, JSON.stringify(result.error || result));
      return null;
    }

    console.log(`[FB CAPI] ${eventName} sent for "${lead.name}" (${lead.id}) — events_received: ${result.events_received}, messages: ${JSON.stringify(result.messages || [])}`);
    return result;
  } catch (error) {
    console.error(`[FB CAPI] FETCH FAILED for ${eventName} "${lead.name}" (${lead.id}):`, error.message);
    return null;
  }
}

function trackLead(lead, options = {}) {
  return sendEvent('Lead', lead, {
    content_name: 'CRM Lead',
    lead_event_source: lead.notes || 'crm',
  }, options);
}

function trackBooking(lead, dateBooked, options = {}) {
  return sendEvent('Schedule', lead, {
    content_name: 'Appointment Booking',
    appointment_date: dateBooked,
  }, options);
}

function trackPurchase(lead, sale, options = {}) {
  return sendEvent('Purchase', lead, {
    currency: 'GBP',
    value: parseFloat(sale.amount) || 0,
    content_name: 'Sale',
    payment_method: sale.payment_method || 'unknown',
  }, options);
}

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
        console.error(`[FB CAPI] Batch error (chunk ${i / CHUNK_SIZE + 1}):`, JSON.stringify(result.error || result));
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

async function testConnection() {
  const { pixelId, accessToken, testEventCode } = config.facebook;

  const status = {
    configured: !!(pixelId && accessToken && pixelId !== 'your_pixel_id_here'),
    pixelId: pixelId || 'NOT SET',
    accessTokenSet: !!accessToken,
    testEventCode: testEventCode || 'NOT SET',
    apiVersion: FB_API_VERSION,
    eventSourceUrl: config.facebook.eventSourceUrl || 'NOT SET',
  };

  if (!status.configured) {
    status.error = 'Facebook CAPI is not configured — set FB_PIXEL_ID and FB_ACCESS_TOKEN';
    return status;
  }

  // Fire a test event to verify the token/pixel are valid
  const testLead = {
    id: 'test-diagnostic',
    name: 'FB CAPI Test',
    email: 'test@test.com',
    phone: '07000000000',
  };

  try {
    const url = `${FB_BASE_URL}/${pixelId}/events`;
    const payload = {
      data: [{
        event_name: 'Lead',
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'system_generated',
        user_data: buildUserData(testLead),
        event_id: `test_diagnostic_${Date.now()}`,
      }],
      access_token: accessToken,
    };

    // Always use test event code for diagnostics so it doesn't pollute real data
    payload.test_event_code = testEventCode || 'TEST_DIAGNOSTIC';

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      status.apiReachable = true;
      status.apiError = result.error || result;
      status.httpStatus = response.status;
    } else {
      status.apiReachable = true;
      status.eventsReceived = result.events_received;
      status.messages = result.messages || [];
      status.healthy = true;
    }
  } catch (error) {
    status.apiReachable = false;
    status.fetchError = error.message;
  }

  return status;
}

module.exports = {
  trackLead,
  trackBooking,
  trackPurchase,
  sendBatch,
  buildUserData,
  hashValue,
  testConnection,
};
