# RELATORIO COMPLETO DO SISTEMA — MAVRION CONECT

**Plataforma B2B de originacao de deals para operacoes de fundos imobiliarios, M&A e ativos rurais/minerarios.**

**Stack:** React + TypeScript (frontend), Express + Node.js (backend), PostgreSQL (banco), Drizzle ORM, TanStack Query, shadcn/ui, Tailwind CSS, Leaflet (mapas), Tiptap (editor rich text).

---

## 1. ARQUITETURA GERAL

### 1.1 Estrutura de Menus (Sidebar)

```
DASHBOARD
  └─ Dashboard (/)

ORIGINACAO
  ├─ Prospeccao CNPJ (/prospeccao)
  ├─ M&A — Fusoes & Aquisicoes (/ma)
  ├─ Portal ANM (/anm)
  └─ Prospeccao Rural (/geo-rural)

CRM & COMERCIAL
  ├─ Fila SDR (/sdr)
  ├─ Empresas (/empresas)
  │   ├─ Todas as Empresas
  │   ├─ Leads Ativas
  │   └─ Desqualificadas
  ├─ Kanban de Deals (/crm)
  ├─ Propostas (/propostas)
  └─ Contratos (/contratos)

PORTFOLIO
  ├─ Ativos (/ativos) — com sub-filtros por tipo
  ├─ Matching (/matching)
  └─ Portal Investidor (/portal-admin)

RELATORIOS & ANALYTICS
  └─ Relatorios (/relatorios)

SISTEMA
  ├─ Connectors (/connectors)
  ├─ Usuarios (/users)
  ├─ Erros & Relatorios (/error-reports)
  ├─ Configuracoes (/configuracoes)
  └─ Manual (/manual)
```

### 1.2 Fluxo Principal do Negocio

```
ORIGINACAO → QUALIFICACAO → PIPELINE → DOCUMENTACAO → FECHAMENTO

1. Prospeccao CNPJ / M&A / ANM / SICAR  →  Descobre empresas/ativos
2. Importacao de Lead (POST /api/cnpj/:cnpj/import)  →  Cria empresa + lead na fila SDR
3. SDR qualifica o lead (status: new → contacted → qualified)
4. Promocao a Deal (lead → deal no CRM Kanban)
5. Deal percorre pipeline (Prospeccao → Analise → LOI → Due Diligence → Fechamento)
6. Gera Propostas e Contratos com templates dinamicos
7. Portal Investidor publica oportunidades para captacao
```

---

## 2. MODULOS DETALHADOS

### 2.1 DASHBOARD (/)

**Funcionalidades:**
- 5 cards KPI: Leads Ativos, Deals em Andamento, Ativos no Portfolio, Matches Sugeridos, Oportunidades Rurais (CAR)
- Grafico de area: empresas importadas nos ultimos 7 dias
- Grafico de barras: deals criados nos ultimos 7 dias
- Lista de deals recentes com indicador de prioridade (link direto ao CRM)
- Lista de ultimas empresas importadas (link direto ao detalhe)
- Breakdown do portfolio por tipo de ativo (Terras, Mineracao, M&A, etc.)

**API:** GET /api/stats/dashboard → retorna { leadsCount, activeDealsCount, assetsCount, investorsCount, matchesCount }

---

### 2.2 PROSPECCAO CNPJ (/prospeccao)

**Funcionalidades:**
- Busca por CNPJ especifico (lookup direto na Receita Federal via CNPJA)
- Busca avancada com filtros combinaveis:
  - CNAE (arvore hierarquica: Agricultura, Mineracao, Industria, etc.)
  - UF (estado) e DDD (area)
  - Porte (ME, EPP, Demais)
  - Capital Social (minimo e maximo)
  - Situacao Cadastral (Ativa, Suspensa, Inapta, Baixada)
  - Natureza Juridica (LTDA, S.A., etc.)
  - Filtro por disponibilidade de telefone/email
- Tabela de resultados com dados corporativos completos
- Botao "Importar Lead" — importa empresa + cria lead na fila SDR
- Botao "Desqualificar" — marca como descartada para nao aparecer novamente
- Paginacao de resultados

**APIs:**
- GET /api/prospeccao/search?mainActivity.id.in=...&address.state.in=...&company.equity.gte=...
- GET /api/cnpj/:cnpj — busca detalhada por CNPJ
- POST /api/cnpj/:cnpj/import — importa empresa + cria lead
- POST /api/cnpj/:cnpj/disqualify — desqualifica empresa

**Integracao externa:** CNPJA API (api.cnpja.com) — consulta oficial a base da Receita Federal

---

### 2.3 M&A — FUSOES & AQUISICOES (/ma)

**Funcionalidades:**
- 9 templates setoriais pre-configurados:
  - Laticinio, Agronegocio, Mineracao, Energia, Logistica, Saude, Tecnologia, Varejo, Industria
- Cada template vem com CNAEs pre-preenchidos e capital social minimo
- Busca setorial: seleciona um setor → busca automatica na CNPJA por empresas do segmento
- Tabela de resultados com dados corporativos
- Botao "Iniciar Tratativa" — importa empresa + cria deal DIRETAMENTE no pipeline INVESTOR (pula a fila SDR)
- Filtros por UF, porte, faixa de capital

**APIs:** Reutiliza GET /api/prospeccao/search + POST /api/cnpj/:cnpj/import + POST /api/crm/deals

---

### 2.4 PORTAL ANM — MINERACAO (/anm)

**Funcionalidades:**
- Busca de processos minerarios na Agencia Nacional de Mineracao
- Filtros: UF, Substancia, Fase, Nome do titular, Numero do processo
- Filtros avancados: Tipo de uso, Ano, Ultimo evento
- Atalhos rapidos: "Disponibilidade", "Indeferimentos", "Desistencia"
- Mapa interativo (Leaflet) com geometrias GeoJSON dos processos
- Tabela paginada com dados completos de cada processo
- Botao "Ver Geometria" — carrega contorno do processo no mapa
- Botao "Importar Ativo" — cria ativo tipo MINA no portfolio
- Botao "Criar Deal" — importa e cria deal no pipeline ASSET
- Botao "Carregar no Mapa" — carrega geometrias de todos os processos da pagina
- Indicador de status do servico ANM (online/offline) com dot verde/amarelo

**APIs:**
- GET /api/anm/processos?uf=...&substancia=...&fase=...
- GET /api/anm/geometria/:processo
- GET /api/anm/imported
- POST /api/anm/import-asset

**Integracao externa:** ANM SIGMINE (ArcGIS MapServer) — base geoespacial publica da mineracao brasileira

---

### 2.5 PROSPECCAO RURAL (/geo-rural)

**Funcionalidades:**
- Busca de propriedades rurais pelo Cadastro Ambiental Rural (SICAR)
- Filtros: UF, Municipio, Codigo CAR
- Mapa interativo com contornos das propriedades (GeoJSON)
- Analise geoespacial automatica de cada propriedade:
  - Score de agua (rios proximos via IBGE hidrografia)
  - Score de energia (linhas de transmissao via IBGE)
  - Score de elevacao (altitude via OpenTopoData SRTM 30m)
  - Score geral composto
- Botao "Analisar" — executa analise completa da propriedade
- Botao "Importar Ativo" — cria ativo tipo TERRA no portfolio
- Indicador de status SICAR (online/offline)
- Botao "Testar Servidor" — verifica disponibilidade do SICAR

**APIs:**
- GET /api/geo/fazendas?uf=...&municipio=...
- GET /api/geo/hidrografia?bbox=...
- GET /api/geo/energia?bbox=...
- GET /api/geo/elevacao?points=...
- POST /api/geo/analisar
- GET /api/geo/imported
- POST /api/geo/import-fazenda

**Integracoes externas:**
- SICAR (WFS) — cadastro ambiental rural
- IBGE — hidrografia e linhas de energia
- OpenTopoData (SRTM 30m) — dados de elevacao

---

### 2.6 FILA SDR (/sdr)

**Funcionalidades:**
- Lista de leads pendentes de qualificacao
- Cada lead mostra: empresa, CNPJ, status, score, fonte de origem
- Workflow de qualificacao: new → queued → in_progress → contacted → qualified → disqualified
- Busca por CNPJ diretamente na pagina
- Botao "Importar como Lead" — busca CNPJ e importa
- Botao "Promover para Deal" — abre dialog com:
  - Selecao de pipeline (INVESTOR ou ASSET)
  - Selecao de etapa do pipeline
  - Inclusao automatica de contatos verificados na descricao do deal

**APIs:**
- GET /api/sdr/queue
- PATCH /api/sdr/leads/:id — atualiza status

---

### 2.7 EMPRESAS (/empresas)

**Funcionalidades:**
- 3 visualizacoes: Todas, Leads Ativas, Desqualificadas
- Tabela com: nome, CNPJ, CNAE, porte, UF, status do lead
- Busca por nome ou CNPJ
- Filtros: porte, UF, status do lead
- Click em empresa → navega para pagina de detalhe

**Detalhe da Empresa (/empresas/:id):**
- Dados cadastrais completos (razao social, CNPJ, endereco, telefones, emails)
- Painel de enriquecimento:
  - Botao "Enriquecer via Web" — executa scraper Python que busca website, redes sociais, telefones, emails
  - Exibe resultado do enriquecimento: tecnologias detectadas, SEO, redes sociais, WhatsApp
- Contatos verificados: formulario manual para registrar contato confirmado (nome, cargo, telefone, email, WhatsApp, observacoes)
- Notas de pesquisa: campos livres para anotacoes internas
- Grafo de relacionamentos: visualizacao SVG dos socios e empresas relacionadas via CPF
  - Click no socio → busca outras empresas do mesmo CPF na CNPJA
- Botao "Criar Lead" — gera lead para empresa que ainda nao tem
- Link para deals associados

**APIs:**
- GET /api/companies/with-leads
- GET /api/companies/:id/relationships
- POST /api/companies/:id/enrich
- PATCH /api/companies/:id/research-notes
- PATCH /api/companies/:id/verified-contacts
- GET /api/companies/:id/verified-contacts
- POST /api/companies/:id/lead
- GET /api/socios/:taxId/companies

**Integracao externa:** CNPJA API (socios e empresas relacionadas) + Python scraper (enriquecimento web)

---

### 2.8 CRM — KANBAN DE DEALS (/crm)

**Funcionalidades:**
- Dois pipelines: INVESTIDOR e ATIVO (toggle no topo)
- Board Kanban com drag-and-drop entre colunas/etapas
- Etapas padrao INVESTIDOR: Prospeccao → Analise → LOI → Due Diligence → Fechamento
- Etapas padrao ATIVO: Captacao → Validacao Docs → Analise → LOI → Fechamento
- Cada card de deal mostra: titulo, empresa, valor, prioridade (cor lateral), labels, badges ANM/CAR, comentarios, anexos, data de vencimento
- Filtros: busca por titulo/empresa, prioridade, label
- Botao "Limpar filtros"
- Total por coluna: quantidade de deals + valor total
- Botao "Nova Coluna" — cria nova etapa no pipeline com cor customizada
- Botao "Excluir Coluna" — remove colunas vazias

**Detalhe do Deal (Sheet lateral):**
- Edicao inline do titulo
- Selecao de estagio, prioridade, prazo (due date)
- Campos: valor estimado, probabilidade (%)
- Labels: adicionar/remover etiquetas coloridas
- Descricao: editor rich text (Tiptap) com negrito, italico, listas
- Anexos: adicionar links (Google Drive, Dropbox), remover anexos existentes
- Comentarios: sistema completo de comentarios com autor e data
- Informacoes ANM: se o deal tem ativo minerario vinculado, mostra processo, fase, substancia, titular
- Informacoes CAR: se o deal tem ativo rural vinculado, mostra codigo CAR, municipio, scores
- Contatos verificados: exibe telefone, email, WhatsApp confirmados da empresa
- Links rapidos: "Ver Empresa" e "Ver Ativo"
- Botao "Excluir Deal" com confirmacao

**APIs:**
- GET /api/crm/deals?pipelineType=INVESTOR
- POST /api/crm/deals
- PATCH /api/crm/deals/:id
- GET /api/crm/deals/:id
- DELETE /api/crm/deals/:id
- GET /api/crm/stages
- POST /api/crm/stages
- DELETE /api/crm/stages/:id
- PATCH /api/crm/stages/:id
- GET /api/deal-comments?dealId=...
- POST /api/deal-comments
- DELETE /api/deal-comments/:id

---

### 2.9 PROPOSTAS (/propostas)

**Funcionalidades:**
- Editor de templates: editor rich text completo (Tiptap) com:
  - Formatacao: negrito, italico, tachado, alinhamento, cores, fontes, listas
  - Sistema de expressoes/variaveis dinamicas:
    - {{empresa.razao_social}}, {{empresa.cnpj}}, {{empresa.endereco}}
    - {{ativo.titulo}}, {{ativo.area_ha}}, {{ativo.preco}}
    - {{investidor.nome}}, {{investidor.ticket_min}}, {{investidor.ticket_max}}
    - {{deal.titulo}}, {{deal.valor}}, {{deal.pipeline}}
    - {{data_atual}}, {{org.nome}}
  - Popup flutuante "Expressoes" para copiar/inserir variaveis
- Tipos de template: "Investidor" ou "Cedente"
- Gerenciamento de templates: criar, editar, duplicar, excluir
- Gerador de propostas: seleciona template + vincula a empresa/ativo/investidor → merge automatico dos dados reais nas variaveis
- Lista de propostas geradas: visualizar, buscar, excluir
- Envio por email: botao para enviar proposta via email (integrado com Resend)
- Pre-visualizacao do documento final

**APIs:**
- GET/POST /api/proposals/templates
- GET/PUT/DELETE /api/proposals/templates/:id
- GET/POST /api/proposals
- PATCH/DELETE /api/proposals/:id
- POST /api/proposals/:id/send-email

---

### 2.10 CONTRATOS (/contratos)

**Funcionalidades:**
- Identico ao sistema de Propostas (mesmo editor, mesmo sistema de variaveis)
- Templates de contratos: NDA, LOI, Contrato de Compra e Venda, etc.
- Gerador de contratos: preenche template com dados de empresa/ativo/investidor/deal
- Gerenciamento de contratos gerados

**APIs:**
- GET/POST /api/contract-templates
- GET/PUT/DELETE /api/contract-templates/:id
- GET/POST /api/contracts
- GET/DELETE /api/contracts/:id

---

### 2.11 ATIVOS (/ativos)

**Funcionalidades:**
- Listagem de ativos com filtros por tipo:
  - TERRA (Terras & Fazendas)
  - MINA (Mineracao)
  - NEGOCIO (M&A)
  - FII_CRI (Fundos Imobiliarios / CRI)
  - DESENVOLVIMENTO (Desenvolvimento Imobiliario)
  - AGRO (Agronegocio)
  - ENERGIA (Energia Renovavel)
- Formulario de criacao/edicao: titulo, tipo, descricao, localizacao, municipio, estado, preco, area (ha), area util, matricula, status de documentos, observacoes, tags
- Vinculacao com empresa (linkedCompanyId)
- Vinculacao com processo ANM (anmProcesso)
- Atributos dinamicos (JSON): dados especificos como dados ANM, dados CAR, geo scores

**Detalhe do Ativo (/ativos/:id):**
- Todos os campos editaveis
- Mapa de localizacao (se geo disponivel)
- Deals vinculados ao ativo
- Informacoes ANM/CAR se aplicavel

**APIs:**
- GET /api/matching/assets
- POST /api/matching/assets
- GET /api/matching/assets/:id
- PATCH /api/matching/assets/:id
- DELETE /api/matching/assets/:id

---

### 2.12 MATCHING (/matching)

**Funcionalidades:**
- Motor de sugestao automatica entre ativos e investidores
- 3 abas: Sugestoes, Ativos, Investidores
- **Sugestoes:**
  - Cards com Score (0-100%), calculado por:
    - Tipo de ativo vs preferencia do investidor (+40 pontos)
    - Preco dentro do ticket range (+40 pontos)
    - Regiao de interesse (+20 pontos)
  - Filtros: score minimo, status (Nova/Aceita/Rejeitada), tipo de ativo
  - Status badge colorido: Nova (outline), Aceita (verde), Rejeitada (vermelho)
  - Detalhes no card: nome do ativo, investidor, localizacao, preco pedido vs ticket alvo, analise detalhada do match
  - Botao "Aceitar & Criar Deal" → abre dialog para criar deal no pipeline INVESTOR com:
    - Titulo pre-preenchido "Match: [Ativo] ↔ [Investidor]"
    - Selecao de etapa do pipeline
    - Valor estimado (preco do ativo)
    - Labels automaticas: "Matching", "Score XX%"
  - Botao "Rejeitar" → marca como rejeitada
  - Badge "Deal Criado" + link para CRM quando aceito
  - Cards estatisticos: Total, Pendentes, Aceitas, Rejeitadas, Score Medio
- **Ativos:** lista com busca, botao "Adicionar Ativo" (titulo, tipo, localizacao, preco)
- **Investidores:** lista com busca, botao "Adicionar Investidor" (nome, tipos preferidos, ticket min/max, regioes)
- Botao "Executar Matching" → roda o algoritmo e gera novas sugestoes

**APIs:**
- GET/POST /api/matching/assets
- GET/POST /api/matching/investors
- PATCH/DELETE /api/matching/investors/:id
- GET /api/matching/suggestions
- PATCH /api/matching/suggestions/:id
- POST /api/matching/run

---

### 2.13 PORTAL INVESTIDOR — ADMIN (/portal-admin)

**Funcionalidades:**
- 2 abas: Publicacoes e Interessados
- **Publicacoes:**
  - Lista de listings publicados no portal publico
  - Criar listing: vincula a um ativo, define titulo, descricao, imagem, visibilidade (teaser/completo), contato
  - Acoes: publicar (draft → published), arquivar, excluir
  - Busca por titulo
- **Interessados:**
  - Lista de consultas recebidas do portal publico
  - Cada item mostra: nome, email, telefone, empresa, mensagem
  - Seletor de status: Novo, Contatado, Fechado

**APIs:**
- GET/POST /api/portal/listings
- PATCH/DELETE /api/portal/listings/:id
- GET /api/portal/inquiries
- PATCH /api/portal/inquiries/:id

---

### 2.14 PORTAL PUBLICO (/portal e /portal/:id)

**Funcionalidades:**
- Pagina publica (sem autenticacao) para captacao de investidores
- Navbar fixa com links de ancoragem (Sobre, Como Funciona, Contato)
- Hero section com stats globais (total de ativos, valor total)
- Secao "Como Funciona" em 3 passos
- Indicadores de confianca
- Galeria de oportunidades com:
  - Filtros por categoria (icones: Agro, Mineracao, M&A)
  - Busca textual
  - Filtros: faixa de preco, UF, ordenacao (recentes, preco asc/desc)
  - Cards com badge "Novo", regiao, area, preco (ou "Sob Consulta" conforme visibilidade)
- Pagina de detalhe do listing:
  - Especificacoes tecnicas
  - Formulario "Tenho Interesse" (nome, email, telefone, empresa, mensagem)
- Rodape com informacoes legais e disclaimer

**APIs:**
- GET /api/public/listings
- GET /api/public/listings/:id
- POST /api/public/inquiries

---

### 2.15 RELATORIOS (/relatorios)

**Funcionalidades:**
- Abas: Pipeline, Conversao, M&A
- **Pipeline:**
  - KPIs: total de deals, valor total, ticket medio, taxa de conversao
  - Grafico de funil por etapa
  - Filtros: tipo de pipeline, tipo de ativo, UF, prioridade
  - Botao "Limpar filtros"
- **Conversao:**
  - Metricas de conversao lead → deal
  - Graficos de evolucao temporal
- **M&A:**
  - KPIs especificos: total de deals M&A, valor do pipeline, ticket medio, taxa de conversao
  - Graficos de deals por setor
  - Top 8 empresas por valor
  - Comparativo setorial

---

### 2.16 CONNECTORS (/connectors)

**Funcionalidades:**
- Gerenciamento de fontes de dados externas
- Connectors pre-configurados de seed:
  - Receita Federal WS (ReceitaWS) — consulta basica de CNPJ
  - Portal ANM Scraper — raspagem de processos minerarios
  - IBGE Dados Municipais — dados demograficos e economicos
- Templates pre-configurados para criacao rapida
- Cada connector tem: nome, tipo, status (ativo/inativo), configuracao JSON, agenda, ultima execucao
- Acoes: criar, editar, excluir, executar manualmente
- Exibicao de configuracao em estilo terminal JSON

**APIs:**
- GET/POST /api/connectors
- PUT/DELETE /api/connectors/:id
- POST /api/connectors/:id/run

---

### 2.17 USUARIOS (/users)

**Funcionalidades:**
- Lista de usuarios do sistema
- Criacao de usuario: username, senha, role (admin/manager/sdr)
- Edicao de permissoes granulares por modulo:
  - dashboard, prospeccao, empresas, sdr, crm, matching, connectors, users, ativos, propostas
- Edicao de email e assinatura de email
- Reset de senha
- Exclusao de usuario

**APIs:**
- GET/POST /api/admin/users
- PATCH/DELETE /api/admin/users/:id

---

### 2.18 CONFIGURACOES (/configuracoes)

**Funcionalidades:**
- Upload de logo da organizacao (com preview e crop)
- Definicao do nome da empresa/organizacao
- Configuracoes de branding

**APIs:**
- GET /api/org/settings
- PUT /api/org/settings/:key
- POST /api/upload/logo

---

### 2.19 ERROS & RELATORIOS (/error-reports)

**Funcionalidades:**
- Dashboard de monitoramento de erros
- Erros automaticos (capturados pelo frontend) e manuais (reportados pelo usuario)
- Lista com: titulo, tipo, pagina, modulo, prioridade, status
- Filtros por tipo, status, prioridade
- Estatisticas: total, abertos, resolvidos
- Edicao de status e prioridade

**APIs:**
- GET /api/error-reports
- GET /api/error-reports/stats
- GET /api/error-reports/:id
- POST /api/error-reports (manual)
- POST /api/error-reports/auto (automatico)
- PATCH /api/error-reports/:id

---

### 2.20 MANUAL (/manual)

**Funcionalidades:**
- Documentacao interativa do sistema
- Explicacao de cada modulo e fluxo de trabalho
- Guias de uso

---

### 2.21 HEALTH CHECK

**API:** GET /api/health/services → { anm: "online"|"offline", sicar: "online"|"offline", checkedAt: timestamp }

Verificacao automatica exibida como dots coloridos no sidebar (verde = online, amarelo pulsante = offline)

---

## 3. BANCO DE DADOS — TABELAS

### 3.1 Autenticacao & Tenant
| Tabela | Descricao |
|---|---|
| organizations | Tenants do sistema (multi-tenant) |
| users | Usuarios com role (admin/manager/sdr) e permissoes granulares |
| org_settings | Configuracoes key-value por organizacao |

### 3.2 CRM & Comercial
| Tabela | Descricao |
|---|---|
| companies | Empresas com dados completos (CNPJ, endereco, contatos, enriquecimento) |
| contacts | Pessoas vinculadas a empresas |
| leads | Leads com status, score, fonte de origem |
| lead_rules | Regras de qualificacao automatica |
| pipeline_stages | Etapas dos pipelines (INVESTOR e ASSET) |
| deals | Deals com valor, prioridade, labels, attachments, vinculo com empresa e ativo |
| deal_comments | Comentarios em deals |

### 3.3 Portfolio & Matching
| Tabela | Descricao |
|---|---|
| assets | Ativos (TERRA, MINA, NEGOCIO, FII_CRI, AGRO, ENERGIA, DESENVOLVIMENTO) |
| investor_profiles | Perfis de investidores com preferencias |
| match_suggestions | Sugestoes de match com score e motivos |

### 3.4 Documentos
| Tabela | Descricao |
|---|---|
| proposal_templates | Templates de propostas comerciais |
| proposals | Propostas geradas com dados preenchidos |
| contract_templates | Templates de contratos |
| contracts | Contratos gerados |

### 3.5 Portal Publico
| Tabela | Descricao |
|---|---|
| portal_listings | Publicacoes de ativos no portal |
| portal_inquiries | Consultas/interesses recebidos |

### 3.6 Sistema
| Tabela | Descricao |
|---|---|
| connectors | Conectores de dados externos |
| raw_ingests | Dados brutos ingeridos |
| error_reports | Relatorios de erros |

---

## 4. INTEGRACOES EXTERNAS

| Servico | Uso | Tipo |
|---|---|---|
| CNPJA API (api.cnpja.com) | Consulta CNPJ, busca avancada, socios, empresas relacionadas | API privada (requer chave) |
| ANM SIGMINE (ArcGIS) | Processos minerarios, geometrias, busca por substancia/fase | API publica |
| SICAR (WFS) | Propriedades rurais, contornos CAR | API publica |
| IBGE Geociencias | Hidrografia, linhas de energia | API publica |
| OpenTopoData (SRTM 30m) | Dados de elevacao/altitude | API publica |
| Python Web Scraper | Enriquecimento de empresas (website, redes sociais, telefones) | Script local |
| Resend | Envio de propostas por email | API privada |

---

## 5. SISTEMA DE PERMISSOES

| Role | Dashboard | Prospeccao | Empresas | SDR | CRM | Matching | Connectors | Users | Ativos | Propostas |
|---|---|---|---|---|---|---|---|---|---|---|
| admin | sim | sim | sim | sim | sim | sim | sim | sim | sim | sim |
| manager | sim | sim | sim | sim | sim | sim | nao | nao | sim | sim |
| sdr | sim | sim | sim | sim | nao | nao | nao | nao | nao | nao |

Permissoes sao granulares e podem ser customizadas por usuario via JSON.

---

## 6. FUNCIONALIDADES TRANSVERSAIS

- **Autenticacao:** Login com username/senha, sessoes via express-session + PostgreSQL
- **Captura automatica de erros:** Hook global que intercepta erros JS e requests falhados, envia para /api/error-reports/auto
- **Sidebar responsivo:** Desktop fixo (w-64) + mobile drawer com overlay
- **Dark mode:** Suporte completo via classe CSS .dark
- **Editor Rich Text:** Tiptap com toolbar (negrito, italico, listas, etc.) usado em deals, propostas e contratos
- **Mapas interativos:** Leaflet com suporte a GeoJSON, popups, camadas multiplas
- **Busca em tempo real:** Debounced search em multiplas telas
- **Drag and Drop:** Kanban board com @hello-pangea/dnd
- **Toast notifications:** Sistema de notificacoes temporarias
- **Skeleton loading:** Estados de carregamento com placeholders visuais
- **Upload de arquivos:** Multer para upload de logo/imagens

---

## 7. ENDPOINTS COMPLETOS (REFERENCIA RAPIDA)

### Auth
```
POST /api/login
POST /api/logout
GET  /api/user
PATCH /api/auth/profile
```

### Prospeccao & CNPJ
```
GET  /api/prospeccao/search
GET  /api/cnpj/:cnpj
POST /api/cnpj/:cnpj/import
POST /api/cnpj/:cnpj/disqualify
```

### SDR
```
GET  /api/sdr/queue
PATCH /api/sdr/leads/:id
```

### CRM
```
GET/POST /api/crm/deals
GET/PATCH/DELETE /api/crm/deals/:id
GET/POST /api/crm/stages
PATCH/DELETE /api/crm/stages/:id
GET /api/crm/companies
POST /api/crm/companies
GET /api/crm/contacts
```

### Companies
```
GET  /api/companies/with-leads
GET  /api/companies/:id/relationships
POST /api/companies/:id/enrich
POST /api/companies/:id/lead
PATCH /api/companies/:id/research-notes
GET/PATCH /api/companies/:id/verified-contacts
GET  /api/socios/:taxId/companies
```

### Deals
```
GET/POST /api/deal-comments
DELETE /api/deal-comments/:id
GET /api/stats/dashboard
```

### Assets & Matching
```
GET/POST /api/matching/assets
GET/PATCH/DELETE /api/matching/assets/:id
GET/POST /api/matching/investors
PATCH/DELETE /api/matching/investors/:id
GET /api/matching/suggestions
PATCH /api/matching/suggestions/:id
POST /api/matching/run
```

### Geoespacial
```
GET  /api/anm/processos
GET  /api/anm/geometria/:processo
GET  /api/anm/imported
POST /api/anm/import-asset
GET  /api/geo/fazendas
GET  /api/geo/hidrografia
GET  /api/geo/energia
GET  /api/geo/elevacao
POST /api/geo/analisar
GET  /api/geo/imported
POST /api/geo/import-fazenda
```

### Portal
```
GET/POST /api/portal/listings
PATCH/DELETE /api/portal/listings/:id
GET /api/portal/inquiries
PATCH /api/portal/inquiries/:id
GET /api/public/listings
GET /api/public/listings/:id
POST /api/public/inquiries
```

### Comercial
```
GET/POST /api/proposals/templates
GET/PUT/DELETE /api/proposals/templates/:id
GET/POST /api/proposals
PATCH/DELETE /api/proposals/:id
POST /api/proposals/:id/send-email
GET/POST /api/contract-templates
GET/PUT/DELETE /api/contract-templates/:id
GET/POST /api/contracts
GET/DELETE /api/contracts/:id
```

### Sistema
```
GET/POST /api/connectors
PUT/DELETE /api/connectors/:id
POST /api/connectors/:id/run
GET /api/org/settings
PUT /api/org/settings/:key
POST /api/upload/logo
GET /api/error-reports
GET /api/error-reports/stats
GET/POST /api/error-reports/:id
POST /api/error-reports/auto
PATCH /api/error-reports/:id
GET /api/health/services
GET/POST/PATCH/DELETE /api/admin/users
```

---

*Relatorio gerado em Marco/2026 — Mavrion Conect v1.0*
