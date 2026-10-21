import OpenAI from "openai";
import {
  anexarVigenciaCalculada,
  contextoVigenciaMinerariaParaPrompt,
  obterVigenciaCalculada,
} from "./vigencia-alvara";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

export interface AIEnrichmentResult {
  validatedPhones: Array<{
    number: string;
    type: string;
    source: string;
    confidence: string;
  }>;
  validatedEmails: Array<{
    email: string;
    type: string;
    source: string;
    confidence: string;
  }>;
  decisionMakers: Array<{
    name: string;
    role: string;
    phone?: string;
    email?: string;
    linkedin?: string;
  }>;
  socialMedia: Record<string, string>;
  website: {
    url?: string;
    seo?: {
      title?: string;
      description?: string;
      keywords?: string;
      og_image?: string;
    };
    tech?: string[];
  };
  financialProfile: {
    estimatedRevenue?: string;
    revenueRange?: string;
    employeeRange?: string;
    companySize?: string;
    sector?: string;
    mainActivities?: string[];
    foundedYear?: string;
  };
  competitiveIntel: {
    mainCompetitors?: string[];
    marketPosition?: string;
    differentials?: string[];
  };
  legalCompliance: {
    certifications?: string[];
    lawsuits?: string[];
    environmentalIssues?: string[];
    debtSignals?: string[];
  };
  businessIntel: string[];
  searchSources: string[];
  enrichedAt: string;
}

export async function aiEnrichCompany(params: {
  name: string;
  cnpj: string;
  existingPhones: string[];
  existingEmails: string[];
  website?: string;
  city?: string;
  state?: string;
  porte?: string;
  cnae?: string;
  shareCapital?: number;
  scraperData?: any;
}): Promise<AIEnrichmentResult> {
  const {
    name, cnpj, existingPhones, existingEmails,
    website, city, state, porte, cnae, scraperData,
  } = params;

  const location = [city, state].filter(Boolean).join(", ");
  const scraperPhones = scraperData?.phones || scraperData?.merged?.phones || [];
  const scraperEmails = scraperData?.emails || scraperData?.merged?.emails || [];
  const scraperWebsite = scraperData?.website || scraperData?.merged?.website || "";
  const knownWebsite = website || scraperWebsite || "";

  const companyContext = [
    cnpj ? `CNPJ: ${cnpj}` : "",
    location ? `Localização: ${location}` : "",
    porte ? `Porte: ${porte}` : "",
    cnae ? `CNAE: ${cnae}` : "",
    knownWebsite ? `Website conhecido: ${knownWebsite}` : "",
    existingPhones.length ? `Telefones já cadastrados: ${existingPhones.join(", ")}` : "",
    existingEmails.length ? `Emails já cadastrados: ${existingEmails.join(", ")}` : "",
    scraperPhones.length ? `Telefones do scraper: ${scraperPhones.join(", ")}` : "",
    scraperEmails.length ? `Emails do scraper: ${scraperEmails.join(", ")}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `Você é um analista sênior de inteligência comercial e due diligence B2B no Brasil.

Sua missão é realizar uma pesquisa COMPLETA e PROFUNDA sobre a empresa abaixo, buscando na web todas as informações disponíveis. Seja um investigador incansável — pesquise múltiplas fontes, cruze dados, e traga o máximo de informações úteis para tomada de decisão comercial.

═══════════════════════════════════════
EMPRESA ALVO: ${name}
${companyContext}
═══════════════════════════════════════

ROTEIRO DE INVESTIGAÇÃO (siga nesta ordem):

1. IDENTIDADE DIGITAL
   - Encontre o SITE OFICIAL da empresa (não diretórios como cnpj.biz, casadosdados)
   - Extraia título, descrição, keywords do site
   - Identifique tecnologias usadas (WordPress, Shopify, React, etc.)
   - Encontre TODAS as redes sociais oficiais da empresa:
     LinkedIn (página da empresa), Instagram, Facebook, Twitter/X, YouTube, TikTok

2. CONTATOS DIRETOS
   - Busque telefones REAIS da empresa (comercial, sede, filiais)
   - Busque celulares de sócios e diretores
   - Busque números de WhatsApp comercial
   - Busque emails corporativos (@dominio-da-empresa = prioridade máxima)
   - Busque emails pessoais de decisores
   - EXCLUA: telefones de contadores, 0800, SAC genérico

3. DECISORES E STAKEHOLDERS
   - Identifique sócios, diretores, gerentes, CEO, fundadores
   - Para cada um: nome, cargo, telefone, email, LinkedIn pessoal
   - Busque no LinkedIn, na Receita Federal, em notícias

4. PERFIL FINANCEIRO E OPERACIONAL
   - Faturamento estimado (busque em rankings, balanços publicados, notícias)
   - Quantidade de funcionários (busque no LinkedIn, RAIS, notícias)
   - Porte real da empresa (MEI, ME, EPP, Médio, Grande)
   - Setor principal e atividades/produtos/serviços
   - Ano de fundação
   - Filiais, unidades, plantas industriais

5. INTELIGÊNCIA COMPETITIVA
   - Principais concorrentes diretos
   - Posição no mercado (líder, challenger, nicho)
   - Diferenciais competitivos
   - Market share estimado (se disponível)

6. SINAIS PARA DEAL ORIGINATION (M&A / Investimento)
   - Potencial como COMPRADOR: alto/médio/baixo (com justificativa)
   - Capacidade de investimento estimada
   - Histórico de aquisições, fusões, joint ventures
   - Sinais de EXPANSÃO: novas unidades, contratações em massa, licitações, novos produtos
   - Sinais de VENDA/SAÍDA: troca de controle, desinvestimento, reestruturação
   - Áreas de interesse: agro, mineração, imóveis, energia, tech, saúde, etc.

7. COMPLIANCE E RISCOS
   - Certificações (ISO, ANVISA, IBAMA, etc.)
   - Processos judiciais relevantes (trabalhistas, ambientais, tributários)
   - Problemas ambientais
   - Sinais de endividamento, recuperação judicial, protestos

8. INTELIGÊNCIA DE NEGÓCIO
   - Notícias recentes relevantes (últimos 2 anos)
   - Projetos em andamento
   - Prêmios e reconhecimentos
   - Parcerias estratégicas
   - Investimentos anunciados
   - Qualquer fato que ajude a originar um negócio com esta empresa

═══════════════════════════════════════
REGRAS ABSOLUTAS:
- Use a busca web para encontrar dados REAIS. Pesquise extensivamente.
- NÃO invente dados. Se não encontrou, deixe null ou array vazio.
- URLs de redes sociais devem ser REAIS e verificadas.
- Telefones devem ser formatados como aparecem (com DDD).
- Seja CONSERVADOR em estimativas financeiras.
- Priorize fontes oficiais, depois imprensa, depois diretórios.
- Para cada dado, indique a fonte/confiança.
═══════════════════════════════════════

Responda EXCLUSIVAMENTE com JSON válido neste formato:
{
  "validatedPhones": [{"number": "(XX) XXXXX-XXXX", "type": "comercial|celular|whatsapp", "source": "site oficial|linkedin|busca web", "confidence": "alta|media|baixa"}],
  "validatedEmails": [{"email": "x@x.com", "type": "comercial|pessoal|generico", "source": "site oficial|linkedin|busca web", "confidence": "alta|media|baixa"}],
  "decisionMakers": [{"name": "Nome", "role": "Cargo", "phone": "tel ou null", "email": "email ou null", "linkedin": "url ou null"}],
  "socialMedia": {"linkedin": "url ou null", "instagram": "url ou null", "facebook": "url ou null", "twitter": "url ou null", "youtube": "url ou null", "tiktok": "url ou null"},
  "website": {"url": "url do site oficial ou null", "seo": {"title": "título", "description": "meta desc", "keywords": "keywords"}, "tech": ["WordPress", "Google Analytics"]},
  "financialProfile": {"estimatedRevenue": "R$ XX milhões/ano", "revenueRange": "micro|pequena|media|grande", "employeeRange": "1-10|11-50|51-200|201-500|500+", "companySize": "MEI|ME|EPP|Médio|Grande", "sector": "setor", "mainActivities": ["atividade1"], "foundedYear": "ano"},
  "competitiveIntel": {"mainCompetitors": ["empresa1"], "marketPosition": "posição", "differentials": ["diferencial1"]},
  "legalCompliance": {"certifications": ["ISO 9001"], "lawsuits": ["resumo ou null"], "environmentalIssues": ["issue ou null"], "debtSignals": ["sinal ou null"]},
  "businessIntel": ["fato relevante 1", "fato relevante 2"],
  "searchSources": ["url1", "url2"]
}`;

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[AI-Enrichment] Tentativa ${attempt}/${maxAttempts} — pesquisa web para "${name}"...`);
      const startTime = Date.now();

      const response = await getOpenAI().responses.create({
        model: "gpt-4o",
        tools: [{
          type: "web_search_preview" as any,
          search_context_size: "high" as any,
        }],
        instructions: "Você é um analista de inteligência comercial brasileiro. Use a busca web extensivamente para encontrar dados reais sobre a empresa. Faça MÚLTIPLAS buscas para cobrir todos os aspectos solicitados. Responda APENAS com JSON válido, sem markdown.",
        input: prompt,
      } as any);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[AI-Enrichment] Pesquisa concluída em ${elapsed}s para "${name}" (tentativa ${attempt})`);

      let content = "";
      if (response.output) {
        for (const item of response.output as any[]) {
          if (item.type === "message" && item.content) {
            for (const block of item.content) {
              if (block.type === "output_text" || block.type === "text") {
                content += block.text || "";
              }
            }
          }
        }
      }

      if (!content) {
        console.error(`[AI-Enrichment] Resposta vazia do GPT-4o (tentativa ${attempt})`);
        if (attempt < maxAttempts) continue;
        const result = emptyResult();
        result._failReason = "empty_response";
        return result;
      }

      let parsed: any;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error(`[AI-Enrichment] JSON não encontrado (tentativa ${attempt}):`, content.slice(0, 300));
          if (attempt < maxAttempts) continue;
          const result = emptyResult();
          result._failReason = "no_json_in_response";
          result._rawSnippet = content.slice(0, 500);
          return result;
        }
        let rawJson = jsonMatch[0];
        try {
          parsed = JSON.parse(rawJson);
        } catch {
          const sanitized = sanitizeJson(rawJson);
          try {
            parsed = JSON.parse(sanitized);
            console.log(`[AI-Enrichment] JSON recuperado via sanitização (tentativa ${attempt})`);
          } catch (sanitizeErr: any) {
            console.log(`[AI-Enrichment] Sanitização falhou, tentando correção por IA (tentativa ${attempt})...`);
            const fixed = await fixJsonWithAI(rawJson);
            if (fixed) {
              parsed = fixed;
              console.log(`[AI-Enrichment] JSON recuperado via correção por IA (tentativa ${attempt})`);
            } else {
              throw sanitizeErr;
            }
          }
        }
      } catch (parseErr: any) {
        console.error(`[AI-Enrichment] JSON parse error (tentativa ${attempt}):`, parseErr.message, content.slice(0, 300));
        if (attempt < maxAttempts) continue;
        const result = emptyResult();
        result._failReason = "json_parse_error";
        result._rawSnippet = content.slice(0, 500);
        return result;
      }

      const normalized = normalizeResult(parsed);
      const hasData = normalized.validatedPhones.length > 0 ||
        normalized.validatedEmails.length > 0 ||
        normalized.decisionMakers.length > 0 ||
        normalized.financialProfile.estimatedRevenue ||
        normalized.financialProfile.employeeRange ||
        Object.keys(normalized.socialMedia).length > 0;

      if (!hasData && attempt < maxAttempts) {
        console.warn(`[AI-Enrichment] Resultado vazio para "${name}" — tentando novamente...`);
        continue;
      }

      return normalized;
    } catch (err: any) {
      console.error(`[AI-Enrichment] Erro (tentativa ${attempt}):`, err.message);
      if (attempt < maxAttempts) continue;
      const result = emptyResult();
      result._failReason = "api_error";
      result._errorMessage = err.message;
      return result;
    }
  }

  return emptyResult();
}

function safeStr(v: any): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function safeUrl(v: any): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return undefined;
}

function safeArr(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x: any) => typeof x === "string" && x.trim()).map((x: any) => x.trim());
}

function normalizeResult(raw: any): AIEnrichmentResult {
  const socialMedia: Record<string, string> = {};
  if (raw.socialMedia && typeof raw.socialMedia === "object") {
    for (const [k, v] of Object.entries(raw.socialMedia)) {
      const url = safeUrl(v);
      if (url) socialMedia[k] = url;
    }
  }

  const validatedPhones = (Array.isArray(raw.validatedPhones) ? raw.validatedPhones : [])
    .filter((p: any) => p && typeof p === "object" && safeStr(p.number))
    .map((p: any) => ({
      number: String(p.number).trim(),
      type: safeStr(p.type) || "comercial",
      source: safeStr(p.source) || "busca web",
      confidence: safeStr(p.confidence) || "media",
    }));

  const validatedEmails = (Array.isArray(raw.validatedEmails) ? raw.validatedEmails : [])
    .filter((e: any) => e && typeof e === "object" && safeStr(e.email))
    .map((e: any) => ({
      email: String(e.email).trim().toLowerCase(),
      type: safeStr(e.type) || "generico",
      source: safeStr(e.source) || "busca web",
      confidence: safeStr(e.confidence) || "media",
    }));

  const decisionMakers = (Array.isArray(raw.decisionMakers) ? raw.decisionMakers : [])
    .filter((m: any) => m && typeof m === "object" && safeStr(m.name))
    .map((m: any) => ({
      name: String(m.name).trim(),
      role: safeStr(m.role) || "Não informado",
      phone: safeStr(m.phone) || undefined,
      email: safeStr(m.email) || undefined,
      linkedin: safeUrl(m.linkedin) || undefined,
    }));

  const fp = raw.financialProfile && typeof raw.financialProfile === "object" ? raw.financialProfile : {};
  const ci = raw.competitiveIntel && typeof raw.competitiveIntel === "object" ? raw.competitiveIntel : {};
  const lc = raw.legalCompliance && typeof raw.legalCompliance === "object" ? raw.legalCompliance : {};
  const ws = raw.website && typeof raw.website === "object" ? raw.website : {};
  const seo = ws.seo && typeof ws.seo === "object" ? ws.seo : {};

  return {
    validatedPhones,
    validatedEmails,
    decisionMakers,
    socialMedia,
    website: {
      url: safeUrl(ws.url),
      seo: {
        title: safeStr(seo.title),
        description: safeStr(seo.description),
        keywords: safeStr(seo.keywords),
        og_image: safeUrl(seo.og_image),
      },
      tech: safeArr(ws.tech),
    },
    financialProfile: {
      estimatedRevenue: safeStr(fp.estimatedRevenue),
      revenueRange: safeStr(fp.revenueRange),
      employeeRange: safeStr(fp.employeeRange),
      companySize: safeStr(fp.companySize),
      sector: safeStr(fp.sector),
      mainActivities: safeArr(fp.mainActivities),
      foundedYear: safeStr(fp.foundedYear),
    },
    competitiveIntel: {
      mainCompetitors: safeArr(ci.mainCompetitors),
      marketPosition: safeStr(ci.marketPosition),
      differentials: safeArr(ci.differentials),
    },
    legalCompliance: {
      certifications: safeArr(lc.certifications),
      lawsuits: safeArr(lc.lawsuits),
      environmentalIssues: safeArr(lc.environmentalIssues),
      debtSignals: safeArr(lc.debtSignals),
    },
    businessIntel: safeArr(raw.businessIntel),
    searchSources: safeArr(raw.searchSources).filter((u: string) => u.startsWith("http")),
    enrichedAt: new Date().toISOString(),
  };
}

function tryCloseBrackets(json: string): string | null {
  try {
    let s = json.trim();
    s = s.replace(/,\s*$/, '');

    const candidates: number[] = [];
    const qi = s.lastIndexOf('"');
    if (qi >= 0) candidates.push(qi);
    const bi = s.lastIndexOf('}');
    if (bi >= 0) candidates.push(bi);
    const ai = s.lastIndexOf(']');
    if (ai >= 0) candidates.push(ai);
    const ni = s.lastIndexOf('null');
    if (ni >= 0) candidates.push(ni + 3);
    const ti = s.lastIndexOf('true');
    if (ti >= 0) candidates.push(ti + 3);
    const fi = s.lastIndexOf('false');
    if (fi >= 0) candidates.push(fi + 4);

    const lastGoodIndex = candidates.length > 0 ? Math.max(...candidates) : -1;
    if (lastGoodIndex > 0 && lastGoodIndex < s.length - 1) {
      s = s.slice(0, lastGoodIndex + 1);
    }
    s = s.replace(/,\s*$/, '');

    let opens = 0, openb = 0;
    let inStr = false, escape = false;
    for (const ch of s) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') opens++;
      if (ch === '}') opens--;
      if (ch === '[') openb++;
      if (ch === ']') openb--;
    }

    while (openb > 0) { s += ']'; openb--; }
    while (opens > 0) { s += '}'; opens--; }
    return s;
  } catch {
    return null;
  }
}

async function fixJsonWithAI(brokenJson: string): Promise<any | null> {
  try {
    const openai = getOpenAI();
    const truncated = brokenJson.length > 12000 ? brokenJson.slice(0, 12000) + '...(truncated)' : brokenJson;
    const resp = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      temperature: 0,
      max_completion_tokens: 16000,
      messages: [
        {
          role: "system",
          content: "You are a JSON repair tool. The user will give you a malformed JSON string. Fix all syntax errors (unescaped quotes, trailing commas, unclosed brackets, etc.) and return ONLY the valid JSON. Do not add commentary, explanations, or markdown. Output must be parseable by JSON.parse()."
        },
        {
          role: "user",
          content: truncated
        }
      ],
    });
    const fixed = resp.choices?.[0]?.message?.content?.trim();
    if (!fixed) return null;
    const jsonMatch = fixed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (err: any) {
    console.error(`[AI-Enrichment] fixJsonWithAI falhou:`, err.message);
    return null;
  }
}

function sanitizeJson(raw: string): string {
  let s = raw;
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  s = s.replace(/\t/g, ' ');
  s = s.replace(/,\s*([\]}])/g, '$1');
  s = s.replace(/}\s*{/g, '},{');
  try { JSON.parse(s); return s; } catch {}

  const chars = [...s];
  const out: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (esc) { out.push(c); esc = false; continue; }
    if (c === '\\' && inStr) { out.push(c); esc = true; continue; }
    if (c === '"') {
      if (!inStr) {
        inStr = true;
        out.push(c);
      } else {
        let j = i + 1;
        while (j < chars.length && /\s/.test(chars[j])) j++;
        const next = chars[j];
        if (!next || next === ',' || next === '}' || next === ']' || next === ':') {
          inStr = false;
          out.push(c);
        } else {
          out.push('\\"');
        }
      }
      continue;
    }
    if (inStr && c === '\n') { out.push('\\n'); continue; }
    if (inStr && c === '\r') { continue; }
    out.push(c);
  }
  s = out.join('');
  try { JSON.parse(s); return s; } catch {}

  let depth = 0;
  inStr = false;
  esc = false;
  let lastOpen = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{' || c === '[') { depth++; lastOpen = i; }
    if (c === '}' || c === ']') depth--;
  }
  if (depth > 0) {
    for (let i = 0; i < depth; i++) {
      const lastComma = s.lastIndexOf(',');
      if (lastComma > lastOpen) {
        s = s.slice(0, lastComma) + s.slice(lastComma + 1);
      }
      const needBracket = s.lastIndexOf('[') > s.lastIndexOf(']');
      s += needBracket ? ']' : '}';
    }
  }

  return s;
}

function emptyResult(): AIEnrichmentResult & { _failReason?: string; _errorMessage?: string; _rawSnippet?: string } {
  return {
    validatedPhones: [],
    validatedEmails: [],
    decisionMakers: [],
    socialMedia: {},
    website: {},
    financialProfile: {},
    competitiveIntel: {},
    legalCompliance: {},
    businessIntel: [],
    searchSources: [],
    enrichedAt: new Date().toISOString(),
  };
}

export interface AssetAIEnrichmentResult {
  potencialValorizacao: {
    horizonte: string;
    fatores: string[];
    estimativa: string;
  };
  riscosIdentificados: Array<{
    tipo: string;
    descricao: string;
    severidade: string;
  }>;
  comparaveisMercado: Array<{
    descricao: string;
    preco: string;
    fonte: string;
  }>;
  ticketSugerido: {
    minimo: string;
    maximo: string;
    justificativa: string;
  };
  resumoExecutivo: string;
  oportunidadesEspecificas: string[];
  searchSources: string[];
  enrichedAt: string;
  _failReason?: string;
  _errorMessage?: string;
  _rawSnippet?: string;
}

export async function aiEnrichAsset(params: {
  title: string;
  type: string;
  location?: string;
  municipio?: string;
  estado?: string;
  areaHa?: number;
  priceAsking?: number;
  description?: string;
  camposEspecificos?: Record<string, any>;
}): Promise<AssetAIEnrichmentResult> {
  const {
    title, type, location, municipio, estado,
    areaHa, priceAsking, description, camposEspecificos,
  } = params;

  const loc = [municipio, estado, location].filter(Boolean).join(", ");
  const ce = camposEspecificos || {};
  const ativoComVigencia = anexarVigenciaCalculada({ ...params, camposEspecificos: ce });
  const vigenciaAlvara = type === "MINA" || !!ce.processoAnm
    ? contextoVigenciaMinerariaParaPrompt(obterVigenciaCalculada(ativoComVigencia))
    : "";

  const contextLines = [
    `Tipo: ${type}`,
    loc ? `Localização: ${loc}` : "",
    areaHa ? `Área: ${areaHa} ha` : "",
    priceAsking ? `Preço pedido: R$ ${priceAsking.toLocaleString("pt-BR")}` : "",
    description ? `Descrição: ${description.slice(0, 500)}` : "",
    ce.substancia ? `Substância mineral: ${ce.substancia}` : "",
    ce.processoAnm ? `Processo ANM: ${ce.processoAnm}` : "",
    ce.faseAnm ? `Fase ANM: ${ce.faseAnm}` : "",
    vigenciaAlvara,
    ce.culturas ? `Culturas: ${ce.culturas}` : "",
    ce.aptidaoAgricola ? `Aptidão agrícola: ${ce.aptidaoAgricola}` : "",
    ce.faturamentoAnual ? `Faturamento anual: ${ce.faturamentoAnual}` : "",
    ce.ebitda ? `EBITDA: ${ce.ebitda}` : "",
    ce.motivoVenda ? `Motivo da venda: ${ce.motivoVenda}` : "",
    ce.vgv ? `VGV: ${ce.vgv}` : "",
    ce.gestora ? `Gestora: ${ce.gestora}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `Você é um analista sênior de deal origination e M&A no Brasil, especializado em ativos reais (terras, mineração, imóveis, negócios).

Sua missão é pesquisar dados técnicos e documentados sobre o ativo abaixo.

═══════════════════════════════════════
ATIVO: ${title}
${contextLines}
═══════════════════════════════════════

ANÁLISE REQUERIDA:

1. POTENCIAL DE VALORIZAÇÃO
   - Horizonte de valorização (curto/médio/longo prazo)
   - Fatores que podem valorizar o ativo
   - Estimativa de valorização percentual

3. RISCOS IDENTIFICADOS
   - Riscos ambientais, legais, regulatórios, mercado, operacionais
   - Para cada risco: tipo, descrição e severidade (baixa/media/alta)

4. COMPARÁVEIS DE MERCADO
   - Ativos semelhantes vendidos recentemente no Brasil
   - Preço, localização e fonte da informação

5. TICKET SUGERIDO
   - Faixa de preço sugerida (mínimo e máximo) baseada em comparáveis
   - Justificativa

6. RESUMO EXECUTIVO
   - 2-3 parágrafos resumindo a oportunidade

7. OPORTUNIDADES ESPECÍFICAS
   - Oportunidades de valorização, desenvolvimento ou exploração

═══════════════════════════════════════
REGRAS:
- Use busca web para dados REAIS de mercado brasileiro
- Em ativo minerário, qualquer menção à vigência/validade/vencimento do alvará deve copiar somente a VIGÊNCIA CANÔNICA acima. Nunca recalcule pelos eventos ou pela web
- NÃO invente preços ou comparáveis
- Seja CONSERVADOR em estimativas
- Se não encontrar dado, use null
═══════════════════════════════════════

Responda EXCLUSIVAMENTE com JSON válido neste formato:
{
  "potencialValorizacao": {
    "horizonte": "médio prazo (3-5 anos)",
    "fatores": ["fator1", "fator2"],
    "estimativa": "20-30% em 5 anos"
  },
  "riscosIdentificados": [
    {"tipo": "ambiental", "descricao": "texto", "severidade": "media"}
  ],
  "comparaveisMercado": [
    {"descricao": "ativo similar", "preco": "R$ X", "fonte": "url ou referência"}
  ],
  "ticketSugerido": {
    "minimo": "R$ X",
    "maximo": "R$ Y",
    "justificativa": "texto"
  },
  "resumoExecutivo": "texto",
  "oportunidadesEspecificas": ["oportunidade1", "oportunidade2"],
  "searchSources": ["url1", "url2"]
}`;

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[AI-Asset-Enrich] Tentativa ${attempt}/${maxAttempts} — pesquisa web para "${title}"...`);
      const startTime = Date.now();

      const response = await getOpenAI().responses.create({
        model: "gpt-5.4",
        max_output_tokens: 16000,
        tools: [{
          type: "web_search_preview" as any,
          search_context_size: "medium" as any,
        }],
        instructions: "Você é um analista de deal origination brasileiro. Use a busca web para encontrar dados reais de mercado sobre o ativo. Responda APENAS com JSON válido, sem markdown. Seja CONCISO — cada campo textual no máximo 2 frases. Arrays no máximo 5 itens.",
        input: prompt,
      } as any);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[AI-Asset-Enrich] Pesquisa concluída em ${elapsed}s para "${title}" (tentativa ${attempt})`);

      let content = "";
      if (response.output) {
        for (const item of response.output as any[]) {
          if (item.type === "message" && item.content) {
            for (const block of item.content) {
              if (block.type === "output_text" || block.type === "text") {
                content += block.text || "";
              }
            }
          }
        }
      }

      if (!content) {
        console.error(`[AI-Asset-Enrich] Resposta vazia (tentativa ${attempt})`);
        if (attempt < maxAttempts) continue;
        return emptyAssetResult("empty_response");
      }

      let parsed: any;
      try {
        let jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          const firstBrace = content.indexOf('{');
          if (firstBrace >= 0) {
            console.log(`[AI-Asset-Enrich] JSON truncado detectado, tentando reparar brackets (tentativa ${attempt})`);
            const partial = content.slice(firstBrace);
            const repaired = tryCloseBrackets(partial);
            if (repaired) {
              try {
                parsed = JSON.parse(repaired);
              } catch {
                const fixed = await fixJsonWithAI(partial);
                if (fixed) parsed = fixed;
              }
            }
            if (parsed) {
              return normalizeAssetResult(parsed);
            }
          }
          console.error(`[AI-Asset-Enrich] JSON não encontrado (tentativa ${attempt})`);
          if (attempt < maxAttempts) continue;
          return emptyAssetResult("no_json_in_response", content.slice(0, 500));
        }
        let rawJson = jsonMatch[0];
        try {
          parsed = JSON.parse(rawJson);
        } catch (e1: any) {
          console.error(`[AI-Enrichment] JSON parse error (tentativa ${attempt}):`, e1.message, rawJson.slice(0, 200));
          const sanitized = sanitizeJson(rawJson);
          try {
            parsed = JSON.parse(sanitized);
          } catch {
            const bracketFixed = tryCloseBrackets(rawJson);
            if (bracketFixed) {
              try {
                parsed = JSON.parse(bracketFixed);
              } catch {
                parsed = null;
              }
            }
            if (!parsed) {
              const fixed = await fixJsonWithAI(rawJson);
              if (fixed) {
                parsed = fixed;
              } else {
                if (attempt < maxAttempts) continue;
                return emptyAssetResult("json_parse_error", rawJson.slice(0, 500));
              }
            }
          }
        }
      } catch (parseErr: any) {
        if (attempt < maxAttempts) continue;
        return emptyAssetResult("json_parse_error");
      }

      return normalizeAssetResult(parsed);
    } catch (err: any) {
      console.error(`[AI-Asset-Enrich] Erro (tentativa ${attempt}):`, err.message);
      if (attempt < maxAttempts) continue;
      return emptyAssetResult("api_error", undefined, err.message);
    }
  }

  return emptyAssetResult("max_attempts");
}

function normalizeAssetResult(raw: any): AssetAIEnrichmentResult {
  const pv = raw.potencialValorizacao && typeof raw.potencialValorizacao === "object" ? raw.potencialValorizacao : {};
  const ts = raw.ticketSugerido && typeof raw.ticketSugerido === "object" ? raw.ticketSugerido : {};

  return {
    potencialValorizacao: {
      horizonte: safeStr(pv.horizonte) || "médio prazo",
      fatores: safeArr(pv.fatores),
      estimativa: safeStr(pv.estimativa) || "Não estimado",
    },
    riscosIdentificados: (Array.isArray(raw.riscosIdentificados) ? raw.riscosIdentificados : [])
      .filter((r: any) => r && typeof r === "object" && safeStr(r.descricao))
      .map((r: any) => ({
        tipo: safeStr(r.tipo) || "geral",
        descricao: String(r.descricao).trim(),
        severidade: safeStr(r.severidade) || "media",
      })),
    comparaveisMercado: (Array.isArray(raw.comparaveisMercado || raw.comparaveisNercado) ? (raw.comparaveisMercado || raw.comparaveisNercado) : [])
      .filter((c: any) => c && typeof c === "object" && safeStr(c.descricao))
      .map((c: any) => ({
        descricao: String(c.descricao).trim(),
        preco: safeStr(c.preco) || "N/D",
        fonte: safeStr(c.fonte) || "busca web",
      })),
    ticketSugerido: {
      minimo: safeStr(ts.minimo) || "N/D",
      maximo: safeStr(ts.maximo) || "N/D",
      justificativa: safeStr(ts.justificativa) || "",
    },
    resumoExecutivo: safeStr(raw.resumoExecutivo) || "",
    oportunidadesEspecificas: safeArr(raw.oportunidadesEspecificas),
    searchSources: safeArr(raw.searchSources).filter((u: string) => u.startsWith("http")),
    enrichedAt: new Date().toISOString(),
  };
}

function emptyAssetResult(failReason?: string, rawSnippet?: string, errorMessage?: string): AssetAIEnrichmentResult {
  return {
    potencialValorizacao: { horizonte: "", fatores: [], estimativa: "" },
    riscosIdentificados: [],
    comparaveisMercado: [],
    ticketSugerido: { minimo: "N/D", maximo: "N/D", justificativa: "" },
    resumoExecutivo: "",
    oportunidadesEspecificas: [],
    searchSources: [],
    enrichedAt: new Date().toISOString(),
    _failReason: failReason,
    _rawSnippet: rawSnippet,
    _errorMessage: errorMessage,
  };
}
