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
const MODEL_MINI = "gpt-4o-mini";
const MODEL_FULL = "gpt-4o";

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

  const campos = ativo.camposEspecificos ?? {};
  const ctx = campos.contextoRegional || null;
  const embrapa = campos.embrapa || campos.enrichmentAgro || null;
  const enriquecimento = campos.enriquecimentoCompleto || {};
  const mapbiomas = enriquecimento.mapbiomas || null;
  const ndvi = campos.ndvi || null;
  const docs = (ativo.documentosJson || {}) as any;
  const attr = (ativo.attributesJson || {}) as any;

  const cafRows = await db.execute(sql.raw(
    `SELECT situacao, valor_credito, nome_programa, safra FROM norion_caf_registros WHERE asset_id = ${Number(assetId)} ORDER BY safra DESC LIMIT 10`
  )).then(r => r.rows).catch(() => []);

  const investors = await db.select().from(companyBuyerProfiles).where(eq(companyBuyerProfiles.orgId, orgId)).limit(20);

  const investorSummary = investors.map(inv => {
    const types = (inv.preferredTypes as string[]) || [];
    const regions = (inv.portfolioRegions as string[]) || [];
    return `- ID ${inv.companyId}: tipos=${types.join(",")}, regiões=${regions.join(",")}, área=${safeNum(inv.minAreaHa)}-${safeNum(inv.maxAreaHa)}ha, preço/ha=${safeNum(inv.minPricePerHa)}-${safeNum(inv.maxPricePerHa)}, geoScore mín=${safeNum(inv.minGeoScore)}`;
  }).join("\n");

  const cafSection = cafRows.length > 0
    ? `CAF / PRONAF (${cafRows.length} registros):\n${(cafRows as any[]).map((r: any) => `- ${r.nome_programa || "Programa"}: ${r.situacao || "N/D"}, Crédito: ${r.valor_credito ? formatBRL(r.valor_credito) : "N/D"}, Safra: ${r.safra || "N/D"}`).join("\n")}`
    : "CAF / PRONAF: Sem registros";

  const carSection = ativo.carCodImovel
    ? `CAR (Cadastro Ambiental Rural):\n- Código: ${ativo.carCodImovel}\n- Sobreposição com terra indígena: ${attr.carSobreposicaoTI ? "SIM ⚠️" : "Não"}\n- Sobreposição com UC: ${attr.carSobreposicaoUC ? "SIM ⚠️" : "Não"}`
    : "CAR: Não cadastrado";

  const anmSection = ativo.anmProcesso
    ? `ANM/MINERAÇÃO:\n- Processo: ${ativo.anmProcesso}\n- Substância: ${attr.anmSubstancia || "N/D"}\n- Fase: ${attr.anmFase || "N/D"}\n- Último evento: ${attr.anmUltimoEvento || "N/D"}`
    : "";

  const docsAvailable: string[] = [];
  if (docs.matricula) docsAvailable.push("Matrícula");
  if (docs.ccir) docsAvailable.push("CCIR");
  if (docs.itr) docsAvailable.push("ITR");
  if (docs.car) docsAvailable.push("CAR doc");
  if (docs.geo) docsAvailable.push("Georreferenciamento");
  if (docs.laudo) docsAvailable.push("Laudo Avaliação");
  if (Array.isArray(docs.certidoes) && docs.certidoes.length > 0) docsAvailable.push(`${docs.certidoes.length} certidões`);

  const prompt = `Você é um analista sênior de originação de deals em ativos rurais, minerários e M&A no Brasil.
Você trabalha para um fundo de investimento. Analise este ativo de forma completa, usando TODOS os dados fornecidos — não invente dados.
Seja direto, técnico e pragmático. Use números concretos quando disponíveis.

═══════════════════════════════════════
DADOS DO ATIVO
═══════════════════════════════════════

IDENTIFICAÇÃO:
- Tipo: ${ativo.type}
- Título: ${ativo.title}
- Descrição: ${ativo.description || "N/D"}
- Localização: ${ativo.municipio || "N/D"}, ${ativo.estado || "N/D"}
- Área total: ${safeNum(ativo.areaHa)} ha (útil: ${safeNum(ativo.areaUtil)} ha)
- Preço pedido: ${formatBRL(ativo.priceAsking)}${ativo.areaHa && ativo.priceAsking ? ` (${formatBRL(Math.round(Number(ativo.priceAsking) / Number(ativo.areaHa)))}/ha)` : ""}
- Status: ${ativo.statusAtivo || "ativo"}
- Matrícula: ${ativo.matricula || "N/D"}

GEOESPACIAL:
- Geo Score: ${safeNum(ativo.geoScore)}/100
- Altitude: ${safeNum(ativo.geoAltMed)}m (min: ${safeNum(ativo.geoAltMin)}m, max: ${safeNum(ativo.geoAltMax)}m)
- Declividade média: ${safeNum(ativo.geoDeclivityMed)}%
- Água: ${ativo.geoTemRio ? "Rio próximo" : "Sem rio"}${ativo.geoTemLago ? ", Lago próximo" : ""} (dist: ${safeNum(ativo.geoDistAguaM)}m)
- Energia: ${ativo.geoTemEnergia ? "Rede elétrica próxima" : "Sem rede"} (dist: ${safeNum(ativo.geoDistEnergiaM)}m)
- Rodovia: dist. ${safeNum(ativo.geoDistRodoviaM)}m
- Sede municipal: dist. ${safeNum(ativo.geoDistSedeM)}m

${embrapa ? `DADOS EMBRAPA/SOLO:
- Score Agro: ${safeNum(embrapa.scoreAgro)}/100
- Resumo: ${embrapa.resumo || "N/D"}
- pH: ${safeNum(embrapa.pH)}, Carbono orgânico: ${safeNum(embrapa.carbono)}
- Aptidão agrícola: ${embrapa.aptidao || "N/D"}
- Tipo de solo: ${embrapa.tipoSolo || embrapa.classe || "N/D"}` : "DADOS DE SOLO: Não disponível"}

${ndvi ? `VEGETAÇÃO (NDVI Sentinel):
- Valor: ${safeNum(ndvi.valor)} (${ndvi.classificacao || "N/D"})
- Data: ${ndvi.data || "N/D"}` : "NDVI: Não disponível"}

${mapbiomas ? `MAPBIOMAS:
- Uso/cobertura atual: ${mapbiomas.usoAtual || "N/D"}
- Bioma: ${mapbiomas.bioma || "N/D"}
- Alertas de desmatamento: ${safeNum(mapbiomas.alertasDesmatamento)}
- Área desmatada: ${safeNum(mapbiomas.areaDesmatadaHa)} ha` : "MAPBIOMAS: Não disponível"}

${campos.temEmbargoIbama !== undefined ? `IBAMA: ${campos.temEmbargoIbama ? "⚠️ COM EMBARGO ATIVO" : "✅ Sem embargo"}${campos.embargoIbama ? ` — ${JSON.stringify(campos.embargoIbama)}` : ""}` : "IBAMA: Não consultado"}

${carSection}

${anmSection}

${cafSection}

DOCUMENTAÇÃO DISPONÍVEL: ${docsAvailable.length > 0 ? docsAvailable.join(", ") : "Nenhuma documentação anexada"}

${ctx ? `PRODUÇÃO REGIONAL (${ctx.municipio}):
- Culturas principais: ${(ctx.culturas || []).slice(0, 8).map((c: any) => `${c.nome}: ${safeNum(c.areaColhida)}ha colhidos, produção ${safeNum(c.quantidade)} ton, ${formatBRL(c.valorProducao)} mil`).join("; ")}
- Total área colhida no município: ${safeNum(ctx.totalAreaColhida)} ha
- Total valor produção: ${formatBRL(ctx.totalValorProducao)} mil` : "PRODUÇÃO REGIONAL: Não disponível"}

═══════════════════════════════════════
PERFIS DE COMPRADORES (${investors.length})
═══════════════════════════════════════
${investorSummary || "Nenhum cadastrado"}

═══════════════════════════════════════
INSTRUÇÃO DE ANÁLISE
═══════════════════════════════════════

Gere a análise no formato abaixo. Cada seção deve ter 3-5 frases densas com dados concretos.

## 1. Potencial Produtivo (peso 25%)
Solo, NDVI, aptidão agrícola, altitude, declividade, tipo de cultura viável. Se houver dados Embrapa, analise pH e carbono. Se houver NDVI, interprete a saúde da vegetação. Estime produtividade potencial.

## 2. Contexto Regional & Infraestrutura (peso 20%)
Compare área do ativo com produção municipal. Analise acesso a água, energia, rodovias, distância da sede. Logística de escoamento.

## 3. Risco Ambiental & Regularização (peso 20%)
Embargos Ibama, desmatamento MapBiomas, bioma, situação do CAR, sobreposições com TI/UC. CAF/PRONAF pode indicar uso agrícola legítimo. Documentação disponível vs. necessária para due diligence.

## 4. Risco Financeiro & Precificação (peso 20%)
Preço/ha pedido vs. referências regionais. Cenários de valorização. Se há CAF/PRONAF, analise o histórico de crédito como indicador de produtividade. Liquidez do ativo.

## 5. Compatibilidade com Compradores (peso 15%)
Quais perfis são mais compatíveis (por tipo, região, faixa de preço, área). Estime % de aderência para os top 3.

## Score Final
| Dimensão | Score (0-10) |
|---|---|
| Potencial Produtivo | X |
| Contexto Regional | X |
| Risco Ambiental | X (invertido: 10=sem risco) |
| Risco Financeiro | X (invertido: 10=preço justo) |
| Compatibilidade | X |
| **Média Ponderada** | **X.X** |

## Recomendação
3 linhas: ação concreta recomendada para o deal originator (comprar, negociar, descartar, pedir mais dados, etc.).`;

  const response = await getOpenAI().chat.completions.create({
    model: MODEL_FULL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 3500,
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
    model: MODEL_FULL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 2500,
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
    model: MODEL_MINI,
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
    model: MODEL_MINI,
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

  const campos = ativo.camposEspecificos ?? {};
  const ctx = campos.contextoRegional || null;
  const embrapa = campos.embrapa || campos.enrichmentAgro || null;
  const enriquecimento = campos.enriquecimentoCompleto || {};
  const mapbiomas = enriquecimento.mapbiomas || null;
  const ndvi = campos.ndvi || null;
  const docs = (ativo.documentosJson || {}) as any;
  const attr = (ativo.attributesJson || {}) as any;

  const cafRows = await db.execute(sql.raw(
    `SELECT situacao, valor_credito, nome_programa, safra FROM norion_caf_registros WHERE asset_id = ${Number(assetId)} ORDER BY safra DESC LIMIT 5`
  )).then(r => r.rows).catch(() => []);

  const precoHa = ativo.areaHa && ativo.priceAsking ? formatBRL(Math.round(Number(ativo.priceAsking) / Number(ativo.areaHa))) : "N/D";

  const docsAvailable: string[] = [];
  if (docs.matricula) docsAvailable.push("Matrícula");
  if (docs.ccir) docsAvailable.push("CCIR");
  if (docs.itr) docsAvailable.push("ITR");
  if (docs.car) docsAvailable.push("CAR doc");
  if (docs.geo) docsAvailable.push("Georreferenciamento");
  if (docs.laudo) docsAvailable.push("Laudo Avaliação");
  if (Array.isArray(docs.certidoes) && docs.certidoes.length > 0) docsAvailable.push(`${docs.certidoes.length} certidões`);

  const dealsSummary = companyDeals.slice(0, 5).map(d =>
    `- "${d.title}" | Valor: ${formatBRL(d.amountEstimate)} | Prob: ${d.probability || "N/D"}%`
  ).join("\n") || "Nenhum deal anterior";

  const enrichment = (empresa.enrichmentData || {}) as any;
  const merged = enrichment.merged || enrichment.search || {};

  const prompt = `Você é um deal originator sênior especializado em ativos rurais, minerários e M&A no Brasil.
Gere um relatório de apresentação de oportunidade para enviar à empresa compradora.
Seja persuasivo mas fundamentado em dados. NUNCA invente dados.

═══════════════════════════════════════
ATIVO
═══════════════════════════════════════
- Tipo: ${ativo.type} | Título: ${ativo.title}
- Descrição: ${ativo.description || "N/D"}
- Local: ${ativo.municipio || "N/D"}, ${ativo.estado || "N/D"}
- Área total: ${safeNum(ativo.areaHa)} ha (útil: ${safeNum(ativo.areaUtil)} ha)
- Preço: ${formatBRL(ativo.priceAsking)} (${precoHa}/ha)
- Geo Score: ${safeNum(ativo.geoScore)}/100
- Altitude média: ${safeNum(ativo.geoAltMed)}m | Declividade: ${safeNum(ativo.geoDeclivityMed)}%
- Água: ${ativo.geoTemRio ? "Rio" : ""}${ativo.geoTemLago ? " Lago" : ""} (${safeNum(ativo.geoDistAguaM)}m) | Energia: ${ativo.geoTemEnergia ? "Sim" : "Não"} (${safeNum(ativo.geoDistEnergiaM)}m)
- CAR: ${ativo.carCodImovel || "N/D"}${attr.carSobreposicaoTI ? " ⚠️ Sobrep. TI" : ""}${attr.carSobreposicaoUC ? " ⚠️ Sobrep. UC" : ""}
${ativo.anmProcesso ? `- ANM: ${ativo.anmProcesso} | ${attr.anmSubstancia || "N/D"} | ${attr.anmFase || "N/D"}` : ""}
${embrapa ? `- Solo: Score ${safeNum(embrapa.scoreAgro)}/100 | Aptidão: ${embrapa.aptidao || "N/D"} | pH: ${safeNum(embrapa.pH)}` : ""}
${ndvi ? `- NDVI: ${safeNum(ndvi.valor)} (${ndvi.classificacao || "N/D"})` : ""}
${mapbiomas ? `- MapBiomas: ${mapbiomas.usoAtual || "N/D"} | Bioma: ${mapbiomas.bioma || "N/D"} | Alertas desmat.: ${safeNum(mapbiomas.alertasDesmatamento)}` : ""}
${campos.temEmbargoIbama !== undefined ? `- IBAMA: ${campos.temEmbargoIbama ? "⚠️ COM EMBARGO" : "✅ Sem embargo"}` : ""}
${cafRows.length > 0 ? `- CAF/PRONAF: ${cafRows.length} registros — ${(cafRows as any[]).map((r: any) => `${r.nome_programa}: ${r.situacao}, ${r.safra}`).join("; ")}` : ""}
- Documentação: ${docsAvailable.length > 0 ? docsAvailable.join(", ") : "Sem docs anexados"}

${ctx ? `PRODUÇÃO REGIONAL (${ctx.municipio}):
${(ctx.culturas || []).slice(0, 6).map((c: any) => `- ${c.nome}: ${safeNum(c.areaColhida)}ha, ${formatBRL(c.valorProducao)} mil`).join("\n")}
- VBP Total: ${formatBRL(ctx.totalValorProducao)} mil` : ""}

═══════════════════════════════════════
EMPRESA COMPRADORA
═══════════════════════════════════════
- ${empresa.legalName} (${empresa.tradeName || "sem fantasia"})
- CNPJ: ${empresa.cnpj || "N/D"} | Porte: ${empresa.porte || "N/D"}
- CNAE: ${empresa.cnaePrincipal || "N/D"}
- Capital Social: ${formatBRL((empresa as any).shareCapital)}
- Perfil Norion: ${(empresa as any).norionProfile || "N/D"}
${merged.website ? `- Website: ${merged.website}` : ""}
${buyerProfile ? `PERFIL DE COMPRADOR:
- Área preferida: ${safeNum(buyerProfile.minAreaHa)}-${safeNum(buyerProfile.maxAreaHa)} ha
- Preço/ha: ${safeNum(buyerProfile.minPricePerHa)}-${safeNum(buyerProfile.maxPricePerHa)}
- Tipos: ${((buyerProfile.preferredTypes as string[]) || []).join(", ") || "N/D"}
- Culturas: ${((buyerProfile.preferredCultures as string[]) || []).join(", ") || "N/D"}
- Regiões: ${((buyerProfile.portfolioRegions as string[]) || []).join(", ") || "N/D"}
- GeoScore mínimo: ${safeNum(buyerProfile.minGeoScore)}
- Docs completos: ${buyerProfile.requiresCompleteDocs ? "exige" : "flexível"}` : "Sem perfil de comprador"}

HISTÓRICO DE DEALS (${companyDeals.length}):
${dealsSummary}

═══════════════════════════════════════
FORMATO DO RELATÓRIO
═══════════════════════════════════════

## Resumo Executivo
2-3 linhas: por que este ativo é relevante para esta empresa. Destaque o fit principal.

## Compatibilidade Detalhada
Analise cada dimensão: área, tipo, região, preço/ha, culturas, GeoScore. Compare com o perfil do comprador.

## Potencial de Retorno
Baseado em dados regionais (produção, VBP), aptidão do solo, NDVI. Estime cenários: conservador, realista, otimista.

## Situação Ambiental & Regularização
CAR, embargos Ibama, MapBiomas, sobreposições TI/UC. CAF/PRONAF como evidência de uso legal. Documentação disponível vs. necessária.

## Análise de Risco
Riscos ambientais, documentais, financeiros, jurídicos. Bandeiras vermelhas. Se há ANM, analise conflito mineração vs. uso agrícola.

## Comparativo com Negociações Anteriores
Como este ativo se compara em área, preço, região e tipo com deals passados.

## Estratégia de Abordagem
- Curto prazo (1 semana): ações imediatas
- Médio prazo (2-4 semanas): negociação e due diligence

## Score de Compatibilidade
| Dimensão | Score |
|---|---|
| Área | X/10 |
| Localização | X/10 |
| Preço | X/10 |
| Qualidade (solo/geo) | X/10 |
| Regularização | X/10 |
| **Total** | **X.X/10** |`;

  const response = await getOpenAI().chat.completions.create({
    model: MODEL_FULL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    max_tokens: 3500,
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
    model: MODEL_MINI,
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

  const prompt = `Você é um analista sênior especializado em deal origination de ativos rurais e M&A no Brasil.
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
    model: MODEL_FULL,
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

  const campos = ativo.camposEspecificos ?? {};
  const ctx = campos.contextoRegional || null;
  const embrapa = campos.embrapa || campos.enrichmentAgro || null;
  const enriquecimento = campos.enriquecimentoCompleto || {};
  const mapbiomas = enriquecimento.mapbiomas || null;
  const ndvi = campos.ndvi || null;
  const docs = (ativo.documentosJson || {}) as any;
  const attr = (ativo.attributesJson || {}) as any;

  const cafRows = await db.execute(sql.raw(
    `SELECT situacao, valor_credito, nome_programa, safra FROM norion_caf_registros WHERE asset_id = ${Number(assetId)} ORDER BY safra DESC LIMIT 5`
  )).then(r => r.rows).catch(() => []);

  const similares = await db.select({
    id: assets.id,
    type: assets.type,
    title: assets.title,
    municipio: assets.municipio,
    estado: assets.estado,
    areaHa: assets.areaHa,
    priceAsking: assets.priceAsking,
    geoScore: assets.geoScore,
    areaUtil: assets.areaUtil,
    geoAltMed: assets.geoAltMed,
    geoDeclivityMed: assets.geoDeclivityMed,
  }).from(assets).where(
    and(
      eq(assets.orgId, orgId),
      eq(assets.type, ativo.type!),
      sql`${assets.id} != ${assetId}`
    )
  ).limit(30);

  const similaresList = similares.map(s => {
    const precoHa = s.areaHa && s.priceAsking ? (Number(s.priceAsking) / Number(s.areaHa)).toFixed(0) : "N/D";
    return `- #${s.id} "${s.title}" | ${s.municipio}/${s.estado} | ${safeNum(s.areaHa)}ha (útil: ${safeNum(s.areaUtil)}) | ${formatBRL(s.priceAsking)} | R$/ha: ${precoHa} | GeoScore: ${safeNum(s.geoScore)} | Alt: ${safeNum(s.geoAltMed)}m | Decliv: ${safeNum(s.geoDeclivityMed)}%`;
  }).join("\n");

  const precoHaAtual = ativo.areaHa && ativo.priceAsking ? (Number(ativo.priceAsking) / Number(ativo.areaHa)).toFixed(0) : "N/D";

  const docsCount = [docs.matricula, docs.ccir, docs.itr, docs.car, docs.geo, docs.laudo].filter(Boolean).length;

  const prompt = `Você é um avaliador sênior de ativos rurais, minerários e M&A no Brasil, com experiência em precificação para fundos de investimento.
Analise o preço deste ativo usando TODOS os dados disponíveis. Seja objetivo e transparente.

═══════════════════════════════════════
ATIVO ANALISADO
═══════════════════════════════════════
- Tipo: ${ativo.type} | Título: ${ativo.title}
- Descrição: ${ativo.description || "N/D"}
- Local: ${ativo.municipio || "N/D"}, ${ativo.estado || "N/D"}
- Área total: ${safeNum(ativo.areaHa)} ha (útil: ${safeNum(ativo.areaUtil)} ha)
- Preço pedido: ${formatBRL(ativo.priceAsking)} (R$ ${precoHaAtual}/ha)
- GeoScore: ${safeNum(ativo.geoScore)}/100
- Altitude: ${safeNum(ativo.geoAltMed)}m | Declividade: ${safeNum(ativo.geoDeclivityMed)}%
- Água: ${ativo.geoTemRio ? "Rio" : "Sem rio"} (${safeNum(ativo.geoDistAguaM)}m) | Energia: ${ativo.geoTemEnergia ? "Sim" : "Não"} (${safeNum(ativo.geoDistEnergiaM)}m)
- Rodovia: ${safeNum(ativo.geoDistRodoviaM)}m | Sede: ${safeNum(ativo.geoDistSedeM)}m
- CAR: ${ativo.carCodImovel || "N/D"}${attr.carSobreposicaoTI ? " ⚠️ TI" : ""}${attr.carSobreposicaoUC ? " ⚠️ UC" : ""}
${ativo.anmProcesso ? `- ANM: ${ativo.anmProcesso} | ${attr.anmSubstancia || "N/D"} | ${attr.anmFase || "N/D"}` : ""}
${embrapa ? `- Solo: Score ${safeNum(embrapa.scoreAgro)}/100 | Aptidão: ${embrapa.aptidao || "N/D"} | pH: ${safeNum(embrapa.pH)}` : ""}
${ndvi ? `- NDVI: ${safeNum(ndvi.valor)} (${ndvi.classificacao || "N/D"})` : ""}
${mapbiomas ? `- MapBiomas: ${mapbiomas.usoAtual || "N/D"} | Bioma: ${mapbiomas.bioma || "N/D"} | Alertas: ${safeNum(mapbiomas.alertasDesmatamento)}` : ""}
${campos.temEmbargoIbama !== undefined ? `- IBAMA: ${campos.temEmbargoIbama ? "⚠️ COM EMBARGO" : "✅ Sem embargo"}` : ""}
${cafRows.length > 0 ? `- CAF/PRONAF: ${cafRows.length} registros (crédito total: ${formatBRL((cafRows as any[]).reduce((s: number, r: any) => s + (Number(r.valor_credito) || 0), 0))})` : ""}
- Documentação: ${docsCount}/6 docs principais disponíveis

${ctx ? `PRODUÇÃO REGIONAL (${ctx.municipio}):
${(ctx.culturas || []).slice(0, 6).map((c: any) => `- ${c.nome}: ${safeNum(c.areaColhida)}ha, ${formatBRL(c.valorProducao)} mil, rend. ${c.quantidade && c.areaColhida ? (Number(c.quantidade) / Number(c.areaColhida)).toFixed(1) : "N/D"} ton/ha`).join("\n")}
- VBP total: ${formatBRL(ctx.totalValorProducao)} mil` : "Sem dados regionais IBGE PAM"}

═══════════════════════════════════════
ATIVOS SIMILARES (${similares.length} do tipo ${ativo.type})
═══════════════════════════════════════
${similaresList || "Nenhum similar encontrado"}

═══════════════════════════════════════
ANÁLISE SOLICITADA
═══════════════════════════════════════

## Posicionamento de Preço
Compare R$/ha com similares. Percentil de preço. Acima/abaixo da mediana e por quanto.

## Faixa de Preço Sugerida
- 🔻 Conservador: R$ X total (R$ Y/ha) — cenário pessimista
- ⚖️ Justo: R$ X total (R$ Y/ha) — valor de mercado
- 🔺 Otimista: R$ X total (R$ Y/ha) — cenário de valorização

## Fatores de Valorização
Água, energia, solo, aptidão, NDVI alto, proximidade rodovia, docs completos, CAF ativo (indica produtividade comprovada), bioma favorável, sem embargo.

## Fatores de Desconto
Embargo, sobreposição TI/UC, docs incompletos, declividade alta, sem água, distância de rodovia, alertas MapBiomas.

## Análise de Rentabilidade
Se há dados regionais, estime renda potencial/ha/ano baseado nas culturas do município. Compare com preço/ha para estimar payback.

## Transparência
- Amostra: ${similares.length} ativos similares
- Confiabilidade: ALTA (>10 similares) | MÉDIA (5-10) | BAIXA (<5)
- Limitações da análise

## Recomendação de Negociação
Preço inicial sugerido para oferta, preço-alvo, e preço máximo aceitável.`;

  const response = await getOpenAI().chat.completions.create({
    model: MODEL_FULL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 2500,
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
    model: MODEL_MINI,
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
    model: MODEL_FULL,
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

  const campos = ativo.camposEspecificos ?? {};
  const docs = (ativo.documentosJson || {}) as any;
  const enriquecimento = campos.enriquecimentoCompleto || {};
  const attr = (ativo.attributesJson || {}) as any;
  const embrapa = campos.embrapa || campos.enrichmentAgro || null;
  const mapbiomas = enriquecimento.mapbiomas || null;
  const ndvi = campos.ndvi || null;

  const cafRows = await db.execute(sql.raw(
    `SELECT situacao, valor_credito, nome_programa, safra FROM norion_caf_registros WHERE asset_id = ${Number(assetId)} ORDER BY safra DESC LIMIT 5`
  )).then(r => r.rows).catch(() => []);

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
  if (docs.geo) existingData.push("Georreferenciamento");

  const prompt = `Você é um advogado especialista em due diligence de ativos rurais, minerários e M&A no Brasil, assessorando um fundo de investimento.
Analise a documentação e dados disponíveis para este ativo. Gere um checklist completo e acionável.

═══════════════════════════════════════
ATIVO
═══════════════════════════════════════
- Tipo: ${ativo.type}
- Título: ${ativo.title}
- Descrição: ${ativo.description || "N/D"}
- Local: ${ativo.municipio || "N/D"}, ${ativo.estado || "N/D"}
- Área total: ${safeNum(ativo.areaHa)} ha (útil: ${safeNum(ativo.areaUtil)} ha)
- Preço: ${formatBRL(ativo.priceAsking)}
- Matrícula: ${ativo.matricula || "N/D"}
- CAR: ${ativo.carCodImovel || "N/D"}${attr.carSobreposicaoTI ? " ⚠️ SOBREPOSIÇÃO COM TERRA INDÍGENA" : ""}${attr.carSobreposicaoUC ? " ⚠️ SOBREPOSIÇÃO COM UC" : ""}
${ativo.anmProcesso ? `- ANM Processo: ${ativo.anmProcesso} | Substância: ${attr.anmSubstancia || "N/D"} | Fase: ${attr.anmFase || "N/D"} | Último evento: ${attr.anmUltimoEvento || "N/D"}` : ""}
${embrapa ? `- Solo/Aptidão: Score ${safeNum(embrapa.scoreAgro)}/100 | ${embrapa.aptidao || "N/D"}` : ""}
${ndvi ? `- NDVI: ${safeNum(ndvi.valor)} (${ndvi.classificacao || "N/D"})` : ""}
${mapbiomas ? `- MapBiomas: ${mapbiomas.usoAtual || "N/D"} | Bioma: ${mapbiomas.bioma || "N/D"} | Alertas desmatamento: ${safeNum(mapbiomas.alertasDesmatamento)} | Área desmatada: ${safeNum(mapbiomas.areaDesmatadaHa)} ha` : ""}
${campos.temEmbargoIbama !== undefined ? `- IBAMA: ${campos.temEmbargoIbama ? "⚠️ COM EMBARGO ATIVO" : "✅ Sem embargo"}` : "- IBAMA: Não consultado"}
${cafRows.length > 0 ? `- CAF/PRONAF: ${cafRows.length} registros — ${(cafRows as any[]).map((r: any) => `${r.nome_programa}: ${r.situacao} (${r.safra})`).join("; ")}` : "- CAF/PRONAF: Sem registros"}
- GeoScore: ${safeNum(ativo.geoScore)}/100
- Água: ${ativo.geoTemRio ? "Rio próximo" : "Sem rio"} (${safeNum(ativo.geoDistAguaM)}m)
- Status docs: ${ativo.docsStatus || "N/D"}

═══════════════════════════════════════
DADOS/DOCUMENTOS DISPONÍVEIS
═══════════════════════════════════════
${existingData.length > 0 ? existingData.map(d => `✅ ${d}`).join("\n") : "❌ Nenhum documento disponível"}

═══════════════════════════════════════
ANÁLISE SOLICITADA
═══════════════════════════════════════

## Índice de Prontidão
XX% — proporção de documentos obrigatórios disponíveis. Classifique: 🟢 Pronto (>80%) | 🟡 Parcial (50-80%) | 🔴 Insuficiente (<50%).

## Checklist Documental Obrigatório
Para cada documento obrigatório para o tipo "${ativo.type}":
| Status | Documento | Importância | Observação |
|---|---|---|---|
| ✅/❌ | Nome | CRÍTICO/IMPORTANTE | Risco se ausente ou como obter |

Considere: Matrícula atualizada, CCIR, ITR (últimos 5 anos), CAR, Georreferenciamento (SIGEF/INCRA), ART do georreferenciamento, Certidão negativa de ônus, Certidão de inteiro teor, Laudo de avaliação.
${ativo.type === "MINA" ? "Para MINA: Licença ambiental, Portaria de lavra ANM, PCA/PRAD, EIA/RIMA, Outorga de água." : ""}
${ativo.type === "NEGOCIO" ? "Para NEGÓCIO/M&A: Balanço patrimonial, DRE, contrato social, certidões negativas (federal, estadual, municipal, trabalhista)." : ""}

## Documentos Complementares
Documentos que agregam valor na negociação.

## Alertas Críticos
${attr.carSobreposicaoTI ? "⚠️ SOBREPOSIÇÃO COM TERRA INDÍGENA detectada no CAR — risco jurídico grave." : ""}
${attr.carSobreposicaoUC ? "⚠️ SOBREPOSIÇÃO COM UNIDADE DE CONSERVAÇÃO detectada — verificar tipo de UC e restrições." : ""}
${campos.temEmbargoIbama ? "⚠️ EMBARGO IBAMA ATIVO — verificar tipo, área embargada e possibilidade de regularização." : ""}
${mapbiomas && Number(mapbiomas.alertasDesmatamento) > 0 ? `⚠️ ${mapbiomas.alertasDesmatamento} alertas de desmatamento detectados no MapBiomas.` : ""}
Analise cada alerta com impacto jurídico e financeiro.

## Riscos Jurídicos & Financeiros
Riscos identificados com base nos documentos ausentes e alertas. Classifique cada risco: ALTO/MÉDIO/BAIXO.

## Plano de Ação Due Diligence
Sequência recomendada com prioridade, prazo estimado e responsável (comprador/vendedor/cartório/órgão público).

## Custo Estimado
Estimativa realista dos custos para completar a documentação (em R$).

## Parecer Preliminar
Recomendação: PROSSEGUIR / PROSSEGUIR COM RESSALVAS / NÃO PROSSEGUIR — com justificativa em 3 linhas.`;

  const response = await getOpenAI().chat.completions.create({
    model: MODEL_FULL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 3500,
  });

  return response.choices[0].message.content || "Análise de due diligence não disponível";
}

export async function suggestInvestorProfile(companyData: {
  legalName: string;
  tradeName?: string | null;
  cnpj?: string | null;
  cnaePrincipal?: string | null;
  cnaeSecundarios?: any;
  porte?: string | null;
  revenueEstimate?: number | null;
  shareCapital?: number | null;
  employeeCount?: string | null;
  address?: any;
  enrichmentData?: any;
}): Promise<{
  assetTypes: string[];
  ticketMin: number | null;
  ticketMax: number | null;
  regionsOfInterest: string[];
  buyerType: string;
  reasoning: string;
}> {
  const addr = companyData.address || {};
  const cnaesSec = Array.isArray(companyData.cnaeSecundarios)
    ? companyData.cnaeSecundarios.map((c: any) => typeof c === "string" ? c : c.description || c.text || JSON.stringify(c)).join("; ")
    : "";

  const prompt = `Você é um analista de M&A e deal origination no Brasil.
Com base nos dados reais desta empresa, sugira o perfil de investimento dela.

EMPRESA:
- Razão Social: ${companyData.legalName}
- Nome Fantasia: ${companyData.tradeName || "N/D"}
- CNPJ: ${companyData.cnpj || "N/D"}
- CNAE Principal: ${companyData.cnaePrincipal || "N/D"}
- CNAEs Secundários: ${cnaesSec || "N/D"}
- Porte: ${companyData.porte || "N/D"}
- Faturamento Estimado: ${companyData.revenueEstimate ? formatBRL(companyData.revenueEstimate) : "N/D"}
- Capital Social: ${companyData.shareCapital ? formatBRL(companyData.shareCapital) : "N/D"}
- Funcionários: ${companyData.employeeCount || "N/D"}
- Endereço: ${addr.city || "N/D"}, ${addr.state || "N/D"}

TIPOS DE ATIVO DISPONÍVEIS (use EXATAMENTE estes valores):
- TERRA (terra/fazenda)
- MINA (mineração)
- NEGOCIO (negócio/M&A)
- FII_CRI (FII/CRI)
- DESENVOLVIMENTO (desenvolvimento imobiliário)
- AGRO (agronegócio)
- ENERGIA (energia renovável)

REGIÕES: Use siglas de estados brasileiros (SP, MG, BA, MT, GO, etc.)

REGRAS IMPORTANTES:
- Baseie-se SOMENTE nos dados fornecidos. Não invente.
- Se o CNAE indica atividade agropecuária, sugira TERRA e/ou AGRO.
- Se indica indústria/comércio, sugira NEGOCIO.
- Se não há dados suficientes para inferir, deixe o campo vazio.
- Para ticket, baseie-se no capital social ou faturamento como referência. Se não há dados, retorne null.
- Para regiões, baseie-se no estado do endereço e estados vizinhos relevantes para a atividade.
- buyerType: "estrategico" se empresa operacional, "financeiro" se fundo/holding/investidor.

Responda EXCLUSIVAMENTE em JSON válido, sem markdown:
{
  "assetTypes": ["TIPO1", "TIPO2"],
  "ticketMin": 1000000,
  "ticketMax": 50000000,
  "regionsOfInterest": ["MG", "SP"],
  "buyerType": "estrategico",
  "reasoning": "Explicação curta em português de por que sugeriu esses valores"
}`;

  const response = await getOpenAI().chat.completions.create({
    model: MODEL_FULL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    max_tokens: 500,
  });

  const raw = response.choices[0].message.content || "{}";
  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const validTypes = ["TERRA", "MINA", "NEGOCIO", "FII_CRI", "DESENVOLVIMENTO", "AGRO", "ENERGIA"];
    const validStates = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];
    let tMin = typeof parsed.ticketMin === "number" && parsed.ticketMin > 0 ? parsed.ticketMin : null;
    let tMax = typeof parsed.ticketMax === "number" && parsed.ticketMax > 0 ? parsed.ticketMax : null;
    if (tMin && tMax && tMin > tMax) { const tmp = tMin; tMin = tMax; tMax = tmp; }
    return {
      assetTypes: Array.isArray(parsed.assetTypes) ? parsed.assetTypes.filter((t: string) => validTypes.includes(t)) : [],
      ticketMin: tMin,
      ticketMax: tMax,
      regionsOfInterest: Array.isArray(parsed.regionsOfInterest) ? parsed.regionsOfInterest.filter((r: string) => validStates.includes(r)) : [],
      buyerType: parsed.buyerType === "financeiro" ? "financeiro" : "estrategico",
      reasoning: parsed.reasoning || "Sugestão baseada nos dados da empresa",
    };
  } catch {
    return {
      assetTypes: [],
      ticketMin: null,
      ticketMax: null,
      regionsOfInterest: [],
      buyerType: "estrategico",
      reasoning: "Não foi possível gerar sugestão automática. Preencha manualmente.",
    };
  }
}


export interface AIBuyerRanking {
  taxId: string;
  scoreIA: number;
  justificativa: string;
  sinergias: string[];
  ressalvas: string[];
  recomendado: boolean;
}

export async function aiRankBuyers(
  assetData: {
    id: number;
    type: string;
    name: string;
    estado?: string | null;
    location?: string | null;
    areaHa?: number | null;
    priceAsking?: number | null;
    camposEspecificos?: any;
    geoScore?: number | null;
    docsStatus?: string | null;
    attributesJson?: any;
  },
  candidates: Array<{
    taxId: string;
    legalName: string;
    tradeName?: string | null;
    cnaePrincipal?: string | null;
    cnaeCode?: number | null;
    porte?: string | null;
    city?: string | null;
    state?: string | null;
    equity?: number | null;
    founded?: string | null;
    camada?: number;
    intelligentScore?: number | null;
    intelligentReason?: string | null;
  }>
): Promise<AIBuyerRanking[]> {
  if (candidates.length === 0) return [];

  const ce = assetData.camposEspecificos || {};
  const iaEnrich = ce.iaEnrichment || {};
  const attr = assetData.attributesJson || {};

  const assetContext = [
    `ATIVO: ${assetData.name} (ID ${assetData.id})`,
    `Tipo: ${assetData.type}`,
    assetData.location ? `Localização: ${assetData.location}` : null,
    assetData.estado ? `Estado: ${assetData.estado}` : null,
    assetData.areaHa ? `Área: ${assetData.areaHa} ha` : null,
    assetData.priceAsking ? `Preço: R$ ${Number(assetData.priceAsking).toLocaleString("pt-BR")}` : null,
    assetData.geoScore ? `GeoScore: ${assetData.geoScore}/100` : null,
    assetData.docsStatus ? `Documentação: ${assetData.docsStatus}` : null,
    ce.aptidaoAgricola ? `Aptidão agrícola: ${ce.aptidaoAgricola}` : null,
    ce.culturas ? `Culturas: ${ce.culturas}` : null,
    ce.substancia ? `Substância mineral: ${ce.substancia}` : null,
    ce.contextoRegional ? `Contexto regional: ${JSON.stringify(ce.contextoRegional).slice(0, 300)}` : null,
  ].filter(Boolean).join("\n");

  const iaContext = iaEnrich && !iaEnrich._failReason ? [
    iaEnrich.perfilIdealComprador ? `Perfil ideal comprador: ${JSON.stringify(iaEnrich.perfilIdealComprador).slice(0, 400)}` : null,
    iaEnrich.scoreAtratividade ? `Score atratividade: ${iaEnrich.scoreAtratividade}/100` : null,
    iaEnrich.riscosIdentificados?.length ? `Riscos: ${iaEnrich.riscosIdentificados.map((r: any) => `${r.tipo}(${r.severidade})`).join(", ")}` : null,
    iaEnrich.ticketSugerido ? `Ticket sugerido: ${iaEnrich.ticketSugerido.minimo} - ${iaEnrich.ticketSugerido.maximo}` : null,
    iaEnrich.comparaveisMercado ? `Comparáveis: ${JSON.stringify(iaEnrich.comparaveisMercado).slice(0, 300)}` : null,
    iaEnrich.diferenciais?.length ? `Diferenciais: ${iaEnrich.diferenciais.join(", ")}` : null,
  ].filter(Boolean).join("\n") : "";

  const embrapaStr = ce.embrapa ? `Dados Embrapa: ${JSON.stringify(ce.embrapa).slice(0, 300)}` : "";
  const ambientalStr = ce.analiseSobreposicoes ? `Sobreposições ambientais: ${JSON.stringify(ce.analiseSobreposicoes).slice(0, 200)}` : "";

  const candidatesList = candidates.slice(0, 20).map((c, i) => {
    return [
      `[${i + 1}] CNPJ: ${c.taxId}`,
      `Nome: ${c.tradeName || c.legalName}`,
      c.cnaePrincipal ? `CNAE: ${c.cnaePrincipal}` : null,
      c.porte ? `Porte: ${c.porte}` : null,
      c.state ? `Estado: ${c.state}` : null,
      c.city ? `Cidade: ${c.city}` : null,
      c.equity ? `Capital social: R$ ${Number(c.equity).toLocaleString("pt-BR")}` : null,
      c.founded ? `Fundada em: ${c.founded}` : null,
      c.camada ? `Camada: ${c.camada === 1 ? "comprador direto" : c.camada === 2 ? "fundo/trading" : "relacionado"}` : null,
      c.intelligentScore != null ? `Score algorítmico: ${c.intelligentScore}` : null,
    ].filter(Boolean).join(" | ");
  }).join("\n");

  const prompt = `Você é um analista sênior de deal origination e M&A em uma plataforma de originação de negócios imobiliários, agro, mineração e empresas no Brasil.

Analise cada empresa candidata abaixo e avalie sua compatibilidade como compradora/investidora para o ativo descrito.

═══ DADOS DO ATIVO ═══
${assetContext}
${iaContext ? `\n═══ INTELIGÊNCIA IA DO ATIVO ═══\n${iaContext}` : ""}
${embrapaStr ? `\n═══ DADOS EMBRAPA ═══\n${embrapaStr}` : ""}
${ambientalStr ? `\n═══ ANÁLISE AMBIENTAL ═══\n${ambientalStr}` : ""}

═══ EMPRESAS CANDIDATAS ═══
${candidatesList}

═══ INSTRUÇÕES ═══
Para CADA empresa, avalie:
1. Compatibilidade setorial (o CNAE e ramo da empresa fazem sentido para este tipo de ativo?)
2. Capacidade financeira (porte, capital social, adequação ao ticket do ativo)
3. Sinergia geográfica (proximidade ou interesse estratégico na região do ativo)
4. Potencial estratégico (verticalização, expansão, diversificação que o ativo proporcionaria)
5. Riscos ou ressalvas (empresa muito pequena, setor incompatível, região distante, etc.)

Responda EXATAMENTE neste formato JSON (array):
[
  {
    "taxId": "CNPJ da empresa",
    "scoreIA": 0-100,
    "justificativa": "2-3 frases em português explicando o racional",
    "sinergias": ["sinergia 1", "sinergia 2"],
    "ressalvas": ["ressalva 1"]
  }
]

Regras:
- Score 80-100: Match excelente, forte sinergia e capacidade
- Score 60-79: Bom match, com pontos positivos claros
- Score 40-59: Match razoável, vale investigar
- Score 20-39: Match fraco, poucas sinergias
- Score 0-19: Incompatível
- Seja criterioso e diferenciado nos scores — evite dar o mesmo score para todos
- Justificativas devem ser específicas, não genéricas
- Ordene do maior para o menor score`;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: MODEL_FULL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 4000,
    });

    const raw = response.choices[0].message.content || "[]";
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) return candidates.map(c => ({
      taxId: c.taxId, scoreIA: 50, justificativa: "Análise não disponível",
      sinergias: [], ressalvas: [], recomendado: false,
    }));

    const ranked: AIBuyerRanking[] = parsed.map((item: any) => ({
      taxId: String(item.taxId || ""),
      scoreIA: Math.max(0, Math.min(100, Number(item.scoreIA) || 50)),
      justificativa: String(item.justificativa || ""),
      sinergias: Array.isArray(item.sinergias) ? item.sinergias.map(String) : [],
      ressalvas: Array.isArray(item.ressalvas) ? item.ressalvas.map(String) : [],
      recomendado: false,
    }));

    ranked.sort((a, b) => b.scoreIA - a.scoreIA);
    ranked.forEach((r, i) => { if (i < 3 && r.scoreIA >= 60) r.recomendado = true; });

    return ranked;
  } catch (err) {
    console.error("aiRankBuyers error:", err);
    return candidates.map(c => ({
      taxId: c.taxId, scoreIA: 50, justificativa: "Erro na análise IA",
      sinergias: [], ressalvas: [], recomendado: false,
    }));
  }
}
