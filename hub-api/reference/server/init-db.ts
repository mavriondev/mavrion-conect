import { pool } from "./db";

export async function initializeDatabase() {
  try {
    console.log("Verificando conexao com o banco de dados...");

    await pool.query("SELECT 1");
    console.log("Conexao com banco estabelecida");

    const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = 'agro_entities'
      );
    `);

    if (result.rows[0].exists) {
      console.log("Banco de dados ja esta inicializado");
      await initializeSicarTables();
      await initializeApiUsers();
      return true;
    }

    console.log("Tabelas nao encontradas. Criando estrutura do banco...");

    await pool.query("BEGIN");

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS agro_entities (
          id SERIAL PRIMARY KEY,
          entity_type TEXT NOT NULL,
          name TEXT,
          cpf_cnpj TEXT,
          code TEXT,
          state TEXT,
          city TEXT,
          region TEXT,
          category TEXT,
          sub_category TEXT,
          product_type TEXT,
          additional_data JSONB,
          source_file TEXT,
          imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      console.log("  Tabela agro_entities criada");

      await pool.query("CREATE INDEX IF NOT EXISTS entity_type_idx ON agro_entities(entity_type)");
      await pool.query("CREATE INDEX IF NOT EXISTS cpf_cnpj_idx ON agro_entities(cpf_cnpj)");
      await pool.query("CREATE INDEX IF NOT EXISTS code_idx ON agro_entities(code)");
      await pool.query("CREATE INDEX IF NOT EXISTS state_idx ON agro_entities(state)");
      await pool.query("CREATE INDEX IF NOT EXISTS category_idx ON agro_entities(category)");

      console.log("  Indices criados");

      await pool.query(`
        CREATE TABLE IF NOT EXISTS file_uploads (
          id SERIAL PRIMARY KEY,
          file_name TEXT NOT NULL,
          file_size INTEGER,
          records_imported INTEGER DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending',
          error_message TEXT,
          uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      console.log("  Tabela file_uploads criada");

      await pool.query("COMMIT");

      console.log("Banco de dados inicializado com sucesso!");
    } catch (createError) {
      await pool.query("ROLLBACK");
      throw createError;
    }

    await initializeSicarTables();
    await initializeApiUsers();
    return true;
  } catch (error: any) {
    console.error("Erro ao inicializar banco de dados:", error.message);
    if (error.code) {
      console.error("Codigo:", error.code);
    }
    console.error("O servidor continuara, mas funcionalidades de banco estarao indisponiveis.");
    return false;
  }
}

async function initializeApiUsers() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Tabela api_users verificada/criada");
  } catch (error: any) {
    console.error("Erro ao criar tabela api_users:", error.message);
  }
}

async function initializeSicarTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sicar_imoveis_cache (
        id SERIAL PRIMARY KEY,
        cod_imovel TEXT NOT NULL UNIQUE,
        uf TEXT NOT NULL,
        municipio TEXT,
        num_area DOUBLE PRECISION,
        ind_status TEXT,
        ind_tipo TEXT,
        geometry JSONB,
        properties JSONB,
        fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query("CREATE INDEX IF NOT EXISTS sicar_uf_idx ON sicar_imoveis_cache(uf)");
    await pool.query("CREATE INDEX IF NOT EXISTS sicar_municipio_idx ON sicar_imoveis_cache(municipio)");
    await pool.query("CREATE INDEX IF NOT EXISTS sicar_cod_imovel_idx ON sicar_imoveis_cache(cod_imovel)");

    await pool.query("ALTER TABLE sicar_imoveis_cache ADD COLUMN IF NOT EXISTS dat_criacao TIMESTAMP");
    await pool.query("ALTER TABLE sicar_imoveis_cache ADD COLUMN IF NOT EXISTS data_atualizacao TIMESTAMP");
    await pool.query("ALTER TABLE sicar_imoveis_cache ADD COLUMN IF NOT EXISTS condicao TEXT");
    await pool.query("ALTER TABLE sicar_imoveis_cache ADD COLUMN IF NOT EXISTS cod_municipio_ibge INTEGER");
    await pool.query("ALTER TABLE sicar_imoveis_cache ADD COLUMN IF NOT EXISTS m_fiscal DOUBLE PRECISION");
    console.log("  Colunas extras SICAR verificadas");

    try {
      await pool.query("CREATE EXTENSION IF NOT EXISTS postgis");
      await pool.query("ALTER TABLE sicar_imoveis_cache ADD COLUMN IF NOT EXISTS geom geometry(Geometry, 4326)");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_sicar_imoveis_geom ON sicar_imoveis_cache USING GIST (geom)");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_sicar_imoveis_uf_geom ON sicar_imoveis_cache (uf) WHERE geom IS NOT NULL");
      console.log("  PostGIS e coluna geom verificados");
    } catch (e: any) {
      console.warn("  PostGIS nao disponivel (geometrias desabilitadas):", e.message);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sicar_import_log (
        id SERIAL PRIMARY KEY,
        uf TEXT NOT NULL,
        municipio TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        total_imoveis INTEGER DEFAULT 0,
        total_erros INTEGER DEFAULT 0,
        tipo TEXT NOT NULL DEFAULT 'manual',
        iniciado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        finalizado_em TIMESTAMP,
        duracao_segundos INTEGER
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sicar_import_schedule (
        id SERIAL PRIMARY KEY,
        uf TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        descricao TEXT,
        ativo BOOLEAN NOT NULL DEFAULT true,
        ultima_execucao TIMESTAMP,
        proxima_execucao TIMESTAMP,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("Tabelas SICAR verificadas/criadas");
  } catch (error: any) {
    console.error("Erro ao criar tabelas SICAR:", error.message);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agrofit_produtos (
        id SERIAL PRIMARY KEY,
        id_agrofit INTEGER NOT NULL UNIQUE,
        marca_comercial TEXT,
        nr_registro TEXT,
        classe TEXT,
        classificacao_toxicologica TEXT,
        classificacao_ambiental TEXT,
        formulacao TEXT,
        ingrediente_inerte_qtd TEXT,
        ingrediente_inerte_unidade TEXT,
        titular_registro TEXT,
        fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query("CREATE INDEX IF NOT EXISTS agrofit_id_agrofit_idx ON agrofit_produtos(id_agrofit)");
    await pool.query("CREATE INDEX IF NOT EXISTS agrofit_classe_idx ON agrofit_produtos(classe)");
    await pool.query("CREATE INDEX IF NOT EXISTS agrofit_marca_idx ON agrofit_produtos(marca_comercial)");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS agrofit_ingredientes (
        id SERIAL PRIMARY KEY,
        produto_id INTEGER NOT NULL,
        tipo TEXT, nome TEXT, componente TEXT, quantidade TEXT,
        unidade_medida TEXT, percentual TEXT, grupo_quimico TEXT,
        nome_iupac TEXT, nome_ca TEXT, formula_bruta TEXT
      );
    `);
    await pool.query("CREATE INDEX IF NOT EXISTS agrofit_ing_produto_idx ON agrofit_ingredientes(produto_id)");
    await pool.query("CREATE INDEX IF NOT EXISTS agrofit_ing_nome_idx ON agrofit_ingredientes(nome)");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS agrofit_indicacoes (
        id SERIAL PRIMARY KEY,
        produto_id INTEGER NOT NULL,
        cultura TEXT, praga TEXT, nome_comum TEXT,
        dose_min TEXT, dose_max TEXT, unidade_dose TEXT,
        volume_calda_min TEXT, volume_calda_max TEXT,
        intervalo_aplicacao TEXT, intervalo_seguranca TEXT,
        epoca_aplicacao TEXT, observacao TEXT
      );
    `);
    await pool.query("CREATE INDEX IF NOT EXISTS agrofit_ind_produto_idx ON agrofit_indicacoes(produto_id)");
    await pool.query("CREATE INDEX IF NOT EXISTS agrofit_ind_cultura_idx ON agrofit_indicacoes(cultura)");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS agrofit_fabricantes (
        id SERIAL PRIMARY KEY,
        produto_id INTEGER NOT NULL,
        razao_social TEXT, pais TEXT, tipo_fabricante TEXT
      );
    `);
    await pool.query("CREATE INDEX IF NOT EXISTS agrofit_fab_produto_idx ON agrofit_fabricantes(produto_id)");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS agrofit_import_log (
        id SERIAL PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'running',
        id_inicio INTEGER, id_fim INTEGER,
        total_produtos INTEGER DEFAULT 0, total_erros INTEGER DEFAULT 0,
        iniciado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        finalizado_em TIMESTAMP, duracao_segundos INTEGER
      );
    `);

    await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm").catch(() => {});
    await pool.query("CREATE INDEX IF NOT EXISTS agrofit_ind_cultura_trgm ON agrofit_indicacoes USING gin (cultura gin_trgm_ops)").catch(() => {});
    await pool.query("CREATE INDEX IF NOT EXISTS agrofit_ind_praga_trgm ON agrofit_indicacoes USING gin (praga gin_trgm_ops)").catch(() => {});
    await pool.query("CREATE INDEX IF NOT EXISTS agrofit_ind_nome_comum_trgm ON agrofit_indicacoes USING gin (nome_comum gin_trgm_ops)").catch(() => {});
    await pool.query("CREATE INDEX IF NOT EXISTS agrofit_ing_nome_trgm ON agrofit_ingredientes USING gin (nome gin_trgm_ops)").catch(() => {});
    await pool.query("CREATE INDEX IF NOT EXISTS agrofit_prod_marca_trgm ON agrofit_produtos USING gin (marca_comercial gin_trgm_ops)").catch(() => {});

    const agrofitAlterColumns = [
      { table: "agrofit_produtos", column: "titular_registro", type: "TEXT" },
      { table: "agrofit_produtos", column: "status", type: "TEXT DEFAULT 'ativo'" },
      { table: "agrofit_ingredientes", column: "tipo", type: "TEXT" },
      { table: "agrofit_ingredientes", column: "nome_iupac", type: "TEXT" },
      { table: "agrofit_ingredientes", column: "nome_ca", type: "TEXT" },
      { table: "agrofit_ingredientes", column: "formula_bruta", type: "TEXT" },
      { table: "agrofit_indicacoes", column: "dose_min", type: "TEXT" },
      { table: "agrofit_indicacoes", column: "dose_max", type: "TEXT" },
      { table: "agrofit_indicacoes", column: "unidade_dose", type: "TEXT" },
      { table: "agrofit_indicacoes", column: "volume_calda_min", type: "TEXT" },
      { table: "agrofit_indicacoes", column: "volume_calda_max", type: "TEXT" },
      { table: "agrofit_indicacoes", column: "intervalo_aplicacao", type: "TEXT" },
      { table: "agrofit_indicacoes", column: "intervalo_seguranca", type: "TEXT" },
      { table: "agrofit_indicacoes", column: "epoca_aplicacao", type: "TEXT" },
      { table: "agrofit_indicacoes", column: "observacao", type: "TEXT" },
    ];
    for (const { table, column, type } of agrofitAlterColumns) {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`);
    }

    console.log("Tabelas AGROFIT verificadas/criadas");
  } catch (error: any) {
    console.error("Erro ao criar tabelas AGROFIT:", error.message);
  }
}
