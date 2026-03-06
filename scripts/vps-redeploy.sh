#!/bin/bash
set -e

VPS_HOST="root@187.77.232.164"
SSH_CMD="sshpass -p $VPS_SSH_PASSWORD ssh -o StrictHostKeyChecking=no $VPS_HOST"

$SSH_CMD << 'REMOTE'
set -e

cd /var/www/mavrion-conect

echo "=== 1. Pull latest from GitHub ==="
git fetch origin && git reset --hard origin/main
echo "Commit: $(git log --oneline -1)"

echo "=== 2. Install deps ==="
npm ci 2>&1 | tail -3

echo "=== 3. Build frontend ==="
npx vite build 2>&1 | tail -3
echo "Frontend OK"

echo "=== 4. Copy frontend build to server/public ==="
rm -rf server/public
cp -r dist/client server/public 2>/dev/null || cp -r client/dist server/public 2>/dev/null || true
ls server/public/ 2>/dev/null | head -5
echo "Static copy OK"

echo "=== 5. Restart PM2 ==="
pm2 delete mavrion-conect 2>/dev/null || true
pm2 flush 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

sleep 5

echo "=== 6. Logs ==="
pm2 logs mavrion-conect --lines 15 --nostream 2>&1

echo "=== 7. Health check ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/ 2>/dev/null || echo "000")
echo "HTTP status: $HTTP_CODE"

pm2 status
REMOTE
