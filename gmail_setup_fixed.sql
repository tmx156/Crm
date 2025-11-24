-- Step 1: Create gmail_accounts table
CREATE TABLE IF NOT EXISTS gmail_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  crm_user_id UUID,
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
