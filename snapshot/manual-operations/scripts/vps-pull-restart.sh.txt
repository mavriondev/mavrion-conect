#!/bin/bash
set -e

VPS_HOST="root@187.77.232.164"
SSH_CMD="sshpass -p $VPS_SSH_PASSWORD ssh -o StrictHostKeyChecking=no $VPS_HOST"

$SSH_CMD << 'REMOTE'
set -e

cd /var/www/mavrion-conect

echo "=== Pull ==="
git fetch origin && git reset --hard origin/main
echo "$(git log --oneline -1)"

echo "=== Restart PM2 ==="
pm2 restart mavrion-conect

sleep 5

echo "=== Logs ==="
pm2 logs mavrion-conect --lines 10 --nostream 2>&1

echo "=== Health ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/ 2>/dev/null || echo "000")
echo "HTTP: $HTTP_CODE"

pm2 status
REMOTE
