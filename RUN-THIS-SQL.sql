-- =====================================================
-- DUAL EMAIL ACCOUNT - DATABASE MIGRATION
-- =====================================================
-- Copy this entire file and run it in Supabase SQL Editor
-- This adds the email_account field to templates table
-- =====================================================

-- Step 1: Add the email_account column
ALTER TABLE templates
ADD COLUMN IF NOT EXISTS email_account VARCHAR(50) DEFAULT 'primary';

-- Step 2: Set existing templates to use primary account
UPDATE templates
SET email_account = 'primary'
WHERE email_account IS NULL;

-- Step 3: Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_templates_email_account ON templates(email_account);

-- Step 4: Verify the migration worked
SELECT
  id,
  name,
  type,
  email_account,
  is_active
FROM templates
ORDER BY created_at DESC
LIMIT 10;

-- =====================================================
-- You should see your templates listed with
-- email_account = 'primary' for all of them
-- =====================================================
