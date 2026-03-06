#!/bin/bash
set -e

VPS_HOST="root@187.77.232.164"
SSH_CMD="sshpass -p $VPS_SSH_PASSWORD ssh -o StrictHostKeyChecking=no $VPS_HOST"

$SSH_CMD << 'REMOTE'
set -e

echo "=== Get server IPv4 ==="
SERVER_IP=$(curl -s -4 ifconfig.me 2>/dev/null)
echo "Server IPv4: $SERVER_IP"

echo "=== Domain DNS ==="
DOMAIN_IP=$(dig +short mavrionconnect.com.br A 2>/dev/null || nslookup mavrionconnect.com.br 2>/dev/null | grep "Address:" | tail -1 | awk '{print $2}')
echo "Domain A record: $DOMAIN_IP"

echo "=== Install cron ==="
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq cron 2>/dev/null
systemctl enable cron 2>/dev/null
systemctl start cron 2>/dev/null
echo "Cron installed"

echo "=== Setup auto-deploy cron ==="
(crontab -l 2>/dev/null | grep -v "deploy.sh" || true; echo "*/2 * * * * cd /var/www/mavrion-conect && git fetch origin --quiet && [ \$(git rev-parse HEAD) != \$(git rev-parse origin/main) ] && bash /var/www/mavrion-conect/deploy.sh >> /var/log/mavrion/deploy.log 2>&1") | crontab -
echo "Cron jobs:"
crontab -l

echo "=== Test access ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/ 2>/dev/null)
echo "Local: HTTP $HTTP_CODE"

echo ""
echo "========================================"
echo "  MAVRION CONECT — VPS STATUS"
echo "========================================"
echo "  Server IP: $SERVER_IP"
echo "  Domain: mavrionconnect.com.br → $DOMAIN_IP"
echo "  App: http://$SERVER_IP (HTTP $HTTP_CODE)"
echo ""
if [ "$SERVER_IP" = "$DOMAIN_IP" ]; then
  echo "  ✅ DNS correct! Domain points to this server."
  echo "  Running SSL certificate..."
  certbot --nginx -d mavrionconnect.com.br -d www.mavrionconnect.com.br --non-interactive --agree-tos --email admin@mavrionconnect.com.br --redirect 2>&1
else
  echo "  ⚠️  DNS MISMATCH: Domain points to $DOMAIN_IP, server is $SERVER_IP"
  echo "  → Go to Hostinger DNS settings and set A record to: $SERVER_IP"
  echo "  → After DNS propagation, run: certbot --nginx -d mavrionconnect.com.br -d www.mavrionconnect.com.br --non-interactive --agree-tos --email admin@mavrionconnect.com.br --redirect"
fi
echo "========================================"
REMOTE
