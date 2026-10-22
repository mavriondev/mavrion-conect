# Inventário — VPS e Hub API (somente leitura)

Data: 22/10/2026, 04:45–05:15 UTC. Host `srv1459960` (187.77.232.164), Debian 13, QEMU, 4 vCPU, 15 GB RAM, sem swap, 1 disco de 200 GB. **Nada foi apagado, movido, reiniciado ou alterado.** Consultas ao Postgres com `default_transaction_read_only=on`; arquivos temporários usados para as consultas foram removidos de `/tmp` ao final de cada passo. Nenhuma credencial consta deste arquivo (variáveis só por nome).

Fontes de verdade usadas: disco da VPS (`du`, `ls`, `stat`), `pm2`, crontab, `.env` (só nomes), Postgres (`pg_class`, contagens reais), logs do pm2 e das rotinas, e o fonte recuperado da Hub (`hub-api/src/index.cjs`, idêntico em rotas ao bundle publicado).

---

## PARTE A — O que está no disco da VPS

### A1. Ocupação por pasta

Disco: 197 GB, **142 GB usados, 48 GB livres (75 %)**.

| Pasta | Tamanho | Última alteração | O que é |
|---|---:|---|---|
| `/var/lib/postgresql` | 83 GB | contínua | Cluster Postgres 17 único (todos os bancos: Mavrion, Norion, Tato) |
| `/tato` | 29 GB | 22/10/2026 04:42 | **Outro sistema** (app "Tato", 45 releases em `/tato/releases` = 28 GB; servidor de e-mail nas portas 25/587/993). Fora do escopo; só o tamanho |
| `/var/www/mavrion-api` | 19 GB | 22/10/2026 | Hub API — ver A2 |
| ├ `cog_argila/` | 14 GB | 13/03/2026 | 3 COGs de argila (OpenGeoHub) |
| ├ `srtm_tiles/` | 4,3 GB | 15/03/2026 | 63 tiles SRTM 90 m |
| ├ `node_modules/` | 393 MB | 13/08/2026 | dependências do bundle |
| ├ `rotinas/backups/` | 288 MB | 13/08/2026 | dumps `.sql.gz` de 4 tabelas (anm_processos, cprm_geologia, funai, icmbio) feitos antes da instalação dos sidecars |
| ├ `dist/` | 48 MB | 22/10/2026 | bundle atual (3,5 MB) + **12 cópias de backup** do bundle (mar–out) |
| ├ `fonte/` | 20 MB | 22/10/2026 | espelho git do fonte recuperado (commit `50a0c20`) |
| ├ `server/`, `shared/`, `script/` | <300 KB | mar/2026 | fonte TypeScript antigo (março), não é o que gera o bundle |
| `/var/www/mavrion-conect` | 2,2 GB | 22/10/2026 | Connect — ver A2 |
| ├ `node_modules/` | 808 MB | 13/08/2026 | dependências de produção |
| ├ `dist/` (ativo) | 12 MB | 22/10/2026 04:24 | `index.cjs` (server) + `public/` (frontend, build de 22/10 02:33) |
| ├ 17 pastas `dist.bak_*`, `dist.pre-*`, `dist-backup`, `dist.backup_*`, `dist.badpdfbuild_*` | ≈1,3 GB | jul–out/2026 | backups de deploys anteriores |
| ├ `.pythonlibs/` + `main.py` + `docker-compose.yml` | 68 MB | fev/2026 | resíduo de um esqueleto Python inicial; nada em produção usa |
| ├ `.git/` | 39 MB | 12/08/2026 | árvore divergente do GitHub (ver memória do projeto) |
| ├ `attached_assets/` | 13 MB | 21/10/2026 | anexos do Connect |
| ├ `norion-standalone/` | — | 04/03/2026 | cópia do painel Norion dentro da pasta do Connect |
| ├ `uploads/` | 340 KB | — | uploads do Connect |
| `/var/www/norion`, `/var/www/norion-site` | 532 MB + 275 MB | — | Norion (fora do escopo) |
| `/usr` | 2,8 GB | — | sistema |
| `/root` | 2,7 GB | — | `.cache` 1,3 GB, `.pm2` 855 MB (logs), `.npm` 606 MB, `backups/2026-08-14-task185-scm-ia` (968 KB), `mavrion-api/dist` (1,7 MB, 12/03) |
| `/var/log` | 2,3 GB | — | `/var/log/mavrion` 2,1 GB (logs do Connect), `/var/log/postgresql` 185 MB |
| `/tmp` | 1,3 GB | 21/10/2026 | `pgfn_nao_previdenciario.zip` (1,34 GB, dados abertos PGFN baixados em 21/10), `connect-pgfn-fixed.cjs`/`connect-sigef-fixed.cjs` (3 MB cada), resultados JSON de auditorias (≤120 KB) |

### A2. Conjuntos de dados: o que são, quem usa, cobertura, quando chegaram

| Conjunto | Fonte / versão | Tamanho | Baixado / importado | Usado por | Cobertura |
|---|---|---:|---|---|---|
| `cog_argila/*.tif` (3 arquivos) | OpenGeoHub/OpenLandMap `global_soil_props_v20250523`, `clay.tot_iso.11277.2020.wpct_m_120m`, profundidades 0–30, 30–60, 60–100 cm, EPSG:4326, BigTIFF (cabeçalho `II+\0` válido) | 4,72 + 4,86 + 4,94 GB | 13/03/2026 | Worker OpenGeoHub (`/api/sicar/opengeohub/*`) → `argila_0_30/30_60/60_100/argila_media` | Global (Brasil todo). Obs.: o marcador `.done` do arquivo 0–30 cm tem 0 bytes (os outros dois têm 24 bytes); o cabeçalho é válido, mas a integridade total do arquivo não foi verificada |
| `srtm_tiles/` (63 `.tif` + `.hdr` + `.tfw` + `readme.txt`) | SRTM v4.1 CGIAR-CSI, 90 m, tiles 5°×5°, WGS84 | 4,3 GB | 15/03/2026 | Worker de altitude (`/api/sicar/altitude/*`) → `alt_*`, centroide, perímetro, `declividade`; script `comparar-declividade.cjs` | Brasil continental; 18 tiles de oceano ausentes por design; ~70 imóveis costeiros/ilhas sem cobertura (`alt_media = -9999`) |
| Postgres `mavrion_api_db` | — | **78 GB** | contínuo | Hub API; o Connect também lê direto (`SICAR_DATABASE_URL` aponta para este banco, em `server/enrichment/agro.ts`) | — |
| ├ 27 partições `sicar_imoveis_<uf>` + `_outros` (vazia) | SICAR via WFS `geoserver.car.gov.br` | ≈33 GB | última importação concluída **14/08/2026** (AL, BA); demais UFs 07–12/08 | tudo em `/api/sicar/*`, enriquecimento ANM, Connect | 27 UFs, 8.471.107 imóveis |
| ├ `sicar_imoveis_old` | tabela pré-particionamento, congelada em 13–14/08 | **34 GB** | 13/08/2026 | **ninguém**: 0 referências no fonte da Hub, no Connect e nas rotinas; sem FK, sem view dependente; estatísticas zeradas (nunca lida desde então) | — |
| ├ `sicar_anm_enrichment` | cruzamento PostGIS imóvel × `anm_processos` | 6,2 GB, 5.528.628 linhas | em andamento (guardião religou às 04:31 UTC de hoje) | `/api/anm/enrich/*`, `/api/anm/imovel/*`, stats por UF | ≈2,94 mi de imóveis ainda sem linha |
| ├ `sicar_solo_openlandmap` | staging do worker OpenGeoHub/OpenLandMap | 1,6 GB, 8.219.243 linhas | 13–16/03/2026 | migração de boot copia `argila_*` para a cache (já copiado: só 190 linhas diferem); `ph_h2o`/`areia_pct` presentes em 52 mil linhas, mas só 1.534 chegaram à cache | — |
| ├ `sicar_calc_backup_2026_10_21` | cópia de `alt_*`, `declividade`, `argila_*` por id | 748 MB, 8.469.645 linhas | 21/10/2026 (auditoria) | rollback dos 200 imóveis de SP recalculados | — |
| ├ `anm_processos` | SIGMINE (espelho), SRID 4674 | 568 MB, 261.309 | 18/10/2026 (sidecar semanal) | `/api/anm/*`, enriquecimento, Connect (fallback do geoportal) | nacional |
| ├ `anm_barragens` | CSV `app.anm.gov.br` | 320 KB, 910 | **13/03/2026** (nunca atualizada desde então) | `/api/anm/barragens`, stats | nacional |
| ├ `anm_outros_layers` | — | 0 linhas | — | — | vazio |
| ├ `ibama_autuacoes` | CSV zip dados abertos IBAMA (48 arquivos anuais) | 545 MB, 698.208 | **22/10/2026 03:31** (diário) | `/api/ibama/autuacoes/*` | nacional |
| ├ `ibama_embargos` | CSV zip dados abertos IBAMA | 101 MB, 111.542 | 09/08/2026 | `/api/ibama/embargos/*` | nacional |
| ├ `pgfn_devedores` | dados abertos PGFN | 287 MB, 536.501 | 05/07/2026 | `/api/pgfn/*` | nacional |
| ├ `cprm_geologia` / `cprm_recursos_minerais` | MapServer SGB | 294 MB (2.838) / 28 MB (36.484) | 03/10/2026 (sidecars mensais) | `/api/cprm/*` | nacional |
| ├ `sgb_bacias_sedimentares` / `sgb_geocronologia` | geoportal SGB | 5,7 MB (72) / 0,9 MB (3.158) | 11/09/2026 | `/api/sgb/*` | nacional |
| ├ `funai_terras_indigenas` | CMR/FUNAI (sidecar) | 60 MB, 665 | 02/10/2026 | `/api/funai/*` | nacional |
| ├ `icmbio_ucs` | WFS INDE/ICMBio | 53 MB, 348 | 14/08/2026 | `/api/icmbio/*` | nacional (348 UCs é menos do que o CNUC lista; não verifiquei o filtro) |
| ├ `agro_entities` | planilhas enviadas por upload | 147 MB, 113.002 | 05/03/2026 | `/api/entities/*` | — |
| ├ `agrofit_*` | scraping do site Agrofit | 86 MB (9.791 produtos, 228 mil indicações) | 10/03/2026 | `/api/agrofit/*` | — |
| ├ `farmway_*` | scraping de sites de fabricantes | <1 MB (250 modelos) | 19/03/2026 | `/api/farmway/*` | — |
| ├ `cardmv_leads` | importação de arquivo | 29 MB, 66.069 | 13/03/2026 | `/api/cardmv/*` | — |
| ├ `api_users` | — | 2 usuários | — | login da Hub | — |
| Postgres `mavrion_conect` | — | 3,7 GB | contínuo | Connect | — |
| ├ `anm_eventos_processos` | dados abertos ANM (CSV 93 MB) | 2,3 GB, 9,6 mi | — | TAH/eventos no Connect | nacional |
| ├ `pgfn_divida_ativa` | dados abertos PGFN | 1,0 GB, 3,4 mi | 21/10/2026 (zip em `/tmp`) | Connect | nacional |
| ├ `tah_titulares`, `ibama_auto_infracao`, `cfem_arrecadacao` | — | 129 + 128 + 104 MB | — | Connect | — |
| ├ dados próprios (`users`, `assets` = 15, `deals`, `companies`, `error_reports`, `audit_logs`, `session`, …) | gerados pelos usuários | <10 MB | contínuo | Connect | **insubstituíveis** |
| Postgres `norion_db`, `norion_painel`, `tato`, `tato_jm_forros` | outros sistemas | 8–13 MB cada (um sem acesso) | — | — | fora do escopo |

### A3. Espaço livre e tendência

| Medida | Valor |
|---|---|
| Livre agora | 48 GB (75 % usado) |
| Livre em 21/10 (auditoria anterior) | ≈50 GB |
| Variação em 1 dia | −2 GB, mas **não orgânica**: 1,34 GB do zip PGFN em `/tmp` + 748 MB da tabela de backup de 21/10 |
| Crescimento recorrente identificado | (1) enriquecimento ANM: ≈1,1 KB/linha → faltam ≈2,94 mi linhas ≈ **+3,3 GB** até concluir; (2) reimportação diária do IBAMA (upsert que atualiza as 698 mil linhas todo dia — `n_tup_upd` = 698.208 hoje — gerando versões mortas até o autovacuum, que rodou às 03:32); (3) log de erro do pm2 da Hub: 840 MB desde 10/03 (média ≈3,7 MB/dia, em rajadas — na amostra de 60 s de hoje não cresceu); (4) logs do Connect sem rotação (`/var/log/mavrion/app-3.log` e `out-3.log` com 571 MB cada, aparentemente o mesmo fluxo gravado duas vezes) |
| WAL | 753 MB (`max_wal_size = 1GB`, estável) |
| Histórico de ocupação | **não existe**: o sysstat está instalado mas `/var/log/sysstat` está vazio; não há série temporal para projetar |

### A4. O que parece sobrar (apenas lista; nada foi tocado)

| Item | Tamanho | Motivo |
|---|---:|---|
| Tabela `sicar_imoveis_old` | **34 GB** (43 % do banco da Hub) | Cópia congelada de antes do particionamento (13/08). Zero referências em código, rotinas e Connect; sem FK/view dependente. É de longe a maior sobra |
| `sicar_solo_openlandmap` | 1,6 GB | Staging de março; `argila_*` já copiada para a cache (190 linhas de diferença). Não é sobra pura: tem 52 mil `ph_h2o`/`areia_pct` que nunca foram copiados |
| `sicar_calc_backup_2026_10_21` | 748 MB | Backup da auditoria de 21/10. Útil até se decidir a migração de método; depois, sobra |
| Backups de `dist` do Connect (17 pastas) | ≈1,3 GB | Só o mais recente (`dist.pre-validacoes-20261022T023314Z`) e o pré-deploy de hoje (`dist/index.cjs.bak_20261022_042428`) servem para rollback |
| Backups de bundle da Hub (12 arquivos em `dist/`) | 42 MB | Mesmo caso; o de hoje (`index.cjs.bak_20261022_042428`) basta |
| `/tmp/pgfn_nao_previdenciario.zip` + `connect-*-fixed.cjs` | 1,35 GB | Arquivos de trabalho de 21/10 já importados |
| `/root/.pm2/logs/mavrion-api-error-25.log` | 840 MB | Log de erro sem rotação, dominado por um loop (ver D) |
| `/var/log/mavrion/app-45.log`, `out-45.log` | 750 MB | Logs de um processo pm2 morto em abril |
| `/var/log/mavrion/app-3.log` + `out-3.log` | 1,1 GB | Mesmo conteúdo em dois arquivos (log_file + out_file do pm2); sem rotação desde 16/03 |
| `rotinas/backups/*.sql.gz` | 288 MB | Dumps de 13/08 de tabelas que hoje são regeneradas semanal/mensalmente pelos sidecars |
| `/root/.cache`, `/root/.npm` | 1,9 GB | Caches de build/npm |
| `mavrion-conect/.pythonlibs`, `main.py`, `docker-compose.yml` | 68 MB | Esqueleto Python de fevereiro; nada usa |
| `mavrion-conect/norion-standalone/` | — | Cópia do Norion dentro do Connect |
| `mavrion-api/server/`, `shared/`, `script/` | <300 KB | Fonte TS de março; o bundle vem de `fonte/` (via workspace) — confunde quem for manter |
| `/root/mavrion-api/dist` | 1,7 MB | Bundle de 12/03 fora do lugar |
| `mavrion-conect/deploy.tar.gz`, `anm_page.png`, `audit-export.txt`, `AUDITORIA_*.md`, `e2e-report.txt`, `cookie`, `cookies.txt`, `cookies2.txt` | ≈9 MB | Restos de sessões de depuração de março. **Os três arquivos `cookie*` podem conter cookies de sessão** (não os li) |
| `mavrion-conect/.env.bak_20260814205057`, `.env.bak_keyrot_20260813_204516` | 7 KB | Cópias do `.env` com segredos **antigos** (pré-rotação de 13/08). Não é espaço; é exposição |
| `anm_outros_layers`, `sicar_imoveis_outros`, `file_uploads`, `uploads/` | 0 | Vazios |

---

## PARTE B — Como a Hub funciona

### B5. Rotas por assunto (170 rotas no fonte = bundle publicado)

"Já gravado" = a rota lê o Postgres local; "a cada pedido" = a rota chama o serviço externo na hora.

| Grupo | Rotas | De onde vem o dado | Quando é consultado |
|---|---:|---|---|
| **SICAR** — consulta (`/api/sicar/imoveis`, `/:codigo`, `/:codigo/geojson`, `/search`, `/geojson*`, `/stats`, `/cache-stats`, `/filter-options`) | 12 | Banco local (27 partições) | Já gravado. `/stats` lê `sicar_stats_cache`, atualizado por timer interno (último refresh 04:57 UTC de hoje) |
| SICAR — importação (`/import`, `/import-progress`, `/import-history`, `/schedule*`, `/schedules`, `/backfill-fields`, `/backfill-geometries`, `/partition/*`) | 12 | WFS `geoserver.car.gov.br` + lista de UFs do IBGE | Sob demanda ou por agendamento (27 agendamentos semanais — **não disparam desde 14/08**, ver B7) |
| SICAR — altitude (`/altitude/start|stop|status|data|dashboard|backfill`) | 6 | Tiles SRTM **locais** (`srtm_tiles/`); `backfill` chama Open-Meteo | Worker grava em massa; `status` lê contadores em memória + banco |
| SICAR — argila OpenGeoHub (`/opengeohub/start|stop|status|data`) | 4 | COGs **locais** (`cog_argila/`) | Worker grava em massa; parado |
| SICAR — OpenLandMap (`/openlandmap/start|stop|status|data`) | 4 | COGs **remotos** em `s3.openlandmap.org` (leitura por faixa de bytes, a cada imóvel) | Worker grava; parado |
| SICAR — Solo ISRIC (`/solo/start|stop|status|data|server-status|clear-cache`) | 6 | API SoilGrids `rest.isric.org` | Worker grava `argila_pct`; `server-status` consulta o ISRIC na hora |
| **ANM** — consulta (`/processos*`, `/geojson*`, `/barragens`, `/jazidas`, `/outros-layers`, `/stats/*`, `/imovel/:cod*`, `/enrich/data`, `due-diligence`) | 17 | Banco local (`anm_processos`, `anm_barragens`, `sicar_anm_enrichment`) | Já gravado |
| ANM — importação/enriquecimento (`/import/start|stop|status`, `/enrich/reset`) | 4 | `geo.anm.gov.br` (SIGMINE) e `app.anm.gov.br` (CSV de barragens) para importar; enriquecimento é PostGIS local | Import sob demanda (o sidecar semanal substitui); worker de enriquecimento ligado pelo guardião |
| **FUNAI** (`/terras`, `/terras/raio`, `/sobreposicao`, `/sobreposicao-poligono`, `/status`, `/config`, `/sync`, `/sync-log`) | 9 | Banco local (`funai_terras_indigenas`, 665 TIs) | Já gravado (sidecar mensal via CMR/FUNAI). O `/sync` interno usa `geoserver.funai.gov.br`, que está fora do ar — está desligado por env |
| **ICMBio** (`/ucs`, `/sobreposicao` GET/POST, `/status`, `/importar`) | 5 | Banco local (`icmbio_ucs`) | Já gravado; importação pelo scheduler interno (último 14/08) |
| **CPRM** (`/geologia*`, `/recursos*`, `/status`, `/config`, `/sync`, `/sync-log`) | 11 | Banco local | Já gravado (sidecars mensais) |
| **SGB** (`/bacias*`, `/geocronologia/*`, `/consulta-completa`, `/status`, `/config`, `/sync`, `/sync-log`) | 10 | Banco local | Já gravado (sync interno; último 11/09) |
| **IBAMA** (`/autuacoes/:cnpj`, `/embargos/:cnpj`, `/*/status`, `/*/importar`) | 6 | Banco local | Já gravado; autuações reimportadas diariamente, embargos semanal (parado desde 09/08) |
| **PGFN** (`/devedor/:cnpj`, `/status`, `/importar`, `/importar/:tipo`) | 4 | Banco local | Já gravado; importação trimestral (última 05/07; a de 05/10 não ocorreu) |
| **Agrofit** (12), **Farmway** (11), **Entities** (14 + 2 variantes), **CardMV** (6 + 1) | 46 | Banco local (scraping/uploads de março) | Já gravado; sem atualização desde março |
| **Upload** (`/upload/preview`, `/upload/import`, `/uploads`) | 3 | Arquivo enviado → `agro_entities` | Sob demanda (0 registros em `file_uploads`) |
| **Auth** (`/login`, `/me`, `/refresh`), **Scheduler** (`/modules`, `/modules/:id`, `/modules/:id/run`), **Health** (`/health`, `/health/modules`), `/stats`, `/client-error`, **VPS** (`/vps/altitude/status`, `/vps/opengeohub/status`) | 12 | Local; `/vps/*` chama a própria Hub por HTTP em `127.0.0.1:5002` | A cada pedido |

### B6. Serviços externos

Status medido hoje da própria VPS (`curl`, 15 s). "Se cair" descreve o comportamento do código, não uma suposição.

| Serviço | Para quê | Status hoje | Se estiver fora do ar |
|---|---|---|---|
| `geoserver.car.gov.br` (WFS SICAR) | Importar/atualizar imóveis por UF | 200 | Importação registra `error` em `sicar_import_log`; base local continua servindo (hoje congelada em 07–14/08). Usuário não vê erro |
| `srtm.csi.cgiar.org` | Baixar tiles SRTM que faltem | 200 (4,6 s) | Tiles já estão em disco; só impacta se a pasta for perdida (worker para com "Nenhum tile carregado") |
| `s3.opengeohub.org` | Baixar os 3 COGs de argila (uma vez) | 200 | Já em disco; mesmo caso |
| `s3.openlandmap.org` | pH, areia, carbono, densidade — leitura remota a cada imóvel | 200 | Worker conta `unavailable`, pausa e segue; colunas ficam **NULL** (nunca valor errado) |
| `rest.isric.org` (SoilGrids) | `argila_pct` e `/solo/server-status` | **504 (timeout)** | Worker marca `unavailable` e para após sequência de falhas; coluna fica NULL. Na prática a coluna hoje é cópia de `argila_media` |
| `archive-api.open-meteo.com` | `temp_media` / `precip_anual` (ano 2024, ERA5) no backfill | 200 (0,8 s) | `catch` devolve `null` → colunas ficam NULL, sem sentinela, sem registro de erro |
| `geo.anm.gov.br` (SIGMINE FeatureServer) | Espelho `anm_processos` (sidecar semanal) e `/api/anm/import/start` | 200 | Espelho envelhece; `freshness-check` abre alerta `vps_rotina_stale` no Connect após o limite (dias) configurado por módulo; consultas seguem no espelho |
| `app.anm.gov.br` (Barragens.csv) | `anm_barragens` | **conexão resetada (falha)** | Tabela local fica com as 910 linhas importadas em 13/03/2026 (não há reimportação agendada) |
| `geoserver.funai.gov.br` | Sync interno de TIs (desligado) | **falha de conexão/TLS** | Sem impacto: o sidecar usa CMR/FUNAI (02/10 OK) |
| `geoservicos.inde.gov.br` (ICMBio WFS) | `icmbio_ucs` | 200 | Importação mensal falha → tabela envelhece; sem alerta (não está no freshness-check) |
| `geoportal.sgb.gov.br` | CPRM geologia/recursos, SGB bacias/geocronologia | 200 | Sidecars CPRM alertam via freshness-check; SGB interno não alerta |
| `dadosabertos.ibama.gov.br` (2 zips) | Autuações (diário) e embargos (semanal) | 200 / 200 | Importação falha e loga; dado anterior permanece |
| `dadosabertos.pgfn.gov.br` | Dívida ativa (trimestral) | 200 | Idem |
| `agrofit.agricultura.gov.br` | Scraping manual | 200 | Só afeta reimportação manual |
| `servicodados.ibge.gov.br` | Lista de UFs para importação SICAR | 200 | Importação por UF não inicia |
| `127.0.0.1:5002` (a própria Hub) | `/api/vps/*` | 200 | Erro claro 502/500 se a Hub não responder |
| Sites de fabricantes (Jacto, Deere, Case, etc.) | Scraping Farmway (manual) | não testado | Só reimportação manual |

Serviços que o **Connect** chama diretamente (MapBiomas, Sentinel Hub, IBGE WFS BC250/BC100, Overpass, SIGEF, SICAR por UF, CNPJA, DataJud, Querido Diário, OpenAI, etc.) não passam pela Hub e ficam fora desta tabela.

### B7. Workers e agendadores

**Dentro do processo da Hub (pm2 `mavrion-api`, morrem em restart):**

| Worker / timer | O que faz | Frequência | Ligado agora? | Grava em massa? |
|---|---|---|---|---|
| Altitude (SRTM) | Lotes de 2.000 imóveis com `alt_media IS NULL`: amostra ≤17 pontos nos tiles → `alt_*`, centroide, perímetro, `declividade`; marca `-9999` quando não há tile | Sob demanda (`POST /altitude/start`) ou auto-start no boot se houver pendência | **Parado** ("Auto-start: nenhum imóvel pendente"); 0 pendentes | Sim (bulk UPDATE) |
| Argila OpenGeoHub | Lê 3 COGs locais por imóvel → `argila_0_30/30_60/60_100/argila_media` (`-1` quando sem dado) | Sob demanda | **Parado**; 251.864 pendentes; ninguém religa automaticamente | Sim |
| OpenLandMap | pH/areia/carbono/densidade por leitura remota | Sob demanda | **Parado**; 8.469.573 pendentes (só 1.534 feitos) | Sim |
| Solo ISRIC | `argila_pct` via SoilGrids | Sob demanda | **Parado** (ISRIC em 504) | Sim |
| Backfill geo | Para imóveis sem centroide: centroide, perímetro, declividade pela fórmula antiga (`(alt_max−alt_min)/distância`) e Open-Meteo 2024 → `temp_media`, `precip_anual` | Sob demanda (`POST /altitude/backfill`) | Parado | Sim |
| Enriquecimento ANM | Cruza partições SICAR × `anm_processos` (índice gist funcional) → `sicar_anm_enrichment` | Religado pelo guardião sidecar (10 em 10 min, por load, janela noturna) | **Rodando** (iniciado 04:31 UTC; ≈300 imóveis/min; 2,95 mi pendentes) | Sim (INSERT contínuo) |
| Scheduler SICAR | 27 agendamentos semanais (sex 03:00 UTC: AC–GO; dom 04:00: MA–PR; qua 04:15: RJ–TO) → importação sequencial por UF | Carregado em todo boot ("27 rotina(s) ativa(s)") | **Não dispara desde 14/08/2026** (último "enfileirando: BA, AL"); causa não investigada (somente leitura) | Sim, quando roda (upsert de centenas de milhares de linhas por UF) |
| Scheduler de módulos (`module_schedules`, node-cron 4.2.1, TZ São Paulo) | 7 módulos | ibama_autuacoes diário 03:30 UTC — **funciona** (hoje); ibama_embargos semanal — último 09/08; icmbio mensal — último 14/08; pgfn trimestral — último 05/07 (**05/10 não ocorreu**); sgb mensal — registro de 11/09; funai e cprm **desativados** (substituídos por sidecars) | Carregado; só o diário tem disparado | ibama_autuacoes: upsert das 698 mil linhas por dia |
| Syncs por intervalo (setInterval) FUNAI / CPRM / SGB | Download + swap da tabela | Dias (`*_SYNC_INTERVAL_DAYS`) | FUNAI e CPRM **desligados** por `.env`; SGB: `SGB_SYNC_ENABLED` não está no `.env` (usa default do código) | Sim quando roda |
| StatsCache | Recalcula `sicar_stats_cache` | Timer interno | Ligado (04:57 UTC) | Não (1 linha) |
| Auto-resume de importações | Retoma importação SICAR interrompida | No boot | Nada a retomar | — |

**Fora do processo (crontab do root, com `flock`, fonte em `vps-rotinas/`):**

| Rotina | Cron (UTC) | Última execução / resultado | Grava em massa? |
|---|---|---|---|
| `anm-sigmine-sync.cjs` | dom 05:15 | 18/10 OK: 261.309 processos em 128 s; requeue de 4.932 imóveis para re-enriquecer | Sim (DELETE+INSERT transacional de 261 mil + deleções no enrichment) |
| `funai-tis-sync.cjs` | dia 2, 05:45 | 02/10 OK: 665 TIs | Pequeno |
| `cprm-geologia-sync.cjs` | dia 3, 04:30 | 03/10 OK: 2.838 unidades | Pequeno |
| `cprm-recursos-sync.cjs` | dia 3, 05:15 | 03/10 OK: 36.484 ocorrências | Pequeno |
| `altitude-watchdog.cjs` | 6/6 h (xx:20) | 22/10 00:20: "pendentes: 0, nada a fazer" | Religa o worker de altitude se houver pendência |
| `anm-enrich-guard.cjs` | 10 em 10 min | 04:51 hoje: "enriquecendo, pendentes=2.947.272" | Liga/pausa o worker de enriquecimento |
| `freshness-check.cjs` | diário 08:30 | 21/10: "tudo em dia" (monitora só os sidecars + backlog de altitude; **não** monitora scheduler SICAR, IBAMA, ICMBio, PGFN, SGB nem argila) | Grava alertas em `error_reports` do Connect |
| `token-renew.cjs` | diário 08:00 | 21/10: renovado via re-login; token válido até 28/10 | Não |
| truncate de logs das rotinas | seg 06:00 | — | — |
| auto-deploy do Connect (`git fetch` + `deploy.sh`) | a cada 2 min | **Desativado** (comentado com aprovação do dono em 21/10) | — |

Timers do sistema: `certbot.timer` (renovação OK; certificados expiram 02–11/12/2026), `tato-backup.timer` e `tato-certificate-renew.timer` (do Tato), apt/logrotate padrão. Nenhum timer de backup do Postgres da Mavrion.

### B8. Variáveis de ambiente da Hub (somente nomes)

| Onde | Nomes |
|---|---|
| Lidas pelo código da Hub | `PORT`, `DATABASE_URL`, `SESSION_SECRET`, `API_KEYS`, `FUNAI_SYNC_ENABLED`, `FUNAI_SYNC_INTERVAL_DAYS`, `CPRM_SYNC_ENABLED`, `CPRM_SYNC_INTERVAL_DAYS`, `SGB_SYNC_ENABLED`, `SGB_SYNC_INTERVAL_DAYS`, `ANM_ENRICH_CONCURRENCY`, `ANM_ENRICH_BATCH`, `ANM_ENRICH_SLEEP_MS`, `NODE_ENV` (+ variáveis de bibliotecas: `PGSSLMODE`, `PGCONNECT_TIMEOUT`, `DEBUG`, `NODE_DEBUG`) |
| Presentes em `/var/www/mavrion-api/.env` | `ANM_ENRICH_BATCH`, `ANM_ENRICH_CONCURRENCY`, `ANM_ENRICH_SLEEP_MS`, `API_KEYS`, `CPRM_SYNC_ENABLED`, `DATABASE_URL`, `FUNAI_SYNC_ENABLED`, `NODE_ENV`, `PORT`, `SESSION_SECRET` |
| Efetivamente no processo pm2 (`pm2 env`) | `API_KEYS`, `CPRM_SYNC_ENABLED`, `DATABASE_URL`, `FUNAI_SYNC_ENABLED`, `NODE_ENV`, `PORT`, `SESSION_SECRET` |
| **Definidas no `.env` mas que não chegam ao processo** | `ANM_ENRICH_BATCH`, `ANM_ENRICH_CONCURRENCY`, `ANM_ENRICH_SLEEP_MS` — o `ecosystem.config.cjs` só repassa uma lista fixa de chaves; o worker usa os defaults do código |
| Não definidas (default do código) | `SGB_SYNC_ENABLED`, `FUNAI_SYNC_INTERVAL_DAYS`, `CPRM_SYNC_INTERVAL_DAYS`, `SGB_SYNC_INTERVAL_DAYS` |
| Removidas em 22/10 (não existem mais no código) | `VPS_HOST`, `VPS_USER`, `VPS_PASSWORD` |
| Usadas pelos sidecars | `DATABASE_URL` (do `.env` da Hub, via `pg-env.sh`); `MAVRION_API_USER`/`MAVRION_API_PASS` (do `.env` do **Connect**); JWT em `rotinas/.token` |
| Connect → Hub | `MAVRION_API_KEY` (mesmo valor de uma das `API_KEYS`), `SICAR_DATABASE_URL` (acesso direto ao banco da Hub), `MAVRION_API_URL` ausente (usa default do código) |

---

## PARTE C — Qual dado vem de onde

### C9. Colunas de `sicar_imoveis_cache` (8.471.107 imóveis; contagens reais de hoje)

"Sem dado" = valor sentinela gravado de propósito; "pendente" = NULL (nunca processado). Não há coluna de versão de método: a geração de cada valor **não pode ser determinada por imóvel** (motivo da proposta em `docs/proposta-versao-metodo-geografico.md`).

| Coluna | Conjunto / serviço / versão | Preenchidos | Pendentes (NULL) | Sem dado (sentinela) | Observações |
|---|---|---:|---:|---:|---|
| `geometry`, `geom`, `cod_imovel`, `uf`, `municipio`, `num_area`, `ind_status`, `ind_tipo`, `condicao`, `cod_municipio_ibge`, `dat_criacao`, `data_atualizacao` | SICAR WFS (importação 07–14/08/2026) | 8.471.107 (geom) | 0 | — | `m_fiscal` NULL em 177.356 (o WFS não traz para todos) |
| `centroid_lat/lon`, `perimetro_km` | Calculados do polígono (worker de altitude / backfill) | 8.471.107 / 8.470.611 | 0 / 496 | — | — |
| `alt_media`, `alt_min`, `alt_max` | SRTM v4.1 CGIAR 90 m, amostra ≤17 pontos dentro do polígono | **8.470.887** | 0 | **70** com `-9999` (sem tile: PA 28, BA 19, SC 11, SE 4, MA 4, RJ 2, PR 2) | 150 imóveis com altitude entre −9999 e 0 (negativa, não sentinela): provável artefato de borda costeira do SRTM, não verificado |
| `declividade` | SRTM, **três gerações sem marcador**: (a) "máximo entre pares" (mais antiga, ainda presente em parte da base — ex.: Corumbataí/SP 32,15 vs 16,20 recomputado); (b) média de ≤17 pontos (função atual; 200 imóveis de SP recalculados em 21/10); (c) fórmula `(alt_max−alt_min)/distância` do backfill; Horn 3x3 **não está em produção** | 8.464.910 | 6.197 | 0 negativos; **171.554 iguais a zero** e **10.071 acima de 100 %** (valores suspeitos, provavelmente da geração (a)) | Backup de 21/10 em `sicar_calc_backup_2026_10_21` |
| `argila_0_30`, `argila_30_60`, `argila_60_100` | OpenGeoHub clay v20250523, 120 m, COG local | 8.213.370 | 257.737 | — (sem dado vira NULL nas camadas e `-1` na média) | — |
| `argila_media` | média das três camadas | **8.213.370** | **251.864** | **5.873** com `-1` | Fila que o item 5 (argila) trataria |
| `argila_pct` | Originalmente ISRIC SoilGrids (0–30 cm); hoje é **cópia de `argila_media`** (só 190 linhas diferem) | 8.219.243 | 251.864 | 5.873 (`-1`) | A fonte ISRIC praticamente não está em uso; e está em 504 hoje |
| `ph_agua`, `areia_pct`, `carbono_organico`, `densidade_aparente` | OpenLandMap 250 m v0.2 (séries 1950–2017), COG remoto | **1.534** | 8.469.573 | 0 | `sicar_solo_openlandmap` tem 52 mil valores de pH/areia nunca copiados para a cache |
| `silte_pct`, `nitrogenio_solo` | **nenhuma rota grava** essas colunas | 0 | 8.471.107 | — | Colunas mortas |
| `temp_media`, `precip_anual` | Open-Meteo archive (ERA5), **ano fixo 2024**, no centroide | **1.012.356** | 7.458.751 | 0 (falha vira NULL, indistinguível de pendente) | Nenhum valor absurdo (−5..45 °C; precipitação > 0) |
| `anm_status`, `anm_processos_count/json`, `anm_outros_layers_count`, `anm_barragens_count/json`, `anm_processed_at` | — | **0** | 8.471.107 | — | Colunas abandonadas: o enriquecimento ANM vive em `sicar_anm_enrichment` (5.528.628 imóveis prontos, ≈2,94 mi faltando) |
| Uso do solo, hidrografia, energia, rodovia/ferrovia, APP, NDVI | **Não existem na Hub.** São calculados pelo Connect por ativo, na hora (MapBiomas, IBGE WFS BC250/BC100, Sentinel) | — | — | — | Fora deste inventário |

### C10. Colunas que dependem de fonte fora do ar, que mudou de endereço ou de versão

| Coluna / tabela | Dependência | Situação |
|---|---|---|
| `argila_pct` | `rest.isric.org` (SoilGrids v2) | **504 hoje**; historicamente instável (o worker tem contador próprio de indisponibilidade). Coluna já foi substituída na prática pela cópia de `argila_media` |
| `anm_barragens` | `app.anm.gov.br/dadosabertos/BARRAGEM/Barragens.csv` | **Conexão resetada hoje**; 910 linhas de 13/03/2026, sem reimportação agendada |
| `funai_terras_indigenas` (sync interno) | `geoserver.funai.gov.br` | **Fora do ar**; sem efeito porque o sidecar usa CMR/FUNAI |
| Partições SICAR | `geoserver.car.gov.br` responde, mas o **agendador interno não dispara desde 14/08** | Base congelada em 07–14/08/2026 sem nenhum alerta |
| `pgfn_devedores` | dados abertos PGFN (responde) | Importação trimestral de 05/10 **não ocorreu** (último 05/07) |
| `ibama_embargos` | dados abertos (responde) | Semanal parado desde 09/08 |
| `icmbio_ucs` | INDE (responde) | Mensal parado desde 14/08 |
| `ph_agua`, `areia_pct`, `carbono_organico`, `densidade_aparente` | OpenLandMap **v0.2 (1950–2017)** | Fonte responde; versão antiga do catálogo OpenLandMap (não verifiquei se há v0.3+ para essas camadas) |
| `temp_media`, `precip_anual` | Open-Meteo, **ano 2024 fixo no código** | Fonte responde; o valor é de um único ano, não normal climatológica |
| TOPODATA (só no script de comparação) | `dsr.inpe.br` → `data.inpe.br` | Endereço antigo não resolve; script já usa o novo |
| `alt_*`, `declividade` | SRTM CGIAR | Fonte responde; dados locais não dependem dela |

---

## PARTE D — Riscos

### D11. Pontos únicos de falha, backups e perda

| Ponto único | Detalhe |
|---|---|
| **Uma máquina** | Connect (5000), Hub (5002), Norion (5001/5003/5004) e Tato (web + SMTP/IMAP) na mesma VM: 4 vCPU, 15 GB sem swap, 1 disco de 200 GB a 75 %. Load hoje 1,0–2,2 com o enriquecimento ANM rodando. A Hub tem `max_memory_restart: 500M` (4 restarts registrados) |
| **Um Postgres** | Cluster único local (`listen_addresses = localhost`), sem réplica (`pg_stat_replication` vazio), `archive_mode = off`, `shared_buffers = 128 MB` (default) para um banco de 78 GB |
| **Sem backup do banco** | Não há `pg_dump`/`pg_basebackup` agendado (crontab, timers e `/etc/cron.d` verificados). O que existe: dumps parciais de 4 tabelas em 13/08 (`rotinas/backups`), `/root/backup_assets_20260814_1702.sql` (1,7 MB), tabela `sicar_calc_backup_2026_10_21` (no mesmo banco, mesmo disco). Backups do Tato são de outro sistema. **Snapshots do provedor: não verificável daqui** |
| **Uma chave** | `API_KEYS` da Hub (um valor, compartilhado com `MAVRION_API_KEY` do Connect); `SESSION_SECRET` da Hub assina todos os JWT (trocar invalida `rotinas/.token`); o Connect também acessa o banco da Hub diretamente (`SICAR_DATABASE_URL`) |
| **Acesso SSH** | `PermitRootLogin yes` e `PasswordAuthentication yes` (sobrescrito por `sshd_config.d/50-cloud-init.conf`), porta aberta para qualquer origem no ufw; `fail2ban` ativo. Segredos antigos em `.env.bak_*` e possíveis cookies em `cookie*` dentro de `/var/www/mavrion-conect` |
| **Certificados** | Let's Encrypt via `certbot.timer` (ok); vencimentos 02–11/12/2026 |
| **Logs sem rotação** | `mavrion-api-error-25.log` 840 MB; `/var/log/mavrion` 2,1 GB; em 1 disco compartilhado com o banco |
| **Workers em memória** | Qualquer `pm2 restart` mata altitude/argila/enriquecimento; só altitude e enriquecimento têm quem religue (watchdog/guardião) |

**O que se perde se a VPS cair (sem snapshot do provedor):**

| Dado | Recuperável? | Custo estimado |
|---|---|---|
| Banco do Connect: usuários, 15 ativos, deals, verificações, relatórios, `error_reports`, sessões | **Não** (só existe ali) | Perda definitiva |
| `.env` dos dois apps (chaves de terceiros, segredos) | Parcialmente (os valores existem nos provedores/Replit) | Reconfiguração manual |
| Cache SICAR (8,47 mi imóveis, 33 GB) | Sim, via WFS | Dias a semanas (BA levou 53 min; 27 UFs sequenciais; o agendador está parado) |
| Altitude/declividade/argila (colunas derivadas) | Sim, recomputando | ≈40 h de CPU estimadas na auditoria de 21/10, sem contar validação |
| `sicar_anm_enrichment` (5,5 mi) | Sim | Meses no ritmo atual (≈300/min só na janela noturna) |
| Rasters (`cog_argila` 14 GB, `srtm_tiles` 4,3 GB) | Sim (fontes respondem hoje) | Horas de download |
| Espelhos ANM/FUNAI/CPRM/SGB/ICMBio/IBAMA/PGFN | Sim (sidecars/módulos) | Horas; exceto `anm_barragens` (fonte fora hoje) |
| Agrofit, Farmway, CardMV, `agro_entities` | Parcial (scraping/arquivos de março precisariam ser refeitos/reenviados) | Dias |
| Código | Hub: fonte recuperado no GitHub + `fonte/`; Connect: GitHub `main` (o frontend em produção vem de build específico, ver memória de deploy) | Horas |
| Base `anm_eventos_processos` / `pgfn_divida_ativa` do Connect | Sim (dados abertos) | Horas |

---

## O que está só em disco

| Item | Onde | Cópia em outro lugar? |
|---|---|---|
| Banco `mavrion_conect` (dados dos usuários) | Postgres local | **Nenhuma** |
| Banco `mavrion_api_db` (78 GB) | Postgres local | Nenhuma completa; só dumps parciais de 13/08 no mesmo disco |
| `.env` da Hub e do Connect | `/var/www/*/.env` | Não (e não devem ir para o Git) |
| `rotinas/.token` | disco | Regenerável pelo `token-renew` |
| `cog_argila/`, `srtm_tiles/` | disco | Não; re-baixáveis das fontes públicas |
| `dist/public` do Connect em produção | disco | Reproduzível só a partir do commit certo (não trivial) |
| `attached_assets/`, `uploads/` do Connect | disco | Não verificado se há cópia no Google Drive |
| Logs (pm2, `/var/log/mavrion`, rotinas) | disco | Não |

## O que depende de serviço externo

| Função | Serviço | Estado hoje | Degradação |
|---|---|---|---|
| Atualização SICAR | geoserver.car.gov.br | OK, mas agendador parado | Base congela (já está) |
| `argila_pct` | ISRIC SoilGrids | **Fora (504)** | NULL |
| pH/areia/carbono/densidade | s3.openlandmap.org | OK | NULL |
| Clima (2024) | Open-Meteo | OK | NULL silencioso |
| Barragens ANM | app.anm.gov.br | **Fora** | Tabela estática |
| Espelho SIGMINE | geo.anm.gov.br | OK | Envelhece; alerta por freshness |
| TIs | CMR/FUNAI (sidecar) | OK em 02/10 | Envelhece; alerta por freshness |
| Geologia/recursos | SGB | OK | Envelhece; CPRM alerta, SGB não |
| UCs | INDE | OK, módulo parado | Envelhece sem alerta |
| IBAMA, PGFN | dados abertos | OK; só o diário roda | Envelhece sem alerta |
| Download de rasters | CGIAR, OpenGeoHub | OK | Só em reinstalação |
| `/api/vps/*` | a própria Hub | OK | Erro explícito |

## O que me preocupa

1. **Nenhum backup do Postgres.** Um disco, um cluster, sem dump agendado, sem réplica, sem archive. O banco do Connect (dados de usuários) e 78 GB de dados derivados dependem de o disco não falhar. É o único item desta lista cuja perda é irreversível.
2. **Os agendamentos semanais/mensais da Hub não disparam desde agosto** — 27 importações SICAR (última 14/08), embargos IBAMA (09/08), ICMBio (14/08), PGFN (05/10 pulado). Só o cron diário funciona. O `freshness-check` não cobre nenhum deles, então ninguém foi avisado. Não investiguei a causa (somente leitura); é o primeiro ponto a abrir.
3. **`sicar_imoveis_old`: 34 GB (43 % do banco) sem nenhum uso.** Não é risco de dado, é risco de disco: com 48 GB livres e ≈3,3 GB ainda por vir do enriquecimento, é a margem que falta para backups ou para uma reimportação.
4. **Loop de erro no enriquecimento ANM.** 96 imóveis com geometria inválida (`TopologyException`) falham a cada ciclo e voltam para a fila (206 mil ocorrências nos últimos 50 MB do log); o log de erro já tem 840 MB sem rotação. O trabalho útil continua, mas o custo cresce todo dia.
5. **Dados que parecem completos mas não são.** `declividade` mistura três métodos sem marcador (171 mil zeros, 10 mil acima de 100 %); `argila_pct` é cópia de `argila_media`; pH/areia/carbono/densidade existem em 0,02 % da base; clima em 12 %, de um único ano; `silte_pct`, `nitrogenio_solo` e as colunas `anm_*` da cache nunca foram gravadas. Qualquer tela que mostre essas colunas sem dizer "não calculado" induz ao erro.
6. **Acesso e segredos.** Root por senha via SSH aberto a qualquer IP; `.env.bak_*` com segredos antigos e arquivos `cookie*` dentro da pasta do Connect; uma única `API_KEYS` compartilhada; o Connect acessa o banco da Hub direto. Nada disso foi alterado.
7. **Configuração que não faz o que parece.** `ANM_ENRICH_*` estão no `.env` mas não chegam ao processo (o ecosystem não os repassa); `SGB_SYNC_ENABLED` não está definido; o scheduler de módulos ainda lista FUNAI/CPRM desativados ao lado dos sidecars que fazem o mesmo trabalho — dois agendadores para a mesma coisa.
8. **Host compartilhado.** Tato (com servidor de e-mail e 45 releases = 29 GB) e Norion dividem CPU, disco e Postgres com a Mavrion; um incidente em qualquer um afeta todos.

## O que não consegui verificar

- **Snapshots/backup do provedor da VM** (QEMU, hostname `srv1459960`): não há como saber daqui se existem.
- **Tendência real de disco**: sem histórico (sysstat sem dados); a variação de 1 dia foi dominada por arquivos de auditoria.
- **Integridade completa do COG de argila 0–30 cm** (marcador `.done` vazio): só o cabeçalho foi checado; validar exigiria ler 4,7 GB.
- **Causa de o agendador SICAR/módulos não disparar** desde agosto: exigiria depuração no processo; não feito.
- **Os 150 imóveis com altitude negativa** (não sentinela) e os **10.071 com declividade > 100 %**: não inspecionados individualmente.
- Se as 348 UCs do ICMBio são o universo esperado (o CNUC lista mais; não conferi o filtro usado).
- **Conteúdo de `cookie`, `cookies.txt`, `cookies2.txt` e dos `.env.bak_*`**: não lidos de propósito.
- **Banco `tato_jm_forros`**: sem permissão de conexão; pastas do Tato e do Norion não foram inspecionadas além do tamanho.
- **Se `attached_assets/`/`uploads/` do Connect têm cópia no Google Drive** (há integração configurada, mas não conferi o conteúdo remoto).
- **Taxa de crescimento do log de erro**: a amostra de 60 s deu zero; a média histórica (3,7 MB/dia) é só o total dividido pelos dias.
