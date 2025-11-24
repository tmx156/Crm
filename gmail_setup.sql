-- Gmail API Support Setup for Supabase
-- Run this in Supabase SQL Editor

-- 1. Create gmail_accounts table
CREATE TABLE IF NOT EXISTS gmail_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  crm_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  access_token TEXT,
  refresh_token TEXT,
  scope TEXT,
  token_type TEXT,
  expiry_date BIGINT,
  raw_tokens JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add gmail_message_id to messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;

-- 3. Add metadata to messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 4. Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_messages_gmail_message_id ON messages(gmail_message_id);

-- 5. Verify
SELECT 'Setup complete!' as status;
