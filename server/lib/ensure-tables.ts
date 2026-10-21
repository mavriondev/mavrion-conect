import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Provisionamento idempotente (CREATE TABLE IF NOT EXISTS) das tabelas que não
 * passam pelo `drizzle push` — o push é pouco confiável neste projeto (ver
 * replit.md). Roda no startup do servidor, então vale tanto para instalações
 * limpas quanto para o deploy em produção (VPS), sem passo manual de banco.
 *
 * Mantém as definições em sincronia com shared/schema.ts.
 */
export async function ensureLocalDataTables() {
  try {
    // Base local de arrecadação CFEM (dados abertos ANM)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cfem_arrecadacao (
        id SERIAL PRIMARY KEY,
        processo TEXT NOT NULL DEFAULT '',
        ano_processo INTEGER NOT NULL DEFAULT 0,
        ano INTEGER NOT NULL,
        cpf_cnpj TEXT NOT NULL DEFAULT '',
        tipo_pf_pj TEXT,
        substancia TEXT NOT NULL DEFAULT '',
        uf TEXT,
        codigo_municipio TEXT NOT NULL DEFAULT '',
        municipio TEXT,
        quantidade DOUBLE PRECISION,
        unidade TEXT NOT NULL DEFAULT '',
        valor_recolhido DOUBLE PRECISION,
        registros INTEGER DEFAULT 0,
        importado_em TIMESTAMP DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cfem_processo ON cfem_arrecadacao (processo, ano_processo)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cfem_cnpj ON cfem_arrecadacao (cpf_cnpj)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cfem_municipio ON cfem_arrecadacao (codigo_municipio)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cfem_ano ON cfem_arrecadacao (ano)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_cfem_unique ON cfem_arrecadacao (processo, ano_processo, ano, cpf_cnpj, substancia, codigo_municipio, unidade)`);

    // Eventos de processos minerários (microdados SCM — dados abertos ANM)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS anm_eventos_processos (
        id SERIAL PRIMARY KEY,
        numero INTEGER NOT NULL,
        ano INTEGER NOT NULL,
        processo TEXT NOT NULL,
        id_evento INTEGER,
        descricao_evento TEXT,
        dt_evento TEXT,
        ob_evento TEXT,
        publicacao_dou TEXT,
        importado_em TIMESTAMP DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_anm_eventos_processo ON anm_eventos_processos (numero, ano)`);

    // Base local de barragens de mineração (extrato público SIGBM)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sigbm_barragens (
        id SERIAL PRIMARY KEY,
        id_anm INTEGER NOT NULL UNIQUE,
        nome TEXT,
        empreendedor TEXT,
        cpf_cnpj TEXT,
        nome_mina TEXT,
        uf TEXT,
        municipio TEXT,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        categoria_risco TEXT,
        dano_potencial TEXT,
        necessita_paebm TEXT,
        inserida_pnsb TEXT,
        nivel_emergencia TEXT,
        situacao_operacional TEXT,
        minerio_principal TEXT,
        altura_atual DOUBLE PRECISION,
        volume_atual DOUBLE PRECISION,
        pessoas_afetadas TEXT,
        importado_em TIMESTAMP DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sigbm_cnpj ON sigbm_barragens (cpf_cnpj)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sigbm_uf ON sigbm_barragens (uf)`);

    // Dívida ativa da União (dados abertos trimestrais da PGFN), agregada
    // por devedor e categoria
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pgfn_divida_ativa (
        id SERIAL PRIMARY KEY,
        cpf_cnpj TEXT NOT NULL,
        tipo_pessoa TEXT,
        nome_devedor TEXT,
        uf TEXT,
        categoria TEXT NOT NULL,
        inscricoes INTEGER NOT NULL DEFAULT 0,
        valor_consolidado DOUBLE PRECISION NOT NULL DEFAULT 0,
        referencia TEXT NOT NULL,
        importado_em TIMESTAMP DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_pgfn_cnpj ON pgfn_divida_ativa (cpf_cnpj)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_pgfn_unique ON pgfn_divida_ativa (cpf_cnpj, categoria)`);

    // Consultas à pesquisa pública do SEI/ANM (documentos + andamentos por NUP)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sei_consultas (
        id SERIAL PRIMARY KEY,
        nup TEXT NOT NULL UNIQUE,
        nup_formatado TEXT,
        processo_scm TEXT,
        tipo_procedimento TEXT,
        data_geracao TEXT,
        interessados JSONB DEFAULT '[]',
        documentos JSONB DEFAULT '[]',
        andamentos JSONB DEFAULT '[]',
        raw_html TEXT,
        consultado_por INTEGER,
        consultado_em TIMESTAMP,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sei_processo_scm ON sei_consultas (processo_scm)`);

    // Status persistente da última importação de bases externas (CFEM, SIGBM)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS import_status (
        fonte TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    // Textos extraídos de documentos de ativos (leitura pela IA)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS asset_document_texts (
        id SERIAL PRIMARY KEY,
        org_id INTEGER REFERENCES organizations(id),
        asset_id INTEGER REFERENCES assets(id),
        file_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT,
        status TEXT NOT NULL DEFAULT 'processando',
        metodo TEXT,
        texto TEXT,
        erro TEXT,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_asset_doc_texts_asset ON asset_document_texts (asset_id)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_doc_texts_file ON asset_document_texts (file_id)`);
  } catch (e: any) {
    console.error("[EnsureTables] Falha ao provisionar tabelas locais:", e.message);
  }
}
