#!/usr/bin/env node
/**
 * anm-enrich-guard.cjs — Mantém o enriquecimento ANM×SICAR rodando SEM derrubar o servidor
 * Deploy: /var/www/mavrion-api/rotinas/ (VPS 187.77.232.164) — cron a cada 10 min
 *
 * Por que existe: a fase "enrich" do importador ANM upserta 8,4 mi de imóveis SICAR.
 * Em mar/2026 (sem índice funcional ST_Transform e com concorrência 6) o load foi a ~10
 * e a fase foi abortada. Com o índice idx_anm_processos_geom_4326 + throttle no bundle
 * (ANM_ENRICH_CONCURRENCY=3) a carga fica ~3, mas este guardião garante o contrato:
 *   - STOP  se load(1min) > STOP_LOAD com a fase "enriching" ativa;
 *   - START/RESUME na janela diária (03–09 UTC = 00–06 BRT) se houver pendências,
 *     ou a qualquer hora se foi o próprio guardião que pausou (marker em /tmp);
 *   - progresso é retomável (tabela sicar_anm_enrichment marca o que já foi feito).
 *
 * Barato por padrão: só consulta a API (status faz um COUNT pesado no banco) quando
 * há chance de agir — fora da janela, sem marker e com load baixo, sai imediatamente.
 */
const fs = require('fs');
const os = require('os');

const API = 'http://localhost:5002';
const STATE = '/tmp/anm-enrich-guard.state.json';
const STOP_LOAD = parseFloat(process.env.GUARD_STOP_LOAD || '4.2');   // load 1min p/ pausar
const START_LOAD = parseFloat(process.env.GUARD_START_LOAD || '3.0'); // load 5min p/ (re)iniciar
const WIN_START_UTC = 3; // 00:00 BRT
const WIN_END_UTC = 9;   // 06:00 BRT (exclusivo)

const log = (...a) => console.log(new Date().toISOString(), '[ENRICH-GUARD]', ...a);

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; }
}
function writeState(s) {
  try { fs.writeFileSync(STATE, JSON.stringify(s)); } catch {}
}

function apiCreds() {
  // credenciais administrativas ficam no .env do Connect (leitura apenas)
  const env = fs.readFileSync('/var/www/mavrion-conect/.env', 'utf8');
  const get = (k) => {
    const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  };
  return { user: get('MAVRION_API_USER'), pass: get('MAVRION_API_PASS') };
}

async function login() {
  const { user, pass } = apiCreds();
  if (!user || !pass) throw new Error('credenciais MAVRION_API_USER/PASS não encontradas');
  const lr = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
    signal: AbortSignal.timeout(15000),
  });
  const lj = await lr.json().catch(() => ({}));
  if (!lj.token) throw new Error(`login falhou (HTTP ${lr.status})`);
  return lj.token;
}

(async () => {
  const [load1, load5] = os.loadavg();
  const hour = new Date().getUTCHours();
  const inWindow = hour >= WIN_START_UTC && hour < WIN_END_UTC;
  const state = readState();

  // Caminho barato: nada a fazer sem tocar na API/banco.
  const drainedRecently = state.lastPending === 0 && state.lastPendingAt &&
    (Date.now() - Date.parse(state.lastPendingAt)) < 20 * 3600e3;
  if (load1 < STOP_LOAD && !state.pausedByGuard && (!inWindow || drainedRecently)) {
    process.exit(0); // silencioso — roda a cada 10 min
  }

  const tok = await login();
  const st = await (await fetch(`${API}/api/anm/import/status`, {
    headers: { Authorization: `Bearer ${tok}` },
    signal: AbortSignal.timeout(180000), // o status faz COUNT anti-join em 8,4 mi de linhas
  })).json();
  const phase = st.worker && st.worker.phase;
  const pending = st.database ? st.database.sicar_pending : null;
  if (typeof pending === 'number') {
    state.lastPending = pending;
    state.lastPendingAt = new Date().toISOString();
  }

  if (phase === 'enriching') {
    // Detecção de "roda livre": worker ativo, contador parado e erros crescendo
    // (ex.: constraint inválida → o mesmo lote de pendentes falha para sempre).
    const stalled = typeof state.lastWorkerEnriched === 'number' &&
      st.worker.enriched === state.lastWorkerEnriched &&
      (st.worker.errors || 0) > (state.lastWorkerErrors ?? Infinity) &&
      st.worker.errors > 500;
    state.lastWorkerEnriched = st.worker.enriched;
    state.lastWorkerErrors = st.worker.errors || 0;
    if (stalled) {
      await fetch(`${API}/api/anm/import/stop`, {
        method: 'POST', headers: { Authorization: `Bearer ${tok}` },
        signal: AbortSignal.timeout(15000),
      });
      state.stalled = { pending, at: new Date().toISOString() };
      log(`STALL: enriched travado em ${st.worker.enriched} com errors=${st.worker.errors} — worker PARADO; corrija a causa (ver logs do pm2) antes de retomar`);
    } else if (load1 > STOP_LOAD) {
      await fetch(`${API}/api/anm/import/stop`, {
        method: 'POST', headers: { Authorization: `Bearer ${tok}` },
        signal: AbortSignal.timeout(15000),
      });
      state.pausedByGuard = true;
      log(`PAUSADO: load1=${load1.toFixed(2)} > ${STOP_LOAD} (pendentes=${pending})`);
    } else {
      log(`ok: enriquecendo, load1=${load1.toFixed(2)}, pendentes=${pending}`);
    }
  } else if (['idle', 'stopped', 'completed', 'error'].includes(phase)) {
    // fila andou desde o stall (ex.: causa corrigida)? libera a retomada
    if (state.stalled && typeof pending === 'number' &&
        Math.abs(state.stalled.pending - pending) >= 1000) delete state.stalled;
    if (state.stalled) {
      log(`stall pendente de correção (desde ${state.stalled.at}) — não retomo automaticamente`);
    } else if (pending > 0 && load5 < START_LOAD && (state.pausedByGuard || inWindow)) {
      const sr = await (await fetch(`${API}/api/anm/import/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phases: ['enrich'] }),
        signal: AbortSignal.timeout(15000),
      })).json().catch((e) => ({ error: e.message }));
      if (sr && sr.ok) state.pausedByGuard = false; // start falhou? mantém marker p/ retentar no próximo tick
      log(`INICIADO (pendentes=${pending}, load5=${load5.toFixed(2)}): ${JSON.stringify(sr).slice(0, 120)}`);
    } else {
      log(`parado (phase=${phase}, pendentes=${pending}, load5=${load5.toFixed(2)}, janela=${inWindow}, pausadoPeloGuard=${!!state.pausedByGuard}) — sem ação`);
      if (pending === 0) state.pausedByGuard = false; // fila drenada: nada a retomar
    }
  } else {
    log(`fase "${phase}" (import/barragens?) — guardião não interfere`);
  }
  writeState(state);
  process.exit(0);
})().catch((e) => { log('ERRO:', e.message); process.exit(1); });
