# Supabase Service Role Key Setup Guide

## 🔑 Getting Your Supabase Service Role Key

1. **Go to your Supabase Dashboard**:
   - Visit: https://supabase.com/dashboard
   - Select your project: `tnltvfzltdeilanxhlvy`

2. **Navigate to Settings**:
   - Click on "Settings" in the left sidebar
   - Go to "API" section

3. **Copy the Service Role Key**:
   - Look for "service_role" key (not the anon key)
   - Copy the long JWT token

4. **Set Environment Variable**:
   Add this to your environment variables:
   ```
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
   ```

## 🚨 Important Security Notes

- **NEVER** commit the service role key to version control
- **NEVER** use the service role key in client-side code
- **ONLY** use it in secure server-side environments
- The service role key bypasses all RLS policies

## 🔧 Alternative Solutions

### Option 1: Disable RLS for booker_activity_log table
```sql
-- Run this in Supabase SQL Editor
ALTER TABLE booker_activity_log DISABLE ROW LEVEL SECURITY;
```

### Option 2: Create proper RLS policy
```sql
-- Run this in Supabase SQL Editor
CREATE POLICY "Allow authenticated users to insert booker activity" 
ON booker_activity_log 
FOR INSERT 
TO authenticated 
WITH CHECK (true);
```

### Option 3: Use a different approach
Modify the code to not require service role permissions.

## 🎯 Recommended Action

Set the `SUPABASE_SERVICE_ROLE_KEY` environment variable with your actual service role key from Supabase dashboard.
