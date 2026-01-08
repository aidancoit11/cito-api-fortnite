#!/bin/bash
# Deploy script for Fortnite API

SERVER="root@138.68.44.80"
APP_DIR="/root/cito-api-fortnite"

echo "🚀 Deploying to droplet..."

ssh $SERVER << 'EOF'
cd /var/www/fortnite-api

echo "📥 Pulling latest code..."
git pull

echo "📦 Installing dependencies..."
npm install

echo "🔄 Restarting API server..."
pm2 restart fortnite-api

echo "🛑 Stopping existing sync jobs..."
screen -X -S tournamentsync quit 2>/dev/null
screen -X -S rostersync quit 2>/dev/null

echo "🏆 Starting tournament sync with proxies..."
screen -dmS tournamentsync bash -c 'npx tsx src/jobs/tournament-sync.ts --full 2>&1 | tee tournamentsync.log'

echo ""
echo "✅ Deployment complete!"
echo ""
echo "To view logs: screen -r tournamentsync"
echo "To detach: Ctrl+A, D"
EOF
