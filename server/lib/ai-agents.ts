import OpenAI from "openai";
import { db } from "../db";
import { assets, companies, companyBuyerProfiles, deals, errorReports } from "@shared/schema";
import { eq, and, gte, lte, ilike, sql } from "drizzle-orm";

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
Gere um resumo inteligente desta empresa. Seja objetivo, use apenas dados fornecidos.

EMPRESA:
- Razão Social: ${empresa.legalName}
- Nome Fantasia: ${empresa.tradeName || "N/D"}
- CNPJ: ${empresa.cnpj || "N/D"}
- Porte: ${empresa.porte || "N/D"}
- CNAE Principal: ${empresa.cnaePrincipal || "N/D"}
- Receita estimada: ${formatBRL((empresa as any).revenueEstimate)}
- Endereço: ${address.city || ""}, ${address.state || ""}
- Perfil Norion: ${(empresa as any).norionProfile || "N/D"}

PERFIL DE COMPRADOR:
${buyerInfo}

DEALS NO CRM (${companyDeals.length}):
${dealsSummary}

ATIVOS DISPONÍVEIS (${availableAssets.length} ativos):
${assetsList}

Gere o resumo neste formato:

## Dados Básicos
Porte, segmento, situação, localização.

## Histórico de Negociações
Quantidade de deals, valores, tipos de ativo de interesse.

## Padrão de Compra
Tamanho preferido, preço, cultura, velocidade de decisão.
Se não há dados suficientes, indique "dados insuficientes".

## Sinal de Intenção
Com base na atividade recente (visitas, aceites, rejeições):
🟢 ALTA | 🟡 MÉDIA | 🔴 BAIXA

## Top 5 Ativos Compatíveis
Liste os mais compatíveis dos ativos disponíveis, com motivo.

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
