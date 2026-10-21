#!/usr/bin/env node
/**
 * funai-tis-sync.cjs — Rotina mensal de sincronização de Terras Indígenas (FUNAI)
 * Deploy: /var/www/mavrion-api/rotinas/ (VPS 187.77.232.164) — cron mensal (dia 2, 05:45 UTC)
 *
 * Por que existe: o WFS oficial geoserver.funai.gov.br passou a responder 403 (nginx)
 * em QUALQUER GetFeature (ago/2026). Fonte alternativa validada: geoserver do CMR
 * (Centro de Monitoramento Remoto da própria FUNAI), camada CMR-PUBLICO:lim_terra_indigena_a,
 * WFS 2.0 com paginação e GeoJSON.
 *
 * Estratégia: baixa todas as TIs (~663), preserva dominio_uniao antigo por terrai_codigo
 * (CMR não expõe esse atributo), substitui a tabela em transação única e registra o
 * resultado em funai_sync_log (o /api/funai/status e o health lêem esse log).
 */
const fs = require('fs');
const { Pool } = require('/var/www/mavrion-api/node_modules/pg');

const WFS = 'https://cmr.funai.gov.br/geoserver/ows';
const LAYER = 'CMR-PUBLICO:lim_terra_indigena_a';
const PAGE = 25; // páginas menores: TIs amazônicas têm geometrias enormes
const MIN_TIS = 600; // base atual tem ~652-663

const log = (...a) => console.log(new Date().toISOString(), '[FUNAI-SYNC]', ...a);
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

async function fetchPage(startIndex, tries = 3) {
  const u = new URL(WFS);
  u.searchParams.set('service', 'WFS');
  u.searchParams.set('version', '2.0.0');
  u.searchParams.set('request', 'GetFeature');
  u.searchParams.set('typeNames', LAYER);
  u.searchParams.set('outputFormat', 'application/json');
  u.searchParams.set('count', String(PAGE));
  u.searchParams.set('startIndex', String(startIndex));
  u.searchParams.set('sortBy', 'co_funai');
  for (let t = 1; t <= tries; t++) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(90000) });
      const txt = await res.text();
      if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 120)}`);
      if (txt.trimStart().startsWith('<')) throw new Error(`exceção XML do GeoServer: ${txt.slice(0, 150)}`);
      return JSON.parse(txt);
    } catch (e) {
      if (t === tries) throw e;
      log(`página ${startIndex}: tentativa ${t} falhou (${e.message}); retry em ${3000 * t}ms`);
      await sleep(3000 * t);
    }
  }
}

function ddmmyyyy(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

(async () => {
  const t0 = Date.now();
  const pool = new Pool({ ...dbConfig(), max: 2 });
  const secs = () => Math.round((Date.now() - t0) / 1000);
  try {
    const features = [];
    for (let start = 0; ; start += PAGE) {
      const j = await fetchPage(start);
      const f = j.features || [];
      features.push(...f);
      log(`página startIndex=${start}: +${f.length} (total ${features.length}/${j.numberMatched ?? '?'})`);
      if (f.length < PAGE) break;
      if (features.length > 5000) throw new Error('paginação não terminou (>5000) — abortando');
    }
    if (features.length < MIN_TIS) throw new Error(`apenas ${features.length} TIs (< ${MIN_TIS}) — abortando sem tocar na tabela`);

    // dedup por co_funai (mantém a de maior área)
    const byCod = new Map();
    for (const f of features) {
      const pr = f.properties || {};
      const cod = pr.co_funai;
      if (cod == null) continue;
      const prev = byCod.get(cod);
      if (!prev || (pr.nu_area_ha || 0) > ((prev.properties || {}).nu_area_ha || 0)) byCod.set(cod, f);
    }
    const rows = [...byCod.values()];
    log(`TIs únicas: ${rows.length} (descartadas ${features.length - rows.length} duplicatas)`);

    const { rows: oldRows } = await pool.query('SELECT terrai_codigo, dominio_uniao FROM funai_terras_indigenas');
    const oldDominio = new Map(oldRows.map((r) => [r.terrai_codigo, r.dominio_uniao]));
    log(`dominio_uniao preservado para ${oldDominio.size} códigos existentes`);

    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM funai_terras_indigenas');
      let inserted = 0, semGeom = 0;
      for (const f of rows) {
        const pr = f.properties || {};
        if (!f.geometry) semGeom++;
        await c.query(
          `INSERT INTO funai_terras_indigenas
            (terrai_codigo, nome_ti, etnia, municipio, uf, superficie_ha, fase_ti, modalidade, cr,
             faixa_fronteira, dominio_uniao, data_atualizacao, geom)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($13),4326)))`,
          [
            pr.co_funai ?? null,
            pr.no_ti ?? null,
            pr.no_grupo_etnico ?? null,
            pr.no_municipio ?? null,
            pr.sg_uf ?? null,
            Number.isFinite(pr.nu_area_ha) ? pr.nu_area_ha : null,
            pr.ds_fase_ti ?? null,
            pr.ds_modalidade ?? null,
            pr.ds_cr ?? null,
            pr.st_faixa_fronteira ?? null,
            oldDominio.get(pr.co_funai) ?? null,
            ddmmyyyy(pr.dt_cadastro),
            f.geometry ? JSON.stringify(f.geometry) : null,
          ],
        );
        inserted++;
      }
      await c.query('COMMIT');
      log(`inseridas ${inserted} TIs (${semGeom} sem geometria)`);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }

    await pool.query('ANALYZE funai_terras_indigenas');
    const { rows: [fin] } = await pool.query('SELECT count(*)::int AS n, count(geom)::int AS g FROM funai_terras_indigenas');
    await pool.query(
      'INSERT INTO funai_sync_log (tipo, registros_importados, duracao_seg, erro) VALUES ($1,$2,$3,NULL)',
      ['terras_indigenas', fin.n, secs()],
    );
    log(`SUCESSO: ${fin.n} TIs (${fin.g} com geom) em ${secs()}s — fonte CMR/FUNAI`);
    await pool.end();
    process.exit(0);
  } catch (e) {
    log('ERRO FATAL:', e.message);
    try {
      await pool.query(
        'INSERT INTO funai_sync_log (tipo, registros_importados, duracao_seg, erro) VALUES ($1,0,$2,$3)',
        ['terras_indigenas', secs(), String(e.message).slice(0, 500)],
      );
    } catch {}
    try { await pool.end(); } catch {}
    process.exit(1);
  }
})();
