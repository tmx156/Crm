-- Add gmail_message_id column to messages table
-- This column stores Gmail's unique message ID for reliable duplicate detection

-- Check if column already exists (PostgreSQL syntax)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'messages'
    AND column_name = 'gmail_message_id'
  ) THEN
    -- Add the column
    ALTER TABLE messages
    ADD COLUMN gmail_message_id TEXT;

    -- Add index for faster lookups
    CREATE INDEX idx_messages_gmail_message_id
    ON messages(gmail_message_id);

    -- Add comment
    COMMENT ON COLUMN messages.gmail_message_id IS 'Gmail API unique message ID for duplicate detection';

    RAISE NOTICE 'Added gmail_message_id column and index to messages table';
  ELSE
    RAISE NOTICE 'gmail_message_id column already exists';
  END IF;
END $$;

-- Verify the column was added
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'messages'
AND column_name = 'gmail_message_id';
