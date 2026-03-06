#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

APP_DIR="/var/www/mavrion-conect"
LOG_DIR="/var/log/mavrion"
DB_USER="mavrion"
DB_NAME="mavrion_conect"
DOMAIN="mavrionconnect.com.br"
GITHUB_REPO="https://github.com/mavriondev/mavrion-conect.git"
NODE_MAJOR=20

print_step() { echo -e "\n${BLUE}[$1/$TOTAL_STEPS]${NC} $2"; }
print_ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
print_warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
print_err()  { echo -e "  ${RED}✗${NC} $1"; }

TOTAL_STEPS=9

echo ""
echo "=========================================="
echo "  MAVRION CONECT — Instalação Completa"
echo "=========================================="
echo ""
echo "  VPS:    $(hostname -I 2>/dev/null | awk '{print $1}')"
echo "  OS:     $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || echo "Linux")"
echo "  Data:   $(date '+%Y-%m-%d %H:%M:%S')"
echo ""
echo "=========================================="

if [ "$(id -u)" -ne 0 ]; then
  print_err "Este script deve ser executado como root"
  exit 1
fi

print_step 1 "Instalando pacotes do sistema..."

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  curl git nginx certbot python3-certbot-nginx \
  ufw postgresql postgresql-contrib \
  build-essential ca-certificates gnupg lsb-release \
  > /dev/null 2>&1

print_ok "Pacotes instalados"

print_step 2 "Configurando PostgreSQL..."

systemctl enable postgresql > /dev/null 2>&1
systemctl start postgresql

DB_PASS=""
if sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  print_ok "Usuário '${DB_USER}' já existe"
else
  read -sp "  Defina a senha do banco para o usuário '${DB_USER}': " DB_PASS
  echo ""
  if [ -z "$DB_PASS" ]; then
    print_err "Senha não pode ser vazia"
    exit 1
  fi
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" > /dev/null
  print_ok "Usuário '${DB_USER}' criado"
fi

if sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  print_ok "Banco '${DB_NAME}' já existe"
else
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" > /dev/null
  print_ok "Banco '${DB_NAME}' criado"
fi

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" > /dev/null 2>&1
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};" > /dev/null 2>&1

print_step 3 "Instalando Node.js ${NODE_MAJOR} e PM2..."

if command -v node &>/dev/null; then
  CURRENT_NODE=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$CURRENT_NODE" -ge "$NODE_MAJOR" ]; then
    print_ok "Node.js $(node -v) já instalado"
  else
    print_warn "Node.js $(node -v) encontrado, atualizando para v${NODE_MAJOR}..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - > /dev/null 2>&1
    apt-get install -y -qq nodejs > /dev/null 2>&1
    print_ok "Node.js $(node -v) instalado"
  fi
else
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
  print_ok "Node.js $(node -v) instalado"
fi

if command -v pm2 &>/dev/null; then
  print_ok "PM2 $(pm2 -v) já instalado"
else
  npm install -g pm2 > /dev/null 2>&1
  print_ok "PM2 $(pm2 -v) instalado"
fi

print_step 4 "Clonando repositório..."

mkdir -p "${APP_DIR}"
mkdir -p "${LOG_DIR}"

if [ -d "${APP_DIR}/.git" ]; then
  print_warn "Repositório já existe, atualizando..."
  cd "${APP_DIR}"
  git config --global --add safe.directory "${APP_DIR}" 2>/dev/null
  git fetch origin
  git checkout main 2>/dev/null || true
  git pull origin main
  print_ok "Repositório atualizado: $(git log --oneline -1)"
else
  if [ "$(ls -A ${APP_DIR} 2>/dev/null)" ]; then
    print_warn "Diretório não vazio sem .git — fazendo backup..."
    mv "${APP_DIR}" "${APP_DIR}.bak.$(date +%s)"
    mkdir -p "${APP_DIR}"
  fi
  git clone "${GITHUB_REPO}" "${APP_DIR}"
  cd "${APP_DIR}"
  print_ok "Repositório clonado: $(git log --oneline -1)"
fi

print_step 5 "Configurando variáveis de ambiente (.env)..."

cd "${APP_DIR}"

if [ -f ".env" ]; then
  print_warn "Arquivo .env já existe — NÃO será sobrescrito"
  print_warn "Edite manualmente se necessário: nano ${APP_DIR}/.env"
else
  SESSION_SECRET=$(openssl rand -base64 48)

  if [ -z "$DB_PASS" ]; then
    read -sp "  Senha do banco PostgreSQL (usuário '${DB_USER}'): " DB_PASS
    echo ""
  fi

  cat > .env << EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
SESSION_SECRET=${SESSION_SECRET}
NODE_ENV=production
PORT=5000
APP_URL=https://${DOMAIN}
EOF

  echo ""
  echo "  As chaves abaixo são opcionais. Pressione Enter para pular."
  echo ""

  read -p "  CNPJA_API_KEY: " CNPJA_KEY
  [ -n "$CNPJA_KEY" ] && echo "CNPJA_API_KEY=${CNPJA_KEY}" >> .env

  read -p "  EMBRAPA_CONSUMER_KEY: " EMBRAPA_KEY
  [ -n "$EMBRAPA_KEY" ] && echo "EMBRAPA_CONSUMER_KEY=${EMBRAPA_KEY}" >> .env

  read -p "  EMBRAPA_CONSUMER_SECRET: " EMBRAPA_SECRET
  [ -n "$EMBRAPA_SECRET" ] && echo "EMBRAPA_CONSUMER_SECRET=${EMBRAPA_SECRET}" >> .env

  read -p "  RESEND_API_KEY (email): " RESEND_KEY
  [ -n "$RESEND_KEY" ] && echo "RESEND_API_KEY=${RESEND_KEY}" >> .env

  read -p "  GOOGLE_SERVICE_ACCOUNT_KEY (JSON, 1 linha): " GOOGLE_KEY
  [ -n "$GOOGLE_KEY" ] && echo "GOOGLE_SERVICE_ACCOUNT_KEY=${GOOGLE_KEY}" >> .env

  read -p "  GOOGLE_DRIVE_ROOT_FOLDER_ID: " GDRIVE_FOLDER
  [ -n "$GDRIVE_FOLDER" ] && echo "GOOGLE_DRIVE_ROOT_FOLDER_ID=${GDRIVE_FOLDER}" >> .env

  chmod 600 .env
  print_ok "Arquivo .env criado ($(grep -c '=' .env) variáveis)"
fi

print_step 6 "Instalando dependências e fazendo build..."

cd "${APP_DIR}"

npm ci 2>&1 | tail -3
print_ok "Dependências instaladas"

npm run build 2>&1 | tail -5
print_ok "Build concluído"

if [ ! -f "dist/index.cjs" ]; then
  print_err "Arquivo dist/index.cjs não encontrado — build falhou"
  exit 1
fi

print_step 7 "Configurando PM2..."

cd "${APP_DIR}"

if [ ! -f "ecosystem.config.cjs" ]; then
  cat > ecosystem.config.cjs << 'PM2EOF'
const fs = require('fs');
const path = require('path');

const envFile = path.resolve(__dirname, '.env');
const envVars = {};
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        envVars[trimmed.substring(0, eqIndex)] = trimmed.substring(eqIndex + 1);
      }
    }
  });
}

module.exports = {
  apps: [{
    name: 'mavrion-conect',
    script: 'dist/index.cjs',
    cwd: __dirname,
    env: envVars,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '1G',
    log_file: '/var/log/mavrion/app.log',
    error_file: '/var/log/mavrion/error.log',
    out_file: '/var/log/mavrion/out.log',
    time: true,
  }]
};
PM2EOF
  print_ok "ecosystem.config.cjs criado"
else
  print_ok "ecosystem.config.cjs já existe"
fi

pm2 delete mavrion-conect 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save > /dev/null 2>&1
pm2 startup systemd -u root --hp /root 2>/dev/null | tail -1

print_ok "PM2 iniciado"

print_step 8 "Configurando Nginx e SSL..."

cat > /etc/nginx/sites-available/mavrion-conect << NGINX
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN} www.${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    client_max_body_size 30M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/mavrion-conect /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

CERT_EXISTS=false
if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
  CERT_EXISTS=true
  print_ok "Certificado SSL já existe"
fi

if [ "$CERT_EXISTS" = false ]; then
  cat > /etc/nginx/sites-available/mavrion-conect-temp << NGINX_TEMP
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX_TEMP
  ln -sf /etc/nginx/sites-available/mavrion-conect-temp /etc/nginx/sites-enabled/mavrion-conect
  nginx -t > /dev/null 2>&1 && systemctl reload nginx

  echo ""
  read -p "  Email para SSL (Let's Encrypt): " SSL_EMAIL
  [ -z "$SSL_EMAIL" ] && SSL_EMAIL="admin@${DOMAIN}"

  if certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --email "${SSL_EMAIL}" --redirect 2>&1; then
    print_ok "Certificado SSL gerado"
    ln -sf /etc/nginx/sites-available/mavrion-conect /etc/nginx/sites-enabled/mavrion-conect
    rm -f /etc/nginx/sites-available/mavrion-conect-temp
  else
    print_warn "SSL falhou — verifique se o DNS de ${DOMAIN} aponta para este servidor"
    print_warn "Depois execute: certbot --nginx -d ${DOMAIN}"
  fi
fi

nginx -t > /dev/null 2>&1 && systemctl reload nginx
print_ok "Nginx configurado"

print_step 9 "Configurando firewall..."

ufw allow OpenSSH > /dev/null 2>&1
ufw allow 'Nginx Full' > /dev/null 2>&1

if ufw status | grep -q "Status: active"; then
  print_ok "Firewall já ativo"
else
  echo "y" | ufw enable > /dev/null 2>&1
  print_ok "Firewall ativado"
fi

echo ""
echo "=========================================="
echo "  VERIFICAÇÃO FINAL"
echo "=========================================="
echo ""

sleep 5

CHECKS_PASSED=0
CHECKS_TOTAL=4

PM2_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json; apps=json.load(sys.stdin); print(apps[0]['pm2_env']['status'])" 2>/dev/null || echo "unknown")
if [ "$PM2_STATUS" = "online" ]; then
  print_ok "PM2: online"
  CHECKS_PASSED=$((CHECKS_PASSED + 1))
else
  print_err "PM2: ${PM2_STATUS}"
fi

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://localhost:5000/" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  print_ok "HTTP local: ${HTTP_CODE}"
  CHECKS_PASSED=$((CHECKS_PASSED + 1))
else
  print_err "HTTP local: ${HTTP_CODE}"
fi

API_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://localhost:5000/api/user" 2>/dev/null || echo "000")
if [ "$API_CODE" = "200" ] || [ "$API_CODE" = "401" ]; then
  print_ok "API respondendo: ${API_CODE}"
  CHECKS_PASSED=$((CHECKS_PASSED + 1))
else
  print_err "API: ${API_CODE}"
fi

NGINX_OK=$(nginx -t 2>&1 && echo "ok" || echo "fail")
if [ "$NGINX_OK" != "fail" ]; then
  print_ok "Nginx: configuração válida"
  CHECKS_PASSED=$((CHECKS_PASSED + 1))
else
  print_err "Nginx: configuração inválida"
fi

echo ""
echo "=========================================="
if [ $CHECKS_PASSED -eq $CHECKS_TOTAL ]; then
  echo -e "  ${GREEN}✓ INSTALAÇÃO COMPLETA (${CHECKS_PASSED}/${CHECKS_TOTAL})${NC}"
else
  echo -e "  ${YELLOW}⚠ INSTALAÇÃO PARCIAL (${CHECKS_PASSED}/${CHECKS_TOTAL})${NC}"
fi
echo "=========================================="
echo ""
echo "  App:     https://${DOMAIN}"
echo "  Login:   admin / Aspessoas112358()"
echo ""
echo "  Comandos úteis:"
echo "    pm2 status"
echo "    pm2 logs mavrion-conect"
echo "    nano ${APP_DIR}/.env"
echo ""
echo "  Para atualizar depois:"
echo "    bash ${APP_DIR}/scripts/vps-update.sh"
echo ""
echo "=========================================="
