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
