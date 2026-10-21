import type { Express } from "express";
import { getCached, setCached } from "../cache";
import OpenAI from "openai";
import { db } from "../db";
import { companies, assets } from "@shared/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import { getOrgId } from "../lib/tenant";
import { buildDossieDigest } from "../lib/dossie-digest";
import { buildDocsAnexadosSection } from "../lib/ai-agents";
import { getProcessoFromCache } from "../lib/scm-scraper";
import { getTahByProcesso } from "../lib/tah-importer";
import { getEventosByProcesso } from "../lib/anm-eventos-importer";
import { filtrarEventosReais } from "../lib/relatorio-vinculos";
import { separarPublicacoesDiario, separarBarragensTitular, avisoCertidoesVinculo, montarIdentificadorCnpj, cnpjVinculoConfirmado, descreverProveniencia, provenienciaCnpj } from "../lib/consulta-contrato";
import { consultarRestricoesCruzamento } from "../lib/restricoes-cruzamento";
import {
  anexarVigenciaCalculada,
  formatarVigenciaParaPrompt,
  hashInsumosVigenciaDoAtivo,
  omitirTrechosDeVigenciaParaIa,
  obterVigenciaCalculada,
  type ResultadoVigenciaAlvara,
} from "../lib/vigencia-alvara";

const cnpjaHeaders = () => ({
  "Authorization": process.env.CNPJA_API_KEY || "",
});

function isValidCnpj(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;
  const calc = (slice: string, weights: number[]) => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += parseInt(slice[i]) * weights[i];
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };
  const w1 = [5,4,3,2,9,8,7,6,5,4,3,2];
  const w2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
  const d1 = calc(digits, w1);
  const d2 = calc(digits, w2);
  return parseInt(digits[12]) === d1 && parseInt(digits[13]) === d2;
}

let _openai: OpenAI | null = null;
function getSmartOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const PESSOA_JURIDICA_SUFFIXES = [
  "LTDA", "S/A", "S.A.", "SA", "ME", "EIRELI", "EPP", "EIRELLI",
  "MINERACAO", "MINERAÇÃO", "INDUSTRIA", "INDÚSTRIA", "COMERCIO",
  "COMÉRCIO", "ENGENHARIA", "CONSTRUTORA", "EMPREENDIMENTOS",
  "PARTICIPACOES", "PARTICIPAÇÕES", "HOLDINGS", "HOLDING",
  "COOPERATIVA", "ASSOCIACAO", "ASSOCIAÇÃO", "FUNDACAO", "FUNDAÇÃO",
  "INSTITUTO", "GRUPO", "CIA", "COMPANHIA",
];

function isPessoaFisica(nome: string): boolean {
  if (!nome) return false;
  const upper = nome.toUpperCase().trim();
  for (const suffix of PESSOA_JURIDICA_SUFFIXES) {
    if (upper.includes(suffix)) return false;
  }
  const parts = upper.split(/\s+/).filter(p => p.length > 1);
  if (parts.length >= 2 && parts.length <= 5) {
    const hasCommonPrepositions = parts.some(p => ["DE", "DA", "DO", "DOS", "DAS", "E"].includes(p));
    const allAlpha = parts.every(p => /^[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÜÇ]+$/.test(p));
    if (allAlpha && (parts.length >= 3 || hasCommonPrepositions || parts.length === 2)) {
      return true;
    }
  }
  return false;
}

import { fetchAnmProcessoAttrsFallback } from "../lib/anm-fallback";
import { storage } from "../storage";

// Resolução automática de CNPJ via CNPJA por nome (sem IA): só aceita match inequívoco
async function resolveCnpjViaCnpjaAuto(nome: string, uf?: string | null): Promise<{ cnpj: string; razaoSocial: string | null } | null> {
  if (!process.env.CNPJA_API_KEY || !nome || nome.trim().length < 3) return null;
  try {
    const searchParams = new URLSearchParams({
      "names.in": nome.trim(),
      "status.id.in": "2",
      "limit": "10",
    });
    if (uf) searchParams.set("address.state.in", uf.toUpperCase());
    const resp = await fetchWithTimeout(`https://api.cnpja.com/office?${searchParams.toString()}`, 15000, { headers: cnpjaHeaders() });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    let records: any[] = data.records || [];
    if (records.length === 0 && uf) {
      // busca ampliada sem filtro de UF
      const broadParams = new URLSearchParams({ "names.in": nome.trim(), "status.id.in": "2", "limit": "5" });
      const broadResp = await fetchWithTimeout(`https://api.cnpja.com/office?${broadParams.toString()}`, 15000, { headers: cnpjaHeaders() });
      if (broadResp.ok) {
        const broadData = await broadResp.json() as any;
        records = broadData.records || [];
      }
      if (records.length !== 1) records = records.length ? records : [];
    }
    let chosen: any = chooseCnpjaCandidate(nome, records);
    if (records.length > 1) {
      if (!chosen && process.env.OPENAI_API_KEY) {
        // Empresas realmente distintas: desambiguar com IA (mesmo critério do smart-resolve)
        try {
          const candidatesText = records.map((r: any, i: number) =>
            `${i + 1}. ${r.company?.name || "?"} | CNPJ: ${r.taxId} | ${r.mainActivity?.text || "?"} | ${r.address?.city || "?"}-${r.address?.state || "?"} | Status: ${r.status?.text || "?"}`
          ).join("\n");
          const openai = getSmartOpenAI();
          const aiResp = await openai.chat.completions.create({
            model: "gpt-5.4-mini",
            messages: [
              { role: "system", content: `Você é um especialista em mineração brasileira. Determine qual empresa candidata é a mais provável de ser o titular do processo minerário ANM. Responda APENAS com JSON: {"index": <número 1-based ou 0 se nenhuma>, "confidence": <"alta"|"media"|"baixa">}` },
              { role: "user", content: `Titular ANM: ${nome}${uf ? `\nUF do processo: ${uf}` : ""}\n\nCandidatas:\n${candidatesText}` },
            ],
            temperature: 0.1,
            max_completion_tokens: 120,
          });
          const jsonMatch = (aiResp.choices[0]?.message?.content || "").match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.index > 0 && parsed.index <= records.length && parsed.confidence !== "baixa") {
              chosen = records[parsed.index - 1];
            }
          }
        } catch (aiErr: any) {
          console.warn("[ANM Titular] AI disambiguation error:", aiErr.message);
        }
      }
    }
    if (chosen?.taxId && isValidCnpj(chosen.taxId)) {
      return { cnpj: chosen.taxId.replace(/\D/g, ""), razaoSocial: chosen.company?.name || null };
    }
  } catch (err: any) {
    console.warn("[ANM Titular] CNPJA auto-resolve error:", err.message);
  }
  return null;
}

// Seleção determinística de candidato CNPJA (sem IA):
// - registro único: usa direto;
// - todos com a MESMA raiz de CNPJ (matriz+filiais): escolhe a matriz (head) — precisa vir ANTES do
//   match exato por nome, pois filiais compartilham a razão social e o match exato escolheria uma
//   filial arbitrária em vez da matriz;
// - raízes distintas: só match exato de razão social.
export function chooseCnpjaCandidate(nome: string, records: any[]): any | null {
  if (records.length === 0) return null;
  if (records.length === 1) return records[0];
  const roots = new Set(records.map((r: any) => String(r.taxId || "").slice(0, 8)));
  if (roots.size === 1) {
    return records.find((r: any) => r.head === true) || records[0];
  }
  const nameUpper = nome.toUpperCase().trim();
  return records.find((r: any) => (r.company?.name || "").toUpperCase().trim() === nameUpper) || null;
}

// assetId vindo do cliente precisa ser inteiro positivo seguro
export function parseAssetId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// Controle de acesso: só a organização dona do ativo (ou ativos sem org, legado) pode ser alterada
export function canWriteAsset(assetOrgId: number | null | undefined, requesterOrgId: number): boolean {
  return assetOrgId == null || assetOrgId === requesterOrgId;
}

// Persiste o CNPJ do titular em campos_especificos.anmTitular do ativo (merge profundo do sub-objeto)
export async function persistTitularCnpjOnAsset(assetId: number, requesterOrgId: number, cnpj: string, cnpjFonte: string, nomeTitular?: string | null): Promise<void> {
  try {
    const asset = await storage.getAsset(assetId);
    if (!asset) return;
    if (!canWriteAsset(asset.orgId, requesterOrgId)) {
      console.warn(`[ANM Titular] Bloqueado: ativo ${assetId} pertence a outra organização (org ${asset.orgId} != ${requesterOrgId})`);
      return;
    }
    const campos = (asset.camposEspecificos as any) || {};
    const existing = campos.anmTitular || {};
    const existingTitular = existing.titular || {};
    if (existingTitular.cnpj === cnpj) return;
    const anmTitular = {
      ...existing,
      titular: {
        ...existingTitular,
        nome: existingTitular.nome || nomeTitular || null,
        cnpj,
        cnpjFonte,
      },
    };
    await storage.mergeAssetCampos(assetId, { anmTitular });
    console.log(`[ANM Titular] CNPJ ${cnpj} (${cnpjFonte}) persistido no ativo ${assetId}`);
  } catch (err: any) {
    console.warn(`[ANM Titular] Erro ao persistir CNPJ no ativo ${assetId}:`, err.message);
  }
}

const ANM_MAPSERVER_URL = "https://geo.anm.gov.br/arcgis/rest/services/SIGMINE/dados_anm/MapServer/0/query";
const MAVRION_API_URL = "https://api.mavrionconnect.com.br";
const MAVRION_API_KEY = process.env.MAVRION_API_KEY || "";

const MINERAL_SYMBOLS: Record<string, string> = {
  "OURO": "XAU",
  "PRATA": "XAG",
  "COBRE": "HG",
  "NIQUEL": "NICKEL",
  "NÍQUEL": "NICKEL",
  "FERRO": "IRON_ORE",
  "ALUMINIO": "ALUMINUM",
  "ALUMÍNIO": "ALUMINUM",
  "ZINCO": "ZINC",
  "ESTANHO": "TIN",
  "CHUMBO": "LEAD",
  "MANGANES": "MANGANESE",
  "MANGANÊS": "MANGANESE",
  "PLATINA": "XPT",
  "PALADIO": "XPD",
  "PALÁDIO": "XPD",
  "NIOBIO": "NIOBIUM",
  "NIÓBIO": "NIOBIUM",
  "LITIO": "LITHIUM",
  "LÍTIO": "LITHIUM",
  "TITANIO": "TITANIUM",
  "TITÂNIO": "TITANIUM",
  "CROMO": "CHROMIUM",
  "TUNGSTENIO": "TUNGSTEN",
  "TUNGSTÊNIO": "TUNGSTEN",
  "COBALTO": "COBALT",
  "MOLIBDENIO": "MOLYBDENUM",
  "MOLIBDÊNIO": "MOLYBDENUM",
  "URANIO": "URANIUM",
  "URÂNIO": "URANIUM",
};

const METALS_PRICES_FALLBACK: Record<string, { usd: number; unit: string }> = {
  "XAU": { usd: 2650, unit: "oz" },
  "XAG": { usd: 31, unit: "oz" },
  "HG": { usd: 4.2, unit: "lb" },
  "NICKEL": { usd: 16500, unit: "ton" },
  "IRON_ORE": { usd: 110, unit: "ton" },
  "ALUMINUM": { usd: 2400, unit: "ton" },
  "ZINC": { usd: 2800, unit: "ton" },
  "TIN": { usd: 28000, unit: "ton" },
  "LEAD": { usd: 2100, unit: "ton" },
  "MANGANESE": { usd: 4.5, unit: "kg" },
  "XPT": { usd: 1000, unit: "oz" },
  "XPD": { usd: 1100, unit: "oz" },
  "NIOBIUM": { usd: 42, unit: "kg" },
  "LITHIUM": { usd: 12000, unit: "ton" },
  "TITANIUM": { usd: 11, unit: "kg" },
  "CHROMIUM": { usd: 9000, unit: "ton" },
  "TUNGSTEN": { usd: 350, unit: "kg" },
  "COBALT": { usd: 28000, unit: "ton" },
  "MOLYBDENUM": { usd: 45, unit: "kg" },
  "URANIUM": { usd: 85, unit: "lb" },
};

async function fetchWithTimeout(url: string, timeout = 15000, options: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
}

async function proxyToMavrionApi(path: string, timeout = 15000): Promise<any | null> {
  try {
    const resp = await fetchWithTimeout(`${MAVRION_API_URL}${path}`, timeout, {
      headers: { "x-api-key": MAVRION_API_KEY },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export function registerAnmEnrichmentRoutes(app: Express) {
  const ensureAuth = (req: any, res: any, next: any) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    next();
  };

  app.get("/api/anm/historico/:processo", ensureAuth, async (req, res) => {
    try {
      const cleanProcesso = (req.params.processo || "").replace(/[^0-9/]/g, "");
      if (!cleanProcesso || cleanProcesso.length < 3) {
        return res.status(400).json({ message: "Número de processo inválido" });
      }

      // Base local de eventos (dados abertos ANM — microdados SCM): fonte
      // primária do histórico, com a linha do tempo completa do processo.
      // Cache/geoportal só entram quando o processo não está na base.
      try {
        const local = await getEventosByProcesso(cleanProcesso);
        if (local.total > 0) {
          return res.json({
            processo: cleanProcesso,
            eventos: local.eventos.map((e) => ({ descricao: e.descricao, data: e.data, tipo: categorizarEvento(e.descricao) })),
            totalEventos: local.total,
            fonte: local.fonte,
            dataBase: local.dataBase,
          });
        }
      } catch { /* segue para o fallback geoportal */ }

      const cacheKey = `historico:${cleanProcesso}`;
      const cached = await getCached<any>("anm_enrich", cacheKey);
      if (cached && !req.query.refresh) return res.json(cached);

      const params = new URLSearchParams({
        where: `PROCESSO='${cleanProcesso}'`,
        outFields: "PROCESSO,NOME,FASE,SUBS,AREA_HA,UF,ULT_EVENTO,DSProcesso,ANO,USO,ID",
        returnGeometry: "false",
        outSR: "4326",
        f: "json",
      });

      let processo: any | null = null;
      let geoportalOk = false;
      try {
        const response = await fetchWithTimeout(`${ANM_MAPSERVER_URL}?${params.toString()}`);
        if (response.ok) {
          const data = await response.json() as any;
          if (!data.error) {
            geoportalOk = true;
            const features = (data.features || []).map((f: any) => f.attributes || f);
            processo = features[0] || null;
          }
        }
      } catch {}

      if (!geoportalOk) {
        processo = await fetchAnmProcessoAttrsFallback(cleanProcesso);
        if (!processo) {
          return res.status(502).json({ message: "Falha ao consultar o geoportal ANM" });
        }
      }

      let eventos: any[] = [];
      if (processo) {
        const dsProcesso = processo.DSProcesso || processo.DSPROCESSO || "";
        if (dsProcesso) {
          const parts = dsProcesso.split(/[;\n]/).filter((p: string) => p.trim());
          for (const part of parts) {
            const trimmed = part.trim();
            const dateMatch = trimmed.match(/(\d{2}\/\d{2}\/\d{4})/);
            eventos.push({
              descricao: trimmed,
              data: dateMatch ? dateMatch[1] : null,
              tipo: categorizarEvento(trimmed),
            });
          }
        }

        if (processo.ULT_EVENTO && eventos.length === 0) {
          const ultDateMatch = String(processo.ULT_EVENTO).match(/(\d{2}\/\d{2}\/\d{4})/);
          eventos.push({
            descricao: processo.ULT_EVENTO,
            data: ultDateMatch ? ultDateMatch[1] : null,
            tipo: categorizarEvento(processo.ULT_EVENTO),
          });
        }
      }

      // Nunca renderizar o próprio número do processo (ou lixo sem data e sem
      // texto) como "evento" — sem eventos reais, a resposta volta vazia e a
      // seção é ocultada pela UI/PDF.
      eventos = filtrarEventosReais(eventos, cleanProcesso);

      const result = { processo: cleanProcesso, eventos, totalEventos: eventos.length, dadosProcesso: processo };
      await setCached("anm_enrich", cacheKey, result);
      res.json(result);
    } catch (err: any) {
      console.error("[ANM Enrichment] Historico error:", err.message);
      res.status(500).json({ message: "Erro ao consultar histórico ANM" });
    }
  });

  app.get("/api/anm/titular/:processo", ensureAuth, async (req, res) => {
    try {
      const cleanProcesso = (req.params.processo || "").replace(/[^0-9/]/g, "");
      if (!cleanProcesso || cleanProcesso.length < 3) {
        return res.status(400).json({ message: "Número de processo inválido" });
      }

      const assetIdNum = req.query.assetId ? parseAssetId(req.query.assetId) : null;
      const requesterOrgId = getOrgId(req);

      // Consulta SCM já gravada para este processo (tabela scm_processos):
      // fonte oficial verificada por captcha — prioridade sobre TAH/DSProcesso/CNPJA,
      // e garante que o titular resolvido via SCM persista em visitas futuras.
      let scmCnpj: string | null = null;
      let scmNome: string | null = null;
      try {
        const scmCached = await getProcessoFromCache(cleanProcesso);
        if (scmCached?.titularCnpj && isValidCnpj(scmCached.titularCnpj)) {
          scmCnpj = scmCached.titularCnpj.replace(/\D/g, "");
        }
        if (scmCached?.titularNome) scmNome = scmCached.titularNome;
      } catch (scmErr: any) {
        console.warn("[ANM Titular] Erro ao consultar cache SCM:", scmErr.message);
      }

      const cacheKey = `titular:${cleanProcesso}`;
      const cached = await getCached<any>("anm_enrich", cacheKey);
      // Cache com titular sem CNPJ (e nome de empresa) é tratado como incompleto: refaz a consulta para tentar resolver o CNPJ
      const cachedIncomplete = cached?.titular && !cached.titular.cnpj && cached.titular.nome && !isPessoaFisica(cached.titular.nome);
      // Cache anterior à consulta SCM (ou divergente dela) também é refeito
      const cachedScmOutdated = !!(scmCnpj && cached?.titular && cached.titular.cnpj !== scmCnpj);
      if (cached && !req.query.refresh && !cachedIncomplete && !cachedScmOutdated) {
        if (assetIdNum && cached?.titular?.cnpj) {
          await persistTitularCnpjOnAsset(assetIdNum, requesterOrgId, cached.titular.cnpj, cached.titular.cnpjFonte || "cache", cached.titular.nome);
        }
        return res.json(cached);
      }

      const params = new URLSearchParams({
        where: `PROCESSO='${cleanProcesso}'`,
        outFields: "PROCESSO,NOME,FASE,SUBS,AREA_HA,UF,ULT_EVENTO,DSProcesso,ANO,USO,ID",
        returnGeometry: "false",
        f: "json",
      });

      let processo: any | null = null;
      let geoportalOk = false;
      try {
        const response = await fetchWithTimeout(`${ANM_MAPSERVER_URL}?${params.toString()}`);
        if (response.ok) {
          const data = await response.json() as any;
          if (!data.error) {
            geoportalOk = true;
            const features = (data.features || []).map((f: any) => f.attributes || f);
            processo = features[0] || null;
          }
        }
      } catch {}

      if (!geoportalOk) {
        processo = await fetchAnmProcessoAttrsFallback(cleanProcesso);
        if (!processo) {
          // Geoportal e fallback fora do ar, mas a consulta SCM local já tem o
          // titular: responde com ela (sem cachear — resultado sem fase/substância)
          if (scmCnpj || scmNome) {
            const scmResult = {
              processo: cleanProcesso,
              titular: {
                nome: scmNome || "",
                cnpj: scmCnpj,
                cnpjFonte: scmCnpj ? "SCM" : null,
                fase: null,
                substancia: null,
              },
              outrosProcessos: [],
              totalOutrosProcessos: 0,
            };
            if (assetIdNum && scmCnpj) {
              await persistTitularCnpjOnAsset(assetIdNum, requesterOrgId, scmCnpj, "SCM", scmNome);
            }
            return res.json(scmResult);
          }
          // Nem geoportal nem fallback disponíveis — falha operacional, não "sem titular"
          return res.status(502).json({ message: "Falha ao consultar o geoportal ANM" });
        }
      }

      if (!processo) {
        return res.json({ processo: cleanProcesso, titular: null, outrosProcessos: [], cnpj: null });
      }

      const nomeTitular = processo.NOME || scmNome || "";
      let cnpjExtraido: string | null = null;
      let cnpjFonte: string | null = null;

      // 1ª fonte: consulta SCM gravada (verificada via captcha pelo usuário)
      if (scmCnpj) {
        cnpjExtraido = scmCnpj;
        cnpjFonte = "SCM";
        console.log(`[ANM Titular] CNPJ encontrado via consulta SCM para processo ${cleanProcesso}: ${cnpjExtraido}`);
      }

      let tahIndisponivel = false;
      if (!cnpjExtraido) {
        try {
          const tahResult = await getTahByProcesso(cleanProcesso);
          // TAH ambígua (só número-base, sem ano) não pode atribuir CNPJ de outro processo
          const tahData = tahResult.ambiguo ? null : tahResult.registros[0];
          if (tahData?.cnpjCpf && tahData.cnpjCpf.length === 14 && isValidCnpj(tahData.cnpjCpf)) {
            cnpjExtraido = tahData.cnpjCpf;
            cnpjFonte = "TAH";
            console.log(`[ANM Titular] CNPJ encontrado via TAH para processo ${cleanProcesso}: ${cnpjExtraido}`);
          }
        } catch (tahErr: any) {
          // Falha operacional na fonte TAH (download/leitura) — NÃO é "sem TAH".
          // Segue com os outros fallbacks, mas o resultado avisa e não é cacheado.
          tahIndisponivel = true;
          console.warn("[ANM Titular] TAH indisponível (falha de consulta, não ausência):", tahErr.message);
        }
      }

      if (!cnpjExtraido) {
        const dsProcesso = processo.DSProcesso || processo.DSPROCESSO || "";
        const cnpjMatch = dsProcesso.match(/(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/);
        if (cnpjMatch) {
          const candidate = cnpjMatch[1].replace(/\D/g, "");
          if (isValidCnpj(candidate)) {
            cnpjExtraido = candidate;
            cnpjFonte = "DSProcesso";
          } else {
            console.log(`[ANM Titular] Regex encontrou '${cnpjMatch[1]}' mas não é CNPJ válido (dígito verificador inválido)`);
          }
        }
      }

      let outrosProcessos: any[] = [];
      if (nomeTitular && nomeTitular.length > 3) {
        try {
          const searchName = nomeTitular.replace(/'/g, "''");
          const outrosParams = new URLSearchParams({
            where: `NOME='${searchName}'`,
            outFields: "PROCESSO,NOME,FASE,SUBS,AREA_HA,UF,ULT_EVENTO,ANO",
            returnGeometry: "false",
            f: "json",
            resultRecordCount: "50",
          });

          const outrosResp = await fetchWithTimeout(`${ANM_MAPSERVER_URL}?${outrosParams.toString()}`);
          if (outrosResp.ok) {
            const outrosData = await outrosResp.json() as any;
            outrosProcessos = (outrosData.features || [])
              .map((f: any) => f.attributes || f)
              .filter((p: any) => p.PROCESSO !== cleanProcesso);
          }
        } catch {
        }
      }

      // Fallback: resolver CNPJ automaticamente via CNPJA quando ANM/TAH não trouxeram
      if (!cnpjExtraido && nomeTitular && !isPessoaFisica(nomeTitular)) {
        const resolved = await resolveCnpjViaCnpjaAuto(nomeTitular, processo.UF || null);
        if (resolved) {
          cnpjExtraido = resolved.cnpj;
          cnpjFonte = "CNPJA";
          console.log(`[ANM Titular] CNPJ resolvido via CNPJA para '${nomeTitular}': ${cnpjExtraido}`);
        }
      }

      // Proveniência do CNPJ: documento oficial (SCM/TAH/DSProcesso) vs
      // resolução por nome via agregador (CNPJA) — consultas derivadas
      // (certidões) herdam a marca "vinculação não confirmada por documento".
      const identificadorVinculo = cnpjExtraido ? montarIdentificadorCnpj(cnpjExtraido, cnpjFonte) : null;
      const vinculoConfirmadoPorDocumento = identificadorVinculo ? cnpjVinculoConfirmado(identificadorVinculo.proveniencia) : null;
      const result = {
        processo: cleanProcesso,
        titular: {
          nome: nomeTitular,
          cnpj: cnpjExtraido,
          cnpjFonte: cnpjFonte,
          fase: processo.FASE,
          substancia: processo.SUBS,
        },
        ...(identificadorVinculo ? {
          identificadorVinculo,
          vinculoConfirmadoPorDocumento,
          ...(vinculoConfirmadoPorDocumento === false ? {
            avisoVinculo: `CNPJ ${descreverProveniencia(identificadorVinculo.proveniencia)} — risco de homônimo; certidões consultadas com ele herdam "vinculação não confirmada por documento".`,
          } : {}),
        } : {}),
        outrosProcessos,
        totalOutrosProcessos: outrosProcessos.length,
        ...(tahIndisponivel ? {
          tahIndisponivel: true,
          aviso: "A base TAH da ANM não pôde ser consultada agora — a ausência de CNPJ via TAH não é conclusiva.",
        } : {}),
      };

      // Resultado obtido com TAH fora do ar não é cacheado: senão a
      // indisponibilidade momentânea viraria "sem CNPJ" persistente
      if (!tahIndisponivel) {
        await setCached("anm_enrich", cacheKey, result);
      }

      if (assetIdNum && cnpjExtraido) {
        await persistTitularCnpjOnAsset(assetIdNum, requesterOrgId, cnpjExtraido, cnpjFonte || "desconhecida", nomeTitular);
      }

      res.json(result);
    } catch (err: any) {
      console.error("[ANM Enrichment] Titular error:", err.message);
      res.status(500).json({ message: "Erro ao consultar titular ANM" });
    }
  });

  app.post("/api/anm/smart-resolve-cnpj", ensureAuth, async (req, res) => {
    try {
      const { titularNome, cnpjManual, uf, substancia, fase, processo, assetId } = req.body;
      if (!titularNome || typeof titularNome !== "string" || titularNome.trim().length < 2) {
        return res.status(400).json({ message: "Nome do titular é obrigatório (mínimo 2 caracteres)" });
      }
      if (assetId && isNaN(Number(assetId))) {
        return res.status(400).json({ message: "ID do ativo inválido" });
      }

      const orgId = getOrgId(req);
      const steps: string[] = [];
      let resolvedCnpj: string | null = null;
      let resolvedMethod: string | null = null;
      let pessoaFisica = false;
      let cnpjaCompanyData: any = null;

      let regexAiCnpj: string | null = null;
      let regexAiMethod: string | null = null;

      if (!cnpjManual && processo) {
        try {
          const tahResult = await getTahByProcesso(processo);
          // TAH ambígua (só número-base, sem ano) não pode atribuir CNPJ de outro processo
          const tahData = tahResult.ambiguo ? null : tahResult.registros[0];
          if (tahData?.cnpjCpf && tahData.cnpjCpf.length === 14) {
            if (isValidCnpj(tahData.cnpjCpf)) {
              regexAiCnpj = tahData.cnpjCpf;
              regexAiMethod = "tah_dados_abertos";
              steps.push(`CNPJ encontrado nos Dados Abertos ANM (TAH): ${tahData.cnpjCpf.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}`);
            }
          }
        } catch (tahErr: any) {
          // Falha operacional visível ao usuário: TAH não consultada != TAH sem registro
          console.warn("[Smart CNPJ] TAH indisponível (falha de consulta, não ausência):", tahErr.message);
          steps.push("Aviso: a base TAH da ANM não pôde ser consultada agora (falha de download/leitura) — a ausência de CNPJ via TAH não é conclusiva.");
        }
      }

      if (cnpjManual && typeof cnpjManual === "string") {
        const clean = cnpjManual.replace(/\D/g, "");
        if (clean.length === 14 && isValidCnpj(clean)) {
          regexAiCnpj = clean;
          regexAiMethod = "manual";
          steps.push(`CNPJ informado manualmente: ${clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}`);
        } else if (clean.length === 14) {
          steps.push("CNPJ informado é inválido (dígito verificador incorreto)");
        } else {
          steps.push("CNPJ informado tem formato inválido");
        }
      }

      if (!regexAiCnpj && isPessoaFisica(titularNome)) {
        pessoaFisica = true;
        steps.push("Nome identificado como pessoa física — CNPJ não aplicável");
      }

      if (!regexAiCnpj && !pessoaFisica && process.env.CNPJA_API_KEY) {
        steps.push("Buscando empresa na Receita Federal pelo nome...");
        try {
          const searchParams = new URLSearchParams({
            "names.in": titularNome.trim(),
            "status.id.in": "2",
            "limit": "10",
          });
          if (uf) searchParams.set("address.state.in", uf.toUpperCase());

          const searchUrl = `https://api.cnpja.com/office?${searchParams.toString()}`;
          const searchResp = await fetch(searchUrl, { headers: cnpjaHeaders() });

          if (searchResp.ok) {
            const searchData = await searchResp.json() as any;
            const records: any[] = searchData.records || [];

            if (records.length === 1) {
              regexAiCnpj = records[0].taxId;
              regexAiMethod = "cnpja_name_search_unique";
              cnpjaCompanyData = records[0];
              steps.push(`Empresa encontrada: ${records[0].company?.name || titularNome} (CNPJ: ${regexAiCnpj})`);
            } else if (records.length > 1) {
              // Seleção determinística ANTES da IA: matriz quando todos os candidatos são
              // filiais da mesma raiz de CNPJ (o match por nome/IA escolheria filial arbitrária)
              const deterministic = chooseCnpjaCandidate(titularNome, records);
              if (deterministic) {
                regexAiCnpj = deterministic.taxId;
                regexAiMethod = "cnpja_matriz_ou_nome_exato";
                cnpjaCompanyData = deterministic;
                steps.push(`Empresa selecionada (matriz/razão social exata): ${deterministic.company?.name || titularNome} (CNPJ: ${regexAiCnpj})`);
              } else {
              steps.push(`${records.length} empresas encontradas — analisando com IA...`);

              if (process.env.OPENAI_API_KEY) {
                try {
                  const candidatesText = records.map((r: any, i: number) => {
                    return `${i + 1}. ${r.company?.name || "?"} | CNPJ: ${r.taxId} | ${r.mainActivity?.text || "?"} | ${r.address?.city || "?"}-${r.address?.state || "?"} | Porte: ${r.company?.size?.text || "?"} | Status: ${r.status?.text || "?"}`;
                  }).join("\n");

                  const contextText = [
                    `Nome do titular ANM: ${titularNome}`,
                    uf ? `UF do processo minerário: ${uf}` : null,
                    substancia ? `Substância mineral: ${substancia}` : null,
                    fase ? `Fase do processo: ${fase}` : null,
                    processo ? `Número do processo: ${processo}` : null,
                  ].filter(Boolean).join("\n");

                  const openai = getSmartOpenAI();
                  const aiResp = await openai.chat.completions.create({
                    model: "gpt-5.4-mini",
                    messages: [
                      {
                        role: "system",
                        content: `Você é um especialista em mineração brasileira. Analise a lista de empresas candidatas e determine qual é a mais provável de ser o titular do processo minerário ANM, considerando o contexto fornecido (nome, UF, substância mineral, atividade).

Responda APENAS com um JSON no formato: {"index": <número 1-based da empresa escolhida>, "confidence": <"alta"|"media"|"baixa">, "reason": "<razão curta>"}

Se nenhuma empresa parecer compatível, responda: {"index": 0, "confidence": "baixa", "reason": "<razão>"}`,
                      },
                      {
                        role: "user",
                        content: `Contexto do processo minerário:\n${contextText}\n\nEmpresas candidatas:\n${candidatesText}`,
                      },
                    ],
                    temperature: 0.1,
                    max_completion_tokens: 200,
                  });

                  const aiContent = aiResp.choices[0]?.message?.content || "";
                  const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
                  if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (parsed.index > 0 && parsed.index <= records.length) {
                      const chosen = records[parsed.index - 1];
                      regexAiCnpj = chosen.taxId;
                      regexAiMethod = "cnpja_ai_disambiguation";
                      cnpjaCompanyData = chosen;
                      steps.push(`IA selecionou: ${chosen.company?.name || titularNome} (confiança: ${parsed.confidence}) — ${parsed.reason}`);
                    } else {
                      steps.push("IA não encontrou match confiável entre os candidatos");
                    }
                  }
                } catch (aiErr: any) {
                  console.warn("[Smart CNPJ] AI disambiguation error:", aiErr.message);
                  steps.push("Erro na análise com IA — tentando match por proximidade");
                }
              }

              if (!regexAiCnpj && records.length > 0) {
                const nameUpper = titularNome.toUpperCase().trim();
                const exactMatch = records.find((r: any) =>
                  (r.company?.name || "").toUpperCase().trim() === nameUpper
                );
                if (exactMatch) {
                  regexAiCnpj = exactMatch.taxId;
                  regexAiMethod = "cnpja_exact_name_match";
                  cnpjaCompanyData = exactMatch;
                  steps.push(`Match exato por nome: ${exactMatch.company?.name}`);
                }
              }
              }
            } else {
              steps.push("Nenhuma empresa encontrada na Receita Federal com este nome");

              if (uf) {
                const broadParams = new URLSearchParams({
                  "names.in": titularNome.trim(),
                  "status.id.in": "2",
                  "limit": "5",
                });
                const broadResp = await fetch(`https://api.cnpja.com/office?${broadParams.toString()}`, { headers: cnpjaHeaders() });
                if (broadResp.ok) {
                  const broadData = await broadResp.json() as any;
                  const broadRecords: any[] = broadData.records || [];
                  if (broadRecords.length === 1) {
                    regexAiCnpj = broadRecords[0].taxId;
                    regexAiMethod = "cnpja_name_search_broad";
                    cnpjaCompanyData = broadRecords[0];
                    steps.push(`Empresa encontrada em busca ampliada (sem filtro UF): ${broadRecords[0].company?.name}`);
                  } else if (broadRecords.length > 1) {
                    steps.push(`${broadRecords.length} resultados na busca ampliada — requer input manual`);
                  }
                }
              }
            }
          } else {
            steps.push("Erro ao consultar a Receita Federal — tente novamente");
          }
        } catch (searchErr: any) {
          console.warn("[Smart CNPJ] CNPJA search error:", searchErr.message);
          steps.push("Erro na busca por nome na Receita Federal");
        }
      }

      resolvedCnpj = regexAiCnpj;
      resolvedMethod = regexAiMethod;

      let companyId: number | null = null;
      let existed = false;

      if (resolvedCnpj) {
        const formatted = resolvedCnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

        const existing = await db.select().from(companies).where(
          and(
            or(eq(companies.cnpj, resolvedCnpj), eq(companies.cnpj, formatted)),
            or(eq(companies.orgId, orgId), isNull(companies.orgId))
          )
        ).limit(1);

        if (existing.length > 0) {
          companyId = existing[0].id;
          existed = true;
          steps.push("Empresa já cadastrada no sistema");
        } else {
          const legalName = cnpjaCompanyData?.company?.name || titularNome;
          const [created] = await db.insert(companies).values({
            legalName,
            cnpj: formatted,
            tradeName: cnpjaCompanyData?.alias || null,
            cnaePrincipal: cnpjaCompanyData?.mainActivity?.text || null,
            porte: cnpjaCompanyData?.company?.size?.text || null,
            orgId,
          }).returning();
          companyId = created.id;
          steps.push("Empresa criada com sucesso no sistema");
        }

        if (companyId) {
          try {
            let cnpjaDetail = await getCached<any>("cnpja", `office:${resolvedCnpj}`);
            if (!cnpjaDetail) {
              const detailUrl = `https://api.cnpja.com/office/${resolvedCnpj}?strategy=CACHE_IF_FRESH&maxAge=30`;
              const detailResp = await fetch(detailUrl, { headers: cnpjaHeaders() });
              if (detailResp.ok) {
                cnpjaDetail = await detailResp.json() as any;
                await setCached("cnpja", `office:${resolvedCnpj}`, cnpjaDetail);
              }
            }
            if (cnpjaDetail) {
              const [currentComp] = await db.select().from(companies).where(eq(companies.id, companyId!));
              const updateData: Record<string, any> = {};
              if (cnpjaDetail.company?.name && !currentComp?.legalName) updateData.legalName = cnpjaDetail.company.name;
              if (cnpjaDetail.mainActivity?.text && !currentComp?.cnaePrincipal) updateData.cnaePrincipal = cnpjaDetail.mainActivity.text;
              if (cnpjaDetail.sideActivities?.length && !(currentComp?.cnaeSecundarios as string[])?.length) {
                updateData.cnaeSecundarios = cnpjaDetail.sideActivities.map((a: any) => a.text);
              }
              if (cnpjaDetail.company?.size?.text && !currentComp?.porte) updateData.porte = cnpjaDetail.company.size.text;
              if (cnpjaDetail.alias && !currentComp?.tradeName) updateData.tradeName = cnpjaDetail.alias;
              if (cnpjaDetail.company?.equity && !currentComp?.shareCapital) updateData.shareCapital = cnpjaDetail.company.equity;
              const phones = (cnpjaDetail.phones || []).map((p: any) => `(${p.area}) ${p.number}`);
              if (phones.length && !(currentComp?.phones as string[])?.length) updateData.phones = phones;
              const emails = (cnpjaDetail.emails || []).map((e: any) => e.address);
              if (emails.length && !(currentComp?.emails as string[])?.length) updateData.emails = emails;
              if (cnpjaDetail.address && !currentComp?.address) {
                updateData.address = {
                  street: cnpjaDetail.address.street,
                  number: cnpjaDetail.address.number,
                  district: cnpjaDetail.address.district,
                  city: cnpjaDetail.address.city,
                  state: cnpjaDetail.address.state,
                  zip: cnpjaDetail.address.zip,
                };
              }
              const existingEnrich = (currentComp?.enrichmentData as any) || {};
              if (cnpjaDetail.company?.members?.length) {
                updateData.enrichmentData = { ...existingEnrich, cnpja: cnpjaDetail, smartResolve: { method: resolvedMethod, steps } };
              } else {
                updateData.enrichmentData = { ...existingEnrich, smartResolve: { method: resolvedMethod, steps } };
              }
              if (Object.keys(updateData).length > 0) {
                await db.update(companies).set(updateData).where(eq(companies.id, companyId!));
                steps.push(existed
                  ? "Dados complementados via Receita Federal (campos faltantes preenchidos)"
                  : "Dados completos enriquecidos via Receita Federal (CNAE, sócios, endereço, contatos)");
              }
            } else {
              await db.update(companies).set({
                enrichmentData: { smartResolve: { method: resolvedMethod, steps } },
              }).where(eq(companies.id, companyId!));
            }
          } catch (enrichErr: any) {
            console.warn("[Smart CNPJ] Enrichment error:", enrichErr.message);
            steps.push("Erro no enriquecimento automático — dados parciais salvos");
            try {
              await db.update(companies).set({
                enrichmentData: { smartResolve: { method: resolvedMethod, steps } },
              }).where(eq(companies.id, companyId!));
            } catch {}
          }
        }
      } else {
        const legalNameFinal = pessoaFisica ? `${titularNome} [Pessoa Física]` : titularNome;
        const existing = await db.select().from(companies).where(
          and(eq(companies.legalName, legalNameFinal), or(eq(companies.orgId, orgId), isNull(companies.orgId)))
        ).limit(1);

        if (existing.length > 0) {
          companyId = existing[0].id;
          existed = true;
        } else {
          const existingByOriginal = await db.select().from(companies).where(
            and(eq(companies.legalName, titularNome), or(eq(companies.orgId, orgId), isNull(companies.orgId)))
          ).limit(1);
          if (existingByOriginal.length > 0) {
            companyId = existingByOriginal[0].id;
            existed = true;
          } else {
            const [created] = await db.insert(companies).values({
              legalName: legalNameFinal,
              orgId,
              enrichmentData: { smartResolve: { method: pessoaFisica ? "pessoa_fisica" : "not_found", steps } },
            }).returning();
            companyId = created.id;
          }
        }
        if (!existed) {
          steps.push(pessoaFisica ? "Cadastro criado como Pessoa Física" : "Empresa criada sem CNPJ — insira manualmente se disponível");
        } else {
          steps.push("Cadastro já existente no sistema");
        }
      }

      const numericAssetId = assetId ? parseAssetId(assetId) : null;

      if (companyId && numericAssetId) {
        // UPDATE restrito à organização do requisitante (ativos sem org são legado)
        await db.update(assets).set({ linkedCompanyId: companyId }).where(
          and(eq(assets.id, numericAssetId), or(eq(assets.orgId, orgId), isNull(assets.orgId)))
        );
      }

      if (resolvedCnpj && numericAssetId) {
        await persistTitularCnpjOnAsset(numericAssetId, orgId, resolvedCnpj.replace(/\D/g, ""), resolvedMethod || "smart_resolve", titularNome);
        steps.push("CNPJ do titular salvo no ativo (certidões/CFEM/barragens do dossiê passam a usá-lo)");
      }

      res.json({
        companyId,
        existed,
        resolvedCnpj,
        resolvedMethod,
        regexAiCnpj,
        regexAiMethod,
        pessoaFisica,
        steps,
      });
    } catch (err: any) {
      console.error("[Smart CNPJ] Error:", err.message);
      res.status(500).json({ message: "Erro na resolução inteligente de CNPJ" });
    }
  });

  app.get("/api/anm/cotacao/:substancia", ensureAuth, async (req, res) => {
    try {
      const substancia = (req.params.substancia || "").toUpperCase().trim();
      if (!substancia) {
        return res.status(400).json({ message: "Substância é obrigatória" });
      }

      const cacheKey = `cotacao:${substancia}`;
      const cached = await getCached<any>("cotacao", cacheKey);
      if (cached && !req.query.refresh) return res.json(cached);

      const symbol = findMineralSymbol(substancia);
      const usdBrl = await fetchUsdBrl();

      let priceData: any = null;

      if (symbol === "XAU" || symbol === "XAG" || symbol === "XPT" || symbol === "XPD") {
        priceData = await fetchPreciousMetalPrice(symbol);
      }

      if (!priceData && symbol) {
        priceData = await fetchMetalPriceGeneric(symbol);
      }

      if (!priceData && symbol && METALS_PRICES_FALLBACK[symbol]) {
        const fb = METALS_PRICES_FALLBACK[symbol];
        priceData = {
          preco_usd: fb.usd,
          unidade: fb.unit,
          fonte: "referência de mercado",
          historico: generateFallbackHistory(fb.usd, 30),
        };
      }

      if (!priceData) {
        return res.json({
          substancia,
          symbol: symbol || null,
          disponivel: false,
          message: `Cotação não disponível para "${substancia}". Substâncias não-metálicas (calcário, areia, argila, etc.) não possuem cotação em bolsa.`,
        });
      }

      const result = {
        substancia,
        symbol,
        disponivel: true,
        preco_usd: priceData.preco_usd,
        preco_brl: priceData.preco_usd * usdBrl,
        usd_brl: usdBrl,
        unidade: priceData.unidade,
        fonte: priceData.fonte,
        historico: (priceData.historico || []).map((h: any) => ({
          ...h,
          preco_brl: h.preco_usd * usdBrl,
        })),
        consultadoEm: new Date().toISOString(),
      };

      await setCached("cotacao", cacheKey, result);
      res.json(result);
    } catch (err: any) {
      console.error("[ANM Enrichment] Cotacao error:", err.message);
      res.status(500).json({ message: "Erro ao consultar cotação" });
    }
  });

  // GeoSGB (Serviço Geológico do Brasil / CPRM) — consultas diretas aos
  // serviços ArcGIS públicos; a API Mavrion fica como fallback.
  const GEOSGB_BASE = "https://geoportal.sgb.gov.br/server/rest/services/geologia";

  async function queryGeoSgb(service: string, params: Record<string, string>, timeout = 25000): Promise<any | null> {
    try {
      const body = new URLSearchParams({ f: "json", ...params });
      // serviços fora da pasta "geologia" são indicados com "/" no início
      const base = service.startsWith("/")
        ? `https://geoportal.sgb.gov.br/server/rest/services${service}`
        : `${GEOSGB_BASE}/${service}`;
      const resp = await fetchWithTimeout(`${base}/MapServer/0/query`, timeout, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!resp.ok) return null;
      const data = await resp.json() as any;
      if (data.error) return null;
      return data;
    } catch {
      return null;
    }
  }

  const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  // Valida e canonicaliza coordenadas (evita cache poisoning e chamadas inválidas)
  const parseCoords = (latRaw: any, lonRaw: any): { lat: number; lon: number } | null => {
    const lat = Number(latRaw), lon = Number(lonRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat: Math.round(lat * 10000) / 10000, lon: Math.round(lon * 10000) / 10000 };
  };
  const RAIOS_PERMITIDOS = [10, 25, 50, 100];

  app.get("/api/anm-enrichment/cprm/geologia", ensureAuth, async (req, res) => {
    try {
      const coords = parseCoords(req.query.lat, req.query.lon);
      if (!coords) return res.status(400).json({ message: "lat e lon inválidos" });
      const { lat, lon } = coords;

      const cacheKey = `cprm_geo:${lat},${lon}`;
      const cached = await getCached<any>("anm_enrich", cacheKey);
      if (cached && !req.query.refresh) return res.json(cached);

      // Litoestratigrafia 1:1.000.000 — unidade geológica no ponto
      const raw = await queryGeoSgb("litoestratigrafia_1000000", {
        geometry: `${lon},${lat}`,
        geometryType: "esriGeometryPoint",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "SIGLA,HIERARQUIA,NOME,AMBIENTE_TECTONICO,LITOTIPOS,RANGE,IDADE_MIN,IDADE_MAX,ERA_MIN,ERA_MAX,SISTEMA_MIN,SISTEMA_MAX,LEGENDA,NOME_PAI",
        returnGeometry: "false",
      });

      if (raw?.features) {
        const data = raw.features.map((f: any) => {
          const a = f.attributes || {};
          return {
            sigla: a.SIGLA, nome: a.NOME, hierarquia: a.HIERARQUIA,
            ambiente_tectonico: a.AMBIENTE_TECTONICO, litotipos: a.LITOTIPOS,
            idade: a.RANGE || [a.IDADE_MAX, a.IDADE_MIN].filter((v: any) => v != null).map((v: any) => `${v} Ma`).join(" – "),
            era_min: a.ERA_MIN, era_max: a.ERA_MAX,
            sistema_min: a.SISTEMA_MIN, sistema_max: a.SISTEMA_MAX,
            legenda: a.LEGENDA, unidade_pai: a.NOME_PAI,
          };
        });
        const result = { disponivel: true, fonte: "GeoSGB/SGB-CPRM (litoestratigrafia 1:1.000.000)", total: data.length, data };
        await setCached("anm_enrich", cacheKey, result);
        return res.json(result);
      }

      // Fallback: API Mavrion
      const fb = await proxyToMavrionApi(`/api/cprm/geologia?lat=${lat}&lon=${lon}`);
      if (fb) return res.json({ disponivel: true, ...fb });
      res.json({ disponivel: false, message: "Serviço CPRM indisponível no momento" });
    } catch (err: any) {
      res.json({ disponivel: false, message: "Erro ao consultar CPRM" });
    }
  });

  app.get("/api/anm-enrichment/cprm/recursos", ensureAuth, async (req, res) => {
    try {
      const coords = parseCoords(req.query.lat, req.query.lon);
      if (!coords) return res.status(400).json({ message: "lat e lon inválidos" });
      const { lat, lon } = coords;
      const raioPedido = Number(req.query.raio) || 50;
      const raioKm = RAIOS_PERMITIDOS.reduce((best, r) => Math.abs(r - raioPedido) < Math.abs(best - raioPedido) ? r : best, 50);

      const cacheKey = `cprm_rec:${lat},${lon}:${raioKm}`;
      const cached = await getCached<any>("anm_enrich", cacheKey);
      if (cached && !req.query.refresh) return res.json(cached);

      // Ocorrências minerais catalogadas num raio (GeoSGB)
      const raw = await queryGeoSgb("ocorrencias", {
        geometry: `${lon},${lat}`,
        geometryType: "esriGeometryPoint",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        distance: String(raioKm * 1000),
        units: "esriSRUnit_Meter",
        outFields: "TOPONIMIA,MUNICIPIO,UF,SUBSTANCIAS,STATUS_ECONOMICO,IMPORTANCIA,SITUACAO_MINA,CLASSES_UTILITARIAS",
        returnGeometry: "true",
        outSR: "4326",
      }, 40000);

      if (raw?.features) {
        const data = raw.features.map((f: any) => {
          const a = f.attributes || {};
          const g = f.geometry || {};
          const dist = g.x != null && g.y != null ? haversineKm(Number(lat), Number(lon), g.y, g.x) : null;
          return {
            nome_ocorrencia: a.TOPONIMIA || "Sem nome",
            substancias: a.SUBSTANCIAS,
            status_economico: a.STATUS_ECONOMICO,
            importancia: a.IMPORTANCIA,
            situacao_mina: a.SITUACAO_MINA,
            municipio: a.MUNICIPIO,
            uf: a.UF,
            distancia_km: dist != null ? Math.round(dist * 10) / 10 : null,
            // coordenadas para a separação dentro/fora do polígono no catálogo de evidências
            lat: g.y != null ? Number(g.y) : null,
            lon: g.x != null ? Number(g.x) : null,
          };
        }).sort((x: any, y: any) => (x.distancia_km ?? 999) - (y.distancia_km ?? 999));
        const result = { disponivel: true, fonte: "GeoSGB/SGB-CPRM (ocorrências minerais)", raio_km: raioKm, total: data.length, data, consultadoEm: new Date().toISOString() };
        await setCached("anm_enrich", cacheKey, result);
        return res.json(result);
      }

      // Fallback: API Mavrion
      const fb = await proxyToMavrionApi(`/api/cprm/recursos?lat=${lat}&lon=${lon}&raio=${raioKm}`);
      if (fb) return res.json({ disponivel: true, ...fb });
      res.json({ disponivel: false, message: "Serviço CPRM indisponível no momento" });
    } catch (err: any) {
      res.json({ disponivel: false, message: "Erro ao consultar recursos CPRM" });
    }
  });

  // Furos de sondagem históricos da CPRM próximos ao ponto (GeoSGB).
  // Atenção: este serviço do SGB é instável (503/"Wait timeout" frequentes) —
  // em falha devolvemos disponivel:false e NÃO cacheamos.
  app.get("/api/anm-enrichment/cprm/sondagem", ensureAuth, async (req, res) => {
    try {
      const coords = parseCoords(req.query.lat, req.query.lon);
      if (!coords) return res.status(400).json({ message: "lat e lon inválidos" });
      const { lat, lon } = coords;
      const raioPedido = Number(req.query.raio) || 25;
      const raioKm = RAIOS_PERMITIDOS.reduce((best, r) => Math.abs(r - raioPedido) < Math.abs(best - raioPedido) ? r : best, 25);

      const cacheKey = `cprm_sond:${lat},${lon}:${raioKm}`;
      const cached = await getCached<any>("anm_enrich", cacheKey);
      if (cached && !req.query.refresh) return res.json(cached);

      const raw = await queryGeoSgb("furos_sondagem", {
        geometry: `${lon},${lat}`,
        geometryType: "esriGeometryPoint",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        distance: String(raioKm * 1000),
        units: "esriSRUnit_Meter",
        outFields: "BHID,PROJETO,AREA_PROJETO,LAT_SIRGAS,LON_SIRGAS,END_DEPTH,AZ,DIP,UNIDADE_ESTRATIGRAFICA,UNIDADE_MAIOR,URL_RIGEO",
        returnGeometry: "false",
        // sem resultRecordCount: camadas do GeoSGB rejeitam paginação; o corte é feito em código
      }, 35000);

      if (raw?.features) {
        const vistos = new Set<string>();
        const data = raw.features.map((f: any) => {
          const a = f.attributes || {};
          const flat = Number(a.LAT_SIRGAS), flon = Number(a.LON_SIRGAS);
          const dist = Number.isFinite(flat) && Number.isFinite(flon) ? haversineKm(lat, lon, flat, flon) : null;
          return {
            furo: a.BHID,
            projeto: a.PROJETO,
            area_projeto: a.AREA_PROJETO,
            profundidade_m: a.END_DEPTH,
            azimute: a.AZ,
            inclinacao: a.DIP,
            unidade_estratigrafica: a.UNIDADE_ESTRATIGRAFICA || a.UNIDADE_MAIOR,
            url_rigeo: a.URL_RIGEO,
            distancia_km: dist != null ? Math.round(dist * 10) / 10 : null,
            lat: Number.isFinite(flat) ? flat : null,
            lon: Number.isFinite(flon) ? flon : null,
          };
        }).filter((d: any) => {
          const key = `${d.furo}|${d.projeto}`;
          if (vistos.has(key)) return false; // camada repete o furo por intervalo FROM_/TO_
          vistos.add(key);
          return true;
        }).sort((x: any, y: any) => (x.distancia_km ?? 999) - (y.distancia_km ?? 999)).slice(0, 60);
        const result = {
          disponivel: true,
          fonte: "GeoSGB/SGB-CPRM (furos de sondagem históricos)",
          raio_km: raioKm, total: data.length, data,
          consultadoEm: new Date().toISOString(),
        };
        await setCached("anm_enrich", cacheKey, result);
        return res.json(result);
      }

      res.json({ disponivel: false, message: "Serviço de sondagens do GeoSGB indisponível no momento (instável) — tente novamente" });
    } catch {
      res.json({ disponivel: false, message: "Erro ao consultar sondagens CPRM" });
    }
  });

  // Pontos de amostragem geoquímica da CPRM próximos ao ponto (GeoSGB)
  app.get("/api/anm-enrichment/cprm/geoquimica", ensureAuth, async (req, res) => {
    try {
      const coords = parseCoords(req.query.lat, req.query.lon);
      if (!coords) return res.status(400).json({ message: "lat e lon inválidos" });
      const { lat, lon } = coords;
      const raioPedido = Number(req.query.raio) || 25;
      const raioKm = RAIOS_PERMITIDOS.reduce((best, r) => Math.abs(r - raioPedido) < Math.abs(best - raioPedido) ? r : best, 25);

      const cacheKey = `cprm_geoq:${lat},${lon}:${raioKm}`;
      const cached = await getCached<any>("anm_enrich", cacheKey);
      if (cached && !req.query.refresh) return res.json(cached);

      const raw = await queryGeoSgb("geoq_externa", {
        geometry: `${lon},${lat}`,
        geometryType: "esriGeometryPoint",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        distance: String(raioKm * 1000),
        units: "esriSRUnit_Meter",
        outFields: "projeto,classe,num_campo,tipo_de_amostragem,material_coletado,matriz,mineral_minerio,latitude,longitude,data_da_visita",
        returnGeometry: "false",
        // sem resultRecordCount: camadas do GeoSGB rejeitam paginação; o corte é feito em código
      }, 35000);

      if (raw?.features) {
        const data = raw.features.map((f: any) => {
          const a = f.attributes || {};
          const flat = Number(a.latitude), flon = Number(a.longitude);
          const dist = Number.isFinite(flat) && Number.isFinite(flon) ? haversineKm(lat, lon, flat, flon) : null;
          return {
            projeto: a.projeto,
            classe: a.classe,
            num_campo: a.num_campo,
            tipo_amostragem: a.tipo_de_amostragem,
            material: a.material_coletado,
            matriz: a.matriz,
            mineral_minerio: a.mineral_minerio,
            distancia_km: dist != null ? Math.round(dist * 10) / 10 : null,
          };
        }).sort((x: any, y: any) => (x.distancia_km ?? 999) - (y.distancia_km ?? 999)).slice(0, 300);

        // resumo por classe/material para leitura rápida
        const porClasse: Record<string, number> = {};
        for (const d of data) {
          const k = d.classe || d.tipo_amostragem || "outro";
          porClasse[k] = (porClasse[k] || 0) + 1;
        }
        const result = {
          disponivel: true,
          fonte: "GeoSGB/SGB-CPRM (geoquímica — pontos de amostragem)",
          raio_km: raioKm, total: data.length,
          porClasse,
          data: data.slice(0, 80),
          consultadoEm: new Date().toISOString(),
        };
        await setCached("anm_enrich", cacheKey, result);
        return res.json(result);
      }

      res.json({ disponivel: false, message: "Serviço de geoquímica do GeoSGB indisponível no momento — tente novamente" });
    } catch {
      res.json({ disponivel: false, message: "Erro ao consultar geoquímica CPRM" });
    }
  });

  app.get("/api/anm-enrichment/funai/sobreposicao", ensureAuth, async (req, res) => {
    try {
      const { lat, lon } = req.query;
      if (!lat || !lon) return res.status(400).json({ message: "lat e lon são obrigatórios" });

      const data = await proxyToMavrionApi(`/api/funai/sobreposicao?lat=${lat}&lon=${lon}`);
      if (!data) return res.json({ disponivel: false, message: "Serviço FUNAI indisponível no momento" });
      res.json({ disponivel: true, ...data, consultadoEm: new Date().toISOString() });
    } catch (err: any) {
      res.json({ disponivel: false, message: "Erro ao consultar FUNAI" });
    }
  });

  app.post("/api/anm-enrichment/funai/sobreposicao-poligono", ensureAuth, async (req, res) => {
    try {
      const { geometry } = req.body;
      if (!geometry) return res.status(400).json({ message: "geometry é obrigatório no body" });

      try {
        const resp = await fetchWithTimeout(
          `${MAVRION_API_URL}/api/funai/sobreposicao-poligono`,
          20000,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": MAVRION_API_KEY },
            body: JSON.stringify({ geometry }),
          }
        );
        if (!resp.ok) return res.json({ disponivel: false, message: "Serviço FUNAI indisponível" });
        const data = await resp.json();
        res.json({ disponivel: true, ...data });
      } catch {
        res.json({ disponivel: false, message: "Serviço FUNAI indisponível no momento" });
      }
    } catch (err: any) {
      res.json({ disponivel: false, message: "Erro ao consultar FUNAI" });
    }
  });

  app.get("/api/anm-enrichment/funai/terras/raio", ensureAuth, async (req, res) => {
    try {
      const { lat, lon, raio } = req.query;
      if (!lat || !lon) return res.status(400).json({ message: "lat e lon são obrigatórios" });

      const r = raio || "50";
      const data = await proxyToMavrionApi(`/api/funai/terras/raio?lat=${lat}&lon=${lon}&raio=${r}`);
      if (!data) return res.json({ disponivel: false, message: "Serviço FUNAI indisponível no momento" });
      res.json({ disponivel: true, ...data, consultadoEm: new Date().toISOString() });
    } catch (err: any) {
      res.json({ disponivel: false, message: "Erro ao consultar FUNAI" });
    }
  });

  // ── Cruzamento de restrições ambientais e fundiárias ──
  // Fontes públicas: CNUC/MMA (UCs, via INDE), embargos ICMBio (via INDE),
  // cavernas CANIE (via SGB), territórios quilombolas (IBGE/Censo 2022,
  // delimitação INCRA), assentamentos (IBGE localidades).
  // Falha de fonte = "consultado: false" — nunca vira "sem restrição".

  const INDE_WFS = "https://geoservicos.inde.gov.br/geoserver/ows";
  const IBGE_WFS = "https://geoservicos.ibge.gov.br/geoserver/ows";

  // GeoServer WFS 2.0 nestes servidores usa ordem de eixos lat,lon
  async function wfsGetJson(base: string, typeNames: string, extra: Record<string, string>, timeout = 20000): Promise<any | null> {
    try {
      const params = new URLSearchParams({
        service: "WFS", version: "2.0.0", request: "GetFeature",
        typeNames, outputFormat: "application/json", count: "200", ...extra,
      });
      const resp = await fetchWithTimeout(`${base}?${params.toString()}`, timeout);
      if (!resp.ok) return null;
      const text = await resp.text();
      if (text.trimStart().startsWith("<")) return null; // ExceptionReport
      const json = JSON.parse(text);
      // só aceita FeatureCollection válida — qualquer outra resposta é falha
      if (!json || !Array.isArray(json.features)) return null;
      return json;
    } catch {
      return null;
    }
  }

  // bbox em graus a partir de raio em km (ordem lat,lon dos servidores acima)
  const bboxFromRadius = (lat: number, lon: number, raioKm: number): string => {
    const dLat = raioKm / 111.32;
    const dLon = raioKm / (111.32 * Math.max(Math.cos(lat * Math.PI / 180), 0.01));
    return `${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon}`;
  };

  // distância aproximada do ponto a uma feature (centro do bbox para polígonos)
  const featureDistKm = (lat: number, lon: number, f: any): number | null => {
    try {
      if (f.geometry?.type === "Point") {
        const [x, y] = f.geometry.coordinates;
        // IBGE/INDE GeoJSON sai em lon,lat
        return haversineKm(lat, lon, y, x);
      }
      if (Array.isArray(f.bbox) && f.bbox.length >= 4) {
        // ordem do bbox varia por servidor (INDE: lat,lon; IBGE: lon,lat).
        // No Brasil, lon está sempre em [-75,-28] e lat em [-35,6]:
        // se o 1º valor < -35, o bbox está em lon,lat.
        const a = (f.bbox[0] + f.bbox[2]) / 2;
        const b = (f.bbox[1] + f.bbox[3]) / 2;
        return f.bbox[0] < -35 ? haversineKm(lat, lon, b, a) : haversineKm(lat, lon, a, b);
      }
      if (f.geometry?.type === "MultiPoint") {
        const ds = f.geometry.coordinates.map(([x, y]: number[]) => haversineKm(lat, lon, y, x));
        return Math.min(...ds);
      }
      // fallback: primeiro vértice do polígono (GeoJSON lon,lat)
      let coords = f.geometry?.coordinates;
      while (Array.isArray(coords) && Array.isArray(coords[0])) coords = coords[0];
      if (Array.isArray(coords) && coords.length >= 2) return haversineKm(lat, lon, coords[1], coords[0]);
    } catch {}
    return null;
  };

  app.get("/api/anm-enrichment/restricoes/cruzamento", ensureAuth, async (req, res) => {
    try {
      const coords = parseCoords(req.query.lat, req.query.lon);
      if (!coords) return res.status(400).json({ message: "lat e lon inválidos" });
      const { lat, lon } = coords;
      const raioPedido = Number(req.query.raio) || 25;
      const raioKm = RAIOS_PERMITIDOS.reduce((best, r) => Math.abs(r - raioPedido) < Math.abs(best - raioPedido) ? r : best, 25);

      const cacheKey = `restricoes:${lat},${lon}:${raioKm}`;
      const cached = await getCached<any>("anm_enrich", cacheKey);
      if (cached && !req.query.refresh) return res.json(cached);

      // lógica extraída para server/lib/restricoes-cruzamento.ts (reuso no relatório)
      const result = await consultarRestricoesCruzamento(lat, lon, raioKm);
      // só cacheia se todas as fontes responderam (evita fixar falha por 24h)
      if (result.naoConsultadas === 0) await setCached("anm_enrich", cacheKey, result);
      res.json(result);
    } catch (err: any) {
      console.error("[Restricoes] Erro no cruzamento:", err.message);
      res.json({ disponivel: false, message: "Erro ao cruzar restrições" });
    }
  });

  // ── Logística: ferrovia, porto e linha de transmissão mais próximos ──
  // Fontes: MInfra (malha ferroviária DNIT/ANTT via INDE), MInfra/ANTAQ
  // (portos via INDE) e EPE Webmap (LTs em operação, ArcGIS).
  // Falha de fonte = "consultado: false" — nunca vira "não há por perto".

  // distância ponto→segmento em km (aproximação equiretangular local)
  const pointSegmentKm = (lat: number, lon: number, aLon: number, aLat: number, bLon: number, bLat: number): number => {
    const kx = 111.32 * Math.cos(lat * Math.PI / 180);
    const ky = 111.32;
    const ax = (aLon - lon) * kx, ay = (aLat - lat) * ky;
    const bx = (bLon - lon) * kx, by = (bLat - lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + t * dx, py = ay + t * dy;
    return Math.sqrt(px * px + py * py);
  };

  // menor distância do ponto a uma geometria de linhas (GeoJSON lon,lat ou ArcGIS paths)
  const minDistToLinesKm = (lat: number, lon: number, lines: number[][][]): number | null => {
    let best: number | null = null;
    for (const line of lines || []) {
      for (let i = 0; i + 1 < line.length; i++) {
        const d = pointSegmentKm(lat, lon, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]);
        if (best == null || d < best) best = d;
      }
    }
    return best;
  };

  app.get("/api/anm-enrichment/logistica", ensureAuth, async (req, res) => {
    try {
      const coords = parseCoords(req.query.lat, req.query.lon);
      if (!coords) return res.status(400).json({ message: "lat e lon inválidos" });
      const { lat, lon } = coords;

      const cacheKey = `logistica:${lat},${lon}`;
      const cached = await getCached<any>("anm_enrich", cacheKey);
      if (cached && !req.query.refresh) return res.json(cached);

      const round1 = (v: number) => Math.round(v * 10) / 10;

      // Ferrovia — WFS INDE MInfra:Ferrovias (linhas); bbox progressivo
      const buscarFerrovia = async () => {
        for (const raioKm of [100, 300]) {
          const raw = await wfsGetJson(INDE_WFS, "MInfra:Ferrovias", { bbox: bboxFromRadius(lat, lon, raioKm) }, 30000);
          if (raw === null) return null; // fonte indisponível
          let best: any = null;
          for (const f of raw.features || []) {
            const g = f.geometry;
            const lines: number[][][] = g?.type === "MultiLineString" ? g.coordinates : g?.type === "LineString" ? [g.coordinates] : [];
            const d = minDistToLinesKm(lat, lon, lines);
            if (d != null && (best == null || d < best.distanciaKm)) {
              const p = f.properties || {};
              best = {
                nome: [p.sigla, p.municipio && p.uf ? `${p.municipio}/${p.uf}` : p.municipio || p.uf].filter(Boolean).join(" — ") || "Trecho ferroviário",
                concessao: p.sigla || null,
                situacao: p.tip_situac || null,
                bitola: p.bitola || null,
                municipio: p.municipio || null,
                uf: p.uf || null,
                distanciaKm: round1(d),
              };
            }
          }
          if (best) return { consultado: true, encontrado: true, raioBuscaKm: raioKm, ...best };
        }
        return { consultado: true, encontrado: false, raioBuscaKm: 300 };
      };

      // Porto — WFS INDE MInfra:Portos (pontos, fonte ANTAQ); bbox progressivo
      const buscarPorto = async () => {
        for (const raioKm of [300, 1000]) {
          const raw = await wfsGetJson(INDE_WFS, "MInfra:Portos", { bbox: bboxFromRadius(lat, lon, raioKm), count: "500" }, 30000);
          if (raw === null) return null;
          let best: any = null;
          for (const f of raw.features || []) {
            const g = f.geometry;
            const pts: number[][] = g?.type === "MultiPoint" ? g.coordinates : g?.type === "Point" ? [g.coordinates] : [];
            for (const [x, y] of pts) {
              const d = haversineKm(lat, lon, y, x);
              if (best == null || d < best.distanciaKm) {
                const p = f.properties || {};
                best = {
                  nome: (p.nome || "Porto").trim(),
                  tipo: p.tipo || null,
                  situacao: p.situacao || null,
                  cidade: p.cidade || null,
                  uf: p.estado || null,
                  distanciaKm: round1(d),
                };
              }
            }
          }
          if (best) return { consultado: true, encontrado: true, raioBuscaKm: raioKm, ...best };
        }
        return { consultado: true, encontrado: false, raioBuscaKm: 1000 };
      };

      // Rodovia federal — WFS INDE "MInfra:Rodovias Federais" (linhas, SNV/DNIT); bbox progressivo
      const buscarRodovia = async () => {
        for (const raioKm of [50, 150]) {
          const raw = await wfsGetJson(INDE_WFS, "MInfra:Rodovias Federais", { bbox: bboxFromRadius(lat, lon, raioKm), count: "2000" }, 30000);
          if (raw === null) return null; // fonte indisponível
          let best: any = null;
          for (const f of raw.features || []) {
            const g = f.geometry;
            const lines: number[][][] = g?.type === "MultiLineString" ? g.coordinates : g?.type === "LineString" ? [g.coordinates] : [];
            const d = minDistToLinesKm(lat, lon, lines);
            if (d != null && (best == null || d < best.distanciaKm)) {
              const p = f.properties || {};
              best = {
                nome: [p.vl_br ? `BR-${p.vl_br}` : null, p.sg_uf].filter(Boolean).join("/") || "Rodovia federal",
                br: p.vl_br || null,
                uf: p.sg_uf || null,
                situacao: p.ds_legenda || p.leg_multim || null,
                superficie: p.ds_superfi || null,
                trecho: [p.ds_local_i, p.ds_local_f].filter(Boolean).join(" → ") || null,
                administracao: p.ds_tipo_ad || null,
                distanciaKm: round1(d),
              };
            }
          }
          if (best) return { consultado: true, encontrado: true, raioBuscaKm: raioKm, ...best };
        }
        return { consultado: true, encontrado: false, raioBuscaKm: 150 };
      };

      // Hidrovia — WFS INDE "MInfra:viaseconomicamentenavegadas" (linhas, ANTAQ); bbox progressivo
      // Melhor feature (mais próxima) de uma FeatureCollection de hidrovias MInfra
      const melhorHidrovia = (raw: any, filtro?: (p: any) => boolean): any | null => {
        let best: any = null;
        for (const f of raw.features || []) {
          const p = f.properties || {};
          if (filtro && !filtro(p)) continue;
          const g = f.geometry;
          const lines: number[][][] = g?.type === "MultiLineString" ? g.coordinates : g?.type === "LineString" ? [g.coordinates] : [];
          const d = minDistToLinesKm(lat, lon, lines);
          if (d != null && (best == null || d < best.distanciaKm)) {
            best = {
              nome: p.nome || p.nome_rio || "Hidrovia",
              rio: p.nome_rio || null,
              classificacao: p.cla_icacao || null,
              navegacao: p.navegacao || null,
              jurisdicao: p.jurisdicao || null,
              extensaoKm: p.extensao != null ? Math.round(Number(p.extensao)) : null,
              distanciaKm: round1(d),
            };
          }
        }
        return best;
      };

      const buscarHidrovia = async () => {
        for (const raioKm of [200, 600]) {
          const bbox = bboxFromRadius(lat, lon, raioKm);
          // Consulta as duas camadas em paralelo e devolve a mais próxima entre elas:
          // principal = vias economicamente navegadas (ANTAQ); complementar = malha
          // aquaviária MInfra (inclui hidrovias navegáveis não economicamente
          // exploradas, ex. São Francisco em MG). Na complementar, só trechos de rio —
          // a camada também traz rotas oceânicas de acesso a portos, que não interessam.
          const [rawPrincipal, rawCompl] = await Promise.all([
            wfsGetJson(INDE_WFS, "MInfra:viaseconomicamentenavegadas", { bbox }, 30000),
            wfsGetJson(INDE_WFS, "MInfra:transporte_aquaviario", { bbox, count: "500" }, 30000),
          ]);
          const bestPrincipal = rawPrincipal ? melhorHidrovia(rawPrincipal) : null;
          const bestCompl = rawCompl
            ? melhorHidrovia(rawCompl, (p) => p.tipo === "Rio" || /interior/i.test(p.navegacao || ""))
            : null;
          const best = [bestPrincipal, bestCompl].filter(Boolean).sort((a, b) => a.distanciaKm - b.distanciaKm)[0];
          if (best) {
            const fonteCamada = best === bestPrincipal ? "economicamente navegada (ANTAQ)" : "malha aquaviária MInfra (não economicamente navegada)";
            return { consultado: true, encontrado: true, raioBuscaKm: raioKm, fonteCamada, ...best };
          }
          // se ambas as fontes falharam neste raio, não adianta ampliar
          if (rawPrincipal === null && rawCompl === null) return null;
        }
        return { consultado: true, encontrado: false, raioBuscaKm: 600 };
      };

      // Linha de transmissão — EPE Webmap ArcGIS, camada "Transmission Lines - In Operation"
      const EPE_LT_URL = "https://gisepeprd2.epe.gov.br/arcgis/rest/services/WMS_Webmap_EPE_Data/MapServer/23/query";
      const buscarLinhaTransmissao = async () => {
        for (const raioKm of [50, 200]) {
          try {
            const body = new URLSearchParams({
              geometry: `${lon},${lat}`,
              geometryType: "esriGeometryPoint",
              inSR: "4326",
              spatialRel: "esriSpatialRelIntersects",
              distance: String(raioKm * 1000),
              units: "esriSRUnit_Meter",
              outFields: "Nome,Tensao,Concession,Ano_Opera",
              returnGeometry: "true",
              outSR: "4326",
              resultRecordCount: "100",
              f: "json",
            });
            const resp = await fetchWithTimeout(EPE_LT_URL, 30000, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: body.toString(),
            });
            if (!resp.ok) return null;
            const data = await resp.json() as any;
            if (data.error || !Array.isArray(data.features)) return null;
            let best: any = null;
            for (const f of data.features) {
              const d = minDistToLinesKm(lat, lon, f.geometry?.paths || []);
              if (d != null && (best == null || d < best.distanciaKm)) {
                const a = f.attributes || {};
                best = {
                  nome: a.Nome || "Linha de transmissão",
                  tensaoKv: a.Tensao != null ? Number(a.Tensao) : null,
                  concessionaria: a.Concession || null,
                  anoOperacao: a.Ano_Opera || null,
                  distanciaKm: round1(d),
                };
              }
            }
            if (best) return { consultado: true, encontrado: true, raioBuscaKm: raioKm, ...best };
          } catch {
            return null;
          }
        }
        return { consultado: true, encontrado: false, raioBuscaKm: 200 };
      };

      const [ferrovia, porto, linhaTransmissao, rodovia, hidrovia] = await Promise.all([
        buscarFerrovia(), buscarPorto(), buscarLinhaTransmissao(), buscarRodovia(), buscarHidrovia(),
      ]);

      const naoConsultadas = [ferrovia, porto, linhaTransmissao, rodovia, hidrovia].filter(x => x === null).length;
      const result = {
        disponivel: true,
        ferrovia: ferrovia ?? { consultado: false },
        porto: porto ?? { consultado: false },
        linhaTransmissao: linhaTransmissao ?? { consultado: false },
        rodovia: rodovia ?? { consultado: false },
        hidrovia: hidrovia ?? { consultado: false },
        naoConsultadas,
        fontes: {
          ferrovia: "Malha ferroviária MInfra/DNIT (via INDE)",
          porto: "Portos ANTAQ/MInfra (via INDE)",
          linhaTransmissao: "EPE Webmap — LTs em operação",
          rodovia: "Rodovias federais SNV/DNIT (via INDE)",
          hidrovia: "Vias economicamente navegadas ANTAQ + malha aquaviária MInfra (via INDE)",
        },
        consultadoEm: new Date().toISOString(),
      };
      // só cacheia se todas as fontes responderam (evita fixar falha)
      if (naoConsultadas === 0) await setCached("anm_enrich", cacheKey, result);
      res.json(result);
    } catch (err: any) {
      console.error("[Logistica] Erro:", err.message);
      res.json({ disponivel: false, message: "Erro ao consultar infraestrutura logística" });
    }
  });

  app.post("/api/ai/mining-analysis/:id", ensureAuth, async (req, res) => {
    try {
      const { db } = await import("../db");
      const { assets } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");

      const orgId = getOrgId(req);
      const assetId = Number(req.params.id);
      const [ativo] = await db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.orgId, orgId)));
      if (!ativo) return res.status(404).json({ message: "Ativo não encontrado" });

      const campos = (ativo.camposEspecificos ?? {}) as any;
      const attrs = (ativo.attributesJson || {}) as any;
      const processoAnm = campos.processoAnm || attrs.anmProcesso || ativo.anmProcesso;

      let historicoData: any = campos.anmHistorico || null;
      let titularData = null;
      let cotacaoData = null;

      const substancia = campos.substancia || attrs.anmSubstancia || "";

      if (processoAnm) {
        try {
          const local = await getEventosByProcesso(String(processoAnm));
          if (local.total > 0) {
            historicoData = {
              eventos: local.eventos,
              fonte: local.fonte,
              dataBase: local.dataBase,
              consultadoEm: new Date().toISOString(),
            };
          }
        } catch {}
        try {
          const tCacheKey = `titular:${processoAnm}`;
          titularData = await getCached<any>("anm_enrich", tCacheKey);
        } catch {}
      }

      if (substancia) {
        try {
          const cCacheKey = `cotacao:${substancia.toUpperCase()}`;
          cotacaoData = await getCached<any>("cotacao", cCacheKey);
        } catch {}
      }

      let docsSectionMining = "";
      try {
        if (ativo.orgId != null) {
          docsSectionMining = (await buildDocsAnexadosSection(
            ativo.id,
            ativo.orgId,
            { omitirTrechosVigencia: true },
          )).secao;
        }
      } catch {}

      const eventosVigencia = filtrarEventosReais(historicoData?.eventos, processoAnm);
      const ativoComVigencia = anexarVigenciaCalculada({
        ...ativo,
        camposEspecificos: {
          ...campos,
          anmHistorico: { ...(historicoData || {}), eventos: eventosVigencia },
        },
      });
      const vigenciaAlvara = obterVigenciaCalculada(ativoComVigencia);
      const prompt = buildMiningAnalysisPrompt(
        ativo,
        campos,
        attrs,
        vigenciaAlvara,
        titularData,
        cotacaoData,
        docsSectionMining,
      );

      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const completion = await openai.chat.completions.create({
        model: "gpt-5.4",
        messages: [
          {
            role: "system",
            content: "Você é um geólogo e analista de due diligence minerária experiente no Brasil. Analise os dados do processo minerário e gere um parecer técnico detalhado em português. Seja objetivo, factual e aponte riscos e oportunidades concretos."
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_completion_tokens: 2000,
      });

      const analise = completion.choices[0]?.message?.content || "Análise não disponível";

      // (Nenhum score é extraído ou persistido do texto: scores de confiança
      // sobre conclusões foram removidos do produto — o parecer técnico em
      // texto é o material, e o único indicador é o score de completude.)
      const result = {
        analise,
        modelo: "gpt-5.4",
        geradoEm: new Date().toISOString(),
        dadosUtilizados: {
          processo: !!processoAnm,
          historico: !!historicoData,
          titular: !!titularData,
          cotacao: !!cotacaoData,
          cfem: !!campos.anmCfem?.disponivel,
          dou: !!campos.anmDou?.disponivel,
          barragens: !!campos.anmBarragens?.disponivel,
          certidoesTitular: !!campos.anmCertidoesTitular?.disponivel,
          sondagem: !!campos.anmSondagem?.disponivel,
          geoquimica: !!campos.anmGeoquimica?.disponivel,
          logistica: !!campos.anmLogistica?.disponivel,
        },
      };

      campos.iaMiningAnalysis = result;
      campos.iaMiningAnalysisDate = new Date().toISOString();
      campos.vigenciaAlvaraCalculada = {
        ...vigenciaAlvara,
        insumosHash: hashInsumosVigenciaDoAtivo(ativoComVigencia),
        processoAnm: processoAnm || null,
        consultadoEm: historicoData?.consultadoEm || null,
        calculadoEm: new Date().toISOString(),
      };
      // merge atômico: persiste só o delta, sem regravar o objeto inteiro
      await storage.mergeAssetCampos(assetId, {
        iaMiningAnalysis: result,
        iaMiningAnalysisDate: campos.iaMiningAnalysisDate,
        vigenciaAlvaraCalculada: campos.vigenciaAlvaraCalculada,
      });

      res.json(result);
    } catch (err: any) {
      console.error("[AI] Mining analysis error:", err.message);
      res.status(500).json({ message: err.message || "Erro na análise minerária" });
    }
  });
}

function categorizarEvento(descricao: string): string {
  const d = descricao.toUpperCase();
  if (d.includes("REQUERIMENTO")) return "requerimento";
  if (d.includes("AUTORIZA")) return "autorizacao";
  if (d.includes("CONCES")) return "concessao";
  if (d.includes("LICEN")) return "licenciamento";
  if (d.includes("INDEFERI")) return "indeferimento";
  if (d.includes("CADUC")) return "caducidade";
  if (d.includes("DESIST")) return "desistencia";
  if (d.includes("CESS")) return "cessao";
  if (d.includes("TRANSFER")) return "cessao";
  if (d.includes("MULTA") || d.includes("AUTO DE INFRA")) return "penalidade";
  if (d.includes("EMBARGO")) return "embargo";
  if (d.includes("RECURSO")) return "recurso";
  if (d.includes("PRAZ") || d.includes("PRORROGA")) return "prazo";
  if (d.includes("RELAT")) return "relatorio";
  if (d.includes("VISTORIA") || d.includes("FISCAL")) return "fiscalizacao";
  if (d.includes("PARECER")) return "parecer";
  if (d.includes("NOTIF")) return "notificacao";
  return "outro";
}

function findMineralSymbol(substancia: string): string | null {
  const upper = substancia.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const [key, val] of Object.entries(MINERAL_SYMBOLS)) {
    const keyNorm = key.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (upper.includes(keyNorm)) return val;
  }
  return null;
}

async function fetchUsdBrl(): Promise<number> {
  try {
    const resp = await fetchWithTimeout("https://economia.awesomeapi.com.br/json/last/USD-BRL", 5000);
    if (resp.ok) {
      const data = await resp.json() as any;
      return parseFloat(data.USDBRL?.bid) || 5.5;
    }
  } catch {}
  return 5.5;
}

async function fetchPreciousMetalPrice(symbol: string): Promise<any | null> {
  try {
    const resp = await fetchWithTimeout(
      `https://api.metals.dev/v1/latest?api_key=demo&currency=USD&unit=troy_ounce`,
      8000
    );
    if (resp.ok) {
      const data = await resp.json() as any;
      const metals = data.metals || {};
      const mapping: Record<string, string> = { XAU: "gold", XAG: "silver", XPT: "platinum", XPD: "palladium" };
      const metalName = mapping[symbol];
      if (metalName && metals[metalName]) {
        return {
          preco_usd: metals[metalName],
          unidade: "oz",
          fonte: "metals.dev",
          historico: generateFallbackHistory(metals[metalName], 30),
        };
      }
    }
  } catch {}
  return null;
}

async function fetchMetalPriceGeneric(symbol: string): Promise<any | null> {
  if (METALS_PRICES_FALLBACK[symbol]) {
    const fb = METALS_PRICES_FALLBACK[symbol];
    try {
      const resp = await fetchWithTimeout(
        `https://api.metals.dev/v1/latest?api_key=demo&currency=USD`,
        8000
      );
      if (resp.ok) {
        const data = await resp.json() as any;
        const metals = data.metals || {};
        const lowerSymbolMap: Record<string, string> = {
          NICKEL: "nickel", ALUMINUM: "aluminum", ZINC: "zinc", TIN: "tin",
          LEAD: "lead", COBALT: "cobalt", MOLYBDENUM: "molybdenum",
          TUNGSTEN: "tungsten", IRON_ORE: "iron_ore",
        };
        const metalKey = lowerSymbolMap[symbol];
        if (metalKey && metals[metalKey]) {
          return {
            preco_usd: metals[metalKey],
            unidade: fb.unit,
            fonte: "metals.dev",
            historico: generateFallbackHistory(metals[metalKey], 30),
          };
        }
      }
    } catch {}
    return null;
  }
  return null;
}

function generateFallbackHistory(basePrice: number, days: number): any[] {
  const history = [];
  const now = Date.now();
  for (let i = days; i >= 0; i--) {
    const variation = 1 + (Math.random() - 0.5) * 0.06;
    const dayVariation = Math.sin(i * 0.3) * 0.02;
    const price = basePrice * (variation + dayVariation);
    history.push({
      data: new Date(now - i * 86400000).toISOString().split("T")[0],
      preco_usd: Math.round(price * 100) / 100,
    });
  }
  return history;
}

export function buildMiningAnalysisPrompt(
  ativo: any,
  campos: any,
  attrs: any,
  vigenciaAlvara: ResultadoVigenciaAlvara,
  titular: any,
  cotacao: any,
  docsSection?: string,
): string {
  const lines: string[] = [];
  lines.push("## Dados do Processo Minerário para Análise");
  lines.push("");
  lines.push(`**Ativo:** ${ativo.title}`);
  lines.push(`**Tipo:** ${ativo.type}`);
  lines.push(`**Localização:** ${ativo.location || ""} - ${ativo.municipio || ""} / ${ativo.estado || ""}`);
  if (ativo.priceAsking) lines.push(`**Valor pedido:** R$ ${ativo.priceAsking.toLocaleString("pt-BR")}`);
  if (ativo.areaHa) lines.push(`**Área:** ${ativo.areaHa} ha`);

  const processoAnm = campos.processoAnm || attrs.anmProcesso || ativo.anmProcesso;
  if (processoAnm) lines.push(`**Processo ANM:** ${processoAnm}`);
  if (campos.substancia || attrs.anmSubstancia) lines.push(`**Substância:** ${campos.substancia || attrs.anmSubstancia}`);
  if (campos.faseAnm || attrs.anmFase) lines.push(`**Fase:** ${campos.faseAnm || attrs.anmFase}`);
  if (campos.situacaoAnm) lines.push(`**Situação:** ${campos.situacaoAnm}`);
  lines.push("");
  lines.push(formatarVigenciaParaPrompt(vigenciaAlvara));

  if (titular) {
    lines.push("");
    lines.push("## Titular");
    lines.push(`**Nome:** ${titular.titular?.nome || "N/I"}`);
    if (titular.titular?.cnpj) lines.push(`**CNPJ:** ${titular.titular.cnpj}`);
    lines.push(`**Outros processos do titular:** ${titular.totalOutrosProcessos || 0}`);
    if (titular.outrosProcessos?.length > 0) {
      lines.push("Principais processos:");
      for (const op of titular.outrosProcessos.slice(0, 10)) {
        lines.push(`- ${op.PROCESSO}: ${op.SUBS} (${op.FASE}) - ${op.AREA_HA} ha - ${op.UF}`);
      }
    }
  }

  if (cotacao && cotacao.disponivel) {
    lines.push("");
    lines.push("## Cotação da Substância");
    lines.push(`**${cotacao.substancia}:** US$ ${cotacao.preco_usd} / ${cotacao.unidade} (R$ ${cotacao.preco_brl?.toFixed(2)})`);
  }

  // ── blocos do Dossiê da Jazida (enriquecimentos persistidos no ativo) ──

  const cfem = campos.anmCfem;
  if (cfem?.disponivel) {
    lines.push("");
    lines.push("## Produção Real — CFEM (dados abertos ANM)");
    if (cfem.processo) {
      lines.push(cfem.processo.jaProduziu
        ? `**O processo JÁ PRODUZIU:** R$ ${Number(cfem.processo.totalRecolhido || 0).toLocaleString("pt-BR")} recolhidos em CFEM.`
        : "**O processo NUNCA recolheu CFEM** (sem produção comercializada registrada).");
      for (const a of (cfem.processo.porAno || []).slice(0, 8)) {
        lines.push(`- ${a.ano}: R$ ${Number(a.valorTotal || 0).toLocaleString("pt-BR")} (${(a.substancias || []).join(", ")})`);
      }
    }
    if (cfem.titular) {
      lines.push(cfem.titular.jaRecolheu
        ? `**Titular (CNPJ ${cfem.titular.cnpj}):** já recolheu R$ ${Number(cfem.titular.totalRecolhido || 0).toLocaleString("pt-BR")} em ${cfem.titular.processosDistintos} processo(s) — operador com histórico de produção.`
        : `**Titular (CNPJ ${cfem.titular.cnpj}):** sem recolhimento de CFEM registrado (sem histórico de produção própria).`);
    }
    if (cfem.municipio) {
      lines.push(`**Município (${cfem.municipio.municipio}/${cfem.municipio.uf}):** ${cfem.municipio.rankBrasil ? `${cfem.municipio.rankBrasil}º maior arrecadador CFEM do Brasil` : ""}${cfem.municipio.rankUf ? ` (${cfem.municipio.rankUf}º na UF)` : ""} em ${cfem.municipio.anoReferencia}; principais substâncias: ${(cfem.municipio.topSubstancias || []).slice(0, 3).map((s: any) => s.substancia).join(", ")}.`);
    }
  }

  const barragens = campos.anmBarragens;
  if (barragens?.disponivel) {
    lines.push("");
    lines.push("## Barragens de Mineração (SIGBM/ANM)");
    // casadas só por nome do empreendedor NÃO entram como fato do titular
    const { confirmadas: barrConfirmadas, naoConfirmadas: barrNaoConfirmadas } = separarBarragensTitular(barragens);
    if (barrConfirmadas.length > 0) {
      lines.push(`**Barragens do titular:** ${barrConfirmadas.length}`);
      for (const b of barrConfirmadas.slice(0, 5)) {
        lines.push(`- ${b.nome} (${b.municipio}/${b.uf}): risco ${b.categoriaRisco || "N/I"}, dano potencial ${b.danoPotencial || "N/I"}, ${b.situacaoOperacional || ""} ${b.nivelEmergencia && b.nivelEmergencia !== "Sem emergência" ? `— ATENÇÃO: ${b.nivelEmergencia}` : ""}`);
      }
      if (barrNaoConfirmadas.length > 0) {
        lines.push(`(${barrNaoConfirmadas.length} barragem(ns) casada(s) apenas por nome do empreendedor excluída(s) destes insumos — vinculação não confirmada.)`);
      }
    } else if (barrNaoConfirmadas.length > 0) {
      lines.push(`Nenhuma barragem vinculada ao titular por CNPJ; ${barrNaoConfirmadas.length} casada(s) apenas por nome do empreendedor (vinculação não confirmada — NÃO tratar como barragem do titular).`);
    } else {
      lines.push("Nenhuma barragem de mineração registrada para o titular no SIGBM.");
    }
    if ((barragens.proximas || []).length > 0) {
      lines.push(`**Barragens num raio de ${barragens.raioKm} km:** ${barragens.proximas.length}`);
      for (const b of barragens.proximas.slice(0, 5)) {
        lines.push(`- ${b.nome} (${b.empreendedor}) a ${b.distanciaKm} km: risco ${b.categoriaRisco || "N/I"}, dano potencial ${b.danoPotencial || "N/I"}`);
      }
    }
  }

  const cert = campos.anmCertidoesTitular;
  if (cert?.disponivel) {
    lines.push("");
    lines.push("## Certidões do Titular");
    const avisoCert = avisoCertidoesVinculo(cert);
    if (avisoCert) {
      lines.push(`**ATENÇÃO — vinculação não confirmada por documento:** ${avisoCert} NÃO tratar os resultados abaixo como fato do titular.`);
    }
    if (cert.pgfn) lines.push(`**Dívida ativa (PGFN):** ${cert.pgfn.temDebitoAtivo ? `POSSUI dívida ativa — ${cert.pgfn.situacao || ""}` : cert.pgfn.situacao || "sem débitos inscritos"}`);
    if (cert.cnj) lines.push(`**Processos judiciais (DataJud/CNJ):** ${cert.cnj.totalProcessos ?? 0} processo(s) encontrados`);
    if (cert.ceis) lines.push(`**Sanções (CEIS):** ${cert.ceis.sancionado ? `SANCIONADO — ${(cert.ceis.sancoes || []).length} sanção(ões)` : "nenhuma sanção vigente"}`);
    if (Array.isArray(cert.erros) && cert.erros.length > 0) lines.push(`(Fontes indisponíveis nesta consulta: ${cert.erros.map((e: any) => e?.fonte || e).join("; ")})`);
  }

  const sond = campos.anmSondagem;
  if (sond?.disponivel && sond.total > 0) {
    lines.push("");
    lines.push(`## Sondagens CPRM próximas (${sond.total} furos em ${sond.raio_km} km)`);
    for (const s of (sond.data || []).slice(0, 6)) {
      lines.push(`- ${s.furo || "furo"} (${s.projeto || "projeto N/I"}) a ${s.distancia_km ?? "?"} km — prof. ${s.profundidade_m ?? "?"} m ${s.unidade_estratigrafica ? `(${s.unidade_estratigrafica})` : ""}`);
    }
    lines.push("(Sondagens históricas da CPRM perto do ativo indicam interesse exploratório prévio na região.)");
  }

  const geoq = campos.anmGeoquimica;
  if (geoq?.disponivel && geoq.total > 0) {
    lines.push("");
    lines.push(`## Geoquímica CPRM (${geoq.total} amostras em ${geoq.raio_km} km)`);
    lines.push(`Por classe: ${Object.entries(geoq.porClasse || {}).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
  }

  const restr = campos.anmRestricoes;
  if (restr?.semaforo) {
    lines.push("");
    lines.push(`## Restrições Ambientais/Fundiárias: semáforo ${String(restr.semaforo).toUpperCase()} (raio ${restr.raio_km} km)`);
  }

  const logi = campos.anmLogistica;
  if (logi?.disponivel) {
    lines.push("");
    lines.push("## Logística — Infraestrutura Próxima");
    const fmtItem = (label: string, it: any, extra?: string) => {
      if (!it || it.consultado === false) return `**${label}:** fonte não consultada nesta análise`;
      if (!it.encontrado) return `**${label}:** nenhuma encontrada em até ${it.raioBuscaKm} km`;
      return `**${label}:** ${it.nome} a ${it.distanciaKm} km${extra ? ` (${extra})` : ""}`;
    };
    lines.push(fmtItem("Ferrovia mais próxima", logi.ferrovia, [logi.ferrovia?.situacao, logi.ferrovia?.bitola ? `bitola ${logi.ferrovia.bitola}` : null].filter(Boolean).join(", ") || undefined));
    lines.push(fmtItem("Porto mais próximo", logi.porto, [logi.porto?.tipo, logi.porto?.situacao].filter(Boolean).join(", ") || undefined));
    lines.push(fmtItem("Linha de transmissão mais próxima", logi.linhaTransmissao, logi.linhaTransmissao?.tensaoKv ? `${logi.linhaTransmissao.tensaoKv} kV` : undefined));
    if (logi.rodovia !== undefined) lines.push(fmtItem("Rodovia federal mais próxima", logi.rodovia));
    if (logi.hidrovia !== undefined) lines.push(fmtItem("Hidrovia mais próxima", logi.hidrovia));
  }

  const fundiariaTah = buildDossieDigest(campos, ["fundiaria", "tah"]);
  if (fundiariaTah) {
    lines.push("");
    lines.push("## Base Fundiária e TAH");
    lines.push(fundiariaTah);
  }

  if (docsSection) {
    lines.push("");
    lines.push(omitirTrechosDeVigenciaParaIa(docsSection).trim());
  }

  lines.push("");
  lines.push("## Solicitação");
  lines.push("Com base nos dados acima, elabore uma análise minerária com:");
  lines.push("1. **Resumo Executivo** — 2-3 frases sobre o ativo");
  lines.push("2. **Pontos Positivos** — liste os aspectos favoráveis");
  lines.push("3. **Riscos Identificados** — liste os riscos com severidade (baixa/média/alta)");
  lines.push("4. **Recomendações** — próximos passos sugeridos");
  lines.push("5. **Estimativa de valor** — se possível, faixa de valor estimado com base nos dados");
  lines.push("Não atribua notas, scores nem índices de confiança ao ativo ou às conclusões — apenas descreva fatos e riscos com base nos dados fornecidos.");

  return lines.join("\n");
}
