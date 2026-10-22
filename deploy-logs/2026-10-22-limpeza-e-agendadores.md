# 22/10/2026 — Agendadores da Hub, limpeza da VPS e backups

Autorização do usuário: executar as etapas na ordem, sem confirmação uma a uma, parando em qualquer verificação que falhe. Sem credenciais neste arquivo (senhas comparadas por hash quando necessário, nunca exibidas).

VPS `187.77.232.164` (Debian 13, Postgres 17.11, pm2 6). Hub API = pm2 `mavrion-api` em `/var/www/mavrion-api`.

Espaço em disco no início: `/dev/sda1 197G, usados 142G, livres 48G (76%)`.

---

## Etapa 1 — Agendadores

### 1a. O que o upsert da importação SICAR sobrescreve

Código: `hub-api/src/index.cjs`, função de persistência do import (`INSERT INTO sicar_imoveis_cache … ON CONFLICT (cod_imovel, uf) DO UPDATE SET`). Colunas atualizadas no conflito — **somente estas**:

`municipio, num_area, ind_status, ind_tipo, dat_criacao, data_atualizacao, condicao, cod_municipio_ibge, m_fiscal, geometry, properties, geom, fetched_at`

(há um segundo UPSERT idêntico usado como fallback quando a geometria é inválida — mesma lista, com `geom = NULL`).

**Preservadas** (não aparecem no `DO UPDATE`): `alt_media, alt_min, alt_max, centroid_lat, centroid_lon, perimetro_km, declividade, temp_media, precip_anual, argila_pct, areia_pct, silte_pct, ph_agua, carbono_organico, densidade_aparente, nitrogenio_solo, argila_0_30, argila_30_60, argila_60_100, argila_media, anm_status, anm_processos_count, anm_processos_json, anm_outros_layers_count, anm_barragens_count, anm_barragens_json, anm_processed_at`. A tabela `sicar_anm_enrichment` não é tocada pela importação.

Verificações adicionais: nenhum `DELETE`/`TRUNCATE` de `sicar_imoveis_*` no fluxo de importação; nenhum trigger nas partições (`pg_trigger` vazio para `sicar_imoveis%`).

Ressalvas (não são sobrescrita, mas convém saber):
- `geom` **é** substituída pela geometria atual do SICAR. Se o perímetro de um imóvel mudou no CAR, as colunas calculadas ficam com o valor antigo (derivado da geometria anterior) — ficam preservadas, mas desatualizadas; `fetched_at` muda e `data_atualizacao` do SICAR permite detectar isso depois.
- Imóveis **novos** entram com as colunas calculadas vazias; o watchdog de altitude (6/6 h) religa o worker de altitude para eles, e o anti-join do enriquecimento ANM os pega sozinho. Argila/OpenLandMap continuam parados (sem auto-start).
- Última rodada dessas UFs (14/08): BA 1.307.878 imóveis em 53 min, AL 143.338 em 6 min, 0 erros. Partições das 9 UFs de sexta somam ~9,3 GB; o upsert reescreve cada linha (dead tuples até esse volume até o autovacuum passar) — com os 34 GB da `sicar_imoveis_old` liberados na Etapa 2, há folga.

### 1b. Decisão

Preserva → **as 9 rotinas de sexta ficaram ativas** (ids 49–57, `0 0 * * 5` em America/Sao_Paulo, `proxima_execucao = 2026-10-23 03:00 UTC`). Nenhuma alteração em `sicar_import_schedule`.

### 1c. Merge + publicação do retry dos agendadores

- Branch `fix/agendador-retry` (commit `8b9fac8`): o bootstrap testa `SELECT 1`; se o banco não responder, sobe o servidor e tenta carregar `initScheduler` + auto-resume a cada 15 s até conseguir (antes rodava uma única vez e desistia em silêncio).
- GitHub: `POST /merges` `fix/agendador-retry` → `main`. `main` passou de `32a5b95` para `e3ed8e7`. Localmente, `cherry-pick -x 8b9fac8` sobre o `main` do workspace (`f237f9d`).
- Build: `cd hub-api && node build.mjs` → `dist/index.cjs` md5 `dfa011fd93bcbe47aa3d9432e885b77d` (sintaxe válida, conjunto de rotas idêntico ao fonte). Antes do merge, o build do fonte atual (`2b8c4ef2…`) era **byte a byte igual** ao bundle em produção — confirma que o fonte do workspace é a verdade.
- Testes: `node --test hub-api/tests/*.test.cjs` → 12/12 pass (inclui `boot-agendadores-retry.test.cjs`).
- Teste local do caminho novo: bundle executado no workspace com `DATABASE_URL` apontando para porta fechada → logou `[boot] Banco indisponivel; agendadores serao carregados quando ele responder (nova tentativa a cada 15 s)`, continuou subindo, `/api/health` respondeu 503 `database: disconnected` e o processo seguiu vivo com o laço de 15 s (antes, esse cenário deixava o processo sem nenhum cron para sempre).
- Pré-condições na VPS: nenhuma importação SICAR `running` (`sicar_import_log`), nenhum auto-resume pendente. O worker de enriquecimento ANM estava rodando (últimas linhas do error log são dele) — morre no restart, como sempre; o guardião religa na janela dele.
- Backup do bundle em produção: `/var/www/mavrion-api/dist/index.cjs.bak_20261022T162741Z` (md5 `2b8c4ef2579161b517af96106f5539ab`, igual ao que estava no ar).
- Publicação 16:28:10 UTC: `scp` do novo bundle, `node --check` OK, `mv` para `dist/index.cjs`, `pm2 restart mavrion-api --update-env`, **`pm2 save`** (dump atualizado com o processo correto).
- Confirmação no log (`mavrion-api-out-25.log`, boot 16:28:13 UTC):
  ```
  Verificando conexao com o banco de dados...
  Conexao com banco estabelecida
  Banco de dados ja esta inicializado
  Scheduler SICAR inicializado: 27 rotina(s) ativa(s)
  [Module Scheduler] 5 agendamento(s) de modulo carregado(s)
  [SICAR Import] Auto-resume: nenhuma importação interrompida encontrada.
  4:28:13 PM [express] serving on port 5002
  ```
- Smoke test (JWT admin da VPS): `/api/health`, `/api/health/modules`, `/api/sicar/stats`, `/api/anm/processos?limit=1`, `/api/sicar/schedules` → todos **200**.

**Rollback** (se necessário):
```bash
cp /var/www/mavrion-api/dist/index.cjs.bak_20261022T162741Z /var/www/mavrion-api/dist/index.cjs && pm2 restart mavrion-api --update-env && pm2 save
```

Observação colateral: `rotinas/logs/anm-enrich-guard.log` mostra `ERRO: The operation was aborted due to timeout` às 14:03, 14:33 e 15:03 UTC de hoje (a consulta de status do enriquecimento — COUNT anti-join — estourou o timeout do guardião). Pré-existente, não tratado aqui.

## Etapa 2 — `sicar_imoveis_old` (34 GB) apagada

Espaço antes: 48 GB livres (76% usado).

### 2a. Dependências — nenhuma
- Catálogo (`mavrion_api_db`): nenhuma FK apontando para ela nem partindo dela (`pg_constraint`); nenhuma view/regra dependente (`pg_depend`×`pg_rewrite`); nenhum trigger; nenhuma função com `sicar_imoveis_old` no corpo (`pg_proc`); não é partição nem pai de herança (`relkind=r`, `relispartition=f`, `pg_inherits` vazio). Só os próprios índices (29, apagados junto). Tamanho: heap 25 GB + índices 8,9 GB = 34 GB.
- Código: zero ocorrências em `hub-api/src`, `server/`, `shared/`, `vps-rotinas/` do workspace (só um comentário histórico em `hub-api/migrations/2026-08-13-anm-enrich-functional-indexes.sql`); na VPS, zero em `/var/www/mavrion-api/dist/index.cjs`, `rotinas/`, `/var/www/mavrion-conect/{dist,server,shared}`, crontab, `/etc/cron.d`.

### 2b. Comparação com as partições (consulta somente leitura, 4 min 17 s)
| | |
|---|---|
| Total em `sicar_imoveis_old` | **8.220.454** |
| Total em `sicar_imoveis_cache` (28 partições) | **8.471.107** |
| `(cod_imovel, uf)` da old que NÃO estão na cache | **0** |

### 2c. Esquema salvo
`/root/backups/sicar_imoveis_old_schema_20261022.sql` (5,9 KB, `pg_dump --schema-only`, 17 comandos CREATE — tabela + índices).

### 2d. DROP
Momento: 16:35:56 UTC (13:35 BRT). Atividade no servidor: 7 requisições em 10 min no nginx, load 3,4 (manutenção de tabelas pós-boot da Hub + StatsCache), nenhum lock na tabela. `SET lock_timeout='5s'; DROP TABLE sicar_imoveis_old;` → 1,7 s. Sem VACUUM/ANALYZE (não necessário).

| | Livre | Uso |
|---|---|---|
| Antes | 50,5 GB (48 GiB) | 76% |
| Depois | **86,8 GB (81 GiB)** | **58%** |

### 2e. Testes pós-DROP (todos 200)
`/api/health` (`database: connected`), `/api/sicar/stats` (8.471.107 imóveis), `/api/sicar/GO-5212600-E6BB…` (imóvel completo).

Observação: logo após o restart da Etapa 1 a Hub executa a manutenção de tabelas em segundo plano (`ALTER TABLE sicar_solo_openlandmap ADD COLUMN IF NOT EXISTS …`, consultas de anti-join); isso é comportamento de boot, não desta etapa, e não toca em dados.

## Etapa 3 — Backups do Postgres

Espaço antes: 86,8 GB livres (58%).

Script: `vps-rotinas/backup-postgres.sh` (branch `ops/backups-e-logrotate` — ver correção no fim deste arquivo), instalado em `/var/www/mavrion-api/rotinas/backup-postgres.sh`. Roda como root e autentica como usuário de sistema `postgres` (peer) — **nenhuma senha** no script, no cron ou nos logs. Formato `pg_dump -Fc -Z 6` (compactado; restaura com `pg_restore`). Antes de gravar: exige livre ≥ 3× o tamanho estimado (tamanho das relações no banco, que superestima o dump); grava em `.part` e só renomeia após `pg_restore -l` validar o arquivo; registra tamanho e duração em `backup.log`; sai com 1 em qualquer falha (saída do cron em `cron.log`).

### 3a. Diário — `mavrion_conect` (usuários, insubstituível)
- Cron: `15 2 * * *` UTC (23:15 BRT), retenção **7**.
- Execução de teste 16:37 UTC: estimado 3.730 MB, livre 82.930 MB (≥ 3× ok) → `mavrion_conect_20261022_163707.dump` = **411 MB** em 74 s.
- **Teste de restauração**: `createdb restore_test_tmp_20261022` → `pg_restore --no-owner --no-privileges` em 1 min 53 s, **0 erros**; 55 tabelas na origem e 55 no restaurado; contagens das 6 maiores tabelas iguais (`pgfn_divida_ativa` 3.497.760, `cfem_arrecadacao` 294.277, `tah_titulares` 270.779, `error_reports` 1.410, `sigbm_barragens` 908, `asset_verificacoes` 40); banco restaurado com 3.502 MB. Em seguida `dropdb restore_test_tmp_20261022` → nenhum banco `restore_test%` restante.

### 3b. Semanal — tabelas não regeneráveis da Hub (`mavrion_api_db`)
- Tabelas: `api_users, agro_entities, cardmv_leads, agrofit_*, farmway_*, module_schedules, sicar_import_schedule, anm_barragens` (15 tabelas no dump: agro_entities, agrofit_fabricantes, agrofit_import_log, agrofit_indicacoes, agrofit_ingredientes, agrofit_produtos, anm_barragens, api_users, cardmv_leads, farmway_categorias, farmway_fabricantes, farmway_modelos, farmway_scrape_log, module_schedules, sicar_import_schedule).
- Cron: `45 2 * * 0` UTC (domingo 23:45 BRT de sábado), retenção **4**.
- Execução de teste 16:40 UTC: estimado 262 MB → `hub_nao_regeneraveis_20261022_164046.dump` = **32 MB** em 7 s.

### 3c. Espaço e tamanho
Checagem de 3× embutida no script (acima). Dumps atuais: 411 MB + 32 MB. Projeção de ocupação em regime: 7 × ~0,4 GB + 4 × ~0,03 GB ≈ **3 GB**.

### 3d. Caminho para a cópia externa
```
/root/backups/postgres/            (dir 700, dumps 600, root)
  mavrion_conect_<AAAAMMDD_HHMMSS>.dump        diário, 7 mais recentes
  hub_nao_regeneraveis_<AAAAMMDD_HHMMSS>.dump  semanal, 4 mais recentes
  backup.log / cron.log
/root/backups/sicar_imoveis_old_schema_20261022.sql   (esquema da tabela apagada)
/root/backups/logs-20261022/mavrion-api-error-25.ultimas50k.log.gz (ver Etapa 4a)
```
Sugestão para a cópia: `rsync -az --delete root@187.77.232.164:/root/backups/postgres/ <destino>/` depois das 03:00 UTC.

Incidente corrigido na instalação do cron: a primeira tentativa de acrescentar as entradas colou as 3 linhas novas no fim da linha do `token-renew.cjs` (sem `\n`). Detectado na conferência imediata (`crontab -l | wc -l` continuou 11) e corrigido reinstalando a crontab com as 14 linhas corretas antes de qualquer disparo (o `token-renew` só roda às 08:00 UTC); `install-cron.sh` passou a usar `printf '%s\n'` para não repetir isso.

## Etapa 4 — Limpeza

Espaço antes: 86,8 GB livres (58%).

### 4a. Rotação de logs
- `pm2-logrotate` **não** instalado (módulo pm2 + um processo a mais); usado o `logrotate` do sistema: `/etc/logrotate-mavrion.conf` (versionado em `vps-rotinas/logrotate-mavrion.conf`), cobrindo `/root/.pm2/logs/*.log`, `/var/log/mavrion/*.log` e `/var/log/norion-site.log`: `daily` + `maxsize 100M`, `rotate 7`, `compress`/`delaycompress`, `copytruncate` (pm2 mantém os arquivos abertos; truncar no lugar não exige restart). Executado de hora em hora (`7 * * * *`) com estado próprio `/var/lib/logrotate/status-mavrion`, para que o limite de 100 MB valha dentro do dia. Simulação (`-d`) sem erros; primeira execução real só registrou o estado dos 123 arquivos (o logrotate não rotaciona na mesma hora em que criou o estado) — conferido às 17:08 UTC: a rodada do cron das 17:07 executou sem erro e não rotacionou nada, corretamente (o maior arquivo restante, `app-41.log`, tem 97,7 MiB < 100 MiB; os truncados estão perto de zero). A primeira rotação real será a diária, às 00:07 UTC de 23/10.
- Truncados (`truncate -s 0`, arquivos preservados; pm2 continuou escrevendo normalmente — conferido no `out-25.log` logo depois):

| Arquivo | Antes |
|---|---|
| `/root/.pm2/logs/mavrion-api-error-25.log` | 842 MB |
| `/var/log/mavrion/app-3.log` | 574 MB |
| `/var/log/mavrion/out-3.log` | 573 MB |
| `/var/log/mavrion/app-45.log` | 375 MB |
| `/var/log/mavrion/out-45.log` | 375 MB |

Antes de truncar o error log da Hub, as últimas 50.000 linhas foram guardadas em `/root/backups/logs-20261022/mavrion-api-error-25.ultimas50k.log.gz` (116 KB) — é a única evidência do problema dos agendadores investigado hoje; apague quando não precisar mais. `/root/.pm2/logs` passou de 857 MB para 53 MB; `/var/log/mavrion` de 2,1 GB para 256 MB.

### 4b. Backups de bundle
- Nenhuma referência aos diretórios/arquivos antigos em nginx, systemd, `dump.pm2`, crontab, scripts `.sh` ou rotinas; os 4 processos pm2 apontam para `dist/index.cjs` de cada app.
- **Hub** (`/var/www/mavrion-api/dist/`): mantidos `index.cjs.bak_20261022T162741Z` (pré-deploy de hoje) e `index.cjs.bak_20261022_042428`. Removidos 11: `index.cjs.bak`, `bak_20260813_190734`, `bak_prepatch_20260813_193058`, `bak_prepatch_20260813_202546`, `bak_20260813_203756`, `bak_keyrot_20260813_204516`, `bak_20260813_205024`, `bak_ssrot_20260813_205107`, `bak_20260813_205911`, `pre-dados-confiaveis-20261021T223316Z`, `pre-sshpass-env`.
- **Connect** (`/var/www/mavrion-conect/`): mantidos `dist.pre-validacoes-20261022T023314Z` e `dist.pre-dados-confiaveis-20261021T222839Z`. Removidos 15: `dist-backup`, `dist.backup_20260312_052106`, `dist.badpdfbuild_20260713`, `dist.bak_20260813_144452`, `dist.bak_20260813_160649`, `dist.bak_20260814_194744`, `dist.bak_20260819_230242`, `dist.bak_20260820_135137`, `dist.bak_dossie_20260813_1859`, `dist.bak_iaprompts_20260813_2126`, `dist.bak_lote_20260813_1715`, `dist.bak_pdf_20260713_180721`, `dist.bak_scm_20260813_1638`, `dist.bak_sigef_20261021_050217`, `dist.pre-mavrion-f7dcaab-20261021T195746Z`. Pasta: 2,2 GB → 1,2 GB.
- Pós-remoção: `https://mavrionconnect.com.br/` 200, `/api/health` da Hub 200.

### 4c. Arquivos soltos
Nenhum em uso por processo (`lsof` = 0 para todos) e nenhuma citação em crontab, `/etc/cron.d`, systemd, scripts `.sh` do Connect, bundle do Connect ou rotinas. Removidos **sem ler o conteúdo** (1,3 GB no total):
`/tmp/pgfn_nao_previdenciario.zip` (1,34 GB), `/tmp/connect-pgfn-fixed.cjs`, `/tmp/connect-sigef-fixed.cjs`, `/var/www/mavrion-conect/cookie`, `cookies.txt`, `cookies2.txt`, `.env.bak_20260814205057`, `.env.bak_keyrot_20260813_204516`.

### 4d. Não tocados
Bancos/pastas do Tato e do Norion, `cog_argila`, `srtm_tiles`, `sicar_solo_openlandmap`, `sicar_calc_backup_2026_10_21`, SSH e firewall — nenhum comando dirigido a eles. (A rotação de logs inclui os logs pm2 do Norion em `/root/.pm2/logs` porque o diretório foi pedido inteiro; são só logs, nenhum dado.)

## Etapa 5 — Resumo

| Etapa | Livre antes | Livre depois | Variação |
|---|---|---|---|
| 1. Agendadores | 48 GiB | 48 GiB | 0 |
| 2. DROP `sicar_imoveis_old` | 48 GiB (76%) | 81 GiB (58%) | **+33 GiB** |
| 3. Backups | 81 GiB | 80 GiB | −0,45 GiB (dumps) |
| 4a. Truncar logs | 80 GiB | 82 GiB | +2,6 GiB |
| 4b. Bundles antigos | 82 GiB | 83 GiB | +1,1 GiB |
| 4c. Arquivos soltos | 83 GiB | **84 GiB (56%)** | +1,3 GiB |

Total: **48 GiB → 84 GiB livres** (142 GiB → 106 GiB usados). pm2: 4 processos `online`, sem restarts inesperados.

**Falhas**: nenhuma verificação falhou. Um erro de execução (crontab colada sem `\n`) foi detectado e corrigido na hora, antes de qualquer efeito.

**Depende do usuário**:
1. Configurar a cópia externa de `/root/backups/postgres/` (caminho e sugestão de `rsync` na Etapa 3d).
2. Decidir quando apagar `/root/backups/logs-20261022/` (116 KB, evidência do incidente dos agendadores) e `/root/backups/sicar_imoveis_old_schema_20261022.sql`.
3. Conferir amanhã a importação SICAR das 9 UFs (sexta 03:00 UTC): `sicar_import_log` e, depois dela, se as colunas calculadas continuam preenchidas em uma amostra (ex.: `SELECT count(*) FILTER (WHERE alt_media IS NULL) FROM sicar_imoveis_ba WHERE fetched_at > now() - interval '1 day'`).
4. Revisar/mesclar a branch `ops/backups-e-logrotate` (script de backup, config do logrotate, `install-cron.sh`, README) — PR aberto após a correção abaixo.
5. Pré-existente e fora do escopo: timeouts do `anm-enrich-guard` (14:03/14:33/15:03 UTC) e as 3 "mortes silenciosas" do boot da Hub (investigação em `docs/investigacao-scheduler-hub-2026-10-22.md`).

---

## Correção (22/10, 19:5x UTC) — arquivos que faltavam na branch

O relatório acima dizia que `backup-postgres.sh` e `logrotate-mavrion.conf` estavam na branch `ops/backups-e-logrotate`. **Não estavam.** O commit `50b5006` subiu só `README.md` e `install-cron.sh`, e ambos na versão **antiga** (sem as entradas de backup/logrotate e sem o `printf`). Causa: a publicação via API leu os arquivos da árvore de trabalho quando ela estava na `main` local (os dois arquivos novos não existiam ali e as edições estavam só na branch), e o código não checou o resultado da leitura. Detectado pelo usuário ao conferir o GitHub.

Correção aplicada:
- Conferido byte a byte que o instalado na VPS é igual ao da branch local: `backup-postgres.sh` md5 `da6db488…`, `/etc/logrotate-mavrion.conf` md5 `b35f3ae6…`.
- `install-cron.sh` na VPS ainda era o de 13/08 (nunca tinha sido atualizado lá); substituído pela versão com as entradas de backup/logrotate e `printf` (md5 `b86ca9bd…`), executado em seguida: 10× "já agendado", crontab inalterada (mesmo md5 antes/depois, 14 linhas).
- Commit **`7126c2e9274df3466242043820e175ccef23c4b6`** na `ops/backups-e-logrotate` (4 arquivos: +121/−5). Prova via `git fetch` do GitHub e `git ls-tree -r --name-only github/ops/backups-e-logrotate | grep -E "backup-postgres|logrotate|install-cron"` → `vps-rotinas/backup-postgres.sh`, `vps-rotinas/install-cron.sh`, `vps-rotinas/logrotate-mavrion.conf`; md5 dos três no GitHub idênticos aos da VPS; `bash -n` OK nos dois `.sh`.
