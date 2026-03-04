# Norion Capital - Standalone Application

Plataforma independente de operacoes de credito com portal do cliente, gestao de fundos parceiros, e base CAF.

## Setup em novo Replit

1. Crie um novo Replit com template Node.js
2. Copie todo o conteudo desta pasta para a raiz do novo projeto
3. Instale as dependencias: `npm install`
4. Provisione um banco PostgreSQL no Replit
5. Configure as variaveis de ambiente (Secrets):
   - `DATABASE_URL` (automatico ao provisionar o banco)
   - `SESSION_SECRET` (gere uma string aleatoria)
   - `CNPJA_API_KEY` (para consulta de CNPJ no portal do cliente)
6. Configure a integracao Google Drive no Replit (para upload de documentos)
7. Execute as migracoes: `npm run db:push`
8. Inicie o servidor: `npm run dev`

## Credenciais Padrao

- Usuario: `admin`
- Senha: `admin`

(Criados automaticamente no primeiro acesso)

## Estrutura

```
shared/          - Schema do banco e tipos compartilhados
server/          - Backend Express + Passport
  routes/        - Rotas da API (norion.ts, norion-portal.ts)
  enrichment/    - Integracao CVM/ANBIMA
client/          - Frontend React + Vite
  src/pages/     - Paginas da aplicacao
  src/components/- Componentes UI (shadcn)
```

## Funcionalidades

- Dashboard com metricas de operacoes e comissoes
- Gestao de operacoes de credito (pipeline por etapas)
- Cadastro de empresas com perfil Norion (alto/medio/baixo)
- Checklist de documentos Home Equity
- Portal do cliente (acesso via CPF/CNPJ + token)
- Formulario cadastral do cliente (wizard multi-step)
- Fundos parceiros com matching automatico
- Consulta de fundos CVM/ANBIMA
- Base CAF (Cadastro da Agricultura Familiar)
- Integracao Google Drive para upload de documentos
- Relatorios de comissoes
