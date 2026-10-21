import * as cheerio from "cheerio";
import { db } from "../db";
import { seiConsultas } from "@shared/schema";
import { parseNupEstruturado, validateNupDv } from "@shared/nup";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { normalizeProcesso } from "./scm-scraper";
import { logApiError } from "./api-error-logger";

/**
 * Consulta à pesquisa pública do SEI/ANM (sei.anm.gov.br) — lista de
 * documentos (protocolos) e andamentos do processo administrativo, indexada
 * pelo NUP. Mesmo molde do scraper SCM: o usuário digita o captcha (sem
 * resolução automática por IA) e o resultado fica persistido por NUP, cache
 * compartilhado entre usuários (dado público).
 *
 * Particularidades do SEI observadas em capturas reais (2026-08):
 * - A página de pesquisa NÃO cria cookie; quem cria o PHPSESSID é o endpoint
 *   do captcha (infra_gerar_captcha.php) — o POST de pesquisa PRECISA levar
 *   esse cookie, senão o captcha nunca valida ("Código de confirmação inválido").
 * - O POST de pesquisa é AJAX e devolve JSON { itens, html } em UTF-8; as
 *   páginas HTML (pesquisa e detalhe) são servidas em iso-8859-1.
 * - O captcha vem como data URI (base64) no corpo da resposta, keyed pelo
 *   hdnCId da página + sessão PHP.
 */

const SEI_BASE = "https://sei.anm.gov.br";
const SEI_SEARCH_URL = `${SEI_BASE}/sei/modulos/pesquisa/md_pesq_processo_pesquisar.php?acao_externa=protocolo_pesquisar&acao_origem_externa=protocolo_pesquisar&id_orgao_acesso_externo=0`;
const SEI_AJAX_URL = `${SEI_BASE}/sei/modulos/pesquisa/md_pesq_controlador_ajax_externo.php?acao_ajax_externo=protocolo_pesquisar&id_orgao_acesso_externo=0&isPaginacao=false&inicio=0&rowsSolr=50`;
const SEI_PESQUISA_PATH = `${SEI_BASE}/sei/modulos/pesquisa/`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const SESSION_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;

interface SeiCaptchaSession {
  sessionId: string;
  userId: number;
  /** NUP só com dígitos, como informado pelo usuário */
  nupDigits: string;
  /** NUP formatado como será enviado ao SEI */
  nupFormatado: string;
  /** Dígitos usados no filtro Solr (sequencial+ano quando o NUP é estruturável) */
  solrDigits: string;
  /** Chave "numero/ano" do processo ANM para vincular ao cache SCM (opcional) */
  processoScm: string | null;
  /** Cookies (PHPSESSID) criados pelo endpoint do captcha */
  cookies: string;
  /** hdnCId da página de pesquisa — chave do captcha no servidor */
  hdnCId: string;
  captchaImageBuffer: Buffer;
  createdAt: Date;
}

const activeSessions = new Map<string, SeiCaptchaSession>();

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of activeSessions) {
    if (now - session.createdAt.getTime() > SESSION_TTL_MS) {
      activeSessions.delete(id);
    }
  }
}, 60_000).unref?.();

/**
 * Normaliza um NUP digitado/lido (ex.: "48054.832070/2024-14") para a chave
 * em dígitos e o formato padrão do SEI. Aceita 15 a 21 dígitos (o padrão
 * ANM/SEI tem 17); com 17 dígitos devolve o formato NNNNN.NNNNNN/AAAA-DD.
 */
export function normalizeNup(input: string): { digits: string; formatado: string } | null {
  if (!input) return null;
  const digits = String(input).replace(/\D/g, "");
  if (digits.length < 15 || digits.length > 21) return null;
  let formatado = String(input).trim();
  if (digits.length === 17) {
    formatado = `${digits.slice(0, 5)}.${digits.slice(5, 11)}/${digits.slice(11, 15)}-${digits.slice(15)}`;
  }
  return { digits, formatado };
}

function decodeBody(buf: Buffer, contentType: string | null): string {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("iso-8859-1") || ct.includes("latin1")) {
    return buf.toString("latin1");
  }
  return buf.toString("utf8");
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Detecta a resposta de captcha rejeitado do SEI (JSON { html } com alerta). */
export function isSeiCaptchaRejeitado(html: string): boolean {
  return /digo de confirma\S* inv/i.test(html || "");
}

/**
 * Inicia uma sessão de consulta SEI: carrega a página de pesquisa (hdnCId +
 * URL do captcha) e busca a imagem do captcha (que cria o cookie de sessão).
 */
export async function initSeiSession(nupInput: string, userId: number, processoScm?: string | null): Promise<{
  sessionId: string;
  captchaImageUrl: string;
  nup: string;
  expiresInSeconds: number;
  /** Aviso (não bloqueio) quando o DV do NUP de 17 dígitos não confere */
  avisoDv?: string;
}> {
  const norm = normalizeNup(nupInput);
  if (!norm) {
    throw Object.assign(new Error("NUP inválido. Informe o número completo, ex.: 48054.832070/2024-14"), {
      code: "nup_invalido",
    });
  }

  // Aviso claro ANTES de gastar um captcha: DV que não fecha costuma ser erro
  // de digitação — mas não bloqueia, porque a pesquisa por sequencial+ano
  // encontra o processo mesmo com DV/prefixo divergentes.
  const dv = validateNupDv(norm.digits);
  const avisoDv = dv && !dv.valido
    ? `O dígito verificador do NUP ${norm.formatado} não confere (pelo algoritmo federal seria -${dv.dvEsperado}). Pode haver erro de digitação — dá para consultar mesmo assim.`
    : undefined;

  let pageResp: Response;
  try {
    pageResp = await fetchWithTimeout(SEI_SEARCH_URL, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    });
  } catch (e: any) {
    throw Object.assign(new Error("SEI da ANM não respondeu (timeout). Tente novamente em alguns minutos."), {
      code: "sei_timeout",
    });
  }
  if (!pageResp.ok) {
    throw Object.assign(new Error(`SEI da ANM indisponível (HTTP ${pageResp.status}). Tente novamente mais tarde.`), {
      code: "sei_indisponivel",
    });
  }
  const pageCookies = (pageResp.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]);
  const pageHtml = decodeBody(Buffer.from(await pageResp.arrayBuffer()), pageResp.headers.get("content-type"));

  const hdnCId = pageHtml.match(/id="hdnCId"[^>]*value="([^"]+)"/)?.[1];
  const cap = pageHtml.match(/infra_gerar_captcha\.php\?r=s&(?:amp;)?c=([a-f0-9]+)&(?:amp;)?i=([A-Za-z_0-9]+)/);
  if (!hdnCId || !cap) {
    throw Object.assign(new Error("Não encontrei o captcha na página do SEI — a estrutura pode ter mudado."), {
      code: "sei_estrutura_mudou",
    });
  }

  let capResp: Response;
  try {
    capResp = await fetchWithTimeout(`${SEI_BASE}/infra_js/infra_gerar_captcha.php?r=s&c=${cap[1]}&i=${cap[2]}`, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: SEI_SEARCH_URL,
        ...(pageCookies.length ? { Cookie: pageCookies.join("; ") } : {}),
      },
    });
  } catch {
    throw Object.assign(new Error("SEI da ANM não respondeu ao gerar o captcha. Tente novamente."), {
      code: "sei_timeout",
    });
  }
  if (!capResp.ok) {
    throw Object.assign(new Error(`SEI da ANM indisponível ao gerar o captcha (HTTP ${capResp.status}).`), {
      code: "sei_indisponivel",
    });
  }
  const capCookies = (capResp.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]);
  const cookies = [...pageCookies, ...capCookies].filter(Boolean).join("; ");
  const dataUri = (await capResp.text()).trim();
  if (!dataUri.startsWith("data:image")) {
    throw Object.assign(new Error("O SEI não devolveu a imagem do captcha — tente novamente."), {
      code: "sei_estrutura_mudou",
    });
  }
  const base64 = dataUri.split(",")[1] || "";
  const captchaImageBuffer = Buffer.from(base64, "base64");
  if (!captchaImageBuffer.length) {
    throw Object.assign(new Error("Imagem do captcha veio vazia — tente novamente."), { code: "sei_erro" });
  }

  const sessionId = randomUUID();
  activeSessions.set(sessionId, {
    sessionId,
    userId,
    nupDigits: norm.digits,
    nupFormatado: norm.formatado,
    solrDigits: seiSolrSearchDigits(norm.digits),
    processoScm: processoScm ? (normalizeProcesso(processoScm)?.key ?? null) : null,
    cookies,
    hdnCId,
    captchaImageBuffer,
    createdAt: new Date(),
  });

  return {
    sessionId,
    captchaImageUrl: `/api/sei/captcha/imagem/${sessionId}`,
    nup: norm.formatado,
    expiresInSeconds: SESSION_TTL_MS / 1000,
    ...(avisoDv ? { avisoDv } : {}),
  };
}

export function getSeiCaptchaImage(sessionId: string, userId: number): Buffer {
  const session = activeSessions.get(sessionId);
  if (!session || session.userId !== userId) {
    throw Object.assign(new Error("Sessão de captcha expirada. Inicie a consulta novamente."), {
      code: "sessao_expirada",
    });
  }
  return session.captchaImageBuffer;
}

/** Monta o corpo do POST de pesquisa exatamente como o form #seiSearch serializa. */
function buildSearchForm(session: SeiCaptchaSession, captchaText: string): URLSearchParams {
  const form = new URLSearchParams();
  form.set("txtProtocoloPesquisa", session.nupFormatado);
  form.set("q", "");
  form.set("chkSinProcessos", "P");
  form.set("txtParticipante", "");
  form.set("hdnIdParticipante", "");
  form.set("txtUnidade", "");
  form.set("hdnIdUnidade", "");
  form.set("selTipoProcedimentoPesquisa", "null");
  form.set("selSeriePesquisa", "null");
  form.set("txtDataInicio", "");
  form.set("txtDataFim", "");
  form.set("txtInfraCaptcha", captchaText.trim());
  form.set("hdnInfraCaptcha", "1");
  form.set("txtNumeroDocumentoPesquisa", "");
  form.set("txtAssinante", "");
  form.set("hdnIdAssinante", "");
  form.set("txtDescricaoPesquisa", "");
  form.set("txtAssunto", "");
  form.set("hdnIdAssunto", "");
  form.set("txtSiglaUsuario1", "");
  form.set("txtSiglaUsuario2", "");
  form.set("txtSiglaUsuario3", "");
  form.set("txtSiglaUsuario4", "");
  form.append("hdnSiglasUsuarios", "");
  form.append("hdnSiglasUsuarios", "");
  form.set("hdnCId", session.hdnCId);
  // Filtro Solr por sequencial+ano (não pelos 17 dígitos): processos antigos
  // digitalizados podem estar no SEI sob outro prefixo de unidade (distritos
  // do DNPM) e, portanto, outro DV — o wildcard completo daria falso
  // "não encontrado". As linhas devolvidas são conferidas de forma
  // estruturada em decidirResultadoSei().
  form.set("partialfields", `prot_pesq:*${session.solrDigits}* AND sta_prot:P`);
  form.set("requiredfields", "");
  form.set("as_q", "");
  form.set("hdnFlagPesquisa", "1");
  return form;
}

export interface SeiResultadoRow {
  prot: string;
  link: string;
  titulo: string;
  unidade: string | null;
  data: string | null;
}

/** Parseia o fragmento de linhas devolvido pelo AJAX de pesquisa. */
export function parseSeiResultRows(html: string): SeiResultadoRow[] {
  const $ = cheerio.load(`<table><tbody>${html || ""}</tbody></table>`);
  const rows: SeiResultadoRow[] = [];
  $("tr.pesquisaTituloRegistro").each((_, tr) => {
    const $tr = $(tr);
    const td = $tr.find("td[data-prot]").first();
    const prot = (td.attr("data-prot") || "").trim();
    const link = ($tr.find('a[href*="md_pesq_processo_exibir.php"]').first().attr("href") || "").replace(/&amp;/g, "&");
    const titulo = td.text().replace(/\s+/g, " ").trim();
    let unidade: string | null = null;
    let data: string | null = null;
    const meta = $tr.nextAll("tr").first();
    meta.find("td.pesquisaMetatag").each((__, cell) => {
      const cellText = $(cell).text().replace(/\s+/g, " ").trim();
      if (cellText.startsWith("Unidade:")) {
        unidade = cellText.slice("Unidade:".length).trim() || null;
      } else if (cellText.startsWith("Data:")) {
        data = cellText.match(/(\d{2}\/\d{2}\/\d{4})/)?.[1] || null;
      }
    });
    if (prot && link) rows.push({ prot, link, titulo, unidade, data });
  });
  return rows;
}

/**
 * Dígitos usados no filtro Solr da pesquisa: sequencial+ano (ex.: 8507222012)
 * quando o NUP tem estrutura conhecida (15/17 dígitos); senão, os dígitos
 * completos, como antes.
 */
export function seiSolrSearchDigits(nupDigits: string): string {
  const est = parseNupEstruturado(nupDigits);
  return est ? `${est.sequencial}${est.ano}` : nupDigits;
}

export interface SeiMatchConfirmado {
  /** "exato" = 17 dígitos idênticos; "compativel" = mesmo sequencial+ano, prefixo/DV divergentes */
  tipo: "exato" | "compativel";
  row: SeiResultadoRow;
  /** NUP confirmado pelo SEI (dígitos), que passa a ser a chave do cache */
  nupConfirmadoDigits: string;
  nupConfirmadoFormatado: string;
}

export type SeiDecisaoPesquisa =
  | { tipo: "match"; match: SeiMatchConfirmado }
  | { tipo: "sem_resultados" }
  | { tipo: "sem_linha_compativel" }
  | { tipo: "ambiguo"; candidatos: string[] };

/**
 * Decide o desfecho da pesquisa a partir das linhas devolvidas pelo SEI.
 * Comparação SEMPRE estruturada por campos (prefixo/sequencial/ano/DV) — nunca
 * por substring, para não casar dígitos atravessando fronteiras de campos.
 *
 * Precedência: match exato dos dígitos completos > candidato ÚNICO com mesmo
 * sequencial+ano (prefixo/DV divergentes). Múltiplos candidatos distintos sem
 * match exato = ambíguo (falhar em vez de adivinhar).
 */
export function decidirResultadoSei(itens: number, rows: SeiResultadoRow[], nupDigitadoDigits: string): SeiDecisaoPesquisa {
  const asMatch = (row: SeiResultadoRow, tipo: "exato" | "compativel"): SeiDecisaoPesquisa => {
    const digits = row.prot.replace(/\D/g, "");
    const norm = normalizeNup(row.prot);
    return {
      tipo: "match",
      match: {
        tipo,
        row,
        nupConfirmadoDigits: digits,
        nupConfirmadoFormatado: norm?.formatado || row.prot.trim(),
      },
    };
  };

  const exato = rows.find((r) => r.prot.replace(/\D/g, "") === nupDigitadoDigits);
  if (exato) return asMatch(exato, "exato");

  const alvo = parseNupEstruturado(nupDigitadoDigits);
  if (alvo) {
    const candidatos = new Map<string, SeiResultadoRow>();
    for (const r of rows) {
      const est = parseNupEstruturado(r.prot);
      if (est && est.sequencial === alvo.sequencial && est.ano === alvo.ano && !candidatos.has(est.digits)) {
        candidatos.set(est.digits, r);
      }
    }
    if (candidatos.size === 1) {
      const unico = candidatos.values().next().value as SeiResultadoRow;
      return asMatch(unico, "compativel");
    }
    if (candidatos.size > 1) {
      return { tipo: "ambiguo", candidatos: Array.from(candidatos.values(), (r) => r.prot.trim()) };
    }
  }

  // Zero itens e zero linhas = resposta legítima do SEI (processo fora da
  // pesquisa pública), não erro de estrutura — mesma lição da busca DOU.
  if (itens <= 0 && rows.length === 0) return { tipo: "sem_resultados" };

  return { tipo: "sem_linha_compativel" };
}

export interface SeiDocumento {
  numero: string;
  tipo: string | null;
  data: string | null;
  dataInclusao: string | null;
  unidade: string | null;
  /** Link público de consulta externa do documento, quando existir */
  linkPublico: string | null;
}

export interface SeiAndamento {
  /** ISO local "YYYY-MM-DDTHH:MM:00" derivado de "DD/MM/YYYY HH:MM" */
  dataHora: string | null;
  dataHoraTexto: string | null;
  unidade: string | null;
  unidadeNome: string | null;
  descricao: string;
}

export interface SeiProcessoParseado {
  processo: string | null;
  tipo: string | null;
  dataGeracao: string | null;
  interessados: string[];
  documentos: SeiDocumento[];
  andamentos: SeiAndamento[];
}

function parseDataHoraBr(texto: string): string | null {
  const m = texto.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00`;
}

/** Parseia a página de detalhe do processo (md_pesq_processo_exibir.php). */
export function parseSeiProcessoHtml(html: string): SeiProcessoParseado {
  const $ = cheerio.load(html || "");
  const out: SeiProcessoParseado = {
    processo: null,
    tipo: null,
    dataGeracao: null,
    interessados: [],
    documentos: [],
    andamentos: [],
  };

  // Cabeçalho (Autuação)
  $("#tblCabecalho tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 2) return;
    const label = $(tds[0]).text().replace(/\s+/g, " ").trim().toLowerCase();
    const $val = $(tds[1]);
    if (label.startsWith("processo")) {
      out.processo = $val.text().replace(/\s+/g, " ").trim() || null;
    } else if (label.startsWith("tipo")) {
      out.tipo = $val.text().replace(/\s+/g, " ").trim() || null;
    } else if (label.includes("data")) {
      // "Data de Geração" / "Data de Registro" / "Data de Autuação" (varia com a versão do SEI)
      out.dataGeracao = $val.text().replace(/\s+/g, " ").trim() || null;
    } else if (label.startsWith("interessado")) {
      const parts = $val
        .html()!
        .split(/<br\s*\/?\s*>/i)
        .map((p) => cheerio.load(`<div>${p}</div>`)("div").text().replace(/\s+/g, " ").replace(/[,;\s]+$/, "").trim())
        .filter(Boolean);
      out.interessados = parts;
    }
  });

  // Lista de Protocolos (documentos)
  const docHeader: string[] = [];
  $("#tblDocumentos tr").each((_, tr) => {
    const ths = $(tr).find("th");
    if (ths.length) {
      ths.each((__, th) => {
        docHeader.push($(th).text().replace(/\s+/g, " ").trim().toLowerCase());
      });
      return;
    }
    const tds = $(tr).find("td");
    if (!tds.length) return;
    const colIdx = (label: string) => docHeader.findIndex((h) => h.includes(label));
    const idxNumero = colIdx("processo / documento");
    const idxTipo = colIdx("tipo");
    const idxData = docHeader.findIndex((h) => h === "data");
    const idxInclusao = colIdx("inclus");
    const idxUnidade = colIdx("unidade");
    const cell = (i: number) => (i >= 0 && i < tds.length ? $(tds[i]) : null);

    const $num = cell(idxNumero >= 0 ? idxNumero : 1);
    if (!$num) return;
    const numero = $num.text().replace(/\s+/g, " ").trim();
    if (!numero) return;
    const onclick = $num.find("a").attr("onclick") || "";
    const tokenM = onclick.match(/md_pesq_documento_consulta_externa\.php\?([^'")]+)/);
    const doc: SeiDocumento = {
      numero,
      tipo: cell(idxTipo)?.text().replace(/\s+/g, " ").trim() || null,
      data: cell(idxData)?.text().replace(/\s+/g, " ").trim() || null,
      dataInclusao: cell(idxInclusao)?.text().replace(/\s+/g, " ").trim() || null,
      unidade: cell(idxUnidade)?.text().replace(/\s+/g, " ").trim() || null,
      linkPublico: tokenM ? `${SEI_PESQUISA_PATH}md_pesq_documento_consulta_externa.php?${tokenM[1]}` : null,
    };
    out.documentos.push(doc);
  });

  // Lista de Andamentos
  $("#tblHistorico tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 3) return;
    const dataHoraTexto = $(tds[0]).text().replace(/\s+/g, " ").trim() || null;
    const $uni = $(tds[1]);
    const unidade = $uni.text().replace(/\s+/g, " ").trim() || null;
    const unidadeNome = $uni.find("a[title]").attr("title")?.trim() || null;
    const descricao = $(tds[2]).text().replace(/\s+/g, " ").trim();
    if (!dataHoraTexto && !descricao) return;
    out.andamentos.push({
      dataHora: dataHoraTexto ? parseDataHoraBr(dataHoraTexto) : null,
      dataHoraTexto,
      unidade,
      unidadeNome,
      descricao,
    });
  });

  return out;
}

/** Só aceita como consulta válida uma página com dados reais (lição do SCM). */
export function hasRealSeiData(p: SeiProcessoParseado): boolean {
  return p.documentos.length > 0 || p.andamentos.length > 0;
}

/**
 * Submete o captcha digitado + NUP ao SEI, segue para a página de detalhe do
 * processo, valida dados reais e persiste no cache compartilhado.
 */
export async function submitSeiCaptcha(sessionId: string, captchaText: string, userId: number): Promise<{
  success: boolean;
  data?: any;
}> {
  const session = activeSessions.get(sessionId);
  if (!session || session.userId !== userId) {
    throw Object.assign(new Error("Sessão de captcha expirada. Inicie a consulta novamente."), {
      code: "sessao_expirada",
    });
  }
  const typed = (captchaText || "").trim();
  if (typed.length < 4) {
    throw Object.assign(new Error("Digite o código de confirmação completo (4 a 6 caracteres)."), {
      code: "captcha_curto",
    });
  }

  let searchResp: Response;
  try {
    searchResp = await fetchWithTimeout(SEI_AJAX_URL, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Referer: SEI_SEARCH_URL,
        ...(session.cookies ? { Cookie: session.cookies } : {}),
      },
      body: buildSearchForm(session, typed).toString(),
    });
  } catch {
    throw Object.assign(new Error("SEI da ANM não respondeu à pesquisa (timeout). Tente novamente."), {
      code: "sei_timeout",
    });
  }

  // Captcha é de uso único (amarrado ao PHPSESSID + hdnCId): sessão morre aqui
  activeSessions.delete(sessionId);

  if (!searchResp.ok) {
    throw Object.assign(new Error(`SEI da ANM indisponível (HTTP ${searchResp.status}). Tente novamente mais tarde.`), {
      code: "sei_indisponivel",
    });
  }

  const rawBody = decodeBody(Buffer.from(await searchResp.arrayBuffer()), searchResp.headers.get("content-type"));
  let parsedJson: { itens?: number; html?: string } | null = null;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    throw Object.assign(new Error("O SEI devolveu uma resposta inesperada — a estrutura pode ter mudado."), {
      code: "sei_estrutura_mudou",
    });
  }
  const resultHtml = String(parsedJson?.html || "");

  if (isSeiCaptchaRejeitado(resultHtml)) {
    throw Object.assign(new Error("Código de confirmação incorreto. Gere uma nova imagem e tente de novo."), {
      code: "captcha_invalido",
    });
  }

  const rows = parseSeiResultRows(resultHtml);
  const itens = Number(parsedJson?.itens) || 0;
  const decisao = decidirResultadoSei(itens, rows, session.nupDigits);

  if (decisao.tipo === "sem_resultados") {
    // Resposta legítima do SEI (não é culpa do NUP digitado): o processo não
    // aparece na pesquisa pública — pode não ter sido digitalizado ou estar
    // com acesso restrito.
    throw Object.assign(
      new Error(
        `O processo ${session.nupFormatado} não aparece na pesquisa pública do SEI — ele pode não ter sido digitalizado ou estar com acesso restrito. Nada foi salvo.`
      ),
      { code: "sei_sem_resultados" }
    );
  }
  if (decisao.tipo === "ambiguo") {
    throw Object.assign(
      new Error(
        `A pesquisa no SEI devolveu ${decisao.candidatos.length} processos com o mesmo sequencial/ano: ${decisao.candidatos.join(", ")}. Não dá para escolher automaticamente — repita a consulta informando o NUP exato de um deles. Nada foi salvo.`
      ),
      { code: "sei_resultado_ambiguo", candidatos: decisao.candidatos }
    );
  }
  if (decisao.tipo === "sem_linha_compativel") {
    // Ramo anômalo: o SEI diz ter resultados, mas nenhuma linha corresponde ao
    // NUP nem ao sequencial+ano. Registrar a resposta bruta para diagnóstico —
    // só neste ramo, para não poluir os logs com respostas normais.
    console.error(
      `[SEI] Resposta anômala: itens=${itens}, ${rows.length} linha(s) parseada(s), nenhuma compatível com o NUP ${session.nupFormatado} (filtro Solr ${session.solrDigits}). prots=${JSON.stringify(rows.map((r) => r.prot))}`
    );
    await logApiError({
      service: "SEI",
      endpoint: SEI_AJAX_URL,
      errorMessage: `Pesquisa devolveu itens=${itens} sem linha compatível com o NUP ${session.nupFormatado}`,
      metadata: {
        nupInformado: session.nupFormatado,
        filtroSolr: session.solrDigits,
        itens,
        linhasParseadas: rows.length,
        protsEncontrados: rows.map((r) => r.prot),
        rawBody: rawBody.slice(0, 30_000),
      },
    });
    throw Object.assign(
      new Error(
        `O SEI devolveu ${itens} resultado(s), mas nenhum corresponde ao processo ${session.nupFormatado} — a estrutura da resposta pode ter mudado. A resposta bruta foi registrada para diagnóstico. Nada foi salvo.`
      ),
      { code: "sei_resultado_incompativel" }
    );
  }

  // Daqui em diante o processo é o CONFIRMADO pelo SEI (linha da pesquisa) —
  // pode divergir do digitado em prefixo/DV (mesmo sequencial+ano).
  const { row: matchRow, nupConfirmadoDigits, nupConfirmadoFormatado } = decisao.match;
  const nupDivergente = nupConfirmadoDigits !== session.nupDigits;
  if (nupDivergente) {
    console.log(
      `[SEI] NUP confirmado pelo SEI difere do informado: informado=${session.nupFormatado}, confirmado=${nupConfirmadoFormatado} (mesmo sequencial/ano)`
    );
  }

  // Página de detalhe (Autuação + Lista de Protocolos + Andamentos)
  let detResp: Response;
  try {
    detResp = await fetchWithTimeout(`${SEI_PESQUISA_PATH}${matchRow.link}`, {
      headers: { "User-Agent": USER_AGENT, Referer: SEI_SEARCH_URL, ...(session.cookies ? { Cookie: session.cookies } : {}) },
    });
  } catch {
    throw Object.assign(new Error("O SEI encontrou o processo mas não devolveu o detalhe (timeout). Nada foi salvo."), {
      code: "sei_timeout",
    });
  }
  if (!detResp.ok) {
    throw Object.assign(new Error(`O SEI encontrou o processo mas o detalhe falhou (HTTP ${detResp.status}). Nada foi salvo.`), {
      code: "sei_indisponivel",
    });
  }
  const detailHtml = decodeBody(Buffer.from(await detResp.arrayBuffer()), detResp.headers.get("content-type"));
  const parsed = parseSeiProcessoHtml(detailHtml);

  // Validações anti-falso-sucesso (lição do SCM): a página precisa mencionar o
  // NUP confirmado pela linha da pesquisa e trazer dados reais; senão, nada é salvo.
  const processoDigits = (parsed.processo || "").replace(/\D/g, "");
  if (processoDigits !== nupConfirmadoDigits) {
    throw Object.assign(
      new Error("A página devolvida pelo SEI não corresponde ao processo encontrado na pesquisa — nada foi salvo."),
      { code: "dados_nao_encontrados" }
    );
  }
  if (!hasRealSeiData(parsed)) {
    throw Object.assign(
      new Error("O SEI devolveu a página do processo sem documentos nem andamentos — nada foi salvo."),
      { code: "dados_nao_encontrados" }
    );
  }

  const now = new Date();
  const record = {
    nup: nupConfirmadoDigits,
    nupFormatado: parsed.processo || nupConfirmadoFormatado,
    processoScm: session.processoScm,
    tipoProcedimento: parsed.tipo,
    dataGeracao: parsed.dataGeracao,
    interessados: parsed.interessados,
    documentos: parsed.documentos,
    andamentos: parsed.andamentos,
    rawHtml: detailHtml,
    consultadoPor: userId,
    consultadoEm: now,
    updatedAt: now,
  };

  const existing = await db.select({ id: seiConsultas.id, processoScm: seiConsultas.processoScm })
    .from(seiConsultas)
    .where(eq(seiConsultas.nup, nupConfirmadoDigits))
    .limit(1);
  if (existing.length) {
    await db.update(seiConsultas)
      .set({ ...record, processoScm: session.processoScm || existing[0].processoScm })
      .where(eq(seiConsultas.id, existing[0].id));
  } else {
    await db.insert(seiConsultas).values(record);
  }

  const saved = await db.select().from(seiConsultas).where(eq(seiConsultas.nup, nupConfirmadoDigits)).limit(1);
  return {
    success: true,
    data: {
      ...saved[0],
      // Transparência quando o SEI confirma o processo sob outro prefixo/DV:
      // o registro é salvo pelo NUP confirmado, e a UI mostra a divergência.
      nupInformado: session.nupFormatado,
      nupDivergente,
    },
  };
}

/**
 * Lê o cache compartilhado por NUP e/ou processo ANM ("numero/ano").
 * Higiene: registros sem dados reais são apagados e ignorados (lição do SCM).
 */
export async function getSeiFromCache(opts: { nup?: string | null; processo?: string | null }) {
  let row: any = null;

  const norm = opts.nup ? normalizeNup(opts.nup) : null;
  if (norm) {
    const rows = await db.select().from(seiConsultas).where(eq(seiConsultas.nup, norm.digits)).limit(1);
    row = rows[0] || null;
  }
  if (!row && opts.processo) {
    const key = normalizeProcesso(opts.processo)?.key;
    if (key) {
      const rows = await db.select().from(seiConsultas).where(eq(seiConsultas.processoScm, key)).limit(1);
      row = rows[0] || null;
    }
  }
  if (!row) return null;

  const documentos = Array.isArray(row.documentos) ? row.documentos : [];
  const andamentos = Array.isArray(row.andamentos) ? row.andamentos : [];
  if (!documentos.length && !andamentos.length) {
    await db.delete(seiConsultas).where(eq(seiConsultas.id, row.id));
    return null;
  }
  return row;
}

export async function getSeiStatus() {
  const rows = await db.select({
    id: seiConsultas.id,
    nupFormatado: seiConsultas.nupFormatado,
    consultadoEm: seiConsultas.consultadoEm,
  }).from(seiConsultas);
  const ultima = rows.reduce<Date | null>((acc, r) => {
    const d = r.consultadoEm ? new Date(r.consultadoEm as any) : null;
    return d && (!acc || d > acc) ? d : acc;
  }, null);
  return { totalConsultas: rows.length, ultimaConsulta: ultima };
}
