# Deployment Guide

> **How production is deployed today (Infomaniak VPS, Docker + Traefik)**
>
> The rest of this file describes an older Hetzner + Nginx + PM2 setup and is
> kept for reference. Production runs in Docker at `/srv/stacks/apps/teams-app`,
> and a release is three commands:
>
> ```bash
> cd /srv/stacks/apps/teams-app
> git pull origin <branch>
> docker compose -f docker-compose.infomaniak.yml build teams-app
> docker compose -f docker-compose.infomaniak.yml up -d teams-app
> ```
>
> **Always pass `-f docker-compose.infomaniak.yml`.** The bare
> `docker-compose.yml` in the same directory carries no Traefik labels: running
> `docker compose up -d teams-app` without `-f` recreates the container without
> them, Traefik then has no router for `portal.etilog.com`, and the site answers
> 404 while the container itself looks perfectly healthy. It also drops the
> container off the `teams-app-internal` network, so the app cannot resolve
> `teams-app-db` and the log fills with `getaddrinfo ENOTFOUND teams-app-db`.
> Both happened on 2026-09-03 and cost about half an hour.
>
> The source directory is **not** mounted into the container - the code is baked
> into the image - so `git pull` alone changes nothing that is running. Skipping
> the `build` step leaves the previous code in place while every other sign says
> the deployment worked. Verify a release by looking for the new code inside the
> container, not by checking that the site loads:
>
> ```bash
> docker exec teams-app grep -c "<something new>" /app/src/<changed file>
> curl -s -o /dev/null -w '%{http_code}\n' https://portal.etilog.com/portal/
> ```
>
> The database container is defined in the same file but does not need
> recreating; naming the `teams-app` service keeps it out of the way.
>
> Migrations run themselves when the app starts, so a release that carries one
> needs no extra step - only a check that it landed. The database user is
> **`approval_user`**, not `postgres`; `postgres` does not exist in that
> container and asking for it answers `FATAL: role "postgres" does not exist`,
> which reads like a broken database rather than a wrong username:
>
> ```bash
> docker exec teams-app-db psql -U approval_user -d teams_approval \
>   -c "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 5"
> ```

## Overview

This guide covers deploying the Teams Approval App to a production environment on Hetzner VPS with:
- Ubuntu Server 22.04 LTS
- PostgreSQL database
- Nginx reverse proxy
- SSL with Let's Encrypt
- PM2 process manager

## Prerequisites

- Hetzner VPS or similar (minimum: 2 vCPU, 4GB RAM)
- Domain name pointing to your VPS IP
- SSH access to server
- Azure Bot and AD app already registered

## Server Setup

### 1. Initial Server Configuration

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install essential tools
sudo apt install -y curl wget git build-essential

# Set up firewall
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### 2. Install Node.js

```bash
# Install Node.js 18 LTS
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version
npm --version
```

### 3. Install PostgreSQL

```bash
# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Start and enable PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql <<EOF
CREATE DATABASE teams_approval;
CREATE USER approval_user WITH ENCRYPTED PASSWORD 'STRONG_PASSWORD_HERE';
GRANT ALL PRIVILEGES ON DATABASE teams_approval TO approval_user;
\q
EOF
```

### 4. Install Nginx

```bash
# Install Nginx
sudo apt install -y nginx

# Start and enable Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

### 5. Install PM2

```bash
# Install PM2 globally
sudo npm install -g pm2

# Set up PM2 startup script
pm2 startup systemd
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp /home/$USER
```

## Application Deployment

### 1. Clone Repository

```bash
# Create application directory
sudo mkdir -p /var/www
cd /var/www

# Clone repository
sudo git clone https://github.com/your-org/etilogteamsapp.git
sudo chown -R $USER:$USER etilogteamsapp
cd etilogteamsapp
```

### 2. Install Dependencies

```bash
# Install production dependencies
npm install --production
```

### 3. Configure Environment

```bash
# Create .env file
nano .env
```

Add production configuration:

```env
# Server Configuration
PORT=3978
NODE_ENV=production

# Microsoft Teams Bot
MICROSOFT_APP_ID=your-app-id
MICROSOFT_APP_PASSWORD=your-app-password
BOT_ID=your-bot-id

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=teams_approval
DB_USER=approval_user
DB_PASSWORD=STRONG_PASSWORD_HERE

# Azure AD / Entra ID
TENANT_ID=your-tenant-id
CLIENT_ID=your-client-id
CLIENT_SECRET=your-client-secret

# Application URLs
APP_BASE_URL=https://your-domain.com
TEAMS_APP_URL=https://your-domain.com

# Logging
LOG_LEVEL=info
```

**Important**:
- Replace all placeholders with actual values
- Use strong passwords
- Keep this file secure (never commit to git)

### 4. Run Database Migrations

```bash
npm run migrate
```

### 5. Test Application

```bash
# Test start
npm start

# If successful, stop with Ctrl+C
```

## Nginx Configuration

### 1. Create Nginx Configuration

```bash
sudo nano /etc/nginx/sites-available/teams-approval
```

Add configuration:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL Configuration (will be updated by Certbot)
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # SSL Settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Logging
    access_log /var/log/nginx/teams-approval-access.log;
    error_log /var/log/nginx/teams-approval-error.log;

    # Proxy Settings
    location / {
        proxy_pass http://localhost:3978;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Bot endpoint
    location /api/messages {
        proxy_pass http://localhost:3978/api/messages;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;

        # Longer timeout for bot messages
        proxy_read_timeout 120s;
    }
}
```

### 2. Enable Site

```bash
# Create symlink
sudo ln -s /etc/nginx/sites-available/teams-approval /etc/nginx/sites-enabled/

# Remove default site
sudo rm /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

## SSL Certificate

### Install Certbot and Get Certificate

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d your-domain.com

# Follow prompts and select options:
# - Enter email address
# - Agree to terms
# - Choose redirect option (recommended)

# Test auto-renewal
sudo certbot renew --dry-run
```

Certificate will auto-renew via cron job.

## PM2 Setup

### 1. Start Application with PM2

```bash
cd /var/www/etilogteamsapp

# Start application
pm2 start src/index.js --name teams-approval-app

# Save PM2 configuration
pm2 save

# View status
pm2 status

# View logs
pm2 logs teams-approval-app
```

### 2. PM2 Configuration (Optional)

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'teams-approval-app',
    script: 'src/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    error_file: '/var/log/pm2/teams-approval-error.log',
    out_file: '/var/log/pm2/teams-approval-out.log',
    log_file: '/var/log/pm2/teams-approval-combined.log',
    time: true
  }]
};
```

Start with config:
```bash
pm2 start ecosystem.config.js
pm2 save
```

## Monitoring and Maintenance

### PM2 Monitoring

```bash
# View status
pm2 status

# View logs (live)
pm2 logs

# View specific app logs
pm2 logs teams-approval-app

# Monitor resources
pm2 monit

# Restart app
pm2 restart teams-approval-app

# Stop app
pm2 stop teams-approval-app
```

### System Logs

```bash
# Nginx access logs
sudo tail -f /var/log/nginx/teams-approval-access.log

# Nginx error logs
sudo tail -f /var/log/nginx/teams-approval-error.log

# PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-14-main.log
```

### Database Backup

Create backup script `/usr/local/bin/backup-teams-db.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/teams-approval"
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="teams_approval_${DATE}.sql.gz"

mkdir -p $BACKUP_DIR
pg_dump -U approval_user teams_approval | gzip > "${BACKUP_DIR}/${FILENAME}"

# Keep only last 7 days of backups
find $BACKUP_DIR -type f -mtime +7 -delete

echo "Backup completed: ${FILENAME}"
```

Make executable and schedule:
```bash
sudo chmod +x /usr/local/bin/backup-teams-db.sh

# Add to crontab (daily at 2 AM)
sudo crontab -e
# Add line:
0 2 * * * /usr/local/bin/backup-teams-db.sh
```

## Updates and Maintenance

### Deploying Updates

```bash
cd /var/www/etilogteamsapp

# Pull latest changes
git pull origin main

# Install dependencies
npm install --production

# Verify the app still boots and its routes answer BEFORE restarting.
# A route file that references a middleware it did not import kills the
# process at startup, and Traefik then answers every request with 404.
npm run smoke

# Apply pending numbered migrations (024+). Optional - the app also runs
# them on start, so a plain restart is enough.
npm run migrate

# Restart application
pm2 restart teams-approval-app

# Check status
pm2 status
pm2 logs teams-approval-app --lines 50
```

### Zero-Downtime Deployment (Advanced)

Use PM2 reload for zero-downtime:

```bash
pm2 reload teams-approval-app
```

## Security Best Practices

### 1. Firewall Configuration

```bash
# Allow only necessary ports
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (redirect)
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# Check status
sudo ufw status verbose
```

### 2. SSH Hardening

```bash
# Edit SSH config
sudo nano /etc/ssh/sshd_config

# Recommended settings:
# PermitRootLogin no
# PasswordAuthentication no
# PubkeyAuthentication yes
# Port 2222  # Change default port

# Restart SSH
sudo systemctl restart sshd
```

### 3. Fail2Ban Installation

```bash
sudo apt install -y fail2ban

# Configure
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
sudo nano /etc/fail2ban/jail.local

# Enable and start
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

### 4. Regular Updates

```bash
# Set up automatic security updates
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

## Troubleshooting

### Application Won't Start

```bash
# Check logs
pm2 logs teams-approval-app

# Check Node.js version
node --version

# Check environment variables
pm2 env teams-approval-app

# Test manually
cd /var/www/etilogteamsapp
NODE_ENV=production node src/index.js
```

### Database Connection Issues

```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Test connection
psql -h localhost -U approval_user -d teams_approval -c "SELECT 1;"

# Check PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-14-main.log
```

### Nginx Issues

```bash
# Test config
sudo nginx -t

# Check status
sudo systemctl status nginx

# Reload config
sudo systemctl reload nginx

# Check logs
sudo tail -f /var/log/nginx/error.log
```

### SSL Certificate Issues

```bash
# Check certificate expiry
sudo certbot certificates

# Renew manually
sudo certbot renew

# Test renewal
sudo certbot renew --dry-run
```

## Performance Optimization

### 1. PostgreSQL Tuning

Edit `/etc/postgresql/14/main/postgresql.conf`:

```ini
# Memory Settings (adjust based on your VPS)
shared_buffers = 1GB
effective_cache_size = 3GB
maintenance_work_mem = 256MB
work_mem = 16MB

# Connections
max_connections = 100

# Logging (for debugging)
log_min_duration_statement = 1000  # Log slow queries
```

Restart PostgreSQL:
```bash
sudo systemctl restart postgresql
```

### 2. Node.js Clustering

Update `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'teams-approval-app',
    script: 'src/index.js',
    instances: 2,  # or 'max' for all CPUs
    exec_mode: 'cluster',
    ...
  }]
};
```

### 3. Nginx Caching

Add to nginx config:

```nginx
# Cache static content
location ~* \.(jpg|jpeg|png|gif|ico|css|js)$ {
    expires 7d;
    add_header Cache-Control "public, immutable";
}
```

## Monitoring Setup (Optional)

### Install Monitoring Tools

```bash
# Install Netdata (real-time monitoring)
bash <(curl -Ss https://my-netdata.io/kickstart.sh)

# Access at https://your-domain.com:19999
```

### PM2 Plus (Optional)

```bash
# Register for PM2 Plus account
pm2 link <secret_key> <public_key>

# View at https://app.pm2.io
```

## Rollback Procedure

If deployment fails:

```bash
cd /var/www/etilogteamsapp

# Revert to previous version
git log --oneline  # Find previous commit
git checkout <previous-commit-hash>

# Reinstall dependencies
npm install --production

# Restart
pm2 restart teams-approval-app
```

## Support and Maintenance

- Monitor logs daily
- Check PM2 status regularly
- Review security updates weekly
- Test backups monthly
- Update dependencies quarterly

For issues, check:
1. Application logs: `pm2 logs`
2. Nginx logs: `/var/log/nginx/`
3. PostgreSQL logs: `/var/log/postgresql/`
4. System logs: `journalctl -xe`
