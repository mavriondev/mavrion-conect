import { Express } from "express";
import { pool } from "../db";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import { enqueueImport, getQueueProgress } from "../lib/sicar-import";
import { startAltitudeWorker, stopAltitudeWorker, getAltitudeWorkerStats, autoStartIfPending } from "../lib/altitude-worker";
import { backfillGeoData } from "../lib/backfill-geo";

export function registerSicarRoutes(app: Express) {
  app.post("/api/sicar/import", apiKeyAuth, async (req, res) => {
    try {
      const { ufs, municipio } = req.body;

      if (!ufs || !Array.isArray(ufs) || ufs.length === 0) {
        return res.status(400).json({ message: "Campo 'ufs' é obrigatório (array de UFs)" });
      }

      const validUfs = ufs.map((u: string) => u.toUpperCase().trim()).filter(Boolean);
      await enqueueImport(validUfs, municipio || undefined);

      res.json({
        message: `Importação enfileirada para ${validUfs.length} UF(s)`,
        ufs: validUfs,
        municipio: municipio || null,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sicar/import-progress", apiKeyAuth, async (_req, res) => {
    try {
      const progress = getQueueProgress();
      res.json(progress);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sicar/import-history", apiKeyAuth, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const uf = req.query.uf as string;

      let query = `SELECT * FROM sicar_import_log`;
      const params: any[] = [];

      if (uf) {
        query += ` WHERE uf = $1`;
        params.push(uf.toUpperCase());
      }

      query += ` ORDER BY iniciado_em DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const result = await pool.query(query, params);

      let countQuery = `SELECT COUNT(*) FROM sicar_import_log`;
      const countParams: any[] = [];
      if (uf) {
        countQuery += ` WHERE uf = $1`;
        countParams.push(uf.toUpperCase());
      }
      const countResult = await pool.query(countQuery, countParams);

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

  app.get("/api/sicar/cache-stats", apiKeyAuth, async (_req, res) => {
    try {
      const estResult = await pool.query(
        "SELECT reltuples::bigint AS count FROM pg_class WHERE relname = 'sicar_imoveis_cache'"
      );
      const total = parseInt(estResult.rows[0]?.count || "0");

      let byUf: any[] = [];
      try {
        const ufResult = await Promise.race([
          pool.query(`
            SELECT uf, COUNT(*) as total, MAX(fetched_at) as ultima_atualizacao
            FROM sicar_imoveis_cache
            GROUP BY uf
            ORDER BY uf
          `),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))
        ]) as any;
        byUf = ufResult.rows;
      } catch {}

      let geometrias = null;
      try {
        const geomEst = await pool.query(
          "SELECT reltuples::bigint AS count FROM pg_class WHERE relname = 'idx_sicar_imoveis_uf_geom'"
        );
        const comGeom = parseInt(geomEst.rows[0]?.count || "0");
        geometrias = { comGeometria: comGeom, semGeometria: Math.max(0, total - comGeom) };
      } catch {}

      res.json({
        total,
        porUf: byUf,
        geometrias,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sicar/imoveis/filter-options", apiKeyAuth, async (_req, res) => {
    try {
      const [ufs, status, tipos, condicoes] = await Promise.all([
        pool.query("SELECT DISTINCT uf FROM sicar_imoveis_cache ORDER BY uf"),
        pool.query("SELECT DISTINCT ind_status FROM sicar_imoveis_cache WHERE ind_status IS NOT NULL ORDER BY ind_status"),
        pool.query("SELECT DISTINCT ind_tipo FROM sicar_imoveis_cache WHERE ind_tipo IS NOT NULL ORDER BY ind_tipo"),
        pool.query("SELECT DISTINCT condicao FROM sicar_imoveis_cache WHERE condicao IS NOT NULL ORDER BY condicao"),
      ]);

      res.json({
        ufs: ufs.rows.map((r: any) => r.uf),
        status: status.rows.map((r: any) => r.ind_status),
        tipos: tipos.rows.map((r: any) => r.ind_tipo),
        condicoes: condicoes.rows.map((r: any) => r.condicao),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sicar/imoveis", apiKeyAuth, async (req, res) => {
    try {
      const conditions: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;

      const uf = req.query.uf as string;
      const municipio = req.query.municipio as string;
      const codImovel = req.query.cod_imovel as string;
      const indStatus = req.query.ind_status as string;
      const indTipo = req.query.ind_tipo as string;
      const condicao = req.query.condicao as string;
      const areaMin = parseFloat(req.query.area_min as string) || undefined;
      const areaMax = parseFloat(req.query.area_max as string) || undefined;
      const mFiscalMin = parseFloat(req.query.m_fiscal_min as string) || undefined;
      const mFiscalMax = parseFloat(req.query.m_fiscal_max as string) || undefined;
      const codMunicipioIbge = parseInt(req.query.cod_municipio_ibge as string) || undefined;
      const datCriacaoDe = req.query.dat_criacao_de as string;
      const datCriacaoAte = req.query.dat_criacao_ate as string;
      const dataAtualizacaoDe = req.query.data_atualizacao_de as string;
      const dataAtualizacaoAte = req.query.data_atualizacao_ate as string;
      const fetchedAtDe = req.query.fetched_at_de as string;
      const fetchedAtAte = req.query.fetched_at_ate as string;
      const altMediaMin = parseFloat(req.query.alt_media_min as string) || undefined;
      const altMediaMax = parseFloat(req.query.alt_media_max as string) || undefined;
      const altMinVal = parseFloat(req.query.alt_min as string) || undefined;
      const altMaxVal = parseFloat(req.query.alt_max as string) || undefined;
      const argilaPctMin = parseFloat(req.query.argila_media_min as string) || undefined;
      const argilaPctMax = parseFloat(req.query.argila_media_max as string) || undefined;
      const includeGeometry = req.query.include_geometry === "true";

      if (uf) { conditions.push(`uf = $${paramIdx++}`); params.push(uf.toUpperCase()); }
      if (municipio) { conditions.push(`municipio ILIKE $${paramIdx++}`); params.push(`%${municipio}%`); }
      if (codImovel) { conditions.push(`cod_imovel ILIKE $${paramIdx++}`); params.push(`%${codImovel}%`); }
      if (indStatus) { conditions.push(`ind_status = $${paramIdx++}`); params.push(indStatus); }
      if (indTipo) { conditions.push(`ind_tipo = $${paramIdx++}`); params.push(indTipo); }
      if (condicao) { conditions.push(`condicao = $${paramIdx++}`); params.push(condicao); }
      if (areaMin !== undefined) { conditions.push(`num_area >= $${paramIdx++}`); params.push(areaMin); }
      if (areaMax !== undefined) { conditions.push(`num_area <= $${paramIdx++}`); params.push(areaMax); }
      if (mFiscalMin !== undefined) { conditions.push(`m_fiscal >= $${paramIdx++}`); params.push(mFiscalMin); }
      if (mFiscalMax !== undefined) { conditions.push(`m_fiscal <= $${paramIdx++}`); params.push(mFiscalMax); }
      if (codMunicipioIbge !== undefined) { conditions.push(`cod_municipio_ibge = $${paramIdx++}`); params.push(codMunicipioIbge); }
      if (datCriacaoDe) { conditions.push(`dat_criacao >= $${paramIdx++}::date`); params.push(datCriacaoDe); }
      if (datCriacaoAte) { conditions.push(`dat_criacao <= $${paramIdx++}::date + interval '1 day'`); params.push(datCriacaoAte); }
      if (dataAtualizacaoDe) { conditions.push(`data_atualizacao >= $${paramIdx++}::date`); params.push(dataAtualizacaoDe); }
      if (dataAtualizacaoAte) { conditions.push(`data_atualizacao <= $${paramIdx++}::date + interval '1 day'`); params.push(dataAtualizacaoAte); }
      if (fetchedAtDe) { conditions.push(`fetched_at >= $${paramIdx++}::date`); params.push(fetchedAtDe); }
      if (fetchedAtAte) { conditions.push(`fetched_at <= $${paramIdx++}::date + interval '1 day'`); params.push(fetchedAtAte); }
      if (altMediaMin !== undefined) { conditions.push(`alt_media >= $${paramIdx++}`); params.push(altMediaMin); }
      if (altMediaMax !== undefined) { conditions.push(`alt_media <= $${paramIdx++}`); params.push(altMediaMax); }
      if (altMinVal !== undefined) { conditions.push(`alt_min >= $${paramIdx++}`); params.push(altMinVal); }
      if (altMaxVal !== undefined) { conditions.push(`alt_max <= $${paramIdx++}`); params.push(altMaxVal); }
      if (argilaPctMin !== undefined) { conditions.push(`argila_pct >= $${paramIdx++}`); params.push(argilaPctMin); }
      if (argilaPctMax !== undefined) { conditions.push(`argila_pct <= $${paramIdx++}`); params.push(argilaPctMax); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const validSortCols: Record<string, string> = {
        cod_imovel: "cod_imovel",
        municipio: "municipio",
        num_area: "num_area",
        m_fiscal: "m_fiscal",
        dat_criacao: "dat_criacao",
        data_atualizacao: "data_atualizacao",
        ind_status: "ind_status",
        condicao: "condicao",
        uf: "uf",
        fetched_at: "fetched_at",
        alt_media: "alt_media",
        alt_min: "alt_min",
        alt_max: "alt_max",
      };
      const sortField = validSortCols[req.query.sort as string] || "cod_imovel";
      const sortOrder = (req.query.order as string)?.toLowerCase() === "desc" ? "DESC" : "ASC";

      const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 50), includeGeometry ? 50 : 200);
      const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

      const geometryCol = includeGeometry ? `, geometry, ST_AsGeoJSON(geom)::jsonb as geojson` : "";

      const query = `
        SELECT id, cod_imovel, uf, municipio, num_area, ind_status, ind_tipo,
               dat_criacao, data_atualizacao, condicao, cod_municipio_ibge, m_fiscal,
               alt_media, alt_min, alt_max, centroid_lat, centroid_lon, perimetro_km, declividade, argila_pct, fetched_at${geometryCol}
        FROM sicar_imoveis_cache
        ${where}
        ORDER BY ${sortField} ${sortOrder} NULLS LAST
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}
      `;
      params.push(limit, offset);

      const [dataResult, countResult] = await Promise.all([
        pool.query(query, params),
        pool.query(`SELECT COUNT(*) FROM sicar_imoveis_cache ${where}`, params.slice(0, -2)),
      ]);

      res.json({
        data: dataResult.rows,
        total: parseInt(countResult.rows[0].count),
        limit,
        offset,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sicar/search", apiKeyAuth, async (req, res) => {
    try {
      const uf = req.query.uf as string;
      const municipio = req.query.municipio as string;
      const areaMin = parseFloat(req.query.area_min as string) || undefined;
      const areaMax = parseFloat(req.query.area_max as string) || undefined;
      const altMediaMin = parseFloat(req.query.alt_media_min as string) || undefined;
      const altMediaMax = parseFloat(req.query.alt_media_max as string) || undefined;
      const altMinVal = parseFloat(req.query.alt_min as string) || undefined;
      const altMaxVal = parseFloat(req.query.alt_max as string) || undefined;
      const argilaPctMin = parseFloat(req.query.argila_media_min as string) || undefined;
      const argilaPctMax = parseFloat(req.query.argila_media_max as string) || undefined;
      const indStatus = req.query.ind_status as string;
      const indTipo = req.query.ind_tipo as string;
      const condicao = req.query.condicao as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
      const offset = parseInt(req.query.offset as string) || 0;

      const conditions: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;

      if (uf) {
        conditions.push(`uf = $${paramIdx++}`);
        params.push(uf.toUpperCase());
      }
      if (municipio) {
        conditions.push(`municipio ILIKE $${paramIdx++}`);
        params.push(`%${municipio}%`);
      }
      if (areaMin !== undefined) {
        conditions.push(`num_area >= $${paramIdx++}`);
        params.push(areaMin);
      }
      if (areaMax !== undefined) {
        conditions.push(`num_area <= $${paramIdx++}`);
        params.push(areaMax);
      }
      if (altMediaMin !== undefined) {
        conditions.push(`alt_media >= $${paramIdx++}`);
        params.push(altMediaMin);
      }
      if (altMediaMax !== undefined) {
        conditions.push(`alt_media <= $${paramIdx++}`);
        params.push(altMediaMax);
      }
      if (altMinVal !== undefined) {
        conditions.push(`alt_min >= $${paramIdx++}`);
        params.push(altMinVal);
      }
      if (altMaxVal !== undefined) {
        conditions.push(`alt_max <= $${paramIdx++}`);
        params.push(altMaxVal);
      }
      if (argilaPctMin !== undefined) {
        conditions.push(`argila_pct >= $${paramIdx++}`);
        params.push(argilaPctMin);
      }
      if (argilaPctMax !== undefined) {
        conditions.push(`argila_pct <= $${paramIdx++}`);
        params.push(argilaPctMax);
      }
      if (indStatus) {
        conditions.push(`ind_status = $${paramIdx++}`);
        params.push(indStatus);
      }
      if (indTipo) {
        conditions.push(`ind_tipo = $${paramIdx++}`);
        params.push(indTipo);
      }
      if (condicao) {
        conditions.push(`condicao = $${paramIdx++}`);
        params.push(condicao);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const query = `
        SELECT id, cod_imovel, uf, municipio, num_area, ind_status, ind_tipo,
               dat_criacao, data_atualizacao, condicao, cod_municipio_ibge, m_fiscal,
               alt_media, alt_min, alt_max, centroid_lat, centroid_lon, perimetro_km, declividade, argila_pct, fetched_at
        FROM sicar_imoveis_cache
        ${where}
        ORDER BY id
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}
      `;
      params.push(limit, offset);

      const result = await pool.query(query, params);

      let total: number;
      const countParams = params.slice(0, -2);
      try {
        const client = await pool.connect();
        try {
          await client.query("SET LOCAL statement_timeout = '8s'");
          const countResult = await client.query(`SELECT COUNT(*) FROM sicar_imoveis_cache ${where}`, countParams);
          total = parseInt(countResult.rows[0].count);
        } catch (e: any) {
          if (e.code === "57014" || e.message?.includes("timeout") || e.message?.includes("cancel")) {
            const estResult = await client.query(
              "SELECT reltuples::bigint AS count FROM pg_class WHERE relname = 'sicar_imoveis_cache'"
            );
            total = parseInt(estResult.rows[0]?.count || "0");
          } else {
            throw e;
          }
        } finally {
          client.release();
        }
      } catch (e: any) {
        if (e.code === "57014" || e.message?.includes("timeout") || e.message?.includes("cancel")) {
          total = -1;
        } else {
          throw e;
        }
      }

      res.json({
        data: result.rows,
        total,
        limit,
        offset,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sicar/geojson/stats", apiKeyAuth, async (req, res) => {
    try {
      const { bbox, uf } = req.query;

      if (!bbox) {
        const result = await pool.query(`
          SELECT COUNT(*) as total_imoveis, COUNT(geom) as com_geometria,
                 COUNT(*) - COUNT(geom) as sem_geometria, COUNT(DISTINCT uf) as ufs_com_geom
          FROM sicar_imoveis_cache
        `);
        return res.json(result.rows[0]);
      }

      const [minLng, minLat, maxLng, maxLat] = (bbox as string).split(",").map(Number);
      if ([minLng, minLat, maxLng, maxLat].some(isNaN)) {
        return res.status(400).json({ message: "bbox inválido. Formato: minLng,minLat,maxLng,maxLat" });
      }

      let whereExtra = "";
      const params: any[] = [minLng, minLat, maxLng, maxLat];
      if (uf) {
        whereExtra = "AND uf = $5";
        params.push((uf as string).toUpperCase());
      }

      const result = await pool.query(`
        SELECT COUNT(*) as total, COUNT(DISTINCT municipio) as municipios,
               ROUND(COALESCE(SUM(num_area), 0)::numeric, 2) as area_total_ha,
               ROUND(COALESCE(AVG(num_area), 0)::numeric, 2) as area_media_ha,
               json_agg(DISTINCT uf) as ufs
        FROM sicar_imoveis_cache
        WHERE geom IS NOT NULL AND geom && ST_MakeEnvelope($1, $2, $3, $4, 4326) ${whereExtra}
      `, params);

      res.json({ bbox: [minLng, minLat, maxLng, maxLat], ...result.rows[0] });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sicar/geojson/clusters", apiKeyAuth, async (req, res) => {
    try {
      const { bbox, zoom = "7", gridSize } = req.query;
      if (!bbox) {
        return res.status(400).json({ message: "Parâmetro bbox obrigatório" });
      }

      const [minLng, minLat, maxLng, maxLat] = (bbox as string).split(",").map(Number);
      if ([minLng, minLat, maxLng, maxLat].some(isNaN)) {
        return res.status(400).json({ message: "bbox inválido" });
      }

      const zoomLevel = parseInt(zoom as string);
      let grid = parseFloat(gridSize as string) || 0;
      if (!grid) {
        if (zoomLevel <= 5) grid = 2.0;
        else if (zoomLevel <= 7) grid = 1.0;
        else if (zoomLevel <= 9) grid = 0.5;
        else if (zoomLevel <= 11) grid = 0.1;
        else grid = 0.05;
      }

      const result = await pool.query(`
        SELECT
          FLOOR(ST_X(ST_Centroid(geom)) / $5) * $5 + $5/2 as lng,
          FLOOR(ST_Y(ST_Centroid(geom)) / $5) * $5 + $5/2 as lat,
          COUNT(*) as count,
          ROUND(COALESCE(SUM(num_area), 0)::numeric, 0) as area_total,
          array_agg(DISTINCT municipio) as municipios
        FROM sicar_imoveis_cache
        WHERE geom IS NOT NULL AND geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
        GROUP BY 1, 2 ORDER BY count DESC
      `, [minLng, minLat, maxLng, maxLat, grid]);

      res.json({
        type: "FeatureCollection",
        features: result.rows.map((row: any) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [parseFloat(row.lng), parseFloat(row.lat)] },
          properties: {
            count: parseInt(row.count),
            area_total_ha: parseFloat(row.area_total),
            municipios: row.municipios.slice(0, 5),
          },
        })),
        metadata: { bbox: [minLng, minLat, maxLng, maxLat], zoom: zoomLevel, gridSize: grid, totalClusters: result.rows.length },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sicar/geojson", apiKeyAuth, async (req, res) => {
    try {
      const { bbox, zoom = "10", limit = "500", uf } = req.query;
      if (!bbox) {
        return res.status(400).json({ message: "Parâmetro bbox obrigatório. Formato: minLng,minLat,maxLng,maxLat" });
      }

      const [minLng, minLat, maxLng, maxLat] = (bbox as string).split(",").map(Number);
      if ([minLng, minLat, maxLng, maxLat].some(isNaN)) {
        return res.status(400).json({ message: "bbox inválido" });
      }

      const zoomLevel = parseInt(zoom as string);
      const maxResults = Math.min(parseInt(limit as string) || 500, 2000);

      let tolerance = 0;
      if (zoomLevel <= 7) tolerance = 0.01;
      else if (zoomLevel <= 10) tolerance = 0.005;
      else if (zoomLevel <= 13) tolerance = 0.001;

      const geometryExpr = tolerance > 0
        ? `ST_SimplifyPreserveTopology(geom, ${tolerance})`
        : `geom`;

      let whereExtra = "";
      const params: any[] = [minLng, minLat, maxLng, maxLat, maxResults];
      if (uf) {
        whereExtra = "AND uf = $6";
        params.push((uf as string).toUpperCase());
      }

      const result = await pool.query(`
        SELECT cod_imovel, uf, municipio, num_area, ind_status, ind_tipo,
               ST_AsGeoJSON(${geometryExpr})::jsonb as geometry
        FROM sicar_imoveis_cache
        WHERE geom IS NOT NULL AND geom && ST_MakeEnvelope($1, $2, $3, $4, 4326) ${whereExtra}
        ORDER BY num_area DESC NULLS LAST LIMIT $5
      `, params);

      res.json({
        type: "FeatureCollection",
        features: result.rows.map((row: any) => ({
          type: "Feature",
          geometry: row.geometry,
          properties: { cod_imovel: row.cod_imovel, uf: row.uf, municipio: row.municipio, num_area: row.num_area, ind_status: row.ind_status, ind_tipo: row.ind_tipo },
        })),
        metadata: { total: result.rows.length, bbox: [minLng, minLat, maxLng, maxLat], zoom: zoomLevel, tolerance, limit: maxResults },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sicar/backfill-geometries", apiKeyAuth, async (req, res) => {
    try {
      const { uf, batchSize } = req.body || {};
      const parsedBatchSize = parseInt(batchSize) || 1000;

      let whereClause = "WHERE geom IS NULL AND geometry IS NOT NULL AND geometry->>'type' IS NOT NULL";
      const params: any[] = [];
      if (uf) {
        whereClause += " AND uf = $1";
        params.push(uf.toUpperCase());
      }

      const countResult = await pool.query(
        `SELECT COUNT(*) as total FROM sicar_imoveis_cache ${whereClause}`, params
      );
      const total = parseInt(countResult.rows[0].total);

      if (total === 0) {
        return res.json({ message: "Nenhum registro pendente de conversão", converted: 0, total: 0, errors: 0 });
      }

      let converted = 0;
      let errors = 0;
      const limit = Math.min(Math.max(parsedBatchSize, 1), 5000);

      const rows = await pool.query(
        `SELECT id, geometry FROM sicar_imoveis_cache ${whereClause} AND geom IS NULL LIMIT ${limit}`, params
      );

      for (const row of rows.rows) {
        try {
          await pool.query(
            `UPDATE sicar_imoveis_cache SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1::text), 4326) WHERE id = $2`,
            [JSON.stringify(row.geometry), row.id]
          );
          converted++;
        } catch {
          errors++;
        }
      }

      res.json({ total, converted, errors, remaining: total - converted - errors });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sicar/backfill-fields", apiKeyAuth, async (req, res) => {
    try {
      const { uf, batchSize } = req.body || {};
      const limit = Math.min(Math.max(parseInt(batchSize) || 5000, 1), 50000);

      let whereUf = "";
      const params: any[] = [];
      if (uf) {
        whereUf = "AND uf = $1";
        params.push(uf.toUpperCase());
      }

      const result = await pool.query(`
        UPDATE sicar_imoveis_cache SET
          num_area = COALESCE(num_area, (properties->>'area')::double precision),
          ind_status = COALESCE(ind_status, properties->>'status_imovel'),
          ind_tipo = COALESCE(ind_tipo, properties->>'tipo_imovel'),
          dat_criacao = COALESCE(dat_criacao, (properties->>'dat_criacao')::timestamp),
          data_atualizacao = COALESCE(data_atualizacao, (properties->>'data_atualizacao')::timestamp),
          condicao = COALESCE(condicao, properties->>'condicao'),
          cod_municipio_ibge = COALESCE(cod_municipio_ibge, (properties->>'cod_municipio_ibge')::integer),
          m_fiscal = COALESCE(m_fiscal, (properties->>'m_fiscal')::double precision)
        WHERE properties IS NOT NULL ${whereUf}
          AND (num_area IS NULL OR ind_status IS NULL OR ind_tipo IS NULL
               OR dat_criacao IS NULL OR data_atualizacao IS NULL OR condicao IS NULL OR cod_municipio_ibge IS NULL OR m_fiscal IS NULL)
          AND id IN (
            SELECT id FROM sicar_imoveis_cache
            WHERE properties IS NOT NULL ${whereUf}
              AND (num_area IS NULL OR ind_status IS NULL OR ind_tipo IS NULL
                   OR dat_criacao IS NULL OR data_atualizacao IS NULL OR condicao IS NULL OR cod_municipio_ibge IS NULL OR m_fiscal IS NULL)
            LIMIT ${limit}
          )
      `, params);

      res.json({
        updated: result.rowCount,
        batchSize: limit,
        message: `${result.rowCount} registro(s) atualizado(s)`,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sicar/schedules", apiKeyAuth, async (_req, res) => {
    try {
      const result = await pool.query(
        `SELECT * FROM sicar_import_schedule ORDER BY criado_em DESC`
      );
      res.json(result.rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sicar/:codigo/geojson", apiKeyAuth, async (req, res) => {
    try {
      const { codigo } = req.params;
      const result = await pool.query(
        `SELECT cod_imovel, uf, municipio, num_area, ind_status, ind_tipo,
                dat_criacao, data_atualizacao, condicao, cod_municipio_ibge, m_fiscal,
                ST_AsGeoJSON(geom)::jsonb as geometry,
                ST_Area(geom::geography) as area_m2,
                ST_AsText(ST_Centroid(geom)) as centroid
         FROM sicar_imoveis_cache WHERE cod_imovel = $1 AND geom IS NOT NULL`,
        [codigo]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Imóvel não encontrado ou sem geometria" });
      }

      const row = result.rows[0];
      const centroidMatch = row.centroid?.match(/POINT\(([-\d.]+) ([-\d.]+)\)/);

      res.json({
        type: "Feature",
        geometry: row.geometry,
        properties: {
          cod_imovel: row.cod_imovel, uf: row.uf, municipio: row.municipio,
          num_area: row.num_area, ind_status: row.ind_status, ind_tipo: row.ind_tipo,
          dat_criacao: row.dat_criacao, data_atualizacao: row.data_atualizacao,
          condicao: row.condicao, cod_municipio_ibge: row.cod_municipio_ibge, m_fiscal: row.m_fiscal,
          area_calculada_m2: row.area_m2 ? Math.round(row.area_m2) : null,
          area_calculada_ha: row.area_m2 ? Math.round(row.area_m2 / 10000 * 100) / 100 : null,
          centroid: centroidMatch ? { lng: parseFloat(centroidMatch[1]), lat: parseFloat(centroidMatch[2]) } : null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sicar/:codigo", apiKeyAuth, async (req, res) => {
    try {
      const { codigo } = req.params;
      const result = await pool.query(
        `SELECT * FROM sicar_imoveis_cache WHERE cod_imovel = $1`,
        [codigo]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Imóvel não encontrado" });
      }

      res.json(result.rows[0]);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sicar/schedule", apiKeyAuth, async (req, res) => {
    try {
      const { uf, cronExpression, descricao } = req.body;

      if (!uf || !cronExpression) {
        return res.status(400).json({ message: "Campos 'uf' e 'cronExpression' são obrigatórios" });
      }

      const { isValidCron } = await import("../scheduler");
      if (!isValidCron(cronExpression)) {
        return res.status(400).json({ message: "Expressão cron inválida" });
      }

      const result = await pool.query(
        `INSERT INTO sicar_import_schedule (uf, cron_expression, descricao)
         VALUES ($1, $2, $3) RETURNING *`,
        [uf.toUpperCase(), cronExpression, descricao || null]
      );

      const { scheduleImport } = await import("../scheduler");
      scheduleImport(result.rows[0]);

      res.json(result.rows[0]);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/sicar/schedule/:id", apiKeyAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { ativo, cronExpression, descricao } = req.body;

      const updates: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;

      if (ativo !== undefined) {
        updates.push(`ativo = $${paramIdx++}`);
        params.push(ativo);
      }
      if (cronExpression) {
        const { isValidCron } = await import("../scheduler");
        if (!isValidCron(cronExpression)) {
          return res.status(400).json({ message: "Expressão cron inválida" });
        }
        updates.push(`cron_expression = $${paramIdx++}`);
        params.push(cronExpression);
      }
      if (descricao !== undefined) {
        updates.push(`descricao = $${paramIdx++}`);
        params.push(descricao);
      }

      if (updates.length === 0) {
        return res.status(400).json({ message: "Nenhum campo para atualizar" });
      }

      params.push(id);
      const result = await pool.query(
        `UPDATE sicar_import_schedule SET ${updates.join(", ")} WHERE id = $${paramIdx} RETURNING *`,
        params
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Agendamento não encontrado" });
      }

      const { updateSchedule } = await import("../scheduler");
      updateSchedule(result.rows[0]);

      res.json(result.rows[0]);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/sicar/schedule/:id", apiKeyAuth, async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `DELETE FROM sicar_import_schedule WHERE id = $1 RETURNING *`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Agendamento não encontrado" });
      }

      const { unscheduleImport } = await import("../scheduler");
      unscheduleImport(parseInt(id));

      res.json({ message: "Agendamento removido", deleted: result.rows[0] });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sicar/altitude/start", apiKeyAuth, async (_req, res) => {
    try {
      const stats = getAltitudeWorkerStats();
      if (stats.isRunning) {
        return res.json({ message: "Worker ja esta rodando", stats });
      }
      startAltitudeWorker();
      res.json({ message: "Worker de altitude iniciado", stats: getAltitudeWorkerStats() });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sicar/altitude/stop", apiKeyAuth, async (_req, res) => {
    try {
      stopAltitudeWorker();
      res.json({ message: "Sinal de parada enviado", stats: getAltitudeWorkerStats() });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sicar/altitude/backfill", apiKeyAuth, async (_req, res) => {
    try {
      backfillGeoData().catch((err: any) => console.error("[Backfill] Error:", err.message));
      res.json({ message: "Backfill iniciado em background" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sicar/altitude/status", apiKeyAuth, async (_req, res) => {
    try {
      const stats = getAltitudeWorkerStats();
      const pendingResult = await pool.query(
        `SELECT COUNT(*) as pending FROM sicar_imoveis_cache WHERE alt_media IS NULL AND geometry IS NOT NULL`
      );
      const completedResult = await pool.query(
        `SELECT COUNT(*) as completed FROM sicar_imoveis_cache WHERE alt_media IS NOT NULL`
      );
      const errorResult = await pool.query(
        `SELECT COUNT(*) as errors FROM sicar_imoveis_cache WHERE alt_media = -9999`
      );
      res.json({
        worker: stats,
        database: {
          pending: parseInt(pendingResult.rows[0].pending),
          completed: parseInt(completedResult.rows[0].completed),
          errors: parseInt(errorResult.rows[0].errors),
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });



  app.get("/api/sicar/altitude/data", apiKeyAuth, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
      const uf = req.query.uf as string;
      const sort = req.query.sort as string || "alt_media";
      const order = (req.query.order as string)?.toLowerCase() === "asc" ? "ASC" : "DESC";
      const altMin = parseFloat(req.query.alt_min as string) || undefined;
      const altMax = parseFloat(req.query.alt_max as string) || undefined;

      const validSorts: Record<string, string> = {
        alt_media: "alt_media", alt_min: "alt_min", alt_max: "alt_max",
        num_area: "num_area", municipio: "municipio", cod_imovel: "cod_imovel",
        declividade: "declividade", temp_media: "temp_media", precip_anual: "precip_anual",
        perimetro_km: "perimetro_km"
      };
      const sortCol = validSorts[sort] || "alt_media";

      const conditions: string[] = ["alt_media IS NOT NULL", "alt_media != -9999"];
      const params: any[] = [];
      let paramIdx = 1;

      if (uf) { conditions.push(`uf = $${paramIdx++}`); params.push(uf.toUpperCase()); }
      if (altMin !== undefined) { conditions.push(`alt_media >= $${paramIdx++}`); params.push(altMin); }
      if (altMax !== undefined) { conditions.push(`alt_media <= $${paramIdx++}`); params.push(altMax); }

      const where = `WHERE ${conditions.join(" AND ")}`;

      const [dataResult, countResult, statsResult] = await Promise.all([
        pool.query(
          `SELECT id, cod_imovel, uf, municipio, ROUND(num_area::numeric, 2) as num_area, 
                  ind_status, alt_media, alt_min, alt_max,
                  centroid_lat, centroid_lon, perimetro_km, declividade, temp_media, precip_anual
           FROM sicar_imoveis_cache ${where}
           ORDER BY ${sortCol} ${order} NULLS LAST
           LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
          [...params, limit, offset]
        ),
        pool.query(`SELECT COUNT(*) FROM sicar_imoveis_cache ${where}`, params),
        pool.query(
          `SELECT uf, COUNT(*) as total,
                  ROUND(AVG(alt_media)::numeric, 1) as alt_media_avg,
                  ROUND(MIN(alt_min)::numeric, 1) as alt_min_global,
                  ROUND(MAX(alt_max)::numeric, 1) as alt_max_global,
                  ROUND(AVG(declividade)::numeric, 1) as decliv_avg,
                  ROUND(AVG(temp_media)::numeric, 1) as temp_avg,
                  ROUND(AVG(precip_anual)::numeric, 0) as precip_avg,
                  ROUND(AVG(perimetro_km)::numeric, 1) as perim_avg
           FROM sicar_imoveis_cache
           WHERE alt_media IS NOT NULL AND alt_media != -9999
           GROUP BY uf ORDER BY uf`
        )
      ]);

      res.json({
        data: dataResult.rows,
        total: parseInt(countResult.rows[0].count),
        limit, offset,
        byUf: statsResult.rows,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const altitudeDashboardHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SICARIOn - Altitude Worker</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    .container { max-width: 1100px; margin: 0 auto; padding: 2rem; }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; color: #f8fafc; }
    .subtitle { color: #94a3b8; font-size: 0.875rem; margin-bottom: 2rem; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; }
    .card-title { font-size: 0.875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; }
    .stat { background: #0f172a; border-radius: 8px; padding: 1rem; }
    .stat-label { font-size: 0.75rem; color: #64748b; margin-bottom: 0.25rem; }
    .stat-value { font-size: 1.5rem; font-weight: 700; color: #f8fafc; }
    .stat-value.running { color: #22c55e; }
    .stat-value.stopped { color: #ef4444; }
    .stat-value.idle { color: #eab308; }
    .stat-value.completed { color: #3b82f6; }
    .progress-bar { width: 100%; height: 24px; background: #0f172a; border-radius: 12px; overflow: hidden; margin: 1rem 0; position: relative; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #22c55e, #16a34a); border-radius: 12px; transition: width 0.5s ease; min-width: 2px; }
    .progress-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 0.75rem; font-weight: 600; color: #f8fafc; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
    .btn-group { display: flex; gap: 0.75rem; margin-top: 1rem; }
    .btn { padding: 0.625rem 1.5rem; border: none; border-radius: 8px; font-size: 0.875rem; font-weight: 600; cursor: pointer; transition: all 0.2s; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-start { background: #22c55e; color: #fff; }
    .btn-start:hover:not(:disabled) { background: #16a34a; }
    .btn-stop { background: #ef4444; color: #fff; }
    .btn-stop:hover:not(:disabled) { background: #dc2626; }
    .btn-refresh { background: #334155; color: #e2e8f0; }
    .btn-refresh:hover { background: #475569; }
    .btn-sm { padding: 0.375rem 0.75rem; font-size: 0.75rem; }
    .auth-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: #0f172a; display: flex; align-items: center; justify-content: center; z-index: 100; }
    .auth-box { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 2rem; width: 400px; }
    .auth-box h2 { margin-bottom: 1rem; font-size: 1.25rem; }
    .auth-box input { width: 100%; padding: 0.625rem 1rem; background: #0f172a; border: 1px solid #475569; border-radius: 8px; color: #f8fafc; font-size: 0.875rem; margin-bottom: 1rem; outline: none; }
    .auth-box input:focus { border-color: #22c55e; }
    .auth-box .btn { width: 100%; }
    .auto-refresh { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; color: #64748b; }
    .auto-refresh input { accent-color: #22c55e; }
    .header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 99px; font-size: 0.75rem; font-weight: 600; }
    .badge-running { background: #052e16; color: #22c55e; border: 1px solid #166534; }
    .badge-idle { background: #422006; color: #eab308; border: 1px solid #854d0e; }
    .badge-stopped { background: #450a0a; color: #ef4444; border: 1px solid #991b1b; }
    .badge-completed { background: #0c1a3d; color: #3b82f6; border: 1px solid #1d4ed8; }
    .badge-error { background: #450a0a; color: #ef4444; border: 1px solid #991b1b; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    th { text-align: left; padding: 0.625rem 0.75rem; background: #0f172a; color: #94a3b8; font-weight: 600; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #334155; cursor: pointer; white-space: nowrap; }
    th:hover { color: #e2e8f0; }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #1e293b; color: #cbd5e1; white-space: nowrap; }
    tr:hover td { background: #1e293b; }
    .table-wrapper { overflow-x: auto; max-height: 400px; overflow-y: auto; }
    .filters { display: flex; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap; align-items: center; }
    .filters select, .filters input { padding: 0.375rem 0.75rem; background: #0f172a; border: 1px solid #475569; border-radius: 6px; color: #f8fafc; font-size: 0.8rem; outline: none; }
    .filters select:focus, .filters input:focus { border-color: #22c55e; }
    .filters label { font-size: 0.75rem; color: #64748b; }
    .pagination { display: flex; justify-content: space-between; align-items: center; margin-top: 1rem; font-size: 0.8rem; color: #94a3b8; }
    .pagination button { padding: 0.375rem 0.75rem; background: #334155; border: none; border-radius: 6px; color: #e2e8f0; cursor: pointer; font-size: 0.8rem; }
    .pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
    .pagination button:hover:not(:disabled) { background: #475569; }
    .uf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.5rem; }
    .uf-chip { background: #0f172a; border-radius: 6px; padding: 0.5rem 0.75rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; cursor: pointer; transition: background 0.15s; }
    .uf-chip:hover { background: #1a2744; }
    .uf-chip .uf-name { font-weight: 600; color: #f8fafc; }
    .uf-chip .uf-count { color: #22c55e; font-weight: 700; }
    .uf-chip .uf-alt { color: #64748b; font-size: 0.7rem; }
    .tabs { display: flex; gap: 0; border-bottom: 1px solid #334155; margin-bottom: 1rem; }
    .tab { padding: 0.5rem 1rem; font-size: 0.8rem; font-weight: 600; color: #64748b; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.15s; }
    .tab:hover { color: #e2e8f0; }
    .tab.active { color: #22c55e; border-bottom-color: #22c55e; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
  </style>
</head>
<body>
  <div class="auth-overlay" id="authOverlay">
    <div class="auth-box">
      <h2>SICARIOn - Altitude Worker</h2>
      <p style="color:#94a3b8; font-size:0.875rem; margin-bottom:1rem;">Informe a API Key para acessar o painel.</p>
      <input type="password" id="apiKeyInput" placeholder="API Key" />
      <button class="btn btn-start" onclick="authenticate()" style="width:100%">Entrar</button>
    </div>
  </div>

  <div class="container" id="mainContent" style="display:none">
    <div class="header-row">
      <div>
        <h1>Altitude Worker</h1>
        <p class="subtitle">Populacao de altitude para imoveis SICAR via Open-Elevation API</p>
      </div>
      <span class="badge badge-idle" id="statusBadge">--</span>
    </div>

    <div class="card">
      <div class="card-title">Progresso Geral</div>
      <div class="progress-bar">
        <div class="progress-fill" id="progressFill" style="width: 0%"></div>
        <div class="progress-text" id="progressText">0%</div>
      </div>
      <div class="stats-grid">
        <div class="stat">
          <div class="stat-label">Processados</div>
          <div class="stat-value" id="statProcessed">--</div>
        </div>
        <div class="stat">
          <div class="stat-label">Pendentes</div>
          <div class="stat-value" id="statPending">--</div>
        </div>
        <div class="stat">
          <div class="stat-label">Erros</div>
          <div class="stat-value" id="statErrors">--</div>
        </div>
        <div class="stat">
          <div class="stat-label">Velocidade</div>
          <div class="stat-value" id="workerRate">--</div>
        </div>
        <div class="stat">
          <div class="stat-label">ETA</div>
          <div class="stat-value" id="workerEta">--</div>
        </div>
        <div class="stat">
          <div class="stat-label">Status</div>
          <div class="stat-value" id="workerStatus">--</div>
        </div>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1rem;">
        <div class="btn-group">
          <button class="btn btn-start" id="btnStart" onclick="startWorker()">Iniciar</button>
          <button class="btn btn-stop" id="btnStop" onclick="stopWorker()">Parar</button>
          <button class="btn btn-refresh" onclick="fetchStatus(); fetchData();">Atualizar</button>
        </div>
        <label class="auto-refresh">
          <input type="checkbox" id="autoRefresh" checked onchange="toggleAutoRefresh()" />
          Auto-refresh (10s)
        </label>
      </div>
    </div>

    <div class="card">
      <div class="tabs">
        <div class="tab active" onclick="switchTab('tabData')">Imoveis Processados</div>
        <div class="tab" onclick="switchTab('tabUf')">Por Estado (UF)</div>
      </div>

      <div class="tab-content active" id="tabData">
        <div class="filters">
          <div>
            <label>UF:</label>
            <select id="filterUf" onchange="fetchData()">
              <option value="">Todos</option>
            </select>
          </div>
          <div>
            <label>Alt. min:</label>
            <input type="number" id="filterAltMin" placeholder="0" style="width:80px" />
          </div>
          <div>
            <label>Alt. max:</label>
            <input type="number" id="filterAltMax" placeholder="9999" style="width:80px" />
          </div>
          <button class="btn btn-refresh btn-sm" onclick="fetchData()">Filtrar</button>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th onclick="sortData('cod_imovel')">Cod. Imovel</th>
                <th onclick="sortData('municipio')">Municipio</th>
                <th>UF</th>
                <th onclick="sortData('num_area')">Area (ha)</th>
                <th onclick="sortData('alt_media')">Alt. Media (m)</th>
                <th onclick="sortData('alt_min')">Alt. Min (m)</th>
                <th onclick="sortData('alt_max')">Alt. Max (m)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="dataBody">
              <tr><td colspan="8" style="text-align:center; color:#64748b;">Carregando...</td></tr>
            </tbody>
          </table>
        </div>
        <div class="pagination">
          <span id="paginationInfo">--</span>
          <div style="display:flex; gap:0.5rem;">
            <button onclick="prevPage()" id="btnPrev" disabled>Anterior</button>
            <button onclick="nextPage()" id="btnNext" disabled>Proximo</button>
          </div>
        </div>
      </div>

      <div class="tab-content" id="tabUf">
        <div class="uf-grid" id="ufGrid">
          <div style="color:#64748b; grid-column: 1/-1; text-align:center;">Carregando...</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let apiKey = localStorage.getItem('sicarion_api_key') || '';
    let refreshInterval = null;
    let currentSort = 'alt_media';
    let currentOrder = 'desc';
    let currentOffset = 0;
    const pageSize = 50;

    if (apiKey) { init(); }

    function init() {
      document.getElementById('authOverlay').style.display = 'none';
      document.getElementById('mainContent').style.display = 'block';
      fetchStatus();
      fetchData();
      startAutoRefresh();
    }

    function authenticate() {
      apiKey = document.getElementById('apiKeyInput').value.trim();
      if (!apiKey) return;
      localStorage.setItem('sicarion_api_key', apiKey);
      init();
    }

    async function fetchStatus() {
      try {
        const res = await fetch('/api/sicar/altitude/status?apikey=' + encodeURIComponent(apiKey));
        if (res.status === 401 || res.status === 403) {
          localStorage.removeItem('sicarion_api_key');
          document.getElementById('authOverlay').style.display = 'flex';
          document.getElementById('mainContent').style.display = 'none';
          return;
        }
        const data = await res.json();
        updateStatusUI(data);
      } catch (e) { console.error(e); }
    }

    function updateStatusUI(data) {
      const w = data.worker;
      const db = data.database;
      const total = db.completed + db.pending;
      const pct = total > 0 ? ((db.completed / total) * 100) : 0;

      document.getElementById('progressFill').style.width = pct.toFixed(2) + '%';
      document.getElementById('progressText').textContent = pct.toFixed(3) + '%';
      document.getElementById('statProcessed').textContent = db.completed.toLocaleString('pt-BR');
      document.getElementById('statPending').textContent = db.pending.toLocaleString('pt-BR');
      document.getElementById('statErrors').textContent = db.errors.toLocaleString('pt-BR');
      if (db.errors > 0) document.getElementById('statErrors').style.color = '#ef4444';

      const statusEl = document.getElementById('workerStatus');
      statusEl.textContent = w.status.charAt(0).toUpperCase() + w.status.slice(1);
      statusEl.className = 'stat-value ' + w.status;

      document.getElementById('workerRate').textContent = w.rate > 0 ? w.rate + '/min' : '--';
      document.getElementById('workerEta').textContent = w.eta || '--';

      const badge = document.getElementById('statusBadge');
      badge.textContent = w.status.toUpperCase();
      badge.className = 'badge badge-' + w.status;

      document.getElementById('btnStart').disabled = w.isRunning;
      document.getElementById('btnStop').disabled = !w.isRunning;
    }

    async function fetchData() {
      try {
        const uf = document.getElementById('filterUf').value;
        const altMin = document.getElementById('filterAltMin').value;
        const altMax = document.getElementById('filterAltMax').value;

        let url = '/api/sicar/altitude/data?limit=' + pageSize + '&offset=' + currentOffset + '&sort=' + currentSort + '&order=' + currentOrder;
        if (uf) url += '&uf=' + uf;
        if (altMin) url += '&alt_min=' + altMin;
        if (altMax) url += '&alt_max=' + altMax;

        const res = await fetch(url + '&apikey=' + encodeURIComponent(apiKey));
        const data = await res.json();
        renderTable(data);
        renderUfGrid(data.byUf);
        populateUfFilter(data.byUf);
      } catch (e) { console.error(e); }
    }

    function renderTable(data) {
      const body = document.getElementById('dataBody');
      if (!data.data || data.data.length === 0) {
        body.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#64748b;">Nenhum dado encontrado</td></tr>';
        document.getElementById('paginationInfo').textContent = '0 resultados';
        return;
      }
      body.innerHTML = data.data.map(r => 
        '<tr>' +
        '<td style="font-family:monospace; font-size:0.7rem;">' + r.cod_imovel + '</td>' +
        '<td>' + (r.municipio || '-') + '</td>' +
        '<td><strong>' + r.uf + '</strong></td>' +
        '<td style="text-align:right;">' + (r.num_area ? Number(r.num_area).toLocaleString('pt-BR') : '-') + '</td>' +
        '<td style="text-align:right; color:#22c55e; font-weight:600;">' + r.alt_media + 'm</td>' +
        '<td style="text-align:right; color:#3b82f6;">' + r.alt_min + 'm</td>' +
        '<td style="text-align:right; color:#f97316;">' + r.alt_max + 'm</td>' +
        '<td>' + (r.ind_status || '-') + '</td>' +
        '</tr>'
      ).join('');

      const from = data.offset + 1;
      const to = Math.min(data.offset + data.limit, data.total);
      document.getElementById('paginationInfo').textContent = from.toLocaleString('pt-BR') + '-' + to.toLocaleString('pt-BR') + ' de ' + data.total.toLocaleString('pt-BR');
      document.getElementById('btnPrev').disabled = data.offset === 0;
      document.getElementById('btnNext').disabled = (data.offset + data.limit) >= data.total;
    }

    function renderUfGrid(byUf) {
      if (!byUf || byUf.length === 0) return;
      const grid = document.getElementById('ufGrid');
      grid.innerHTML = byUf.map(u =>
        '<div class="uf-chip" onclick="filterByUf(\'' + u.uf + '\')">' +
        '<div><span class="uf-name">' + u.uf + '</span><br/><span class="uf-alt">' + u.alt_min_global + 'm - ' + u.alt_max_global + 'm</span></div>' +
        '<div style="text-align:right;"><span class="uf-count">' + Number(u.total).toLocaleString('pt-BR') + '</span><br/><span class="uf-alt">media: ' + u.alt_media_avg + 'm</span></div>' +
        '</div>'
      ).join('');
    }

    let ufFilterPopulated = false;
    function populateUfFilter(byUf) {
      if (ufFilterPopulated || !byUf) return;
      const sel = document.getElementById('filterUf');
      byUf.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.uf;
        opt.textContent = u.uf + ' (' + Number(u.total).toLocaleString('pt-BR') + ')';
        sel.appendChild(opt);
      });
      ufFilterPopulated = true;
    }

    function filterByUf(uf) {
      document.getElementById('filterUf').value = uf;
      currentOffset = 0;
      fetchData();
      switchTab('tabData');
    }

    function sortData(col) {
      if (currentSort === col) {
        currentOrder = currentOrder === 'desc' ? 'asc' : 'desc';
      } else {
        currentSort = col;
        currentOrder = 'desc';
      }
      currentOffset = 0;
      fetchData();
    }

    function prevPage() { currentOffset = Math.max(0, currentOffset - pageSize); fetchData(); }
    function nextPage() { currentOffset += pageSize; fetchData(); }

    function switchTab(tabId) {
      document.querySelectorAll('.tab').forEach((t, i) => {
        t.classList.toggle('active', (tabId === 'tabData' && i === 0) || (tabId === 'tabUf' && i === 1));
      });
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
    }

    async function startWorker() {
      try {
        const res = await fetch('/api/sicar/altitude/start?apikey=' + encodeURIComponent(apiKey), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        await res.json();
        setTimeout(() => { fetchStatus(); fetchData(); }, 1000);
      } catch (e) { console.error(e); }
    }

    async function stopWorker() {
      try {
        const res = await fetch('/api/sicar/altitude/stop?apikey=' + encodeURIComponent(apiKey), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        await res.json();
        setTimeout(() => { fetchStatus(); fetchData(); }, 1000);
      } catch (e) { console.error(e); }
    }

    function startAutoRefresh() {
      if (refreshInterval) clearInterval(refreshInterval);
      refreshInterval = setInterval(() => { fetchStatus(); fetchData(); }, 10000);
    }

    function toggleAutoRefresh() {
      if (document.getElementById('autoRefresh').checked) { startAutoRefresh(); }
      else { clearInterval(refreshInterval); refreshInterval = null; }
    }

    document.getElementById('apiKeyInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') authenticate(); });
  </script>
</body>
</html>
`;

  app.get("/api/sicar/altitude/dashboard", apiKeyAuth, (_req, res) => {
    res.type("html").send(altitudeDashboardHtml);
  });

  app.get("/altitude", (_req, res) => {
    res.type("html").send(altitudeDashboardHtml);
  });

  autoStartIfPending();

}
