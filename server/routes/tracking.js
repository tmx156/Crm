/**
 * Public tracking endpoints. No auth: these are hit by mail clients and by
 * recipients, neither of which carries a CRM token.
 *
 * Both handlers are written to never fail visibly - a tracking miss must
 * not turn into a broken image or a dead download link for a client.
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const { PIXEL, isProxyFetch } = require('../utils/emailTracking');

const router = express.Router();
const supabase = createClient(config.supabase.url, config.supabase.serverKey);

/** The pixel itself, sent with caching disabled so repeat opens still register. */
function sendPixel(res) {
  res.set({
    'Content-Type': 'image/gif',
    'Content-Length': PIXEL.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
    // helmet defaults every response to Cross-Origin-Resource-Policy:
    // same-origin, which makes a browser refuse to render this image inside
    // webmail - a different origin entirely. Override it here, and only here.
    'Cross-Origin-Resource-Policy': 'cross-origin'
  });
  res.end(PIXEL);
}

/**
 * GET /api/track/open/:trackingId.gif
 *
 * The pixel is written to the response before the database work, so a slow
 * or failing Supabase call can never leave a broken image in someone's
 * email. Recording is fire-and-forget.
 */
router.get('/open/:trackingId', (req, res) => {
  const trackingId = String(req.params.trackingId || '').replace(/\.gif$/i, '');

  sendPixel(res);

  if (!/^[a-f0-9]{32}$/i.test(trackingId)) return;

  const userAgent = req.get('user-agent') || null;
  // Behind Railway/any proxy, the client address is in x-forwarded-for.
  const ip = (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim() || null;

  (async () => {
    try {
      const { data: message } = await supabase
        .from('messages')
        .select('id, lead_id, opened_at, open_count')
        .eq('tracking_id', trackingId)
        .maybeSingle();

      if (!message) return;

      const now = new Date().toISOString();

      await supabase.from('email_opens').insert({
        message_id: message.id,
        tracking_id: trackingId,
        lead_id: message.lead_id || null,
        user_agent: userAgent,
        ip_address: ip,
        is_proxy: isProxyFetch(userAgent),
        opened_at: now
      });

      // opened_at is the first open and never moves; last_opened_at tracks
      // the most recent one.
      await supabase
        .from('messages')
        .update({
          opened_at: message.opened_at || now,
          last_opened_at: now,
          open_count: (message.open_count || 0) + 1
        })
        .eq('id', message.id);

      console.log(`[track] Open recorded for message ${message.id}`);
    } catch (err) {
      console.error('[track] Failed to record open:', err.message);
    }
  })();
});

/**
 * GET /api/track/download/:token
 *
 * Counts a ZIP download, then redirects to the stored file. Unlike an open
 * pixel this is a real, deliberate action, so it is the trustworthy signal
 * that a client actually received their photos.
 */
router.get('/download/:token', async (req, res) => {
  const token = String(req.params.token || '');

  if (!/^[a-f0-9]{32}$/i.test(token)) {
    return res.status(404).send('Download link not found.');
  }

  try {
    const { data: delivery } = await supabase
      .from('photo_deliveries')
      .select('id, zip_url, first_downloaded_at, download_count')
      .eq('download_token', token)
      .maybeSingle();

    if (!delivery || !delivery.zip_url) {
      return res
        .status(404)
        .send('This download link is no longer available. Please contact us and we will resend your photos.');
    }

    const now = new Date().toISOString();
    supabase
      .from('photo_deliveries')
      .update({
        first_downloaded_at: delivery.first_downloaded_at || now,
        last_downloaded_at: now,
        download_count: (delivery.download_count || 0) + 1,
        updated_at: now
      })
      .eq('id', delivery.id)
      .then(({ error }) => {
        if (error) console.error('[track] Download count update failed:', error.message);
      });

    res.redirect(302, delivery.zip_url);
  } catch (err) {
    console.error('[track] Download handler failed:', err.message);
    res.status(500).send('Something went wrong fetching your photos. Please contact us.');
  }
});

module.exports = router;
