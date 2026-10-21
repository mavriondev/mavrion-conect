#!/usr/bin/env node
/**
 * token-renew.cjs — Renova o JWT admin da Hub API antes de expirar (evita 401 silencioso)
 * Deploy: /var/www/mavrion-api/rotinas/ (VPS 187.77.232.164) — cron diário
 *
 * Por que existe: o token em rotinas/.token vale 7 dias; se ninguém renovar, as
 * rotinas sidecar e integrações que o usam começam a receber 401 silenciosamente.
 *
 * O que faz: decodifica o exp do token atual; se faltar menos de RENEW_DAYS dias,
 * chama POST /api/auth/refresh (token ainda válido → novo token de 7 dias) e
 * substitui rotinas/.token atomicamente (tmp + rename). Se o refresh falhar
 * (token já expirado ou SESSION_SECRET trocado), tenta re-login com as
 * credenciais MAVRION_API_USER/PASS do .env do Connect. Se nada funcionar,
 * grava alerta persistente em error_reports do Connect (type 'vps_rotina_stale',
 * module 'hub_api_token') — deduplicado 1/dia; auto-resolve quando renovar.
 *
 * Uso: node token-renew.cjs [--force]  (renova mesmo longe do vencimento)
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('/var/www/mavrion-api/node_modules/pg');

const API = 'http://localhost:5002';
const TOKEN_FILE = '/var/www/mavrion-api/rotinas/.token';
const RENEW_DAYS = 4; // renova quando faltar menos que isso (rotina diária → 3+ chances antes de vencer)
const MODULE = 'hub_api_token';

const log = (...a) => console.log(new Date().toISOString(), '[TOKEN-RENEW]', ...a);

function parseDbUrl(envPath) {
  const env = fs.readFileSync(envPath, 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error(`DATABASE_URL não encontrada em ${envPath}`);
  const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
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

function apiCreds() {
  const env = fs.readFileSync('/var/www/mavrion-conect/.env', 'utf8');
  const get = (k) => {
    const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  };
  return { user: get('MAVRION_API_USER'), pass: get('MAVRION_API_PASS') };
}

function tokenExp(token) {
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return p.exp ? new Date(p.exp * 1000) : null;
  } catch { return null; }
}

function writeTokenAtomic(token) {
  const tmp = TOKEN_FILE + '.tmp';
  fs.writeFileSync(tmp, token, { mode: 0o600 });
  fs.renameSync(tmp, TOKEN_FILE);
}

async function alertConnect(ok, description) {
  const conPool = new Pool({ ...parseDbUrl('/var/www/mavrion-conect/.env'), max: 1 });
  try {
    if (ok) {
      const { rowCount } = await conPool.query(
        `UPDATE error_reports SET status='resolved', resolved_at=now(), resolved_by='token-renew'
          WHERE type='vps_rotina_stale' AND status='open' AND module=$1`, [MODULE]);
      if (rowCount) log(`${rowCount} alerta(s) antigos resolvidos`);
      return;
    }
    const { rows } = await conPool.query(
      `SELECT 1 FROM error_reports
        WHERE type='vps_rotina_stale' AND module=$1 AND created_at > now() - interval '20 hours' LIMIT 1`,
      [MODULE]);
    if (rows.length) { log('alerta já registrado nas últimas 20h — pulando'); return; }
    await conPool.query(
      `INSERT INTO error_reports (type, title, description, module, priority, status, reported_by, metadata)
       VALUES ('vps_rotina_stale', $1, $2, $3, 'high', 'open', 'token-renew', $4::jsonb)`,
      ['Token admin da Hub API não renovou (rotinas vão parar com 401)', description, MODULE,
       JSON.stringify({ module: MODULE, tokenFile: TOKEN_FILE })]);
    log('alerta REGISTRADO no Connect (error_reports)');
  } finally {
    await conPool.end().catch(() => {});
  }
}

(async () => {
  const force = process.argv.includes('--force');
  try {
    const current = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8').trim() : '';
    const exp = current ? tokenExp(current) : null;
    const daysLeft = exp ? (exp.getTime() - Date.now()) / 86400000 : -Infinity;
    log(`token atual: exp=${exp ? exp.toISOString() : 'ilegível/ausente'} (${isFinite(daysLeft) ? daysLeft.toFixed(1) : '-∞'} dias restantes)`);

    if (!force && daysLeft > RENEW_DAYS) {
      log(`ainda longe do vencimento (limite ${RENEW_DAYS} dias) — nada a fazer`);
      await alertConnect(true);
      return;
    }

    let newToken = null;

    // 1) refresh com o token atual (se ainda válido)
    if (current && daysLeft > 0) {
      try {
        const r = await fetch(`${API}/api/auth/refresh`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${current}` },
          signal: AbortSignal.timeout(15000),
        });
        const j = await r.json().catch(() => ({}));
        if (r.status === 200 && j.token) { newToken = j.token; log('renovado via /api/auth/refresh'); }
        else log(`refresh falhou (HTTP ${r.status}): ${JSON.stringify(j).slice(0, 150)}`);
      } catch (e) { log(`refresh falhou: ${e.message}`); }
    }

    // 2) fallback: re-login com credenciais administrativas
    if (!newToken) {
      const { user, pass } = apiCreds();
      if (user && pass) {
        try {
          const r = await fetch(`${API}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass }),
            signal: AbortSignal.timeout(15000),
          });
          const j = await r.json().catch(() => ({}));
          if (r.status === 200 && j.token) { newToken = j.token; log('renovado via re-login'); }
          else log(`re-login falhou (HTTP ${r.status}): ${JSON.stringify(j).slice(0, 150)}`);
        } catch (e) { log(`re-login falhou: ${e.message}`); }
      } else log('credenciais MAVRION_API_USER/PASS não encontradas — sem fallback de login');
    }

    if (!newToken) {
      await alertConnect(false,
        `Não foi possível renovar o JWT admin da Hub API (${TOKEN_FILE}). ` +
        `Refresh e re-login falharam. Vencimento atual: ${exp ? exp.toISOString() : 'desconhecido'}. ` +
        `As rotinas sidecar (ANM/FUNAI/CPRM/watchdog) vão receber 401 quando o token vencer. ` +
        `Verificar SESSION_SECRET do .env (rotação invalida tokens) e credenciais MAVRION_API_USER/PASS.`);
      process.exitCode = 1;
      return;
    }

    // valida o token novo antes de gravar
    const me = await fetch(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${newToken}` },
      signal: AbortSignal.timeout(15000),
    });
    if (me.status !== 200) throw new Error(`token novo não validou em /api/auth/me (HTTP ${me.status})`);

    writeTokenAtomic(newToken);
    const nexp = tokenExp(newToken);
    log(`token gravado atomicamente em ${TOKEN_FILE} — novo exp: ${nexp ? nexp.toISOString() : '?'}`);
    await alertConnect(true);
  } catch (e) {
    log(`FALHA: ${e.message}`);
    try { await alertConnect(false, `token-renew falhou com erro inesperado: ${e.message}`); } catch {}
    process.exitCode = 2;
  }
})();
