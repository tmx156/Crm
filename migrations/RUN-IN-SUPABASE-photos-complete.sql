-- ===================================================================
-- RUN THIS WHOLE FILE IN THE SUPABASE SQL EDITOR
-- ===================================================================
-- Dashboard -> SQL Editor -> New query -> paste all of this -> Run.
--
-- This is add-photos-and-read-receipts.sql followed by
-- add-photo-ai-edits.sql, in the order they must be applied.
--
-- NOTE ON ID TYPES: leads.id, users.id and messages.id are TEXT in this
-- database, not UUID, so every foreign key pointing at them is TEXT too.
-- The new tables still use UUID primary keys of their own. Getting this
-- wrong fails with "key columns are of incompatible types: uuid and text".
--
-- Every statement is additive and idempotent: nothing existing is
-- modified or dropped, and running it twice is harmless.
-- ===================================================================


-- =====================================================================
-- Client Photos, ZIP delivery, and email read receipts
-- =====================================================================
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor).
-- Every statement is additive and idempotent: no existing table, column,
-- or row is modified or dropped, so it is safe to run against production
-- and safe to run twice.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. photos - one row per uploaded image, with its derivatives
-- ---------------------------------------------------------------------
-- Derivatives are generated at upload time by sharp. Grids render
-- thumb_url (~15 KB) and lightboxes render display_url (~250 KB), so the
-- 4 MB original is only ever fetched when it is actually being delivered
-- to a client. See server/services/photoStorage.js.
CREATE TABLE IF NOT EXISTS photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,

    -- Storage location. storage_provider lets us move to R2/S3 later
    -- without touching the rows already written.
    storage_provider TEXT NOT NULL DEFAULT 'supabase',
    bucket           TEXT,
    storage_key      TEXT NOT NULL,
    thumb_key        TEXT,
    display_key      TEXT,

    -- Public URLs, denormalised so listing never needs a signing round-trip
    url         TEXT NOT NULL,
    thumb_url   TEXT,
    display_url TEXT,

    -- Metadata
    filename     TEXT,
    file_size    BIGINT,
    thumb_size   BIGINT,
    display_size BIGINT,
    width        INTEGER,
    height       INTEGER,
    format       TEXT,
    mime_type    TEXT,

    -- Organisation. NULL folder = uncategorised; it still appears under
    -- "Full Shoot", which is the unfiltered view of everything.
    folder      TEXT CHECK (folder IS NULL OR folder IN ('headshots', 'zcard', 'best-pics')),
    description TEXT,
    tags        TEXT[],
    is_primary  BOOLEAN DEFAULT FALSE,
    sort_order  INTEGER,

    uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- Cursor pagination orders by (created_at DESC, id DESC); this index serves
-- both that and the lead_id filter in one scan.
CREATE INDEX IF NOT EXISTS idx_photos_lead_created
    ON photos (lead_id, created_at DESC, id DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_photos_lead_folder
    ON photos (lead_id, folder)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_photos_uploaded_by
    ON photos (uploaded_by)
    WHERE deleted_at IS NULL;


-- ---------------------------------------------------------------------
-- 2. photo_deliveries - audit trail for each ZIP sent to a client
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photo_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    lead_id     TEXT REFERENCES leads(id) ON DELETE CASCADE,
    photo_ids   UUID[] NOT NULL,
    photo_count INTEGER NOT NULL DEFAULT 0,

    -- 'original' ships full-resolution files; 'delivery' ships the 2400px
    -- copies, which are roughly 5x smaller.
    size_variant TEXT NOT NULL DEFAULT 'original'
        CHECK (size_variant IN ('original', 'delivery')),

    zip_bytes BIGINT,
    zip_url   TEXT,
    zip_key   TEXT,

    -- 'attachment' when the zip fit inside the mail, 'link' when it was
    -- uploaded to storage and linked instead.
    delivery_method TEXT CHECK (delivery_method IN ('attachment', 'link')),

    recipient_email TEXT,
    subject         TEXT,
    message_id      TEXT REFERENCES messages(id) ON DELETE SET NULL,

    -- Download tracking. This is the reliable signal, unlike an open pixel.
    download_token TEXT UNIQUE,
    first_downloaded_at TIMESTAMPTZ,
    last_downloaded_at  TIMESTAMPTZ,
    download_count      INTEGER DEFAULT 0,

    status        TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed')),
    error_message TEXT,

    sent_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photo_deliveries_lead
    ON photo_deliveries (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_photo_deliveries_token
    ON photo_deliveries (download_token)
    WHERE download_token IS NOT NULL;


-- ---------------------------------------------------------------------
-- 3. messages - email open tracking
-- ---------------------------------------------------------------------
-- NOTE: the existing read_status / read_at columns mean "a CRM user has
-- read this inbound message" and are untouched here. The columns below
-- are the opposite direction: did the *recipient* open a message we sent.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tracking_id    TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS opened_at      TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS open_count     INTEGER DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_tracking_id
    ON messages (tracking_id)
    WHERE tracking_id IS NOT NULL;


-- ---------------------------------------------------------------------
-- 4. email_opens - one row per open event, for the detail view
-- ---------------------------------------------------------------------
-- Kept separate from messages so repeated opens do not rewrite the
-- message row, and so proxy/prefetch opens can be told apart later.
CREATE TABLE IF NOT EXISTS email_opens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    message_id  TEXT REFERENCES messages(id) ON DELETE CASCADE,
    tracking_id TEXT NOT NULL,
    lead_id     TEXT REFERENCES leads(id) ON DELETE SET NULL,

    user_agent TEXT,
    ip_address TEXT,

    -- Apple Mail Privacy Protection and Gmail's proxy pre-fetch images,
    -- so an open here is evidence, not proof. This flags the ones we can
    -- positively identify as machine fetches.
    is_proxy BOOLEAN DEFAULT FALSE,

    opened_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_opens_message
    ON email_opens (message_id, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_opens_tracking
    ON email_opens (tracking_id);



-- =====================================================================
-- AI photo retouching (OpenAI image edit)
-- =====================================================================
-- Run once in the Supabase SQL editor, after
-- add-photos-and-read-receipts.sql. Every statement is additive and
-- idempotent, so it is safe against production and safe to run twice.
--
-- An edit never overwrites its source. The retouched image is uploaded as
-- a NEW photos row that points back at the original through edited_from,
-- so the shoot as delivered by the photographer is always recoverable and
-- an edit can be re-run with a different prompt without losing anything.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. photos - provenance for AI-generated variants
-- ---------------------------------------------------------------------
ALTER TABLE photos ADD COLUMN IF NOT EXISTS edited_from  UUID REFERENCES photos(id) ON DELETE SET NULL;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS edit_prompt  TEXT;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS edit_model   TEXT;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS is_ai_edited BOOLEAN DEFAULT FALSE;

-- Used to show "3 edits" on a source tile and to walk an edit chain when a
-- photo has been refined over several passes.
CREATE INDEX IF NOT EXISTS idx_photos_edited_from
    ON photos (edited_from)
    WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- 2. photo_edits - one row per attempt, including failures
-- ---------------------------------------------------------------------
-- Separate from photos because a failed or cancelled edit produces no
-- photo at all, and those are the rows worth looking at when someone asks
-- why an edit did not work or what the image spend went on. Token counts
-- come from the usage block on the final stream event.
CREATE TABLE IF NOT EXISTS photo_edits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The photo that was edited, and the photo the edit produced.
    -- result_photo_id stays NULL for anything that did not finish.
    source_photo_id UUID REFERENCES photos(id) ON DELETE CASCADE,
    result_photo_id UUID REFERENCES photos(id) ON DELETE SET NULL,
    lead_id         TEXT REFERENCES leads(id)  ON DELETE CASCADE,

    prompt TEXT NOT NULL,
    -- Which canned recipe was used, if any. NULL means a free-text prompt.
    preset TEXT,

    model   TEXT,
    quality TEXT,
    size    TEXT,

    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
    error_message TEXT,

    input_tokens  INTEGER,
    output_tokens INTEGER,
    duration_ms   INTEGER,

    edited_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photo_edits_source
    ON photo_edits (source_photo_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_photo_edits_lead
    ON photo_edits (lead_id, created_at DESC);

-- Finds edits that were abandoned mid-flight (server restart, browser
-- closed) so they can be swept out of the spend report.
CREATE INDEX IF NOT EXISTS idx_photo_edits_running
    ON photo_edits (created_at)
    WHERE status = 'running';
