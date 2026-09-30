/**
 * Send a client their selected photos.
 *
 * Adapted from the contract-delivery flow in the sister CRM, but decoupled
 * from contracts/invoices/packages: this is a plain "tick some photos, send
 * them" action that any booker can fire from the appointment modal.
 *
 * Every send goes out as a branded email with a "View your photos" button
 * into a private gallery (routes/gallery.js) rather than an attachment. The
 * click is the only reliable read receipt - an attachment can't be tracked
 * and an open pixel is easily faked or blocked - and it also sidesteps
 * Gmail's 25 MB ceiling.
 *
 * No ZIP is built here. "Download all" builds one as the client downloads it
 * (services/photoZip.js); building it at send time failed outright past the
 * storage bucket's 45 MB per-file cap - about fourteen full-size photos.
 */

const express = require('express');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../middleware/auth');
const config = require('../config');
const { sendEmail } = require('../utils/emailService');
const { resolveReplyAccount } = require('../utils/emailAccountResolver');
const { createTrackingId, publicBaseUrl } = require('../utils/emailTracking');
const { brandForAccount } = require('../utils/brand');

const router = express.Router();
const supabase = createClient(config.supabase.url, config.supabase.serverKey);

const CAN_SEND_ROLES = ['admin', 'booker'];

const MAX_PHOTOS_PER_SEND = 200;

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * Branded delivery email, in the name of the agency it is sent from.
 *
 * Table-based with inline styles because that is all Outlook and Gmail
 * reliably render. There is deliberately no attachment: the photos live
 * behind the "View your photos" button, and that click is the reliable read
 * receipt (see routes/gallery.js).
 */
function buildEmailHtml({ leadName, photoCount, note, galleryUrl, coverUrl, brand }) {
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
    Your ${photoCount} photo${plural} from ${escapeHtml(brand.name)} are ready to view and download.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f4ef;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="width:100%;max-width:600px;background:#ffffff;">

        <!-- Brand -->
        <tr><td align="center" style="background:#141414;padding:36px 24px 30px;">
          <div style="font-family:${serif};font-size:26px;letter-spacing:8px;color:#ffffff;font-weight:600;">${escapeHtml(brand.main).replace(/ /g, '&nbsp;')}</div>
          ${brand.sub ? `<div style="font-family:${sans};font-size:10px;letter-spacing:7px;color:#b8955a;font-weight:600;padding-top:8px;">
            &#8212;&nbsp;&nbsp;${escapeHtml(brand.sub)}&nbsp;&nbsp;&#8212;
          </div>` : ''}
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
          <div style="font-family:${serif};font-size:15px;letter-spacing:3px;color:#141414;padding-bottom:6px;">${escapeHtml(brand.name.toUpperCase())}</div>
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

    // Stored as 'link' - the gallery is the link, and the existing CHECK
    // constraint only allows 'attachment' | 'link'.
    const deliveryMethod = 'link';
    const downloadToken = crypto.randomBytes(16).toString('hex');

    // What "Download all" will come to. Recorded for the history view; the
    // ZIP itself is only built when the client downloads it.
    const totalBytes = photos.reduce((sum, p) => sum + ((sizeVariant === 'delivery'
      ? (p.display_size || p.file_size)
      : p.file_size) || 0), 0);

    // The client opens this on their own device, so it must be the public
    // address even when a local copy of the CRM sent the email.
    const galleryUrl = `${publicBaseUrl()}/gallery/${downloadToken}`;

    // First photo as a teaser - it makes the email feel personal and gives
    // them a reason to click through.
    const cover = photos.find(p => p.id === photoIds[0]) || photos[0];
    const coverUrl = cover?.display_url || cover?.url || null;

    // Resolved first because it decides the branding: the email body has to
    // name the same agency as the From line it arrives under.
    const { account: fromAccount } = await resolveReplyAccount({ leadId });
    const brand = brandForAccount(fromAccount);

    const emailSubject = subject || `Your photos from ${brand.name}`;
    const emailHtml = buildEmailHtml({
      leadName: lead.name,
      photoCount: photos.length,
      note,
      galleryUrl,
      coverUrl,
      brand
    });

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
      zip_bytes: totalBytes,
      // No stored ZIP: "Download all" streams one on demand (routes/tracking.js).
      zip_url: null,
      zip_key: null,
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
        zipBytes: totalBytes,
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
// Exposed for the delivery tests, which check each agency's branding without
// sending real mail.
module.exports.buildEmailHtml = buildEmailHtml;
