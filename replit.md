# Mavrion Conect — B2B Deal Origination Platform

## Overview
Mavrion Conect is a comprehensive B2B platform designed to streamline deal origination for real estate and M&A fund operations. It integrates SDR lead management, dual CRM pipelines (INVESTOR + ASSET), sophisticated asset-investor matching, CNPJ enrichment, dynamic proposal/contract generation, email automation, robust analytics, and a public investor portal. The platform aims to be a full-stack solution, branded with an emerald green theme, maximizing deal flow efficiency for funds. It also includes a standalone Norion Capital application for credit operations.

## User Preferences
I prefer detailed explanations. I want iterative development. Ask before making major changes. Do not make changes to folder `server/enrichment/`. Do not make changes to file `client/src/index.css`.

## System Architecture
The platform is a full-stack application utilizing React, Vite, TypeScript, Shadcn UI, and TailwindCSS for the frontend, and Express.js with TypeScript for the backend. Data persistence is handled by Drizzle ORM and PostgreSQL. Authentication is session-based via Passport.js with role-based access control.

### UI/UX Decisions
The primary theme is emerald green with a dark forest green sidebar. Navigation is organized through a 6-section sidebar with expandable, permission-based sub-menus. The Investor Portal offers a premium, public-facing interface with dynamic landing pages. The Norion Capital application features a distinct dark navy horizontal top navbar with amber accents.

### Technical Implementations
- **Data Enrichment**: Web scraping (Python 3) and CNPJ enrichment via external API.
- **CRM & Deal Management**: Dual Kanban pipelines (INVESTOR, ASSET) with customizable stages, drag-and-drop functionality, and detailed deal cards.
- **Asset Management**: Comprehensive portfolio management with type filtering and integration with geographic data.
- **Proposal & Contract Generation**: Dynamic generation from templates.
- **Matching Engine**: A scoring algorithm matches assets to investors based on multiple criteria, preventing re-matching of rejected suggestions.
- **Geo Module**: Advanced rural prospection with scoring (Water, Energy, Altitude, Declivity, Area), agro enrichment (SoilGrids, Embrapa AgroAPI, SIGEF/INCRA), and specific analysis endpoints.
- **M&A Module**: Facilitates searching for active Brazilian companies and initiating deals.
- **Norion Capital Application**: A standalone frontend for credit operations, sharing the same backend and database. Features a table-based operations view with filterable columns (empresa, CNPJ, valor, finalidade, etapa, docs, matching score). Includes a Home Equity checklist and a detailed "Defesa do Crédito" form.
- **Service Monitoring & Caching**: External service status monitoring and a database-backed API cache with TTLs.
- **Scheduler & Audit**: `node-cron` for job scheduling and a system for tracking all entity changes.
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

## Norion Capital — Operations Module
- **Table View**: Replaced Kanban with a sortable/filterable table showing: Empresa, CNPJ, Valor Solicitado, Finalidade, Etapa (badge colorido), Docs (progress bar), Melhor Match (% do fundo mais compatível), Data.
- **KPIs**: Cards at top showing total operations, approved volume, in analysis, approval rate.
- **Filters**: Stage badges (multi-select), text search, value range, finalidade dropdown.
- **Detail Drawer**: Sheet lateral with DocumentChecklist, EnviosFundosSection, DefesaCreditoSection, PortalAccessSection, FormularioClienteSection.
- **Stage Management**: Dropdown per row instead of drag-and-drop.
- **Fund Matching**: Background calculation of best match score displayed per operation row.

## Client Portal (Norion)
- **Tables**: `norion_client_users` (client access), `norion_formulario_cliente` (wizard form data), `norion_documents` (with `client_user_id` for standalone access).
- **Login**: CPF/CNPJ only (no token) via `POST /api/norion-portal/login-cpf`. Looks up client by taxId.
- **Routes**: `server/routes/norion-portal.ts` — endpoints for login, docs, file upload, CEP/CNPJ lookup, wizard form.
- **Admin**: `POST /api/norion/operations/:id/gerar-acesso-cliente` — generates a 30-day access link for the client.
- **Standalone Access**: `POST /api/norion/gerar-acesso-avulso` — creates client access without requiring an existing operation. Documents are linked via `clientUserId` instead of `operationId`.
- **Frontend**:
  - `/portal-cliente` — login page (CPF/CNPJ only, no token field).
  - `/portal-cliente/formulario` — 6-step wizard form (Dados Pessoais → Endereço → Profissional → Crédito → Patrimônio → Documentos).
  - `/portal-cliente/dashboard` — document upload dashboard with progress tracking.
- **Files**: `portal-cliente.tsx`, `portal-cliente-formulario.tsx`, `portal-cliente-dashboard.tsx`.
- **Wizard Form**:
  - Auto-saves on each step navigation (PATCH /api/norion-portal/formulario).
  - CEP auto-fill (ViaCEP) and CNPJ lookup (cnpja.com) integrated. CNPJ also fills address fields (Step 2) when empty.
  - Currency fields use centavos-first approach (CurrencyInput component): internal state as digit string, formatted display, saves as number.
  - Status flow: `rascunho` → `enviado` → `em_revisao` (admin requests changes) → `aprovado`.
  - Step 6 shows document checklist (CHECKLIST_HOME_EQUITY) — works for both operation-linked and standalone access via `clientUserId`.
  - Read-only when status is "enviado" or "aprovado".
  - Shows revision banner with admin's observation when status is "em_revisao".
- **Admin Review**:
  - Dedicated page at `/norion-app/portal-clientes` (`portal-clientes-admin.tsx`) — accessible via "Portal Clientes" nav item in Norion top bar.
  - Lists all submitted client forms with search, status filters (Todos/Enviados/Em Revisão/Aprovados), expandable cards with full form data and documents.
  - Admin can "Aprovar" or "Pedir Revisão" (with observation text).
  - **Connected Flow**: After approving, admin clicks "Criar Operação e Buscar Fundos" → system creates company + operation + migrates documents + runs fund matching → shows top compatible funds inline with "Enviar" button per fund.
  - Endpoint: `POST /api/norion/formulario/:id/criar-operacao` — creates company, operation, migrates docs, returns matching results.
  - Also available inline in operation detail via `FormularioClienteSection` in `operacoes.tsx`.
  - Endpoints: `GET /api/norion/formularios-pendentes`, `PATCH /api/norion/formulario/:id/aprovar`, `PATCH /api/norion/formulario/:id/revisar`.
- **Auth**: Token-based via `x-portal-client-id` and `x-portal-token` headers (no session).
- **Upload**: Base64-encoded files → Google Drive via `uploadToDrive()`.

## Connected Flow (Portal → Operation → Funds)
```
1. Admin gera acesso avulso (CPF/CNPJ) → Cliente faz login
2. Cliente preenche wizard 6 steps + envia documentos
3. Admin revisa formulário → Aprova
4. Admin clica "Criar Operação e Buscar Fundos"
   → Cria empresa (se não existir) com dados do formulário
   → Cria operação com diagnóstico preenchido
   → Migra documentos do clientUserId → operationId
   → Executa matching com fundos parceiros
5. Admin vê ranking de fundos (score 0-100%) com motivos
6. Admin envia para fundo(s) com 1 click
7. Acompanha status por fundo (enviado → em análise → aprovado/recusado)
```

## Geo-Rural Agro Tab
- **Standalone "Análise Agro" tab** in geo-rural.tsx — works without SICAR, accepts manual lat/lon + optional CNPJ/cultura.
- Calls `POST /api/geo/enriquecer-agro` and displays SoilGrids, ZARC aptidão, productivity, and SIGEF parcels.

## CAF Crawler v4 (Dual Strategy: JSON API + HTML Scraping)
- **Service**: `server/services/caf-crawler.ts` — dual strategy extractor for CAF 3.0 (`caf.mda.gov.br`).
  - **Strategy 1 (Primary)**: REST API JSON at `GET /api/ufpa/consulta-publica` with params: `uf`, `codigoMunicipio` (IBGE code), `idSituacao` (1=ATIVA), `pagina`, `tamanhoPagina`. Returns partially masked data (nome, cpf, numeroCaf, situacao, grauParentesco, idUfpa).
  - **Strategy 2 (Fallback)**: HTML scraping with cheerio — attempts to load NUFPA detail pages and extract structured data (nome, cpf, área, PRONAF, membros, etc.).
  - **Two execution modes**:
    - `paginado`: Uses API pagination to scan by UF/município. Fast and efficient. Groups results by `idUfpa`.
    - `sequencial`: Generates NUFPAs sequentially (`montarNufpa()`), tries API first then HTML scraping fallback. Stops after 50 consecutive 404s (`MAX_404_CONSECUTIVOS`).
  - Types: `CafLead` (extracted data), `CafCrawlerJob` (scan control).
  - Exports: `consultarNufpa()`, `executarCrawlerCAF()`, `cancelarJob()`, `montarNufpa()`, `passaNosFiltos()`, `calcularPerfilNorion()`.
  - `calcularPerfilNorion()`: Scores leads (alto/medio/baixo) based on area, PRONAF, status, imóveis, membros, condição de posse, atividade.
  - NUFPA format: `${UF}03${ano}.${mes.padStart(2)}.${seq.padStart(9)}CAF`.
  - Config: 1.1s delay between requests, 15s timeout, SSL bypass (`rejectUnauthorized: false`).
  - Filters: `apenasAtivos`, `apenasProprietario`, `apenasComPronaf`, `areaMinHa`, `municipio` (name, post-filter).
- **Routes**: `server/routes/caf-extrator.ts` — registered in `routes.ts`.
  - `GET /api/caf-extrator/testar?nufpa=XX` — test single NUFPA lookup (API + HTML fallback).
  - `POST /api/caf-extrator/varredura` — start scan with `modo` param (`paginado`|`sequencial`), uf, codIBGE, seqInicio, seqFim, filters.
  - `GET /api/caf-extrator/varredura/:id` — scan progress/status.
  - `POST /api/caf-extrator/varredura/:id/cancelar` — cancel active scan.
  - `GET /api/caf-extrator/varreduras` — list all active scans.
  - Leads are saved to `norionCafRegistros` table with field mapping: nome→nomeTitular, cpfMascarado→cpfTitular, nufpa→numeroUFPA, situacao→status, uf, municipio, areaHa, condicaoPosse, atividade→atividadePrincipal, enquadramentoPronaf, membros→composicaoFamiliar, entidadeCadastradora→entidadeNome, dataValidade→validade, dataInscricao, numImoveis. Extra: idUfpa, grauParentesco, classificacao, norionProfile, extraidoEm in `dadosExtras`.
- **Frontend**: `client/src/pages/norion/caf.tsx` — CrawlerSection with mode selector (API Paginada / Sequencial NUFPA), UF, max registros, IBGE code (paginado only), seq início (sequencial only), município filter, checkboxes for ativos/proprietário/PRONAF. Progress bar adapts to mode.
