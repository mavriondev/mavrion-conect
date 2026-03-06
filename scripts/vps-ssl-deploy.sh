#!/bin/bash
set -e

VPS_HOST="root@187.77.232.164"
SSH_CMD="sshpass -p $VPS_SSH_PASSWORD ssh -o StrictHostKeyChecking=no $VPS_HOST"

$SSH_CMD << 'REMOTE'
set -e

echo "=== 1. Testing domain DNS ==="
DOMAIN_IP=$(dig +short mavrionconnect.com.br 2>/dev/null || echo "not resolved")
echo "Domain resolves to: $DOMAIN_IP"
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "unknown")
echo "Server IP: $SERVER_IP"

echo "=== 2. SSL Certificate ==="
certbot --nginx -d mavrionconnect.com.br -d www.mavrionconnect.com.br --non-interactive --agree-tos --email admin@mavrionconnect.com.br --redirect 2>&1 || echo "SSL: will retry when DNS propagates"

echo "=== 3. Create deploy script (GitHub webhook pull) ==="
cat > /var/www/mavrion-conect/deploy.sh << 'DEPLOY'
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
DEPLOY
chmod +x /var/www/mavrion-conect/deploy.sh
echo "deploy.sh created"

echo "=== 4. Create cron for auto-pull (every 2 min) ==="
crontab -l 2>/dev/null | grep -v "deploy.sh" > /tmp/crontab_clean || true
echo "*/2 * * * * cd /var/www/mavrion-conect && git fetch origin --quiet && [ \$(git rev-parse HEAD) != \$(git rev-parse origin/main) ] && bash /var/www/mavrion-conect/deploy.sh >> /var/log/mavrion/deploy.log 2>&1" >> /tmp/crontab_clean
crontab /tmp/crontab_clean
echo "Cron job set (checks GitHub every 2 min)"
crontab -l

echo "=== 5. Verify everything ==="
echo "Nginx:"
nginx -t 2>&1
echo ""
echo "PM2:"
pm2 status
echo ""
echo "Health:"
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:5000/
echo ""
echo "=== DONE ==="
echo "App: http://187.77.232.164"
echo "Domain: https://mavrionconnect.com.br (when DNS propagates)"
REMOTE
