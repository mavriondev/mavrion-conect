#!/bin/bash
set -e

VPS_HOST="root@187.77.232.164"
SSH_CMD="sshpass -p $VPS_SSH_PASSWORD ssh -o StrictHostKeyChecking=no $VPS_HOST"

$SSH_CMD << 'REMOTE'
set -e

cd /var/www/mavrion-conect

echo "=== 1. Installing tsx globally ==="
npm install -g tsx 2>/dev/null
echo "tsx: $(tsx --version 2>/dev/null || echo 'installed')"

echo "=== 2. Moving Vite build output ==="
if [ -d "dist/public" ]; then
  echo "dist/public already exists"
else
  mkdir -p dist/public
  cp -r client/dist/* dist/public/ 2>/dev/null || true
  ls dist/public/ | head -5
fi
echo "Static assets ready"

echo "=== 3. Updating PM2 to use tsx ==="
cat > /var/www/mavrion-conect/ecosystem.config.cjs << 'PM2CONFIG'
module.exports = {
  apps: [{
    name: 'mavrion-conect',
    script: 'server/index.ts',
    interpreter: '/usr/bin/node',
    interpreter_args: '--import tsx/esm',
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

echo "=== 4. Restarting PM2 ==="
pm2 delete mavrion-conect 2>/dev/null || true
pm2 flush 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

sleep 5

echo "=== 5. Logs ==="
pm2 logs mavrion-conect --lines 20 --nostream 2>&1

echo "=== 6. Health check ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/ 2>/dev/null || echo "000")
echo "HTTP status: $HTTP_CODE"

pm2 status
REMOTE
