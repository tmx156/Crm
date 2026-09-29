-- =====================================================================
-- Model stats on leads
-- =====================================================================
-- Ported from the Alan CRM, where the same columns arrived in two files
-- (add-model-stats-columns.sql, then add-chest-inches-column.sql). They are
-- combined here and must match that schema exactly, so the Model Stats card
-- and anything that syncs between the two CRMs agree on names and types.
--
-- Additive and idempotent: nothing existing is modified or dropped, and it
-- is safe to run twice. The server detects these columns at runtime, so the
-- calendar keeps working before this has been run - the card just stays
-- empty until it is.
-- =====================================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS height_inches INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS chest_inches  INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS waist_inches  INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS hips_inches   INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS eye_color     VARCHAR(50);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS hair_color    VARCHAR(50);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS hair_length   VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_leads_date_of_birth ON leads (date_of_birth);
