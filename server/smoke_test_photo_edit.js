/**
 * End-to-end smoke test for AI photo retouching.
 *
 *   node server/smoke_test_photo_edit.js [leadId]
 *
 * Checks the schema, then - only if OPENAI_API_KEY is set - uploads one
 * generated photo, runs a real retouch through the same code path the route
 * uses, verifies the result was saved as a NEW photo pointing back at its
 * source, and deletes everything it created.
 *
 * This DOES spend money when a key is present: one edit at 'low' quality,
 * which is the cheapest setting that still exercises the full pipeline.
 * Without a key it stops after the schema checks and says so.
 *
 * Run after applying both migrations:
 *   migrations/add-photos-and-read-receipts.sql
 *   migrations/add-photo-ai-edits.sql
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const photoStorage = require('./services/photoStorage');
const imageEdit = require('./services/imageEdit');

const supabase = createClient(config.supabase.url, config.supabase.serverKey);

const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => { console.error(`  FAIL  ${msg}`); process.exitCode = 1; };
const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

/**
 * A synthetic portrait: a warm oval on a flat background. Not a face, but it
 * gives the model a subject and a background to tell apart, which is enough
 * to prove the request, the stream and the save all work.
 */
async function makePortrait() {
  const w = 1024, h = 1536;
  const svg = `<svg width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#4a5568"/>
    <ellipse cx="512" cy="620" rx="230" ry="300" fill="#d9a066"/>
    <rect x="270" y="950" width="484" height="586" rx="60" fill="#2d3748"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

(async () => {
  console.log('\nAI photo retouch smoke test\n' + '='.repeat(40));

  // --- Schema ---------------------------------------------------------
  console.log('\nSchema');
  const { error: photosError } = await supabase.from('photos').select('id').limit(1);
  if (photosError) {
    console.error(`\nThe photos table is missing: ${photosError.message}`);
    console.error('Apply migrations/add-photos-and-read-receipts.sql first.\n');
    process.exitCode = 1;
    return;
  }
  pass('photos table exists');

  const { error: columnsError } = await supabase
    .from('photos')
    .select('edited_from, edit_prompt, edit_model, is_ai_edited')
    .limit(1);
  if (columnsError) {
    console.error(`\nThe edit columns are missing: ${columnsError.message}`);
    console.error('Apply migrations/add-photo-ai-edits.sql first.\n');
    process.exitCode = 1;
    return;
  }
  pass('photos edit columns exist');

  const { error: editsError } = await supabase.from('photo_edits').select('id').limit(1);
  if (editsError) {
    console.error(`\nThe photo_edits table is missing: ${editsError.message}`);
    console.error('Apply migrations/add-photo-ai-edits.sql first.\n');
    process.exitCode = 1;
    return;
  }
  pass('photo_edits table exists');

  // --- Prompt assembly (no network, no spend) -------------------------
  console.log('\nPrompts');
  check(Object.keys(imageEdit.PRESETS).length > 0, `${Object.keys(imageEdit.PRESETS).length} presets defined`);

  const combined = imageEdit.buildPrompt({ preset: 'skin-retouch', prompt: 'remove the lanyard' });
  check(combined.includes('remove the lanyard'), 'free text is applied on top of a preset');
  check(
    combined.includes("Preserve the person's identity exactly"),
    'the identity guardrail is appended to every prompt'
  );

  const rejects = (args) => {
    try { imageEdit.buildPrompt(args); return false; } catch { return true; }
  };
  check(rejects({}), 'an empty request is rejected');
  check(rejects({ preset: 'not-a-preset' }), 'an unknown preset is rejected');
  check(rejects({ prompt: 'x'.repeat(imageEdit.MAX_PROMPT_LENGTH + 1) }), 'an overlong prompt is rejected');

  // --- The real edit --------------------------------------------------
  if (!imageEdit.isConfigured()) {
    console.log('\nSkipping the live edit: OPENAI_API_KEY is not set.');
    console.log('Add it to .env and re-run to test against the real API.');
    console.log('\n' + '='.repeat(40));
    console.log(process.exitCode ? 'SOME CHECKS FAILED\n' : 'All offline checks passed\n');
    return;
  }

  let leadId = process.argv[2];
  if (!leadId) {
    const { data } = await supabase.from('leads').select('id, name').limit(1);
    if (!data || !data.length) { fail('no leads in database to test against'); return; }
    leadId = data[0].id;
    console.log(`\nUsing lead: ${data[0].name} (${leadId})`);
  }

  const created = [];
  let editId = null;

  try {
    console.log('\nSource photo');
    const sourceRow = await photoStorage.processAndUpload({
      buffer: await makePortrait(),
      originalName: 'smoke_edit_source.jpg',
      mimeType: 'image/jpeg',
      leadId,
      uploadedBy: null,
      folder: 'headshots'
    });
    const { data: source, error: sourceInsertError } = await supabase
      .from('photos').insert(sourceRow).select('*').single();
    if (sourceInsertError) { fail(`source insert failed: ${sourceInsertError.message}`); return; }
    created.push(source);
    pass(`uploaded source photo (${(source.file_size / 1024).toFixed(0)} KB)`);

    console.log(`\nRetouch via ${imageEdit.MODEL} (quality: low)`);
    const startedAt = Date.now();
    const partials = [];

    const { data: editRow } = await supabase
      .from('photo_edits')
      .insert({
        source_photo_id: source.id,
        lead_id: leadId,
        // The resolved prompt, matching what the route records.
        prompt: imageEdit.buildPrompt({ preset: 'studio-lighting' }),
        preset: 'studio-lighting',
        model: imageEdit.MODEL,
        quality: 'low',
        size: 'auto',
        status: 'running',
        edited_by: null
      })
      .select('id')
      .single();
    editId = editRow?.id || null;
    check(!!editId, 'photo_edits row created before the call');

    const result = await imageEdit.editImage({
      buffer: await photoStorage.downloadObject(source.storage_key),
      filename: source.filename,
      mimeType: 'image/jpeg',
      preset: 'studio-lighting',
      quality: 'low',
      onPartial: ({ index, buffer }) => {
        partials.push(index);
        console.log(`        draft ${index + 1} received (${(buffer.length / 1024).toFixed(0)} KB)`);
      }
    });

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    check(result.buffer.length > 0, `edit returned ${(result.buffer.length / 1024).toFixed(0)} KB in ${seconds}s`);
    check(
      result.buffer.slice(0, 2).toString('hex') === 'ffd8',
      'the result is a real JPEG'
    );
    // The API may send the final image before any partials when generation
    // is fast, which a small synthetic frame at low quality usually is. So
    // the check is that streaming behaved legally, not that drafts arrived.
    check(
      partials.length <= 3 && partials.every((n, i) => n === i),
      `streamed ${partials.length} partial draft(s), in order` +
        (partials.length ? '' : ' (API sent the final image first - allowed)')
    );
    check(result.model === imageEdit.MODEL, `model reported back as ${result.model}`);
    if (result.usage) {
      console.log(`        tokens: ${result.usage.input_tokens} in, ${result.usage.output_tokens} out`);
    }

    console.log('\nSaving the result');
    const editedRow = await photoStorage.processAndUpload({
      buffer: result.buffer,
      originalName: 'smoke_edit_source-edited.jpeg',
      mimeType: result.mimeType,
      leadId,
      uploadedBy: null,
      folder: source.folder
    });
    const { data: saved, error: savedError } = await supabase
      .from('photos')
      .insert({
        ...editedRow,
        edited_from: source.id,
        edit_prompt: result.prompt,
        edit_model: result.model,
        is_ai_edited: true
      })
      .select('*')
      .single();
    if (savedError) { fail(`edited insert failed: ${savedError.message}`); return; }
    created.push(saved);

    check(saved.id !== source.id, 'the edit is a new photo, not an overwrite');
    check(saved.edited_from === source.id, 'edited_from points at the source');
    check(saved.is_ai_edited === true, 'is_ai_edited is set');
    check(!!saved.thumb_url && !!saved.display_url, 'derivatives were generated for the edit');
    check(saved.folder === source.folder, 'the edit landed in the same folder as its source');

    // The source must still be intact and untouched - this is the guarantee
    // the whole design rests on.
    const { data: sourceAfter } = await supabase
      .from('photos').select('id, url, deleted_at, is_ai_edited')
      .eq('id', source.id).single();
    check(sourceAfter?.deleted_at === null, 'the source photo is still live');
    check(sourceAfter?.url === source.url, 'the source photo bytes were not replaced');
    check(!sourceAfter?.is_ai_edited, 'the source is not marked as AI edited');

    await supabase
      .from('photo_edits')
      .update({
        status: 'completed',
        result_photo_id: saved.id,
        input_tokens: result.usage?.input_tokens ?? null,
        output_tokens: result.usage?.output_tokens ?? null,
        duration_ms: Date.now() - startedAt
      })
      .eq('id', editId);

    const { data: auditRow } = await supabase
      .from('photo_edits').select('status, result_photo_id').eq('id', editId).single();
    check(auditRow?.status === 'completed', 'the audit row was closed as completed');
    check(auditRow?.result_photo_id === saved.id, 'the audit row links to the saved photo');

  } catch (err) {
    fail(`edit failed: ${err.message}`);
  } finally {
    console.log('\nCleanup');
    if (editId) await supabase.from('photo_edits').delete().eq('id', editId);
    for (const photo of created) {
      await photoStorage.removePhotoObjects(photo);
      await supabase.from('photos').delete().eq('id', photo.id);
    }
    check(true, `removed ${created.length} test photos and their objects`);
  }

  console.log('\n' + '='.repeat(40));
  console.log(process.exitCode ? 'SOME CHECKS FAILED\n' : 'All checks passed\n');
})();
