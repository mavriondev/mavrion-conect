#!/usr/bin/env node
/**
 * freshness-check.cjs — Verificador diário de frescor das rotinas sidecar (Task: avisar quando rotina noturna falhar)
 * Deploy: /var/www/mavrion-api/rotinas/ (VPS 187.77.232.164) — cron diário
 *
 * Por que existe: as rotinas (ANM semanal, FUNAI/CPRM mensais, watchdog de altitude)
 * só registram falhas em logs no servidor e nas tabelas *_sync_log. Se um upstream
 * mudar (já aconteceu com o FeatureServer do SGB), a falha passa meses despercebida.
 *
 * O que faz: compara a data do ÚLTIMO SYNC BEM-SUCEDIDO de cada módulo com o
 * intervalo esperado (+margem). Quando um módulo estoura o prazo, grava um alerta
 * deduplicado (1/dia por módulo) na tabela error_reports do BANCO DO CONNECT
 * (type='vps_rotina_stale'); o scheduler do Connect transforma isso em notificação
 * no sino do app. Falha upstream com dado antigo preservado NÃO alerta antes do
 * prazo — só a ausência prolongada de sucesso dispara (sem falso positivo).
 *
 * Uso: node freshness-check.cjs [--test-module=anm_sigmine]  (força stale p/ teste)
 */
const fs = require('fs');
const { Pool } = require('/var/www/mavrion-api/node_modules/pg');

const log = (...a) => console.log(new Date().toISOString(), '[FRESHNESS]', ...a);

function parseDbUrl(envPath) {
  const env = fs.readFileSync(envPath, 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error(`DATABASE_URL não encontrada em ${envPath}`);
  let url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
  const rest = url.replace(/^postgres(ql)?:\/\//, '');
  const at = rest.lastIndexOf('@'); // senha pode ter '@' cru — split no ÚLTIMO '@'
  const cred = rest.slice(0, at);
  const hostpart = rest.slice(at + 1);
  const colon = cred.indexOf(':');
  const hm = hostpart.match(/^([^:\/]+)(?::(\d+))?\/([^?]+)/);
  return {
    user: decodeURIComponent(cred.slice(0, colon)),
    password: decodeURIComponent(cred.slice(colon + 1)),
    host: hm[1],
    port: hm[2] ? parseInt(hm[2], 10) : 5432,
    database: hm[3],
  };
}

// Módulos monitorados: query devolve o timestamp do último sucesso (ou null)
const MODULES = [
  {
    id: 'anm_sigmine',
    titulo: 'ANM SIGMINE (processos minerários)',
    maxDias: 8, // rotina semanal (domingo 05:15 UTC)
    query: 'SELECT max(importado_em) AS t FROM anm_processos',
  },
  {
    id: 'funai_tis',
    titulo: 'FUNAI Terras Indígenas',
    maxDias: 35, // rotina mensal (dia 2)
    query: "SELECT max(created_at) AS t FROM funai_sync_log WHERE erro IS NULL",
  },
  {
    id: 'cprm_geologia',
    titulo: 'CPRM/SGB Geologia',
    maxDias: 35, // rotina mensal (dia 3)
    query: "SELECT max(created_at) AS t FROM cprm_sync_log WHERE erro IS NULL AND tipo <> 'recursos'",
  },
  {
    id: 'cprm_recursos',
    titulo: 'CPRM/SGB Recursos Minerais',
    maxDias: 35, // rotina mensal (dia 3)
    query: "SELECT max(created_at) AS t FROM cprm_sync_log WHERE erro IS NULL AND tipo = 'recursos'",
  },
];

// Watchdog de altitude: alerta se o backlog crescer além do que uma rodada normal
// resolveria (worker morto + watchdog falhando há dias).
const ALT_BACKLOG_MAX = 200000;

(async () => {
  const testModule = (process.argv.find((a) => a.startsWith('--test-module=')) || '').split('=')[1] || null;
  const hubPool = new Pool({ ...parseDbUrl('/var/www/mavrion-api/.env'), max: 1 });
  const conPool = new Pool({ ...parseDbUrl('/var/www/mavrion-conect/.env'), max: 1 });
  const stale = [];

  try {
    for (const m of MODULES) {
      let t = null;
      try {
        const { rows: [row] } = await hubPool.query(m.query);
        t = row && row.t ? new Date(row.t) : null;
      } catch (e) {
        log(`ERRO consultando ${m.id}: ${e.message} — tratando como sem sucesso conhecido`);
      }
      const idadeDias = t ? (Date.now() - t.getTime()) / 86400000 : Infinity;
      const isStale = testModule === m.id || idadeDias > m.maxDias;
      log(`${m.id}: último sucesso ${t ? t.toISOString() : 'NUNCA'} (${isFinite(idadeDias) ? idadeDias.toFixed(1) : '∞'} dias, limite ${m.maxDias})${isStale ? ' — ESTOURADO' : ' ok'}`);
      if (isStale) {
        stale.push({
          module: m.id,
          title: `Rotina VPS defasada: ${m.titulo}`,
          description:
            `O módulo ${m.titulo} está há ${isFinite(idadeDias) ? Math.floor(idadeDias) + ' dias' : 'tempo indeterminado'} sem sync bem-sucedido ` +
            `(limite: ${m.maxDias} dias). Último sucesso: ${t ? t.toISOString() : 'desconhecido'}. ` +
            `Verificar rotinas/logs/ no VPS e o upstream (WAF/FeatureServer podem ter mudado).`,
          metadata: { module: m.id, lastSuccess: t ? t.toISOString() : null, thresholdDays: m.maxDias },
        });
      }
    }

    // Backlog de altitude
    try {
      const { rows: [{ n }] } = await hubPool.query(
        'SELECT count(*)::int AS n FROM sicar_imoveis_cache WHERE alt_media IS NULL AND geom IS NOT NULL',
      );
      const isStale = testModule === 'altitude' || n > ALT_BACKLOG_MAX;
      log(`altitude: backlog ${n} (limite ${ALT_BACKLOG_MAX})${isStale ? ' — ESTOURADO' : ' ok'}`);
      if (isStale) {
        stale.push({
          module: 'altitude',
          title: 'Rotina VPS defasada: worker de altitude SICAR',
          description: `Backlog de altitude com ${n} imóveis pendentes (limite ${ALT_BACKLOG_MAX}). O watchdog 6/6h pode estar falhando ou o worker não está processando. Verificar rotinas/logs/altitude-watchdog.log no VPS.`,
          metadata: { module: 'altitude', backlog: n, threshold: ALT_BACKLOG_MAX },
        });
      }
    } catch (e) {
      log(`ERRO consultando backlog de altitude: ${e.message}`);
    }

    // Módulo que voltou a sincronizar: resolve alertas abertos (some do sino no próximo login)
    const staleIds = new Set(stale.map((s) => s.module));
    const allIds = MODULES.map((m) => m.id).concat(['altitude']).filter((id) => !staleIds.has(id));
    if (allIds.length) {
      const { rowCount } = await conPool.query(
        `UPDATE error_reports SET status='resolved', resolved_at=now(), resolved_by='freshness-check'
          WHERE type='vps_rotina_stale' AND status='open' AND module = ANY($1)`,
        [allIds],
      );
      if (rowCount) log(`${rowCount} alerta(s) antigos resolvidos (módulos recuperados)`);
    }

    // Grava alertas deduplicados (1/dia por módulo) no banco do Connect
    for (const s of stale) {
      const { rows } = await conPool.query(
        `SELECT 1 FROM error_reports
          WHERE type='vps_rotina_stale' AND module=$1 AND created_at > now() - interval '20 hours' LIMIT 1`,
        [s.module],
      );
      if (rows.length) { log(`alerta ${s.module}: já registrado nas últimas 20h — pulando`); continue; }
      await conPool.query(
        `INSERT INTO error_reports (type, title, description, module, priority, status, reported_by, metadata)
         VALUES ('vps_rotina_stale', $1, $2, $3, 'high', 'open', 'freshness-check', $4::jsonb)`,
        [s.title, s.description, s.module, JSON.stringify(s.metadata)],
      );
      log(`alerta ${s.module}: REGISTRADO no Connect (error_reports)`);
    }

    log(stale.length ? `concluído com ${stale.length} módulo(s) defasado(s)` : 'concluído — tudo em dia');
    process.exitCode = stale.length ? 1 : 0;
  } catch (e) {
    log(`FALHA: ${e.message}`);
    process.exitCode = 2;
  } finally {
    await hubPool.end().catch(() => {});
    await conPool.end().catch(() => {});
  }
})();
