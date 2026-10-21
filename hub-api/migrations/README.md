# Migrações do banco da Hub API

SQL idempotente e seguro para produção (VPS `187.77.232.164`, banco do
`DATABASE_URL` do `.env` da API). O boot da API cria tabelas e índices que
faltam (`CREATE ... IF NOT EXISTS`), mas para **bancos já populados** prefira
estes arquivos: usam `CREATE INDEX CONCURRENTLY`, que não bloqueia o serviço.

Como rodar (cada arquivo documenta o seu próprio procedimento):

```bash
cd /var/www/mavrion-api && source rotinas/pg-env.sh
psql -f fonte/migrations/<arquivo>.sql
```

Regras:
- Nunca embrulhar `CREATE INDEX CONCURRENTLY` em `BEGIN`/transação.
- Re-rodar um arquivo deve ser sempre inofensivo (idempotência é requisito).
- O espelho no VPS (`/var/www/mavrion-api/fonte/`) é sincronizado no deploy
  (ver `../DEPLOY.md`); a fonte de verdade é este diretório do workspace.

| Arquivo | O que faz | Aplicada em produção |
|---|---|---|
| `2026-08-13-anm-enrich-functional-indexes.sql` | Índices GiST funcionais `ST_Transform(geom,4326)` em `anm_processos`/`anm_outros_layers` — viabilizam o enrich ANM×SICAR (815 ms → 0,4 ms por imóvel) | 13/08/2026 |
