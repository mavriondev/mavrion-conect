#!/bin/bash
set -e

VPS_HOST="root@187.77.232.164"
SSH_CMD="sshpass -p $VPS_SSH_PASSWORD ssh -o StrictHostKeyChecking=no $VPS_HOST"

$SSH_CMD << 'REMOTE'
set -e

echo "=== 1. Building frontend ==="
cd /var/www/mavrion-conect
npx vite build 2>&1 | tail -5
echo "Frontend build OK"

echo "=== 2. Building backend ==="
npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist 2>&1 | tail -3
echo "Backend build OK"

echo "=== 3. Creating .env file ==="
cat > /var/www/mavrion-conect/.env << 'ENV'
NODE_ENV=production
PORT=5000
DATABASE_URL=postgresql://mavrion:Mvr10n_C0n3ct_2026!@localhost:5432/mavrion_conect
SESSION_SECRET=mvr10n_s3ss10n_s3cr3t_pr0duct10n_2026
ENV
echo ".env created"

echo "=== 4. Running database schema push ==="
cd /var/www/mavrion-conect
npx drizzle-kit push --force 2>&1 | tail -10
echo "DB schema pushed"

echo "=== 5. Configuring PM2 ==="
cat > /var/www/mavrion-conect/ecosystem.config.cjs << 'PM2CONFIG'
module.exports = {
  apps: [{
    name: 'mavrion-conect',
    script: 'dist/index.js',
    cwd: '/var/www/mavrion-conect',
    node_args: '--experimental-specifier-resolution=node',
    env: {
      NODE_ENV: 'production',
      PORT: 5000
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
echo "PM2 config created"

echo "=== 6. Configuring Nginx ==="
cat > /etc/nginx/sites-available/mavrion-conect << 'NGINX'
server {
    listen 80;
    server_name mavrionconnect.com.br www.mavrionconnect.com.br;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/mavrion-conect /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t 2>&1
systemctl reload nginx
echo "Nginx configured"

echo "=== 7. Starting application ==="
cd /var/www/mavrion-conect
pm2 delete mavrion-conect 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root 2>&1 | tail -3
echo "PM2 started"

sleep 3
echo "=== 8. Health check ==="
curl -s -o /dev/null -w "HTTP %{http_code}" http://localhost:5000/api/health 2>/dev/null || \
curl -s -o /dev/null -w "HTTP %{http_code}" http://localhost:5000/ 2>/dev/null || \
echo "Waiting for app startup..."

pm2 status
echo "=== DONE ==="
REMOTE
