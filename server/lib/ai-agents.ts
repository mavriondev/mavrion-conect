import OpenAI from "openai";
import { db } from "../db";
import { assets, companies, companyBuyerProfiles, deals, errorReports, leads, pipelineStages } from "@shared/schema";
import { eq, and, gte, lte, ilike, sql, desc } from "drizzle-orm";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}
const MODEL = "gpt-4o-mini";

function safeNum(v: any): string {
  if (v === null || v === undefined) return "N/D";
  return String(v);
}

function formatBRL(v: any): string {
  if (v === null || v === undefined) return "N/D";
  return `R$ ${Number(v).toLocaleString("pt-BR")}`;
}

// ═══════════════════════════════════════════════════════════
// 1. ANÁLISE DE ATIVO (5 dimensões + score)
// ═══════════════════════════════════════════════════════════

export async function analyzeAsset(assetId: number, orgId: number): Promise<string> {
  const [ativo] = await db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.orgId, orgId)));
  if (!ativo) throw new Error("Ativo não encontrado");

  const campos = (ativo.camposEspecificos || {}) as any;
  const ctx = campos.contextoRegional || null;
  const embrapa = campos.embrapa || campos.enrichmentAgro || null;
  const enriquecimento = campos.enriquecimentoCompleto || {};
  const mapbiomas = enriquecimento.mapbiomas || null;
  const ndvi = campos.ndvi || null;

  const investors = await db.select().from(companyBuyerProfiles).where(eq(companyBuyerProfiles.orgId, orgId)).limit(20);

  const investorSummary = investors.map(inv => {
    const types = (inv.preferredTypes as string[]) || [];
    const regions = (inv.portfolioRegions as string[]) || [];
    return `- ID ${inv.companyId}: tipos=${types.join(",")}, regiões=${regions.join(",")}, área=${safeNum(inv.minAreaHa)}-${safeNum(inv.maxAreaHa)}ha, preço/ha=${safeNum(inv.minPricePerHa)}-${safeNum(inv.maxPricePerHa)}, geoScore mín=${safeNum(inv.minGeoScore)}`;
  }).join("\n");

  const prompt = `Você é um analista sênior de ativos rurais e minerários no Brasil.
Analise este ativo em 5 dimensões. Seja objetivo, use dados fornecidos — não invente dados.

ATIVO:
- Tipo: ${ativo.type}
- Título: ${ativo.title}
- Localização: ${ativo.municipio || "N/D"}, ${ativo.estado || "N/D"}
- Área: ${safeNum(ativo.areaHa)} ha (útil: ${safeNum(ativo.areaUtil)} ha)
- Preço pedido: ${formatBRL(ativo.priceAsking)}
- Status: ${ativo.statusAtivo || "ativo"}
- Geo Score: ${safeNum(ativo.geoScore)}/100
- Altitude: ${safeNum(ativo.geoAltMed)}m (${safeNum(ativo.geoAltMin)}-${safeNum(ativo.geoAltMax)}m)
- Declividade média: ${safeNum(ativo.geoDeclivityMed)}%
- Água próxima: ${ativo.geoTemRio ? "Rio" : ""} ${ativo.geoTemLago ? "Lago" : ""} (${safeNum(ativo.geoDistAguaM)}m)
- Energia: ${ativo.geoTemEnergia ? "Sim" : "Não"} (${safeNum(ativo.geoDistEnergiaM)}m)

${embrapa ? `DADOS EMBRAPA/SOLO:
- Score Agro: ${safeNum(embrapa.scoreAgro)}/100
- Resumo: ${embrapa.resumo || "N/D"}
- pH: ${safeNum(embrapa.pH)}, Carbono: ${safeNum(embrapa.carbono)}
- Aptidão: ${embrapa.aptidao || "N/D"}` : "DADOS DE SOLO: Não disponível"}

${ndvi ? `NDVI: ${safeNum(ndvi.valor)} (${ndvi.classificacao || "N/D"})` : "NDVI: Não disponível"}

${mapbiomas ? `MAPBIOMAS:
- Uso atual: ${mapbiomas.usoAtual || "N/D"}
- Bioma: ${mapbiomas.bioma || "N/D"}
- Alertas desmatamento: ${safeNum(mapbiomas.alertasDesmatamento)}
- Área desmatada: ${safeNum(mapbiomas.areaDesmatadaHa)} ha` : "MAPBIOMAS: Não disponível"}

${campos.temEmbargoIbama !== undefined ? `IBAMA: ${campos.temEmbargoIbama ? "⚠️ COM EMBARGO" : "✅ Sem embargo"}` : "IBAMA: Não consultado"}

${ctx ? `PRODUÇÃO REGIONAL (${ctx.municipio}):
- Culturas: ${(ctx.culturas || []).slice(0, 5).map((c: any) => `${c.nome}: ${safeNum(c.areaColhida)}ha, ${formatBRL(c.valorProducao)} mil`).join("; ")}
- Total área colhida: ${safeNum(ctx.totalAreaColhida)} ha
- Total valor produção: ${formatBRL(ctx.totalValorProducao)} mil` : "PRODUÇÃO REGIONAL: Não disponível"}

PERFIS DE COMPRADORES (${investors.length}):
${investorSummary || "Nenhum cadastrado"}

Gere a análise neste formato:

## 1. Potencial Produtivo
Analise solo, NDVI, aptidão, altitude, declividade. Estime potencial.

## 2. Contexto Regional
Compare com produção municipal. Infraestrutura (água, energia).

## 3. Risco Ambiental
Embargos, desmatamento, MapBiomas, bioma.

## 4. Risco Financeiro
Preço/ha vs região, cenários otimista/realista/pessimista.

## 5. Compatibilidade com Compradores
Quais perfis de comprador são mais compatíveis e por quê.

## Score Final
Score 0-10 por dimensão e média ponderada.

## Recomendação
Máximo 3 linhas: ação recomendada.`;

  const response = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 2000,
  });

  return response.choices[0].message.content || "Análise não disponível";
}

// ═══════════════════════════════════════════════════════════
// 2. RESUMO INTELIGENTE DE EMPRESA
// ═══════════════════════════════════════════════════════════

export async function summarizeCompany(companyId: number, orgId: number): Promise<string> {
  const [empresa] = await db.select().from(companies).where(and(eq(companies.id, companyId), eq(companies.orgId, orgId)));
  if (!empresa) throw new Error("Empresa não encontrada");

  const [buyerProfile] = await db.select().from(companyBuyerProfiles).where(eq(companyBuyerProfiles.companyId, companyId));

  const companyDeals = await db.select().from(deals).where(and(eq(deals.companyId, companyId), eq(deals.orgId, orgId)));

  const availableAssets = await db.select({
    id: assets.id,
    type: assets.type,
    title: assets.title,
    municipio: assets.municipio,
    estado: assets.estado,
    areaHa: assets.areaHa,
    priceAsking: assets.priceAsking,
    statusAtivo: assets.statusAtivo,
    geoScore: assets.geoScore,
  }).from(assets).where(and(eq(assets.orgId, orgId), eq(assets.statusAtivo, "ativo"))).limit(30);

  const enrichment = (empresa.enrichmentData || {}) as any;
  const address = (empresa.address || {}) as any;

  const merged = enrichment.merged || enrichment.search || {};
  const social = merged.social || {};
  const emails = merged.emails || enrichment.search?.emails_from_search || [];
  const phones = merged.phones || enrichment.search?.phones_from_search || [];
  const website = merged.website || enrichment.search?.official_site || null;

  const contactInfo = [
    emails.length > 0 ? `- E-mails: ${emails.join(", ")}` : null,
    phones.length > 0 ? `- Telefones: ${phones.join(", ")}` : null,
    website ? `- Website: ${website}` : null,
    social.linkedin ? `- LinkedIn: ${social.linkedin}` : null,
    social.instagram ? `- Instagram: ${social.instagram}` : null,
    social.facebook ? `- Facebook: ${social.facebook}` : null,
  ].filter(Boolean).join("\n");

  const searchSnippets = (enrichment.search?.search_results || []).slice(0, 3)
    .map((r: any) => `- "${r.title}": ${r.snippet || ""}`.slice(0, 200))
    .join("\n");

  const dealsSummary = companyDeals.length > 0
    ? companyDeals.map(d => `- "${d.title}" | Estágio: ${d.stageId} | Valor: ${formatBRL(d.amountEstimate)} | Prob: ${d.probability || "N/D"}%`).join("\n")
    : "Nenhum deal registrado";

  const buyerInfo = buyerProfile
    ? `- Total deals: ${safeNum(buyerProfile.totalDeals)}
- Área preferida: ${safeNum(buyerProfile.minAreaHa)}-${safeNum(buyerProfile.maxAreaHa)} ha (média: ${safeNum(buyerProfile.avgAreaHa)})
- Preço/ha: ${safeNum(buyerProfile.minPricePerHa)}-${safeNum(buyerProfile.maxPricePerHa)} (média: ${safeNum(buyerProfile.avgPricePerHa)})
- Tipos preferidos: ${((buyerProfile.preferredTypes as string[]) || []).join(", ") || "N/D"}
- Culturas preferidas: ${((buyerProfile.preferredCultures as string[]) || []).join(", ") || "N/D"}
- Regiões: ${((buyerProfile.portfolioRegions as string[]) || []).join(", ") || "N/D"}
- Tempo médio decisão: ${safeNum(buyerProfile.avgDecisionDays)} dias
- Visitas (30d): ${safeNum(buyerProfile.visitsLast30Days)} | Aceites: ${safeNum(buyerProfile.acceptancesLast30Days)} | Rejeições: ${safeNum(buyerProfile.rejectionsLast30Days)}
- Docs: completos=${buyerProfile.requiresCompleteDocs ? "exige" : "não exige"}, pendentes=${buyerProfile.acceptsPendingDocs ? "aceita" : "não aceita"}`
    : "Perfil de comprador não cadastrado";

  const assetsList = availableAssets.slice(0, 10).map(a =>
    `- #${a.id} ${a.type} "${a.title}" | ${a.municipio}/${a.estado} | ${safeNum(a.areaHa)}ha | ${formatBRL(a.priceAsking)} | Score: ${safeNum(a.geoScore)}`
  ).join("\n");

  const prompt = `Você é um especialista em análise de empresas para o mercado de ativos rurais e M&A no Brasil.
Gere um resumo inteligente desta empresa. REGRA FUNDAMENTAL: use APENAS os dados fornecidos abaixo. NÃO invente dados, NÃO suponha informações que não estão aqui. Se um dado não foi fornecido, diga "Não disponível" em vez de inventar.

EMPRESA:
- Razão Social: ${empresa.legalName}
- Nome Fantasia: ${empresa.tradeName || "Não informado"}
- CNPJ: ${empresa.cnpj || "N/D"}
- Porte: ${empresa.porte || "N/D"}
- CNAE Principal: ${empresa.cnaePrincipal || "N/D"}
- Receita estimada: ${formatBRL((empresa as any).revenueEstimate)}
- Endereço completo: ${address.street || ""} ${address.number || ""}, ${address.district || ""}, ${address.city || ""}-${address.state || ""}, CEP ${address.zip || "N/D"}
- Perfil Norion: ${(empresa as any).norionProfile || "N/D"}

CONTATOS E PRESENÇA DIGITAL:
${contactInfo || "Nenhum contato disponível"}

INFORMAÇÕES ENCONTRADAS NA WEB:
${searchSnippets || "Nenhuma informação web disponível"}

PERFIL DE COMPRADOR:
${buyerInfo}

DEALS NO CRM (${companyDeals.length}):
${dealsSummary}

ATIVOS DISPONÍVEIS (${availableAssets.length} ativos):
${assetsList}

Gere o resumo neste formato:

## Dados Básicos
Razão social, CNPJ, porte, segmento (CNAE), situação, localização. Use SOMENTE dados acima.

## Contatos & Presença Digital
E-mails, telefones, redes sociais, website. Se não há dados, diga "Não disponível".

## O que Sabemos pela Web
Informações coletadas de fontes públicas sobre a empresa.

## Histórico de Negociações
Quantidade de deals no CRM, valores, tipos de ativo de interesse. Se zero, diga "Nenhuma negociação registrada".

## Padrão de Compra
Tamanho preferido, preço, cultura, velocidade de decisão.
Se não há dados suficientes, diga explicitamente "Dados insuficientes para determinar padrão".

## Sinal de Intenção
Com base na atividade recente (visitas, aceites, rejeições):
🟢 ALTA | 🟡 MÉDIA | 🔴 BAIXA — Se não há dados, diga "Sem dados de atividade".

## Top 5 Ativos Compatíveis
Liste os mais compatíveis dos ativos disponíveis, com motivo. Se não é possível determinar compatibilidade, explique por quê.

## Recomendação
Estratégia de abordagem e próximos passos.`;

  const response = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 1500,
  });

  return response.choices[0].message.content || "Resumo não disponível";
}

// ═══════════════════════════════════════════════════════════
// 3. BUSCA EM LINGUAGEM NATURAL
// ═══════════════════════════════════════════════════════════

export async function naturalLanguageSearch(query: string, orgId: number): Promise<{
  filtros: any;
  totalEncontrado: number;
  resultados: any[];
  insights: string;
}> {
  const filterPrompt = `Converta esta busca em filtros JSON para ativos rurais/minerários.

Busca: "${query}"

Retorne APENAS um JSON válido:
{
  "type": "TERRA" | "AGRO" | "MINA" | "FII_CRI" | "DESENVOLVIMENTO" | "NEGOCIO" | null,
  "areaMin": number | null,
  "areaMax": number | null,
  "estado": "MT" | "MS" | "GO" | "SP" | "MG" | "BA" | "PR" | "RS" | "SC" | "TO" | "PA" | "MA" | "PI" | "RO" | null,
  "municipio": string | null,
  "precoMin": number | null,
  "precoMax": number | null,
  "status": "ativo" | "pipeline" | "vendido" | null,
  "geoScoreMin": number | null
}

Regras:
- Preços em reais (R$ 5 milhões = 5000000)
- Área em hectares
- Se não mencionado, use null
- Retorne SOMENTE o JSON, sem texto adicional`;

  const filterResponse = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: filterPrompt }],
    temperature: 0.1,
    max_tokens: 300,
  });

  const filterText = (filterResponse.choices[0].message.content || "{}").trim();
  let filters: any;
  try {
    const jsonMatch = filterText.match(/\{[\s\S]*\}/);
    filters = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");
  } catch {
    filters = {};
  }

  const conditions: any[] = [eq(assets.orgId, orgId)];
  if (filters.type) conditions.push(eq(assets.type, filters.type));
  if (filters.estado) conditions.push(eq(assets.estado, filters.estado));
  if (filters.municipio) conditions.push(ilike(assets.municipio, `%${filters.municipio}%`));
  if (filters.areaMin) conditions.push(gte(assets.areaHa, filters.areaMin));
  if (filters.areaMax) conditions.push(lte(assets.areaHa, filters.areaMax));
  if (filters.precoMin) conditions.push(gte(assets.priceAsking, filters.precoMin));
  if (filters.precoMax) conditions.push(lte(assets.priceAsking, filters.precoMax));
  if (filters.status) conditions.push(eq(assets.statusAtivo, filters.status));
  if (filters.geoScoreMin) conditions.push(gte(assets.geoScore, filters.geoScoreMin));

  const resultados = await db.select({
    id: assets.id,
    type: assets.type,
    title: assets.title,
    municipio: assets.municipio,
    estado: assets.estado,
    areaHa: assets.areaHa,
    priceAsking: assets.priceAsking,
    statusAtivo: assets.statusAtivo,
    geoScore: assets.geoScore,
  }).from(assets).where(and(...conditions)).limit(30);

  const resultadosSummary = resultados.slice(0, 8).map(r =>
    `#${r.id} ${r.type} "${r.title}" | ${r.municipio}/${r.estado} | ${safeNum(r.areaHa)}ha | ${formatBRL(r.priceAsking)} | Score: ${safeNum(r.geoScore)}`
  ).join("\n");

  const insightPrompt = `Analise estes resultados de busca de ativos rurais/minerários.

Busca original: "${query}"
Filtros aplicados: ${JSON.stringify(filters)}
Total encontrado: ${resultados.length}

Resultados:
${resultadosSummary || "Nenhum resultado"}

Gere insights em 5-8 linhas:
1. Resumo do que foi encontrado
2. Padrão observado (localização, tamanho, preço)
3. Sugestão de busca alternativa se poucos resultados`;

  const insightResponse = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: insightPrompt }],
    temperature: 0.4,
    max_tokens: 300,
  });

  return {
    filtros: filters,
    totalEncontrado: resultados.length,
    resultados,
    insights: insightResponse.choices[0].message.content || "",
  };
}

// ═══════════════════════════════════════════════════════════
// 4. RELATÓRIO PERSONALIZADO (ATIVO + COMPRADOR)
// ═══════════════════════════════════════════════════════════

export async function generateReport(assetId: number, companyId: number, orgId: number): Promise<string> {
  const [ativo] = await db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.orgId, orgId)));
  const [empresa] = await db.select().from(companies).where(and(eq(companies.id, companyId), eq(companies.orgId, orgId)));
  if (!ativo) throw new Error("Ativo não encontrado");
  if (!empresa) throw new Error("Empresa não encontrada");

  const [buyerProfile] = await db.select().from(companyBuyerProfiles).where(eq(companyBuyerProfiles.companyId, companyId));
  const companyDeals = await db.select().from(deals).where(and(eq(deals.companyId, companyId), eq(deals.orgId, orgId)));

  const campos = (ativo.camposEspecificos || {}) as any;
  const ctx = campos.contextoRegional || null;
  const embrapa = campos.embrapa || campos.enrichmentAgro || null;

  const dealsSummary = companyDeals.slice(0, 5).map(d =>
    `- "${d.title}" | Valor: ${formatBRL(d.amountEstimate)} | Prob: ${d.probability || "N/D"}%`
  ).join("\n") || "Nenhum deal anterior";

  const prompt = `Você é um especialista em vendas de ativos rurais e M&A no Brasil.
Gere um relatório personalizado mostrando por que este ativo é relevante para esta empresa.
Seja persuasivo, mas honesto. Use apenas dados fornecidos.

ATIVO:
- Tipo: ${ativo.type} | Título: ${ativo.title}
- Local: ${ativo.municipio || "N/D"}, ${ativo.estado || "N/D"}
- Área: ${safeNum(ativo.areaHa)} ha | Preço: ${formatBRL(ativo.priceAsking)}
- Geo Score: ${safeNum(ativo.geoScore)}/100
- Status docs: ${ativo.docsStatus || "N/D"}
${embrapa ? `- Score Agro: ${safeNum(embrapa.scoreAgro)}/100 | Aptidão: ${embrapa.aptidao || "N/D"}` : ""}
${campos.temEmbargoIbama !== undefined ? `- IBAMA: ${campos.temEmbargoIbama ? "COM EMBARGO" : "Sem embargo"}` : ""}

${ctx ? `PRODUÇÃO REGIONAL (${ctx.municipio}):
${(ctx.culturas || []).slice(0, 5).map((c: any) => `- ${c.nome}: ${safeNum(c.areaColhida)}ha colhidos, ${formatBRL(c.valorProducao)} mil`).join("\n")}` : ""}

EMPRESA:
- ${empresa.legalName} (${empresa.tradeName || "sem fantasia"})
- CNPJ: ${empresa.cnpj || "N/D"} | Porte: ${empresa.porte || "N/D"}
${buyerProfile ? `- Área preferida: ${safeNum(buyerProfile.minAreaHa)}-${safeNum(buyerProfile.maxAreaHa)} ha
- Preço/ha preferido: ${safeNum(buyerProfile.minPricePerHa)}-${safeNum(buyerProfile.maxPricePerHa)}
- Tipos: ${((buyerProfile.preferredTypes as string[]) || []).join(", ") || "N/D"}
- Regiões: ${((buyerProfile.portfolioRegions as string[]) || []).join(", ") || "N/D"}` : ""}

HISTÓRICO DE DEALS (${companyDeals.length}):
${dealsSummary}

Gere o relatório neste formato:

## Resumo Executivo
Uma linha: por que este ativo combina com esta empresa.

## Compatibilidade
Como área, tipo, região e preço se alinham com o perfil do comprador.

## Potencial de Retorno
Estimativa baseada nos dados regionais e características do ativo.

## Análise de Risco
Ambiental, documental, financeiro. Bandeiras vermelhas se houver.

## Comparativo com Negociações Anteriores
Como este ativo se compara com deals passados da empresa.

## Próximos Passos
Curto prazo (1 semana), médio prazo (2-4 semanas).

## Score de Compatibilidade
Score 0-10 com justificativa.`;

  const response = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    max_tokens: 2000,
  });

  return response.choices[0].message.content || "Relatório não disponível";
}

// ═══════════════════════════════════════════════════════════
// 5. DIAGNÓSTICO DE ERROS
// ═══════════════════════════════════════════════════════════

export async function diagnoseError(errorId: number, orgId: number): Promise<string> {
  const [erro] = await db.select().from(errorReports).where(and(eq(errorReports.id, errorId), eq(errorReports.orgId, orgId)));
  if (!erro) throw new Error("Erro não encontrado");

  const prompt = `Você é um engenheiro de software sênior analisando um erro reportado em um sistema B2B de deal origination (imóveis rurais e M&A).
Explique este erro em linguagem simples para uma equipe de negócio que está testando o sistema.

ERRO:
- Título: ${erro.title}
- Descrição: ${erro.description || "N/D"}
- Módulo: ${erro.module || "N/D"}
- Página: ${erro.page || "N/D"}
- Prioridade: ${erro.priority || "N/D"}
- Status: ${erro.status || "N/D"}
- Tipo: ${erro.type || "N/D"}
- URL: ${erro.requestUrl || "N/D"}
- Método: ${erro.requestMethod || "N/D"}
- HTTP Status: ${erro.statusCode || "N/D"}
- User Agent: ${erro.userAgent || "N/D"}
${erro.errorStack ? `- Stack trace (primeiras 500 chars): ${String(erro.errorStack).slice(0, 500)}` : ""}

Gere o diagnóstico neste formato:

## O que aconteceu
Explique em 2-3 linhas simples, sem jargão técnico.

## Onde aconteceu
Qual funcionalidade/página foi afetada.

## Gravidade
🔴 CRÍTICO | 🟡 MÉDIO | 🟢 BAIXO — com justificativa.

## Possível Causa
O que provavelmente causou o problema.

## Impacto para o Usuário
O que o usuário experimenta quando este erro ocorre.

## Sugestão de Correção
O que a equipe técnica deveria investigar/corrigir.`;

  const response = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 800,
  });

  return response.choices[0].message.content || "Diagnóstico não disponível";
}

// ═══════════════════════════════════════════════════════════
// 6. LEAD SCORER (qualificação inteligente de leads)
// ═══════════════════════════════════════════════════════════

export async function scoreLeadAI(leadId: number, orgId: number): Promise<{ score: number; justificativa: string; ativoRecomendado: number | null }> {
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
  if (!lead) throw new Error("Lead não encontrado");

  const [empresa] = lead.companyId
    ? await db.select().from(companies).where(eq(companies.id, lead.companyId))
    : [null];

  const [buyerProfile] = lead.companyId
    ? await db.select().from(companyBuyerProfiles).where(eq(companyBuyerProfiles.companyId, lead.companyId))
    : [null];

  const availableAssets = await db.select({
    id: assets.id,
    type: assets.type,
    title: assets.title,
    municipio: assets.municipio,
    estado: assets.estado,
    areaHa: assets.areaHa,
    priceAsking: assets.priceAsking,
    geoScore: assets.geoScore,
  }).from(assets).where(and(eq(assets.orgId, orgId), eq(assets.statusAtivo, "ativo"))).limit(30);

  const enrichment = empresa ? (empresa.enrichmentData || {}) as any : {};
  const address = empresa ? (empresa.address || {}) as any : {};

  const assetsList = availableAssets.slice(0, 15).map(a =>
    `- #${a.id} ${a.type} "${a.title}" | ${a.municipio}/${a.estado} | ${safeNum(a.areaHa)}ha | ${formatBRL(a.priceAsking)} | GeoScore: ${safeNum(a.geoScore)}`
  ).join("\n");

  const prompt = `Você é um SDR sênior especializado em deal origination de ativos rurais e M&A no Brasil.
Qualifique este lead de 0 a 100 e recomende o melhor ativo disponível.

LEAD:
- Status: ${lead.status}
- Fonte: ${lead.source || "N/D"}
- Notas: ${lead.notes || "N/D"}

EMPRESA VINCULADA:
- Nome: ${empresa?.legalName || "N/D"}
- CNPJ: ${empresa?.cnpj || "N/D"}
- Porte: ${empresa?.porte || "N/D"}
- CNAE: ${empresa?.cnaePrincipal || "N/D"}
- Capital Social: ${formatBRL(enrichment.capitalSocial)}
- Localização: ${address.city || "N/D"}, ${address.state || "N/D"}
- Norion Profile: ${(empresa as any)?.norionProfile || "N/D"}

PERFIL DE COMPRADOR:
${buyerProfile ? `- Tipos: ${((buyerProfile.preferredTypes as string[]) || []).join(", ") || "N/D"}
- Área: ${safeNum(buyerProfile.minAreaHa)}-${safeNum(buyerProfile.maxAreaHa)} ha
- Preço/ha: ${safeNum(buyerProfile.minPricePerHa)}-${safeNum(buyerProfile.maxPricePerHa)}
- Regiões: ${((buyerProfile.portfolioRegions as string[]) || []).join(", ") || "N/D"}
- Total deals: ${safeNum(buyerProfile.totalDeals)}` : "Sem perfil de comprador"}

ATIVOS DISPONÍVEIS (${availableAssets.length}):
${assetsList}

Retorne APENAS um JSON válido:
{
  "score": <number 0-100>,
  "justificativa": "<3-5 linhas explicando o score>",
  "ativoRecomendadoId": <id do ativo mais compatível ou null>
}

Critérios de score:
- 80-100: empresa com porte adequado, CNAE compatível, perfil comprador ativo, match regional
- 50-79: parcialmente compatível, precisa nurturing
- 20-49: baixa compatibilidade, mas vale manter
- 0-19: sem fit aparente`;

  const response = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 400,
  });

  const text = (response.choices[0].message.content || "{}").trim();
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");
    return {
      score: Math.min(100, Math.max(0, Number(parsed.score) || 0)),
      justificativa: parsed.justificativa || "Sem justificativa disponível",
      ativoRecomendado: parsed.ativoRecomendadoId || null,
    };
  } catch {
    return { score: 50, justificativa: text.slice(0, 500), ativoRecomendado: null };
  }
}

// ═══════════════════════════════════════════════════════════
// 7. PRICING ADVISOR (sugestão de preço comparativa)
// ═══════════════════════════════════════════════════════════

export async function pricingAdvisor(assetId: number, orgId: number): Promise<string> {
  const [ativo] = await db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.orgId, orgId)));
  if (!ativo) throw new Error("Ativo não encontrado");

  const campos = (ativo.camposEspecificos || {}) as any;
  const ctx = campos.contextoRegional || null;

  const similares = await db.select({
    id: assets.id,
    type: assets.type,
    title: assets.title,
    municipio: assets.municipio,
    estado: assets.estado,
    areaHa: assets.areaHa,
    priceAsking: assets.priceAsking,
    geoScore: assets.geoScore,
  }).from(assets).where(
    and(
      eq(assets.orgId, orgId),
      eq(assets.type, ativo.type!),
      sql`${assets.id} != ${assetId}`
    )
  ).limit(30);

  const similaresList = similares.map(s => {
    const precoHa = s.areaHa && s.priceAsking ? (Number(s.priceAsking) / Number(s.areaHa)).toFixed(0) : "N/D";
    return `- #${s.id} "${s.title}" | ${s.municipio}/${s.estado} | ${safeNum(s.areaHa)}ha | ${formatBRL(s.priceAsking)} | R$/ha: ${precoHa} | GeoScore: ${safeNum(s.geoScore)}`;
  }).join("\n");

  const precoHaAtual = ativo.areaHa && ativo.priceAsking ? (Number(ativo.priceAsking) / Number(ativo.areaHa)).toFixed(0) : "N/D";

  const prompt = `Você é um avaliador sênior de ativos rurais e minerários no Brasil.
Analise o preço deste ativo comparando com similares e dados regionais. Seja objetivo e transparente sobre o tamanho da amostra.

ATIVO ANALISADO:
- Tipo: ${ativo.type} | Título: ${ativo.title}
- Local: ${ativo.municipio || "N/D"}, ${ativo.estado || "N/D"}
- Área: ${safeNum(ativo.areaHa)} ha
- Preço pedido: ${formatBRL(ativo.priceAsking)}
- Preço/ha pedido: R$ ${precoHaAtual}
- GeoScore: ${safeNum(ativo.geoScore)}/100
- Status docs: ${ativo.docsStatus || "N/D"}

${ctx ? `PRODUÇÃO REGIONAL (${ctx.municipio}):
${(ctx.culturas || []).slice(0, 5).map((c: any) => `- ${c.nome}: ${safeNum(c.areaColhida)}ha colhidos, produção R$ ${safeNum(c.valorProducao)} mil`).join("\n")}
- VBP total: R$ ${safeNum(ctx.vbpTotal)} mil` : "Sem dados regionais IBGE PAM"}

ATIVOS SIMILARES (${similares.length} do tipo ${ativo.type}):
${similaresList || "Nenhum similar encontrado"}

Gere a análise neste formato:

## Posicionamento de Preço
Onde este ativo se situa em relação aos similares.

## Faixa de Preço Sugerida
- 🔻 Conservador (preço mínimo): R$ X (R$ Y/ha)
- ⚖️ Justo (preço de mercado): R$ X (R$ Y/ha)
- 🔺 Otimista (teto): R$ X (R$ Y/ha)

## Fatores de Valorização
O que pode justificar preço acima da média.

## Fatores de Desconto
O que pode pressionar o preço para baixo.

## Transparência
Tamanho da amostra: ${similares.length} ativos.
Confiabilidade da estimativa: ALTA/MÉDIA/BAIXA.

## Recomendação
Precificação sugerida para negociação.`;

  const response = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 1200,
  });

  return response.choices[0].message.content || "Análise de preço não disponível";
}

// ═══════════════════════════════════════════════════════════
// 8. MONITOR DE ERROS INTELIGENTE (resumo de erros)
// ═══════════════════════════════════════════════════════════

export async function monitorErrors(orgId: number): Promise<string> {
  const erros = await db.select().from(errorReports)
    .where(eq(errorReports.orgId, orgId))
    .orderBy(desc(errorReports.createdAt))
    .limit(50);

  if (erros.length === 0) return "Nenhum erro registrado. Sistema operando normalmente. ✅";

  const errosSummary = erros.map(e => {
    return `- [${e.priority || "N/D"}] ${e.title} | ${e.module || "?"} | ${e.status} | URL: ${e.requestUrl || "N/D"} | HTTP ${e.statusCode || "?"} | ${e.createdAt ? new Date(e.createdAt).toISOString().slice(0, 10) : "?"}`;
  }).join("\n");

  const urlPatterns = new Map<string, number>();
  erros.forEach(e => {
    if (e.requestUrl) {
      const pattern = e.requestUrl.replace(/\/\d+/g, "/:id").replace(/\?.*/, "");
      urlPatterns.set(pattern, (urlPatterns.get(pattern) || 0) + 1);
    }
  });
  const topPatterns = [...urlPatterns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([url, count]) => `- ${url}: ${count}x`).join("\n");

  const statusCounts = { open: 0, resolved: 0, ignored: 0, other: 0 };
  erros.forEach(e => {
    if (e.status === "open") statusCounts.open++;
    else if (e.status === "resolved") statusCounts.resolved++;
    else if (e.status === "ignored") statusCounts.ignored++;
    else statusCounts.other++;
  });

  const prompt = `Você é um engenheiro de confiabilidade (SRE) analisando erros de um sistema B2B de deal origination.
Gere um resumo executivo inteligente dos erros recentes.

ESTATÍSTICAS:
- Total de erros recentes: ${erros.length}
- Abertos: ${statusCounts.open} | Resolvidos: ${statusCounts.resolved} | Ignorados: ${statusCounts.ignored}

PADRÕES DE URL MAIS FREQUENTES:
${topPatterns || "Nenhum padrão identificado"}

ERROS (últimos ${erros.length}):
${errosSummary}

Gere o resumo neste formato:

## Status Geral
🟢 Saudável | 🟡 Atenção | 🔴 Crítico — com justificativa.

## Top 3 Problemas
Agrupe erros similares e identifique os 3 mais impactantes.

## Padrões Identificados
Horários, endpoints, módulos com mais falhas.

## Erros 200 Mascarados
Identifique erros que retornaram HTTP 200 mas podem conter falha (HTML em vez de JSON, resposta vazia, etc).

## Ações Recomendadas
Lista priorizada do que a equipe técnica deveria resolver primeiro.

## Tendência
Os erros estão aumentando, diminuindo ou estáveis?`;

  const response = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 1200,
  });

  return response.choices[0].message.content || "Monitoramento não disponível";
}

// ═══════════════════════════════════════════════════════════
// 9. PIPELINE INTELLIGENCE (briefing executivo)
// ═══════════════════════════════════════════════════════════

export async function pipelineIntelligence(orgId: number): Promise<string> {
  const allDeals = await db.select().from(deals).where(eq(deals.orgId, orgId));
  const stages = await db.select().from(pipelineStages).where(eq(pipelineStages.orgId, orgId));

  if (allDeals.length === 0) return "Nenhum deal no pipeline. Comece adicionando oportunidades ao CRM.";

  const stageMap = new Map(stages.map(s => [s.id, s.name]));

  const dealsByStage = new Map<string, typeof allDeals>();
  allDeals.forEach(d => {
    const stageName = stageMap.get(d.stageId!) || `Estágio ${d.stageId}`;
    if (!dealsByStage.has(stageName)) dealsByStage.set(stageName, []);
    dealsByStage.get(stageName)!.push(d);
  });

  const now = new Date();
  const stalledDeals = allDeals.filter(d => {
    if (!d.createdAt) return false;
    const daysInStage = (now.getTime() - new Date(d.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    return daysInStage > 7;
  });

  const totalValue = allDeals.reduce((sum, d) => sum + (Number(d.amountEstimate) || 0), 0);
  const weightedValue = allDeals.reduce((sum, d) => sum + (Number(d.amountEstimate) || 0) * ((d.probability || 0) / 100), 0);

  const stagesSummary = [...dealsByStage.entries()].map(([stage, stageDeals]) => {
    const stageValue = stageDeals.reduce((s, d) => s + (Number(d.amountEstimate) || 0), 0);
    return `- ${stage}: ${stageDeals.length} deals | Valor: ${formatBRL(stageValue)}`;
  }).join("\n");

  const stalledSummary = stalledDeals.slice(0, 10).map(d => {
    const days = d.createdAt ? Math.floor((now.getTime() - new Date(d.createdAt).getTime()) / (1000 * 60 * 60 * 24)) : 0;
    return `- "${d.title}" | ${stageMap.get(d.stageId!) || "?"} | ${days} dias | ${formatBRL(d.amountEstimate)}`;
  }).join("\n");

  const byPriority = { urgent: 0, high: 0, medium: 0, low: 0 };
  allDeals.forEach(d => {
    const p = d.priority as keyof typeof byPriority;
    if (p in byPriority) byPriority[p]++;
  });

  const prompt = `Você é um diretor comercial analisando o pipeline de negócios de uma empresa de deal origination (ativos rurais e M&A).
Gere um briefing executivo claro e acionável.

PIPELINE:
- Total de deals: ${allDeals.length}
- Valor total: ${formatBRL(totalValue)}
- Valor ponderado (probabilidade): ${formatBRL(weightedValue)}
- Prioridade: Urgente=${byPriority.urgent}, Alta=${byPriority.high}, Média=${byPriority.medium}, Baixa=${byPriority.low}

DEALS POR ESTÁGIO:
${stagesSummary}

DEALS PARADOS (>7 dias no mesmo estágio): ${stalledDeals.length}
${stalledSummary || "Nenhum deal parado"}

Gere o briefing neste formato:

## Saúde do Pipeline
🟢 Saudável | 🟡 Atenção | 🔴 Crítico

## Resumo Executivo
3-4 linhas sobre o estado atual do pipeline.

## Funil de Conversão
Análise do fluxo entre estágios. Onde estão os gargalos?

## Deals Prioritários
Top 5 deals que precisam de atenção imediata e por quê.

## Receita Projetada
Estimativa de receita com base nos deals atuais e probabilidades.

## Recomendações
3-5 ações concretas para melhorar o pipeline.`;

  const response = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 1500,
  });

  return response.choices[0].message.content || "Briefing não disponível";
}

// ═══════════════════════════════════════════════════════════
// 10. DUE DILIGENCE DOCUMENTAL (checklist de documentos)
// ═══════════════════════════════════════════════════════════

export async function dueDiligenceCheck(assetId: number, orgId: number): Promise<string> {
  const [ativo] = await db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.orgId, orgId)));
  if (!ativo) throw new Error("Ativo não encontrado");

  const campos = (ativo.camposEspecificos || {}) as any;
  const docs = (ativo.documentosJson || {}) as any;
  const enriquecimento = campos.enriquecimentoCompleto || {};

  const existingData: string[] = [];
  if (campos.car || campos.carData || enriquecimento.sicar) existingData.push("CAR/SICAR");
  if (campos.cafData || campos.caf || enriquecimento.caf) existingData.push("CAF");
  if (campos.anm || enriquecimento.anm) existingData.push("ANM (Mineração)");
  if (campos.embrapa || campos.enrichmentAgro) existingData.push("Embrapa/Aptidão");
  if (campos.ndvi) existingData.push("NDVI Satellite");
  if (campos.contextoRegional) existingData.push("IBGE PAM Regional");
  if (campos.temEmbargoIbama !== undefined) existingData.push("IBAMA");
  if (enriquecimento.mapbiomas) existingData.push("MapBiomas");
  if (docs.certidoes && Array.isArray(docs.certidoes) && docs.certidoes.length > 0) existingData.push(`Certidões (${docs.certidoes.length})`);
  if (docs.laudo) existingData.push("Laudo de Avaliação");
  if (docs.ccir) existingData.push("CCIR");
  if (docs.itr) existingData.push("ITR");
  if (docs.car) existingData.push("CAR (doc)");
  if (docs.matricula) existingData.push("Matrícula");

  const prompt = `Você é um advogado especialista em due diligence de ativos rurais e minerários no Brasil.
Analise a documentação disponível para este ativo e gere um checklist completo de due diligence.

ATIVO:
- Tipo: ${ativo.type}
- Título: ${ativo.title}
- Local: ${ativo.municipio || "N/D"}, ${ativo.estado || "N/D"}
- Área: ${safeNum(ativo.areaHa)} ha
- Preço: ${formatBRL(ativo.priceAsking)}
- Status docs: ${ativo.docsStatus || "N/D"}

DADOS/DOCUMENTOS JÁ DISPONÍVEIS:
${existingData.length > 0 ? existingData.map(d => `✅ ${d}`).join("\n") : "Nenhum documento disponível"}

Gere o relatório neste formato:

## Índice de Prontidão
XX% — quantos dos documentos obrigatórios estão disponíveis.

## Documentos Obrigatórios
Para cada documento obrigatório para este tipo de ativo (${ativo.type}):
- ✅ ou ❌ | Nome do documento | Importância (CRÍTICO/IMPORTANTE/DESEJÁVEL)
- Se ausente, explique o risco e como obter.

## Documentos Complementares
Documentos que agregam valor mas não são obrigatórios.

## Riscos Identificados
Baseado nos documentos ausentes, quais são os riscos jurídicos e financeiros.

## Plano de Ação
Sequência recomendada para completar a documentação, com prioridade e prazo estimado.

## Custo Estimado
Estimativa dos custos para obter os documentos faltantes.`;

  const response = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 1500,
  });

  return response.choices[0].message.content || "Análise de due diligence não disponível";
}
