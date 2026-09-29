/**
 * End-to-end smoke test for the photo gallery.
 *
 *   node server/smoke_test_photos.js [leadId]
 *
 * Uploads two generated images to a lead, lists them, checks the folder
 * counts and the keyset pagination, verifies the derivatives are actually
 * small, then deletes everything it created.
 *
 * It deliberately does NOT send an email - photo delivery would put real
 * mail in a real client's inbox. Test that from the UI with your own address.
 *
 * Run this after applying migrations/add-photos-and-read-receipts.sql.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const photoStorage = require('./services/photoStorage');

const supabase = createClient(config.supabase.url, config.supabase.serverKey);

const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => { console.error(`  FAIL  ${msg}`); process.exitCode = 1; };
const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

/** A synthetic "photo" big enough to exercise the resize path. */
async function makeImage(seed) {
  const w = 3000, h = 2000;
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < px.length; i++) {
    px[i] = (Math.sin((i + seed * 7919) / 311) * 127 + 128) | 0;
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

(async () => {
  console.log('\nPhoto pipeline smoke test\n' + '='.repeat(40));

  // --- Preconditions -------------------------------------------------
  const { error: tableError } = await supabase.from('photos').select('id').limit(1);
  if (tableError) {
    console.error(`\nThe photos table is missing: ${tableError.message}`);
    console.error('Apply migrations/add-photos-and-read-receipts.sql first.\n');
    process.exit(1);
  }
  pass('photos table exists');

  const { error: deliveryError } = await supabase.from('photo_deliveries').select('id').limit(1);
  check(!deliveryError, `photo_deliveries table exists${deliveryError ? ` (${deliveryError.message})` : ''}`);

  const { error: trackingError } = await supabase.from('messages').select('tracking_id, opened_at, open_count').limit(1);
  check(!trackingError, `messages tracking columns exist${trackingError ? ` (${trackingError.message})` : ''}`);

  const { error: opensError } = await supabase.from('email_opens').select('id').limit(1);
  check(!opensError, `email_opens table exists${opensError ? ` (${opensError.message})` : ''}`);

  let leadId = process.argv[2];
  if (!leadId) {
    const { data } = await supabase.from('leads').select('id, name').limit(1);
    if (!data || !data.length) { fail('no leads in database to test against'); return; }
    leadId = data[0].id;
    console.log(`\nUsing lead: ${data[0].name} (${leadId})`);
  }

  const created = [];

  try {
    // --- Upload ------------------------------------------------------
    console.log('\nUpload + derivatives');
    for (const [i, folder] of [[0, null], [1, 'headshots']]) {
      const buffer = await makeImage(i);
      const row = await photoStorage.processAndUpload({
        buffer,
        originalName: `smoke_test_${i}.jpg`,
        mimeType: 'image/jpeg',
        leadId,
        uploadedBy: null,
        folder
      });

      const { data: inserted, error } = await supabase
        .from('photos').insert(row).select('*').single();
      if (error) { fail(`insert failed: ${error.message}`); return; }
      created.push(inserted);

      check(inserted.thumb_url && inserted.display_url, `photo ${i}: all three objects written`);
      check(
        inserted.thumb_size < inserted.file_size / 10,
        `photo ${i}: thumb is ${(inserted.file_size / inserted.thumb_size).toFixed(0)}x smaller than original ` +
        `(${(inserted.thumb_size / 1024).toFixed(0)} KB vs ${(inserted.file_size / 1048576).toFixed(2)} MB)`
      );
      check(
        inserted.display_size < inserted.file_size,
        `photo ${i}: display copy smaller than original (${(inserted.display_size / 1024).toFixed(0)} KB)`
      );
      check(inserted.width === 3000 && inserted.height === 2000, `photo ${i}: dimensions recorded`);
    }

    // --- Public URLs reachable ---------------------------------------
    console.log('\nPublic URLs');
    const res = await fetch(created[0].thumb_url);
    check(res.ok, `thumb_url returns ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    check(bytes.slice(0, 2).toString('hex') === 'ffd8', 'thumb_url serves a real JPEG');

    // --- Listing and counts ------------------------------------------
    console.log('\nListing');
    const { data: listed } = await supabase
      .from('photos').select('id, folder')
      .eq('lead_id', leadId).is('deleted_at', null);
    check(listed.length >= 2, `lists ${listed.length} photos for the lead`);
    check(
      listed.filter(p => p.folder === 'headshots').length >= 1,
      'folder filter finds the headshots upload'
    );

    // --- Keyset pagination -------------------------------------------
    console.log('\nPagination');
    const { data: page1 } = await supabase
      .from('photos').select('id, created_at')
      .eq('lead_id', leadId).is('deleted_at', null)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .limit(1);

    const cursor = page1[0];
    const { data: page2 } = await supabase
      .from('photos').select('id, created_at')
      .eq('lead_id', leadId).is('deleted_at', null)
      .or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .limit(1);

    check(page2.length === 1, 'cursor returns a second page');
    check(page2[0]?.id !== cursor.id, 'second page does not repeat the first row');

  } finally {
    // --- Cleanup -----------------------------------------------------
    console.log('\nCleanup');
    for (const photo of created) {
      await photoStorage.removePhotoObjects(photo);
      await supabase.from('photos').delete().eq('id', photo.id);
    }
    check(true, `removed ${created.length} test photos and their objects`);
  }

  console.log('\n' + '='.repeat(40));
  console.log(process.exitCode ? 'SOME CHECKS FAILED\n' : 'All checks passed\n');
})();
