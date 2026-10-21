#!/usr/bin/env node
/**
 * anm-sigmine-sync.cjs — Rotina semanal de importação da base SIGMINE (ANM)
 * Deploy: /var/www/mavrion-api/rotinas/ (VPS 187.77.232.164) — cron semanal (domingo 05:15 UTC)
 *
 * Por que existe: o importador interno do bundle usa where=UF='XX' (aspas) e where=1=1,
 * ambos bloqueados pelo WAF da ANM desde ago/2026 — a checagem de contagem remota falha
 * (catch => -1) e TODAS as UFs são puladas como "completas". Este sidecar usa apenas
 * padrões aceitos pelo WAF: where=1>0 (GET) + objectIds em lotes (POST), f=geojson.
 *
 * Estratégia: staging (LIKE anm_processos) -> validação de contagem/geometria -> swap
 * transacional DELETE+INSERT (leitores seguem vendo dados antigos até o COMMIT).
 * Se QUALQUER lote falhar em definitivo, aborta sem tocar na tabela real.
 */
const fs = require('fs');
const { Pool } = require('/var/www/mavrion-api/node_modules/pg');

const LAYER = 'https://geo.anm.gov.br/arcgis/rest/services/SIGMINE/dados_anm/FeatureServer/0/query';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const BATCH = 250;          // objectIds por lote
const INSERT_CHUNK = 100;   // linhas por INSERT
const CONC = 3;             // lotes simultâneos
const MIN_IDS = 200000;     // sanidade: base tem ~269k processos
const MIN_GEOM_RATIO = 0.95;
// Re-enfileiramento do enrich ANM×SICAR (task 146): acima deste nº de processos
// novos/alterados/removidos, o join espacial fica caro demais — cai no fallback
// (só quem já tinha match) e os "recém-cobertos" entram no diff da semana seguinte.
const REQUEUE_SPATIAL_CAP = 50000;

const log = (...a) => console.log(new Date().toISOString(), '[ANM-SYNC]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dbConfig() {
  // DATABASE_URL tem senha com '@' SEM url-encoding: dividir no ÚLTIMO '@'
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

async function fetchJson(url, opts = {}, tries = 5, baseBackoff = 3000) {
  for (let t = 1; t <= tries; t++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { 'User-Agent': UA, ...(opts.headers || {}) },
        signal: AbortSignal.timeout(opts.timeoutMs || 90000),
      });
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

async function insertChunk(pool, feats) {
  if (!feats.length) return;
  const vals = [];
  const params = [];
  let p = 1;
  for (const f of feats) {
    const pr = f.properties || {};
    vals.push(`($${p},$${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6},$${p + 7},$${p + 8},$${p + 9},$${p + 10},$${p + 11},ST_SetSRID(ST_GeomFromGeoJSON($${p + 12}),4674),now())`);
    params.push(
      pr.PROCESSO ?? null,
      pr.DSProcesso ?? null,
      Number.isFinite(pr.NUMERO) ? pr.NUMERO : null,
      Number.isFinite(pr.ANO) ? pr.ANO : null,
      pr.FASE ?? null,
      pr.NOME ?? null,
      pr.SUBS ?? null,
      pr.USO ?? null,
      Number.isFinite(pr.AREA_HA) ? pr.AREA_HA : null,
      pr.UF ?? null,
      pr.ULT_EVENTO ?? null,
      pr.ID ?? null,
      f.geometry ? JSON.stringify(f.geometry) : null,
    );
    p += 13;
  }
  const sql = `INSERT INTO anm_processos_staging
      (processo, ds_processo, numero, ano, fase, nome, subs, uso, area_ha, uf, ult_evento, id_anm, geom, importado_em)
    VALUES ${vals.join(',')}
    ON CONFLICT (processo) DO UPDATE SET
      ds_processo=EXCLUDED.ds_processo, numero=EXCLUDED.numero, ano=EXCLUDED.ano, fase=EXCLUDED.fase,
      nome=EXCLUDED.nome, subs=EXCLUDED.subs, uso=EXCLUDED.uso, area_ha=EXCLUDED.area_ha, uf=EXCLUDED.uf,
      ult_evento=EXCLUDED.ult_evento, id_anm=EXCLUDED.id_anm, geom=EXCLUDED.geom, importado_em=EXCLUDED.importado_em`;
  // deadlock (40P01) pode ocorrer quando dois workers upsertam o mesmo processo em ordens diferentes
  for (let t = 1; ; t++) {
    try {
      await pool.query(sql, params);
      return;
    } catch (e) {
      if (e.code === '40P01' && t < 4) {
        await sleep(500 * t);
        continue;
      }
      throw e;
    }
  }
}

async function insertBatch(pool, features) {
  // dedup por PROCESSO dentro do lote (multi-polígonos do mesmo processo quebram ON CONFLICT no mesmo INSERT)
  const byProc = new Map();
  let skipped = 0;
  for (const f of features) {
    const proc = f.properties && f.properties.PROCESSO;
    if (!proc) { skipped++; continue; }
    byProc.set(proc, f);
  }
  const rows = [...byProc.values()];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await insertChunk(pool, rows.slice(i, i + INSERT_CHUNK));
  }
  return skipped;
}

(async () => {
  const t0 = Date.now();
  const pool = new Pool({ ...dbConfig(), max: 4 });
  try {
    log('Buscando objectIds (where=1>0)...');
    const idsJson = await fetchJson(`${LAYER}?where=1%3E0&returnIdsOnly=true&f=json`, { timeoutMs: 180000 }, 3, 5000);
    const ids = (idsJson.objectIds || []).sort((a, b) => a - b);
    log(`objectIds remotos: ${ids.length}`);
    if (ids.length < MIN_IDS) throw new Error(`poucos objectIds (${ids.length} < ${MIN_IDS}) — abortando sem tocar na tabela`);

    const { rows: [{ n: oldCount }] } = await pool.query('SELECT count(*)::int AS n FROM anm_processos');
    log(`anm_processos atual: ${oldCount} linhas`);

    await pool.query('CREATE TABLE IF NOT EXISTS anm_processos_staging (LIKE anm_processos INCLUDING DEFAULTS)');
    await pool.query('TRUNCATE anm_processos_staging');
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS anm_processos_staging_processo_ux ON anm_processos_staging(processo)');

    const batches = [];
    for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));
    log(`lotes: ${batches.length} (batch=${BATCH}, concorrência=${CONC})`);

    let done = 0, feats = 0, failed = 0, skippedNoProc = 0, cursor = 0;
    async function worker() {
      for (;;) {
        const my = cursor++;
        if (my >= batches.length) return;
        try {
          const body = new URLSearchParams({
            objectIds: batches[my].join(','),
            outFields: '*',
            returnGeometry: 'true',
            outSR: '4674',
            f: 'geojson',
          });
          const j = await fetchJson(LAYER, { method: 'POST', body, timeoutMs: 120000 }, 5, 4000);
          if (!Array.isArray(j.features)) throw new Error('resposta sem features');
          feats += j.features.length;
          skippedNoProc += await insertBatch(pool, j.features);
        } catch (e) {
          failed++;
          log(`LOTE ${my} FALHOU em definitivo: ${e.message}`);
        }
        done++;
        if (done % 50 === 0) log(`progresso: ${done}/${batches.length} lotes, ${feats} features`);
      }
    }
    await Promise.all(Array.from({ length: CONC }, worker));
    if (skippedNoProc) log(`aviso: ${skippedNoProc} features sem PROCESSO ignoradas`);
    if (failed > 0) throw new Error(`${failed} lotes falharam — abortando swap (dados antigos preservados)`);

    const { rows: [st] } = await pool.query('SELECT count(*)::int AS n, count(geom)::int AS g FROM anm_processos_staging');
    log(`staging: ${st.n} processos únicos (${st.g} com geometria)`);
    if (st.n < MIN_IDS * 0.9 || st.n < 0.9 * oldCount) throw new Error(`contagem staging suspeita (${st.n} vs atual ${oldCount}) — abortando swap`);
    if (st.g / st.n < MIN_GEOM_RATIO) throw new Error(`razão de geometria baixa (${st.g}/${st.n}) — abortando swap`);

    // ---- Diff p/ re-enfileiramento do enrich ANM×SICAR (task 146) ----
    // Calculado ANTES do swap (staging × tabela atual coexistem). Guarda a geometria
    // já em 4326 dos processos novos/alterados (geom do staging) e removidos (geom antiga).
    log('Calculando diff de processos (novos/alterados/removidos)...');
    await pool.query('DROP TABLE IF EXISTS anm_sync_requeue');
    await pool.query(`CREATE TABLE anm_sync_requeue AS
      SELECT s.processo, ST_Transform(s.geom, 4326) AS geom_4326
      FROM anm_processos_staging s
      LEFT JOIN anm_processos a ON a.processo = s.processo
      WHERE a.processo IS NULL
         OR (a.ds_processo, a.numero, a.ano, a.fase, a.nome, a.subs, a.uso, a.uf, a.ult_evento, a.id_anm)
            IS DISTINCT FROM
            (s.ds_processo, s.numero, s.ano, s.fase, s.nome, s.subs, s.uso, s.uf, s.ult_evento, s.id_anm)
         OR a.area_ha IS DISTINCT FROM s.area_ha
         OR md5(ST_AsBinary(a.geom)) IS DISTINCT FROM md5(ST_AsBinary(s.geom))`);
    await pool.query(`INSERT INTO anm_sync_requeue
      SELECT a.processo, ST_Transform(a.geom, 4326)
      FROM anm_processos a
      LEFT JOIN anm_processos_staging s ON s.processo = a.processo
      WHERE s.processo IS NULL`);
    const { rows: [{ n: changed }] } = await pool.query('SELECT count(*)::int AS n FROM anm_sync_requeue');
    log(`processos no diff: ${changed}`);

    log('Efetivando swap transacional (DELETE+INSERT)...');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM anm_processos');
      await c.query(`INSERT INTO anm_processos
          (processo, ds_processo, numero, ano, fase, nome, subs, uso, area_ha, uf, ult_evento, id_anm, geom, importado_em)
        SELECT processo, ds_processo, numero, ano, fase, nome, subs, uso, area_ha, uf, ult_evento, id_anm, geom, importado_em
        FROM anm_processos_staging`);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
    await pool.query('DROP TABLE anm_processos_staging');
    await pool.query('ANALYZE anm_processos');
    const { rows: [fin] } = await pool.query('SELECT count(*)::int AS n, max(importado_em) AS m FROM anm_processos');
    log(`SUCESSO: anm_processos=${fin.n} max(importado_em)=${fin.m} duração=${Math.round((Date.now() - t0) / 1000)}s`);

    // ---- Re-enfileiramento seletivo do enrich ANM×SICAR (task 146) ----
    // DELETE em sicar_anm_enrichment devolve o imóvel à fila (anti-join); quem retoma
    // é o guardião anm-enrich-guard.cjs na janela 03–09 UTC com load < 4 — nunca aqui.
    // Falha aqui NÃO desfaz o swap (dados ANM já estão atualizados): loga e sai 1.
    let requeueFailed = false;
    try {
      if (changed === 0) {
        log('requeue: nenhum processo mudou — nada a re-enfileirar');
      } else if (changed > REQUEUE_SPATIAL_CAP) {
        // Diff anormalmente grande (primeira rodada, mudança de formato...): o join
        // espacial com dezenas de milhares de geometrias ficaria caro demais.
        // Fallback: re-enfileira só quem já tinha match ANM (índice em anm_processos_count).
        log(`requeue: diff muito grande (${changed} > ${REQUEUE_SPATIAL_CAP}) — fallback: re-enfileirando apenas imóveis com anm_processos_count > 0`);
        const r = await pool.query('DELETE FROM sicar_anm_enrichment WHERE anm_processos_count > 0');
        log(`requeue (fallback): ${r.rowCount} imóveis re-enfileirados`);
      } else {
        // (a) Imóveis cujo retrato cita um processo alterado/removido (varre só
        //     anm_processos_count > 0, indexado — barato independentemente do diff).
        const ra = await pool.query(`
          DELETE FROM sicar_anm_enrichment e
          WHERE e.anm_processos_count > 0
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(e.anm_processos_json) j
              JOIN anm_sync_requeue c ON c.processo = j->>'processo'
              WHERE j->>'layer_tipo' = 'processos_ativos')`);
        // (b) Imóveis que intersectam a geometria de um processo novo/alterado/removido
        //     (cobre recém-cobertos; usa os índices gist geom das partições sicar_imoveis_<uf>).
        const rb = await pool.query(`
          DELETE FROM sicar_anm_enrichment e
          WHERE e.cod_imovel IN (
            SELECT DISTINCT s.cod_imovel
            FROM anm_sync_requeue c
            JOIN sicar_imoveis_cache s
              ON s.geom IS NOT NULL AND ST_Intersects(s.geom, c.geom_4326)
            WHERE c.geom_4326 IS NOT NULL)`);
        log(`requeue: ${ra.rowCount} imóveis por processo citado + ${rb.rowCount} por interseção espacial (diff=${changed}); guardião retoma na janela 03–09 UTC`);
      }
      await pool.query('DROP TABLE IF EXISTS anm_sync_requeue');
    } catch (e) {
      requeueFailed = true;
      log(`REQUEUE FALHOU (dados ANM já atualizados; corrigir e re-enfileirar manualmente): ${e.message}`);
    }
    await pool.end();
    process.exit(requeueFailed ? 1 : 0);
  } catch (e) {
    log('ERRO FATAL:', e.message);
    try { await pool.end(); } catch {}
    process.exit(1);
  }
})();
