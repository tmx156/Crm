# Railway Network Policy Setup Guide

## 🚂 **Method 1: Railway Dashboard**

### **Step-by-Step Instructions:**

1. **Go to Railway Dashboard**
   - Visit: https://railway.app
   - Sign in to your account
   - Select your CRM project

2. **Navigate to Service Settings**
   - Click on your service (the one running your CRM)
   - Click the **Settings** tab
   - Look for **Networking** or **Network Policies**

3. **Configure Outbound Connections**
   ```
   Outbound Connections:
   ☐ Allow all outbound connections (RECOMMENDED for Pro plan)
   
   OR configure specific connections:
   ☐ Configure specific connections
   
   If choosing specific connections, add these rules:
   - Host: smtp.gmail.com, Ports: 465, 587
   - Host: imap.gmail.com, Port: 993
   - Host: tnltvfzltdeilanxhlvy.supabase.co, Port: 443
   ```

4. **Save Changes**
   - Click **Save** or **Apply**
   - Wait for the service to restart

## 🔧 **Method 2: Railway CLI**

### **Install Railway CLI:**
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login
```

### **Configure Network Policies:**
```bash
# Link to your project
railway link

# Check current network settings
railway status

# Set environment variables
railway variables set EMAIL_USER=avensismodels.co.uk.crm.bookings@gmail.com
railway variables set EMAIL_PASSWORD=your_16_character_app_password

# Deploy with network policies
railway up
```

## 🚨 **Method 3: Railway Configuration File**

I've already updated your `railway.json` file with the correct network policies:

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
  }
}
```

This configuration will be applied automatically when you deploy.

## 📋 **Step-by-Step Dashboard Instructions**

### **If you can't find Networking settings:**

1. **Check your Railway Plan**
   - Go to **Settings → Billing**
   - Ensure you're on **Railway Pro** ($5/month)
   - Hobby plan doesn't have network policy controls

2. **Look for these sections:**
   - **Settings → Networking**
   - **Settings → Security**
   - **Settings → Advanced**
   - **Service → Settings → Networking**

3. **Alternative locations:**
   - **Project Settings → Networking**
   - **Service Settings → Network Policies**
   - **Environment → Network Configuration**

## 🧪 **Test Network Configuration**

### **After configuring, test with:**

```bash
# Test SMTP connection
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
transporter.verify()
  .then(() => console.log('✅ SMTP connection successful'))
  .catch(err => console.error('❌ SMTP connection failed:', err.message));
"
```

### **Check logs for network errors:**
```bash
railway logs --follow | grep -E "(ETIMEDOUT|ECONNREFUSED|ENOTFOUND)"
```

## 🚨 **Troubleshooting**

### **If you can't find Networking settings:**

1. **Upgrade to Railway Pro**
   - Hobby plan doesn't have network controls
   - Pro plan ($5/month) required for SMTP

2. **Check Railway Documentation**
   - Visit: https://docs.railway.app/reference/networking
   - Look for "Outbound Connections" section

3. **Contact Railway Support**
   - Go to Railway dashboard
   - Click "Support" or "Help"
   - Ask about network policy configuration

### **Common Issues:**

- **"Networking section not found"** → Upgrade to Pro plan
- **"No outbound connections option"** → Check service settings
- **"Settings not saving"** → Try Railway CLI method

## ✅ **Success Indicators**

You'll know it's working when:
- No `ETIMEDOUT` errors in logs
- SMTP connection test passes
- Emails are sent successfully
- Network policies show as "Active"

---

**The easiest method is upgrading to Railway Pro and selecting "Allow all outbound connections" in the dashboard!** 🚀
