-- Add Database-Level Safeguards for Duplicate Prevention
-- Run this in Supabase SQL Editor for optimal duplicate prevention

-- 1. Add index for better performance
-- This makes duplicate checking faster (important when polling frequently)
CREATE INDEX IF NOT EXISTS idx_messages_provider_msg_lead
ON messages(provider_message_id, lead_id)
WHERE type = 'email' AND provider_message_id IS NOT NULL;

-- 2. Add index on provider_message_id alone for quick lookups
CREATE INDEX IF NOT EXISTS idx_messages_provider_message_id
ON messages(provider_message_id)
WHERE provider_message_id IS NOT NULL;

-- 3. OPTIONAL: Add unique constraint to prevent duplicates at database level
-- This ensures that even if application logic fails, database won't allow duplicates
-- IMPORTANT: Only run this AFTER verifying no duplicates exist
-- Uncomment the line below if you want this extra protection:

-- ALTER TABLE messages ADD CONSTRAINT unique_provider_message_per_lead
-- UNIQUE (provider_message_id, lead_id);

-- 4. Verify indexes were created
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'messages'
AND indexname LIKE '%provider%'
ORDER BY indexname;

-- 5. Check current duplicate status (should return 0)
SELECT COUNT(*) - COUNT(DISTINCT provider_message_id) as duplicate_count
FROM messages
WHERE type = 'email' AND provider_message_id IS NOT NULL;

-- 6. Show any messages without provider_message_id (should be 0 or only non-Gmail emails)
SELECT type, COUNT(*) as count
FROM messages
WHERE type = 'email' AND provider_message_id IS NULL
GROUP BY type;
