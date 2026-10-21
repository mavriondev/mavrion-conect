-- Enriquecimento ANM×SICAR (task 133): FK órfã + índices funcionais — idempotente.
--
-- (0) FK órfã pós-particionamento: sicar_anm_enrichment_imovel_fkey apontava para
-- sicar_imoveis_old — a tabela congelada PRÉ-partição (o RENAME levou a FK junto,
-- por OID). Imóveis adicionados depois do congelamento não existem lá, então todo
-- INSERT novo violava a FK e o worker girava em loop infinito de erro sobre a
-- mesma página de pendentes. A referência correta exigiria coluna uf em
-- sicar_anm_enrichment (unique do parent é (cod_imovel, uf)); como as linhas
-- derivam sempre do parent por construção, o estado correto aqui é SEM FK.
ALTER TABLE sicar_anm_enrichment
  DROP CONSTRAINT IF EXISTS sicar_anm_enrichment_imovel_fkey;

-- Índices funcionais do enriquecimento ANM×SICAR (task 133) — idempotente.
--
-- Por quê: o worker de enrich consulta
--   ST_Intersects(ST_Transform(p.geom, 4326), $imovel)
-- e um índice GiST comum em `geom` NÃO serve para a expressão transformada:
-- cada imóvel virava seq scan de ~260k polígonos (~815 ms) e o load ia a ~10.
-- Com estes índices: ~0,4 ms por imóvel sem match, ~30 ms com match.
--
-- Como rodar (no VPS, banco da Hub API):
--   cd /var/www/mavrion-api && source rotinas/pg-env.sh
--   psql -f fonte/migrations/2026-08-13-anm-enrich-functional-indexes.sql
--
-- Seguro em produção: CONCURRENTLY não bloqueia escrita/leitura. psql roda cada
-- comando em autocommit (não embrulhar em BEGIN — CONCURRENTLY proíbe transação).
-- O bloco \gexec abaixo derruba índices INVÁLIDOS deixados por uma criação
-- CONCURRENTLY interrompida (senão o IF NOT EXISTS os pularia para sempre).

SELECT format('DROP INDEX CONCURRENTLY IF EXISTS %I', c.relname)
FROM pg_class c
JOIN pg_index i ON i.indexrelid = c.oid
WHERE c.relname IN ('idx_anm_processos_geom_4326', 'idx_anm_outros_layers_geom_4326')
  AND NOT i.indisvalid
\gexec

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_anm_processos_geom_4326
  ON anm_processos USING gist (ST_Transform(geom, 4326))
  WHERE geom IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_anm_outros_layers_geom_4326
  ON anm_outros_layers USING gist (ST_Transform(geom, 4326))
  WHERE geom IS NOT NULL;

-- Verificação (ambos devem aparecer com indisvalid = t):
SELECT c.relname, i.indisvalid
FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
WHERE c.relname IN ('idx_anm_processos_geom_4326', 'idx_anm_outros_layers_geom_4326');
