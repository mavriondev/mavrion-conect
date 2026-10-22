#!/bin/bash
# backup-postgres.sh — dumps do Postgres da VPS (roda como root, autentica como
# usuário de sistema `postgres` por peer — nenhuma senha aqui ou no cron).
#
#   backup-postgres.sh daily        → mavrion_conect inteiro (dados dos usuários), mantém 7
#   backup-postgres.sh weekly-hub   → só tabelas não regeneráveis da Hub (mavrion_api_db), mantém 4
#
# Formato custom do pg_dump (-Fc, já compactado; restaura com pg_restore).
# Antes de gravar exige espaço livre >= 3x o tamanho estimado (tamanho das
# relações no banco — superestima o dump, que é compactado). Loga tamanho do dump,
# duração e erros em $DEST/backup.log. Sai com 1 em qualquer falha.
set -euo pipefail

MODE="${1:-}"
DEST=/root/backups/postgres
LOG=$DEST/backup.log
TS=$(date -u +%Y%m%d_%H%M%S)
mkdir -p "$DEST"
chmod 700 "$DEST"

log() { echo "$(date -u +%FT%TZ) [backup-pg:$MODE] $*" | tee -a "$LOG"; }
fail() { log "ERRO: $*"; exit 1; }

pg() { sudo -u postgres "$@"; }

case "$MODE" in
  daily)
    DB=mavrion_conect
    PREFIX=mavrion_conect
    KEEP=7
    DUMP_ARGS=()
    EST_SQL="SELECT pg_database_size('$DB')"
    ;;
  weekly-hub)
    DB=mavrion_api_db
    PREFIX=hub_nao_regeneraveis
    KEEP=4
    # Tabelas que não se reconstroem a partir de fontes públicas.
    DUMP_ARGS=(-t api_users -t agro_entities -t cardmv_leads -t 'agrofit_*' -t 'farmway_*'
               -t module_schedules -t sicar_import_schedule -t anm_barragens)
    EST_SQL="SELECT COALESCE(SUM(pg_total_relation_size(c.oid)),0) FROM pg_class c
             JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relkind IN ('r','p') AND (
               c.relname IN ('api_users','agro_entities','cardmv_leads','module_schedules','sicar_import_schedule','anm_barragens')
               OR c.relname LIKE 'agrofit\_%' OR c.relname LIKE 'farmway\_%')"
    ;;
  *)
    echo "uso: $0 daily|weekly-hub" >&2; exit 2 ;;
esac

OUT="$DEST/${PREFIX}_${TS}.dump"
TMP="$OUT.part"

# --- espaço -----------------------------------------------------------------
EST_BYTES=$(pg psql -d "$DB" -Atc "$EST_SQL" | tr -d '[:space:]')
[[ "$EST_BYTES" =~ ^[0-9]+$ ]] || fail "não consegui estimar o tamanho ($EST_BYTES)"
FREE_BYTES=$(( $(stat -f -c '%a*%S' "$DEST") ))
NEED=$(( EST_BYTES * 3 ))
if (( FREE_BYTES < NEED )); then
  fail "espaço insuficiente: livre $((FREE_BYTES/1048576)) MB < 3x estimado $((NEED/1048576)) MB (estimado $((EST_BYTES/1048576)) MB)"
fi
log "início: banco=$DB estimado=$((EST_BYTES/1048576)) MB livre=$((FREE_BYTES/1048576)) MB"

# --- dump -------------------------------------------------------------------
START=$(date +%s)
if ! pg pg_dump -Fc -Z 6 --no-owner --no-privileges "${DUMP_ARGS[@]}" -d "$DB" > "$TMP" 2>>"$LOG"; then
  rm -f "$TMP"
  fail "pg_dump falhou (ver linhas acima em $LOG)"
fi
# pg_restore -l valida o cabeçalho/TOC do arquivo gerado
if ! pg_restore -l "$TMP" > /dev/null 2>>"$LOG"; then
  rm -f "$TMP"
  fail "dump gerado não é legível pelo pg_restore"
fi
mv "$TMP" "$OUT"
chmod 600 "$OUT"
SIZE=$(stat -c %s "$OUT")
log "ok: $OUT tamanho=$((SIZE/1048576)) MB duração=$(( $(date +%s) - START ))s"

# --- retenção ---------------------------------------------------------------
mapfile -t OLD < <(ls -1t "$DEST"/"${PREFIX}"_*.dump 2>/dev/null | tail -n +$((KEEP+1)))
for f in "${OLD[@]:-}"; do
  [ -n "$f" ] || continue
  rm -f -- "$f" && log "retenção: removido $(basename "$f")"
done
log "fim: $(ls -1 "$DEST"/"${PREFIX}"_*.dump | wc -l) dump(s) de $PREFIX mantidos (limite $KEEP)"
