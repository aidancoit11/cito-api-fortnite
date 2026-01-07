# DigitalOcean Deployment Guide

## Quick Setup (~10 minutes)

### 1. Create a Droplet

1. Go to [DigitalOcean](https://cloud.digitalocean.com/)
2. Create → Droplets
3. Choose:
   - **Image**: Ubuntu 24.04 LTS
   - **Plan**: Basic $6/mo (1GB RAM) - enough for scraping
   - **Region**: NYC or closest to you
   - **Authentication**: SSH key (recommended) or password

### 2. Initial Server Setup

SSH into your droplet:
```bash
ssh root@YOUR_DROPLET_IP
```

Run these commands:
```bash
# Update system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install git
apt install -y git

# Clone your repo
git clone https://github.com/YOUR_USERNAME/cito-api-fortnite.git
cd cito-api-fortnite

# Install dependencies
npm install

# Generate Prisma client
npx prisma generate
```

### 3. Configure Environment

```bash
# Copy example env
cp .env.example .env

# Edit with your values
nano .env
```

Required values:
- `DATABASE_URL` - Your Supabase PostgreSQL connection string
- `PROXY_LIST` - Your Webshare proxy list (optional but recommended)

### 4. Run the Overnight Sync

```bash
# Run sync (will take several hours)
nohup npx tsx src/scripts/overnight-sync.ts > sync.log 2>&1 &

# Monitor progress
tail -f sync.log
```

### 5. Run the API Server

```bash
# Build
npm run build

# Run with PM2 (process manager)
npm install -g pm2
pm2 start dist/index.js --name "fortnite-api"
pm2 save
pm2 startup
```

---

## Proxy Setup (Webshare.io)

1. Sign up at [webshare.io](https://webshare.io)
2. Buy 10 datacenter proxies ($5.49/mo)
3. Go to Proxy → List → Download as CSV
4. Format proxies as: `host:port:user:pass,host:port:user:pass,...`
5. Add to your `.env`:
   ```
   PROXY_LIST=p.webshare.io:80:user1:pass1,p.webshare.io:80:user2:pass2,...
   ```

---

## Scheduled Syncs (Cron)

Run sync every night at 2 AM:

```bash
crontab -e
```

Add:
```cron
0 2 * * * cd /root/cito-api-fortnite && npx tsx src/scripts/overnight-sync.ts >> /root/sync.log 2>&1
```

---

## Monitoring

Check API health:
```bash
curl http://localhost:3000/api/v1/health
```

Check sync logs:
```bash
tail -100 sync.log
```

Check PM2 status:
```bash
pm2 status
pm2 logs fortnite-api
```

---

## Cost Summary

| Service | Cost |
|---------|------|
| DigitalOcean Droplet | $6/mo |
| Webshare Proxies (10) | $5.49/mo |
| **Total** | **~$12/mo** |
