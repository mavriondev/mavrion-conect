# Mavrion Hub API — fonte versionado

Fonte da API de produção `api.mavrionconnect.com.br` (VPS 187.77.232.164,
pm2 `mavrion-api`, porta 5002, `/var/www/mavrion-api/dist/index.cjs`).

## Proveniência (importante)

O fonte TypeScript completo do bundle de produção (build 21/03/2026) **não
existia em lugar nenhum** — nem no VPS (o `server/` de lá é cópia parcial mais
antiga, sem os módulos anm/funai/icmbio/ibama/pgfn/sgb/farmway/cardmv/
scheduler/health), nem em git, nem em GitHub. Em 13/08/2026 o fonte foi
**recuperado por des-minificação do próprio bundle de produção**
(sha256 `754a5dd571809c01909b675e6298c42f8f40c8d3b030a358842d18d226613e24`,
já com o patch do guard em `/api/sicar/:codigo` da task 127):

- `src/index.cjs` — **fonte de verdade**. JavaScript CJS válido e executável
  (119 mil linhas, prettier-formatado). Nomes de variáveis locais continuam
  minificados (`r`, `n`, `a0e`…), mas strings, rotas, SQL e estrutura estão
  legíveis; correções de bug agora são edições normais de código com diff em
  git — nunca mais "cirurgia" numa linha única de 3,4 MB.
- `reference/` — cópia da árvore parcial antiga do VPS (`server/*.ts`,
  `shared/schema.ts`, `script/build.ts`, package.json/lock, tsconfig,
  ecosystem.config.cjs). **Desatualizada em relação à produção** (ex.:
  `routes/sicar.ts` de lá não tem o guard). Serve só como referência de como
  o código original era escrito; NÃO buildar a partir dela.

Verificações feitas na recuperação:
- `node --check src/index.cjs` OK;
- conjunto de rotas (`grep -ohE '"/api/[^"]+"' | sort -u`) **idêntico** ao
  bundle de produção: 162 rotas;
- guard `if(!/^[A-Z]{2}-/.test(r.params.codigo))return n();` presente
  (linha ~107006);
- kill-switches `FUNAI_SYNC_ENABLED` / `CPRM_SYNC_ENABLED` presentes
  (lidos do `.env` no boot).

## Conteúdo inlined

O build original (esbuild, `reference/script/build.ts`) fazia bundle das
dependências da allowlist (express, drizzle, pg, node-cron, xlsx, jwt…), então
`src/index.cjs` contém esse código de vendor inlined. O código da aplicação
fica majoritariamente na parte final do arquivo — procure pelas strings de
rota (ex.: `"/api/sicar/stats"`) ou mensagens de log.

## Build e deploy

Ver `DEPLOY.md`. Resumo: `node build.mjs` → `dist/index.cjs` minificado com
verificação automática de sintaxe e de rotas.

## Regras

- **Nunca** rebuildar a partir de `reference/server/` — regride a produção.
- Toda alteração: editar `src/index.cjs`, commitar, `node build.mjs`,
  publicar com backup (ver DEPLOY.md).
- Espelho no VPS: `/var/www/mavrion-api/fonte/` (repo git local). O fonte de
  verdade é ESTE diretório do workspace.
