# Client Photos + AI Retouch Setup Guide

## 📸 Overview

Two features, one pipeline:

1. **Client photos** — upload a shoot against a lead, browse it in the appointment modal, send a selection to the client as a ZIP, and see when they opened the email and downloaded the files.
2. **AI retouch** — pick any photo and have OpenAI retouch it, watching the result appear draft by draft rather than waiting on a spinner.

A retouch is **always saved as a new photo**. The original as shot is never overwritten, so an edit can be re-run with different instructions, and editing an edit is how you refine in several passes.

## ✨ What it does

- **Live preview** — the API streams up to 3 progressively sharper drafts per edit, and each one is relayed to the browser as it arrives
- **7 presets** — skin retouch, fix lighting, white/grey background, colour grade, headshot crop, clean up
- **Free-text instructions** — on their own or on top of a preset ("remove the lanyard")
- **Identity locked** — every prompt, preset or not, carries an instruction not to change facial features, bone structure, body shape, age, ethnicity or gender. A headshot that flatters someone who does not look like that is worse than an unretouched one: the client turns up to the casting and does not match their card
- **Derivatives** — an edit goes through the same resize pipeline as an upload, so it gets its thumb and display copies and behaves like any other photo, including inside a delivery ZIP
- **Audit trail** — every attempt is recorded in `photo_edits`, failures and cancellations included, with token counts and duration

## 📋 Prerequisites

- Admin or booker role in the CRM (the same privilege as deleting a photo)
- An OpenAI API key with image access — this is **paid usage**, unlike the Gemini key the AI Assistant uses
- Supabase database password, or access to the Supabase SQL editor

## 🚀 Setup

### Step 1: Apply the migrations

Both are additive and idempotent — no existing table, column or row is modified or dropped, and running them twice is harmless.

Paste each file into the Supabase SQL editor (Dashboard → SQL Editor), **in this order**:

```
migrations/add-photos-and-read-receipts.sql
migrations/add-photo-ai-edits.sql
```

Or from the command line, with the database password from
Dashboard → Project Settings → Database:

```bash
DB_PASSWORD=your-db-password node apply_sql.js migrations/add-photos-and-read-receipts.sql
DB_PASSWORD=your-db-password node apply_sql.js migrations/add-photo-ai-edits.sql
```

### Step 2: Add the API key

Get a key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys), then add it to `.env` in the project root:

```env
OPENAI_API_KEY=sk-...
```

Optional overrides, all with sensible defaults. See **Cost** below before
changing the first two — together they move the per-image price by ~15x.

```env
# The model used for edits. Default: gpt-image-2.5-sunburst
# gpt-image-1-mini is the cheap alternative (see Cost).
OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst

# low | medium | high, plus xhigh | max on 2.x models. Default: low
OPENAI_IMAGE_QUALITY=low

# Hard stop for one edit, in ms. Default: 300000 (5 min)
OPENAI_IMAGE_TIMEOUT_MS=300000

# Long edge of a retouched image, in pixels. Output tokens scale with pixel
# count, so this is the main cost dial after quality. Default: 1536
OPENAI_IMAGE_LONG_EDGE=1536

# Auto-retouch: every uploaded photo also gets a magazine finish, saved
# alongside the untouched original. Default: on (inert without an API key)
PHOTO_AUTO_RETOUCH=true
PHOTO_AUTO_RETOUCH_PRESET=magazine
# Follows OPENAI_IMAGE_QUALITY unless set.
PHOTO_AUTO_RETOUCH_QUALITY=low

# How many retouches run at once. Two keeps a 50-photo drop moving without
# tripping image rate limits, which are far tighter than text ones.
PHOTO_AUTO_RETOUCH_CONCURRENCY=2

# Storage bucket for photos. Default: client-photos (created on first use)
PHOTOS_BUCKET=client-photos
```

## ⚡ Auto-retouch on upload

Drop a shoot into the gallery and every photo is queued for a **Magazine
finish** in the background. The upload returns as soon as the originals are
stored — a 50-file drop cannot wait on 50 API calls — and each retouch appears
in the grid as it lands, pushed over the existing Socket.IO connection. The
header shows `retouching 12` while they drain.

The recipe was derived from a real before/after set the studio delivered
(Margaret Bennett, Sep 2026). Across 45 edits it was always the same job:

- the floor-to-wall junction, seams, cracks, scuffs and tape disappear into a
  seamless backdrop
- intruding lamps, stands and cables go
- exposure comes up, colour gets richer but stays true
- skin evens out, texture kept
- **pose, expression, outfit and framing are left completely alone**

So `magazine` is the most conservative reading of the brief: clean up the
room, not the person.

### Output is pinned to the source aspect ratio

This is the part that makes it a retouch rather than a reinterpretation. Ask
for a portrait output from a landscape photo and the model has no choice but
to crop or extend to get there — which is exactly how a "just fix the
lighting" edit comes back with the subject repositioned. `bestSizeFor()`
computes an output that matches the source ratio exactly (both edges a
multiple of 16, never upscaled), so a 4608x3072 frame goes out as 1536x1024.

`size: 'auto'` has the same recomposition problem and is only used as a
fallback when the source dimensions are unknown.

### Turning it off

Per upload: untick **Auto-retouch on upload** in the upload panel.
Permanently: `PHOTO_AUTO_RETOUCH=false`.

### What it does not survive

The queue lives in the server process. A restart mid-drop loses whatever had
not started — those photos keep their originals and simply never get a
retouch. On boot, `recoverStale()` marks any `photo_edits` row stuck at
`running` for over 30 minutes as failed so it does not skew the spend report.
Re-run anything missed from the retouch dialog.

### Step 3: Restart the server

```bash
cd server && npm start
```

Without `OPENAI_API_KEY` the photo gallery works exactly as before and the retouch buttons are simply not shown — the UI asks the server whether editing is configured rather than offering a button that fails.

### Step 4: Verify

```bash
node server/smoke_test_photos.js        # upload, derivatives, listing, pagination
node server/smoke_test_photo_edit.js    # schema, prompts, then one real edit
```

`smoke_test_photo_edit.js` spends money when a key is present: one edit at `low` quality. Without a key it runs the offline checks and stops.

## 🎯 Using it

1. Open an appointment in the Calendar
2. **Client Photos** → **Upload**, drag in the shoot
3. Hover a tile → the **⚡** button opens the retouch dialog
4. Pick a preset, add instructions if you want, press **Retouch**
5. Drafts appear on the right as OpenAI works; the finished photo saves itself to the **Retouched** folder with a **Retouched** badge
6. **Try again** re-runs with different instructions — the original is still there either way
7. To send: **Select to send** → tick the photos → **Send as ZIP** — or select in the gallery (below) and press **Send as ZIP** there

### Folders

There are exactly two, and neither is stored: **Original** is everything uploaded, **Retouched** is everything the AI produced (`is_ai_edited`). A retouch is in the right folder the moment it is saved. The old headshots / z-card / best pics labels are gone from the UI; the column is still in the table but unused.

### Presentation gallery

**Present** in the panel header, or clicking any tile, opens a fullscreen slideshow for showing the client: crossfade, auto-play, thumbnail strip, both folders, selection. Keys: ← → to move, space to play/pause, Enter to select, F for fullscreen, Ctrl+A to select the folder, Esc to close. Ported from the Alan CRM with Cloudinary swapped for our own thumb/display derivatives and its package-sales button replaced by **Send as ZIP**.

## 🔧 Why gpt-image-2.5-sunburst

Sunburst is the variant tuned for edit precision: it changes what was asked and leaves the rest alone, and it processes reference images at high fidelity automatically — which is why no `input_fidelity` flag is sent. For headshots the one unacceptable failure is a face that no longer looks like the client, and this is the model that holds a face steady across an edit.

Override with `OPENAI_IMAGE_MODEL` if that changes.

## 🩺 Troubleshooting

| Symptom | Cause |
| --- | --- |
| No ⚡ button on the tiles | `OPENAI_API_KEY` missing, or your role is not admin/booker |
| "AI photo editing is not configured" | Key missing from `.env`, or the server was not restarted |
| "The OpenAI API key was rejected" | Key is wrong, revoked, or has no image access |
| "rate limit or quota reached" | OpenAI billing limit — check usage on the OpenAI dashboard |
| "OpenAI refused this edit" | The prompt tripped OpenAI's safety filters. Rephrase; asking to change how someone's body or face looks will be refused |
| Preview never appears, then the edit lands all at once | A proxy is buffering the stream. The response sets `Cache-Control: no-transform` and `X-Accel-Buffering: no`; check any nginx in front of the app |
| "table 'public.photos' not found" | Step 1 was not run |
| "key columns ... are of incompatible types: uuid and text" | `leads.id`, `users.id` and `messages.id` are **TEXT** in this database, not UUID. Every foreign key pointing at them must be TEXT; the new tables keep UUID keys of their own |
| "null value in column 'prompt' ... violates not-null constraint" | `photo_edits.prompt` stores the **resolved** prompt sent to OpenAI, never just the booker's note - a preset used on its own has no note |
| "Invalid image file, please check your image file" | The input was too large for the edit API - a 6000x4000, 12.6 MB original triggers it. `prepareForEdit()` now downscales every input to `PHOTO_EDIT_INPUT_MAX_EDGE` (2048) and re-encodes it as baseline sRGB JPEG, which also fixes CMYK, 16-bit, progressive and alpha inputs. Raise the cap only if you raise `OPENAI_IMAGE_LONG_EDGE` past it |

## 🗂️ Files

| File | Role |
| --- | --- |
| `migrations/add-photos-and-read-receipts.sql` | `photos`, `photo_deliveries`, `email_opens`, message tracking columns |
| `migrations/add-photo-ai-edits.sql` | Edit provenance columns, `photo_edits` |
| `server/services/photoStorage.js` | Uploads, derivatives, ZIP build |
| `server/services/imageEdit.js` | The OpenAI call, presets, prompt guardrails, SSE parsing |
| `server/routes/photos.js` | Gallery CRUD |
| `server/routes/photo-delivery.js` | ZIP send + download tracking |
| `server/routes/photo-edit.js` | Retouch, streamed as Server-Sent Events |
| `client/src/components/ClientPhotosPanel.js` | The gallery in the appointment modal |
| `client/src/components/PhotoEditModal.js` | Before/after retouch dialog with the live preview |
| `client/src/components/SendPhotosModal.js` | Send-as-ZIP dialog |
| `client/src/components/ReadReceiptBadge.js` | Opened/downloaded indicator |

## 💰 Cost

Image edits are the expensive end of the OpenAI API. They are billed by input
and output tokens, so an edit pays twice: once for the photo going in, once
for the photo coming out.

### Measured, not estimated

One frame from a real shoot (`DSC_0046.JPG`, 4608x3072 to 1536x1024, magazine
preset, quality `high`), run against the live API on 2026-09-28:

| Model | in | out | time | $/image | $/47-photo shoot |
| --- | --- | --- | --- | --- | --- |
| **gpt-image-2.5-sunburst** | 1782 | 1640 | 27s | **$0.0635** | **$2.98** |
| gpt-image-1-mini | 1772 | 6508 | 42s | $0.0565 | $2.66 |

Note the input tokens: an edit is billed for the photo going in as well as
the one coming out, which is why a published per-image generation price
understates an edit by roughly a quarter.

### Do not use gpt-image-1-mini for this

It looks cheap on paper - image output at $8/M against Sunburst's $30/M - and
it is a trap on both counts:

- **It is only 11% cheaper in practice.** It spends 4x the output tokens on
  the same image, which eats almost the whole rate advantage. It is also 56%
  slower.
- **It does not preserve the person.** On the test frame it returned a
  different woman, in a different dress, in a different pose. Not a retouch;
  a reinterpretation.

Sunburst is the default for exactly this reason. If you want to try another
model, run one real frame through it and look at the result before pointing a
shoot at it.

### Quality is the real lever

`quality` is a dropdown in the retouch dialog and an env default for
auto-retouch. Dropping from `high` to `medium` is roughly a 4x saving, and on
a 1536px image bound for a web gallery the difference is hard to see. `low` is
for checking whether a retouch idea works before paying for the real one.

`OPENAI_IMAGE_LONG_EDGE` is the second lever: output tokens scale with pixel
count, so halving the long edge is a large saving.

### input_fidelity follows the model

The gpt-image-1 family needs `input_fidelity: high` sent explicitly or it will
not hold a face; the 2.x models do it automatically and reject the parameter
outright. The code carries a per-model map and sends the flag only where it
belongs. **Those values were measured against the live API, not read from
documentation** - published guidance had `gpt-image-1-mini` and
`gpt-image-1.5` the wrong way round. If you add a model to that map, probe it
first; sending the flag to a model that does not take it is a hard 400.

### Two more ways to spend less

- **Only retouch what you send.** A client gets their best 6-10, not the whole
  shoot. At `high` that is roughly $0.25-0.40 per client, which against what a
  shoot bills is a rounding error. The per-1000 figures above only matter if
  you are editing every frame.
- **Closing the dialog aborts the request upstream**, so a cancelled edit
  stops costing as soon as you walk away from it.

### Batch API

OpenAI's Batch API runs image edits at **50% off** with a 24-hour turnaround,
up to 50,000 per job, for `gpt-image-1` and `gpt-image-1-mini`. That is the
right tool for retouching whole shoots, where nobody is watching the drafts
stream anyway - mini + medium + batch lands around $6-8 per 1000.

It is **not implemented here**: this feature edits one photo at a time from
the modal, which is the shape that fits "retouch their best six before
sending". Bulk needs a queue, a progress view and an ingest step.

### Measuring it properly

The numbers above are estimates from published rates. Your real cost is in
`photo_edits`, which records tokens per edit:

```sql
-- Actual cost per image, by model and quality. Rates are per million tokens:
-- change them if you switch model (mini is 2.50 / 8, Sunburst is 8 / 30).
SELECT model,
       quality,
       count(*) AS edits,
       round(avg(input_tokens))  AS avg_tokens_in,
       round(avg(output_tokens)) AS avg_tokens_out,
       round((avg(input_tokens) * 8 + avg(output_tokens) * 30) / 1000000.0, 4)
         AS est_usd_per_image
FROM photo_edits
WHERE status = 'completed'
GROUP BY model, quality
ORDER BY model, quality;
```

Retouch ten real photos, read the last column, multiply by your actual volume.
That beats any estimate on this page.
