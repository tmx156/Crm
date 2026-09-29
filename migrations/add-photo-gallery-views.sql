-- =====================================================================
-- Photo gallery view tracking
-- =====================================================================
-- Run once in the Supabase SQL editor (or: DB_PASSWORD=... node apply_sql.js
-- migrations/add-photo-gallery-views.sql). Additive and idempotent.
--
-- Photo emails now carry a "View your photos" button into a private
-- gallery (server/routes/gallery.js) instead of an attachment. A view there
-- needs a real click, so it is the reliable read receipt. Until this runs,
-- sending and downloads still work; views just aren't counted.
-- =====================================================================

ALTER TABLE photo_deliveries ADD COLUMN IF NOT EXISTS first_viewed_at TIMESTAMPTZ;
ALTER TABLE photo_deliveries ADD COLUMN IF NOT EXISTS last_viewed_at  TIMESTAMPTZ;
ALTER TABLE photo_deliveries ADD COLUMN IF NOT EXISTS view_count      INTEGER DEFAULT 0;

NOTIFY pgrst, 'reload schema';
