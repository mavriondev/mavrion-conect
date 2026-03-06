# MAVRION CONECT — Documentacao Completa do Sistema

**Atualizado em:** 06/03/2026
**Dominio producao:** mavrionconnect.com.br
**VPS:** 187.77.232.164
**Stack:** React + Vite + TypeScript + Express.js + PostgreSQL + Drizzle ORM

---

## 1. VISAO GERAL

Mavrion Conect e uma plataforma B2B completa para originacao de deals imobiliarios, rurais e M&A. Integra CRM dual (INVESTOR + ASSET), matching asset-investidor, prospeccao CNPJ, geracao de propostas/contratos, enriquecimento geografico (SICAR, ANM, Embrapa), portal publico de investidores e modulo Norion Capital (credito com garantia).

**Tema:** Emerald green com sidebar dark forest green
**Auth:** Sessao via Passport.js + RBAC (roles: admin, sdr, analista)
**Multi-tenant:** org_id em todas as tabelas, getOrgId(req) extrai do session

---

## 2. ESTRUTURA DE ARQUIVOS

### Frontend (client/src/)
```
pages/
  dashboard.tsx          - KPIs, graficos de pipeline, tendencias
  ativos.tsx             - Lista/CRUD de ativos (TERRA, MINA, AGRO, NEGOCIO, FII_CRI, DESENVOLVIMENTO)
  ativo-detalhe.tsx      - Detalhe do ativo com abas dinamicas por tipo
  matching.tsx           - Motor de matching asset-investidor
  crm.tsx + crm/         - Kanban dual (INVESTOR/ASSET), deal cards, painel lateral
  empresas.tsx           - Lista de empresas CRM
  empresa-detail.tsx     - Detalhe empresa com enriquecimento CNPJ
  sdr.tsx                - Fila SDR com filtros por origem, notas inline
  prospeccao.tsx         - Busca CNPJ via cnpja.com API
  ma-deals.tsx           - M&A Radar — busca empresas ativas, salvar/iniciar deal
  geo-rural.tsx          - Prospeccao rural via SICAR/CAR (pagina standalone)
  anm.tsx                - Busca processos ANM (mineracao)
  analise-agro.tsx       - Analise de solo, ZARC, NDVI, SIGEF
  inteligencia-agro.tsx  - Ranking de ativos por score agro
  propostas.tsx          - Templates e gerador de propostas
  contratos.tsx          - Templates e gerador de contratos
  honorarios.tsx         - Controle de honorarios/comissoes
  portal-admin.tsx       - Admin do portal publico + Landing Pages
  portal-publico.tsx     - Portal publico para investidores
  landing-page.tsx       - Landing pages individuais por ativo
  configuracoes.tsx      - Config sistema (usuarios, connectors, cache)
  login.tsx              - Tela de login
  home.tsx               - Home page pre-login
  error-reports.tsx      - Monitoramento de erros automaticos
  connectors.tsx         - Gerenciamento de connectors (APIs, scrapers)
  relatorios.tsx         - Relatorios e exports
  mapa-conexoes.tsx      - Grafo de relacionamentos
  manual.tsx             - Manual do usuario
  arquitetura.tsx        - Diagrama de arquitetura

components/
  layout-sidebar.tsx     - Sidebar principal com navegacao
  ui/                    - Componentes Shadcn (Button, Card, Badge, etc.)
```

### Backend (server/)
```
routes/
  assets.ts        - CRUD ativos, enriquecimento Embrapa, grid NDVI
  auth.ts          - Login, usuarios admin
  caf-extrator.ts  - Crawler CAF/PRONAF, varreduras, registros
  commercial.ts    - Propostas e contratos
  companies.ts     - Empresas, CNPJ search/import, enriquecimento
  crm.ts           - Deals, pipeline stages, deal comments, activities
  documents.ts     - Upload/listagem docs Google Drive (ativo, empresa, deal)
  export.ts        - Exportacao XLSX (deals, companies, leads, assets)
  geo.ts           - SICAR, ANM, hidrografia, energia, elevacao, analise geo
  matching.ts      - Matching engine, perfis investidor, sugestoes
  portal.ts        - Portal publico, listings, inquiries, landing pages
  prospeccao.ts    - Busca CNPJ, prospeccao reversa, creditos
  sdr.ts           - Fila SDR, promover lead
  system.ts        - Connectors, org settings, error reports, health, SSE, audit, cache

services/
  caf-crawler.ts   - Crawler CAF que busca produtores no site do MDA

lib/
  embrapa.ts       - Integracao Embrapa (ClimAPI, Agritec ZARC, SATVeg NDVI)
  google-drive.ts  - Upload/listagem Google Drive (Service Account ou Replit Connector)
  tenant.ts        - Extracao orgId do session

enrichment/       - NAO MODIFICAR — waterfall de enriquecimento CNPJ
```

---

## 3. SCHEMA DO BANCO (PostgreSQL + PostGIS)

### Tabelas Principais

**organizations** — Tenants (multi-org)
- id, name, createdAt

**users** — Usuarios do sistema
- id, orgId, username, password (hash), role (admin/sdr/analista), permissions (jsonb), email, emailSignature

**companies** — Empresas CRM
- id, orgId, legalName, tradeName, cnpj (unique), cnaePrincipal, cnaeSecundarios[], porte, revenueEstimate, website, phones[], emails[], address{}, geo{}, tags[], notes, enrichmentData{}, enrichedAt, researchNotes[], verifiedContacts{}, norionProfile

**contacts** — Contatos vinculados a empresas
- id, orgId, companyId, name, roleTitle, phone, email, whatsapp, linkedin, tags[], consentFlagsJson{}

**leads** — Fila SDR
- id, orgId, companyId, status, score, scoreBreakdownJson{}, source (manual/ma_radar/portal/prospeccao/caf/anm/matching), notes, ownerUserId, lastEnrichedAt, updatedAt

**deals** — Negocios CRM
- id, orgId, pipelineType (INVESTOR/ASSET), stageId, title, amountEstimate, probability, expectedCloseDate, ownerUserId, source, description, labels[], priority, dueDate, attachments[], companyId, assetId, feeType, feePercent, feeValue, feeStatus, feeNotes

**deal_comments** — Comentarios em deals
- id, dealId, authorName, content

**pipeline_stages** — Estagios do Kanban
- id, orgId, pipelineType, name, order, color

**assets** — Ativos (imoveis, minas, negocios, etc.)
- id, orgId, type (TERRA/MINA/AGRO/NEGOCIO/FII_CRI/DESENVOLVIMENTO)
- title, description, location, municipio, estado
- priceAsking, areaHa, areaUtil, matricula
- docsStatus, documentosJson{}, observacoes, tags[]
- attributesJson{} — dados extras flexiveis
- anmProcesso — numero processo ANM
- carCodImovel — codigo CAR
- linkedCompanyId
- **Campos GEO (first-level):** geoAltMed, geoAltMin, geoAltMax, geoDeclivityMed, geoTemRio, geoTemLago, geoDistAguaM, geoTemEnergia, geoDistEnergiaM, geoScoreEnergia, geoScore, geoAnalyzedAt
- statusAtivo (ativo/inativo/vendido)
- exclusivoAte, exclusividadeEmpresaId
- activityLog[]
- camposEspecificos{} — coordenadas, codigoIbge, embrapa{}, enrichmentAgro{}, ndviGrid{}, checklists
- **PostGIS:** coluna `geom` (geometry) — poligono do imovel (nao no Drizzle schema, adicionada via SQL)

**investor_profiles** — Perfis de investidores
- id, orgId, name, contactId, regionsOfInterest[], assetTypes[], ticketMin, ticketMax, preferencesJson{}, tags[], buyerType (financeiro/estrategico), cnaeInteresse[], prazoDecisao, dealsAnteriores, capacidadeAquisicao

**match_suggestions** — Sugestoes de matching
- id, orgId, assetId, investorProfileId, score, reasonsJson{}, status, dealId

**proposals / proposal_templates** — Propostas comerciais
**contracts / contract_templates** — Contratos
**portal_listings** — Listings do portal publico
**portal_inquiries** — Consultas recebidas no portal
**asset_landing_pages** — Landing pages por ativo (slug, SEO)
**error_reports** — Monitoramento de erros (auto-capture + manual)
**audit_logs** — Log de auditoria de todas acoes
**connectors** — API connectors (ReceitaWS, etc.)
**raw_ingests** — Dados brutos ingeridos por connectors
**org_settings** — Configuracoes por organizacao
**sicar_imoveis_cache** — Cache de status SICAR
**cache_embrapa** — Cache de dados Embrapa

### Tabelas Norion Capital
**norion_operations** — Operacoes de credito
**norion_documents** — Documentos das operacoes
**norion_client_users** — Usuarios clientes (login CPF)
**norion_formulario_cliente** — Formulario preenchido pelo cliente
**norion_fundos_parceiros** — Fundos parceiros
**norion_envios_fundos** — Envios para fundos
**norion_caf_registros** — Registros do crawler CAF

---

## 4. API ENDPOINTS COMPLETOS

### Auth
- `POST /api/login` — Login (username/password)
- `POST /api/logout` — Logout
- `GET /api/user` — Usuario logado
- `GET /api/admin/users` — Listar usuarios
- `POST /api/admin/users` — Criar usuario
- `PATCH /api/admin/users/:id` — Atualizar usuario
- `DELETE /api/admin/users/:id` — Deletar usuario
- `PATCH /api/auth/profile` — Atualizar perfil

### Assets (Ativos)
- `GET /api/matching/assets` — Listar ativos
- `POST /api/matching/assets` — Criar ativo
- `GET /api/matching/assets/:id` — Detalhe ativo
- `GET /api/matching/assets/:id/geometry` — Geometria PostGIS (GeoJSON)
- `PATCH /api/matching/assets/:id` — Atualizar ativo
- `DELETE /api/matching/assets/:id` — Deletar ativo
- `POST /api/matching/assets/:id/enriquecer-embrapa` — Enriquecer com Embrapa
- `POST /api/matching/assets/:id/ndvi-grid` — Grid NDVI variabilidade
- `GET /api/embrapa/status` — Status servico Embrapa

### CRM (Deals & Pipeline)
- `GET /api/crm/deals` — Listar deals
- `POST /api/crm/deals` — Criar deal
- `GET /api/crm/deals/:id` — Detalhe deal
- `PATCH /api/crm/deals/:id` — Atualizar deal (mover estagio, etc.)
- `DELETE /api/crm/deals/:id` — Deletar deal
- `GET /api/crm/stages` — Listar estagios pipeline
- `POST /api/crm/stages` — Criar estagio
- `PATCH /api/crm/stages/:id` — Atualizar estagio
- `DELETE /api/crm/stages/:id` — Deletar estagio
- `GET /api/deal-comments` — Listar comentarios
- `POST /api/deal-comments` — Criar comentario
- `DELETE /api/deal-comments/:id` — Deletar comentario
- `GET /api/crm/deals/:id/activities` — Atividades do deal
- `POST /api/crm/deals/:id/activities` — Criar atividade

### Companies (Empresas)
- `GET /api/crm/companies` — Listar empresas
- `GET /api/companies/with-leads` — Empresas com leads
- `GET /api/companies/:id/relationships` — Relacionamentos (socios, participacoes)
- `POST /api/companies/:id/lead` — Criar lead para empresa
- `POST /api/crm/companies` — Criar empresa
- `PATCH /api/crm/companies/:id` — Atualizar empresa
- `PATCH /api/companies/:id` — Atualizar empresa (alternative)
- `DELETE /api/companies/:id` — Deletar empresa
- `POST /api/companies/batch-delete` — Deletar em lote
- `POST /api/companies/:id/enrich` — Enriquecer CNPJ
- `PATCH /api/companies/:id/research-notes` — Notas de pesquisa
- `PATCH /api/companies/:id/verified-contacts` — Contatos verificados
- `GET /api/companies/:id/verified-contacts` — Obter contatos verificados
- `GET /api/cnpj/:cnpj` — Buscar CNPJ (cnpja.com)
- `POST /api/cnpj/:cnpj/import` — Importar empresa por CNPJ
- `POST /api/cnpj/:cnpj/disqualify` — Desqualificar CNPJ
- `GET /api/socios/:taxId/companies` — Empresas de um socio

### SDR (Leads)
- `GET /api/sdr/queue` — Fila SDR
- `PATCH /api/sdr/leads/:id` — Atualizar lead
- `PATCH /api/sdr/leads/:id/notes` — Atualizar notas
- `POST /api/sdr/leads/:id/promote` — Promover lead

### Matching
- `GET /api/matching/investors` — Listar perfis investidor
- `POST /api/matching/investors` — Criar perfil investidor
- `PATCH /api/matching/investors/:id` — Atualizar perfil
- `DELETE /api/matching/investors/:id` — Deletar perfil
- `GET /api/matching/suggestions` — Listar sugestoes
- `POST /api/matching/run` — Rodar matching
- `POST /api/matching/assets/:assetId/add-buyer` — Adicionar comprador estrategico
- `POST /api/matching/assets/:assetId/importar-comprador` — Importar comprador da prospeccao

### Geo (Rural, SICAR, ANM, Analise)
- `GET /api/geo/sicar-status` — Status SICAR de um imovel
- `GET /api/geo/fazendas` — Buscar fazendas no SICAR
- `GET /api/geo/hidrografia` — Dados hidrografia IBGE
- `GET /api/geo/energia` — Dados energia IBGE
- `GET /api/geo/elevacao` — Elevacao (OpenTopoData SRTM)
- `POST /api/geo/analisar` — Analise geo completa (agua, energia, altitude, declividade)
- `POST /api/geo/persist-analysis` — Persistir analise geo no banco (auto-calcula area, auto-popula codigoIbge)
- `GET /api/geo/imported` — Fazendas ja importadas
- `POST /api/geo/import-fazenda` — Importar fazenda do SICAR
- `GET /api/geo/ranking` — Ranking geo dos ativos
- `POST /api/geo/batch-analyze` — Analise em lote
- `POST /api/geo/enriquecer-agro` — Enriquecer com dados Embrapa
- `GET /api/geo/solo` — Dados de solo (SoilGrids)
- `GET /api/geo/sigef/:cnpj` — Parcelas SIGEF

### ANM (Mineracao)
- `GET /api/anm/processos` — Buscar processos ANM
- `GET /api/anm/geometria/:processo` — Geometria de processo ANM
- `GET /api/anm/imported` — Processos ja importados
- `POST /api/anm/import-asset` — Importar processo como ativo

### CAF (Crawler)
- `GET /api/caf-extrator/testar` — Testar conexao CAF
- `POST /api/caf-extrator/varredura` — Iniciar varredura
- `GET /api/caf-extrator/varredura/:id` — Status varredura
- `POST /api/caf-extrator/varredura/:id/cancelar` — Cancelar varredura
- `GET /api/caf-extrator/varreduras` — Listar varreduras
- `GET /api/caf-extrator/varredura/:id/stream` — SSE stream de progresso
- `GET /api/caf-extrator/registros` — Listar registros CAF
- `GET /api/caf-extrator/registros/:id` — Detalhe registro
- `PATCH /api/caf-extrator/registros/:id/classificar` — Classificar registro
- `DELETE /api/caf-extrator/registros/:id` — Deletar registro
- `DELETE /api/caf-extrator/registros/lote` — Deletar em lote
- `POST /api/caf-extrator/registros/:id/enviar-sdr` — Enviar para fila SDR
- `POST /api/caf-extrator/registros/enviar-sdr-lote` — Enviar lote para SDR
- `GET /api/caf-extrator/municipios/:uf` — Listar municipios de um estado

### Documents (Google Drive)
- `GET /api/documents/ativo/:id` — Listar docs de ativo
- `POST /api/documents/ativo/:id` — Upload doc de ativo (multipart/form-data: arquivo, tipo, titulo)
- `GET /api/documents/empresa/:id` — Listar docs de empresa
- `POST /api/documents/empresa/:id` — Upload doc de empresa
- `GET /api/documents/deal/:id` — Listar docs de deal
- `POST /api/documents/deal/:id` — Upload doc de deal
- `DELETE /api/documents/:fileId` — Deletar arquivo

### Propostas & Contratos
- `GET /api/proposals/templates` — Templates de proposta
- `POST /api/proposals/templates` — Criar template
- `PUT /api/proposals/templates/:id` — Atualizar template
- `DELETE /api/proposals/templates/:id` — Deletar template
- `GET /api/proposals` — Listar propostas
- `POST /api/proposals` — Gerar proposta
- `PATCH /api/proposals/:id` — Atualizar proposta
- `DELETE /api/proposals/:id` — Deletar proposta
- `POST /api/proposals/:id/send-email` — Enviar proposta por email
- (Mesma estrutura para contratos: /api/contracts/*)

### Portal Publico
- `GET /api/portal/listings` — Listar listings (admin)
- `POST /api/portal/listings` — Criar listing
- `PATCH /api/portal/listings/:id` — Atualizar listing
- `DELETE /api/portal/listings/:id` — Deletar listing
- `GET /api/portal/inquiries` — Listar consultas
- `PATCH /api/portal/inquiries/:id` — Atualizar consulta
- `POST /api/portal/inquiries/:id/create-deal` — Criar deal a partir de consulta
- `GET /api/public/listings` — Listings publicos (sem auth)
- `GET /api/public/listings/:id` — Detalhe listing publico
- `POST /api/public/inquiries` — Enviar consulta (sem auth)
- `GET /api/landing-pages` — Landing pages
- `POST /api/landing-pages` — Criar landing page
- `PATCH /api/landing-pages/:id` — Atualizar
- `DELETE /api/landing-pages/:id` — Deletar
- `GET /api/public/lp/:slug` — Landing page publica por slug

### Prospeccao
- `GET /api/prospeccao/search` — Buscar CNPJs
- `GET /api/prospeccao/reversa` — Prospeccao reversa (buscar compradores)
- `GET /api/prospeccao/creditos` — Saldo creditos CNPJ

### Export
- `GET /api/export/deals` — Exportar deals XLSX
- `GET /api/export/companies` — Exportar empresas XLSX
- `GET /api/export/leads` — Exportar leads XLSX
- `GET /api/export/assets` — Exportar ativos XLSX

### Sistema
- `GET /api/health/services` — Status servicos (ANM, SICAR)
- `GET /api/connectors` — Listar connectors
- `POST /api/connectors` — Criar connector
- `PUT /api/connectors/:id` — Atualizar
- `DELETE /api/connectors/:id` — Deletar
- `POST /api/connectors/:id/run` — Executar connector
- `GET /api/org/settings` — Configuracoes da org
- `PUT /api/org/settings/:key` — Atualizar config
- `POST /api/upload/logo` — Upload logo
- `POST /api/upload/images` — Upload imagens (ate 10)
- `GET /api/error-reports` — Listar erros
- `GET /api/error-reports/stats` — Estatisticas erros
- `POST /api/error-reports` — Criar report manual
- `POST /api/error-reports/auto` — Auto-capture de erros
- `PATCH /api/error-reports/:id` — Atualizar report
- `GET /api/scheduler/status` — Status agendador
- `GET /api/audit-logs` — Logs de auditoria
- `GET /api/cache/stats` — Estatisticas cache
- `DELETE /api/cache/flush/:namespace` — Limpar cache
- `GET /api/notifications/stream` — SSE notificacoes

---

## 5. ABAS DO DETALHE DE ATIVO (por tipo)

```
TERRA / AGRO: [info, documentos, matches, geo, embrapa, caf]
MINA:         [info, documentos, matches, anm, geo]
NEGOCIO:      [info, documentos, matches, empresa]
FII_CRI:      [info, documentos, matches, cvm]
```

### Aba Info
- Card Localizacao: Estado, Municipio, Regiao, Codigo CAR, Matricula
- Card Dimensoes & Valor: Area Total, Area Util, Preco pedido, Preco/ha
- Card Resumo do Imovel (TERRA): Area, Score Geo, Altitude, Valor (4 boxes visuais)
- Card Tags

### Aba Documentos
- Status da documentacao
- Checklist de Due Diligence (por tipo de ativo)
- Upload de documentos para Google Drive (por item do checklist)
- Listagem de arquivos ja enviados

### Aba GEO
- Mapa Leaflet com poligono PostGIS
- Dados: coordenadas, municipio, codigo IBGE
- Indicadores: altitude, declividade, agua, energia, score geo
- Status SICAR
- Botao "Atualizar analise"

### Aba Embrapa (TERRA/AGRO)
- Solo: pH, argila, areia, CEC, nitrogenio, carbono organico
- ZARC: Zoneamento Agricola — culturas aptas, epocas plantio
- NDVI: Indice vegetacao (SATVeg/MODIS)
- Clima: Temperatura, precipitacao
- Grid NDVI: Mapa de variabilidade com zonas de manejo

### Aba CAF/PRONAF (TERRA/AGRO)
- SICOR/BCB: Credito rural do municipio (auto-carrega com codigoIbge)
- CAF: Produtores do municipio (auto-carrega com estado)

### Aba ANM (MINA)
- Dados do processo ANM
- Geometria do poligono

### Aba Matches
- Deals vinculados (negocios em andamento)
- Prospeccao reversa: empresas compradoras sugeridas
- Importar comprador para CRM

---

## 6. SIDEBAR (Navegacao)

```
Dashboard
Ativos (expandivel por tipo: TERRA, MINA, AGRO, NEGOCIO, FII_CRI)
Matching
CRM (expandivel: Kanban, Empresas, Fila SDR, Propostas, Contratos)
Prospeccao (expandivel: CNPJ/Empresas, M&A Radar)
Portal
Honorarios
Configuracoes (admin: Sistema, Usuarios, Connectors)
```

---

## 7. INTEGRAÇÕES EXTERNAS

| Servico | Uso | Env Var |
|---------|-----|---------|
| PostgreSQL + PostGIS | Banco principal | DATABASE_URL |
| Google Drive | Armazenamento docs | GOOGLE_SERVICE_ACCOUNT_KEY ou Replit Connector |
| cnpja.com | Busca/enriquecimento CNPJ | CNPJA_API_KEY |
| SICAR (geoserver.car.gov.br) | Dados imoveis rurais (CAR) | - (publico) |
| ANM (geo.anm.gov.br) | Processos minerarios | - (publico) |
| IBGE WFS | Hidrografia, energia, corpos dagua | - (publico) |
| OpenTopoData | Elevacao SRTM 30m | - (publico) |
| Embrapa AgroAPI | Clima, ZARC, NDVI/EVI, SATVeg | EMBRAPA_CONSUMER_KEY, EMBRAPA_CONSUMER_SECRET |
| SoilGrids (ISRIC) | Dados de solo | - (publico) |
| BCB OData | SICOR/PRONAF credito rural | - (publico) |
| CAF/MDA | Cadastro Agricultura Familiar | CAF_API (publico) |
| OpenStreetMap Overpass | Fallback IBGE | - (publico) |
| Nominatim | Geocodificacao reversa | - (publico) |
| Resend | Email (propostas, contratos) | RESEND_API_KEY |
| ViaCEP | Auto-fill endereco | - (publico) |
| Infosimples | SIGEF/INCRA parcelas | INFOSIMPLES_TOKEN |
| GitHub | Integracao (instalado) | Replit Integration |

---

## 8. MODULO NORION CAPITAL (Standalone)

Roda na porta 5001 (PM2 id 2 na VPS).
Portal do cliente com login CPF, formulario multi-step, upload de documentos, e fluxo admin de revisao/aprovacao.

**Tabelas:** norion_operations, norion_documents, norion_client_users, norion_formulario_cliente, norion_fundos_parceiros, norion_envios_fundos, norion_caf_registros

**Funcionalidades:**
- Login CPF para clientes finais
- Formulario wizard multi-step (dados pessoais, imovel, financeiro)
- Upload de documentos obrigatorios para Google Drive
- Kanban de operacoes (admin)
- Envio para fundos parceiros
- Calculo de comissao

---

## 9. DEPLOY / PRODUCAO

**VPS:** 187.77.232.164
**App dir:** /var/www/mavrion-conect
**PM2 processos:**
- mavrion-conect (id 0, porta 5000)
- norion (id 2, porta 5001)

**DB producao:** postgresql://mavrion:Mvr10n_C0n3ct_2026!@localhost:5432/mavrion_conect

**GitHub repos:**
- mavriondev/mavrion-conect
- mavriondev/norion-capital

---

## 10. AUTOMACOES

1. **CAF auto-crawl:** Ao importar fazenda do SICAR, dispara crawler CAF em background
2. **Area auto-calc:** `persist-analysis` calcula area_ha do poligono PostGIS se NULL
3. **codigoIbge auto-populate:** `persist-analysis` busca via Nominatim se ausente
4. **SICOR auto-load:** Aba CAF carrega credito rural automaticamente com codigoIbge
5. **CAF producers auto-load:** Aba CAF busca produtores automaticamente com estado
6. **Auto-matching:** Matching roda automaticamente na criacao de ativos com origem especifica
7. **Portal -> CRM:** Consultas do portal criam Company + Lead + Deal automaticamente
8. **Error auto-capture:** Frontend captura erros e envia para backend automaticamente
9. **Scheduler:** node-cron roda jobs agendados (ReceitaWS diario as 6h)

---

## 11. NOTAS TECNICAS IMPORTANTES

- **NAO MODIFICAR:** `server/enrichment/waterfall.ts` e `client/src/index.css`
- **DB migrations:** Usar `psql $DATABASE_URL -c "ALTER TABLE..."` (drizzle-kit push trava)
- **PostGIS geom:** Coluna `geom` na tabela `assets` nao esta no Drizzle schema (adicionada via SQL direto)
- **Hook rule:** useState/useEffect devem ser declarados no nivel do componente, NAO dentro de IIFEs no JSX
- **Leads source whitelist:** manual, ma_radar, portal, prospeccao, caf, anm, matching
- **Asset detail route:** `/ativos/:id` (nao `/ativo/:id`)
- **GEO data:** First-level columns (geoAltMed, geoScore, etc.) — NAO de camposEspecificos
- **Coordenadas e codigoIbge:** Em camposEspecificos
- **Admin credentials:** username "admin"
