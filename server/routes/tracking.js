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
const { streamPhotosAsZip } = require('../services/photoZip');

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
  const gone = 'This download link is no longer available. Please contact us and we will resend your photos.';

  if (!/^[a-f0-9]{32}$/i.test(token)) {
    return res.status(404).send('Download link not found.');
  }

  try {
    const { data: delivery } = await supabase
      .from('photo_deliveries')
      .select('id, lead_id, photo_ids, size_variant, zip_url, first_downloaded_at, download_count')
      .eq('download_token', token)
      // A delivery whose email never went out was never meant to be opened -
      // the same rule the gallery page applies.
      .eq('status', 'sent')
      .maybeSingle();

    if (!delivery) return res.status(404).send(gone);

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

    // Deliveries sent before ZIPs were built on demand have one in storage.
    if (delivery.zip_url) return res.redirect(302, delivery.zip_url);

    const [{ data: rows }, { data: lead }] = await Promise.all([
      supabase
        .from('photos')
        .select('id, filename, storage_key, display_key')
        .in('id', delivery.photo_ids || [])
        .is('deleted_at', null),
      supabase.from('leads').select('name').eq('id', delivery.lead_id).maybeSingle()
    ]);

    // Keep the order the photos were chosen in.
    const byId = new Map((rows || []).map(p => [p.id, p]));
    const photos = (delivery.photo_ids || []).map(id => byId.get(id)).filter(Boolean);
    if (!photos.length) return res.status(404).send(gone);

    const zipName = `Photos_${(lead?.name || 'Client').replace(/[^a-zA-Z0-9]/g, '_')}.zip`;
    const result = await streamPhotosAsZip(res, photos, delivery.size_variant, zipName);
    console.log(`[track] Streamed ZIP for delivery ${delivery.id}: ${result.files} file(s)` +
      (result.missing ? `, ${result.missing} missing` : '') + (result.aborted ? ' (client cancelled)' : ''));
  } catch (err) {
    console.error('[track] Download handler failed:', err.message);
    // Once the ZIP has started the status line is gone; all that is left is
    // to cut the connection so the browser reports a failed download rather
    // than saving a truncated file as if it were complete.
    if (res.headersSent) return res.destroy(err);
    res.status(500).send('Something went wrong fetching your photos. Please contact us.');
  }
});

module.exports = router;
