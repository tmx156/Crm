/**
 * Private client photo gallery - the page behind the "View your photos"
 * button in the photo delivery email.
 *
 * WHY A PAGE INSTEAD OF AN ATTACHMENT
 * -----------------------------------
 * An open pixel is a weak signal (Apple pre-loads it, Gmail caches it,
 * images-off clients never fire it) and an attachment cannot be tracked at
 * all. A person has to click through to reach this page, so a view here is
 * the reliable "they have seen their photos" receipt.
 *
 * The view is recorded by a small script on the page rather than by the GET
 * itself: corporate link scanners (Outlook Safe Links, Mimecast, etc.) fetch
 * every link in an email the moment it arrives, but they do not run the page's
 * JavaScript, so counting on the GET would report views that never happened.
 *
 * Public - the unguessable 32-hex token in the URL is the only credential,
 * the same model as the existing /api/track/download link.
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const { isProxyFetch } = require('../utils/emailTracking');

const router = express.Router();
const supabase = createClient(config.supabase.url, config.supabase.serverKey);

const COMPANY = 'John Ryland Models';
const TOKEN_RE = /^[a-f0-9]{32}$/i;

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

async function loadDelivery(token) {
  if (!TOKEN_RE.test(token)) return null;
  const { data } = await supabase
    .from('photo_deliveries')
    .select('*')
    .eq('download_token', token)
    .eq('status', 'sent')
    .maybeSingle();
  return data || null;
}

function notFoundPage(res) {
  res.status(404).send(shell('Gallery not found', `
    <main class="empty">
      <h1>This gallery isn't available</h1>
      <p>The link may have been mistyped or the gallery has been removed.
         Please get in touch and we'll send your photos again.</p>
    </main>`));
}

/** Download URL for one photo, honouring the size chosen when it was sent. */
function photoFileUrl(photo, sizeVariant) {
  const url = sizeVariant === 'delivery' ? (photo.display_url || photo.url) : photo.url;
  if (!url) return null;
  // Supabase public URLs force a save dialog with ?download=<name>
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}download=${encodeURIComponent(photo.filename || 'photo.jpg')}`;
}

/**
 * GET /gallery/:token
 */
router.get('/:token', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  // The app-wide helmet CSP has no allowance for Google Fonts; this page needs it
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self'"
  ].join('; '));

  try {
    const delivery = await loadDelivery(req.params.token);
    if (!delivery) return notFoundPage(res);

    const [{ data: lead }, { data: photoRows }] = await Promise.all([
      supabase.from('leads').select('name').eq('id', delivery.lead_id).maybeSingle(),
      supabase
        .from('photos')
        .select('id, filename, url, display_url, thumb_url')
        .in('id', delivery.photo_ids || [])
        .is('deleted_at', null)
    ]);

    // Keep the order the photos were picked in
    const byId = new Map((photoRows || []).map(p => [p.id, p]));
    const photos = (delivery.photo_ids || []).map(id => byId.get(id)).filter(Boolean);

    if (photos.length === 0) return notFoundPage(res);

    const token = escapeHtml(delivery.download_token);
    const firstName = (lead?.name || '').trim().split(/\s+/)[0];
    const count = photos.length;
    const canDownloadAll = !!delivery.zip_url;

    const tiles = photos.map((p, i) => {
      const view = escapeHtml(p.display_url || p.url);
      const thumb = escapeHtml(p.thumb_url || p.display_url || p.url);
      return `
        <figure class="tile">
          <button class="open" data-index="${i}" aria-label="View photo ${i + 1}">
            <img src="${thumb}" data-full="${view}" alt="Photo ${i + 1}" loading="lazy" />
          </button>
          <a class="dl" href="/gallery/${token}/photo/${escapeHtml(p.id)}" aria-label="Download photo ${i + 1}" title="Download">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </a>
        </figure>`;
    }).join('');

    const body = `
      <header class="hero">
        <div class="brand">
          <span class="brand-main">JOHN RYLAND</span>
          <span class="brand-sub">MODELS</span>
        </div>
        <h1>${firstName ? `${escapeHtml(firstName)}, your` : 'Your'} photos are ready</h1>
        <p class="lede">${count} photo${count === 1 ? '' : 's'} from your shoot, chosen just for you.</p>
        ${canDownloadAll ? `
        <a class="btn" href="/api/track/download/${token}">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download all (${count})
        </a>` : ''}
        <p class="hint">Tap any photo to view it full size.</p>
      </header>

      <main class="grid">${tiles}</main>

      <footer class="foot">
        <p>&copy; ${new Date().getFullYear()} ${COMPANY}</p>
        <p class="small">This private gallery was created just for you. Please don't share the link.</p>
      </footer>

      <div class="lightbox" id="lightbox" hidden>
        <button class="lb-close" aria-label="Close">&times;</button>
        <button class="lb-nav lb-prev" aria-label="Previous">&#8249;</button>
        <img id="lb-img" alt="" />
        <button class="lb-nav lb-next" aria-label="Next">&#8250;</button>
        <a class="lb-dl" id="lb-dl" href="#">Download this photo</a>
      </div>

      <script>
        (function () {
          var token = ${JSON.stringify(delivery.download_token)};
          // Record the view from the browser, not the GET - link scanners
          // fetch the page but don't run scripts. See header comment.
          setTimeout(function () {
            try {
              fetch('/gallery/' + token + '/viewed', { method: 'POST', keepalive: true });
            } catch (e) {}
          }, 1500);

          var tiles = Array.prototype.slice.call(document.querySelectorAll('.tile'));
          var box = document.getElementById('lightbox');
          var img = document.getElementById('lb-img');
          var dl = document.getElementById('lb-dl');
          var current = 0;

          function show(i) {
            current = (i + tiles.length) % tiles.length;
            var t = tiles[current];
            img.src = t.querySelector('img').getAttribute('data-full');
            dl.href = t.querySelector('.dl').getAttribute('href');
            box.hidden = false;
            document.body.style.overflow = 'hidden';
          }
          function hide() { box.hidden = true; img.src = ''; document.body.style.overflow = ''; }

          tiles.forEach(function (t, i) {
            t.querySelector('.open').addEventListener('click', function () { show(i); });
          });
          box.querySelector('.lb-close').addEventListener('click', hide);
          box.querySelector('.lb-prev').addEventListener('click', function (e) { e.stopPropagation(); show(current - 1); });
          box.querySelector('.lb-next').addEventListener('click', function (e) { e.stopPropagation(); show(current + 1); });
          box.addEventListener('click', function (e) { if (e.target === box) hide(); });
          document.addEventListener('keydown', function (e) {
            if (box.hidden) return;
            if (e.key === 'Escape') hide();
            if (e.key === 'ArrowLeft') show(current - 1);
            if (e.key === 'ArrowRight') show(current + 1);
          });
          // Swipe on phones
          var startX = null;
          box.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
          box.addEventListener('touchend', function (e) {
            if (startX === null) return;
            var dx = e.changedTouches[0].clientX - startX;
            if (Math.abs(dx) > 50) show(current + (dx < 0 ? 1 : -1));
            startX = null;
          });
        })();
      </script>`;

    res.send(shell(`Your photos | ${COMPANY}`, body));
  } catch (err) {
    console.error('[gallery] Page failed:', err.message);
    res.status(500).send(shell('Something went wrong', `
      <main class="empty">
        <h1>Something went wrong</h1>
        <p>We couldn't load your gallery just now. Please try again in a moment.</p>
      </main>`));
  }
});

/**
 * POST /gallery/:token/viewed
 * Fired by the page's script. Marks the delivery viewed and, because a view
 * proves the email was opened, fills in the email's open receipt too - so the
 * CRM shows "Opened" even when the client's mail app blocked the pixel.
 */
router.post('/:token/viewed', async (req, res) => {
  res.status(204).end();

  const userAgent = req.get('user-agent') || '';
  if (isProxyFetch(userAgent)) return;

  try {
    const delivery = await loadDelivery(req.params.token);
    if (!delivery) return;

    const now = new Date().toISOString();

    // Needs migrations/add-photo-gallery-views.sql; until then this logs and
    // the download counters below still work.
    const { error: viewError } = await supabase
      .from('photo_deliveries')
      .update({
        first_viewed_at: delivery.first_viewed_at || now,
        last_viewed_at: now,
        view_count: (delivery.view_count || 0) + 1,
        updated_at: now
      })
      .eq('id', delivery.id);
    if (viewError) console.warn('[gallery] View not recorded (run add-photo-gallery-views.sql?):', viewError.message);

    if (delivery.message_id) {
      const { data: message } = await supabase
        .from('messages')
        .select('id, opened_at')
        .eq('id', delivery.message_id)
        .maybeSingle();
      if (message && !message.opened_at) {
        await supabase
          .from('messages')
          .update({ opened_at: now, last_opened_at: now })
          .eq('id', message.id);
      }
    }

    console.log(`[gallery] Viewed: delivery ${delivery.id}`);
  } catch (err) {
    console.error('[gallery] Failed to record view:', err.message);
  }
});

/**
 * GET /gallery/:token/photo/:photoId
 * Single-photo download. Counted with the ZIP downloads, then redirected to
 * the stored file.
 */
router.get('/:token/photo/:photoId', async (req, res) => {
  try {
    const delivery = await loadDelivery(req.params.token);
    const photoId = String(req.params.photoId || '');
    if (!delivery || !(delivery.photo_ids || []).includes(photoId)) return notFoundPage(res);

    const { data: photo } = await supabase
      .from('photos')
      .select('id, filename, url, display_url')
      .eq('id', photoId)
      .is('deleted_at', null)
      .maybeSingle();

    const target = photo && photoFileUrl(photo, delivery.size_variant);
    if (!target) return notFoundPage(res);

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
        if (error) console.error('[gallery] Download count update failed:', error.message);
      });

    res.redirect(302, target);
  } catch (err) {
    console.error('[gallery] Photo download failed:', err.message);
    res.status(500).send('Something went wrong fetching that photo. Please try again.');
  }
});

function shell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
  :root { --ink:#141414; --paper:#f7f4ef; --gold:#b8955a; --muted:#6f6a63; --line:#e6e0d6; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font-family:Inter, -apple-system, Segoe UI, Roboto, Arial, sans-serif; -webkit-font-smoothing:antialiased; }
  .hero { text-align:center; padding:56px 20px 36px; }
  .brand { display:inline-flex; flex-direction:column; align-items:center; gap:6px; margin-bottom:40px; }
  .brand-main { font-family:'Cormorant Garamond', Georgia, serif; font-size:26px; letter-spacing:.32em; font-weight:600; padding-left:.32em; }
  .brand-sub { font-size:11px; letter-spacing:.6em; color:var(--gold); font-weight:600; padding-left:.6em; }
  .brand-sub::before, .brand-sub::after { content:''; display:inline-block; width:28px; height:1px; background:var(--gold); vertical-align:middle; margin:0 12px 3px; }
  h1 { font-family:'Cormorant Garamond', Georgia, serif; font-weight:500; font-size:clamp(32px, 6vw, 48px); line-height:1.1; margin:0 0 14px; }
  .lede { color:var(--muted); font-size:16px; margin:0 0 28px; }
  .btn { display:inline-flex; align-items:center; gap:10px; background:var(--ink); color:#fff; text-decoration:none; padding:15px 30px; font-size:13px; letter-spacing:.14em; text-transform:uppercase; font-weight:600; border-radius:2px; transition:background .2s; }
  .btn:hover { background:#333; }
  .hint { color:var(--muted); font-size:13px; margin:18px 0 0; }
  .grid { columns:3 280px; column-gap:14px; max-width:1200px; margin:0 auto; padding:0 16px 40px; }
  .tile { position:relative; margin:0 0 14px; break-inside:avoid; background:#eae5dc; overflow:hidden; }
  .open { display:block; width:100%; padding:0; border:0; background:none; cursor:zoom-in; }
  .tile img { display:block; width:100%; height:auto; transition:transform .5s ease; }
  .tile:hover img { transform:scale(1.03); }
  .dl { position:absolute; right:10px; bottom:10px; width:38px; height:38px; border-radius:50%; background:rgba(255,255,255,.92); color:var(--ink); display:flex; align-items:center; justify-content:center; box-shadow:0 2px 8px rgba(0,0,0,.15); opacity:0; transition:opacity .2s; }
  .tile:hover .dl, .dl:focus { opacity:1; }
  @media (hover:none) { .dl { opacity:1; } }
  .foot { text-align:center; color:var(--muted); font-size:13px; padding:28px 16px 48px; border-top:1px solid var(--line); max-width:1200px; margin:0 auto; }
  .foot p { margin:4px 0; } .small { font-size:12px; }
  .lightbox { position:fixed; inset:0; background:rgba(10,10,10,.94); display:flex; align-items:center; justify-content:center; z-index:10; }
  .lightbox[hidden] { display:none; }
  .lightbox img { max-width:92vw; max-height:84vh; object-fit:contain; }
  .lb-close { position:absolute; top:14px; right:18px; background:none; border:0; color:#fff; font-size:38px; cursor:pointer; line-height:1; }
  .lb-nav { position:absolute; top:50%; transform:translateY(-50%); background:none; border:0; color:#fff; font-size:54px; cursor:pointer; padding:10px 18px; opacity:.8; }
  .lb-prev { left:4px; } .lb-next { right:4px; }
  .lb-dl { position:absolute; bottom:22px; left:50%; transform:translateX(-50%); color:#fff; font-size:12px; letter-spacing:.14em; text-transform:uppercase; text-decoration:none; border:1px solid rgba(255,255,255,.5); padding:10px 20px; }
  .empty { max-width:520px; margin:120px auto; text-align:center; padding:0 20px; }
  .empty p { color:var(--muted); line-height:1.6; }
</style>
</head>
<body>${body}</body>
</html>`;
}

module.exports = router;
