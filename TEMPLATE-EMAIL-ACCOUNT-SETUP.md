# Template Email Account Linking - Setup Guide

This feature allows you to link templates to specific email accounts (Avensis or Camry) and easily select them when booking appointments.

## Step 1: Database Migration

Run this SQL in your **Supabase SQL Editor**:

```sql
-- Add email_account column to templates table
ALTER TABLE templates
ADD COLUMN IF NOT EXISTS email_account VARCHAR(50) DEFAULT 'primary';

-- Update existing templates to use primary account
UPDATE templates
SET email_account = 'primary'
WHERE email_account IS NULL;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_templates_email_account ON templates(email_account);
```

## Step 2: How It Works

### For Users (Booking Modal):
1. Open the booking calendar
2. Click on a date to book an appointment
3. **NEW**: You'll see a visual template selector with email account badges
4. Select a template - it automatically uses the linked email account
5. You can override the email account if needed
6. Book the appointment

### For Admins (Template Management):
1. Go to Templates page
2. When creating or editing a template, select which email account it should use:
   - **Primary** (Avensis Models)
   - **Secondary** (Camry Models)
3. Save the template

## Step 3: Template Examples

### Example 1: Avensis Booking Template
- **Name**: Avensis Booking Confirmation
- **Email Account**: Primary (avensismodels.co.uk.crm.bookings@gmail.com)
- **Use Case**: General bookings

### Example 2: Camry VIP Booking Template
- **Name**: Camry VIP Booking
- **Email Account**: Secondary (camrymodels.co.uk.crm.bookings@gmail.com)
- **Use Case**: Premium/VIP bookings

## Features

✅ **Visual Template Selector** - See which email account each template uses at a glance
✅ **Auto-Select Email** - Email account is automatically selected based on template
✅ **Manual Override** - Can still manually choose a different email account if needed
✅ **Color-Coded** - Blue for Avensis, Purple for Camry
✅ **Intuitive UI** - Simple dropdown with clear labeling

## Benefits

1. **Consistency** - Always send Avensis bookings from Avensis email
2. **Organization** - Keep different brands/campaigns separate
3. **Flexibility** - Override when needed for special cases
4. **Easy Setup** - Just select once per template
5. **Visual Clarity** - See which account at a glance

## Next Steps

After running the SQL migration:
1. The UI changes are already implemented
2. Go to your Templates page and set email accounts for existing templates
3. Create new templates and assign them to the appropriate email account
4. Start booking with the new integrated selector!
