#!/bin/bash
set -e

VPS_HOST="root@187.77.232.164"
SSH_CMD="sshpass -p $VPS_SSH_PASSWORD ssh -o StrictHostKeyChecking=no $VPS_HOST"

echo "=== Connecting to VPS ==="
$SSH_CMD << 'REMOTE'
set -e

echo "=== 1. Updating system ==="
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl git nginx certbot python3-certbot-nginx ufw postgresql postgresql-contrib
echo "Base packages done"

echo "=== 2. Installing Node.js 20 ==="
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
echo "Node: $(node -v), NPM: $(npm -v)"

echo "=== 3. Installing PM2 ==="
npm install -g pm2 2>/dev/null
echo "PM2: $(pm2 -v)"

echo "=== 4. PostgreSQL setup ==="
systemctl enable postgresql
systemctl start postgresql
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='mavrion'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER mavrion WITH PASSWORD 'Mvr10n_C0n3ct_2026!';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='mavrion_conect'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE mavrion_conect OWNER mavrion;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE mavrion_conect TO mavrion;"
sudo -u postgres psql -d mavrion_conect -c "GRANT ALL ON SCHEMA public TO mavrion;"
echo "PostgreSQL ready"

echo "=== 5. Firewall ==="
ufw allow OpenSSH
ufw allow 'Nginx Full'
echo "y" | ufw enable
echo "Firewall ready"

echo "=== 6. Directories ==="
mkdir -p /var/www/mavrion-conect
mkdir -p /var/log/mavrion

echo "=== DONE ==="
echo "Node: $(node -v)"
echo "Git: $(git --version)"
echo "Nginx: $(nginx -v 2>&1)"
echo "PM2: $(pm2 -v)"
REMOTE
