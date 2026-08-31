-- Check and Fix booking_history foreign key issue

-- Step 1: Check if your user exists
SELECT id, name, email, role 
FROM users 
WHERE id = '076c10cc-d318-4af9-b126-6c17b8381307';
-- If this returns nothing, your user doesn't exist

-- Step 2: Check all users in the system
SELECT id, name, email, role, created_at 
FROM users 
ORDER BY created_at DESC 
LIMIT 10;

-- Option A: Make performed_by nullable (recommended for now)
-- This allows booking history to save even if user is deleted
ALTER TABLE booking_history 
DROP CONSTRAINT IF EXISTS booking_history_performed_by_fkey;

ALTER TABLE booking_history 
ALTER COLUMN performed_by DROP NOT NULL;

ALTER TABLE booking_history 
ADD CONSTRAINT booking_history_performed_by_fkey 
FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE SET NULL;

-- Option B: If you need to fix existing invalid records
-- UPDATE booking_history 
-- SET performed_by = NULL 
-- WHERE performed_by NOT IN (SELECT id FROM users);

