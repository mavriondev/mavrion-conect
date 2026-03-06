#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

APP_DIR="/var/www/mavrion-conect"
LOG_DIR="/var/log/mavrion"
DOMAIN="mavrionconnect.com.br"

print_step() { echo -e "\n${BLUE}[$1/$TOTAL_STEPS]${NC} $2"; }
print_ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
print_warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
print_err()  { echo -e "  ${RED}✗${NC} $1"; }

TOTAL_STEPS=6

echo ""
echo "=========================================="
echo "  MAVRION CONECT — Atualização"
echo "=========================================="
echo "  Data: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

if [ "$(id -u)" -ne 0 ]; then
  print_err "Execute como root"
  exit 1
fi

if [ ! -d "${APP_DIR}" ]; then
  print_err "Diretório ${APP_DIR} não encontrado"
  print_err "Execute vps-install.sh primeiro"
  exit 1
fi

if [ ! -f "${APP_DIR}/.env" ]; then
  print_err "Arquivo .env não encontrado"
  exit 1
fi

cd "${APP_DIR}"
git config --global --add safe.directory "${APP_DIR}" 2>/dev/null

print_step 1 "Verificando atualizações no GitHub..."

CURRENT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
echo "  Versão atual: $(git log --oneline -1 2>/dev/null)"

git fetch origin 2>/dev/null
REMOTE_SHA=$(git rev-parse origin/main 2>/dev/null || echo "unknown")

if [ "$CURRENT_SHA" = "$REMOTE_SHA" ]; then
  print_ok "Já está na versão mais recente"
  read -p "  Deseja forçar o rebuild mesmo assim? (s/N): " FORCE_REBUILD
  if [ "$FORCE_REBUILD" != "s" ] && [ "$FORCE_REBUILD" != "S" ]; then
    echo ""
    echo "  Nenhuma alteração necessária."
    exit 0
  fi
else
  echo ""
  echo "  Commits novos:"
  git log --oneline "${CURRENT_SHA}..origin/main" 2>/dev/null | head -20
  echo ""
fi

print_step 2 "Criando backup..."

BACKUP_TAG="backup_$(date +%Y%m%d_%H%M%S)"

if [ -d "dist" ]; then
  cp -r dist "dist.${BACKUP_TAG}"
  print_ok "Backup do build: dist.${BACKUP_TAG}"
fi

BACKUP_COMMIT="$CURRENT_SHA"
print_ok "Commit de rollback: ${BACKUP_COMMIT}"

print_step 3 "Atualizando código..."

git checkout main 2>/dev/null || true
git pull origin main 2>&1 | tail -3

NEW_SHA=$(git rev-parse HEAD)
print_ok "Atualizado: $(git log --oneline -1)"

print_step 4 "Instalando dependências e fazendo build..."

npm ci 2>&1 | tail -3
print_ok "Dependências instaladas"

npm run build 2>&1 | tail -5

if [ ! -f "dist/index.cjs" ]; then
  print_err "Build falhou — dist/index.cjs não encontrado"
  print_warn "Restaurando backup..."

  if [ -d "dist.${BACKUP_TAG}" ]; then
    rm -rf dist
    mv "dist.${BACKUP_TAG}" dist
    print_ok "Backup restaurado"
  fi

  print_err "UPDATE FALHOU — versão anterior mantida"
  exit 1
fi

print_ok "Build concluído"

print_step 5 "Reiniciando aplicação..."

pm2 restart mavrion-conect --update-env 2>&1 | tail -3
print_ok "PM2 reiniciado"

print_step 6 "Verificação de saúde..."

echo "  Aguardando inicialização..."
sleep 8

HEALTH_OK=true

PM2_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json; apps=json.load(sys.stdin); [print(a['pm2_env']['status']) for a in apps if a['name']=='mavrion-conect']" 2>/dev/null || echo "unknown")
if [ "$PM2_STATUS" = "online" ]; then
  print_ok "PM2: online"
else
  print_err "PM2: ${PM2_STATUS}"
  HEALTH_OK=false
fi

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://localhost:5000/" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  print_ok "HTTP: ${HTTP_CODE}"
else
  print_err "HTTP: ${HTTP_CODE}"
  HEALTH_OK=false
fi

API_RESP=$(curl -s --max-time 10 "http://localhost:5000/api/dashboard/quotes" 2>/dev/null | head -c 100)
if echo "$API_RESP" | grep -q "selic"; then
  print_ok "API funcionando (Selic OK)"
else
  print_warn "API sem resposta esperada"
fi

if [ "$HEALTH_OK" = false ]; then
  echo ""
  print_err "HEALTH CHECK FALHOU — iniciando rollback..."
  echo ""

  if [ -d "dist.${BACKUP_TAG}" ]; then
    rm -rf dist
    mv "dist.${BACKUP_TAG}" dist
    pm2 restart mavrion-conect --update-env 2>/dev/null
    sleep 5

    ROLLBACK_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://localhost:5000/" 2>/dev/null || echo "000")
    if [ "$ROLLBACK_CODE" = "200" ]; then
      print_ok "Rollback bem-sucedido (HTTP ${ROLLBACK_CODE})"
    else
      print_err "Rollback falhou (HTTP ${ROLLBACK_CODE})"
      print_err "Verifique os logs: pm2 logs mavrion-conect"
    fi
  else
    print_err "Sem backup disponível para rollback"
    print_err "Verifique os logs: pm2 logs mavrion-conect"
  fi

  exit 1
fi

if [ -d "dist.${BACKUP_TAG}" ]; then
  rm -rf "dist.${BACKUP_TAG}"
  print_ok "Backup removido (não necessário)"
fi

OLD_BACKUPS=$(find "${APP_DIR}" -maxdepth 1 -name "dist.backup_*" -type d | sort | head -n -2)
if [ -n "$OLD_BACKUPS" ]; then
  echo "$OLD_BACKUPS" | xargs rm -rf
  print_ok "Backups antigos removidos"
fi

echo ""
echo "=========================================="
echo -e "  ${GREEN}✓ ATUALIZAÇÃO COMPLETA${NC}"
echo "=========================================="
echo ""
echo "  Versão: $(git log --oneline -1)"
echo "  App:    https://${DOMAIN}"
echo ""
echo "  Logs:   pm2 logs mavrion-conect"
echo "  Status: pm2 status"
echo ""
echo "=========================================="
