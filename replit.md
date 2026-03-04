# Mavrion Conect — B2B Deal Origination Platform

## Overview
Mavrion Conect is a comprehensive B2B platform designed to streamline deal origination for real estate and M&A fund operations. It integrates SDR lead management, dual CRM pipelines (INVESTOR + ASSET), sophisticated asset-investor matching, CNPJ enrichment, dynamic proposal/contract generation, email automation, robust analytics, and a public investor portal. The platform aims to be a full-stack solution, branded with an emerald green theme, maximizing deal flow efficiency for funds.

**Norion Capital** has been separated into a fully independent standalone application in `norion-standalone/`. It has its own backend, frontend, schema, and is designed to run as a separate Replit project with its own database. See `norion-standalone/README.md` for setup instructions.

## User Preferences
I prefer detailed explanations. I want iterative development. Ask before making major changes. Do not make changes to folder `server/enrichment/`. Do not make changes to file `client/src/index.css`.

## System Architecture
The platform is a full-stack application utilizing React, Vite, TypeScript, Shadcn UI, and TailwindCSS for the frontend, and Express.js with TypeScript for the backend. Data persistence is handled by Drizzle ORM and PostgreSQL. Authentication is session-based via Passport.js with role-based access control.

### UI/UX Decisions
The primary theme is emerald green with a dark forest green sidebar. Navigation is organized through a 6-section sidebar with expandable, permission-based sub-menus. The Investor Portal offers a premium, public-facing interface with dynamic landing pages. The Norion Capital application features a distinct dark navy horizontal top navbar with amber accents.

### Technical Implementations
- **Data Enrichment**: Web scraping (Python 3) and CNPJ enrichment via external API.
- **CRM & Deal Management**: Dual Kanban pipelines (INVESTOR, ASSET) with customizable stages, drag-and-drop functionality, and detailed deal cards. Commission/fee control per deal (feeType, feePercent, feeValue auto-calculated, feeStatus, feeNotes) in the deal detail panel.
- **Asset Management**: Comprehensive portfolio management with type filtering and integration with geographic data.
- **Proposal & Contract Generation**: Dynamic generation from templates.
- **Matching Engine**: A scoring algorithm matches assets to investors based on multiple criteria, preventing re-matching of rejected suggestions. Includes strategic buyer matching via CNAE codes — companies with `buyerType=estrategico` or `cnaeInteresse` are matched against assets by sector (CNAE→tipo mapping), region, and documentation status. Auto-matching on asset creation for `oferta_recebida`/`indicacao` origins with deduplication.
- **Prospecção Reversa**: `GET /api/prospeccao/reversa` route queries CNPJA API for buyer companies matching an asset's type (CNAE mapping), state, and substance (for MINA). Results displayed in "Compradores" tab on asset detail page with import-to-CRM capability.
- **Geo Module**: Advanced rural prospection with scoring (Water, Energy, Altitude, Declivity, Area) and specific analysis endpoints. SICAR status checking with offline resilience.
- **Análise Agro**: Standalone page (`/analise-agro`) for soil, ZARC, productivity, and SIGEF analysis — separated from Prospecção Rural since it works independently of SICAR. Uses `POST /api/geo/enriquecer-agro` (SoilGrids, Embrapa AgroAPI, SIGEF/INCRA).
- **Inteligência Agro**: Dashboard page (`/inteligencia-agro`) ranking TERRA/AGRO assets by quality score (NDVI 40% + Solo 30% + Zoneamento 30%). Features medal-ranked cards, detail modals (solo/clima/culturas/ndvi), batch "Analisar todos" Embrapa enrichment, and type/score filters. Uses existing `/api/matching/assets` + `/api/matching/assets/:id/enriquecer-embrapa` endpoints.
- **M&A Module**: Facilitates searching for active Brazilian companies and initiating deals.
- **Norion Capital Application**: A standalone frontend for credit operations, sharing the same backend and database. Features a table-based operations view with filterable columns (empresa, CNPJ, valor, finalidade, etapa, docs, matching score). Includes a Home Equity checklist and a detailed "Defesa do Crédito" form.
- **Service Monitoring & Caching**: External service status monitoring and a database-backed API cache with TTLs.
- **Scheduler & Audit**: `node-cron` for job scheduling and a system for tracking all entity changes.
- **Norion Portal do Cliente**: CPF-only login for end clients, 6-step wizard form (dados pessoais → endereço → profissional → operação → patrimônio → documentos), document upload to Google Drive, admin review/approve flow. Auth guards on admin routes, token expiration enforced on login-cpf.
- **Integration with Google Drive**: For document uploads.
- **Real-time Notifications**: Server-Sent Events (SSE) for key user notifications.
- **Dashboard & KPIs**: Displays key performance indicators with trend analysis.
- **Connectors**: Manages API, scraper, and database connectors with JSON configuration.
- **Portal→CRM Integration**: Public inquiries are scored for intent and automatically create Companies, Leads, and potentially Deals, with rate limiting.
- **Atomic Operations**: Database transactions ensure atomicity for critical workflows like matching acceptance and lead promotion.
- **Single-Tenant Architecture**: Enforces tenant isolation by injecting `orgId` server-side and preventing client-side `orgId` submissions.

## External Dependencies
- **PostgreSQL**: Primary relational database.
- **Resend SDK**: For email communication.
- **cnpja.com API**: For CNPJ search and data enrichment.
- **Agência Nacional de Mineração (geo.anm.gov.br)**: For mining process data.
- **SICAR (geoserver.car.gov.br)**: For rural property data.
- **IBGE WFS**: For geographic data (hydrography, energy, water bodies).
- **OpenTopoData SRTM 30m**: For elevation data.
- **node-cron**: For scheduling background jobs.
- **Google Drive**: For cloud storage of documents.
- **SheetJS (`xlsx`)**: For generating spreadsheet exports.
- **SoilGrids**: For soil data (pH, clay, SOC, nitrogen, CEC, water).
- **Embrapa AgroAPI**: For agricultural suitability (ZARC, cultivars, productivity).
- **Infosimples API**: For SIGEF/INCRA parcel data.
- **Banco Central do Brasil (BCB) OData API**: For SICOR/PRONAF rural credit data.
- **ViaCEP**: For address auto-fill by CEP in the Client Portal.

## Norion Capital (SEPARATED — see `norion-standalone/`)
Norion Capital has been fully separated into an independent standalone application. All Norion routes, pages, and components have been removed from this Mavrion Conect codebase. The Norion database tables remain in `shared/schema.ts` to preserve existing data, and `server/routes/companies.ts` still references norionOperations/norionCafRegistros for cascade deletes (this is correct).

The standalone app lives in `norion-standalone/` and is designed to be deployed as a separate Replit project. See `norion-standalone/README.md` for setup and configuration details.

## Ativos (Portfólio de Ativos)
- **Schema columns**: `statusAtivo` (rascunho/em_validacao/ativo/em_negociacao/fechado/arquivado), `camposEspecificos` (jsonb — stores type-specific fields, origem, ofertante data), `activityLog` (jsonb).
- **Campos Específicos por Tipo**: MINA (processo ANM, substância, fase, situação, validade, último evento), TERRA (código CAR, validade CAR, CCIR, ITR, aptidão agrícola, SIGEF), AGRO (CAR, culturas, armazenagem, silos), FII_CRI (registro CVM, gestora, DY, P/VP), DESENVOLVIMENTO (alvará, VGV, estágio obra), NEGOCIO (CNPJ, faturamento, EBITDA, múltiplo, motivo venda).
- **Origem do Ativo**: prospeccao_interna, oferta_recebida, indicacao, portal_publico — stored in `camposEspecificos.origemAtivo`.
- **Ofertante Data**: When origin is `oferta_recebida` or `indicacao`, additional fields (nome, telefone, email, observações) stored in `camposEspecificos`.
- **Urgência Documental**: Auto-detects expiring CAR/ANM/Alvará dates (≤90 days) and shows AlertTriangle badge on card.
- **Card Badges**: Status badge (when not "ativo"), urgency badge (when docs expiring), origem badge (when not "prospeccao_interna").

## Empresas Module
- **Filters**: Text search, Porte (ME/EPP/Demais), Estado (UF), Cidade, and **status filter tags** (Novo, Na fila, Em progresso, Contactado, Qualificado, Descartado, Sem Lead) — all combinable.
- **Selection & Batch Actions**: Checkbox per company card, sticky batch action bar with "Excluir selecionadas" (with confirmation dialog) and "Limpar seleção".
- **Delete**: Individual delete button (trash icon) per card with confirmation dialog. Cascade deletes leads, contacts, deals, proposals, contracts, norionOperations, norionCafRegistros, and nullifies assets.linkedCompanyId.
- **Routes**: `DELETE /api/companies/:id` (single), `POST /api/companies/batch-delete` (batch with `{ids: [...]}`) — both authenticated + org-scoped.
- **Modes**: `/empresas` (all), `/empresas/leads` (active leads), `/empresas/desqualificadas` (disqualified).

## Geo-Rural Agro Tab
- **Standalone "Análise Agro" tab** in geo-rural.tsx — works without SICAR, accepts manual lat/lon + optional CNPJ/cultura.
- Calls `POST /api/geo/enriquecer-agro` and displays SoilGrids, ZARC aptidão, productivity, and SIGEF parcels.

## CAF Module (Agricultura Familiar) — MOVED TO NORION STANDALONE
- **Status**: Moved to `norion-standalone/` as part of Norion separation. CAF pages, routes, and crawler are now in the standalone app.
- **Mavrion files preserved**: `server/routes/caf-extrator.ts`, `server/services/caf-crawler.ts` (still used by Mavrion's CAF data).
- **Schema**: `norionCafRegistros` table still in `shared/schema.ts` — do not remove.
