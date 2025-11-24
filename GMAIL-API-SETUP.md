# Gmail API Email Poller Setup Guide

The email poller has been rebuilt to use **Gmail API** instead of IMAP for better reliability and full attachment support.

## 🎯 Benefits of Gmail API

- ✅ **Full Attachment Support**: Download all attachments with proper metadata
- ✅ **More Reliable**: Official Google API with better error handling
- ✅ **Better Performance**: Efficient message fetching and processing
- ✅ **Token Auto-Refresh**: OAuth tokens refresh automatically
- ✅ **No IMAP Limitations**: Bypass Gmail IMAP connection limits

## 📋 Prerequisites

You already have:
- ✅ Google OAuth credentials in `.env`:
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REDIRECT_URI`

## 🚀 Setup Steps

### Step 1: Run Database Migration

```bash
node server/migrations/add_gmail_api_support.js
```

This will create:
- `gmail_accounts` table for storing OAuth tokens
- `gmail_message_id` column in messages table
- `metadata` column for attachment information

### Step 2: Authenticate Your Gmail Accounts

For each Gmail account you want to use:

1. **Get the authentication URL**:
   ```bash
   curl http://localhost:5000/api/gmail/auth-url
   ```

   Or visit in your browser:
   ```
   http://localhost:5000/api/gmail/auth-url
   ```

2. **Authorize the account**:
   - Copy the URL from the response
   - Open it in your browser
   - Sign in with your Gmail account
   - Grant the requested permissions
   - You'll be redirected to a success page

3. **Repeat for secondary account** (if needed):
   - Do the same process for `camrymodels.co.uk.crm.bookings@gmail.com`

### Step 3: Restart the Server

```bash
npm start
```

The email poller will now use Gmail API instead of IMAP!

## 📊 What Changed

### Old (IMAP):
- Used ImapFlow library
- Limited attachment support
- Connection issues and timeouts
- Manual reconnection logic

### New (Gmail API):
- Uses official Google APIs
- **Full attachment download support**
- Better error handling
- Automatic token refresh
- More reliable polling

## 🔍 Monitoring

The poller logs will show:
```
📧 Gmail API poller initialized for Primary Account
✅ Gmail API connected: avensismodels.co.uk.crm.bookings@gmail.com
📧 Starting Gmail API polling (every 30s)...
📎 Downloaded attachment: invoice.pdf (12345 bytes)
```

## 📎 Attachment Handling

Attachments are now:
1. **Automatically detected** in all emails
2. **Downloaded** with full content
3. **Stored** in message metadata (currently logged, can be saved to storage)
4. **Tracked** with filename, MIME type, and size

To enable attachment storage to file system:
- Uncomment the storage logic in `emailPoller.js` line 732
- Configure your preferred storage location (local or cloud)

## 🔧 Configuration

You can adjust polling settings in `server/utils/emailPoller.js`:

```javascript
const POLL_INTERVAL_MS = 30000; // Poll every 30 seconds
const MAX_RESULTS_PER_POLL = 20; // Fetch up to 20 messages per poll
```

## 🐛 Troubleshooting

### "No OAuth tokens found in database"
- Run Step 2 to authenticate your Gmail accounts

### "Failed to initialize Gmail API"
- Check your Google OAuth credentials in `.env`
- Verify the redirect URI matches in Google Cloud Console

### Emails not appearing
- Check that emails are unread (poller only fetches unread messages)
- Check server logs for any error messages

## 🔐 Security Notes

- OAuth tokens are stored securely in Supabase
- Tokens auto-refresh when expired
- Only minimal required scopes are requested:
  - `gmail.readonly` - Read emails
  - `gmail.send` - Send emails (for replies)
  - `userinfo.email` - Identify the account

## 📝 Database Schema

### gmail_accounts
```sql
CREATE TABLE gmail_accounts (
  id UUID PRIMARY KEY,
  crm_user_id UUID REFERENCES users(id),
  email TEXT UNIQUE NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  scope TEXT,
  token_type TEXT,
  expiry_date BIGINT,
  raw_tokens JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

### messages (updated)
```sql
ALTER TABLE messages
  ADD COLUMN gmail_message_id TEXT,
  ADD COLUMN metadata JSONB;
```

## 🎉 You're All Set!

Once authenticated, the Gmail API poller will:
- ✅ Poll for new emails every 30 seconds
- ✅ Download all attachments automatically
- ✅ Process messages for matching leads
- ✅ Emit real-time socket events
- ✅ Mark messages as read after processing
