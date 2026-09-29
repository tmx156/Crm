/**
 * Email open tracking.
 *
 * WHAT THIS CAN AND CANNOT TELL YOU
 * ---------------------------------
 * A 1x1 image is the only open signal available over SMTP, and it is
 * evidence rather than proof:
 *
 *  - Gmail proxies every image through GoogleImageProxy and caches it, so
 *    you reliably get the FIRST open and then usually nothing more.
 *  - Apple Mail Privacy Protection pre-fetches images the moment mail
 *    arrives, whether or not a human ever looks at it. Those register as
 *    opens that never happened.
 *  - Clients with images off register nothing, so a real read can be
 *    missed entirely.
 *
 * So treat "opened" as a floor with false positives on Apple, not a fact.
 * Where it matters, the ZIP download counter in photo_deliveries is the
 * honest number - a download only happens when a person clicks.
 */

const crypto = require('crypto');

// A 1x1 transparent GIF - 43 bytes, and every mail client renders it.
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

/** Opaque, unguessable id so open URLs cannot be enumerated. */
function createTrackingId() {
  return crypto.randomBytes(16).toString('hex');
}

let warnedLocalhost = false;

/**
 * The address that links in outgoing email should point at.
 *
 * Every link we mail out - gallery, ZIP download, open pixel - is opened by a
 * client on their own device, so it has to be the public address no matter
 * which server sent the email. A link to localhost only ever works on the
 * machine that sent it, which is exactly how it can look fine in testing and
 * be dead for every real recipient.
 *
 *   1. PUBLIC_BASE_URL - set it for a custom domain, or on a local machine so
 *      emails sent from there still link to production.
 *   2. RAILWAY_PUBLIC_DOMAIN - Railway injects this into every service with a
 *      public domain, so production is right without any configuration.
 *   3. localhost, with a warning - only reachable from this machine.
 *
 * Deliberately NOT derived from the incoming request: a booker working on a
 * local copy would then mail clients a link to their own laptop.
 */
function publicBaseUrl() {
  const strip = (u) => u.replace(/\/+$/, '');
  if (process.env.PUBLIC_BASE_URL) return strip(process.env.PUBLIC_BASE_URL);
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${strip(process.env.RAILWAY_PUBLIC_DOMAIN)}`;

  if (!warnedLocalhost) {
    warnedLocalhost = true;
    console.warn('⚠️ No PUBLIC_BASE_URL or RAILWAY_PUBLIC_DOMAIN - emailed links will point at ' +
      'localhost and will not work for recipients. Set PUBLIC_BASE_URL.');
  }
  return 'http://localhost:5000';
}

function trackingUrl(trackingId, baseUrl) {
  const base = (baseUrl || publicBaseUrl()).replace(/\/+$/, '');
  return `${base}/api/track/open/${trackingId}.gif`;
}

/**
 * Append the pixel to an HTML body.
 *
 * Returns the body untouched when it is plain text - injecting a tag there
 * would show the recipient raw HTML. Plain-text sends simply go untracked.
 */
function injectTrackingPixel(body, trackingId, baseUrl) {
  if (!body || !trackingId) return body;

  const isHtml = /<[a-z][\s\S]*>/i.test(body);
  if (!isHtml) return body;

  const url = trackingUrl(trackingId, baseUrl);
  // alt="" and the inline styles stop Outlook drawing a broken-image box
  // and stop the pixel taking up a line of its own.
  const pixel =
    `<img src="${url}" width="1" height="1" alt="" ` +
    `style="display:block;width:1px;height:1px;border:0;outline:0;" />`;

  if (/<\/body>/i.test(body)) {
    return body.replace(/<\/body>/i, `${pixel}</body>`);
  }
  return body + pixel;
}

/**
 * Best-effort classification of an open as a machine fetch.
 *
 * We record these rather than discarding them: a Gmail proxy fetch still
 * means the message reached a real inbox and was rendered, which is worth
 * knowing. It is just not the same as a human deciding to read it.
 */
function isProxyFetch(userAgent) {
  if (!userAgent) return false;
  return /GoogleImageProxy|YahooMailProxy|Microsoft Office|BingPreview|Barracuda|Proofpoint|Mimecast/i
    .test(userAgent);
}

module.exports = {
  PIXEL,
  createTrackingId,
  publicBaseUrl,
  trackingUrl,
  injectTrackingPixel,
  isProxyFetch
};
