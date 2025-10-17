# 🚫 Email Sending Temporarily Disabled

## Current Status

✅ **Email Sending**: **DISABLED** (Kill switch active)
✅ **Email Receiving**: **ACTIVE** (Email poller still working)

---

## What's Happening

- 📧 **Incoming emails** are still being received and processed normally
- 🚫 **Outgoing emails** are blocked - nothing will be sent
- ✅ The system pretends to send successfully (returns success)
- 📝 All email attempts are logged but not actually sent

---

## How to Re-Enable Email Sending

When you're ready to start sending emails again:

### Option 1: Edit the File (Recommended)

1. Open `server/utils/emailService.js`
2. Find line 6:
   ```javascript
   const EMAIL_SENDING_DISABLED = true; // Set to false to re-enable email sending
   ```
3. Change to:
   ```javascript
   const EMAIL_SENDING_DISABLED = false; // Set to false to re-enable email sending
   ```
4. Save the file
5. Restart your server
6. Done! Emails will send normally

### Option 2: Use Environment Variable (Advanced)

Add to your `.env` file:
```env
EMAIL_SENDING_ENABLED=false  # Keep disabled
# or
EMAIL_SENDING_ENABLED=true   # Re-enable
```

Then update the code to read from env (future enhancement).

---

## What You'll See in Logs

### When Email Sending is Disabled:
```
🚫 EMAIL SENDING DISABLED (Temporary kill switch active)
📧 Email poller will still receive emails normally
...
🚫 [abc123] EMAIL SENDING DISABLED - Email NOT sent (kill switch active)
📧 [abc123] Would have sent to: customer@example.com
📧 [abc123] Subject: Booking Confirmation
```

### When Email Sending is Re-Enabled:
```
📧 Email Service: Initializing...
📧 EMAIL_USER (Primary): ✅ Set
📧 EMAIL_USER_2 (Secondary): ✅ Set
...
✅ [abc123] Email sent successfully via SSL (465) - ID: <message-id>
```

---

## Important Notes

✅ **Email Poller is NOT affected** - You'll still receive emails
✅ **Database is NOT affected** - Messages are still logged
✅ **UI is NOT affected** - Everything looks normal
✅ **Returns success** - App thinks emails sent successfully
✅ **Safe to use** - No errors, no crashes

⚠️ **Customers won't receive** - Booking confirmations, receipts, etc.
⚠️ **Check logs** - All "sends" are logged with 🚫 marker

---

## Testing

To verify it's working:

```bash
# Start your server
cd server
npm start

# You should see:
# 🚫 EMAIL SENDING DISABLED (Temporary kill switch active)
# 📧 Email poller will still receive emails normally

# Try to book an appointment
# You'll see in logs:
# 🚫 [emailId] EMAIL SENDING DISABLED - Email NOT sent (kill switch active)
```

---

## Quick Reference

| Feature | Status |
|---------|--------|
| Send Emails | 🚫 DISABLED |
| Receive Emails | ✅ ACTIVE |
| Email Poller | ✅ ACTIVE |
| Database Logging | ✅ ACTIVE |
| UI Functionality | ✅ ACTIVE |

---

**Current File**: `server/utils/emailService.js:6`
**Kill Switch**: `EMAIL_SENDING_DISABLED = true`
**To Enable**: Change to `false` and restart server
