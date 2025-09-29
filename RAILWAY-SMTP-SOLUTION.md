# Railway SMTP Solution Guide

## 🚨 **The Problem (From Railway Docs)**

According to [Railway's documentation](https://docs.railway.com/reference/outbound-networking#email-delivery):

> **"SMTP is only available on the Pro plan and above. Free, Trial, and Hobby plans must use transactional email services with HTTPS APIs. SMTP is disabled on these plans to prevent spam and abuse."**

**Your current Railway plan blocks SMTP connections entirely.**

## ✅ **Solution Options**

### **Option 1: Upgrade to Railway Pro (Recommended)**

1. **Go to Railway Dashboard**
2. **Settings → Billing**
3. **Upgrade to Pro plan** ($5/month)
4. **Redeploy your service** (crucial step!)

The docs state: *"Upon upgrading to Pro, please re-deploy your service that needs to use SMTP for the changes to take effect."*

### **Option 2: Use Resend API (Railway's Recommendation)**

Railway recommends using HTTPS-based email services instead of SMTP:

- **Resend** (Railway's recommended approach)
- **SendGrid**
- **Mailgun** 
- **Postmark**

## 🔧 **Implementation: Resend Integration**

I've created a Resend email service that works on all Railway plans:

### **Step 1: Get Resend API Key**
1. Sign up at [resend.com](https://resend.com)
2. Get your API key from the dashboard
3. Add it to Railway environment variables

### **Step 2: Set Environment Variables**
In Railway Dashboard → Variables:

```env
# Remove or comment out SMTP variables
# EMAIL_USER=avensismodels.co.uk.crm.bookings@gmail.com
# EMAIL_PASSWORD=gvfq hyue iyqg ryzj

# Add Resend variables
RESEND_API_KEY=re_xxxxxxxxx
RESEND_FROM_EMAIL=noreply@avensismodels.co.uk
```

### **Step 3: Deploy Updated Code**
The system will automatically use Resend when `RESEND_API_KEY` is set.

## 🧪 **Testing the Fix**

### **Test Resend Configuration:**
```bash
# Check if Resend is configured
railway run curl -X GET https://crm-production-1973.up.railway.app/api/email-test/config
```

### **Test Email Sending:**
```bash
# Send test email via Resend
railway run curl -X POST https://crm-production-1973.up.railway.app/api/email-test/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "to": "test@example.com",
    "subject": "Test Email via Resend",
    "body": "This email is sent via Resend API (Railway recommended)."
  }'
```

## 📊 **What You'll See in Logs**

### **With Resend:**
```
📧 Email Service: Initializing...
📧 EMAIL_USER: ❌ NOT SET
📧 RESEND_API_KEY: ✅ Set
📧 [abc123] Using Resend API (Railway recommended)
✅ [abc123] Email sent successfully via Resend - ID: re_xyz789
```

### **With Railway Pro + SMTP:**
```
📧 Email Service: Initializing...
📧 EMAIL_USER: ✅ Set
📧 RESEND_API_KEY: ❌ NOT SET
📧 [abc123] Trying SSL (465) configuration...
✅ [abc123] Email sent successfully via SSL (465) - ID: <message-id>
```

## 🚨 **Railway Plan Comparison**

| Plan | SMTP Support | Resend Support | Cost |
|------|-------------|----------------|------|
| **Hobby** | ❌ Blocked | ✅ Works | Free |
| **Pro** | ✅ Works | ✅ Works | $5/month |
| **Team** | ✅ Works | ✅ Works | $20/month |

## 🎯 **Recommendation**

### **For Production Use:**
**Upgrade to Railway Pro** - SMTP is more reliable and you get:
- Full SMTP support
- Better performance
- Priority support
- More resources

### **For Development/Testing:**
**Use Resend API** - Works on all plans and provides:
- Better analytics
- Delivery tracking
- Modern API
- Railway recommended

## 🔄 **Migration Steps**

### **To Railway Pro:**
1. Upgrade to Pro plan
2. Redeploy service
3. Test SMTP connection
4. Verify email sending

### **To Resend:**
1. Sign up for Resend
2. Get API key
3. Set `RESEND_API_KEY` in Railway
4. Remove `EMAIL_USER` and `EMAIL_PASSWORD`
5. Redeploy service
6. Test email sending

## ✅ **Success Indicators**

You'll know it's working when you see:
- `✅ Email sent successfully` in logs
- No `ETIMEDOUT` or `ECONNREFUSED` errors
- Emails actually delivered to recipients
- Email test endpoint returns success

---

**The key is either upgrading to Railway Pro OR using Resend API - both will solve your SMTP issues!** 🚀
