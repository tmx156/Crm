-- Optional Migration: Add index for Wrong Number status queries
-- Purpose: Improve query performance when filtering by Wrong Number status
-- Run this in Supabase SQL Editor if needed

-- Create index for Wrong Number status lookups
CREATE INDEX IF NOT EXISTS idx_leads_status_wrong_number ON leads(status) WHERE status = 'Wrong Number';

-- Verify the index was created
SELECT 
    indexname,
    indexdef
FROM 
    pg_indexes
WHERE 
    tablename = 'leads'
    AND indexname LIKE '%status%'
ORDER BY 
    indexname;
