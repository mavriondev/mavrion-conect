#!/bin/bash
set -e

cd /var/www/mavrion-conect

echo "[$(date)] Starting deploy..."

git fetch origin
git reset --hard origin/main
echo "[$(date)] Git pull done: $(git log --oneline -1)"

npm ci 2>&1 | tail -3
echo "[$(date)] Deps installed"

npx vite build 2>&1 | tail -3
echo "[$(date)] Frontend built"

pm2 restart mavrion-conect --update-env
echo "[$(date)] PM2 restarted"

sleep 3
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/ 2>/dev/null)
echo "[$(date)] Health check: HTTP $HTTP_CODE"

echo "[$(date)] Deploy complete!"
