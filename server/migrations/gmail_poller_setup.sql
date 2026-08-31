-- Gmail Poller Setup Migration
-- Adds columns and tables needed for Gmail API polling

-- 1. Add gmail_message_id column to messages table (for dedup)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_gmail_message_id ON messages(gmail_message_id) WHERE gmail_message_id IS NOT NULL;

-- 2. Add gmail_account_key column (not needed for single account but keeps compatibility)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS gmail_account_key TEXT;

-- 3. Add attachments JSONB column if not exists
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments JSONB;

-- 4. Create processed_gmail_messages table for dedup tracking
CREATE TABLE IF NOT EXISTS processed_gmail_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key TEXT NOT NULL DEFAULT 'primary',
  gmail_message_id TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_key, gmail_message_id)
);

CREATE INDEX IF NOT EXISTS idx_processed_gmail_lookup
ON processed_gmail_messages(account_key, gmail_message_id);

-- 5. Add unique constraint to prevent duplicate gmail messages per lead
ALTER TABLE messages DROP CONSTRAINT IF EXISTS unique_gmail_message_per_lead;
ALTER TABLE messages ADD CONSTRAINT unique_gmail_message_per_lead UNIQUE (gmail_message_id, lead_id);

-- 6. Ensure read_status column exists (should already exist)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_status BOOLEAN DEFAULT false;
