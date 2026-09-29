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
