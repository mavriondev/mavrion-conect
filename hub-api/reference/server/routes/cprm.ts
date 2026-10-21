import { Express } from "express";
import { pool } from "../db";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import {
  runFullSync,
  syncGeologia,
  syncRecursos,
  getSyncState,
  getCprmConfig,
  getEffectiveConfig,
  setCprmConfig,
} from "../lib/cprm-sync";

export function registerCprmRoutes(app: Express) {

  // GET /api/cprm/status
  app.get("/api/cprm/status", apiKeyAuth, async (_req, res) => {
    try {
      const geoCount = await pool.query(`SELECT COUNT(*) FROM cprm_geologia`).catch(() => ({ rows: [{ count: 0 }] }));
      const recCount = await pool.query(`SELECT COUNT(*) FROM cprm_recursos_minerais`).catch(() => ({ rows: [{ count: 0 }] }));

      const lastGeoLog = await pool.query(
        `SELECT created_at, registros_importados, duracao_seg, erro FROM cprm_sync_log WHERE tipo='geologia' ORDER BY created_at DESC LIMIT 1`
      ).catch(() => ({ rows: [] }));
      const lastRecLog = await pool.query(
        `SELECT created_at, registros_importados, duracao_seg, erro FROM cprm_sync_log WHERE tipo='recursos' ORDER BY created_at DESC LIMIT 1`
      ).catch(() => ({ rows: [] }));

      const cfg = getEffectiveConfig();
      const state = getSyncState();

      const lastGeo = lastGeoLog.rows[0];
      const lastRec = lastRecLog.rows[0];

      const lastSync = lastGeo?.created_at || lastRec?.created_at || null;
      const nextSync = lastSync
        ? new Date(new Date(lastSync).getTime() + cfg.intervalDays * 86400 * 1000).toISOString()
        : null;

      res.json({
        tabelas: {
          cprm_geologia: {
            total: parseInt(geoCount.rows[0].count),
            ultima_sync: lastGeo?.created_at || null,
            registros_importados: lastGeo?.registros_importados || 0,
            duracao_seg: lastGeo?.duracao_seg || 0,
            erro: lastGeo?.erro || null,
          },
          cprm_recursos_minerais: {
            total: parseInt(recCount.rows[0].count),
            ultima_sync: lastRec?.created_at || null,
            registros_importados: lastRec?.registros_importados || 0,
            duracao_seg: lastRec?.duracao_seg || 0,
            erro: lastRec?.erro || null,
          },
        },
        sync_ativo: state.running,
        sync_tipo: state.type,
        sync_progresso: state.progress,
        sync_total: state.total,
        sync_log: state.lastLog,
        ultima_sync_global: lastSync,
        proxima_sync: nextSync,
        config: cfg,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/cprm/config
  app.get("/api/cprm/config", apiKeyAuth, (_req, res) => {
    res.json(getEffectiveConfig());
  });

  // PUT /api/cprm/config
  app.put("/api/cprm/config", apiKeyAuth, (req, res) => {
    const { enabled, intervalDays } = req.body;
    const update: any = {};
    if (typeof enabled === "boolean") update.enabled = enabled;
    if (typeof intervalDays === "number" && intervalDays >= 1) update.intervalDays = intervalDays;
    setCprmConfig(update);
    res.json({ message: "Configuração atualizada", config: getEffectiveConfig() });
  });

  // POST /api/cprm/sync
  app.post("/api/cprm/sync", apiKeyAuth, async (req, res) => {
    const state = getSyncState();
    if (state.running) {
      return res.status(409).json({
        message: "Sync já em andamento",
        tipo: state.type,
        progresso: state.progress,
        total: state.total,
      });
    }
    const { tipo } = req.body;
    if (tipo === "geologia") {
      runSync(syncGeologia, "geologia").catch(console.error);
      return res.json({ message: "Sync de geologia iniciado em background" });
    }
    if (tipo === "recursos") {
      runSync(syncRecursos, "recursos").catch(console.error);
      return res.json({ message: "Sync de recursos minerais iniciado em background" });
    }
    runFullSync().catch(console.error);
    res.json({ message: "Sync completo iniciado em background (geologia + recursos)" });
  });

  async function runSync(fn: () => Promise<{ imported: number; errors: number }>, _tipo: string) {
    try { await fn(); } catch { /* logged internally */ }
  }

  // GET /api/cprm/geologia?lat=X&lon=Y
  app.get("/api/cprm/geologia", apiKeyAuth, async (req, res) => {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ message: "Parâmetros lat e lon obrigatórios" });
    }
    try {
      const result = await pool.query(
        `SELECT id, sigla, nome, hierarquia, legenda, litotipos,
                eon_min, eon_max, era_min, era_max, sistema_min, sistema_max,
                ambiente_tectonico, grupo
         FROM cprm_geologia
         WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint($1,$2),4326))
         LIMIT 5`,
        [lon, lat]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Nenhuma unidade geológica encontrada neste ponto", lat, lon });
      }
      res.json({ lat, lon, total: result.rows.length, data: result.rows });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/cprm/geologia/bbox?minLat=X&minLon=Y&maxLat=X2&maxLon=Y2
  app.get("/api/cprm/geologia/bbox", apiKeyAuth, async (req, res) => {
    const minLat = parseFloat(req.query.minLat as string);
    const minLon = parseFloat(req.query.minLon as string);
    const maxLat = parseFloat(req.query.maxLat as string);
    const maxLon = parseFloat(req.query.maxLon as string);
    if ([minLat, minLon, maxLat, maxLon].some(isNaN)) {
      return res.status(400).json({ message: "Parâmetros minLat, minLon, maxLat, maxLon obrigatórios" });
    }
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    try {
      const result = await pool.query(
        `SELECT id, sigla, nome, hierarquia, legenda, litotipos,
                eon_min, era_min, sistema_min, ambiente_tectonico, grupo,
                ST_AsGeoJSON(geom)::json as geometry
         FROM cprm_geologia
         WHERE ST_Intersects(geom, ST_MakeEnvelope($1,$2,$3,$4,4326))
         LIMIT $5`,
        [minLon, minLat, maxLon, maxLat, limit]
      );
      res.json({ total: result.rows.length, limit, data: result.rows });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/cprm/recursos?lat=X&lon=Y&raio=Z (km, default 50)
  app.get("/api/cprm/recursos", apiKeyAuth, async (req, res) => {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    const raioKm = parseFloat((req.query.raio as string) || "50");
    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ message: "Parâmetros lat e lon obrigatórios" });
    }
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const raioM = raioKm * 1000;
    try {
      const result = await pool.query(
        `SELECT id, nome_ocorrencia, municipio, uf, substancias,
                status_economico, importancia, provincia, tipo_afloramento,
                descricao, classes_utilitarias, x, y,
                ROUND(ST_Distance(geom::geography, ST_MakePoint($1,$2)::geography)::numeric / 1000, 2) as distancia_km
         FROM cprm_recursos_minerais
         WHERE ST_DWithin(geom::geography, ST_MakePoint($1,$2)::geography, $3)
         ORDER BY distancia_km
         LIMIT $4`,
        [lon, lat, raioM, limit]
      );
      res.json({ lat, lon, raio_km: raioKm, total: result.rows.length, data: result.rows });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/cprm/recursos/substancia?substancia=OURO&uf=MG
  app.get("/api/cprm/recursos/substancia", apiKeyAuth, async (req, res) => {
    const substancia = (req.query.substancia as string || "").trim();
    const uf = (req.query.uf as string || "").trim().toUpperCase();
    const status = (req.query.status as string || "").trim();
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;

    const conditions: string[] = [];
    const params: any[] = [];

    if (substancia) {
      params.push(`%${substancia.toUpperCase()}%`);
      conditions.push(`UPPER(substancias) LIKE $${params.length}`);
    }
    if (uf) {
      params.push(uf);
      conditions.push(`uf = $${params.length}`);
    }
    if (status) {
      params.push(`%${status.toUpperCase()}%`);
      conditions.push(`UPPER(status_economico) LIKE $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit, offset);

    try {
      const result = await pool.query(
        `SELECT id, nome_ocorrencia, municipio, uf, substancias,
                status_economico, importancia, provincia, tipo_afloramento, classes_utilitarias, x, y
         FROM cprm_recursos_minerais ${where}
         ORDER BY nome_ocorrencia
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const countParams = params.slice(0, -2);
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM cprm_recursos_minerais ${where}`,
        countParams
      );
      res.json({
        total: parseInt(countResult.rows[0].count),
        limit,
        offset,
        filtros: { substancia: substancia || null, uf: uf || null, status: status || null },
        data: result.rows,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/cprm/sync-log
  app.get("/api/cprm/sync-log", apiKeyAuth, async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    try {
      const result = await pool.query(
        `SELECT * FROM cprm_sync_log ORDER BY created_at DESC LIMIT $1`,
        [limit]
      );
      res.json({ total: result.rows.length, data: result.rows });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
