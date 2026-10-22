# Deploy da Hub API sem regredir

Produção: `root@187.77.232.164`, app pm2 `mavrion-api`, `/var/www/mavrion-api`.
O pm2 executa `dist/index.cjs` (ver `ecosystem.config.cjs`). O `.env` de lá tem
os kill-switches `FUNAI_SYNC_ENABLED=false` / `CPRM_SYNC_ENABLED=false` — não
remover sem motivo.

## 1. Corrigir um bug

1. Editar `hub-api/src/index.cjs` neste workspace (fonte de verdade).
   - Localize o trecho pela string da rota ou mensagem de log.
   - Commitar no git do workspace.
2. Buildar: `cd hub-api && node build.mjs`
   - Gera `dist/index.cjs`; o script já valida sintaxe e que o conjunto de
     rotas não mudou (se você ADICIONOU rota de propósito, o aviso de rotas
     diferentes é esperado — confira o diff e siga).

## 2. Publicar (com backup e rollback)

Autenticação: o `sshpass -e` lê a senha da variável `SSHPASS` — exporte-a a
partir do secret `VPS_SSH_PASSWORD` antes de qualquer comando (todos os blocos
abaixo assumem isso):

```bash
export SSHPASS="$VPS_SSH_PASSWORD"
```

```bash
export SSHPASS="$VPS_SSH_PASSWORD"
TS=$(date +%Y%m%d_%H%M%S)
# backup do que está no ar
sshpass -e ssh root@187.77.232.164 \
  "cp /var/www/mavrion-api/dist/index.cjs /var/www/mavrion-api/dist/index.cjs.bak_$TS"
# publicar
sshpass -e scp hub-api/dist/index.cjs root@187.77.232.164:/var/www/mavrion-api/dist/index.cjs
sshpass -e ssh root@187.77.232.164 "cd /var/www/mavrion-api && node --check dist/index.cjs && pm2 restart mavrion-api"
```

## 3. Smoke test (todos devem dar 200)

A API exige autenticação (sem token os endpoints retornam 401). Use o JWT
admin do VPS (`/var/www/mavrion-api/rotinas/.token`, stateless, sobrevive a
restart) — rodando direto no VPS:

```bash
export SSHPASS="$VPS_SSH_PASSWORD"
sshpass -e ssh root@187.77.232.164 'T=$(cat /var/www/mavrion-api/rotinas/.token);
for p in /api/health/modules /api/sicar/stats /api/anm/processos?limit=1 /api/funai/status; do
  curl -s -o /dev/null -w "%{http_code} $p\n" -H "Authorization: Bearer $T" "https://api.mavrionconnect.com.br$p"; done'
```

Todos devem retornar 200.
Lembrete: restart do pm2 mata workers em memória (altitude/enrich) — o
watchdog religa o de altitude em até 6 h, ou `POST /api/sicar/altitude/start`.

## 4. Rollback

```bash
export SSHPASS="$VPS_SSH_PASSWORD"
sshpass -e ssh root@187.77.232.164 \
  "cp /var/www/mavrion-api/dist/index.cjs.bak_<TS> /var/www/mavrion-api/dist/index.cjs && pm2 restart mavrion-api"
```

## 5. Manter o espelho do VPS em dia

Depois de publicar, sincronize o repo git espelho do VPS:

```bash
export SSHPASS="$VPS_SSH_PASSWORD"
sshpass -e scp hub-api/src/index.cjs root@187.77.232.164:/var/www/mavrion-api/fonte/src/index.cjs
sshpass -e scp hub-api/migrations/*.sql hub-api/migrations/README.md root@187.77.232.164:/var/www/mavrion-api/fonte/migrations/
sshpass -e ssh root@187.77.232.164 "cd /var/www/mavrion-api/fonte && git add -A && git commit -m 'sync do workspace'"
```

Mudanças de schema/índice em banco já populado NÃO vão no boot da API: crie um
arquivo idempotente em `hub-api/migrations/` (ver `migrations/README.md`) e rode
com `psql -f` no VPS.

## Nunca fazer

- Rebuildar a partir de `/var/www/mavrion-api/server/` (cópia parcial antiga —
  regride ~97 rotas).
- Editar `dist/index.cjs` direto no VPS (volta a ser cirurgia sem fonte).
- Abrir o log de erro do pm2 inteiro (300+ MB) — sempre `tail -c`.
