-- =====================================================================
-- "On The Way" status - client ETA
-- =====================================================================
-- Run once in the Supabase SQL editor (or: DB_PASSWORD=... node apply_sql.js
-- migrations/add-lead-eta.sql). Additive and idempotent - safe to run twice.
--
-- When a client says they're on their way, the calendar sets
-- booking_status = 'On The Way' and stores the expected arrival time here so
-- the diary can show "ETA 10:45" on the booking without opening the lead.
-- The server probes for this column and simply hides the ETA until it exists.
-- =====================================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS eta_at TIMESTAMPTZ;

-- Make PostgREST pick up the new column straight away.
NOTIFY pgrst, 'reload schema';
