# 2026-10-22 — Deploy: rodovia/ferrovia BC250 (Connect) + proxy /api/vps sem SSH (Hub)

Autorizado pelo usuário em 22/10/2026 ("sim e no git"). Relatório técnico: `docs/relatorio-rodovia-declividade-ssh-2026-10-22.md`.

## Connect (`mavrion-conect`, porta 5000)
- Build **só do server** no workspace (esbuild, mesma configuração de `script/build.ts`), sem tocar `dist/public`.
- Pré-checagens: 190 rotas = 190 rotas (diff vazio), `require()` externos idênticos (37), sem dependência nova → sem `npm install` na VPS; cron de auto-deploy continua desativado.
- Backup: `dist/index.cjs.bak_20261022_042428` (sha `9a08de65b9e95929…`). Novo bundle sha `7fb0117ea19ac617…`.
- `pm2 restart mavrion-conect --update-env`: online, restarts 8→9 (só o próprio restart), uptime crescendo; `http://localhost:5000/` 200, `https://mavrionconnect.com.br/` 200, `/api/user` 401 (esperado sem sessão); sem erro novo em `/var/log/mavrion/error-3.log`.
- Rollback: `cd /var/www/mavrion-conect && cp dist/index.cjs.bak_20261022_042428 dist/index.cjs && pm2 restart mavrion-conect`.

## Hub (`mavrion-api`, porta 5002)
- Backup: `dist/index.cjs.bak_20261022_042428` (sha `5d63b6717098bf1f…`). Novo bundle sha `6b0fa3dc28b085be…`; `node --check` OK; conjunto de rotas idêntico.
- `pm2 restart ecosystem.config.cjs --only mavrion-api --update-env`: online, restarts 3→4, uptime crescendo.
- Smoke (JWT admin da VPS): `/api/health/modules`, `/api/sicar/stats`, `/api/anm/processos?limit=1`, `/api/funai/status` → 200; **`/api/vps/altitude/status` e `/api/vps/opengeohub/status` → 200** (antes: "VPS não configurado"). Env do pm2 sem `VPS_HOST/VPS_USER/VPS_PASSWORD`.
- Espelho do fonte na VPS sincronizado: `/var/www/mavrion-api/fonte` commit `50a0c20`.
- Rollback: `cd /var/www/mavrion-api && cp dist/index.cjs.bak_20261022_042428 dist/index.cjs && pm2 restart mavrion-api`.
- Lembrete: o restart derruba o worker de altitude em memória; o watchdog religa em até 6 h.

## Incidente durante o deploy
O container de desenvolvimento do Replit reiniciou no meio do comando de deploy da Hub (sessão SSH caiu após o `mv` do bundle). Ao reconectar: bundle novo no lugar, pm2 já reiniciado, smoke OK. O `known_hosts` do container se perdeu no reinício e foi recriado por `ssh-keyscan` (ED25519 `SHA256:LI/XolyfnguiRGRK3+e706SgUkPqD2Tp4InVibbZJDs`).

## Git
- Branch `fix/rodovia-declividade-ssh` publicada no GitHub a partir da `main` (`f679e3e`) e integrada à `main` por fast-forward (sem force-push).
