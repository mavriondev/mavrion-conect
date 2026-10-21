# Mavrion Connect — B2B Deal Origination Platform

## Overview
Mavrion Connect reúne cadastro e pesquisa de ativos, empresas, enriquecimento CNPJ e geográfico e relatórios técnicos, com foco em jazidas e processos minerários.

## User Preferences
I prefer detailed explanations. I want iterative development. Ask before making major changes. Do not make changes to folder `server/enrichment/`. Do not make changes to file `client/src/index.css`.

**Foco do produto (decisão do usuário, ago/2026):** trabalhar SOMENTE em ativos de JAZIDAS/MINA — descobrir e identificar o máximo de informações relevantes sobre esse tipo de ativo (ANM, SCM, SIGEF/SNCR, geologia, restrições, titularidade etc.). NÃO implementar nada de CRM (leads, deals, pipeline, matching/importação de compradores) nem nada envolvendo Datastone.

**Módulos aposentados (decisão confirmada do usuário):** remover do código CRM completo (funil, propostas, contratos e onboarding), SDR inclusive no Norion separado, Vitrine e Matching. Não reintroduzir suas páginas, menus, APIs ou automações. A limpeza não autoriza excluir dados existentes: as definições de tabelas legadas e a integridade referencial são preservadas, sem migrações destrutivas.
**Por quê:** o usuário informou que esses módulos não são mais usados e pediu a remoção do código, não apenas ocultação da navegação.

**Limite entre pesquisa de empresas e CRM:** cadastro, importação CNPJ, contatos e descarte de resultados de pesquisa continuam disponíveis. Descartar um resultado é uma marca cadastral da empresa, sem criar lead. Não existem mais ações de criar/qualificar/pontuar leads, importação automática de investidores ou contexto de compradores nas análises de ativos. Tabelas antigas só permanecem para histórico e integridade referencial.

**Navegação (decisão do usuário, ago/2026):** evitar sub-abas aninhadas em 2 níveis; preferir promover grupos de seções a abas principais (ex.: o enriquecimento ANM do detalhe do ativo virou 3 abas principais em vez de 10 sub-abas dentro de uma só).

## Validação obrigatória
Antes de concluir qualquer tarefa, rode a verificação de tipos: `npm run check` (equivale a `npx tsc --noEmit`). Ela está registrada como etapa de validação nomeada `typecheck` do projeto e deve passar limpa — regressões de tipos bloqueiam a conclusão da tarefa.

## Changelog
- **14/08/2026 — Due Diligence (IA) removida do relatório do ativo (decisão do usuário):** a seção "Due Diligence (IA)" do relatório PDF foi removida deliberadamente a pedido do usuário; NÃO reintroduzir nem criar o "Checklist de documentos a solicitar ao titular" (era apenas o plano B caso a remoção tivesse sido um bug). Dados antigos `iaDueDiligence` em `camposEspecificos` ficam inertes e não entram no insumo do parecer consolidado.
- **14/08/2026 — Relatório do ativo, rodada 2:** regra transversal "nunca omitir módulo em silêncio" — parecer IA ausente, histórico de eventos ANM sem fonte e fontes com falha aparecem como nota explícita ("indisponível nesta geração" / "fonte não consultada", seção "Disponibilidade das fontes"); sobreposições fundiárias padronizadas como "X ha (Y% do polígono)" com rótulo de composição (parcela isolada vs soma de N parcelas) e nota de metodologia na tabela consolidada; riscos do parecer recebem injeção determinística de toda camada de restrição com ocorrência > 0 (na renderização — vale para pareceres em cache); conclusões negativas de TAH/CFEM/DOU citam bases e período coberto (nota de escopo no PDF e no digest); histórico de eventos tenta parse best-effort do rawHtml do SCM em cache.

## System Architecture
The platform is a full-stack application using React, Vite, TypeScript, Shadcn UI, and TailwindCSS for the frontend, and Express.js with TypeScript for the backend. Data is persisted using Drizzle ORM and PostgreSQL. Authentication is session-based via Passport.js with role-based access control.

### UI/UX Decisions
The UI features a premium emerald green theme with warm neutral backgrounds (less green tint), a polished dark forest green sidebar with smooth transitions, and larger border radii (1rem+) throughout all components. Cards use subtle shadows with hover elevation effects. Buttons feature pill-shaped styling with shadow depth. Inputs and selects have softer borders with elegant focus rings. The design system uses consistent rounded-2xl for cards/dialogs, rounded-xl for inputs/selects/buttons, and rounded-lg for menu items. All components include smooth transition animations. No detalhe do ativo minerário (MINA/JAZIDA), o enriquecimento ANM é dividido em 3 abas principais — ANM (Processo, Histórico, SCM, SEI, DOU), Titular & Finanças (Titular, CFEM, TAH) e Território (Geologia, Restrições, Logística) — definidas em `ANM_TAB_GROUPS` (`client/src/components/anm-enrichment-tabs.tsx`); a exportação de PDF por captura de tela percorre todos os grupos/seções (11 no total). The application supports i18n (pt, en) and dark mode with updated dark theme using slate-toned backgrounds.

### Technical Implementations
- **Data Enrichment**: External APIs and AI-powered web research (GPT-4o) for CNPJ and geographic data.
- **Asset Management**: Comprehensive portfolio management with type filtering and geographic data.
- **Asset Onboarding**: Unified tab for qualitative data enrichment and document checklist, with type-specific fields. `camposEspecificos` JSONB column is typed.
- **Document Storage**: Multi-mode system supporting local filesystem, Google Drive, and Replit Connector. Asset attachments ("Documentos Gerais") support multi-file upload and background AI text extraction (`server/lib/document-extract.ts` → `asset_document_texts` table): PDF via pdf-parse, Word via mammoth, TXT direct, images/scanned PDFs via OpenAI vision. Extracted texts feed the AI analysis prompts, with per-file status badges and on-demand reprocessing in the DocumentsPanel.
- **Geo Module**: Advanced rural prospection with scoring, SICAR status checking, and automatic geo-analysis using MapLibre GL JS. Auto-enrichment for Embrapa, DETER, and MapBiomas on import.
- **Web Enrichment Scraper**: DuckDuckGo search and website scraping for contacts, social media, SEO, and technologies.
- **AI-Powered Enrichment**: Uses GPT-4o with native web search to extract validated contacts, social media, website data, financial profiles, matching signals, decision-makers, competitive intelligence, compliance, and business intelligence.
- **ANM Enrichment**: Full module for mining due diligence with multiple sub-tabs fetching and persisting data from ANM, CPRM, and FUNAI, including AI risk assessment.
- **SCM Module**: Consulta ao Sistema de Controle de Mineração da ANM para extração do CNPJ oficial do titular via captcha resolvido pelo operador. Sub-aba "SCM" dentro de ANM no detalhe do ativo MINA. Fluxo de duas etapas: iniciar sessão → exibir captcha (imagem cacheada) → operador digita 4 chars → API submete no SCM (com delay mínimo de 4s anti-bot) → se aceito, faz segundo POST "Dados básicos" via async UpdatePanel postback (X-MicrosoftAjax + __ASYNCPOST) para dados completos → parseia HTML → extrai CNPJ/área/titular. Download de documento HTML limpo via `cleanScmHtmlForDocument()` (remove captcha, barra governo, scripts, display:none, adiciona header/footer Mavrion). Cache permanente em tabela `scm_processos`. Arquivos: `server/lib/scm-scraper.ts`, `server/routes/scm.ts`. **IMPORTANTE**: PM2 no VPS executa `dist/index.cjs` — build deve usar `--format=cjs --outfile=dist/index.cjs`.
- **CAF/PRONAF Integration**: Enriches agro assets with Cadastro da Agricultura Familiar data.
- **API Error Logging**: Persists external API errors with deduplication.
- **Service Monitoring & Caching**: External service monitoring and database-backed API caching.
- **SEI Module**: Consulta à pesquisa pública do SEI da ANM (sei.anm.gov.br) por NUP — lista de documentos/protocolos (com link público quando existir) e andamentos do processo administrativo. Sub-aba "SEI" dentro de ANM no detalhe do ativo MINA, mesmo molde do SCM: iniciar sessão → captcha digitado pelo operador (sem IA) → parse e persistência compartilhada em `sei_consultas` (keyed por NUP; nunca salva página sem dados reais — exige NUP na resposta e docs/andamentos > 0). NUP pré-preenchido do cache SCM (`scm_processos.nup`) ou digitado manualmente. Sessão do captcha é single-use, TTL 5 min; PHPSESSID nasce no endpoint do captcha e precisa ir no POST. Arquivos: `server/lib/sei-scraper.ts`, `server/routes/sei.ts`, `SeiSubTab` em `client/src/components/anm-enrichment-tabs.tsx`; testes `server/lib/__tests__/sei-scraper.test.ts` (fixtures reais em `__tests__/fixtures/sei-*.html`).
- **TAH Import (Dados Abertos ANM)**: Daily cron job downloads `Tah.csv` (~97MB) from ANM open data, parses (`;` separator, `latin1` encoding), and upserts into `tah_titulares` table indexed by processo. Integrated as first source for CNPJ resolution in the Titular tab and smart-resolve-cnpj flow, before regex/CNPJA/AI. Admin endpoint `POST /api/tah/importar` for manual trigger. Files: `server/lib/tah-importer.ts`, `server/routes/tah.ts`.
- **Dossiê da Jazida (fontes gratuitas)**: Enriquecimento do ativo minerário com CFEM (arrecadação por processo/CNPJ/município, base local `cfem_arrecadacao` importada do CSV de dados abertos da ANM — subaba "CFEM"), publicações no DOU via busca da Imprensa Nacional (subaba "DOU", cache 24h), barragens de mineração SIGBM (`sigbm_barragens`, card na subaba Restrições), certidões do titular (PGFN/CNJ/CEIS, card na subaba Titular) e furos de sondagem + geoquímica do GeoSGB (cards na subaba Geologia; serviço de sondagens é instável — fallback `disponivel:false`). Resultados persistidos em camposEspecificos (`anmCfem`, `anmDou`, `anmBarragens`, `anmCertidoesTitular`, `anmSondagem`, `anmGeoquimica`) e incorporados ao parecer IA e ao relatório do ativo. Atualização das bases via connectors agendados (`cfem_import` mensal, `sigbm_import` semanal) ou `POST /api/cfem/importar` / `POST /api/sigbm/importar` (admin). Import CFEM aceita arquivo local via env `CFEM_CSV_LOCAL_FILE` (WAF da ANM derruba streams longos; baixar com curl antes). Files: `server/lib/cfem-importer.ts`, `server/lib/sigbm-importer.ts`, `server/lib/dou.ts`, `server/routes/dossie.ts`.
- **Scheduler & Audit**: `node-cron` for job scheduling and entity change tracking.
- **Norion Portal do Cliente**: Client-facing portal with CPF-only login and admin review workflow.
- **Real-time Notifications**: Implemented via Server-Sent Events (SSE).
- **Dashboard & KPIs**: Indicadores de ativos e empresas.
- **Connectors**: Manages API, scraper, and database connectors.
- **Atomic Asset Enrichment**: TODA escrita em `camposEspecificos` é merge atômico jsonb (`||`): `storage.updateAsset` mescla a chave quando presente (PATCH de ativos incluído) e `storage.mergeAssetCampos` cobre fluxos server-side. Convenção: o cliente envia SOMENTE as chaves alteradas (delta), nunca o objeto inteiro — espalhar cópia local desatualizada era o que apagava enriquecimentos concorrentes. Para limpar um valor, enviar a chave com `null`. Regressão coberta por `script/test-enrichment-concurrency.ts` (npx tsx).
- **Atomic Operations**: Critical workflows use database transactions.
- **Multi-Tenant Isolation**: All data access filtered by `orgId`.
- **Showcase / Vitrine Feature**: Public asset showcase with whitelisted columns.
- **Reporting**: Comprehensive reports page with tabs and filtering options.

## External Dependencies
- **PostgreSQL**: Primary database.
- **Resend SDK**: Email communication.
- **cnpja.com API**: CNPJ data enrichment.
- **Agência Nacional de Mineração (geo.anm.gov.br)**: Mining process data.
- **SICARIOn API (api.mavrionconnect.com.br)**: SICAR/CAR rural property data with altitude filtering.
- **IBGE WFS / OpenStreetMap Overpass API**: Geographic data.
- **OpenTopoData SRTM 30m**: Elevation data.
- **node-cron**: Job scheduling.
- **Google Drive**: Cloud document storage.
- **SheetJS (`xlsx`)**: Spreadsheet exports.
- **SoilGrids (ISRIC)**: Soil data.
- **Embrapa AgroAPI**: Climactic, ZARC, and NDVI/EVI data.
- **SICAR PostGIS Local DB**: CCIR/fundiário data via coordinate-based lookup. Connects to `mavrion_api_db` via `SICAR_DATABASE_URL` (production only — the VPS `.env` must use the same credential as `/var/www/mavrion-api/.env`; pm2 requires `pm2 restart ecosystem.config.cjs --update-env`). In dev the variable is intentionally absent: the code logs a single explicit note ("SICAR_DATABASE_URL não configurada") and skips the fallback without error. Extracts property code, area, módulos fiscais, classificação fundiária, and cross-references CAF producers.
- **Banco Central do Brasil (BCB) OData API**: SICOR/PRONAF rural credit data.
- **ViaCEP**: Address auto-fill.
- **AwesomeAPI (economia.awesomeapi.com.br)**: Currency exchange rates and Ibovespa data.
- **BCB SGS API (api.bcb.gov.br)**: Selic rate.
- **OpenAI GPT-4o**: AI-powered analysis and agents.
- **DataStone API (api.datastone.com.br/v1)**: Company enrichment.
- **DETER/INPE (TerraBrasilis)**: Deforestation alerts.
- **MapBiomas Alerta GraphQL v2**: Environmental data.
- **IBAMA — Local Database**: IBAMA infraction data.
