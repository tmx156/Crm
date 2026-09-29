/**
 * Send a client their selected photos as a ZIP.
 *
 * Adapted from the contract-delivery flow in the sister CRM, but decoupled
 * from contracts/invoices/packages: this is a plain "tick some photos, send
 * them" action that any booker can fire from the appointment modal.
 *
 * Every send goes out as a branded email with a "View your photos" button
 * into a private gallery (routes/gallery.js) rather than an attachment. The
 * click is the only reliable read receipt - an attachment can't be tracked
 * and an open pixel is easily faked or blocked - and it also sidesteps
 * Gmail's 25 MB ceiling. The ZIP is still built and stored so the gallery
 * can offer "Download all".
 */

const express = require('express');
const crypto = require('crypto');
const archiver = require('archiver');
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../middleware/auth');
const config = require('../config');
const photoStorage = require('../services/photoStorage');
const { sendEmail } = require('../utils/emailService');
const { resolveReplyAccount } = require('../utils/emailAccountResolver');
const { createTrackingId } = require('../utils/emailTracking');

const router = express.Router();
const supabase = createClient(config.supabase.url, config.supabase.serverKey);

const CAN_SEND_ROLES = ['admin', 'booker'];

const MAX_PHOTOS_PER_SEND = 200;

// Downloads run a few at a time: unbounded parallelism on a 100-photo send
// would open 100 sockets and spike memory by ~440 MB.
const DOWNLOAD_CONCURRENCY = 4;

/** Pull objects for every photo, a few at a time, preserving input order. */
async function fetchPhotoBuffers(photos, variant) {
  const results = new Array(photos.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < photos.length) {
      const index = cursor++;
      const photo = photos[index];
      // 'delivery' ships the 1400px copy - about 15x smaller than the
      // original and fine for web, social and proofing.
      const key = variant === 'delivery'
        ? (photo.display_key || photo.storage_key)
        : photo.storage_key;

      results[index] = {
        filename: photo.filename || `photo_${index + 1}.jpg`,
        buffer: await photoStorage.downloadObject(key)
      };
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, photos.length) }, worker)
  );

  return results;
}

/**
 * Build the ZIP in memory.
 *
 * Compression is level 1, not 9. JPEGs are already entropy-coded, so deflate
 * recovers well under 1% on them while level 9 costs several times the CPU;
 * on a 100-photo send that is the difference between seconds and a request
 * timeout. Level 1 still trims PNG and TIFF uploads.
 */
function buildZip(entries) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver('zip', { zlib: { level: 1 } });
    const used = new Map();

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    for (const entry of entries) {
      // Two files called IMG_1234.jpg must not silently collapse into one
      // entry, so de-duplicate names as we go.
      let name = entry.filename;
      if (used.has(name)) {
        const next = used.get(name) + 1;
        used.set(name, next);
        const dot = name.lastIndexOf('.');
        name = dot > 0
          ? `${name.slice(0, dot)}_${next}${name.slice(dot)}`
          : `${name}_${next}`;
      } else {
        used.set(name, 1);
      }
      archive.append(entry.buffer, { name });
    }

    archive.finalize();
  });
}

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * Branded John Ryland Models delivery email.
 *
 * Table-based with inline styles because that is all Outlook and Gmail
 * reliably render. There is deliberately no attachment: the photos live
 * behind the "View your photos" button, and that click is the reliable read
 * receipt (see routes/gallery.js).
 */
function buildEmailHtml({ leadName, photoCount, note, galleryUrl, coverUrl }) {
  const firstName = (leadName || '').trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
  const plural = photoCount === 1 ? '' : 's';
  const serif = "'Cormorant Garamond',Georgia,'Times New Roman',serif";
  const sans = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  const noteBlock = note
    ? `<tr><td style="padding:0 48px 20px;font-family:${sans};font-size:15px;line-height:1.7;color:#3d3a36;">
         ${escapeHtml(note).replace(/\n/g, '<br />')}
       </td></tr>`
    : '';

  const cover = coverUrl
    ? `<tr><td style="padding:0 48px 32px;">
         <a href="${galleryUrl}" style="text-decoration:none;">
           <img src="${escapeHtml(coverUrl)}" width="504" alt="A preview of your photos"
                style="display:block;width:100%;max-width:504px;height:auto;border:0;" />
         </a>
       </td></tr>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>Your photos are ready</title>
</head>
<body style="margin:0;padding:0;background:#f7f4ef;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    Your ${photoCount} photo${plural} from John Ryland Models are ready to view and download.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f4ef;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="width:100%;max-width:600px;background:#ffffff;">

        <!-- Brand -->
        <tr><td align="center" style="background:#141414;padding:36px 24px 30px;">
          <div style="font-family:${serif};font-size:26px;letter-spacing:8px;color:#ffffff;font-weight:600;">JOHN&nbsp;RYLAND</div>
          <div style="font-family:${sans};font-size:10px;letter-spacing:7px;color:#b8955a;font-weight:600;padding-top:8px;">
            &#8212;&nbsp;&nbsp;MODELS&nbsp;&nbsp;&#8212;
          </div>
        </td></tr>

        <!-- Heading -->
        <tr><td align="center" style="padding:48px 48px 12px;font-family:${serif};font-size:36px;line-height:1.15;color:#141414;font-weight:500;">
          Your photos are ready
        </td></tr>
        <tr><td align="center" style="padding:0 48px 32px;">
          <div style="width:48px;height:1px;background:#b8955a;line-height:1px;font-size:1px;">&nbsp;</div>
        </td></tr>

        <!-- Message -->
        <tr><td style="padding:0 48px 16px;font-family:${sans};font-size:15px;line-height:1.7;color:#3d3a36;">
          ${greeting}
        </td></tr>
        <tr><td style="padding:0 48px 20px;font-family:${sans};font-size:15px;line-height:1.7;color:#3d3a36;">
          Thank you for shooting with us. We've put your ${photoCount} photo${plural} together in a
          private gallery, where you can view them full size and download them in one tap.
        </td></tr>
        ${noteBlock}

        ${cover}

        <!-- Button -->
        <tr><td align="center" style="padding:0 48px 36px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" bgcolor="#141414" style="background:#141414;">
              <a href="${galleryUrl}"
                 style="display:inline-block;padding:17px 44px;font-family:${sans};font-size:13px;font-weight:600;
                        letter-spacing:3px;text-transform:uppercase;color:#ffffff;text-decoration:none;">
                View your photos
              </a>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 48px 40px;font-family:${sans};font-size:12px;line-height:1.6;color:#8a847b;" align="center">
          Button not working? Copy this link into your browser:<br />
          <a href="${galleryUrl}" style="color:#8a847b;word-break:break-all;">${galleryUrl}</a>
        </td></tr>

        <!-- Footer -->
        <tr><td align="center" style="background:#faf8f4;border-top:1px solid #ece6dc;padding:28px 32px;
                                      font-family:${sans};font-size:12px;line-height:1.6;color:#8a847b;">
          <div style="font-family:${serif};font-size:15px;letter-spacing:3px;color:#141414;padding-bottom:6px;">JOHN RYLAND MODELS</div>
          This private gallery was created just for you. Please don't forward this email.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * POST /api/photo-delivery/send
 * Body: leadId, photoIds[], sizeVariant, subject, note, recipientEmail
 */
router.post('/send', auth, async (req, res) => {
  try {
    if (!CAN_SEND_ROLES.includes(req.user?.role)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to send photos' });
    }

    const { leadId, photoIds, sizeVariant = 'original', subject, note } = req.body;

    if (!leadId) {
      return res.status(400).json({ success: false, message: 'leadId is required' });
    }
    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Select at least one photo' });
    }
    if (photoIds.length > MAX_PHOTOS_PER_SEND) {
      return res.status(400).json({
        success: false,
        message: `Too many photos in one send (${photoIds.length}, max ${MAX_PHOTOS_PER_SEND})`
      });
    }
    if (!['original', 'delivery'].includes(sizeVariant)) {
      return res.status(400).json({ success: false, message: `Unknown size: ${sizeVariant}` });
    }

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id, name, email')
      .eq('id', leadId)
      .single();

    if (leadError || !lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const recipientEmail = req.body.recipientEmail || lead.email;
    if (!recipientEmail) {
      return res.status(400).json({ success: false, message: 'This lead has no email address' });
    }

    // Fetch by id AND lead_id so a crafted request cannot pull another
    // client's photos into this delivery.
    const { data: photos, error: photoError } = await supabase
      .from('photos')
      .select('id, filename, storage_key, display_key, file_size, display_size, url, display_url')
      .in('id', photoIds)
      .eq('lead_id', leadId)
      .is('deleted_at', null);

    if (photoError) throw photoError;

    if (!photos || photos.length !== photoIds.length) {
      return res.status(400).json({
        success: false,
        message: `${photoIds.length - (photos?.length || 0)} of the selected photos could not be found for this lead`
      });
    }

    const deliveryId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const dateStr = new Date().toISOString().split('T')[0];
    const zipFilename = `Photos_${(lead.name || 'Client').replace(/[^a-zA-Z0-9]/g, '_')}_${dateStr}.zip`;

    console.log(`[delivery] Building ZIP: ${photos.length} photos, variant=${sizeVariant}`);

    const entries = await fetchPhotoBuffers(photos, sizeVariant);
    const zipBuffer = await buildZip(entries);
    const zipMB = zipBuffer.length / 1048576;

    console.log(`[delivery] ZIP built: ${zipMB.toFixed(2)} MB`);

    // Stored as 'link' - the gallery is the link, and the existing CHECK
    // constraint only allows 'attachment' | 'link'.
    const deliveryMethod = 'link';
    const downloadToken = crypto.randomBytes(16).toString('hex');
    const { url: zipUrl, key: zipKey } = await photoStorage.uploadZip(zipBuffer, zipFilename);

    const base = (process.env.PUBLIC_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
    const galleryUrl = `${base}/gallery/${downloadToken}`;

    // First photo as a teaser - it makes the email feel personal and gives
    // them a reason to click through.
    const cover = photos.find(p => p.id === photoIds[0]) || photos[0];
    const coverUrl = cover?.display_url || cover?.url || null;

    const emailSubject = subject || `Your photos from your shoot`;
    const emailHtml = buildEmailHtml({
      leadName: lead.name,
      photoCount: photos.length,
      note,
      galleryUrl,
      coverUrl
    });

    const { account: fromAccount } = await resolveReplyAccount({ leadId });
    const trackingId = createTrackingId();
    const nowIso = new Date().toISOString();

    // Record the delivery BEFORE sending: the gallery link in the email only
    // works once this row exists, and a failure then stays visible in the
    // history instead of vanishing. message_id is filled in after the send
    // because it references messages.id, which doesn't exist yet.
    const { error: deliveryError } = await supabase.from('photo_deliveries').insert({
      id: deliveryId,
      lead_id: leadId,
      photo_ids: photos.map(p => p.id),
      photo_count: photos.length,
      size_variant: sizeVariant,
      zip_bytes: zipBuffer.length,
      zip_url: zipUrl,
      zip_key: zipKey,
      delivery_method: deliveryMethod,
      recipient_email: recipientEmail,
      subject: emailSubject,
      download_token: downloadToken,
      status: 'pending',
      sent_by: req.user.id,
      created_at: nowIso,
      updated_at: nowIso
    });
    if (deliveryError) {
      // Sending anyway would email the client a dead gallery link
      console.error('[delivery] Could not record delivery:', deliveryError.message);
      return res.status(500).json({
        success: false,
        message: `Could not prepare the gallery: ${deliveryError.message}`
      });
    }

    const sendResult = await sendEmail(
      recipientEmail,
      emailSubject,
      emailHtml,
      [],
      fromAccount,
      null,
      { trackingId }
    );

    let messageError = null;
    if (sendResult.success) {
      ({ error: messageError } = await supabase.from('messages').insert({
        id: messageId,
        lead_id: leadId,
        type: 'email',
        subject: emailSubject,
        email_body: emailHtml,
        content: emailHtml,
        recipient_email: recipientEmail,
        gmail_account_key: fromAccount,
        sent_by: req.user.id,
        sent_by_name: req.user.name,
        status: 'sent',
        email_status: 'sent',
        tracking_id: trackingId,
        open_count: 0,
        sent_at: nowIso,
        created_at: nowIso,
        read_status: true
      }));
      if (messageError) console.error('[delivery] Could not record message:', messageError.message);
    }

    const { error: statusError } = await supabase
      .from('photo_deliveries')
      .update({
        status: sendResult.success ? 'sent' : 'failed',
        error_message: sendResult.success ? null : sendResult.error,
        message_id: sendResult.success && !messageError ? messageId : null,
        updated_at: new Date().toISOString()
      })
      .eq('id', deliveryId);
    if (statusError) console.error('[delivery] Could not update delivery status:', statusError.message);

    if (!sendResult.success) {
      console.error('[delivery] Send failed:', sendResult.error);
      return res.status(500).json({
        success: false,
        message: `Failed to send: ${sendResult.error}`
      });
    }

    console.log(`[delivery] Sent ${photos.length} photos to ${recipientEmail} via ${deliveryMethod}`);

    res.json({
      success: true,
      delivery: {
        id: deliveryId,
        photoCount: photos.length,
        zipBytes: zipBuffer.length,
        deliveryMethod,
        recipientEmail,
        sizeVariant
      },
      message: `Sent a private gallery of ${photos.length} photos to ${recipientEmail}. You'll see when they view or download them.`
    });
  } catch (error) {
    console.error('[delivery] Failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/photo-delivery?leadId=...
 * Past sends for a lead, newest first, with their download status.
 */
router.get('/', auth, async (req, res) => {
  try {
    const { leadId } = req.query;
    if (!leadId) {
      return res.status(400).json({ success: false, message: 'leadId is required' });
    }

    const { data, error } = await supabase
      .from('photo_deliveries')
      // '*' rather than a column list so first_viewed_at/view_count show up
      // once add-photo-gallery-views.sql has run, without breaking before
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    res.json({ success: true, deliveries: data || [] });
  } catch (error) {
    console.error('[delivery] History failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
