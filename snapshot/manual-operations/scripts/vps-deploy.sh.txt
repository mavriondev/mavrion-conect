#!/bin/bash
set -e

VPS_HOST="root@187.77.232.164"
SSH_CMD="sshpass -p $VPS_SSH_PASSWORD ssh -o StrictHostKeyChecking=no $VPS_HOST"

$SSH_CMD << 'REMOTE'
set -e

echo "=== 1. Clonando repositório ==="
cd /var/www
if [ -d "mavrion-conect/.git" ]; then
  cd mavrion-conect && git fetch origin && git reset --hard origin/main
else
  rm -rf mavrion-conect
  git clone https://github.com/mavriondev/mavrion-conect.git
  cd mavrion-conect
fi
echo "Repo: $(git log --oneline -1)"

echo "=== 2. Instalando dependências ==="
cd /var/www/mavrion-conect
npm ci 2>&1 | tail -5
echo "Deps OK"

echo "=== 3. Build ==="
cd /var/www/mavrion-conect
npx vite build 2>&1 | tail -5
npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist 2>&1 | tail -3
echo "Build OK"
REMOTE
