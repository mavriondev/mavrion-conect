#!/usr/bin/env node
// Compara a chuva anual que o sistema estima (Open-Meteo/ERA5 e NASA POWER, 10 anos) com a chuva REAL
// que você conhece de alguns locais (normal do INMET, pluviômetro da fazenda, média da cooperativa).
// Mostra o viés de cada fonte. Rodar no Replit (precisa de internet):
//
//   node scripts/validar-chuva.mjs scripts/validar-chuva.exemplo.json
//
// O arquivo é uma lista de { nome, lat, lon, chuvaRealMmAno }. Sem chuvaRealMmAno só mostra as estimativas.
// Teste interno sem internet: node scripts/validar-chuva.mjs --selftest
import { readFileSync } from "node:fs";

const ANOS = 10;
const anoFim = new Date().getFullYear() - 1;
const anoInicio = anoFim - (ANOS - 1);
const diasNoMes = (ano, mes) => new Date(ano, mes, 0).getDate();

/** Média anual (mm) a partir da resposta diária do Open-Meteo. Devolve null se faltar >2% dos dias. */
export function anualOpenMeteo(json) {
  const datas = json?.daily?.time;
  const chuva = json?.daily?.precipitation_sum;
  if (!Array.isArray(datas) || !Array.isArray(chuva) || datas.length === 0) return null;
  const faltando = chuva.filter((v) => v == null).length;
  if (faltando / datas.length > 0.02) return null;
  const total = chuva.reduce((s, v) => s + (v ?? 0), 0);
  return Math.round((total / ANOS) * 10) / 10;
}

/** Média anual (mm) a partir da resposta mensal do NASA POWER (PRECTOTCORR em mm/dia). */
export function anualNasaPower(json) {
  const p = json?.properties?.parameter?.PRECTOTCORR;
  if (!p) return null;
  let total = 0;
  let meses = 0;
  for (const [chave, v] of Object.entries(p)) {
    const ano = Number(chave.slice(0, 4));
    const mes = Number(chave.slice(4));
    if (mes < 1 || mes > 12) continue; // 13 = média anual
    if (v == null || v < 0) return null; // -999 = sem dado
    total += v * diasNoMes(ano, mes);
    meses++;
  }
  if (meses < ANOS * 12 * 0.98) return null;
  return Math.round((total / ANOS) * 10) / 10;
}

async function buscar(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(40000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function estimar(lat, lon) {
  const om = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${anoInicio}-01-01&end_date=${anoFim}-12-31&daily=precipitation_sum&timezone=America/Sao_Paulo`;
  const np = `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=PRECTOTCORR&community=AG&longitude=${lon}&latitude=${lat}&start=${anoInicio}&end=${anoFim}&format=JSON`;
  const [a, b] = await Promise.allSettled([buscar(om), buscar(np)]);
  return {
    openMeteo: a.status === "fulfilled" ? anualOpenMeteo(a.value) : null,
    nasaPower: b.status === "fulfilled" ? anualNasaPower(b.value) : null,
  };
}

const fmt = (v) => (v == null ? "—" : `${Math.round(v)} mm`);
const vies = (est, real) => (est == null || !real ? "—" : `${est >= real ? "+" : ""}${Math.round(((est - real) / real) * 100)}%`);

async function main() {
  if (process.argv[2] === "--selftest") return selftest();
  const arquivo = process.argv[2];
  if (!arquivo) {
    console.error("Uso: node scripts/validar-chuva.mjs <locais.json>   (ou --selftest)");
    process.exit(1);
  }
  const locais = JSON.parse(readFileSync(arquivo, "utf8"));
  console.log(`Janela: ${anoInicio}-${anoFim} (${ANOS} anos)\n`);
  const linhas = [];
  for (const l of locais) {
    const e = await estimar(l.lat, l.lon);
    linhas.push({ ...l, ...e });
    console.log(
      `${(l.nome || `${l.lat},${l.lon}`).padEnd(28)} real: ${fmt(l.chuvaRealMmAno).padEnd(9)} ` +
        `ERA5: ${fmt(e.openMeteo).padEnd(9)} (${vies(e.openMeteo, l.chuvaRealMmAno)})   ` +
        `NASA: ${fmt(e.nasaPower).padEnd(9)} (${vies(e.nasaPower, l.chuvaRealMmAno)})`,
    );
    await new Promise((r) => setTimeout(r, 1500)); // educação com as APIs públicas
  }
  const com = linhas.filter((l) => l.chuvaRealMmAno);
  if (com.length >= 3) {
    const media = (campo) => {
      const v = com.filter((l) => l[campo] != null).map((l) => (l[campo] - l.chuvaRealMmAno) / l.chuvaRealMmAno);
      return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) : null;
    };
    console.log(`\nViés médio (${com.length} locais): ERA5 ${media("openMeteo")}%  |  NASA POWER ${media("nasaPower")}%`);
    console.log("Viés consistente de -15% ou mais indica subestimativa: considere outra fonte ou aplicar correção.");
  } else {
    console.log("\nInforme a chuva real de pelo menos 3 locais para calcular o viés médio.");
  }
}

function selftest() {
  const assert = (c, m) => { if (!c) { console.error("FALHOU:", m); process.exit(1); } };
  // 10 anos fictícios com 1 mm/dia em 3650 dias => 3650/10 = 365 mm/ano
  const datas = Array.from({ length: 3650 }, (_, i) => `d${i}`);
  assert(anualOpenMeteo({ daily: { time: datas, precipitation_sum: datas.map(() => 1) } }) === 365, "open-meteo média anual");
  const falho = datas.map((_, i) => (i < 100 ? null : 1));
  assert(anualOpenMeteo({ daily: { time: datas, precipitation_sum: falho } }) === null, "dia faltante não vira 0 mm");
  const param = {};
  for (let a = anoInicio; a <= anoFim; a++) for (let m = 1; m <= 12; m++) param[`${a}${String(m).padStart(2, "0")}`] = 3;
  param[`${anoFim}13`] = 3;
  const nasa = anualNasaPower({ properties: { parameter: { PRECTOTCORR: param } } });
  assert(nasa > 1090 && nasa < 1100, `nasa ~3 mm/dia => ~1095 mm/ano, veio ${nasa}`);
  param[`${anoFim}05`] = -999;
  assert(anualNasaPower({ properties: { parameter: { PRECTOTCORR: param } } }) === null, "-999 não vira chuva");
  console.log("validar-chuva: selftest OK");
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
