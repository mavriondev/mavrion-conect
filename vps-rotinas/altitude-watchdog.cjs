#!/usr/bin/env node
/**
 * altitude-watchdog.cjs — Religa o worker de altitude SICAR quando há pendências
 * Deploy: /var/www/mavrion-api/rotinas/ (VPS 187.77.232.164) — cron a cada 6h
 *
 * Por que existe: o worker interno só inicia via POST /api/sicar/altitude/start e
 * morre a cada pm2 restart — ficou parado de 13/07 a 13/08 acumulando 154 mil imóveis
 * pendentes (importações diárias do SICAR criam linhas novas com alt_media NULL).
 * sicar_imoveis_cache é a tabela-mãe particionada das sicar_imoveis_<uf>, então a
 * contagem abaixo enxerga todas as UFs.
 */
const fs = require('fs');
const { Pool } = require('/var/www/mavrion-api/node_modules/pg');

const API = 'http://localhost:5002';
const MIN_PENDING = 100; // tolera resíduo (ex.: geometrias inválidas)

const log = (...a) => console.log(new Date().toISOString(), '[ALT-WATCHDOG]', ...a);

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

function apiCreds() {
  // credenciais administrativas ficam no .env do Connect (leitura apenas)
  const env = fs.readFileSync('/var/www/mavrion-conect/.env', 'utf8');
  const get = (k) => {
    const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  };
  return { user: get('MAVRION_API_USER'), pass: get('MAVRION_API_PASS') };
}

(async () => {
  const pool = new Pool({ ...dbConfig(), max: 1 });
  try {
    const { rows: [{ n }] } = await pool.query(
      'SELECT count(*)::int AS n FROM sicar_imoveis_cache WHERE alt_media IS NULL AND geom IS NOT NULL',
    );
    await pool.end();
    log(`pendentes: ${n}`);
    if (n < MIN_PENDING) { log('nada a fazer'); process.exit(0); }

    const { user, pass } = apiCreds();
    if (!user || !pass) throw new Error('credenciais MAVRION_API_USER/PASS não encontradas');
    const lr = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
      signal: AbortSignal.timeout(15000),
    });
    const lj = await lr.json().catch(() => ({}));
    const tok = lj.token;
    if (!tok) throw new Error(`login falhou (HTTP ${lr.status}): ${JSON.stringify(lj).slice(0, 150)}`);

    const st = await (await fetch(`${API}/api/sicar/altitude/status`, {
      headers: { Authorization: `Bearer ${tok}` },
      signal: AbortSignal.timeout(60000),
    })).json();
    if (st.worker && st.worker.isRunning) {
      log(`worker já rodando (processed=${st.worker.processed}, rate=${st.worker.rate}/min) — ok`);
      process.exit(0);
    }
    const sr = await (await fetch(`${API}/api/sicar/altitude/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}` },
      signal: AbortSignal.timeout(15000),
    })).json();
    log(`worker INICIADO (pendentes=${n}): ${JSON.stringify(sr).slice(0, 150)}`);
    process.exit(0);
  } catch (e) {
    log('ERRO:', e.message);
    try { await pool.end(); } catch {}
    process.exit(1);
  }
})();
