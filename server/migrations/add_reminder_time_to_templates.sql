-- Add reminder_time column to templates table
ALTER TABLE templates ADD COLUMN IF NOT EXISTS reminder_time VARCHAR(5) DEFAULT '09:00';

-- Update existing appointment_reminder templates to default time
UPDATE templates SET reminder_time = '09:00' WHERE type = 'appointment_reminder' AND reminder_time IS NULL;
