# Dual Email Account Setup Guide

This CRM now supports multiple email accounts for both sending and receiving emails. This allows you to manage communications from different email addresses within the same system.

## Configuration

### 1. Environment Variables

Add your second email account credentials to the `.env` file:

```env
# Primary Email Account (Default)
EMAIL_USER=avensismodels.co.uk.crm.bookings@gmail.com
EMAIL_PASSWORD=gvfq hyue iyqg ryzj
GMAIL_USER=avensismodels.co.uk.crm.bookings@gmail.com
GMAIL_PASS=gvfq hyue iyqg ryzj

# Secondary Email Account (Account 2)
EMAIL_USER_2=your-second-email@gmail.com
EMAIL_PASSWORD_2=your-second-email-app-password
GMAIL_USER_2=your-second-email@gmail.com
GMAIL_PASS_2=your-second-email-app-password
```

**Important Notes:**
- Use **Gmail App Passwords**, not regular passwords
- To generate an App Password:
  1. Go to your Google Account settings
  2. Enable 2-Factor Authentication
  3. Go to Security > 2-Step Verification > App Passwords
  4. Generate a new app password for "Mail"
  5. Copy the 16-character password (without spaces)

### 2. Sending Emails with Different Accounts

Use the `sendEmail` function with the optional `accountKey` parameter:

#### Send from Primary Account (Default)
```javascript
const { sendEmail } = require('./server/utils/emailService');

await sendEmail(
  'recipient@example.com',
  'Subject Line',
  'Email body text',
  [], // attachments (optional)
  'primary' // account key (optional, defaults to 'primary')
);
```

#### Send from Secondary Account
```javascript
const { sendEmail } = require('./server/utils/emailService');

await sendEmail(
  'recipient@example.com',
  'Subject Line',
  'Email body text',
  [], // attachments (optional)
  'secondary' // account key
);
```

### 3. Email Polling (Receiving Emails)

To enable polling for both email accounts, update your server startup code:

#### Poll Only Primary Account (Current Default)
```javascript
const { startEmailPoller } = require('./server/utils/emailPoller');

// Start polling for primary account only
startEmailPoller(io);
// OR explicitly:
startEmailPoller(io, ['primary']);
```

#### Poll Both Accounts
```javascript
const { startEmailPoller } = require('./server/utils/emailPoller');

// Start polling for both accounts
startEmailPoller(io, ['primary', 'secondary']);
```

#### Poll Only Secondary Account
```javascript
const { startEmailPoller } = require('./server/utils/emailPoller');

// Start polling for secondary account only
startEmailPoller(io, ['secondary']);
```

## Example Use Cases

### Use Case 1: Different Departments
- Primary: `bookings@company.com` - For booking-related communications
- Secondary: `support@company.com` - For customer support communications

### Use Case 2: Different Regions
- Primary: `uk.office@company.com` - UK operations
- Secondary: `us.office@company.com` - US operations

### Use Case 3: Testing and Production
- Primary: `live@company.com` - Production emails
- Secondary: `test@company.com` - Testing environment

## Checking Account Status

The system will log which accounts are configured on startup:

```
📧 Email Service: Initializing...
📧 EMAIL_USER (Primary): ✅ Set
📧 EMAIL_USER_2 (Secondary): ✅ Set
```

For email polling:
```
📧 Starting email poller for Primary Account (email@example.com)...
📧 ✅ [Primary Account] Email poller started with 30-minute recurring backup scans
📧 Starting email poller for Secondary Account (second@example.com)...
📧 ✅ [Secondary Account] Email poller started with 30-minute recurring backup scans
```

## API Integration Examples

### Example 1: Send from specific account based on lead properties
```javascript
// In your sales route or service
const accountKey = lead.region === 'US' ? 'secondary' : 'primary';

await sendEmail(
  lead.email,
  'Your booking confirmation',
  emailBody,
  attachments,
  accountKey
);
```

### Example 2: Route selection based on user preference
```javascript
// Allow admins to choose which email to send from
router.post('/send-email', async (req, res) => {
  const { to, subject, body, accountKey = 'primary' } = req.body;

  const result = await sendEmail(to, subject, body, [], accountKey);

  res.json(result);
});
```

## Troubleshooting

### Account not sending emails
1. Verify credentials in `.env` file
2. Check for typos in email/password
3. Ensure you're using App Passwords, not regular passwords
4. Check Gmail account has IMAP/SMTP enabled

### Account not receiving emails
1. Verify the account is included in the `startEmailPoller` call
2. Check logs for connection errors
3. Ensure IMAP is enabled in Gmail settings
4. Check for "Too many simultaneous connections" errors (Gmail has limits)

### Invalid account key error
```
📧 Email account 'invalidkey' not configured
```
- Make sure you're using `'primary'` or `'secondary'` as the account key
- Check that the account credentials are set in the `.env` file

## Security Notes

1. **Never commit `.env` files** to version control
2. Use **App Passwords** instead of account passwords
3. Keep credentials secure and rotate them regularly
4. Consider using environment-specific configurations for production

## Next Steps

After setting up your second email account:

1. Add the credentials to your `.env` file
2. Test sending an email from both accounts
3. Update your `server.js` or startup file to poll both accounts if needed
4. Implement business logic to route emails to the appropriate account
5. Monitor logs to ensure both accounts are working correctly

---

**Need help?** Check the server logs for detailed error messages and connection status.
