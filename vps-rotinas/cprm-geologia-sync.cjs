#!/usr/bin/env node
/**
 * cprm-geologia-sync.cjs — Rotina mensal de sincronização da geologia CPRM/SGB (1:2.500.000)
 * Deploy: /var/www/mavrion-api/rotinas/ (VPS 187.77.232.164) — cron mensal (dia 3, 04:30 UTC)
 *
 * Por que existe: a extensão FeatureServer do geoportal.sgb.gov.br quebrou (500
 * "Server object extension" no metadata; /query responde 200 com 0 objectIds), e o
 * bundle interno usa exatamente esses endpoints FeatureServer — sync interno passou a
 * retornar "0 unidades" (sem truncar, felizmente). Os MESMOS dados seguem disponíveis
 * via MapServer: geologia/litoestratigrafia_2500000/MapServer/0 (2.838 unidades hoje).
 *
 * Estratégia: staging + swap transacional em cprm_geologia; registra em cprm_sync_log
 * (o /api/cprm/status lê esse log). Best-effort: SGB é instável; retries por lote.
 */
const fs = require('fs');
const { Pool } = require('/var/www/mavrion-api/node_modules/pg');

const LAYER = 'https://geoportal.sgb.gov.br/server/rest/services/geologia/litoestratigrafia_2500000/MapServer/0/query';
const FIELDS = 'OBJECTID,SIGLA,NOME,HIERARQUIA,LEGENDA,LITOTIPOS,EON_MIN,EON_MAX,ERA_MIN,ERA_MAX,SISTEMA_MIN,SISTEMA_MAX,AMBIENTE_TECTONICO,GRUPO';
const ESCALA = '1:2.500.000';
const BATCH = 100;
const CONC = 2;
const MIN_UNITS = 2000; // hoje: 2.838

const log = (...a) => console.log(new Date().toISOString(), '[CPRM-SYNC]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dbConfig() {
  const env = fs.readFileSync('/var/www/mavrion-api/.env', 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
  let url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
  const rest = url.replace(/^postgres(ql)?:\/\//, '');
  const at = rest.lastIndexOf('@');
  const cred = rest.slice(0, at);
  const hostpart = rest.slice(at + 1);
  const colon = cred.indexOf(':');
  const hm = hostpart.match(/^([^:\/]+)(?::(\d+))?\/([^?]+)/);
  return {
    user: cred.slice(0, colon),
    password: cred.slice(colon + 1),
    host: hm[1],
    port: hm[2] ? parseInt(hm[2], 10) : 5432,
    database: hm[3],
  };
}

async function fetchJson(url, opts = {}, tries = 4, baseBackoff = 4000) {
  for (let t = 1; t <= tries; t++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeoutMs || 90000) });
      const txt = await res.text();
      if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 120)}`);
      let j;
      try { j = JSON.parse(txt); } catch { throw new Error(`resposta não-JSON: ${txt.slice(0, 120)}`); }
      if (j.error) throw new Error(`ArcGIS error: ${JSON.stringify(j.error).slice(0, 200)}`);
      return j;
    } catch (e) {
      if (t === tries) throw e;
      log(`tentativa ${t}/${tries} falhou (${e.message}); backoff ${baseBackoff * t}ms`);
      await sleep(baseBackoff * t);
    }
  }
}

(async () => {
  const t0 = Date.now();
  const pool = new Pool({ ...dbConfig(), max: 3 });
  const secs = () => Math.round((Date.now() - t0) / 1000);
  try {
    log('Buscando objectIds (MapServer, where=1>0)...');
    const idsJson = await fetchJson(`${LAYER}?where=1%3E0&returnIdsOnly=true&f=json`, { timeoutMs: 120000 }, 3, 5000);
    const ids = (idsJson.objectIds || []).sort((a, b) => a - b);
    log(`objectIds remotos: ${ids.length}`);
    if (ids.length < MIN_UNITS) throw new Error(`poucos objectIds (${ids.length} < ${MIN_UNITS}) — abortando`);

    await pool.query('CREATE TABLE IF NOT EXISTS cprm_geologia_staging (LIKE cprm_geologia INCLUDING DEFAULTS)');
    await pool.query('TRUNCATE cprm_geologia_staging');

    const batches = [];
    for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));
    log(`lotes: ${batches.length} (batch=${BATCH}, concorrência=${CONC})`);

    let done = 0, feats = 0, failed = 0, cursor = 0;
    const seen = new Set();
    async function worker() {
      for (;;) {
        const my = cursor++;
        if (my >= batches.length) return;
        try {
          const body = new URLSearchParams({
            objectIds: batches[my].join(','),
            outFields: FIELDS,
            returnGeometry: 'true',
            outSR: '4326',
            f: 'geojson',
          });
          const j = await fetchJson(LAYER, { method: 'POST', body, timeoutMs: 120000 }, 4, 5000);
          if (!Array.isArray(j.features)) throw new Error('resposta sem features');
          for (const f of j.features) {
            const pr = f.properties || {};
            if (pr.OBJECTID != null) {
              if (seen.has(pr.OBJECTID)) continue;
              seen.add(pr.OBJECTID);
            }
            await pool.query(
              `INSERT INTO cprm_geologia_staging
                (objectid, sigla, nome, hierarquia, legenda, litotipos, eon_min, eon_max, era_min, era_max,
                 sistema_min, sistema_max, ambiente_tectonico, grupo, escala, geom)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, ST_SetSRID(ST_GeomFromGeoJSON($16),4326))`,
              [
                pr.OBJECTID ?? null, pr.SIGLA ?? null, pr.NOME ?? null, pr.HIERARQUIA ?? null,
                pr.LEGENDA ?? null, pr.LITOTIPOS ?? null, pr.EON_MIN ?? null, pr.EON_MAX ?? null,
                pr.ERA_MIN ?? null, pr.ERA_MAX ?? null, pr.SISTEMA_MIN ?? null, pr.SISTEMA_MAX ?? null,
                pr.AMBIENTE_TECTONICO ?? null, pr.GRUPO ?? null, ESCALA,
                f.geometry ? JSON.stringify(f.geometry) : null,
              ],
            );
            feats++;
          }
        } catch (e) {
          failed++;
          log(`LOTE ${my} FALHOU em definitivo: ${e.message}`);
        }
        done++;
        if (done % 10 === 0) log(`progresso: ${done}/${batches.length} lotes, ${feats} unidades`);
      }
    }
    await Promise.all(Array.from({ length: CONC }, worker));
    if (failed > 0) throw new Error(`${failed} lotes falharam — abortando swap (dados antigos preservados)`);

    const { rows: [st] } = await pool.query('SELECT count(*)::int AS n, count(geom)::int AS g FROM cprm_geologia_staging');
    log(`staging: ${st.n} unidades (${st.g} com geometria)`);
    if (st.n < MIN_UNITS) throw new Error(`staging suspeito (${st.n}) — abortando swap`);

    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM cprm_geologia');
      await c.query(`INSERT INTO cprm_geologia
          (objectid, sigla, nome, hierarquia, legenda, litotipos, eon_min, eon_max, era_min, era_max,
           sistema_min, sistema_max, ambiente_tectonico, grupo, escala, geom)
        SELECT objectid, sigla, nome, hierarquia, legenda, litotipos, eon_min, eon_max, era_min, era_max,
           sistema_min, sistema_max, ambiente_tectonico, grupo, escala, geom
        FROM cprm_geologia_staging`);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
    await pool.query('DROP TABLE cprm_geologia_staging');
    await pool.query('ANALYZE cprm_geologia');
    const { rows: [fin] } = await pool.query('SELECT count(*)::int AS n FROM cprm_geologia');
    await pool.query(
      'INSERT INTO cprm_sync_log (tipo, registros_importados, duracao_seg, erro) VALUES ($1,$2,$3,NULL)',
      ['geologia', fin.n, secs()],
    );
    log(`SUCESSO: cprm_geologia=${fin.n} em ${secs()}s — fonte MapServer/SGB`);
    await pool.end();
    process.exit(0);
  } catch (e) {
    log('ERRO FATAL:', e.message);
    try {
      await pool.query(
        'INSERT INTO cprm_sync_log (tipo, registros_importados, duracao_seg, erro) VALUES ($1,0,$2,$3)',
        ['geologia', secs(), String(e.message).slice(0, 500)],
      );
    } catch {}
    try { await pool.end(); } catch {}
    process.exit(1);
  }
})();
