import { Express } from "express";
import { pool } from "../db";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import { startImport, stopImport, getImportProgress } from "../lib/agrofit-scraper";

export function registerAgrofitRoutes(app: Express) {
  app.get("/api/agrofit/produtos", apiKeyAuth, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const classe = req.query.classe as string;
      const cultura = req.query.cultura as string;
      const ingrediente = req.query.ingrediente as string;
      const marca = req.query.marca as string;
      const search = req.query.search as string;
      const status = (req.query.status as string) || "ativo";
      const sortBy = (req.query.sort_by as string) || "id_agrofit";
      const sortOrder = (req.query.sort_order as string) === "desc" ? "DESC" : "ASC";

      const allowedSorts = ["id_agrofit", "marca_comercial", "classe", "nr_registro", "fetched_at"];
      const safeSortBy = allowedSorts.includes(sortBy) ? sortBy : "id_agrofit";

      let where = "WHERE 1=1";
      const params: any[] = [];
      let paramIdx = 1;

      if (status && status !== "todos") {
        where += ` AND p.status = $${paramIdx++}`;
        params.push(status);
      }

      if (classe) {
        where += ` AND p.classe = $${paramIdx++}`;
        params.push(classe);
      }

      if (marca) {
        where += ` AND p.marca_comercial ILIKE $${paramIdx++}`;
        params.push(`%${marca}%`);
      }

      if (search) {
        where += ` AND (p.marca_comercial ILIKE $${paramIdx} OR p.nr_registro ILIKE $${paramIdx} OR p.classe ILIKE $${paramIdx})`;
        params.push(`%${search}%`);
        paramIdx++;
      }

      if (cultura) {
        where += ` AND p.id IN (SELECT produto_id FROM agrofit_indicacoes WHERE cultura ILIKE $${paramIdx++})`;
        params.push(`%${cultura}%`);
      }

      if (ingrediente) {
        where += ` AND p.id IN (SELECT produto_id FROM agrofit_ingredientes WHERE nome ILIKE $${paramIdx++})`;
        params.push(`%${ingrediente}%`);
      }

      const countQuery = `SELECT COUNT(*) FROM agrofit_produtos p ${where}`;
      const countResult = await pool.query(countQuery, params);
      const total = parseInt(countResult.rows[0].count);

      const dataQuery = `
        SELECT p.*,
          (SELECT json_agg(json_build_object('nome', i.nome, 'grupo_quimico', i.grupo_quimico, 'percentual', i.percentual))
           FROM agrofit_ingredientes i WHERE i.produto_id = p.id) as ingredientes
        FROM agrofit_produtos p
        ${where}
        ORDER BY p.${safeSortBy} ${sortOrder}
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}
      `;
      params.push(limit, offset);

      const dataResult = await pool.query(dataQuery, params);

      res.json({
        data: dataResult.rows,
        total,
        limit,
        offset,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/agrofit/produtos/:id", apiKeyAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "ID inválido" });

      const produtoResult = await pool.query("SELECT * FROM agrofit_produtos WHERE id = $1", [id]);
      if (produtoResult.rows.length === 0) {
        return res.status(404).json({ message: "Produto não encontrado" });
      }

      const produto = produtoResult.rows[0];

      const [ingredientes, indicacoes] = await Promise.all([
        pool.query("SELECT * FROM agrofit_ingredientes WHERE produto_id = $1 ORDER BY id", [id]),
        pool.query("SELECT * FROM agrofit_indicacoes WHERE produto_id = $1 ORDER BY id", [id]),
      ]);

      const parseNum = (v: string | null) => {
        if (!v) return null;
        const n = parseFloat(v.replace(",", "."));
        return isNaN(n) ? null : n;
      };

      res.json({
        ...produto,
        ingredientes: ingredientes.rows.map((ing: any) => ({
          ...ing,
          percentual_num: parseNum(ing.percentual),
          quantidade_num: parseNum(ing.quantidade),
        })),
        indicacoes: indicacoes.rows.map((ind: any) => ({
          ...ind,
          dose_min_num: parseNum(ind.dose_min),
          dose_max_num: parseNum(ind.dose_max),
          intervalo_seguranca_num: parseNum(ind.intervalo_seguranca),
        })),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/agrofit/filter-options", apiKeyAuth, async (_req, res) => {
    try {
      const [classes, culturas, ingredientes] = await Promise.all([
        pool.query("SELECT DISTINCT classe FROM agrofit_produtos WHERE classe IS NOT NULL ORDER BY classe"),
        pool.query("SELECT DISTINCT cultura FROM agrofit_indicacoes WHERE cultura IS NOT NULL ORDER BY cultura LIMIT 500"),
        pool.query("SELECT DISTINCT nome FROM agrofit_ingredientes WHERE nome IS NOT NULL AND tipo = 'Ingrediente Ativo' ORDER BY nome LIMIT 500"),
      ]);

      res.json({
        classes: classes.rows.map((r: any) => r.classe),
        culturas: culturas.rows.map((r: any) => r.cultura),
        ingredientes: ingredientes.rows.map((r: any) => r.nome),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/agrofit/import", apiKeyAuth, async (req, res) => {
    try {
      const { id_inicio, id_fim } = req.body;

      const startId = parseInt(id_inicio) || 1;
      const endId = parseInt(id_fim) || 25000;

      if (startId > endId) {
        return res.status(400).json({ message: "ID inicial deve ser menor que ID final" });
      }

      if (endId - startId > 30000) {
        return res.status(400).json({ message: "Range máximo de 30.000 IDs por importação" });
      }

      const progress = getImportProgress();
      if (progress.running) {
        return res.status(409).json({ message: "Importação já em andamento" });
      }

      startImport(startId, endId).catch((err) => {
        console.error("[AGROFIT] Erro na importação:", err.message);
      });

      res.json({
        message: `Importação iniciada: IDs ${startId} a ${endId}`,
        id_inicio: startId,
        id_fim: endId,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/agrofit/import/stop", apiKeyAuth, async (_req, res) => {
    try {
      stopImport();
      res.json({ message: "Importação sendo parada..." });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/agrofit/import-progress", apiKeyAuth, async (_req, res) => {
    try {
      res.json(getImportProgress());
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/agrofit/import-history", apiKeyAuth, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      const result = await pool.query(
        `SELECT * FROM agrofit_import_log ORDER BY iniciado_em DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      const countResult = await pool.query("SELECT COUNT(*) FROM agrofit_import_log");

      res.json({
        data: result.rows,
        total: parseInt(countResult.rows[0].count),
        limit,
        offset,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/agrofit/equivalentes/:id", apiKeyAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "ID inválido" });

      const produtoResult = await pool.query("SELECT * FROM agrofit_produtos WHERE id = $1", [id]);
      if (produtoResult.rows.length === 0) {
        return res.status(404).json({ message: "Produto não encontrado" });
      }

      const produto = produtoResult.rows[0];

      const ingredientesResult = await pool.query(
        "SELECT nome FROM agrofit_ingredientes WHERE produto_id = $1 AND tipo = 'Ingrediente Ativo' ORDER BY nome",
        [id]
      );
      const ingredientesNomes = ingredientesResult.rows.map((r: any) => r.nome).filter(Boolean);

      if (ingredientesNomes.length === 0) {
        return res.json({ produto, equivalentes: [], criterio: "Sem ingredientes ativos para comparar" });
      }

      const uniqueNomes = [...new Set(ingredientesNomes)];
      const placeholders = uniqueNomes.map((_: any, i: number) => `$${i + 1}`).join(", ");

      const equivalentesResult = await pool.query(
        `SELECT p.id, p.id_agrofit, p.marca_comercial, p.nr_registro, p.classe, p.formulacao,
                p.classificacao_toxicologica, p.titular_registro, p.status,
                (SELECT json_agg(json_build_object('nome', i2.nome, 'percentual', i2.percentual, 'quantidade', i2.quantidade, 'unidade_medida', i2.unidade_medida))
                 FROM agrofit_ingredientes i2 WHERE i2.produto_id = p.id AND i2.tipo = 'Ingrediente Ativo') as ingredientes
         FROM agrofit_produtos p
         WHERE p.id != $${uniqueNomes.length + 1}
           AND p.classe = $${uniqueNomes.length + 2}
           AND (SELECT COUNT(*) FROM agrofit_ingredientes ia WHERE ia.produto_id = p.id AND ia.tipo = 'Ingrediente Ativo') = $${uniqueNomes.length + 3}
           AND (SELECT COUNT(*) FROM agrofit_ingredientes ia WHERE ia.produto_id = p.id AND ia.tipo = 'Ingrediente Ativo' AND ia.nome IN (${placeholders})) = $${uniqueNomes.length + 4}
         ORDER BY p.marca_comercial`,
        [...uniqueNomes, id, produto.classe, uniqueNomes.length, uniqueNomes.length]
      );

      res.json({
        produto: {
          id: produto.id,
          marca_comercial: produto.marca_comercial,
          classe: produto.classe,
          formulacao: produto.formulacao,
          titular_registro: produto.titular_registro,
        },
        ingredientesAtivos: ingredientesNomes,
        equivalentes: equivalentesResult.rows,
        total: equivalentesResult.rows.length,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/agrofit/por-ingrediente", apiKeyAuth, async (req, res) => {
    try {
      const nome = req.query.nome as string;
      if (!nome) return res.status(400).json({ message: "Parâmetro 'nome' é obrigatório" });

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      const countResult = await pool.query(
        `SELECT COUNT(DISTINCT p.id) FROM agrofit_produtos p
         JOIN agrofit_ingredientes i ON i.produto_id = p.id
         WHERE i.nome ILIKE $1`,
        [`%${nome}%`]
      );

      const result = await pool.query(
        `SELECT p.id, p.id_agrofit, p.marca_comercial, p.nr_registro, p.classe, p.formulacao,
                p.classificacao_toxicologica, p.titular_registro, p.status,
                (SELECT json_agg(json_build_object('nome', i2.nome, 'percentual', i2.percentual, 'quantidade', i2.quantidade, 'unidade_medida', i2.unidade_medida))
                 FROM agrofit_ingredientes i2 WHERE i2.produto_id = p.id) as ingredientes
         FROM agrofit_produtos p
         WHERE p.id IN (SELECT DISTINCT i.produto_id FROM agrofit_ingredientes i WHERE i.nome ILIKE $1)
         ORDER BY p.marca_comercial
         LIMIT $2 OFFSET $3`,
        [`%${nome}%`, limit, offset]
      );

      res.json({
        data: result.rows,
        total: parseInt(countResult.rows[0].count),
        ingrediente: nome,
        limit,
        offset,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/agrofit/busca", apiKeyAuth, async (req, res) => {
    try {
      const cultura = req.query.cultura as string;
      const praga = req.query.praga as string;
      const classe = req.query.classe as string;
      const status = (req.query.status as string) || "ativo";
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      if (!cultura && !praga) {
        return res.status(400).json({ message: "Informe ao menos 'cultura' ou 'praga'" });
      }

      const params: any[] = [];
      let idx = 1;
      const indConds: string[] = [];
      const indSubConds: string[] = [];
      const prodConds: string[] = [];
      let culturaIdx = 0;
      let pragaIdx = 0;

      if (cultura) {
        culturaIdx = idx;
        indConds.push(`ind.cultura ILIKE $${idx}`);
        indSubConds.push(`ind2.cultura ILIKE $${idx}`);
        params.push(`%${cultura}%`);
        idx++;
      }
      if (praga) {
        pragaIdx = idx;
        indConds.push(`(ind.praga ILIKE $${idx} OR ind.nome_comum ILIKE $${idx})`);
        indSubConds.push(`(ind2.praga ILIKE $${idx} OR ind2.nome_comum ILIKE $${idx})`);
        params.push(`%${praga}%`);
        idx++;
      }

      let classeIdx = 0;
      if (classe) {
        classeIdx = idx;
        params.push(classe);
        idx++;
      }

      let statusIdx = 0;
      if (status && status !== "todos") {
        statusIdx = idx;
        prodConds.push(`p.status = $${idx}`);
        params.push(status);
        idx++;
      }

      const indWhere = indConds.join(" AND ");

      const countParams = [...params];
      const prodWhereExtra = [
        ...(classe ? [`p.classe = $${classeIdx}`] : []),
        ...prodConds,
      ];

      const countResult = await pool.query(
        `SELECT COUNT(DISTINCT p.id) FROM agrofit_produtos p
         JOIN agrofit_indicacoes ind ON ind.produto_id = p.id
         WHERE ${indWhere}
         ${prodWhereExtra.length > 0 ? `AND ${prodWhereExtra.join(" AND ")}` : ""}`,
        countParams
      );
      const total = parseInt(countResult.rows[0].count);

      const limitIdx = idx++;
      const offsetIdx = idx++;
      const dataParams = [...params, limit, offset];

      const dataResult = await pool.query(
        `SELECT p.id, p.id_agrofit, p.marca_comercial, p.nr_registro, p.classe, p.formulacao,
                p.classificacao_toxicologica, p.titular_registro, p.status,
                (SELECT json_agg(json_build_object(
                  'nome', i.nome, 'percentual', i.percentual,
                  'quantidade', i.quantidade, 'unidade_medida', i.unidade_medida
                )) FROM agrofit_ingredientes i WHERE i.produto_id = p.id AND i.tipo = 'Ingrediente Ativo') as ingredientes,
                (SELECT json_agg(json_build_object(
                  'cultura', ind2.cultura, 'praga', ind2.praga, 'nome_comum', ind2.nome_comum,
                  'dose_min', ind2.dose_min, 'dose_max', ind2.dose_max,
                  'unidade_dose', ind2.unidade_dose,
                  'intervalo_seguranca', ind2.intervalo_seguranca
                )) FROM agrofit_indicacoes ind2 WHERE ind2.produto_id = p.id
                  AND ${indSubConds.join(" AND ")}
                ) as indicacoes_relevantes
         FROM agrofit_produtos p
         WHERE p.id IN (
           SELECT DISTINCT ind.produto_id FROM agrofit_indicacoes ind WHERE ${indWhere}
         )
         ${prodWhereExtra.length > 0 ? `AND ${prodWhereExtra.join(" AND ")}` : ""}
         ORDER BY p.marca_comercial
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        dataParams
      );

      res.json({
        data: dataResult.rows,
        total,
        filtros: { cultura: cultura || null, praga: praga || null, classe: classe || null },
        limit,
        offset,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/agrofit/pragas", apiKeyAuth, async (req, res) => {
    try {
      const cultura = req.query.cultura as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

      let query = `SELECT DISTINCT nome_comum, praga FROM agrofit_indicacoes WHERE nome_comum IS NOT NULL`;
      const params: any[] = [];

      if (cultura) {
        query += ` AND cultura ILIKE $1`;
        params.push(`%${cultura}%`);
      }

      query += ` ORDER BY nome_comum LIMIT $${params.length + 1}`;
      params.push(limit);

      const result = await pool.query(query, params);

      res.json({
        data: result.rows,
        total: result.rows.length,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/agrofit/stats", apiKeyAuth, async (_req, res) => {
    try {
      const [totalProdutos, totalIngredientes, totalIndicacoes, porClasse] = await Promise.all([
        pool.query("SELECT COUNT(*) FROM agrofit_produtos"),
        pool.query("SELECT COUNT(DISTINCT nome) FROM agrofit_ingredientes WHERE nome IS NOT NULL"),
        pool.query("SELECT COUNT(DISTINCT cultura) FROM agrofit_indicacoes WHERE cultura IS NOT NULL"),
        pool.query("SELECT classe, COUNT(*) as total FROM agrofit_produtos WHERE classe IS NOT NULL GROUP BY classe ORDER BY total DESC"),
      ]);

      res.json({
        totalProdutos: parseInt(totalProdutos.rows[0].count),
        totalIngredientesAtivos: parseInt(totalIngredientes.rows[0].count),
        totalCulturas: parseInt(totalIndicacoes.rows[0].count),
        porClasse: porClasse.rows,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
