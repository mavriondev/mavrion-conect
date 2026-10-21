// Detentores de imóveis rurais via Consulta Pública do SNCR (sncr.serpro.gov.br).
//
// O SNCR/SERPRO oferece um CSV público por município com TODOS os imóveis
// rurais cadastrados e seus detentores (nome, sem CPF completo) — cruzável
// com as parcelas SIGEF pelo código do imóvel (13 dígitos, campo codigo_imo).
// O download exige um hCaptcha resolvido por humano; a interface embeda o
// widget e o servidor usa o token para baixar o CSV. Cada município baixado
// fica em cache (banco) — o captcha só é necessário uma vez por município.
//
// Fluxo JSF (validado ago/2026):
// 1. GET consultaPublica.jsf → cookies + ViewState + windowId + sitekey + UFs
// 2. POST ajax (change selectUf) → options de municípios
// 3. POST form completo + h-captcha-response → CSV (attachment)

import { randomUUID } from "crypto";
import { getCached, setCached } from "../cache";

const SNCR_BASE = "https://sncr.serpro.gov.br";
const SNCR_PAGE = `${SNCR_BASE}/sncr-web/consultaPublica.jsf`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ── Mapeamento UF: código IBGE → sigla/nome ─────────────────────────────────
const UFS_IBGE: Record<string, { sigla: string; nome: string }> = {
  "11": { sigla: "RO", nome: "Rondônia" }, "12": { sigla: "AC", nome: "Acre" },
  "13": { sigla: "AM", nome: "Amazonas" }, "14": { sigla: "RR", nome: "Roraima" },
  "15": { sigla: "PA", nome: "Pará" }, "16": { sigla: "AP", nome: "Amapá" },
  "17": { sigla: "TO", nome: "Tocantins" }, "21": { sigla: "MA", nome: "Maranhão" },
  "22": { sigla: "PI", nome: "Piauí" }, "23": { sigla: "CE", nome: "Ceará" },
  "24": { sigla: "RN", nome: "Rio Grande do Norte" }, "25": { sigla: "PB", nome: "Paraíba" },
  "26": { sigla: "PE", nome: "Pernambuco" }, "27": { sigla: "AL", nome: "Alagoas" },
  "28": { sigla: "SE", nome: "Sergipe" }, "29": { sigla: "BA", nome: "Bahia" },
  "31": { sigla: "MG", nome: "Minas Gerais" }, "32": { sigla: "ES", nome: "Espírito Santo" },
  "33": { sigla: "RJ", nome: "Rio de Janeiro" }, "35": { sigla: "SP", nome: "São Paulo" },
  "41": { sigla: "PR", nome: "Paraná" }, "42": { sigla: "SC", nome: "Santa Catarina" },
  "43": { sigla: "RS", nome: "Rio Grande do Sul" }, "50": { sigla: "MS", nome: "Mato Grosso do Sul" },
  "51": { sigla: "MT", nome: "Mato Grosso" }, "52": { sigla: "GO", nome: "Goiás" },
  "53": { sigla: "DF", nome: "Distrito Federal" },
};

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}

// ── Sessão SNCR (em memória, TTL curto) ─────────────────────────────────────
interface SncrSessao {
  id: string;
  cookies: Map<string, string>;
  viewState: string;
  actionPath: string; // /sncr-web/consultaPublica.jsf?windowId=...
  sitekey: string;
  ufOptions: Map<string, string>; // nome normalizado → id SNCR
  municipioOptions: Map<string, Map<string, string>>; // ufId → (nome normalizado → id SNCR)
  criadaEm: number;
}

const sessoes = new Map<string, SncrSessao>();
const SESSAO_TTL_MS = 20 * 60 * 1000;

function limparSessoesExpiradas() {
  const agora = Date.now();
  for (const [id, s] of Array.from(sessoes.entries())) {
    if (agora - s.criadaEm > SESSAO_TTL_MS) sessoes.delete(id);
  }
}

function cookieHeader(s: SncrSessao): string {
  return Array.from(s.cookies.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

function absorverCookies(s: SncrSessao, resp: Response) {
  const setCookies = (resp.headers as any).getSetCookie?.() ?? [];
  const single = resp.headers.get("set-cookie");
  const list: string[] = setCookies.length > 0 ? setCookies : single ? [single] : [];
  for (const c of list) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) s.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function extrairViewState(html: string): string | null {
  const m = html.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/) ||
    html.match(/value="([^"]+)"[^>]*name="javax\.faces\.ViewState"/);
  return m ? m[1] : null;
}

/**
 * Abre uma sessão na Consulta Pública do SNCR: obtém cookies, ViewState,
 * sitekey do hCaptcha e a lista de UFs. Devolve o id da sessão + sitekey
 * para a interface renderizar o widget.
 */
export async function iniciarSessaoSncr(): Promise<{ sessionId: string; sitekey: string }> {
  limparSessoesExpiradas();
  const s: SncrSessao = {
    id: randomUUID(),
    cookies: new Map(),
    viewState: "",
    actionPath: "",
    sitekey: "",
    ufOptions: new Map(),
    municipioOptions: new Map(),
    criadaEm: Date.now(),
  };
  const resp = await fetch(SNCR_PAGE, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(25000),
  });
  absorverCookies(s, resp);
  if (!resp.ok) throw new Error(`SNCR indisponível (HTTP ${resp.status})`);
  const html = await resp.text();

  const vs = extrairViewState(html);
  if (!vs) throw new Error("SNCR mudou de formato: ViewState não encontrado");
  s.viewState = vs;

  const act = html.match(/<form[^>]*name="formConsultaPublica"[^>]*action="([^"]+)"/) ||
    html.match(/action="(\/sncr-web\/consultaPublica\.jsf[^"]*)"/);
  if (!act) throw new Error("SNCR mudou de formato: action do formulário não encontrada");
  s.actionPath = act[1].replace(/&amp;/g, "&");

  const sk = html.match(/data-sitekey="([^"]+)"/);
  if (!sk) throw new Error("SNCR mudou de formato: sitekey do hCaptcha não encontrada");
  s.sitekey = sk[1];

  // options de UF: <option value="25">Mato Grosso</option>
  const selUf = html.match(/<select[^>]*id="selectUf"[\s\S]*?<\/select>/);
  if (selUf) {
    const reOpt = /<option value="(\d+)"[^>]*>([^<]+)<\/option>/g;
    let m: RegExpExecArray | null;
    while ((m = reOpt.exec(selUf[0])) !== null) {
      s.ufOptions.set(normalizar(m[2]), m[1]);
    }
  }
  if (s.ufOptions.size < 20) throw new Error("SNCR mudou de formato: lista de UFs incompleta");

  sessoes.set(s.id, s);
  return { sessionId: s.id, sitekey: s.sitekey };
}

export function obterSessaoSncr(sessionId: string): SncrSessao | null {
  limparSessoesExpiradas();
  return sessoes.get(sessionId) ?? null;
}

// ── Municípios da UF (ajax JSF) ─────────────────────────────────────────────
async function carregarMunicipios(s: SncrSessao, ufId: string): Promise<Map<string, string>> {
  const cached = s.municipioOptions.get(ufId);
  if (cached) return cached;
  const body = new URLSearchParams({
    "javax.faces.partial.ajax": "true",
    "javax.faces.source": "selectUf",
    "javax.faces.partial.execute": "selectUf",
    "javax.faces.partial.render": "selectMunicipio",
    "javax.faces.behavior.event": "change",
    "javax.faces.partial.event": "change",
    formConsultaPublica: "formConsultaPublica",
    selectUf: ufId,
    "javax.faces.ViewState": s.viewState,
  });
  const resp = await fetch(`${SNCR_BASE}${s.actionPath}`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Faces-Request": "partial/ajax",
      Cookie: cookieHeader(s),
    },
    body: body.toString(),
    signal: AbortSignal.timeout(25000),
  });
  absorverCookies(s, resp);
  if (!resp.ok) throw new Error(`SNCR: falha ao listar municípios (HTTP ${resp.status})`);
  const xml = await resp.text();
  // ViewState pode ser renovado na resposta parcial
  const vsm = xml.match(/ViewState[^>]*><!\[CDATA\[([^\]]+)\]\]>/);
  if (vsm) s.viewState = vsm[1];
  const mapa = new Map<string, string>();
  const reOpt = /<option value="(\d+)"[^>]*>([^<]+)<\/option>/g;
  let m: RegExpExecArray | null;
  while ((m = reOpt.exec(xml)) !== null) mapa.set(normalizar(m[2]), m[1]);
  if (mapa.size === 0) throw new Error("SNCR: nenhum município devolvido para a UF");
  s.municipioOptions.set(ufId, mapa);
  return mapa;
}

// ── Nome do município via IBGE ──────────────────────────────────────────────
const nomeMunicipioCache = new Map<number, string>();

async function nomeMunicipioIbge(codigoIbge: number): Promise<string | null> {
  if (nomeMunicipioCache.has(codigoIbge)) return nomeMunicipioCache.get(codigoIbge)!;
  try {
    const resp = await fetch(
      `https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${codigoIbge}`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) },
    );
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    const nome = typeof data?.nome === "string" ? data.nome : null;
    if (nome) nomeMunicipioCache.set(codigoIbge, nome);
    return nome;
  } catch {
    return null;
  }
}

// ── Download + parse do CSV ─────────────────────────────────────────────────

export interface SncrMunicipioPayload {
  ufIbge: string;
  municipioIbge: number;
  nomeMunicipio: string;
  baixadoEm: string;
  totalImoveis: number;
  imoveis: Record<string, string>; // código do imóvel (13 dígitos) → detentor(es)
}

/** Erro de captcha inválido/expirado — a interface deve pedir novo captcha. */
export class CaptchaInvalidoError extends Error {
  constructor() { super("Captcha inválido ou expirado — resolva o captcha novamente"); }
}

/**
 * Interpreta o CSV público do SNCR (separador ';', UTF-8). Colunas variam,
 * então localizamos pelo cabeçalho: código do imóvel + nome do detentor.
 * Um imóvel com N detentores vem em N linhas.
 */
// split de linha CSV com suporte a aspas (nomes/endereços podem conter o separador)
function splitCsvLinha(linha: string, sep: string): string[] {
  const cols: string[] = [];
  let atual = "";
  let dentroAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (ch === '"') {
      if (dentroAspas && linha[i + 1] === '"') { atual += '"'; i++; }
      else dentroAspas = !dentroAspas;
    } else if (ch === sep && !dentroAspas) {
      cols.push(atual); atual = "";
    } else {
      atual += ch;
    }
  }
  cols.push(atual);
  return cols.map((c) => c.trim());
}

export function parsearCsvSncr(csv: string): Record<string, string> {
  const linhas = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (linhas.length < 2) throw new Error("CSV do SNCR vazio ou sem dados");
  const sep = linhas[0].includes(";") ? ";" : ",";
  const header = splitCsvLinha(linhas[0], sep).map((h) => normalizar(h.replace(/"/g, "")));

  const idxCodigo = header.findIndex((h) => h.includes("CODIGO") && h.includes("IMOVEL"));
  let idxNome = header.findIndex((h) => h.includes("DETENTOR") || h.includes("TITULAR"));
  if (idxNome < 0) idxNome = header.findIndex((h) => h === "NOME" || h.startsWith("NOME "));
  if (idxCodigo < 0 || idxNome < 0) {
    throw new Error(`CSV do SNCR com cabeçalho inesperado: ${linhas[0].slice(0, 300)}`);
  }

  const porImovel = new Map<string, string[]>();
  for (let i = 1; i < linhas.length; i++) {
    const cols = splitCsvLinha(linhas[i], sep);
    const codigo = (cols[idxCodigo] || "").replace(/[^\d]/g, "");
    const nome = (cols[idxNome] || "").trim();
    if (!codigo || !nome) continue;
    const lista = porImovel.get(codigo) ?? [];
    if (!lista.includes(nome)) lista.push(nome);
    porImovel.set(codigo, lista);
  }
  const out: Record<string, string> = {};
  for (const [codigo, nomes] of Array.from(porImovel.entries())) out[codigo] = nomes.join("; ").slice(0, 300);
  return out;
}

/**
 * Baixa o CSV do SNCR para um município usando um token de hCaptcha resolvido
 * pelo usuário. Grava o payload no cache do banco (por município) e devolve o
 * mapa código do imóvel → detentor.
 */
export async function baixarMunicipioSncr(
  sessionId: string,
  ufIbge: string,
  municipioIbge: number,
  captchaToken: string,
): Promise<SncrMunicipioPayload> {
  const s = obterSessaoSncr(sessionId);
  if (!s) throw new Error("Sessão SNCR expirada — abra o captcha novamente");

  const uf = UFS_IBGE[ufIbge];
  if (!uf) throw new Error(`UF desconhecida: ${ufIbge}`);
  const ufId = s.ufOptions.get(normalizar(uf.nome));
  if (!ufId) throw new Error(`UF ${uf.nome} não encontrada na lista do SNCR`);

  const nomeMun = await nomeMunicipioIbge(municipioIbge);
  if (!nomeMun) throw new Error(`Município IBGE ${municipioIbge} não encontrado na API do IBGE`);

  const municipios = await carregarMunicipios(s, ufId);
  const munId = municipios.get(normalizar(nomeMun));
  if (!munId) throw new Error(`Município "${nomeMun}" não encontrado na lista do SNCR para ${uf.sigla}`);

  const body = new URLSearchParams({
    formConsultaPublica: "formConsultaPublica",
    hiddenpath: "/sncr-web",
    selectUf: ufId,
    selectMunicipio: munId,
    botaoDownload: "botaoDownload",
    "h-captcha-response": captchaToken,
    "g-recaptcha-response": captchaToken,
    "javax.faces.ViewState": s.viewState,
  });
  const resp = await fetch(`${SNCR_BASE}${s.actionPath}`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(s),
    },
    body: body.toString(),
    signal: AbortSignal.timeout(120000),
  });
  absorverCookies(s, resp);
  if (!resp.ok) throw new Error(`SNCR: download falhou (HTTP ${resp.status})`);

  const contentType = resp.headers.get("content-type") || "";
  const disposition = resp.headers.get("content-disposition") || "";
  const texto = await resp.text();

  const ehCsv = /csv|octet-stream|ms-excel/i.test(contentType) || /attachment/i.test(disposition);
  if (!ehCsv) {
    // resposta HTML: renova o ViewState e interpreta a mensagem de erro
    const vs = extrairViewState(texto);
    if (vs) s.viewState = vs;
    const msg = texto.match(/ui-messages-error-summary">([^<]+)/);
    const resumo = msg ? msg[1].trim() : "";
    // o SNCR devolve "erro.campo.obrigatorio.invalido" para captcha ausente/inválido
    if (/captcha/i.test(resumo) || /obrigatorio/i.test(resumo) || /obrigatório/i.test(resumo)) {
      throw new CaptchaInvalidoError();
    }
    throw new Error(`SNCR recusou o download${resumo ? `: ${resumo}` : " (resposta inesperada)"}`);
  }

  const imoveis = parsearCsvSncr(texto);
  const payload: SncrMunicipioPayload = {
    ufIbge,
    municipioIbge,
    nomeMunicipio: nomeMun,
    baixadoEm: new Date().toISOString(),
    totalImoveis: Object.keys(imoveis).length,
    imoveis,
  };
  await setCached("sncr_detentor", `${ufIbge}:${municipioIbge}`, payload);
  return payload;
}

// ── Consulta ao cache (sem captcha) ─────────────────────────────────────────

export async function municipioSncrEmCache(ufIbge: string, municipioIbge: number): Promise<SncrMunicipioPayload | null> {
  try {
    return await getCached<SncrMunicipioPayload>("sncr_detentor", `${ufIbge}:${municipioIbge}`);
  } catch {
    return null;
  }
}

/**
 * Preenche `detentor` nas parcelas (por código do imóvel) usando os municípios
 * já baixados em cache. Nunca lança; devolve quantas parcelas foram preenchidas.
 */
export async function preencherDetentoresDoCacheSncr(
  parcelas: { codigoImovel: string | null; municipioIbge: number | null; uf: string | null; detentor: string | null }[],
): Promise<number> {
  let preenchidas = 0;
  try {
    const municipios = new Set<string>();
    for (const p of parcelas) {
      if (p.codigoImovel && p.municipioIbge && p.uf) municipios.add(`${p.uf}:${p.municipioIbge}`);
    }
    const payloads = new Map<string, SncrMunicipioPayload>();
    for (const chave of Array.from(municipios)) {
      const [uf, mun] = chave.split(":");
      const payload = await municipioSncrEmCache(uf, Number(mun));
      if (payload) payloads.set(chave, payload);
    }
    for (const p of parcelas) {
      if (p.detentor || !p.codigoImovel || !p.municipioIbge || !p.uf) continue;
      const payload = payloads.get(`${p.uf}:${p.municipioIbge}`);
      const codigo = p.codigoImovel.replace(/[^\d]/g, "");
      const nome = payload?.imoveis[codigo];
      if (nome) { p.detentor = nome; preenchidas++; }
    }
  } catch (e: any) {
    console.warn(`[SNCR] Falha ao preencher detentores do cache: ${e?.message || e}`);
  }
  return preenchidas;
}

/**
 * Municípios (uf IBGE + código IBGE) presentes nas parcelas que ainda NÃO
 * estão em cache — ou seja, que precisam de captcha para baixar.
 */
export async function municipiosPendentesSncr(
  parcelas: { codigoImovel: string | null; municipioIbge: number | null; uf: string | null; relacao?: string }[],
): Promise<{ ufIbge: string; municipioIbge: number; nome: string | null }[]> {
  const vistos = new Set<string>();
  const pendentes: { ufIbge: string; municipioIbge: number; nome: string | null }[] = [];
  for (const p of parcelas) {
    if (!p.codigoImovel || !p.municipioIbge || !p.uf) continue;
    const chave = `${p.uf}:${p.municipioIbge}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const cached = await municipioSncrEmCache(p.uf, p.municipioIbge);
    if (!cached) {
      pendentes.push({
        ufIbge: p.uf,
        municipioIbge: p.municipioIbge,
        nome: await nomeMunicipioIbge(p.municipioIbge),
      });
    }
  }
  return pendentes;
}
