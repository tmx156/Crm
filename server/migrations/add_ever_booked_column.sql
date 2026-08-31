-- Migration: Add ever_booked column to leads table
-- Purpose: Track if a lead was ever booked, regardless of current status
-- Run this in Supabase SQL Editor

-- Step 1: Add the ever_booked column
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ever_booked BOOLEAN DEFAULT FALSE;

-- Add comment for documentation
COMMENT ON COLUMN leads.ever_booked IS 'Tracks if this lead was ever booked, remains true even after cancellation';

-- Step 2: Backfill existing data - set ever_booked = TRUE for all leads with booked_at timestamp
UPDATE leads
SET ever_booked = TRUE
WHERE booked_at IS NOT NULL;

-- Step 3: Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_leads_ever_booked ON leads(ever_booked) WHERE ever_booked = TRUE;
CREATE INDEX IF NOT EXISTS idx_leads_booked_at ON leads(booked_at) WHERE booked_at IS NOT NULL;

-- Step 4: Verify the migration
SELECT
  COUNT(*) FILTER (WHERE ever_booked = TRUE) as ever_booked_count,
  COUNT(*) FILTER (WHERE booked_at IS NOT NULL) as booked_at_count,
  COUNT(*) FILTER (WHERE status = 'Booked') as currently_booked_count,
  COUNT(*) FILTER (WHERE ever_booked = TRUE AND status = 'Cancelled') as cancelled_but_ever_booked_count,
  COUNT(*) as total_leads
FROM leads
WHERE deleted_at IS NULL;
