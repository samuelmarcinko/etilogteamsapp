# Setup Guide

Complete setup instructions for the Teams Approval App.

## Table of Contents

1. [Azure Bot Registration](#azure-bot-registration)
2. [Azure AD App Registration](#azure-ad-app-registration)
3. [Database Setup](#database-setup)
4. [Server Configuration](#server-configuration)
5. [Teams App Installation](#teams-app-installation)

## Azure Bot Registration

### Step 1: Create Azure Bot

1. Go to [Azure Portal](https://portal.azure.com)
2. Search for "Azure Bot" and click "Create"
3. Fill in the details:
   - **Bot handle**: Choose a unique name (e.g., `approval-bot`)
   - **Subscription**: Select your subscription
   - **Resource group**: Create new or use existing
   - **Pricing tier**: F0 (Free) or S1 (Standard)
   - **Microsoft App ID**: Create new

4. Click "Review + Create" then "Create"

### Step 2: Configure Bot

1. After creation, go to your bot resource
2. Navigate to **Configuration**
3. Set **Messaging endpoint**: `https://your-server.com/api/messages`
4. Enable **Microsoft Teams** channel
5. Save the configuration

### Step 3: Get Credentials

1. Go to **Configuration** > **Manage**
2. Copy the **App ID** (this is your MICROSOFT_APP_ID)
3. Click "New client secret"
4. Copy the **Value** (this is your MICROSOFT_APP_PASSWORD)
5. **Important**: Save these credentials securely!

## Azure AD App Registration

### Step 1: Register Application

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** > **App registrations**
3. Click "New registration"
4. Fill in details:
   - **Name**: Teams Approval App
   - **Supported account types**: Single tenant
   - **Redirect URI**: Not needed for now

### Step 2: Configure API Permissions

1. Go to **API permissions**
2. Click "Add a permission"
3. Select **Microsoft Graph**
4. Add these permissions:
   - `User.Read` (Delegated)
   - `User.ReadBasic.All` (Delegated)
   - `TeamMember.Read.All` (Application) - optional
5. Click "Grant admin consent"

### Step 3: Configure Authentication

1. Go to **Authentication**
2. Under "Implicit grant and hybrid flows":
   - Enable "ID tokens"
   - Enable "Access tokens"
3. Save

### Step 4: Create Client Secret

1. Go to **Certificates & secrets**
2. Click "New client secret"
3. Add description and expiry
4. Copy the **Value** (this is your CLIENT_SECRET)

### Step 5: Get IDs

1. Go to **Overview**
2. Copy **Application (client) ID** (this is your CLIENT_ID)
3. Copy **Directory (tenant) ID** (this is your TENANT_ID)

## Database Setup

### Step 1: Install PostgreSQL

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
```

#### macOS
```bash
brew install postgresql
brew services start postgresql
```

#### Windows
Download from [PostgreSQL.org](https://www.postgresql.org/download/windows/)

### Step 2: Create Database

```bash
# Connect to PostgreSQL
sudo -u postgres psql

# Create database
CREATE DATABASE teams_approval;

# Create user (optional)
CREATE USER approval_user WITH ENCRYPTED PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE teams_approval TO approval_user;

# Exit
\q
```

### Step 3: Configure Connection

Update `.env` file:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=teams_approval
DB_USER=postgres
DB_PASSWORD=your_password
```

### Step 4: Run Migrations

```bash
npm run migrate
```

## Server Configuration

### Step 1: SSL Certificate

For production, you need HTTPS. Options:

#### Option A: Let's Encrypt (Recommended)
```bash
sudo apt install certbot
sudo certbot certonly --standalone -d your-server.com
```

#### Option B: Nginx Reverse Proxy
```bash
sudo apt install nginx
# Configure nginx as reverse proxy with SSL
```

### Step 2: Configure Firewall

```bash
# Allow HTTPS
sudo ufw allow 443/tcp

# Allow HTTP (for redirect)
sudo ufw allow 80/tcp

# Allow SSH
sudo ufw allow 22/tcp

# Enable firewall
sudo ufw enable
```

### Step 3: Set Up Environment

Create `.env` file with all required variables:

```env
# Server
PORT=3978
NODE_ENV=production

# Microsoft Bot
MICROSOFT_APP_ID=your-app-id-from-azure
MICROSOFT_APP_PASSWORD=your-app-password-from-azure
BOT_ID=your-bot-id

# Azure AD
TENANT_ID=your-tenant-id
CLIENT_ID=your-client-id
CLIENT_SECRET=your-client-secret

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=teams_approval
DB_USER=postgres
DB_PASSWORD=your-db-password

# App URLs
APP_BASE_URL=https://your-server.com
```

### Step 4: Install Dependencies

```bash
npm install --production
```

### Step 5: Start Service

#### Using PM2 (Recommended)
```bash
npm install -g pm2
pm2 start src/index.js --name teams-approval-app
pm2 save
pm2 startup
```

#### Using systemd
Create `/etc/systemd/system/teams-approval.service`:
```ini
[Unit]
Description=Teams Approval App
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/etilogteamsapp
ExecStart=/usr/bin/node src/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable teams-approval
sudo systemctl start teams-approval
```

## Teams App Installation

### Step 1: Prepare Icons

Create two PNG icons:
- `color.png` - 192x192px, full color
- `outline.png` - 32x32px, transparent background

Place them in `teams-manifest/` directory.

### Step 2: Generate Manifest

```bash
node scripts/prepare-manifest.js
```

This creates `manifest.generated.json` with your settings.

### Step 3: Create App Package

```bash
cd teams-manifest
zip approval-app.zip manifest.generated.json color.png outline.png
```

### Step 4: Upload to Teams

1. Go to [Teams Admin Center](https://admin.teams.microsoft.com)
2. Navigate to **Teams apps** > **Manage apps**
3. Click **Upload new app**
4. Select `approval-app.zip`
5. Review and approve the app

### Step 5: Configure Permissions

1. In Teams Admin Center, find your app
2. Click on the app name
3. Go to **Permissions**
4. Grant required permissions:
   - Send messages
   - Read user profiles

### Step 6: Make Available to Users

1. Go to **Setup policies**
2. Edit the global policy or create a new one
3. Add your app to installed apps
4. Assign policy to users

## Verification

### Test Bot Endpoint

```bash
curl https://your-server.com/api/health
```

Expected response:
```json
{
  "status": "OK",
  "timestamp": "2024-01-08T...",
  "service": "Teams Approval App"
}
```

### Test in Teams

1. Open Microsoft Teams
2. Click "Apps" in left sidebar
3. Search for "Approval Bot"
4. Click "Add"
5. Send message "hello"

Bot should respond with welcome message.

### Test API

```bash
# Get auth token first (use your actual token)
TOKEN="your-azure-ad-token"

# Create test ticket
curl -X POST https://your-server.com/api/tickets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Ticket",
    "description": "This is a test",
    "ticketType": "HR",
    "priority": "Medium"
  }'
```

## Troubleshooting Setup

### Bot Not Reachable

1. Check DNS: `nslookup your-server.com`
2. Check port: `telnet your-server.com 443`
3. Verify SSL: `curl -I https://your-server.com`
4. Check firewall: `sudo ufw status`

### Database Connection Failed

```bash
# Test PostgreSQL connection
psql -h localhost -U postgres -d teams_approval -c "SELECT 1;"

# Check PostgreSQL is running
sudo systemctl status postgresql
```

### Authentication Errors

1. Verify Azure AD app registration
2. Check client secret hasn't expired
3. Ensure redirect URIs are correct
4. Verify tenant ID matches

## Next Steps

- Configure user roles in Azure AD
- Set up monitoring and logging
- Create backup strategy for database
- Test approval workflow end-to-end
- Review security settings

See [DEPLOYMENT.md](./DEPLOYMENT.md) for production deployment best practices.
