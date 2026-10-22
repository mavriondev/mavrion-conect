#!/bin/bash
# install-cron.sh — instalação idempotente das entradas de cron das rotinas sidecar
# Rodar NO VPS (root). Só adiciona entradas que ainda não existem (match pelo nome do script).
set -euo pipefail

ROT=/var/www/mavrion-api/rotinas
LOGS=$ROT/logs
mkdir -p "$LOGS"

declare -A ENTRIES=(
  [anm-sigmine-sync.cjs]="15 5 * * 0 flock -n /tmp/anm-sync.lock /usr/bin/node $ROT/anm-sigmine-sync.cjs >> $LOGS/anm-sync.log 2>&1"
  [funai-tis-sync.cjs]="45 5 2 * * flock -n /tmp/funai-sync.lock /usr/bin/node $ROT/funai-tis-sync.cjs >> $LOGS/funai-sync.log 2>&1"
  [cprm-geologia-sync.cjs]="30 4 3 * * flock -n /tmp/cprm-sync.lock /usr/bin/node $ROT/cprm-geologia-sync.cjs >> $LOGS/cprm-sync.log 2>&1"
  [cprm-recursos-sync.cjs]="15 5 3 * * flock -n /tmp/cprm-recursos-sync.lock /usr/bin/node $ROT/cprm-recursos-sync.cjs >> $LOGS/cprm-recursos-sync.log 2>&1"
  [altitude-watchdog.cjs]="20 */6 * * * flock -n /tmp/alt-watchdog.lock /usr/bin/node $ROT/altitude-watchdog.cjs >> $LOGS/altitude-watchdog.log 2>&1"
  [token-renew.cjs]="0 8 * * * flock -n /tmp/token-renew.lock /usr/bin/node $ROT/token-renew.cjs >> $LOGS/token-renew.log 2>&1"
  [freshness-check.cjs]="30 8 * * * flock -n /tmp/freshness-check.lock /usr/bin/node $ROT/freshness-check.cjs >> $LOGS/freshness-check.log 2>&1"
)

CUR=$(crontab -l 2>/dev/null || true)
NEW="$CUR"
for script in "${!ENTRIES[@]}"; do
  if echo "$CUR" | grep -q "$script"; then
    echo "ok: $script já agendado"
  else
    NEW="$NEW"$'\n'"${ENTRIES[$script]}"
    echo "ADICIONADO: $script"
  fi
done
[ "$NEW" != "$CUR" ] && echo "$NEW" | crontab -
echo "--- crontab final (rotinas):"
crontab -l | grep -E "rotinas" || true
