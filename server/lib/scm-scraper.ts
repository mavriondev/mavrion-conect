import * as cheerio from "cheerio";
import { db } from "../db";
import { scmProcessos } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const SCM_BASE = "https://sistemas.anm.gov.br/SCM/Extra/site/admin";
const SESSION_TTL_MS = 2 * 60 * 1000;

interface CaptchaSession {
  sessionId: string;
  userId: number;
  /** Processo como recebido do frontend (referência) */
  processo: string;
  /** Chave normalizada "numero/ano" (sem pontos, sem zeros à esquerda) usada no cache */
  processoKey: string;
  numero: number;
  ano: number;
  /** Valor exato a enviar no campo txtNumeroProcesso (máscara aceita pelo SCM) */
  postProcesso: string;
  cookies: string;
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string;
  captchaGuid: string;
  captchaImageBuffer: Buffer;
  createdAt: Date;
}

const activeSessions = new Map<string, CaptchaSession>();

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of activeSessions) {
    if (now - session.createdAt.getTime() > SESSION_TTL_MS) {
      activeSessions.delete(id);
    }
  }
}, 60_000).unref?.();

const PESSOA_JURIDICA_SUFFIXES = [
  "LTDA", "S/A", "S.A.", "SA", "ME", "EIRELI", "EPP",
  "MINERACAO", "MINERAÇÃO", "INDUSTRIA", "INDÚSTRIA",
  "COMERCIO", "COMÉRCIO", "ENGENHARIA", "CONSTRUTORA",
  "EMPREENDIMENTOS", "PARTICIPACOES", "PARTICIPAÇÕES",
  "HOLDINGS", "HOLDING", "COOPERATIVA", "ASSOCIACAO",
  "ASSOCIAÇÃO", "FUNDACAO", "FUNDAÇÃO", "INSTITUTO",
  "GRUPO", "CIA", "COMPANHIA", "SLU", "SS",
];

function detectTipoPessoa(nome: string): string {
  if (!nome) return "PJ";
  const upper = nome.toUpperCase().trim();
  for (const suffix of PESSOA_JURIDICA_SUFFIXES) {
    if (upper.includes(suffix)) return "PJ";
  }
  const parts = upper.split(/\s+/).filter(p => p.length > 1);
  if (parts.length >= 2 && parts.length <= 5) {
    const allAlpha = parts.every(p => /^[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÜÇ]+$/.test(p));
    if (allAlpha) return "PF";
  }
  return "PJ";
}

function isValidCnpj(digits: string): boolean {
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
  const calc = (s: string, w: number[]) => {
    let sum = 0;
    for (let i = 0; i < w.length; i++) sum += parseInt(s[i]) * w[i];
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };
  const d1 = calc(digits, [5,4,3,2,9,8,7,6,5,4,3,2]);
  const d2 = calc(digits, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return parseInt(digits[12]) === d1 && parseInt(digits[13]) === d2;
}

function extractCnpj(text: string): string | null {
  if (!text) return null;
  const regex = /(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const clean = match[1].replace(/\D/g, "");
    if (isValidCnpj(clean)) return clean;
  }
  return null;
}

function extractCpf(text: string): string | null {
  if (!text) return null;
  const match = text.match(/(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/);
  if (match) return match[1].replace(/\D/g, "");
  return null;
}

/**
 * Normaliza um número de processo ANM em qualquer formato ("831.522/1984",
 * "831522/1984", "002433/1935") para { numero, ano, key } com key = "numero/ano"
 * sem pontos e sem zeros à esquerda — formato canônico usado no cache.
 */
export function normalizeProcesso(processo: string): { numero: number; ano: number; key: string } | null {
  const clean = String(processo || "").replace(/\s/g, "").replace(/\./g, "");
  const m = clean.match(/^0*(\d{1,6})\/(\d{4})$/);
  if (!m) return null;
  const numero = parseInt(m[1], 10);
  const ano = parseInt(m[2], 10);
  if (!numero || !ano) return null;
  return { numero, ano, key: `${numero}/${ano}` };
}

/**
 * Máscara canônica exibida/aceita pelo SCM: NNN.NNN/AAAA
 * (número com 6 dígitos preenchido com zeros à esquerda, ponto de milhar).
 * Ex.: 831522/1984 -> "831.522/1984"; 2433/1935 -> "002.433/1935".
 */
export function formatProcessoScm(numero: number, ano: number): string {
  const padded = String(numero).padStart(6, "0");
  return `${padded.slice(0, 3)}.${padded.slice(3)}/${ano}`;
}

/**
 * Extrai mensagens de validação do SCM. O SCM renderiza erros em DOIS lugares:
 * ValidationSummary1 e ctl00_conteudo_sumarioConsultar — precisamos ler ambos,
 * ignorando sumários ocultos (display:none = sem erro ativo).
 */
function extractValidationMessages(html: string): string {
  try {
    const $ = cheerio.load(html);
    const parts: string[] = [];
    const selectors = [
      "#ctl00_conteudo_sumarioConsultar",
      "[id$='sumarioConsultar']",
      "#ValidationSummary1",
      "[id$='ValidationSummary1']",
      ".ValidationSummary",
    ];
    for (const sel of selectors) {
      $(sel).each((_, el) => {
        const style = ($(el).attr("style") || "").replace(/\s/g, "").toLowerCase();
        if (style.includes("display:none") || style.includes("visibility:hidden")) return;
        const t = $(el).text().replace(/\s+/g, " ").trim();
        if (t) parts.push(t);
      });
    }
    return Array.from(new Set(parts)).join(" | ");
  } catch {
    const m = html.match(/ValidationSummary1[^>]*>([\s\S]*?)<\/div>/i);
    return m ? m[1].replace(/<[^>]*>/g, "").trim() : "";
  }
}

export async function initSession(processo: string, userId: number): Promise<{
  sessionId: string;
  captchaImageUrl: string;
  processo: string;
  expiresIn: number;
}> {
  const norm = normalizeProcesso(processo);
  if (!norm) {
    throw new Error("processo_invalido");
  }
  const masked = formatProcessoScm(norm.numero, norm.ano);
  const url = `${SCM_BASE}/dadosProcesso.aspx?ID=${encodeURIComponent(masked)}`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err: any) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new Error("scm_timeout");
    }
    throw err;
  }

  if (!resp.ok) {
    throw new Error(`SCM retornou status ${resp.status}`);
  }

  const setCookieHeaders = resp.headers.getSetCookie?.() || [];
  const cookies = setCookieHeaders.map(c => c.split(";")[0]).join("; ");

  const html = await resp.text();

  const extractHiddenField = (name: string): string => {
    const tagPattern = new RegExp(`<input[^>]*(?:id|name)=["']${name}["'][^>]*>`, "i");
    const tagMatch = html.match(tagPattern);
    if (!tagMatch) return "";
    const valMatch = tagMatch[0].match(/value=["']([^"']*)["']/i);
    return valMatch ? valMatch[1] : "";
  };

  const viewState = extractHiddenField("__VIEWSTATE");
  const viewStateGenerator = extractHiddenField("__VIEWSTATEGENERATOR");
  const eventValidation = extractHiddenField("__EVENTVALIDATION");

  const guidMatch = html.match(/CaptchaImage\.aspx[^"']*guid=([a-f0-9-]+)/i);
  const captchaGuid = guidMatch ? guidMatch[1] : "";

  if (!viewState) {
    throw new Error("Não foi possível extrair ViewState da página SCM");
  }

  if (!captchaGuid) {
    throw new Error("Captcha não encontrado na página SCM");
  }

  // Usa o valor que o próprio SCM pré-preencheu no campo do processo (fonte
  // mais confiável do formato aceito); senão, usa a máscara canônica.
  let postProcesso = masked;
  const prefillTag = html.match(/<input[^>]*(?:name=["']ctl00\$conteudo\$txtNumeroProcesso["']|id=["']ctl00_conteudo_txtNumeroProcesso["'])[^>]*>/i);
  if (prefillTag) {
    const valMatch = prefillTag[0].match(/value=["']([^"']*)["']/i);
    const prefill = valMatch ? valMatch[1].trim() : "";
    if (prefill) {
      const prefNorm = normalizeProcesso(prefill);
      if (prefNorm && prefNorm.numero === norm.numero && prefNorm.ano === norm.ano) {
        postProcesso = prefill;
      } else {
        console.warn(`[SCM] Campo pré-preenchido "${prefill}" não corresponde ao processo ${norm.key}; usando máscara ${masked}`);
      }
    } else {
      console.log(`[SCM] Página não pré-preencheu o processo ${norm.key}; enviaremos máscara ${masked}`);
    }
  }

  const imgUrl = `${SCM_BASE}/CaptchaImage.aspx?guid=${captchaGuid}`;
  const imgResp = await fetch(imgUrl, {
    headers: {
      "Cookie": cookies,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": `${SCM_BASE}/dadosProcesso.aspx`,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!imgResp.ok) {
    throw new Error("Falha ao buscar imagem do captcha do SCM");
  }
  const captchaImageBuffer = Buffer.from(await imgResp.arrayBuffer());

  console.log(`[SCM] Sessão iniciada para processo ${norm.key} (campo do formulário: "${postProcesso}")`);

  const sessionId = randomUUID();
  const session: CaptchaSession = {
    sessionId,
    userId,
    processo,
    processoKey: norm.key,
    numero: norm.numero,
    ano: norm.ano,
    postProcesso,
    cookies,
    viewState,
    viewStateGenerator,
    eventValidation,
    captchaGuid,
    captchaImageBuffer,
    createdAt: new Date(),
  };
  activeSessions.set(sessionId, session);

  return {
    sessionId,
    captchaImageUrl: `/api/scm/captcha/imagem/${sessionId}`,
    processo: norm.key,
    expiresIn: 120,
  };
}

export async function getCaptchaImage(sessionId: string, userId: number): Promise<Buffer> {
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error("sessao_expirada");
  if (session.userId !== userId) throw new Error("sessao_expirada");
  return session.captchaImageBuffer;
}

export async function submitCaptcha(sessionId: string, captchaText: string, userId: number): Promise<{
  success: boolean;
  data?: any;
  error?: string;
  message?: string;
}> {
  const session = activeSessions.get(sessionId);
  if (!session || session.userId !== userId) {
    return { success: false, error: "sessao_expirada" };
  }

  if (!captchaText || captchaText.length < 4) {
    return { success: false, error: "captcha_curto" };
  }

  const elapsedMs = Date.now() - session.createdAt.getTime();
  const MIN_DELAY_MS = 4000;
  if (elapsedMs < MIN_DELAY_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_DELAY_MS - elapsedMs));
  }

  const formData = new URLSearchParams();
  formData.set("__EVENTTARGET", "");
  formData.set("__EVENTARGUMENT", "");
  formData.set("__VIEWSTATE", session.viewState);
  formData.set("__VIEWSTATEGENERATOR", session.viewStateGenerator);
  formData.set("__VIEWSTATEENCRYPTED", "");
  formData.set("__EVENTVALIDATION", session.eventValidation);
  formData.set("ctl00$conteudo$txtNumeroProcesso", session.postProcesso);
  formData.set("ctl00$conteudo$CaptchaControl1", captchaText.toUpperCase());
  formData.set("ctl00$conteudo$btnConsultarProcesso", "Consultar");

  const url = `${SCM_BASE}/dadosProcesso.aspx?ID=${encodeURIComponent(formatProcessoScm(session.numero, session.ano))}`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": session.cookies,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": url,
      },
      body: formData.toString(),
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: any) {
    activeSessions.delete(sessionId);
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      return { success: false, error: "scm_indisponivel", message: "O SCM da ANM não respondeu (timeout). Tente novamente." };
    }
    throw err;
  }

  let html = await resp.text();

  // O POST consome o captcha/viewstate — a sessão nunca pode ser reutilizada.
  activeSessions.delete(sessionId);

  if (!resp.ok) {
    if (html.includes("viewstate MAC failed") || html.includes("Validation of viewstate") || html.includes("Invalid postback")) {
      return { success: false, error: "captcha_invalido" };
    }
    console.error("[SCM] POST falhou com status", resp.status, "body:", html.substring(0, 300));
    return { success: false, error: "scm_indisponivel" };
  }

  // Lê mensagens de validação dos DOIS sumários que o SCM usa
  // (ValidationSummary1 e ctl00_conteudo_sumarioConsultar)
  const valText = extractValidationMessages(html);
  if (valText) {
    console.log(`[SCM] Validação do SCM para ${session.processoKey}: ${valText}`);
    const lower = valText.toLowerCase();
    const isRapido = lower.includes("muito r") || lower.includes("aguarde");
    const isCaptcha =
      lower.includes("não confere") || lower.includes("nao confere") || lower.includes("captcha") ||
      (lower.includes("imagem") && (lower.includes("código") || lower.includes("codigo") || lower.includes("caracteres") || lower.includes("texto")));
    const isNaoEncontrado =
      lower.includes("não encontrado") || lower.includes("nao encontrado") ||
      lower.includes("não localizado") || lower.includes("nao localizado") ||
      lower.includes("não existe") || lower.includes("nao existe") ||
      lower.includes("inexistente");
    if (isRapido) return { success: false, error: "captcha_rapido", message: valText };
    if (isCaptcha) return { success: false, error: "captcha_invalido", message: valText };
    if (isNaoEncontrado) return { success: false, error: "processo_nao_encontrado", message: `SCM: ${valText}` };
    if (lower.includes("código") || lower.includes("codigo")) return { success: false, error: "captcha_invalido", message: valText };
    return { success: false, error: "scm_erro", message: `SCM: ${valText}` };
  }

  const extractHiddenFieldFromHtml = (h: string, name: string): string => {
    const tagPattern = new RegExp(`<input[^>]*(?:id|name)=["']${name}["'][^>]*>`, "i");
    const tagMatch = h.match(tagPattern);
    if (!tagMatch) return "";
    const valMatch = tagMatch[0].match(/value=["']([^"']*)["']/i);
    return valMatch ? valMatch[1] : "";
  };

  // Guarda a resposta inicial do Consultar — em muitos casos ela JÁ contém
  // todos os dados; o clique em "Dados básicos" às vezes devolve um esqueleto
  // vazio que, se mesclado, apagaria os dados bons.
  const htmlInicial = html;

  if (html.includes("btnDadosBasicos")) {
    console.log("[SCM] Captcha accepted, clicking 'Dados básicos' for full data...");

    const smMatch = html.match(/PageRequestManager\._initialize\('([^']+)'/);
    const scriptManagerId = smMatch ? smMatch[1] : "ctl00$scriptManagerAdmin";

    const formData2 = new URLSearchParams();
    formData2.set(scriptManagerId, "ctl00$conteudo$upProcesso|ctl00$conteudo$btnDadosBasicos");
    formData2.set("__EVENTTARGET", "");
    formData2.set("__EVENTARGUMENT", "");
    formData2.set("__VIEWSTATE", extractHiddenFieldFromHtml(html, "__VIEWSTATE"));
    formData2.set("__VIEWSTATEGENERATOR", extractHiddenFieldFromHtml(html, "__VIEWSTATEGENERATOR"));
    formData2.set("__VIEWSTATEENCRYPTED", "");
    formData2.set("__EVENTVALIDATION", extractHiddenFieldFromHtml(html, "__EVENTVALIDATION"));
    formData2.set("ctl00$conteudo$txtNumeroProcesso", session.postProcesso);
    formData2.set("ctl00$conteudo$btnDadosBasicos", "Dados básicos");
    formData2.set("__ASYNCPOST", "true");

    let resp2: Response | null = null;
    try {
      resp2 = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Cookie": session.cookies,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": url,
          "X-MicrosoftAjax": "Delta=true",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: formData2.toString(),
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err: any) {
      console.log("[SCM] 'Dados básicos' POST falhou:", err?.message || err, "- usando resposta inicial");
    }

    if (resp2 && resp2.ok) {
      const asyncResp = await resp2.text();
      const panelMatch = asyncResp.match(/\d+\|updatePanel\|ctl00_conteudo_upProcesso\|(.+?)(?:\|0\|hiddenField\|)/s);
      if (panelMatch) {
        const panelHtml = panelMatch[1];
        const fullPageBefore = html.substring(0, html.indexOf('<div id="ctl00_conteudo_upProcesso">'));
        const fullPageAfter = html.substring(html.indexOf('</div>', html.indexOf('<div id="ctl00_conteudo_upProcesso">')) + 6);
        html = fullPageBefore + '<div id="ctl00_conteudo_upProcesso">' + panelHtml + '</div>' + fullPageAfter;
        console.log("[SCM] 'Dados básicos' async panel response merged successfully");
      } else if (asyncResp.includes("lblNup") || asyncResp.includes("lblTipoFase")) {
        html = asyncResp;
        console.log("[SCM] 'Dados básicos' response received (full page)");
      } else {
        console.log("[SCM] 'Dados básicos' response format unrecognized, length:", asyncResp.length);
        if (asyncResp.length > html.length / 2) {
          html = asyncResp;
        }
      }
    } else if (resp2) {
      console.log("[SCM] 'Dados básicos' POST failed with status", resp2.status, "- using initial response");
    }
  }

  let parsed = parseScmHtml(html);

  // Se a mescla de "Dados básicos" resultar numa página MAIS POBRE que a
  // resposta inicial do Consultar (esqueleto vazio do SCM), preferimos a
  // resposta inicial — nunca sobrescrever dados bons com um painel vazio.
  if (html !== htmlInicial) {
    const countFields = (p: ReturnType<typeof parseScmHtml>) =>
      [p.nup, p.fase, p.titularNome, p.titularCnpj, p.titularCpf, p.areaHa, p.uf,
       p.distrito, p.tipoRequerimento, p.unidadeProtocolizadora, p.dataProtocolo,
       p.dataPrioridade, p.cadastroEmpresa].filter(v => v !== null && v !== undefined).length;
    const parsedInicial = parseScmHtml(htmlInicial);
    if (countFields(parsedInicial) > countFields(parsed)) {
      console.warn(`[SCM] Painel 'Dados básicos' veio mais pobre (${countFields(parsed)} campos) que a resposta inicial (${countFields(parsedInicial)} campos) — usando a resposta inicial.`);
      parsed = parsedInicial;
      html = htmlInicial;
    }
  }

  // Só é sucesso se a página retornada contém dados reais do processo. Uma
  // página de formulário raspada (rejeição silenciosa do SCM) NÃO vira consulta.
  // Exige pelo menos um campo FORTE (nup, fase ou titular): uma página só com
  // "Área (ha)" preenchida é o esqueleto vazio do painel "Dados básicos" (bug
  // conhecido) e não pode ser salva como consulta.
  const hasRealData = hasStrongScmField(parsed);
  if (!hasRealData) {
    console.error(`[SCM] Resposta sem dados do processo ${session.processoKey} (btnDadosBasicos presente: ${html.includes("btnDadosBasicos")}, tamanho html: ${html.length}). Nada foi salvo.`);
    return {
      success: false,
      error: "dados_nao_encontrados",
      message: `O SCM não retornou os dados do processo ${session.processoKey}. Nada foi salvo — verifique o código da imagem e tente novamente.`,
    };
  }

  // A página retornada precisa mencionar o processo consultado (tolerante a
  // pontos e zeros à esquerda) — proteção contra resposta de outro processo.
  const htmlSemPontos = html.replace(/\./g, "");
  const refRegex = new RegExp(`0*${session.numero}\\s*\\/\\s*${session.ano}`);
  if (!refRegex.test(htmlSemPontos)) {
    console.error(`[SCM] Página retornada não menciona o processo ${session.processoKey}. Nada foi salvo.`);
    return {
      success: false,
      error: "processo_divergente",
      message: `A resposta do SCM não corresponde ao processo ${session.processoKey}. Nada foi salvo.`,
    };
  }

  const data = {
    processo: session.processoKey,
    numero: session.numero,
    ano: session.ano,
    consultadoPor: userId,
    rawHtml: html,
    ...parsed,
  };

  await upsertProcesso(data);
  console.log(`[SCM] Processo ${session.processoKey} consultado e salvo (titular: ${parsed.titularNome || "-"}, fase: ${parsed.fase || "-"}, área: ${parsed.areaHa ?? "-"})`);

  return { success: true, data };
}

/**
 * Um campo FORTE identifica o processo de verdade (nup, fase ou titular).
 * Campos fracos como área/UF aparecem preenchidos até no esqueleto vazio do
 * painel "Dados básicos" do SCM e NÃO bastam para considerar a consulta válida.
 */
export function hasStrongScmField(p: {
  nup: string | null;
  fase: string | null;
  titularNome: string | null;
  titularCnpj: string | null;
  titularCpf: string | null;
}): boolean {
  return !!(p.nup || p.fase || p.titularNome || p.titularCnpj || p.titularCpf);
}

export function parseScmHtml(html: string): {
  titularNome: string | null;
  titularCnpj: string | null;
  titularCpf: string | null;
  tipoPessoa: string | null;
  cadastroEmpresa: string | null;
  nup: string | null;
  fase: string | null;
  areaHa: number | null;
  uf: string | null;
  distrito: string | null;
  tipoRequerimento: string | null;
  unidadeProtocolizadora: string | null;
  dataProtocolo: string | null;
  dataPrioridade: string | null;
  statusAtivo: boolean;
} {
  const $ = cheerio.load(html);

  const getText = (id: string) => {
    // .first(): o HTML pode conter o painel duplicado (merge do "Dados
    // básicos") e .text() em múltiplos matches concatenaria os valores.
    const el = $(`[id='${id}']`).first();
    const txt = el.text()?.trim() || null;
    return txt && txt.length > 0 ? txt : null;
  };

  const getTextByLabel = (labelText: string): string | null => {
    let found: string | null = null;
    $("tr").each((_, row) => {
      if (found) return;
      const tds = $(row).children("td");
      if (tds.length < 2 || tds.length > 4) return;
      tds.each((i, td) => {
        if (found) return;
        const cellText = $(td).text().trim();
        if (cellText.includes(labelText) && cellText.length < 100) {
          const nextTd = tds.eq(i + 1);
          if (nextTd.length > 0) {
            const val = nextTd.find("span").first().text().trim() || nextTd.text().trim();
            if (val && val.length > 0 && val !== cellText) {
              found = val;
            }
          }
        }
      });
    });
    return found;
  };

  let nup = getText("ctl00_conteudo_lblNup");
  let areaText = getText("ctl00_conteudo_lblArea");
  let fase = getText("ctl00_conteudo_lblTipoFase");
  let ativoText = getText("ctl00_conteudo_lblAtivo");
  let distrito = getText("ctl00_conteudo_lblDistrito");
  let uf = getText("ctl00_conteudo_lblUF");
  let unidadeProtocolizadora = getText("ctl00_conteudo_lblUnidadeProtocolizadora");
  let dataProtocolo = getText("ctl00_conteudo_lblDataProtocolo");
  let dataPrioridade = getText("ctl00_conteudo_lblDataPrioridade");
  let tipoRequerimento = getText("ctl00_conteudo_lblTipoRequerimento");
  let cadastroEmpresa = getText("ctl00_conteudo_lblNumeroProcessoCadastroEmpresa");

  if (!nup) nup = getTextByLabel("NUP:");
  if (!fase) fase = getTextByLabel("Fase atual:");
  if (!ativoText) ativoText = getTextByLabel("Ativo:");
  if (!distrito) distrito = getTextByLabel("Superintend");
  if (!uf) uf = getTextByLabel("UF:");
  if (!unidadeProtocolizadora) unidadeProtocolizadora = getTextByLabel("Unidade protocolizadora:");
  if (!dataProtocolo) dataProtocolo = getTextByLabel("Data Protocolo:");
  if (!dataPrioridade) dataPrioridade = getTextByLabel("Data Prioridade:");
  if (!tipoRequerimento) tipoRequerimento = getTextByLabel("Tipo de requerimento:");
  if (!areaText) areaText = getTextByLabel("Área (ha):");

  let titularNome: string | null = null;
  let titularCnpj: string | null = null;
  let titularCpf: string | null = null;

  const pessoaTable = $("table").filter((_, el) => {
    return $(el).text().includes("Pessoa") || $(el).text().includes("CNPJ") || $(el).text().includes("CPF");
  });

  if (pessoaTable.length > 0) {
    const rows = pessoaTable.find("tr");
    rows.each((_, row) => {
      const cells = $(row).find("td, th");
      cells.each((_, cell) => {
        const text = $(cell).text().trim();
        if (!titularCnpj) {
          const cnpj = extractCnpj(text);
          if (cnpj) titularCnpj = cnpj;
        }
        if (!titularCpf) {
          const cpf = extractCpf(text);
          if (cpf && cpf.length === 11) titularCpf = cpf;
        }
      });
    });
  }

  // Tabela "Pessoas relacionadas": linhas no formato
  // [Tipo de Relação | CPF/CNPJ | Nome | ...]. Pega a primeira linha de dados
  // (célula com CNPJ/CPF válido) e usa a célula seguinte como nome.
  if (!titularNome || !titularCnpj) {
    $("tr").each((_, row) => {
      if (titularNome && (titularCnpj || titularCpf)) return false;
      const cells = $(row).children("td");
      for (let i = 0; i < cells.length; i++) {
        const cellText = $(cells[i]).text().trim();
        const cnpj = extractCnpj(cellText);
        const cpf = !cnpj ? extractCpf(cellText) : null;
        // O SCM mascara CPF/CNPJ com asteriscos (ex.: "***.211.736-**") —
        // a célula ainda identifica a coluna de documento.
        const maskedDoc = !cnpj && !cpf &&
          /^[\d*]{2,3}\.[\d*]{3}\.[\d*]{3}(?:\/[\d*]{4})?-[\d*]{2}$/.test(cellText);
        if (cnpj || (cpf && cpf.length === 11) || maskedDoc) {
          const nome = cells.length > i + 1 ? $(cells[i + 1]).text().replace(/\u00a0/g, " ").trim() : "";
          if (nome && nome.length > 2 && !/^\d/.test(nome)) {
            if (!titularNome) titularNome = nome;
            if (cnpj && !titularCnpj) titularCnpj = cnpj;
            if (cpf && !titularCpf) titularCpf = cpf;
            return false;
          }
        }
      }
    });
  }

  if (cadastroEmpresa) {
    if (!titularCnpj) titularCnpj = extractCnpj(cadastroEmpresa);
    if (!titularCpf) titularCpf = extractCpf(cadastroEmpresa);
  }

  const contentDiv = $("#ctl00_conteudo_upProcesso");
  const contentText = contentDiv.length > 0 ? contentDiv.text() : "";
  if (!titularCnpj && contentText) titularCnpj = extractCnpj(contentText);

  const nomeSpans = ["ctl00_conteudo_lblNomePessoa", "ctl00_conteudo_lblNome", "ctl00_conteudo_lblRazaoSocial"];
  for (const spanId of nomeSpans) {
    const val = getText(spanId);
    if (val) { titularNome = val; break; }
  }

  if (!titularNome) {
    const gridView = $("#ctl00_conteudo_gridPessoas");
    if (gridView.length > 0) {
      const firstRow = gridView.find("tr").eq(1);
      if (firstRow.length > 0) {
        const cells = firstRow.find("td");
        if (cells.length > 0) {
          titularNome = cells.first().text().trim() || null;
        }
      }
    }
  }

  const tipoPessoa = titularNome ? detectTipoPessoa(titularNome) : null;

  let areaHa: number | null = null;
  if (areaText) {
    const cleaned = areaText.replace(/\./g, "").replace(",", ".");
    const num = parseFloat(cleaned);
    if (!isNaN(num)) areaHa = num;
  }

  return {
    titularNome,
    titularCnpj,
    titularCpf,
    tipoPessoa,
    cadastroEmpresa,
    nup,
    fase,
    areaHa,
    uf,
    distrito,
    tipoRequerimento,
    unidadeProtocolizadora,
    dataProtocolo,
    dataPrioridade,
    statusAtivo: ativoText ? ativoText.toLowerCase().includes("sim") || ativoText.toLowerCase().includes("ativo") : true,
  };
}

async function upsertProcesso(data: any) {
  // Chaveia por (numero, ano) para cobrir registros legados salvos com chave
  // textual em outro formato (ex.: "831.522/1984" vs "831522/1984").
  const existing = await db.select().from(scmProcessos).where(
    and(eq(scmProcessos.numero, data.numero), eq(scmProcessos.ano, data.ano))
  );

  if (existing.length > 0) {
    // Remove duplicatas legadas antes de normalizar a chave textual
    for (const dup of existing.slice(1)) {
      await db.delete(scmProcessos).where(eq(scmProcessos.id, dup.id));
    }
    await db.update(scmProcessos).set({
      processo: data.processo,
      titularNome: data.titularNome,
      titularCnpj: data.titularCnpj,
      titularCpf: data.titularCpf,
      tipoPessoa: data.tipoPessoa,
      cadastroEmpresa: data.cadastroEmpresa,
      nup: data.nup,
      fase: data.fase,
      areaHa: data.areaHa,
      uf: data.uf,
      distrito: data.distrito,
      tipoRequerimento: data.tipoRequerimento,
      unidadeProtocolizadora: data.unidadeProtocolizadora,
      dataProtocolo: data.dataProtocolo,
      dataPrioridade: data.dataPrioridade,
      statusAtivo: data.statusAtivo,
      rawHtml: data.rawHtml || null,
      consultadoEm: new Date(),
      updatedAt: new Date(),
    }).where(eq(scmProcessos.id, existing[0].id));
  } else {
    await db.insert(scmProcessos).values({
      processo: data.processo,
      numero: data.numero,
      ano: data.ano,
      titularNome: data.titularNome,
      titularCnpj: data.titularCnpj,
      titularCpf: data.titularCpf,
      tipoPessoa: data.tipoPessoa,
      cadastroEmpresa: data.cadastroEmpresa,
      nup: data.nup,
      fase: data.fase,
      areaHa: data.areaHa,
      uf: data.uf,
      distrito: data.distrito,
      tipoRequerimento: data.tipoRequerimento,
      unidadeProtocolizadora: data.unidadeProtocolizadora,
      dataProtocolo: data.dataProtocolo,
      dataPrioridade: data.dataPrioridade,
      statusAtivo: data.statusAtivo,
      rawHtml: data.rawHtml || null,
      consultadoEm: new Date(),
    });
  }
}

/**
 * Best-effort: extrai a tabela de eventos do processo do HTML bruto do SCM em
 * cache, SE a página mesclada da consulta já a contiver (o painel "Eventos"
 * não é solicitado pelo scraper — nenhuma outra fonte alimenta eventos hoje).
 * Heurística conservadora: só tabelas que mencionam "evento" e têm cabeçalho
 * com coluna de descrição/evento E coluna de data. Datas saem como ISO com
 * meio-dia local ("yyyy-mm-ddT12:00:00") para render estável em qualquer fuso.
 */
export function parseEventosScmHtml(html: string): Array<{ data: string | null; descricao: string }> {
  const eventos: Array<{ data: string | null; descricao: string }> = [];
  if (!html || !/evento/i.test(html)) return eventos;
  const $ = cheerio.load(html);
  $("table").each((_, tbl) => {
    const $tbl = $(tbl);
    if (!/evento/i.test($tbl.text())) return;
    const rows = $tbl.find("tr").toArray();
    if (rows.length < 2) return;
    // localiza a linha de cabeçalho (descrição/evento + data) nas primeiras linhas
    let headerIdx = -1;
    let colDesc = -1;
    let colData = -1;
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const cells = $(rows[i]).find("th, td").toArray()
        .map((cel) => $(cel).text().replace(/\s+/g, " ").trim());
      let di = cells.findIndex((t) => /descri[cç][aã]o/i.test(t));
      if (di === -1) di = cells.findIndex((t) => /^eventos?$/i.test(t));
      const ti = cells.findIndex((t, idx) => idx !== di && /data/i.test(t));
      if (di !== -1 && ti !== -1) {
        headerIdx = i;
        colDesc = di;
        colData = ti;
        break;
      }
    }
    if (headerIdx === -1) return;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const cells = $(rows[i]).find("td").toArray()
        .map((cel) => $(cel).text().replace(/\s+/g, " ").trim());
      if (cells.length <= Math.max(colDesc, colData)) continue;
      const descricao = cells[colDesc] || "";
      // pula repetições de cabeçalho e células sem texto real
      if (!descricao || /descri[cç][aã]o/i.test(descricao) || !/[a-zA-ZÀ-ú]/.test(descricao)) continue;
      const m = (cells[colData] || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
      eventos.push({
        data: m ? `${m[3]}-${m[2]}-${m[1]}T12:00:00` : null,
        descricao,
      });
    }
  });
  // dedupe (tabelas aninhadas do layout ASP.NET repetem linhas)
  const vistos = new Set<string>();
  return eventos.filter((e) => {
    const k = `${e.data}|${e.descricao}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

/**
 * Um registro só vale como "consulta SCM" se tiver algum dado real do processo.
 * Registros raspados de páginas sem dados (bug antigo) não contam.
 */
function hasRealScmData(row: any): boolean {
  return !!(row && (
    row.titularNome || row.titularCnpj || row.titularCpf ||
    row.nup || row.fase || row.areaHa || row.uf ||
    row.dataProtocolo || row.dataPrioridade || row.tipoRequerimento
  ));
}

export async function getProcessoFromCache(processo: string) {
  const norm = normalizeProcesso(processo);
  if (!norm) return null;
  // Busca por (numero, ano) para achar registros legados com chave textual
  // em qualquer formato (com/sem pontos, com/sem zeros à esquerda).
  const rows = await db.select().from(scmProcessos).where(
    and(eq(scmProcessos.numero, norm.numero), eq(scmProcessos.ano, norm.ano))
  );
  let valid: typeof rows[number] | null = null;
  for (const row of rows) {
    if (hasRealScmData(row)) {
      if (!valid) valid = row;
    } else {
      // Higiene: remove registros inválidos para não aparecerem como consulta
      console.log(`[SCM] Removendo registro sem dados reais do cache: ${row.processo}`);
      await db.delete(scmProcessos).where(eq(scmProcessos.id, row.id));
    }
  }
  return valid;
}

export async function getProcessosByTitularCnpj(cnpj: string) {
  const clean = cnpj.replace(/\D/g, "");
  const rows = await db.select().from(scmProcessos).where(eq(scmProcessos.titularCnpj, clean));
  return rows;
}

export function cleanScmHtmlForDocument(rawHtml: string, processo: string, consultadoEm?: Date | null): string {
  const $ = cheerio.load(rawHtml);

  $("#barra-brasil").remove();
  $("#ctl00_upCarregando").remove();
  $("#ctl00_conteudo_trCaptcha").remove();
  $("tr#ctl00_conteudo_trCaptcha").remove();
  $("#ctl00_conteudo_sumarioConsultar").remove();
  $("#ctl00_conteudo_ValidationSummary1").remove();
  $("input[type='hidden']").remove();
  $("input[type='submit']").remove();
  $("input[type='text']").remove();
  $("script").remove();
  $("link[rel='stylesheet']").remove();
  $("style").remove();

  $("div.progress, div.modalPopup").remove();
  $("#footer").remove();
  $(".hideWhenPrinting").remove();
  $(".topoANM").remove();
  $("#tbMenu").remove();

  $("table").each((_, el) => {
    const t = $(el);
    if (t.find("#ctl00_cabecalho_menu").length > 0 || t.find("a[href*='Default.aspx']").length > 0 || t.find("img[src*='Logo']").length > 0) {
      t.remove();
    }
  });

  const breadcrumb = $("#ctl00_SiteMapPath2");
  if (breadcrumb.length) breadcrumb.closest("div").remove();

  $("tr.LinhaClara, tr.LinhaEscura").each((_, el) => {
    $(el).removeAttr("style");
    const tds = $(el).find("td");
    if (tds.length === 2) {
      const valTd = tds.eq(1);
      const span = valTd.find("span");
      if (span.length && !span.text().trim()) {
        const txt = valTd.text().trim();
        if (!txt) $(el).remove();
      }
    }
  });

  $("form").each((_, el) => {
    $(el).replaceWith($(el).html() || "");
  });

  $("img").each((_, el) => {
    const src = $(el).attr("src") || "";
    if (src.includes(".gif") || src.includes("WebResource") || src.includes("ScriptResource") || src.includes("Logo_ANM")) {
      $(el).remove();
    }
  });

  $("*").contents().filter(function() {
    return this.type === "comment";
  }).remove();

  const consultadoStr = consultadoEm
    ? new Date(consultadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : "—";

  const dataTable = $("#ctl00_conteudo_upProcesso");
  let cleanedBody: string;
  if (dataTable.length > 0) {
    cleanedBody = dataTable.html() || "";
  } else {
    cleanedBody = $("body").html() || $.html();
  }
  cleanedBody = cleanedBody.replace(/style\s*=\s*["'][^"']*display\s*:\s*none[^"']*["']/gi, "");
  cleanedBody = cleanedBody.replace(/style\s*=\s*["'][^"']*background-image\s*:\s*url\([^)]*\.gif[^)]*\)[^"']*["']/gi, "");
  cleanedBody = cleanedBody.replace(/style\s*=\s*["'][^"']*background\s*:\s*url\([^)]*\.gif[^)]*\)[^"']*["']/gi, "");
  cleanedBody = cleanedBody.replace(/\n\s*\n\s*\n/g, "\n\n");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Consulta SCM — Processo ${processo}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; margin: 20px; color: #333; background: #fff; }
    .doc-header { background: #1a5632; color: #fff; padding: 16px 24px; margin: -20px -20px 20px -20px; }
    .doc-header h1 { margin: 0; font-size: 18px; font-weight: 600; }
    .doc-header p { margin: 4px 0 0; font-size: 12px; opacity: 0.85; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
    td { padding: 6px 10px; vertical-align: top; font-size: 13px; border-bottom: 1px solid #e0e0e0; }
    tr.TituloTabela td, .TituloTabela td { background: #2e7d4f; color: #fff; font-weight: bold; font-size: 13px; padding: 8px 10px; }
    tr.LinhaClara td { background: #fafafa; }
    tr.LinhaEscura td { background: #f0f0f0; }
    td:first-child { font-weight: 600; color: #555; width: 180px; white-space: nowrap; }
    .BordaTabela { border: 1px solid #ccc; border-radius: 4px; overflow: hidden; }
    .doc-footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 11px; color: #999; }
    a { color: #1a5632; }
    span { font-weight: normal; }
  </style>
</head>
<body>
  <div class="doc-header">
    <h1>Consulta SCM — Processo ${processo}</h1>
    <p>Agência Nacional de Mineração (ANM) · Sistema de Cadastro Mineiro</p>
  </div>
  ${cleanedBody}
  <div class="doc-footer">
    Documento gerado por Mavrion Connect · Consultado em: ${consultadoStr}
  </div>
</body>
</html>`;
}

export async function getScmStatus() {
  const allRows = await db.select().from(scmProcessos);
  const total = allRows.length;
  const comCnpj = allRows.filter(r => r.titularCnpj).length;
  const porUf: Record<string, number> = {};
  let ultimaConsulta: Date | null = null;
  for (const r of allRows) {
    if (r.uf) porUf[r.uf] = (porUf[r.uf] || 0) + 1;
    if (r.consultadoEm && (!ultimaConsulta || r.consultadoEm > ultimaConsulta)) {
      ultimaConsulta = r.consultadoEm;
    }
  }
  return { total, comCnpj, semCnpj: total - comCnpj, porUf, ultimaConsulta };
}
