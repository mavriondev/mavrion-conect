# Proposta: versão do método geográfico por imóvel + fila de reprocessamento com checkpoint

**Estado: PROPOSTA. Nada aqui foi executado.** Nenhuma coluna, tabela ou fila foi criada; nenhum UPDATE foi rodado. O objetivo é que a aprovação (ou alteração) venha antes de qualquer SQL em produção.

Data: 22/10/2026. Base inspecionada somente em leitura: `sicar_imoveis_cache` (PostgreSQL 17.11), particionada por `LIST (uf)` em 28 partições `sicar_imoveis_<uf>`, 8.471.107 imóveis, PK `(id bigint, uf text)`, única `(cod_imovel, uf)`.

## 1. Problema que a proposta resolve

Hoje as colunas calculadas (`alt_media/alt_min/alt_max`, `declividade`, `argila_*`, `temp_media`, `precip_anual`, etc.) não registram **com qual método nem quando** foram calculadas. Consequências:

- Não dá para saber quais imóveis já têm a declividade nova (Horn) e quais ainda têm a antiga (17 pontos) — a única pista é o valor em si.
- Os workers globais (`/api/sicar/altitude/start`, argila) trabalham por `coluna IS NULL`. Para reprocessar uma coluna já preenchida seria preciso **zerar** a coluna, o que destrói o valor antigo e o deixa indistinguível de "nunca calculado". Foi exatamente isso que o usuário proibiu.
- Não há checkpoint: se o processo cai (restart do pm2 mata o worker), ele recomeça pela varredura `IS NULL` e não sabe por onde ia.

## 2. Desenho proposto

### 2.1 Versão do método, por imóvel e por família de cálculo

Uma coluna `smallint` por família, na própria tabela particionada (herdada pelas 28 partições), com `DEFAULT 0` significando "método legado / desconhecido":

| Coluna nova | Família | Versões previstas |
|---|---|---|
| `metodo_relevo_v` | alt_media/min/max + declividade | 0 = legado (17 pontos); 1 = Horn 3x3 SRTM 90 m |
| `metodo_solo_v` | argila_*, areia, silte, pH, carbono, densidade, N | 0 = legado; 1 = primeira versão auditada |
| `metodo_clima_v` | temp_media, precip_anual | 0 = legado; 1 = Open-Meteo histórico (tarefa já proposta) |
| `metodo_calc_em` | timestamp da última escrita de qualquer família | — |

Por que uma coluna por família e não uma só: as famílias são recalculadas por workers diferentes, em ritmos diferentes; uma coluna única obrigaria a recalcular tudo para subir a versão.

Por que `smallint` com default 0 e não `NULL`: `ADD COLUMN ... DEFAULT <constante>` no PostgreSQL ≥ 11 **não reescreve a tabela** (o default fica no catálogo), então é instantâneo mesmo em 8,47 mi de linhas; e `0` evita `IS NULL` em consultas de fila.

Catálogo das versões (para o relatório poder citar "método v1 = Horn 3x3, validado em 22/10/2026 contra TOPODATA"):

```sql
-- NÃO EXECUTAR SEM APROVAÇÃO
CREATE TABLE geo_metodo_versao (
  familia      text     NOT NULL,            -- 'relevo' | 'solo' | 'clima'
  versao       smallint NOT NULL,
  descricao    text     NOT NULL,
  fonte        text     NOT NULL,            -- ex.: 'SRTM 90 m CGIAR v4.1 (tiles locais)'
  validado_em  date,
  referencia   text,                         -- ex.: 'docs/relatorio-rodovia-declividade-ssh-2026-10-22.md'
  PRIMARY KEY (familia, versao)
);
INSERT INTO geo_metodo_versao VALUES
  ('relevo', 0, 'Legado: média da inclinação de até 17 pontos (grade 4x4 + ponto garantido) até o vizinho ≥ 90 m', 'SRTM 90 m CGIAR v4.1', NULL, NULL),
  ('relevo', 1, 'Horn 3x3 por pixel; média dos pixels com centro no polígono, ignorando borda/sem dado', 'SRTM 90 m CGIAR v4.1', '2026-10-22', 'docs/relatorio-rodovia-declividade-ssh-2026-10-22.md'),
  ('solo',   0, 'Legado: amostragem SoilGrids/OpenGeoHub como está em produção', 'SoilGrids 250 m', NULL, NULL),
  ('clima',  0, 'Legado', 'WorldClim/Open-Meteo conforme produção', NULL, NULL);
```

Colunas na tabela de imóveis:

```sql
-- NÃO EXECUTAR SEM APROVAÇÃO
-- Instantâneo (default constante não reescreve as partições). Pega ACCESS EXCLUSIVE por milissegundos
-- em cada partição: rodar fora do horário de pico e com lock_timeout para não enfileirar leituras.
SET lock_timeout = '5s';
ALTER TABLE sicar_imoveis_cache
  ADD COLUMN metodo_relevo_v smallint NOT NULL DEFAULT 0,
  ADD COLUMN metodo_solo_v   smallint NOT NULL DEFAULT 0,
  ADD COLUMN metodo_clima_v  smallint NOT NULL DEFAULT 0,
  ADD COLUMN metodo_calc_em  timestamp;
```

Índice para a fila (criado **por partição**, `CONCURRENTLY`, para não bloquear; o pai não aceita CONCURRENTLY):

```sql
-- NÃO EXECUTAR SEM APROVAÇÃO — repetir para cada uma das 28 partições
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sp_metodo_relevo ON sicar_imoveis_sp (metodo_relevo_v, id);
```

Custo estimado do índice: ~8,47 mi entradas (smallint+bigint) ≈ 250–300 MB no total, criados um por vez.

### 2.2 Fila de reprocessamento por UF / faixa de ID / versão, com checkpoint

Uma tabela pequena de **lotes** (não uma linha por imóvel — isso seria outra tabela de 8 mi):

```sql
-- NÃO EXECUTAR SEM APROVAÇÃO
CREATE TABLE geo_reprocesso_fila (
  id              bigserial PRIMARY KEY,
  familia         text      NOT NULL,                 -- 'relevo' | 'solo' | 'clima'
  versao_alvo     smallint  NOT NULL,
  uf              text      NOT NULL,
  id_inicio       bigint    NOT NULL,                 -- faixa [id_inicio, id_fim] dentro da UF
  id_fim          bigint    NOT NULL,
  -- seleção: só imóveis com versão < versao_alvo (nunca regrava quem já está na versão)
  status          text      NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente','rodando','concluido','erro','pausado')),
  checkpoint_id   bigint,                             -- último id gravado com sucesso neste lote
  processados     integer   NOT NULL DEFAULT 0,
  erros           integer   NOT NULL DEFAULT 0,
  prioridade      smallint  NOT NULL DEFAULT 100,     -- menor = antes (ex.: UF piloto = 10)
  autorizado_por  text,                               -- quem liberou o lote (nome/usuário) — lote sem isto não roda
  iniciado_em     timestamp,
  atualizado_em   timestamp NOT NULL DEFAULT now(),
  finalizado_em   timestamp,
  ultimo_erro     text,
  UNIQUE (familia, versao_alvo, uf, id_inicio)
);
CREATE INDEX idx_geo_fila_pronta ON geo_reprocesso_fila (status, prioridade, id) WHERE status IN ('pendente','rodando');
```

Como os lotes nascem (exemplo: relevo v1 só para SP, lotes de 20 mil IDs). **Não cria processamento, só a lista**:

```sql
-- NÃO EXECUTAR SEM APROVAÇÃO — exemplo para a UF piloto
INSERT INTO geo_reprocesso_fila (familia, versao_alvo, uf, id_inicio, id_fim, prioridade)
SELECT 'relevo', 1, 'SP', min(id), max(id), 10
FROM (SELECT id, (row_number() OVER (ORDER BY id) - 1) / 20000 AS lote
      FROM sicar_imoveis_sp WHERE metodo_relevo_v < 1) t
GROUP BY lote
ON CONFLICT DO NOTHING;
```

### 2.3 Como o worker consome (contrato, para o código que viria depois)

1. Pega um lote: `UPDATE geo_reprocesso_fila SET status='rodando', iniciado_em=coalesce(iniciado_em, now()) WHERE id = (SELECT id FROM geo_reprocesso_fila WHERE status='pendente' AND autorizado_por IS NOT NULL ORDER BY prioridade, id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *;`
2. Itera os imóveis do lote **a partir do checkpoint**: `SELECT id, geometry ... FROM sicar_imoveis_<uf> WHERE id > coalesce(checkpoint_id, id_inicio-1) AND id <= id_fim AND metodo_relevo_v < versao_alvo ORDER BY id LIMIT 500`.
3. Grava cada imóvel com a condição de versão na própria escrita (idempotente; nunca sobrescreve quem já subiu de versão):
   `UPDATE sicar_imoveis_<uf> SET declividade=$1, alt_media=$2, alt_min=$3, alt_max=$4, metodo_relevo_v=$5, metodo_calc_em=now() WHERE id=$6 AND uf=$7 AND metodo_relevo_v < $5`.
4. A cada sub-lote de 500: `UPDATE geo_reprocesso_fila SET checkpoint_id=$ultimo, processados=processados+$n, erros=erros+$e, atualizado_em=now() WHERE id=$lote`.
5. Fim do lote: `status='concluido', finalizado_em=now()`. Erro fatal: `status='erro', ultimo_erro=...` (o checkpoint fica; retomar é voltar para `pendente`).
6. Se o processo morrer (restart do pm2), lotes em `rodando` com `atualizado_em` antigo (> 30 min) voltam para `pendente` por um guardião — o checkpoint garante que nada é refeito além do sub-lote em andamento.
7. **Pausa global**: `UPDATE geo_reprocesso_fila SET status='pausado' WHERE status IN ('pendente','rodando')` para o fluxo em segundos sem matar processo. Também faz sentido um kill-switch por env (`GEO_REPROCESSO_ENABLED`), seguindo o padrão dos outros módulos da Hub.

### 2.4 O que a proposta garante em relação às regras combinadas

- **Sem reprocessamento em massa acidental**: um lote só roda com `autorizado_por` preenchido; a geração de lotes é um INSERT explícito por UF.
- **Sem zerar coluna nacional**: a seleção é por `metodo_*_v < alvo`, não por `IS NULL`; o valor antigo fica até ser substituído, e o relatório pode mostrar de qual versão veio.
- **Sem bloqueio longo**: ADD COLUMN com default constante é só catálogo; índices por partição `CONCURRENTLY`.
- **Reversível**: `DROP TABLE geo_reprocesso_fila, geo_metodo_versao; ALTER TABLE sicar_imoveis_cache DROP COLUMN metodo_relevo_v, ...` — nenhuma coluna existente é alterada.

### 2.5 Custos e riscos

- Espaço: 4 colunas novas × 8,47 mi ≈ +100 MB quando as linhas forem reescritas pelos próprios UPDATEs (o default em catálogo não ocupa nada até lá); índices ≈ 300 MB no total.
- O `ALTER TABLE` precisa de lock exclusivo breve em cada partição; com `lock_timeout` ele falha em vez de travar a API se houver consulta longa em andamento — e aí se repete.
- A antiga coluna `fetched_at` não serve como "data do cálculo": ela marca a importação do SICAR.

## 3. O que falta decidir (perguntas para aprovação)

1. Aprova as três colunas de versão por família (ou prefere uma só coluna `jsonb` `metodos` = `{"relevo":1,"solo":0,...}`? É mais flexível, porém o índice da fila fica em expressão e a consulta menos legível).
2. Tamanho do lote (proposto 20 mil IDs) e a UF piloto para relevo v1 (sugiro SP, onde já existe uma amostra de 200 imóveis recalculada).
3. Pode-se criar primeiro apenas `geo_metodo_versao` + colunas (passo barato e reversível) e deixar a fila para depois?

## 4. Item 5 (argila) — dependência explícita

A proposta de preencher **somente** os 251.864 imóveis com `argila_media IS NULL` (contagem conferida em 22/10/2026, leitura direta na base) só começa depois da aprovação deste documento, porque a fila é o mecanismo que impede o worker de argila de tocar nos 8,2 mi já preenchidos. Com a fila aprovada, os lotes de argila seriam gerados com `WHERE argila_media IS NULL` (e `metodo_solo_v = 0`), nunca por reset de coluna.
