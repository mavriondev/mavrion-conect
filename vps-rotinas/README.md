# Rotinas sidecar da Mavrion Hub API (VPS)

Cópia versionada dos scripts implantados em `/var/www/mavrion-api/rotinas/` no VPS
`187.77.232.164` (api.mavrionconnect.com.br, pm2 `mavrion-api`, porta 5002).

**Contexto**: o fonte completo do bundle de produção (`dist/index.cjs`, build 21/03/2026)
não existe no VPS — é proibido rebuildar. Estas rotinas são *sidecars* independentes que
usam o Node e o `pg` do próprio `node_modules` da API e escrevem direto no Postgres
(`DATABASE_URL` do `.env` da API; a senha contém `@` sem URL-encoding, por isso o parse
divide no **último** `@`).

| Script | Agenda (cron do sistema, UTC) | O que faz |
|---|---|---|
| `anm-sigmine-sync.cjs` | Domingo 05:15 | Reimporta SIGMINE/ANM (~269k processos c/ geometria) via FeatureServer `geo.anm.gov.br` usando apenas `where=1>0` + `objectIds` (WAF bloqueia aspas e `1=1`). Staging + swap transacional em `anm_processos`. Ao fim, re-enfileira os cruzamentos ANM×SICAR afetados (ver abaixo). |
| `funai-tis-sync.cjs` | Dia 2, 05:45 | Sincroniza Terras Indígenas do geoserver do **CMR/FUNAI** (`CMR-PUBLICO:lim_terra_indigena_a`) — o WFS oficial da FUNAI responde 403 desde ago/2026. Preserva `dominio_uniao` antigo; loga em `funai_sync_log`. |
| `cprm-geologia-sync.cjs` | Dia 3, 04:30 | Reimporta geologia 1:2.500.000 do SGB via **MapServer** (a extensão FeatureServer do geoportal quebrou e devolve 0 ids). Staging + swap em `cprm_geologia`; loga em `cprm_sync_log`. |
| `cprm-recursos-sync.cjs` | Dia 3, 05:15 | Reimporta as ~36,5k ocorrências minerais do SGB via **MapServer** (`geologia/ocorrencias/MapServer/0`). Staging + swap em `cprm_recursos_minerais`; loga em `cprm_sync_log` (tipo `recursos`). |
| `altitude-watchdog.cjs` | A cada 6h (:20) | Se há imóveis SICAR com `alt_media NULL` e `geom NOT NULL` (>100), religa o worker interno via `POST /api/sicar/altitude/start` (login com credenciais do `.env` do Connect). |
| `token-renew.cjs` | Diário 08:00 | Renova o JWT admin (`rotinas/.token`, validade 7d) quando faltam <4 dias: `POST /api/auth/refresh` com o token atual; fallback re-login com `MAVRION_API_USER/PASS` do `.env` do Connect; grava atomicamente (tmp+rename) só após validar em `/api/auth/me`. Falha total vira alerta deduplicado em `error_reports` (type `vps_rotina_stale`, module `hub_api_token`); auto-resolve ao renovar. Teste manual: `--force`. |
| `freshness-check.cjs` | Diário 08:30 | Compara o último sync **bem-sucedido** de cada módulo com o prazo esperado (ANM >8d; FUNAI/CPRM geologia/CPRM recursos >35d; backlog altitude >200k). Módulo estourado vira alerta deduplicado (1/dia) em `error_reports` (type `vps_rotina_stale`) no banco do **Connect**; o scheduler do Connect notifica o sino do app. Upstream instável com dado antigo preservado não gera falso positivo — só a ausência prolongada de sucesso dispara. Teste manual: `--test-module=<id>`. |
| `anm-enrich-guard.cjs` | A cada 10 min | Guardião do enriquecimento ANM×SICAR (8,4 mi imóveis): pausa a fase `enriching` se load(1min)>4,2; retoma se foi ele que pausou (marker em `/tmp`) e load(5min)<3; inicia na janela 03–09 UTC (00–06 BRT) se houver pendências (cobre pm2 restart, que mata o worker); detecta roda-livre (contador parado + erros crescendo → para e NÃO retoma até a fila andar). Fora disso sai sem tocar na API — o `status` faz COUNT pesado. |
## Decisões importantes
- **Re-enfileiramento seletivo pós-sync ANM** (task 146): `sicar_anm_enrichment` é um
  retrato do momento e a fila do enrich é o anti-join com `sicar_imoveis_cache` — imóvel
  com linha nunca é recalculado. Por isso o `anm-sigmine-sync.cjs`, ANTES do swap, faz um
  diff staging×atual (atributos + `md5(ST_AsBinary(geom))`) em `anm_sync_requeue`
  (novos/alterados com geom do staging; removidos com a geom antiga, tudo já em 4326) e,
  APÓS o swap, deleta de `sicar_anm_enrichment`:
  (a) quem cita um processo do diff no `anm_processos_json` (varre só `anm_processos_count > 0`, indexado);
  (b) quem intersecta a geometria de um processo do diff (join espacial usando os índices
  gist `idx_<uf>_geom` das partições `sicar_imoveis_<uf>` — cobre imóveis recém-cobertos).
  Diff > 50k processos (`REQUEUE_SPATIAL_CAP`) cai no fallback barato: deleta só
  `anm_processos_count > 0`; os recém-cobertos entram no diff da semana seguinte.
  Quem RETOMA a fila é o `anm-enrich-guard.cjs` na janela 03–09 UTC com load < 4 — o sync
  nunca inicia o worker. Falha no requeue não desfaz o swap: loga `REQUEUE FALHOU` e sai 1.
  Validado em produção (13/08): diff sintético de 2 processos → 215 imóveis re-enfileirados
  em ~8 s total.
- **Enriquecimento ANM×SICAR viabilizado por índice funcional** (13/08): o worker consulta
  `ST_Intersects(ST_Transform(geom,4326), …)` — sem `idx_anm_processos_geom_4326`
  (gist funcional) cada imóvel custava ~815 ms de seq scan e o load ia a ~10. Com o índice:
  ~0,4 ms. O swap semanal do sidecar ANM é `DELETE`+`INSERT`, então o índice sobrevive.
  Throttle do worker virou env no `.env` da API: `ANM_ENRICH_CONCURRENCY=3`,
  `ANM_ENRICH_BATCH=1000`, `ANM_ENRICH_SLEEP_MS=150` — knobs vivem no fonte
  versionado (`hub-api/src/index.cjs`, deploy via `hub-api/DEPLOY.md`); índices
  em `hub-api/migrations/` e no boot da API (IF NOT EXISTS).
- **FK órfã removida de `sicar_anm_enrichment`** (13/08): o particionamento do SICAR
  renomeou a tabela antiga para `sicar_imoveis_old` e a FK foi junto (por OID). Imóveis
  novos violavam a FK e o worker de enrich girava em loop infinito de erro. Removida via
  `hub-api/migrations/2026-08-13-anm-enrich-functional-indexes.sql`; não recriar.
- **ANM interno quebrado pelo WAF**: o importador do bundle checa contagens remotas com
  `where=UF='XX'` (aspas → 403 → catch → -1) e conclui que toda UF está "completa",
  pulando tudo. Por isso o sidecar substitui a rotina interna (que continua existindo,
  mas inofensiva).
- **FUNAI interno silenciado**: `FUNAI_SYNC_ENABLED=false` no `.env` da API (retry
  interno de 7 dias) + `module_schedules id=5 ativo=false` (cron mensal interno).
- **ICMBio interno mantido ativo**: o HTTP 400 de 01/08 era transiente do INDE; o sync
  interno funcionou normalmente em 13/08 (347 UCs). Nenhum sidecar necessário.
- **CPRM/SGB interno**: continua agendado (retorna "0 unidades" sem truncar — inofensivo),
  mas quem mantém o dado fresco é o sidecar via MapServer. `module_schedules id=6`
  desativado para reduzir ruído; item 7 (`sgb_geologia`) não foi tocado.
- **sicar_imoveis_cache é tabela-mãe particionada** das `sicar_imoveis_<uf>` — o worker
  de altitude enxerga todas as pendências por ela. Os 18 tiles SRTM "pulados" são oceano
  (CGIAR não os publica) e nenhum imóvel pendente precisa deles.

## Rollback
- Backups pré-mudança (13/08/2026): `dist/index.cjs.bak_20260813_190734`,
  `dist/index.cjs.bak_prepatch_*`, dumps gzip das tabelas em
  `/var/www/mavrion-api/rotinas/backups/` e `.env.bak_*`.
- Para reverter o patch do bundle: `cp dist/index.cjs.bak_prepatch_<ts> dist/index.cjs && pm2 restart mavrion-api`.
- Para desativar uma rotina: remova a linha correspondente do `crontab -e` do root.

Ver detalhes completos no deploy-log: `deploy-logs/2026-08-13-vps-hub-api-rotinas.md`.
