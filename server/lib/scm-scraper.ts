import * as cheerio from "cheerio";
import { db } from "../db";
import { scmProcessos } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const SCM_BASE = "https://sistemas.anm.gov.br/SCM/Extra/site/admin";
const SESSION_TTL_MS = 2 * 60 * 1000;

interface CaptchaSession {
  sessionId: string;
  userId: number;
  processo: string;
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
}, 60_000);

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

function extractCnpj(text: string): string | null {
  if (!text) return null;
  const match = text.match(/(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/);
  if (match) return match[1].replace(/\D/g, "");
  return null;
}

function extractCpf(text: string): string | null {
  if (!text) return null;
  const match = text.match(/(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/);
  if (match) return match[1].replace(/\D/g, "");
  return null;
}

function parseProcesso(processo: string): { numero: number; ano: number } | null {
  const clean = processo.replace(/\s/g, "").replace(/\./g, "");
  const m = clean.match(/^(\d+)\/(\d{4})$/);
  if (!m) return null;
  return { numero: parseInt(m[1], 10), ano: parseInt(m[2], 10) };
}

export async function initSession(processo: string, userId: number): Promise<{
  sessionId: string;
  captchaImageUrl: string;
  processo: string;
  expiresIn: number;
}> {
  const url = `${SCM_BASE}/dadosProcesso.aspx?ID=${encodeURIComponent(processo)}`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

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

  const imgUrl = `${SCM_BASE}/CaptchaImage.aspx?guid=${captchaGuid}`;
  const imgResp = await fetch(imgUrl, {
    headers: {
      "Cookie": cookies,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": `${SCM_BASE}/dadosProcesso.aspx`,
    },
  });
  if (!imgResp.ok) {
    throw new Error("Falha ao buscar imagem do captcha do SCM");
  }
  const captchaImageBuffer = Buffer.from(await imgResp.arrayBuffer());

  const sessionId = randomUUID();
  const session: CaptchaSession = {
    sessionId,
    userId,
    processo,
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
    processo,
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
  formData.set("ctl00$conteudo$txtNumeroProcesso", session.processo);
  formData.set("ctl00$conteudo$CaptchaControl1", captchaText.toUpperCase());
  formData.set("ctl00$conteudo$btnConsultarProcesso", "Consultar");

  const url = `${SCM_BASE}/dadosProcesso.aspx?ID=${encodeURIComponent(session.processo)}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": session.cookies,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": url,
    },
    body: formData.toString(),
    redirect: "follow",
  });

  let html = await resp.text();

  if (!resp.ok) {
    activeSessions.delete(sessionId);
    if (html.includes("viewstate MAC failed") || html.includes("Validation of viewstate") || html.includes("Invalid postback")) {
      return { success: false, error: "captcha_invalido" };
    }
    console.error("[SCM] POST falhou com status", resp.status, "body:", html.substring(0, 300));
    return { success: false, error: "scm_indisponivel" };
  }

  const valSummary = html.match(/ValidationSummary1[^>]*>([\s\S]*?)<\/div>/i);
  const valText = valSummary ? valSummary[1].replace(/<[^>]*>/g, '').trim() : "";
  if (valText) {
    console.log("[SCM] Validation message:", valText);
  }

  if (valText.includes("não confere") || valText.includes("codigo") || valText.includes("código")) {
    return { success: false, error: "captcha_invalido" };
  }
  if (valText.includes("muito r") || valText.includes("Aguarde")) {
    return { success: false, error: "captcha_rapido" };
  }

  const extractHiddenFieldFromHtml = (h: string, name: string): string => {
    const tagPattern = new RegExp(`<input[^>]*(?:id|name)=["']${name}["'][^>]*>`, "i");
    const tagMatch = h.match(tagPattern);
    if (!tagMatch) return "";
    const valMatch = tagMatch[0].match(/value=["']([^"']*)["']/i);
    return valMatch ? valMatch[1] : "";
  };

  if (html.includes("btnDadosBasicos")) {
    console.log("[SCM] Captcha accepted, clicking 'Dados básicos' for full data...");
    const formData2 = new URLSearchParams();
    formData2.set("__EVENTTARGET", "");
    formData2.set("__EVENTARGUMENT", "");
    formData2.set("__VIEWSTATE", extractHiddenFieldFromHtml(html, "__VIEWSTATE"));
    formData2.set("__VIEWSTATEGENERATOR", extractHiddenFieldFromHtml(html, "__VIEWSTATEGENERATOR"));
    formData2.set("__VIEWSTATEENCRYPTED", "");
    formData2.set("__EVENTVALIDATION", extractHiddenFieldFromHtml(html, "__EVENTVALIDATION"));
    formData2.set("ctl00$conteudo$txtNumeroProcesso", session.processo);
    formData2.set("ctl00$conteudo$btnDadosBasicos", "Dados básicos");

    const resp2 = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": session.cookies,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": url,
      },
      body: formData2.toString(),
      redirect: "follow",
    });

    if (resp2.ok) {
      html = await resp2.text();
      console.log("[SCM] 'Dados básicos' response received");
    } else {
      console.log("[SCM] 'Dados básicos' POST failed with status", resp2.status, "- using initial response");
    }
  }

  const parsed = parseScmHtml(html);

  activeSessions.delete(sessionId);

  const processoParsed = parseProcesso(session.processo);
  if (!processoParsed) {
    return { success: false, error: "processo_invalido" };
  }

  const data = {
    processo: session.processo,
    numero: processoParsed.numero,
    ano: processoParsed.ano,
    consultadoPor: userId,
    ...parsed,
  };

  await upsertProcesso(data);

  return { success: true, data };
}

function parseScmHtml(html: string): {
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
    const el = $(`#${id}`);
    const txt = el.text()?.trim() || null;
    return txt && txt.length > 0 ? txt : null;
  };

  const nup = getText("ctl00_conteudo_lblNup");
  const areaText = getText("ctl00_conteudo_lblArea");
  const fase = getText("ctl00_conteudo_lblTipoFase");
  const ativoText = getText("ctl00_conteudo_lblAtivo");
  const distrito = getText("ctl00_conteudo_lblDistrito");
  const uf = getText("ctl00_conteudo_lblUF");
  const unidadeProtocolizadora = getText("ctl00_conteudo_lblUnidadeProtocolizadora");
  const dataProtocolo = getText("ctl00_conteudo_lblDataProtocolo");
  const dataPrioridade = getText("ctl00_conteudo_lblDataPrioridade");
  const tipoRequerimento = getText("ctl00_conteudo_lblTipoRequerimento");
  const cadastroEmpresa = getText("ctl00_conteudo_lblNumeroProcessoCadastroEmpresa");

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

  if (cadastroEmpresa) {
    if (!titularCnpj) titularCnpj = extractCnpj(cadastroEmpresa);
    if (!titularCpf) titularCpf = extractCpf(cadastroEmpresa);
  }

  const allText = $.text();
  if (!titularCnpj) titularCnpj = extractCnpj(allText);

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
  const existing = await db.select().from(scmProcessos).where(eq(scmProcessos.processo, data.processo)).limit(1);

  if (existing.length > 0) {
    await db.update(scmProcessos).set({
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
      consultadoEm: new Date(),
      updatedAt: new Date(),
    }).where(eq(scmProcessos.processo, data.processo));
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
      consultadoEm: new Date(),
    });
  }
}

export async function getProcessoFromCache(processo: string) {
  const rows = await db.select().from(scmProcessos).where(eq(scmProcessos.processo, processo)).limit(1);
  return rows[0] || null;
}

export async function getProcessosByTitularCnpj(cnpj: string) {
  const clean = cnpj.replace(/\D/g, "");
  const rows = await db.select().from(scmProcessos).where(eq(scmProcessos.titularCnpj, clean));
  return rows;
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
