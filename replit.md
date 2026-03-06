# Mavrion Connect — B2B Deal Origination Platform

## Overview
Mavrion Connect is a comprehensive B2B platform designed to streamline deal origination for real estate and M&A fund operations. It integrates SDR lead management, dual CRM pipelines (INVESTOR + ASSET), sophisticated asset-investor matching, CNPJ enrichment, dynamic proposal/contract generation, email automation, robust analytics, and a public investor portal. The platform aims to be a full-stack solution, branded with an emerald green theme, maximizing deal flow efficiency for funds.

## User Preferences
I prefer detailed explanations. I want iterative development. Ask before making major changes. Do not make changes to folder `server/enrichment/`. Do not make changes to file `client/src/index.css`.

## System Architecture
The platform is a full-stack application utilizing React, Vite, TypeScript, Shadcn UI, and TailwindCSS for the frontend, and Express.js with TypeScript for the backend. Data persistence is handled by Drizzle ORM and PostgreSQL. Authentication is session-based via Passport.js with role-based access control.

### UI/UX Decisions
The primary theme is emerald green with a dark forest green sidebar. Navigation follows a streamlined 8-item sidebar: Dashboard, Ativos (expandable by type), Matching, CRM (expandable: Kanban, Empresas, Fila SDR, Propostas, Contratos), Prospecção (expandable: CNPJ, M&A Radar), Portal, Honorários, Configurações (Sistema section for admin). Enrichment tools (Geo, Embrapa, ANM, CAF) live inside asset detail tabs — not as standalone sidebar links. Rural/SICAR and ANM discovery pages still exist as routes but were removed from the sidebar for a cleaner navigation. The Investor Portal offers a premium, public-facing interface with dynamic landing pages.

### Technical Implementations
- **Data Enrichment**: Web scraping (Python 3) and CNPJ enrichment via external API.
- **CRM & Deal Management**: Dual Kanban pipelines (INVESTOR, ASSET) with customizable stages, drag-and-drop functionality, and detailed deal cards including commission/fee control.
- **Asset Management**: Comprehensive portfolio management with type filtering and integration with geographic data.
- **Proposal & Contract Generation**: Dynamic generation from templates.
- **Matching Engine v3 (Intelligent, Modular)**: Modular architecture with scoring logic extracted into `server/lib/smart-matching.ts`. 8-category scoring: tipo ativo (40pts), ticket (35pts), região (20pts), documentação (10pts), risco (±10pts with geoScore + irregular docs penalty), urgência (new <30d +15, old >180d -5), diversificação (portfolio concentration % analysis: >60% type = -10, >50% region = -5, new type +15, new region +10), histórico (discrete thresholds: 3+ rejections -20, 2+ accepts +15 + rejection reason analysis). Score 0-100 with `confidence` field (alta/media/baixa based on data completeness) and `explanation` (human-readable summary). `reasonsJson` includes `{ reasons, penalties, breakdown, confidence, explanation, version: "v3" }`. Tables: `match_feedback` (action/rejection tracking), `investor_dynamic_profile` (learned type/region weights, real ticket range, decision speed, risk tolerance). Endpoints: `POST /api/matching/suggestions/:id/feedback`, `GET /api/matching/investors/:id/dynamic-profile`, `POST /api/matching/investors/:id/recalculate-profile`. Auto-records feedback on accept. Strategic buyer matching via CNAE codes with deduplication. Auto-matching on asset creation. Key module exports: `calculateSmartScore()`, `buildMatchingContext()`, `updateInvestorDynamicProfile()`, `analyzeAssetRisk()`, `calcAssetUrgency()`, `calcDiversificationBonus()`, `calcHistoryAdjustment()`, `normalizeState()`, `matchesRegion()`.
- **Prospecção Reversa**: Queries external APIs for buyer companies matching an asset's type, state, and substance, with results displayed on the asset detail page and import-to-CRM capability. On import, automatically creates a `matchSuggestion` (tipo "estrategico") linking the company to the asset via `POST /api/matching/assets/:assetId/add-buyer`, so the buyer appears in the Matching page.
- **Geo Module**: Advanced rural prospection with scoring (Water, Energy, Altitude, Declivity, Area), SICAR status checking with persistent caching, and offline resilience. Auto-triggers geo analysis on ANM asset import — background process runs IBGE/OSM/elevation APIs and persists geoScore, altitude, declivity, water/energy proximity immediately after asset creation.
- **Análise Agro**: Standalone page for soil, ZARC, productivity, and SIGEF analysis, leveraging external APIs for enrichment.
- **Inteligência Agro**: Dashboard ranking assets by quality score, featuring medal-ranked cards, detail modals, and batch enrichment. Includes intelligent caching for Embrapa data.
- **NDVI Variabilidade & Zonas de Manejo**: Samples NDVI across a grid within the asset polygon, returning per-point values, statistics, management zones, and alerts, visualized as an interactive Leaflet heatmap.
- **M&A Module**: Facilitates searching for active Brazilian companies and initiating deals. Each result row offers two actions: "Salvar empresa" (imports company + creates SDR lead with `source="ma_radar"`) and "Iniciar Tratativa" (imports + creates CRM deal). Already-saved companies show "Já no CRM" badge.
- **SDR Enhancements**: Inline notes per lead (`notes text` + `updated_at` columns), source-based filtering (portal, prospecção, M&A, CAF), "Última atividade" idle badge, "Já no CRM" deal badge, "Ver empresa" link, and "Criar Deal" dialog with asset linking.
- **Asset Detail Tabs**: Per-type tab configuration via `ABAS_POR_TIPO`. TERRA/AGRO show [info, documentos, matches, geo, embrapa, caf]. MINA shows [info, documentos, matches, anm, geo]. NEGOCIO shows [info, documentos, matches, empresa]. FII_CRI shows [info, documentos, matches, cvm]. The "matches" tab combines deal negotiations and reverse prospecting in one view. The GEO tab reads geographic data from first-level Drizzle columns (`ativo.geoAltMed`, `ativo.geoScore`, `ativo.geoTemRio`, etc.) — NOT from `camposEspecificos`. It displays the asset polygon on a Leaflet map (fetched from PostGIS `geom` column via `GET /api/matching/assets/:id/geometry`), coordinates/IBGE code from `camposEspecificos`, and SICAR code from `ativo.carCodImovel`. Includes "Atualizar análise" button that calls `/api/geo/analisar` then `/api/geo/persist-analysis`. The `persist-analysis` endpoint auto-populates `codigoIbge` via Nominatim reverse geocoding when missing, and auto-calculates `area_ha` from the PostGIS polygon when the field is NULL. The CAF/PRONAF tab auto-loads SICOR/BCB rural credit data when `codigoIbge` exists (no manual button needed) and auto-loads CAF producers when `estado` is set.
- **Service Monitoring & Caching**: External service status monitoring and a database-backed API cache with TTLs.
- **Scheduler & Audit**: `node-cron` for job scheduling and a system for tracking all entity changes.
- **Norion Portal do Cliente**: CPF-only login for end clients, including a multi-step wizard form for data entry, document upload to Google Drive, and admin review/approve flow.
- **Integration with Google Drive**: Via `@replit/connectors-sdk` (Replit Connector for dev) or `googleapis` (Service Account for production). Unified in `server/lib/google-drive.ts` — used by both `documents.ts` and `commercial.ts` routes.
- **Real-time Notifications**: Server-Sent Events (SSE) for key user notifications.
- **Dashboard & KPIs**: Rich dashboard with 12+ KPI widgets (ativos, deals, volume, matches, empresas, portfólio value, área total, leads qualificados, fees, geo score, R$/ha), pipeline bar chart, pie charts (ativos por tipo, deals por prioridade), line/area charts (deals/empresas mensais 6m), activity feed, stalled deals, high-priority deals, portal leads, upcoming closings, assets by state. Bottom section includes real-time financial quotes (Dólar, Euro, Bitcoin, Selic, Ibovespa, CDI via AwesomeAPI + BCB API) and weather widget (São Paulo via Open-Meteo).
- **Connectors**: Manages API, scraper, and database connectors with JSON configuration.
- **Portal→CRM Integration**: Public inquiries are scored for intent and automatically create Companies, Leads, and Deals, with rate limiting.
- **Atomic Operations**: Database transactions ensure atomicity for critical workflows.
- **Multi-Tenant Isolation**: All storage methods (`getDeals`, `getAssets`, `getInvestors`, `getMatchSuggestions`, `getLeadsQueue`, `getCompanies`, `getContacts`) accept and filter by `orgId`. All CRM and Matching routes validate resource ownership (`orgId` check) before returning or modifying data. `getOrgId(req)` extracts org from session user, falling back to `DEFAULT_ORG_ID`.

## VPS Deployment
- **VPS**: `187.77.232.164`, SSH as `root`
- **Domain**: `https://mavrionconnect.com.br` (SSL Let's Encrypt, auto-renew)
- **App directory**: `/var/www/mavrion-conect`
- **PM2 process**: `mavrion-conect` (id 3, `dist/index.cjs`, port 5000), `norion` (id 2, port 5001)
- **Production DB**: `postgresql://mavrion:***@localhost:5432/mavrion_conect`
- **Nginx**: Reverse proxy with SSL at `/etc/nginx/sites-enabled/mavrion-conect` (443 → 5000, HTTP→HTTPS redirect)
- **GitHub repo**: `mavriondev/mavrion-conect` (branch `main`)
- **DB migrations**: Applied via `psql` ALTER TABLE commands (drizzle-kit push NOT used in production)
- **Last deployed**: 2026-03-06

### Deploy Scripts
- **`scripts/vps-install.sh`** — Primeira instalação em VPS limpa. Provisiona PostgreSQL, Node.js, PM2, Nginx, SSL, clona do GitHub, cria `.env` interativo. Executar como root na VPS.
- **`scripts/vps-update.sh`** — Atualização/redeploy. Puxa do GitHub, faz build, reinicia PM2 com health check e rollback automático se falhar. NÃO toca no `.env` nem no banco. Executar como root na VPS.

### Deploy Manual (alternativo)
1. Subir código: `tar czf` do Replit → `scp` → extract na VPS (ou push para GitHub + pull na VPS)
2. Build: `npm ci && npm run build`
3. Restart: `pm2 restart mavrion-conect --update-env`
4. Migrações: `psql` com `ALTER TABLE` (nunca `drizzle-kit push` em produção)

## External Dependencies
- **PostgreSQL**: Primary relational database.
- **Resend SDK**: For email communication.
- **cnpja.com API**: For CNPJ search and data enrichment.
- **Agência Nacional de Mineração (geo.anm.gov.br)**: For mining process data.
- **SICAR (geoserver.car.gov.br)**: For rural property data.
- **IBGE WFS**: For geographic data (hydrography, energy, water bodies), with OpenStreetMap Overpass as a fallback.
- **OpenStreetMap Overpass API**: Fallback for IBGE WFS.
- **OpenTopoData SRTM 30m**: For elevation data.
- **node-cron**: For scheduling background jobs.
- **Google Drive**: For cloud storage of documents.
- **SheetJS (`xlsx`)**: For generating spreadsheet exports.
- **SoilGrids (ISRIC)**: For soil data.
- **Embrapa AgroAPI**: For climactic, ZARC, and NDVI/EVI data via ClimAPI, Agritec v2, and SATVeg v2.
- **Infosimples API**: For SIGEF/INCRA parcel data.
- **Banco Central do Brasil (BCB) OData API**: For SICOR/PRONAF rural credit data.
- **ViaCEP**: For address auto-fill by CEP.
- **AwesomeAPI (economia.awesomeapi.com.br)**: For real-time USD/BRL, EUR/BRL, BTC/BRL exchange rates (dashboard + showcase) and Ibovespa data.
- **BCB SGS API (api.bcb.gov.br)**: For Selic rate on the dashboard.

## Relatórios (Reports) Page
10 tabs: Geral, Empresas, Deals, Ativos, M&A, Funil M&A, Honorários, Geográfico, Leads, Atividades. 8 filters: período, pipeline type, asset type, UF, prioridade, fee status, origem (source). Honorários tab shows fees totais/recebidos/pendentes, ticket médio fee, monthly stacked chart, fee type pie, top deals by fee. Geográfico tab shows assets by município, R$/ha by state, water/energy/CAR/ANM counts, state summary table. Leads tab shows lead scoring distribution, status bar chart, monthly evolution, top leads by score.

## Showcase / Vitrine Feature
Public asset showcase page accessible at `/vitrine/:id` (no auth required). Backend API: `GET /api/public/showcase/:id` with explicit column whitelisting (no `SELECT *`). Sensitive data (CNPJ, matrícula, financial details, raw certidões) is excluded from the public response. Pre-validation endpoint: `GET /api/matching/assets/:id/showcase-check`. Asset photos stored in `assets.fotos` JSONB column, uploaded via `POST /api/upload/images`. Showcase contact phone/WhatsApp configured via `showcase_phone`/`showcase_whatsapp` org settings in Configurações. Showcase includes WhatsApp FAB button (bottom-right) when `showcase_whatsapp` is configured, linking to `wa.me/{number}` with pre-filled message.

## i18n & Theming
- **i18n**: `client/src/lib/i18n.ts` provides `I18nContext` with `lang`, `setLang`, `t()` function. Supported: `pt` (default), `en`. Language selector component with flag icons in `client/src/components/language-selector.tsx`. Language persisted in `localStorage` key `mavrion-lang`. `t()` supports template args: `t("key", arg0)` → replaces `{0}`. Helpers: `getDateLocale(lang)`, `formatDatePattern(lang)`, `formatDayPattern(lang)`.
- **i18n coverage**: Dashboard fully wired. Reports page (`relatorios.tsx`) fully wired — all 10 tabs (Geral, Empresas, Deals, Ativos, M&A, Funil M&A, Honorários, Geográfico, Leads, Atividades), all KPI tiles, chart titles/tooltips/legends, filter placeholders, empty states, and sub-components (ActivityFeed, FunilConversao). Option hooks (`usePeriodOptions`, `usePipelineTypeOptions`, `useAssetTypeOptions`, `usePriorityOptions`, `useFeeStatusOptions`, `useSourceOptions`) provide language-reactive filter options.
- **Theme**: `client/src/components/theme-provider.tsx` provides `ThemeContext` with `theme`, `setTheme`, `toggleTheme`. Dark mode uses Tailwind `class` strategy (`darkMode: ["class"]`). Theme persisted in `localStorage` key `mavrion-theme`. Toggle button in sidebar footer.
- Both providers wrapped in `App.tsx`: `ThemeProvider > I18nProvider > TooltipProvider`.