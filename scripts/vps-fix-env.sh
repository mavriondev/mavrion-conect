#!/bin/bash
set -e

VPS_HOST="root@187.77.232.164"
SSH_CMD="sshpass -p $VPS_SSH_PASSWORD ssh -o StrictHostKeyChecking=no $VPS_HOST"

$SSH_CMD << 'REMOTE'
set -e

echo "=== Updating PM2 ecosystem config ==="
cat > /var/www/mavrion-conect/ecosystem.config.cjs << 'PM2CONFIG'
module.exports = {
  apps: [{
    name: 'mavrion-conect',
    script: 'dist/index.js',
    cwd: '/var/www/mavrion-conect',
    env: {
      NODE_ENV: 'production',
      PORT: 5000,
      DATABASE_URL: 'postgresql://mavrion:Mvr10n_C0n3ct_2026!@localhost:5432/mavrion_conect',
      SESSION_SECRET: 'mvr10n_s3ss10n_s3cr3t_pr0duct10n_2026'
    },
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '1G',
    log_file: '/var/log/mavrion/app.log',
    error_file: '/var/log/mavrion/error.log',
    out_file: '/var/log/mavrion/out.log',
    time: true
  }]
};
PM2CONFIG

echo "=== Restarting PM2 ==="
cd /var/www/mavrion-conect
pm2 delete mavrion-conect 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

sleep 5

echo "=== Logs ==="
pm2 logs mavrion-conect --lines 15 --nostream 2>&1

echo "=== Health check ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/ 2>/dev/null || echo "000")
echo "HTTP status: $HTTP_CODE"

pm2 status
REMOTE
