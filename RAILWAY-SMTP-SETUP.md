# Railway SMTP Configuration Guide

## 🚀 SMTP Setup for Railway Deployment

This guide helps you configure Gmail SMTP to work properly on Railway deployment.

## 📋 Prerequisites

1. **Railway Pro Plan or Higher**: SMTP outbound connections are only available on paid plans
2. **Gmail App Password**: Required for secure SMTP authentication
3. **Verified Domain**: Optional but recommended for better deliverability

## 🔧 Gmail App Password Setup

1. **Enable 2-Factor Authentication** on your Gmail account
2. **Generate App Password**:
   - Go to Google Account settings
   - Security → 2-Step Verification → App passwords
   - Generate password for "Mail"
   - Copy the 16-character password (e.g., `abcd efgh ijkl mnop`)

## 🚂 Railway Environment Variables

Set these environment variables in your Railway dashboard:

```env
# Gmail SMTP Configuration
EMAIL_USER=avensismodels.co.uk.crm.bookings@gmail.com
EMAIL_PASSWORD=your_16_character_app_password

# Alternative variable names (for backward compatibility)
GMAIL_USER=avensismodels.co.uk.crm.bookings@gmail.com
GMAIL_PASS=your_16_character_app_password

# Railway-specific settings
NODE_ENV=production
```

## ⚙️ SMTP Configuration Details

The email service is now optimized for Railway with these settings:

- **Host**: `smtp.gmail.com`
- **Port**: `587` (STARTTLS)
- **Security**: TLS encryption
- **Connection Timeout**: 30 seconds
- **Retry Logic**: 5 attempts with Railway-optimized backoff
- **Rate Limiting**: 1 message per second

## 🔍 Troubleshooting

### Common Issues:

1. **ETIMEDOUT Errors**:
   - Ensure you're on Railway Pro plan or higher
   - Check Gmail App Password is correct
   - Verify environment variables are set

2. **Authentication Errors**:
   - Use App Password, not regular Gmail password
   - Ensure 2FA is enabled on Gmail account
   - Check EMAIL_USER matches your Gmail address exactly

3. **Connection Refused**:
   - Railway may be blocking port 587
   - Try port 465 with SSL instead
   - Contact Railway support if issues persist

### Debug Steps:

1. **Check Railway Logs**:
   ```bash
   railway logs
   ```

2. **Verify Environment Variables**:
   ```bash
   railway variables
   ```

3. **Test Email Sending**:
   - Trigger a booking confirmation
   - Monitor logs for email service messages
   - Check for success/failure indicators

## 📊 Monitoring

The service provides detailed logging:

- `📧 Attempt X/5 - Sending email via Railway SMTP...`
- `✅ Email sent successfully - ID: <message-id>`
- `⚠️ Attempt X failed: <error> (Code: <code>)`
- `📧 Railway network issue detected - will retry`

## 🚀 Deployment

1. **Set Environment Variables** in Railway dashboard
2. **Deploy** your application
3. **Test** email functionality
4. **Monitor** logs for any issues

## 📝 Notes

- The service automatically detects Railway environment
- Retry logic is optimized for Railway's network conditions
- Connection pooling is disabled for Railway compatibility
- Rate limiting prevents overwhelming Gmail's servers

## 🔄 Fallback Options

If SMTP continues to fail on Railway:

1. **Upgrade Railway Plan**: Ensure you're on Pro or higher
2. **Contact Railway Support**: Report SMTP connectivity issues
3. **Alternative Ports**: Try port 465 with SSL
4. **Different SMTP Provider**: Consider SendGrid, Mailgun, or similar

## ✅ Success Indicators

You'll know it's working when you see:
- `✅ Email sent successfully` in logs
- Emails are delivered to recipients
- No `ETIMEDOUT` or connection errors
- Booking confirmations are sent automatically
