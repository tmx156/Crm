# Railway SMTP Settings Guide

## 🚂 **Railway Dashboard Settings**

### **1. Network Policies (Most Important)**

In your Railway dashboard, go to **Settings → Networking**:

#### **Outbound Connections:**
- ✅ **Allow SMTP (Port 465)** - Gmail SSL
- ✅ **Allow SMTP (Port 587)** - Gmail STARTTLS  
- ✅ **Allow IMAP (Port 993)** - Email polling
- ✅ **Allow HTTPS (Port 443)** - Supabase connections

#### **Firewall Rules:**
```
Allow: smtp.gmail.com:465
Allow: smtp.gmail.com:587
Allow: imap.gmail.com:993
Allow: tnltvfzltdeilanxhlvy.supabase.co:443
```

### **2. Environment Variables**

In **Settings → Variables**, ensure these are set:

```env
# Email Configuration
EMAIL_USER=avensismodels.co.uk.crm.bookings@gmail.com
EMAIL_PASSWORD=your_16_character_app_password
GMAIL_USER=avensismodels.co.uk.crm.bookings@gmail.com
GMAIL_PASS=your_16_character_app_password

# Supabase Configuration
SUPABASE_URL=https://tnltvfzltdeilanxhlvy.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# General
NODE_ENV=production
JWT_SECRET=your_jwt_secret
```

### **3. Railway Plan Requirements**

#### **Minimum Plan:**
- ✅ **Railway Pro** ($5/month) - Required for SMTP outbound connections
- ❌ **Railway Hobby** - SMTP connections are blocked

#### **Why Pro Plan is Required:**
- Hobby plan blocks outbound SMTP connections
- Pro plan allows all outbound connections
- Required for Gmail SMTP (ports 465, 587)

### **4. Railway CLI Commands**

#### **Check Network Policies:**
```bash
railway status
railway logs --follow
```

#### **Test SMTP Connection:**
```bash
railway run node -e "
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransporter({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});
transporter.verify().then(console.log).catch(console.error);
"
```

## 🔧 **Railway Configuration File**

I've updated your `railway.json` with SMTP-optimized settings:

```json
{
  "networking": {
    "outboundConnections": {
      "allowed": [
        {
          "host": "smtp.gmail.com",
          "ports": [465, 587]
        },
        {
          "host": "imap.gmail.com", 
          "ports": [993]
        },
        {
          "host": "tnltvfzltdeilanxhlvy.supabase.co",
          "ports": [443]
        }
      ]
    }
  },
  "environment": {
    "NODE_ENV": "production",
    "NODE_OPTIONS": "--max-old-space-size=1024"
  }
}
```

## 🚨 **Common Railway SMTP Issues**

### **1. "ETIMEDOUT" Errors**
**Cause:** Railway blocking SMTP connections
**Solution:** 
- Upgrade to Railway Pro plan
- Check network policies in dashboard
- Verify outbound connections are allowed

### **2. "ECONNREFUSED" Errors**
**Cause:** Port blocking
**Solution:**
- Ensure ports 465 and 587 are allowed
- Check firewall rules
- Try both SSL (465) and STARTTLS (587)

### **3. "EAUTH" Errors**
**Cause:** Authentication issues
**Solution:**
- Use Gmail App Password (not regular password)
- Enable 2-Factor Authentication on Gmail
- Verify EMAIL_USER and EMAIL_PASSWORD are set

### **4. "ENOTFOUND" Errors**
**Cause:** DNS resolution issues
**Solution:**
- Check Railway's DNS settings
- Verify hostnames are correct
- Try different DNS servers

## 📊 **Railway Dashboard Checklist**

### **Settings → Networking:**
- [ ] Outbound connections enabled
- [ ] SMTP ports (465, 587) allowed
- [ ] IMAP port (993) allowed
- [ ] HTTPS port (443) allowed

### **Settings → Variables:**
- [ ] EMAIL_USER set
- [ ] EMAIL_PASSWORD set (App Password)
- [ ] SUPABASE_SERVICE_ROLE_KEY set
- [ ] NODE_ENV=production

### **Settings → Plan:**
- [ ] Railway Pro plan or higher
- [ ] Sufficient resources allocated

## 🧪 **Testing SMTP on Railway**

### **1. Check Environment Variables:**
```bash
railway run env | grep EMAIL
```

### **2. Test SMTP Connection:**
```bash
railway run node server/routes/email-test.js
```

### **3. Monitor Logs:**
```bash
railway logs --follow | grep "📧"
```

### **4. Test Email Sending:**
Visit: `https://your-app.railway.app/api/email-test/config`

## ✅ **Success Indicators**

You'll know SMTP is working when you see:
- `✅ Email transporter ready` in logs
- `✅ Email sent successfully` in logs
- No `ETIMEDOUT` or `ECONNREFUSED` errors
- Emails actually delivered to recipients

## 🆘 **Still Having Issues?**

### **Contact Railway Support:**
1. Go to Railway dashboard
2. Click "Support" 
3. Report SMTP connectivity issues
4. Include your project URL and error logs

### **Alternative Solutions:**
1. **Use Resend API** instead of SMTP
2. **Use SendGrid** instead of Gmail SMTP
3. **Use Mailgun** for better Railway compatibility

---

**The key is upgrading to Railway Pro and configuring the network policies correctly!** 🚀
