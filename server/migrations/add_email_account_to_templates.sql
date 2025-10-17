-- Migration: Add email_account field to templates table
-- This allows templates to be linked to specific email accounts (primary/secondary)

-- Add email_account column to templates
ALTER TABLE templates
ADD COLUMN IF NOT EXISTS email_account VARCHAR(50) DEFAULT 'primary';

-- Add comment explaining the column
COMMENT ON COLUMN templates.email_account IS 'Email account to use for sending: primary or secondary';

-- Update existing templates to use primary account
UPDATE templates
SET email_account = 'primary'
WHERE email_account IS NULL;

-- Create index for faster filtering by email account
CREATE INDEX IF NOT EXISTS idx_templates_email_account ON templates(email_account);

-- Success message
SELECT 'Migration completed: email_account field added to templates' AS status;
