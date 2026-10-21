import { pool } from "../db";

const BASE_GEO = "https://geoportal.sgb.gov.br/server/rest/services/geologia";
// Using 1:2.5M scale for geology (1:1M is too large/slow via REST)
const LITO_URL = `${BASE_GEO}/litoestratigrafia_2500000/FeatureServer/0/query`;
const OCORR_URL = `${BASE_GEO}/ocorrencias/FeatureServer/0/query`;

interface SyncState {
  running: boolean;
  type: "geologia" | "recursos" | null;
  progress: number;
  total: number;
  startedAt: Date | null;
  lastError: string | null;
  lastLog: string;
}

interface CprmConfig {
  enabled: boolean;
  intervalDays: number;
}

let syncState: SyncState = {
  running: false,
  type: null,
  progress: 0,
  total: 0,
  startedAt: null,
  lastError: null,
  lastLog: "",
};

let schedulerTimer: NodeJS.Timeout | null = null;

export function getCprmConfig(): CprmConfig {
  return {
    enabled: process.env.CPRM_SYNC_ENABLED !== "false",
    intervalDays: parseInt(process.env.CPRM_SYNC_INTERVAL_DAYS || "90"),
  };
}

let runtimeConfig: CprmConfig | null = null;

export function setCprmConfig(cfg: Partial<CprmConfig>) {
  runtimeConfig = { ...getCprmConfig(), ...cfg };
  scheduleNextSync();
}

export function getEffectiveConfig(): CprmConfig {
  return runtimeConfig ?? getCprmConfig();
}

export function getSyncState() {
  return { ...syncState };
}

async function fetchJson(url: string, params: Record<string, string>, timeoutMs = 60000): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const full = `${url}?${qs}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(full, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function getAllObjectIds(url: string, timeoutMs = 30000): Promise<number[]> {
  const data = await fetchJson(url, { where: "1=1", returnIdsOnly: "true", f: "json" }, timeoutMs);
  return (data.objectIds || []).sort((a: number, b: number) => a - b);
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cprm_geologia (
      id SERIAL PRIMARY KEY,
      objectid INTEGER,
      sigla VARCHAR(100),
      nome VARCHAR(1000),
      hierarquia VARCHAR(200),
      legenda TEXT,
      litotipos TEXT,
      eon_min VARCHAR(100),
      eon_max VARCHAR(100),
      era_min VARCHAR(100),
      era_max VARCHAR(100),
      sistema_min VARCHAR(100),
      sistema_max VARCHAR(100),
      ambiente_tectonico VARCHAR(300),
      grupo VARCHAR(300),
      escala VARCHAR(20) DEFAULT '1:2.500.000',
      geom GEOMETRY(GEOMETRY, 4326)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cprm_geologia_geom ON cprm_geologia USING GIST(geom)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cprm_geologia_sigla ON cprm_geologia(sigla)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cprm_recursos_minerais (
      id SERIAL PRIMARY KEY,
      objectid INTEGER,
      nome_ocorrencia VARCHAR(1000),
      municipio VARCHAR(300),
      uf VARCHAR(5),
      substancias TEXT,
      status_economico VARCHAR(200),
      importancia VARCHAR(200),
      provincia VARCHAR(300),
      tipo_afloramento VARCHAR(300),
      descricao TEXT,
      rochas_hospedeiras TEXT,
      classes_utilitarias TEXT,
      x DOUBLE PRECISION,
      y DOUBLE PRECISION,
      geom GEOMETRY(POINT, 4326)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cprm_recursos_geom ON cprm_recursos_minerais USING GIST(geom)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cprm_recursos_uf ON cprm_recursos_minerais(uf)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cprm_sync_log (
      id SERIAL PRIMARY KEY,
      tipo VARCHAR(50),
      registros_importados INTEGER DEFAULT 0,
      duracao_seg INTEGER DEFAULT 0,
      erro TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

export async function syncGeologia(): Promise<{ imported: number; errors: number }> {
  await ensureTables();
  const startTime = Date.now();
  let imported = 0;
  let errors = 0;
  const BATCH_SIZE = 100;

  syncState.type = "geologia";
  syncState.lastLog = "Buscando IDs do mapa geológico SGB (1:2.500.000)...";

  try {
    // Step 1: Get all object IDs
    const allIds = await getAllObjectIds(LITO_URL, 30000);
    if (allIds.length === 0) {
      syncState.lastLog = "Nenhuma unidade geológica encontrada";
      return { imported: 0, errors: 0 };
    }

    syncState.total = allIds.length;
    syncState.lastLog = `${allIds.length} unidades a importar (1:2.500.000)`;

    // Step 2: Truncate and reimport
    await pool.query(`TRUNCATE TABLE cprm_geologia RESTART IDENTITY`);

    // Step 3: Paginate by OBJECTID range
    for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
      const batch = allIds.slice(i, i + BATCH_SIZE);
      const minId = batch[0];
      const maxId = batch[batch.length - 1];

      let geojson: any;
      try {
        geojson = await fetchJson(LITO_URL, {
          where: `OBJECTID BETWEEN ${minId} AND ${maxId}`,
          outFields: "OBJECTID,SIGLA,NOME,HIERARQUIA,LEGENDA,LITOTIPOS,EON_MIN,EON_MAX,ERA_MIN,ERA_MAX,SISTEMA_MIN,SISTEMA_MAX,AMBIENTE_TECTONICO,GRUPO",
          outSR: "4326",
          returnGeometry: "true",
          f: "geojson",
        }, 60000);
      } catch (fetchErr: any) {
        errors++;
        console.error(`[CPRM] Geologia lote ${minId}-${maxId} erro: ${fetchErr.message}`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      if (!geojson.features || geojson.features.length === 0) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const feat of geojson.features) {
          try {
            const p = feat.properties || {};
            const geomStr = feat.geometry ? JSON.stringify(feat.geometry) : null;
            await client.query(
              `INSERT INTO cprm_geologia
                (objectid, sigla, nome, hierarquia, legenda, litotipos, eon_min, eon_max, era_min, era_max,
                 sistema_min, sistema_max, ambiente_tectonico, grupo, escala, geom)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'1:2.500.000',
                 CASE WHEN $15 IS NOT NULL THEN ST_SetSRID(ST_GeomFromGeoJSON($15),4326) ELSE NULL END)`,
              [
                p.OBJECTID, p.SIGLA, p.NOME, p.HIERARQUIA, p.LEGENDA, p.LITOTIPOS,
                p.EON_MIN, p.EON_MAX, p.ERA_MIN, p.ERA_MAX, p.SISTEMA_MIN, p.SISTEMA_MAX,
                p.AMBIENTE_TECTONICO, p.GRUPO, geomStr
              ]
            );
            imported++;
          } catch (insertErr: any) {
            errors++;
          }
        }
        await client.query("COMMIT");
      } catch {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }

      syncState.progress = i + batch.length;
      syncState.lastLog = `Geologia: ${syncState.progress}/${allIds.length} unidades`;
      await new Promise(r => setTimeout(r, 500));
    }

    const duracao = Math.round((Date.now() - startTime) / 1000);
    await pool.query(
      `INSERT INTO cprm_sync_log(tipo,registros_importados,duracao_seg,erro) VALUES($1,$2,$3,$4)`,
      ["geologia", imported, duracao, errors > 0 ? `${errors} erros` : null]
    );
    return { imported, errors };
  } catch (err: any) {
    const duracao = Math.round((Date.now() - startTime) / 1000);
    await pool.query(
      `INSERT INTO cprm_sync_log(tipo,registros_importados,duracao_seg,erro) VALUES($1,$2,$3,$4)`,
      ["geologia", imported, duracao, err.message]
    ).catch(() => {});
    throw err;
  }
}

export async function syncRecursos(): Promise<{ imported: number; errors: number }> {
  await ensureTables();
  const startTime = Date.now();
  let imported = 0;
  let errors = 0;
  const BATCH_SIZE = 500;

  syncState.type = "recursos";
  syncState.lastLog = "Buscando IDs das ocorrências minerais SGB...";

  try {
    // Step 1: Get all object IDs
    const allIds = await getAllObjectIds(OCORR_URL, 30000);
    if (allIds.length === 0) {
      syncState.lastLog = "Nenhuma ocorrência mineral encontrada";
      return { imported: 0, errors: 0 };
    }

    syncState.total = allIds.length;
    syncState.lastLog = `${allIds.length} ocorrências a importar`;

    // Step 2: Truncate and reimport
    await pool.query(`TRUNCATE TABLE cprm_recursos_minerais RESTART IDENTITY`);

    // Step 3: Paginate by OBJECTID range
    for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
      const batch = allIds.slice(i, i + BATCH_SIZE);
      const minId = batch[0];
      const maxId = batch[batch.length - 1];

      let data: any;
      try {
        data = await fetchJson(OCORR_URL, {
          where: `OBJECTID BETWEEN ${minId} AND ${maxId}`,
          outFields: "OBJECTID,TOPONIMIA,MUNICIPIO,UF,SUBSTANCIAS,STATUS_ECONOMICO,IMPORTANCIA,PROVINCIA,TIPO_AFLORAMENTO,DESCRICAO,ROCHAS_HOSPEDEIRAS,CLASSES_UTILITARIAS,X,Y",
          returnGeometry: "false",
          f: "json",
        }, 45000);
      } catch (fetchErr: any) {
        errors++;
        console.error(`[CPRM] Recursos lote ${minId}-${maxId} erro: ${fetchErr.message}`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      if (!data.features || data.features.length === 0) {
        await new Promise(r => setTimeout(r, 300));
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const feat of data.features) {
          try {
            const p = feat.attributes || {};
            const x = p.X != null ? p.X : null;
            const y = p.Y != null ? p.Y : null;
            await client.query(
              `INSERT INTO cprm_recursos_minerais
                (objectid, nome_ocorrencia, municipio, uf, substancias, status_economico,
                 importancia, provincia, tipo_afloramento, descricao, rochas_hospedeiras,
                 classes_utilitarias, x, y, geom)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                 CASE WHEN $13 IS NOT NULL AND $14 IS NOT NULL THEN ST_SetSRID(ST_MakePoint($13,$14),4326) ELSE NULL END)`,
              [
                p.OBJECTID, p.TOPONIMIA, p.MUNICIPIO, p.UF, p.SUBSTANCIAS,
                p.STATUS_ECONOMICO, p.IMPORTANCIA, p.PROVINCIA, p.TIPO_AFLORAMENTO,
                p.DESCRICAO, p.ROCHAS_HOSPEDEIRAS, p.CLASSES_UTILITARIAS, x, y
              ]
            );
            imported++;
          } catch (insertErr: any) {
            errors++;
          }
        }
        await client.query("COMMIT");
      } catch {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }

      syncState.progress = i + batch.length;
      syncState.lastLog = `Recursos: ${syncState.progress}/${allIds.length} ocorrências`;
      await new Promise(r => setTimeout(r, 300));
    }

    const duracao = Math.round((Date.now() - startTime) / 1000);
    await pool.query(
      `INSERT INTO cprm_sync_log(tipo,registros_importados,duracao_seg,erro) VALUES($1,$2,$3,$4)`,
      ["recursos", imported, duracao, errors > 0 ? `${errors} erros` : null]
    );
    return { imported, errors };
  } catch (err: any) {
    const duracao = Math.round((Date.now() - startTime) / 1000);
    await pool.query(
      `INSERT INTO cprm_sync_log(tipo,registros_importados,duracao_seg,erro) VALUES($1,$2,$3,$4)`,
      ["recursos", imported, duracao, err.message]
    ).catch(() => {});
    throw err;
  }
}

export async function runFullSync() {
  if (syncState.running) return;
  syncState.running = true;
  syncState.startedAt = new Date();
  syncState.lastError = null;
  syncState.progress = 0;
  syncState.total = 0;

  try {
    await ensureTables();
    const geoResult = await syncGeologia();
    const recResult = await syncRecursos();
    syncState.lastLog = `Sync completo: ${geoResult.imported} unid. geol. + ${recResult.imported} ocorrências`;
  } catch (err: any) {
    syncState.lastError = err.message;
    syncState.lastLog = `Erro no sync: ${err.message}`;
  } finally {
    syncState.running = false;
    syncState.type = null;
  }
}

async function checkAndAutoSync() {
  if (syncState.running) return;
  try {
    await ensureTables();
    const cfg = getEffectiveConfig();
    if (!cfg.enabled) return;

    const geoCount = await pool.query(`SELECT COUNT(*) FROM cprm_geologia`);
    const recCount = await pool.query(`SELECT COUNT(*) FROM cprm_recursos_minerais`);
    const geoTotal = parseInt(geoCount.rows[0].count);
    const recTotal = parseInt(recCount.rows[0].count);

    if (geoTotal === 0 || recTotal === 0) {
      console.log("[CPRM] Sem dados — importação inicial agendada (use /api/cprm/sync para iniciar)");
      return;
    }

    const lastLog = await pool.query(
      `SELECT created_at FROM cprm_sync_log WHERE erro IS NULL ORDER BY created_at DESC LIMIT 1`
    );
    if (lastLog.rows.length === 0) return;

    const lastSync = new Date(lastLog.rows[0].created_at);
    const daysSince = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince >= cfg.intervalDays) {
      console.log(`[CPRM] ${Math.round(daysSince)} dias desde último sync — re-importando...`);
      runFullSync().catch(console.error);
    }
  } catch (err) {
    console.error("[CPRM] checkAndAutoSync error:", err);
  }
}

const MAX_SAFE_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7 days in ms (safe for 32-bit timer)

export function scheduleNextSync() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  const cfg = getEffectiveConfig();
  if (!cfg.enabled) return;
  // Check weekly but only sync when interval has actually elapsed
  schedulerTimer = setInterval(() => {
    checkAndAutoSync().catch(console.error);
  }, MAX_SAFE_INTERVAL);
}

let moduleInitialized = false;

export async function initCprmModule() {
  if (moduleInitialized) return;
  moduleInitialized = true;
  await ensureTables().catch(console.error);
  console.log("[CPRM] Módulo inicializado. Use POST /api/cprm/sync para importar dados.");
  scheduleNextSync();
}
