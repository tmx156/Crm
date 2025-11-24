# Railway Automatic Deployment Setup

This guide will help you set up automatic deployments to Railway whenever you push to GitHub.

## Option 1: GitHub Integration (Recommended - Easiest)

This is the simplest method and doesn't require GitHub Actions.

### Steps:

1. **Go to Railway Dashboard**
   - Visit: https://railway.app/dashboard
   - Login to your account

2. **Select Your Project**
   - Click on your CRM project

3. **Connect GitHub Repository**
   - Click on your service (deployment)
   - Go to **Settings** tab
   - Under **Source**, click **Connect GitHub Repo**
   - Select repository: `tmx156/Crm`
   - Select branch: `main`
   - Click **Connect**

4. **Configure Deploy Settings**
   - In Settings, scroll to **Deploy**
   - Enable: **Automatic Deployments**
   - Set **Root Directory**: `/` (leave as root)
   - Set **Build Command**: (Railway will use Dockerfile automatically)

5. **Test the Setup**
   - Make a small change to your repository
   - Push to GitHub
   - Watch your Railway dashboard - it should automatically start deploying!

### ✅ After Setup:
Every push to the `main` branch will automatically trigger a Railway deployment.

---

## Option 2: GitHub Actions with Railway CLI

If you prefer to use GitHub Actions (already configured in `.github/workflows/railway-deploy.yml`):

### Steps:

1. **Get Railway Token**
   ```bash
   # In your terminal, login to Railway
   railway login
   
   # Generate a token
   railway tokens create
   ```
   Copy the generated token.

2. **Get Railway Service ID**
   ```bash
   # Link your project
   railway link
   
   # Get service ID
   railway status
   ```
   Copy the Service ID from the output.

3. **Add Secrets to GitHub**
   - Go to: https://github.com/tmx156/Crm/settings/secrets/actions
   - Click **New repository secret**
   - Add two secrets:
     - `RAILWAY_TOKEN`: Paste the token from step 1
     - `RAILWAY_SERVICE_ID`: Paste the service ID from step 2

4. **Enable GitHub Actions**
   - Go to: https://github.com/tmx156/Crm/actions
   - Enable workflows if disabled

### ✅ After Setup:
Every push to `main` will trigger the GitHub Action, which will deploy to Railway.

---

## Option 3: Railway CLI Manual Deploy

For immediate deployment without waiting for auto-deploy setup:

### Steps:

1. **Login to Railway**
   ```bash
   railway login
   ```
   This will open a browser window for authentication.

2. **Link Your Project**
   ```bash
   railway link
   ```
   Select your CRM project from the list.

3. **Deploy**
   ```bash
   railway up
   ```
   This will immediately deploy your current code.

### For Future Deploys:
Just run `railway up` after pushing to GitHub.

---

## Troubleshooting

### Railway Not Deploying Automatically?

1. **Check GitHub Integration**
   - Go to Railway Dashboard → Your Project → Settings
   - Verify GitHub repo is connected
   - Verify "Automatic Deployments" is enabled

2. **Check Recent Pushes**
   - Go to your Railway dashboard
   - Click on "Deployments" tab
   - Look for recent deployment attempts
   - Check logs for any errors

3. **Check Build Logs**
   - In Railway dashboard, click on a deployment
   - View the build logs to see what went wrong

4. **Verify Dockerfile**
   - Railway uses your `Dockerfile` for builds
   - Make sure it's in the root directory
   - Check that all paths in Dockerfile are correct

### Common Issues:

- **"Source not connected"**: Follow Option 1 to connect GitHub repo
- **"Build failed"**: Check Railway build logs for specific errors
- **"Unauthorized"**: Generate a new Railway token (Option 2, step 1)

---

## Current Status

✅ GitHub repository: Connected (`tmx156/Crm`)
✅ Latest commit pushed: "Update CRM: Add slot-based calendar system, remove legacy pages, and enhance lead management"
✅ Dockerfile: Present and configured
✅ railway.json: Present with correct configuration
✅ GitHub Actions workflow: Created (`.github/workflows/railway-deploy.yml`)

## Next Action Required

**→ Choose Option 1 (Recommended)**
- Takes 2 minutes
- No CLI needed
- Most reliable
- Go to Railway Dashboard and connect your GitHub repo

**→ Or Choose Option 3 for Immediate Deploy**
- Run `railway login` in terminal (interactive)
- Run `railway link` and select your project
- Run `railway up` to deploy now

---

## Need Help?

If you encounter any issues:
1. Check Railway dashboard for error messages
2. Review deployment logs
3. Verify all environment variables are set in Railway
4. Ensure Dockerfile builds successfully locally

Railway Support: https://railway.app/help

