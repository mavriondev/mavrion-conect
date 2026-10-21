import { buildDossieDigest } from "./dossie-digest";
import OpenAI from "openai";
import { db } from "../db";
import { assets, companies, errorReports, mavrionCafRegistros } from "@shared/schema";
import { eq, and, gte, lte, ilike, sql, desc, getTableName } from "drizzle-orm";
import {
  anexarVigenciaCalculada,
  contextoVigenciaMinerariaParaPrompt,
  omitirTrechosDeVigenciaParaIa,
  obterVigenciaCalculada,
} from "./vigencia-alvara";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}
const MODEL_MINI = "gpt-5.4-mini";
const MODEL_FULL = "gpt-5.4";

/**
 * Monta a seção "DOCUMENTOS ANEXADOS" para injeção em prompts de IA,
 * reutilizando os textos extraídos dos anexos do ativo (mesmo orçamento da Due Diligence).
 */
export async function buildDocsAnexadosSection(
  assetId: number,
  orgId: number,
  opcoes: { omitirTrechosVigencia?: boolean } = {},
): Promise<{ secao: string; docsConsiderados: string[] }> {
  const { getTextosParaIA } = await import("./document-extract");
  const docsAnexados = await getTextosParaIA(assetId, orgId).catch(() => [] as Array<{ fileName: string; texto: string }>);

  const DOC_CHAR_BUDGET_TOTAL = 45_000;
  const DOC_CHAR_PER_DOC = 12_000;
  let budgetRestante = DOC_CHAR_BUDGET_TOTAL;
  const docsSections: string[] = [];
  const docsConsiderados: string[] = [];
  for (const doc of docsAnexados) {
    if (budgetRestante <= 500) break;
    const limite = Math.min(DOC_CHAR_PER_DOC, budgetRestante);
    const textoSeguro = opcoes.omitirTrechosVigencia
      ? omitirTrechosDeVigenciaParaIa(doc.texto)
      : doc.texto;
    const trecho = textoSeguro.length > limite
      ? textoSeguro.slice(0, limite) + "\n[... conteúdo truncado ...]"
      : textoSeguro;
    budgetRestante -= trecho.length;
    docsConsiderados.push(doc.fileName);
    docsSections.push(`--- DOCUMENTO: ${doc.fileName} ---\n${trecho}`);
  }

  const secao = docsSections.length > 0
    ? `
═══════════════════════════════════════
DOCUMENTOS ANEXADOS (CONTEÚDO LIDO PELA IA)
═══════════════════════════════════════
Os documentos abaixo foram anexados ao ativo e o texto deles foi extraído. USE este conteúdo na análise:
- Considere datas, números de processo, publicações (ex.: DOU), valores e condições encontrados nos textos ao avaliar alertas, riscos e o parecer.
- Cite o nome do arquivo quando um documento fundamentar uma conclusão.
- Se um documento anexado contradisser ou complementar os dados cadastrais, aponte isso explicitamente.
${opcoes.omitirTrechosVigencia ? "- Trechos capazes de induzir recálculo da vigência foram omitidos. Para validade/vencimento do alvará, use somente a VIGÊNCIA CANÔNICA." : ""}

${docsSections.join("\n\n")}
`
    : "";

  return { secao, docsConsiderados };
}

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
    `SELECT situacao, valor_credito, nome_programa, safra FROM ${getTableName(mavrionCafRegistros)} WHERE asset_id = ${Number(assetId)} ORDER BY safra DESC LIMIT 10`
  )).then(r => r.rows).catch(() => []);

  const { secao: secaoDocumentosAnexados } = await buildDocsAnexadosSection(
    assetId,
    orgId,
    { omitirTrechosVigencia: ativo.type === "MINA" || !!ativo.anmProcesso || !!campos.processoAnm },
  );

  const cafSection = cafRows.length > 0
    ? `CAF / PRONAF (${cafRows.length} registros):\n${(cafRows as any[]).map((r: any) => `- ${r.nome_programa || "Programa"}: ${r.situacao || "N/D"}, Crédito: ${r.valor_credito ? formatBRL(r.valor_credito) : "N/D"}, Safra: ${r.safra || "N/D"}`).join("\n")}`
    : "CAF / PRONAF: Sem registros";

  const carSection = ativo.carCodImovel
    ? `CAR (Cadastro Ambiental Rural):\n- Código: ${ativo.carCodImovel}\n- Sobreposição com terra indígena: ${attr.carSobreposicaoTI ? "SIM ⚠️" : "Não"}\n- Sobreposição com UC: ${attr.carSobreposicaoUC ? "SIM ⚠️" : "Não"}`
    : "CAR: Não cadastrado";

  const anmSection = ativo.anmProcesso
    ? `ANM/MINERAÇÃO:\n- Processo: ${ativo.anmProcesso}\n- Substância: ${attr.anmSubstancia || "N/D"}\n- Fase: ${attr.anmFase || "N/D"}`
    : "";

  const docsAvailable: string[] = [];
  if (docs.matricula) docsAvailable.push("Matrícula");
  if (docs.ccir) docsAvailable.push("CCIR");
  if (docs.itr) docsAvailable.push("ITR");
  if (docs.car) docsAvailable.push("CAR doc");
  if (docs.geo) docsAvailable.push("Georreferenciamento");
  if (docs.laudo) docsAvailable.push("Laudo Avaliação");
  if (Array.isArray(docs.certidoes) && docs.certidoes.length > 0) docsAvailable.push(`${docs.certidoes.length} certidões`);

  const dossieMineracao = buildDossieDigest(campos, [
    "fundiaria", "certidoes", "cfem", "barragens", "logistica",
    "tah", "restricoes", "sondagem", "geoquimica",
  ]);
  const ativoComVigencia = anexarVigenciaCalculada(ativo);
  const vigenciaMineraria = ativo.type === "MINA" || !!ativo.anmProcesso || !!campos.processoAnm
    ? contextoVigenciaMinerariaParaPrompt(obterVigenciaCalculada(ativoComVigencia))
    : "";

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
- Água: ${ativo.geoTemRio ? "Rio mapeado na propriedade" : "rio não detectado nas bases públicas (não confirma ausência)"}${ativo.geoTemLago ? ", Lago próximo" : ""} (dist: ${safeNum(ativo.geoDistAguaM)}m)
- Energia: ${ativo.geoTemEnergia ? "Rede elétrica mapeada a até 1 km" : "rede não detectada nas bases públicas (não confirma ausência)"} (dist: ${safeNum(ativo.geoDistEnergiaM)}m)
- Rodovia: dist. ${safeNum((ativo as any).geoDistRodoviaM)}m
- Sede municipal: dist. ${safeNum((ativo as any).geoDistSedeM)}m

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

${vigenciaMineraria}

${dossieMineracao}

${cafSection}

DOCUMENTAÇÃO DISPONÍVEL: ${docsAvailable.length > 0 ? docsAvailable.join(", ") : "Nenhuma documentação anexada"}
${secaoDocumentosAnexados}
${ctx ? `PRODUÇÃO REGIONAL (${ctx.municipio}):
- Culturas principais: ${(ctx.culturas || []).slice(0, 8).map((c: any) => `${c.nome}: ${safeNum(c.areaColhida)}ha colhidos, produção ${safeNum(c.quantidade)} ton, ${formatBRL(c.valorProducao)} mil`).join("; ")}
- Total área colhida no município: ${safeNum(ctx.totalAreaColhida)} ha
- Total valor produção: ${formatBRL(ctx.totalValorProducao)} mil` : "PRODUÇÃO REGIONAL: Não disponível"}

═══════════════════════════════════════


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

## 4. Risco Financeiro (peso 20%)
Se há CAF/PRONAF, analise o histórico de crédito como indicador de produtividade. Liquidez do ativo. NÃO inclua estimativas de valor, preços de mercado, cotações, comparáveis de preço ou qualquer sugestão de valoração.

## 5. Compatibilidade com Compradores (peso 15%)
Quais perfis são mais compatíveis (por tipo, região, faixa de preço, área). Estime % de aderência para os top 3.

## Score Final
| Dimensão | Score (0-10) |
|---|---|
| Potencial Produtivo | X |
| Contexto Regional | X |
| Risco Ambiental | X (invertido: 10=sem risco) |
| Risco Financeiro | X (invertido: 10=baixo risco) |
| Compatibilidade | X |
| **Média Ponderada** | **X.X** |

## Recomendação
3 linhas: ação concreta recomendada para o deal originator (comprar, negociar, descartar, pedir mais dados, etc.).`;

  const response = await getOpenAI().chat.completions.create({
    model: MODEL_FULL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_completion_tokens: 3500,
  });

  return response.choices[0].message.content || "Análise não disponível";
}

// ═══════════════════════════════════════════════════════════
// 2. RESUMO INTELIGENTE DE EMPRESA
// ═══════════════════════════════════════════════════════════

export async function summarizeCompany(companyId: number, orgId: number): Promise<string> {
  const [empresa] = await db.select().from(companies).where(and(eq(companies.id, companyId), eq(companies.orgId, orgId)));
  if (!empresa) throw new Error("Empresa não encontrada");

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
- Perfil Mavrion: ${(empresa as any).mavrionProfile || "N/D"}

CONTATOS E PRESENÇA DIGITAL:
${contactInfo || "Nenhum contato disponível"}

INFORMAÇÕES ENCONTRADAS NA WEB:
${searchSnippets || "Nenhuma informação web disponível"}



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
Descreva somente os dados cadastrais e financeiros disponíveis; não presuma histórico de negociações.

## Padrão de Compra
Tamanho preferido, preço, cultura, velocidade de decisão.
Se não há dados suficientes, diga explicitamente "Dados insuficientes para determinar padrão".

## Sinal de Intenção
Com base na atividade recente (visitas, aceites, rejeições):
🟢 ALTA | 🟡 MÉDIA | 🔴 BAIXA — Se não há dados, diga "Sem dados de atividade".

## Top 5 Ativos Compatíveis
Liste os mais compatíveis dos ativos disponíveis, com motivo. Se não é possível determinar compatibilidade, explique por quê.

NÃO inclua seções de recomendação, estratégia de abordagem ou próximos passos.`;

  const response = await getOpenAI().chat.completions.create({
    model: MODEL_FULL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_completion_tokens: 2500,
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
  "type": "TERRA" | "AGRO" | "MINA" | "DESENVOLVIMENTO" | "NEGOCIO" | null,
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
    max_completion_tokens: 300,
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
    max_completion_tokens: 300,
  });

  return {
    filtros: filters,
    totalEncontrado: resultados.length,
    resultados,
    insights: insightResponse.choices[0].message.content || "",
  };
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
    max_completion_tokens: 800,
  });

  return response.choices[0].message.content || "Diagnóstico não disponível";
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
    `SELECT situacao, valor_credito, nome_programa, safra FROM ${getTableName(mavrionCafRegistros)} WHERE asset_id = ${Number(assetId)} ORDER BY safra DESC LIMIT 5`
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

  const { secao: secaoDocumentosAnexados } = await buildDocsAnexadosSection(
    assetId,
    orgId,
    { omitirTrechosVigencia: ativo.type === "MINA" || !!ativo.anmProcesso || !!campos.processoAnm },
  );
  const ativoComVigencia = anexarVigenciaCalculada(ativo);
  const vigenciaMineraria = ativo.type === "MINA" || !!ativo.anmProcesso || !!campos.processoAnm
    ? contextoVigenciaMinerariaParaPrompt(obterVigenciaCalculada(ativoComVigencia))
    : "";

  const prompt = `Você é um avaliador sênior de ativos rurais, minerários e M&A no Brasil.
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
- Água: ${ativo.geoTemRio ? "Rio na propriedade" : "rio não detectado (não confirma ausência)"} (${safeNum(ativo.geoDistAguaM)}m) | Energia: ${ativo.geoTemEnergia ? "Sim (até 1 km)" : "não detectada (não confirma ausência)"} (${safeNum(ativo.geoDistEnergiaM)}m)
- Rodovia: ${safeNum((ativo as any).geoDistRodoviaM)}m | Sede: ${safeNum((ativo as any).geoDistSedeM)}m
- CAR: ${ativo.carCodImovel || "N/D"}${attr.carSobreposicaoTI ? " ⚠️ TI" : ""}${attr.carSobreposicaoUC ? " ⚠️ UC" : ""}
${ativo.anmProcesso ? `- ANM: ${ativo.anmProcesso} | ${attr.anmSubstancia || "N/D"} | ${attr.anmFase || "N/D"}` : ""}
${vigenciaMineraria}
${embrapa ? `- Solo: Score ${safeNum(embrapa.scoreAgro)}/100 | Aptidão: ${embrapa.aptidao || "N/D"} | pH: ${safeNum(embrapa.pH)}` : ""}
${ndvi ? `- NDVI: ${safeNum(ndvi.valor)} (${ndvi.classificacao || "N/D"})` : ""}
${mapbiomas ? `- MapBiomas: ${mapbiomas.usoAtual || "N/D"} | Bioma: ${mapbiomas.bioma || "N/D"} | Alertas: ${safeNum(mapbiomas.alertasDesmatamento)}` : ""}
${campos.temEmbargoIbama !== undefined ? `- IBAMA: ${campos.temEmbargoIbama ? "⚠️ COM EMBARGO" : "✅ Sem embargo"}` : ""}
${cafRows.length > 0 ? `- CAF/PRONAF: ${cafRows.length} registros (crédito total: ${formatBRL((cafRows as any[]).reduce((s: number, r: any) => s + (Number(r.valor_credito) || 0), 0))})` : ""}
- Documentação: ${docsCount}/6 docs principais disponíveis
${secaoDocumentosAnexados}
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
    max_completion_tokens: 2500,
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
    max_completion_tokens: 1200,
  });

  return response.choices[0].message.content || "Monitoramento não disponível";
}

export interface DeepIntelResult {
  proprietarios: Array<{
    nome: string;
    cpfCnpj?: string;
    papel: string;
    fonte: string;
    confianca: string;
  }>;
  contatos: Array<{
    tipo: string;
    valor: string;
    pessoa?: string;
    fonte: string;
    confianca: string;
    aviso?: string;
  }>;
  processos: Array<{
    tipo: string;
    numero?: string;
    descricao: string;
    status: string;
    fonte: string;
  }>;
  restricoes: Array<{
    tipo: string;
    descricao: string;
    severidade: string;
    fonte: string;
  }>;
  historicoPropriedade: Array<{
    evento: string;
    data?: string;
    detalhes: string;
    fonte: string;
  }>;
  resumoInvestigacao: string;
  recomendacaoAbordagem: string;
  fontesPesquisadas: string[];
  analyzedAt: string;
  insumosHash?: string;
}

export async function deepIntelligenceAnalysis(assetId: number, orgId: number): Promise<DeepIntelResult> {
  const [ativo] = await db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.orgId, orgId)));
  if (!ativo) throw new Error("Ativo não encontrado");

  const campos = (ativo.camposEspecificos ?? {}) as Record<string, any>;
  const attr = (ativo.attributesJson || {}) as Record<string, any>;
  const docs = (ativo.documentosJson || {}) as Record<string, any>;
  const enriq = campos.enriquecimentoCompleto || {};

  const cafProdutores = campos.cafProdutores || campos.cafData?.produtores || [];
  const cafData = campos.cafData || {};
  const sicorData = campos.sicorData || {};
  const agro = campos.agro || campos.embrapa || campos.enrichmentAgro || {};
  const ambiental = campos.ambiental || {};
  const mapbiomas = ambiental.mapbiomas || enriq.mapbiomas || {};
  const deter = ambiental.deter || {};
  const ndvi = campos.ndvi || agro.ndviSatveg || {};
  const sicarFields: Record<string, any> = {};
  for (const k of Object.keys(campos)) {
    if (k.startsWith("sicar")) sicarFields[k] = campos[k];
  }

  const cafRows = await db.execute(sql.raw(
    `SELECT situacao, valor_credito, nome_programa, safra, nome_beneficiario FROM ${getTableName(mavrionCafRegistros)} WHERE asset_id = ${Number(assetId)} ORDER BY safra DESC LIMIT 15`
  )).then(r => r.rows).catch(() => []);

  const sections: string[] = [];

  sections.push(`IDENTIFICAÇÃO DO ATIVO:
- ID: ${ativo.id}
- Tipo: ${ativo.type}
- Título: ${ativo.title}
- Descrição: ${ativo.description || "N/D"}
- Localização: ${ativo.municipio || "N/D"}, ${ativo.estado || "N/D"}
- Coordenadas: ${campos.latitude || "N/D"}, ${campos.longitude || "N/D"}
- Área total: ${safeNum(ativo.areaHa)} ha (útil: ${safeNum(ativo.areaUtil)} ha)
- Preço pedido: ${formatBRL(ativo.priceAsking)}${ativo.areaHa && ativo.priceAsking ? ` (${formatBRL(Math.round(Number(ativo.priceAsking) / Number(ativo.areaHa)))}/ha)` : ""}
- Status: ${ativo.statusAtivo || "ativo"}
- Matrícula: ${ativo.matricula || "N/D"}
- CAR: ${ativo.carCodImovel || "N/D"}
- Processo ANM: ${ativo.anmProcesso || "N/D"}
- Código IBGE: ${campos.codigoIbge || "N/D"}`);

  if (attr.carTitular) {
    sections.push(`TITULAR DO CAR: ${attr.carTitular}`);
  }
  if (Object.keys(sicarFields).length > 0) {
    sections.push(`DADOS SICAR:
- UF: ${sicarFields.sicarUf || "N/D"}
- Município: ${sicarFields.sicarMunicipio || "N/D"}
- Área SICAR: ${sicarFields.sicarArea || "N/D"} ha
- Tipo: ${sicarFields.sicarTipo || "N/D"}
- Status: ${sicarFields.sicarStatus || "N/D"}
- Condição: ${sicarFields.sicarCondicao || "N/D"}
- Módulo Fiscal: ${sicarFields.sicarModuloFiscal || "N/D"}
- Data Criação: ${sicarFields.sicarDataCriacao || "N/D"}
- Data Atualização: ${sicarFields.sicarDataAtualizacao || "N/D"}
- Fonte: ${sicarFields.sicarFonte || "N/D"}`);
  }

  if (cafProdutores.length > 0) {
    const prodList = (cafProdutores as any[]).slice(0, 10).map((p: any) =>
      `- Nome: ${p.nome || "N/D"} | CPF: ${p.cpfMascarado || "N/D"} | Situação: ${p.situacao || "N/D"} | Município: ${p.municipio || "N/D"} | Papel: ${p.grauParentesco || "N/D"} | Perfil: ${p.perfil || "N/D"} | PRONAF: ${p.enquadramentoPronaf ? "SIM" : "NÃO"} | Imóveis: ${p.numImoveis || "N/D"}`
    ).join("\n");
    sections.push(`PRODUTORES CAF VINCULADOS (${cafProdutores.length} pessoas):
${prodList}`);
  }

  if (cafRows.length > 0) {
    const cafList = (cafRows as any[]).map((r: any) =>
      `- ${r.nome_programa || "Programa"}: ${r.situacao || "N/D"} | Crédito: ${r.valor_credito ? formatBRL(r.valor_credito) : "N/D"} | Safra: ${r.safra || "N/D"} | Beneficiário: ${r.nome_beneficiario || "N/D"}`
    ).join("\n");
    sections.push(`REGISTROS CAF/PRONAF (${cafRows.length}):
${cafList}`);
  }

  if (sicorData.totalContratos > 0 || sicorData.totalValor > 0) {
    const topProd = (sicorData.topProdutos || []).slice(0, 8).map((p: any) =>
      `- ${p.produto}: ${p.contratos} contratos, Área: ${safeNum(p.area)} ha, Valor: ${formatBRL(p.valor)}`
    ).join("\n");
    sections.push(`CRÉDITO RURAL SICOR (município):
- Total contratos: ${safeNum(sicorData.totalContratos)}
- Total valor: ${formatBRL(sicorData.totalValor)}
${topProd ? `Principais produtos:\n${topProd}` : ""}`);
  }

  if (agro.solo || agro.scoreAgro) {
    const solo = agro.solo || {};
    sections.push(`DADOS AGRONÔMICOS (Embrapa/Solo):
- Score Agro: ${safeNum(agro.scoreAgro)}/100
- pH: ${safeNum(solo.phh2o || agro.pH)}
- Classe de solo: ${solo.soilClass || agro.tipoSolo || agro.classe || "N/D"}
- Argila: ${safeNum(solo.clay)}%, Areia: ${safeNum(solo.sand)}%
- CEC: ${safeNum(solo.cec)}
- Carbono orgânico: ${safeNum(solo.soc || agro.carbono)}
- Nitrogênio: ${safeNum(solo.nitrogen)}
${agro.resumo ? `- Resumo: ${agro.resumo}` : ""}
${agro.clima ? `- Clima: temp. ${safeNum(agro.clima.temperaturaMinMedia)}-${safeNum(agro.clima.temperaturaMaxMedia)}°C, precip. ${safeNum(agro.clima.precipitacaoMedia)} mm` : ""}`);
  }

  if (ndvi.valor || ndvi.value || ndvi.ndvi) {
    sections.push(`VEGETAÇÃO (NDVI):
- Valor: ${safeNum(ndvi.valor || ndvi.value || ndvi.ndvi)}
- Classificação: ${ndvi.classificacao || ndvi.classification || "N/D"}
- Data: ${ndvi.data || ndvi.date || "N/D"}`);
  }

  if (mapbiomas.usoAtual || mapbiomas.bioma) {
    sections.push(`MAPBIOMAS:
- Uso atual: ${mapbiomas.usoAtual || "N/D"}
- Bioma: ${mapbiomas.bioma || "N/D"}
- Alertas desmatamento: ${safeNum(mapbiomas.alertasDesmatamento)}
- Área desmatada: ${safeNum(mapbiomas.areaDesmatadaHa)} ha`);
  }

  if (deter.totalAlertas !== undefined) {
    sections.push(`DETER (INPE):
- Total alertas: ${safeNum(deter.totalAlertas)}
- Área desmatada: ${safeNum(deter.areaDesmatadaHa)} ha`);
  }

  if (campos.temEmbargoIbama !== undefined) {
    sections.push(`IBAMA: ${campos.temEmbargoIbama ? "⚠️ COM EMBARGO ATIVO" : "✅ Sem embargo"}${campos.embargoIbama ? ` — ${JSON.stringify(campos.embargoIbama)}` : ""}`);
  }

  sections.push(`GEOESPACIAL:
- Geo Score: ${safeNum(ativo.geoScore)}/100
- Altitude: ${safeNum(ativo.geoAltMed)}m (min: ${safeNum(ativo.geoAltMin)}m, max: ${safeNum(ativo.geoAltMax)}m)
- Declividade: ${safeNum(ativo.geoDeclivityMed || attr.geoDeclivMed)}%
- Água: ${ativo.geoTemRio ? "Rio mapeado na propriedade" : "rio não detectado nas bases públicas (não confirma ausência)"}${ativo.geoTemLago ? ", Lago" : ""} (dist: ${safeNum(ativo.geoDistAguaM || attr.geoDistAguaM)}m)
- Energia: ${ativo.geoTemEnergia ? "Rede mapeada a até 1 km" : "rede não detectada nas bases públicas (não confirma ausência)"} (dist: ${safeNum(ativo.geoDistEnergiaM || attr.geoDistEnergiaM)}m)
- Score Energia: ${attr.geoScoreEnergia || "N/D"}`);

  if (attr.carSobreposicaoTI || attr.carSobreposicaoUC) {
    sections.push(`⚠️ SOBREPOSIÇÕES:
${attr.carSobreposicaoTI ? "- SOBREPOSIÇÃO COM TERRA INDÍGENA" : ""}
${attr.carSobreposicaoUC ? "- SOBREPOSIÇÃO COM UNIDADE DE CONSERVAÇÃO" : ""}`);
  }

  const isMining = ativo.type === "MINA" || ativo.type === "MINERACAO" || ativo.type === "MINERIO" || ativo.type === "JAZIDA" || !!ativo.anmProcesso || !!campos.processoAnm;
  const anmLive = campos.anmLiveData || {};
  const anmFeatures = anmLive.features || [];

  if (ativo.anmProcesso || isMining) {
    const anmLines = [
      `ANM/MINERAÇÃO:`,
      `- Processo: ${ativo.anmProcesso || "N/D"}`,
      `- Substância: ${attr.anmSubstancia || "N/D"}`,
      `- Uso: ${attr.anmUso || "N/D"}`,
      `- Fase: ${attr.anmFase || "N/D"}`,
      `- Ano do processo: ${attr.anmAno || "N/D"}`,
      `- Titular/Requerente: ${attr.anmNome || "N/D"}`,
    ];

    if (anmFeatures.length > 0) {
      anmLines.push(`\nDADOS LIVE ANM (${anmFeatures.length} registros):`);
      for (const f of anmFeatures.slice(0, 5)) {
        anmLines.push(`- Processo: ${f.DSProcesso || f.PROCESSO || "N/D"} | Titular: ${f.NOME || "N/D"} | Substância: ${f.SUBS || "N/D"} | Fase: ${f.FASE || "N/D"} | Uso: ${f.USO || "N/D"} | Área: ${f.AREA_HA || "N/D"} ha | UF: ${f.UF || "N/D"}`);
      }
    }

    if (campos.anmAnalise) {
      anmLines.push(`\nANÁLISE ANM ANTERIOR (resumo): ${String(campos.anmAnalise).slice(0, 500)}`);
    }

    sections.push(anmLines.join("\n"));
  }

  const onboarding = campos.enrichment || {};
  const onboardingLines: string[] = [];
  const onboardingLabels: Record<string, string> = {
    aptidaoUso: "Aptidão de uso",
    topografia: "Topografia",
    acessoPrincipal: "Acesso principal",
    aguaDisponivel: "Água disponível",
    energiaEletrica: "Energia elétrica",
    benfeitorias: "Benfeitorias",
    aceitaPermuta: "Aceita permuta",
    situacaoDocumental: "Situação documental",
    possuiReservaLegal: "Possui reserva legal",
    observacoesQualitativas: "Observações qualitativas",
    substanciaMineral: "Substância mineral",
    faseExploracao: "Fase de exploração",
    reservaEstimada: "Reserva estimada",
    possuiLicencaAmbiental: "Possui licença ambiental",
    tipoLavra: "Tipo de lavra",
    infraestruturaLocal: "Infraestrutura local",
    setorAtuacao: "Setor de atuação",
    faturamentoAnual: "Faturamento anual",
    ebitda: "EBITDA",
    margemOperacional: "Margem operacional",
    qtdFuncionarios: "Qtd funcionários",
    motivoVenda: "Motivo da venda",
    possuiPassivos: "Possui passivos",
  };
  for (const [k, v] of Object.entries(onboarding)) {
    if (v === null || v === undefined || v === "" || k === "enrichmentProgress") continue;
    const label = onboardingLabels[k] || k;
    onboardingLines.push(`- ${label}: ${typeof v === "boolean" ? (v ? "Sim" : "Não") : String(v)}`);
  }
  if (onboardingLines.length > 0) {
    sections.push(`DADOS QUALITATIVOS (ONBOARDING - preenchidos pelo gestor):\n${onboardingLines.join("\n")}`);
  }

  if (campos.ccirProprietarios?.length > 0) {
    const propList = (campos.ccirProprietarios as any[]).slice(0, 10).map((p: any) =>
      `- ${p.nome || "N/D"} | CPF/CNPJ COMPLETO: ${p.cpfCnpj || "N/D"} | Participação: ${p.participacao || "N/D"}% | Município: ${p.municipio || "N/D"}`
    ).join("\n");
    sections.push(`PROPRIETÁRIOS CCIR/INCRA (${campos.ccirProprietarios.length}):\n${propList}
- Área INCRA: ${safeNum(campos.ccirAreaTotalIncra)} ha
- Módulos fiscais: ${safeNum(campos.ccirModulosFiscais)}
- Classificação fundiária: ${campos.ccirClassificacaoFundiaria || "N/D"}
- Código INCRA: ${campos.ccirCodigoIncra || "N/D"}`);

    if (cafProdutores.length > 0) {
      const crossMatches: string[] = [];
      for (const ccir of (campos.ccirProprietarios as any[])) {
        if (!ccir.cpfCnpj || !ccir.nome) continue;
        const ccirDoc = (ccir.cpfCnpj || '').replace(/\D/g, '');
        for (const caf of (cafProdutores as any[])) {
          if (!caf.cpfMascarado || !caf.nome) continue;
          const cafDocDigits = (caf.cpfMascarado || '').replace(/\D/g, '').replace(/\*/g, '');
          const namesMatch = ccir.nome.toLowerCase().includes(caf.nome.toLowerCase().split(' ')[0]) ||
            caf.nome.toLowerCase().includes(ccir.nome.toLowerCase().split(' ')[0]);
          const digitsMatch = cafDocDigits.length >= 3 && ccirDoc.includes(cafDocDigits.substring(0, 3));
          if (namesMatch || digitsMatch) {
            crossMatches.push(`- CAF "${caf.nome}" (CPF parcial: ${caf.cpfMascarado}) ↔ CCIR "${ccir.nome}" (CPF completo: ${ccir.cpfCnpj}) — MESMA PESSOA PROVÁVEL`);
          }
        }
      }
      if (crossMatches.length > 0) {
        sections.push(`CRUZAMENTO CAF × CCIR (identificação de mesma pessoa):\n${crossMatches.join("\n")}`);
      }
    }
  }

  if (campos.certidoesData) {
    const cert = campos.certidoesData as any;
    const certLines: string[] = [];
    if (cert.pgfn) certLines.push(`- PGFN: ${cert.pgfn.temDebitoAtivo ? "⚠️ COM DÉBITO ATIVO" : "✅ Sem débito"} | Situação: ${cert.pgfn.situacao || "N/D"}`);
    if (cert.cnj) certLines.push(`- CNJ: ${cert.cnj.totalProcessos || 0} processo(s) judiciais`);
    if (cert.ceis) certLines.push(`- CEIS: ${cert.ceis.sancionado ? "⚠️ SANCIONADA" : "✅ Sem sanções"}`);
    if (certLines.length > 0) {
      sections.push(`CERTIDÕES CONSULTADAS:\n${certLines.join("\n")}`);
    }
  }

  const dossieDeepIntel = buildDossieDigest(campos, ["fundiaria", "certidoes", "cfem", "barragens", "logistica", "tah", "restricoes", "sondagem", "geoquimica"]);
  if (dossieDeepIntel) {
    sections.push(dossieDeepIntel);
  }

  if (campos.cnpjaData) {
    const cnpja = campos.cnpjaData as any;
    const cnpjaLines = [
      `- Razão Social: ${cnpja.company?.name || cnpja.razaoSocial || "N/D"}`,
      `- CNPJ: ${cnpja.taxId || cnpja.cnpj || "N/D"}`,
      `- Situação: ${cnpja.status?.text || cnpja.situacao || "N/D"}`,
      `- Capital Social: ${cnpja.company?.equity ? formatBRL(cnpja.company.equity) : "N/D"}`,
    ];
    const socios = cnpja.company?.members || cnpja.socios || [];
    if (socios.length > 0) {
      cnpjaLines.push(`- Sócios (${socios.length}):`);
      for (const s of socios.slice(0, 5)) {
        cnpjaLines.push(`  · ${s.person?.name || s.nome || "N/D"} — ${s.role?.text || s.qualificacao || "N/D"}`);
      }
    }
    sections.push(`DADOS EMPRESARIAIS (CNPJA):\n${cnpjaLines.join("\n")}`);
  }

  if (campos.dueDiligenceFundiaria) {
    const dd = campos.dueDiligenceFundiaria as any;
    sections.push(`DUE DILIGENCE FUNDIÁRIA:
- Status: ${dd.status || "N/D"}
- Resumo: ${(dd.resumo || dd.analise || "").slice(0, 500)}`);
  }

  const docsAvailable: string[] = [];
  if (docs.matricula) docsAvailable.push("Matrícula");
  if (docs.ccir) docsAvailable.push("CCIR");
  if (docs.itr) docsAvailable.push("ITR");
  if (docs.car) docsAvailable.push("CAR doc");
  if (docs.geo) docsAvailable.push("Georreferenciamento");
  if (docs.laudo) docsAvailable.push("Laudo Avaliação");
  if (Array.isArray(docs.certidoes) && docs.certidoes.length > 0) docsAvailable.push(`${docs.certidoes.length} certidões`);
  sections.push(`DOCUMENTAÇÃO: ${docsAvailable.length > 0 ? docsAvailable.join(", ") : "Nenhuma anexada"}`);

  const { secao: secaoDocumentosAnexados } = await buildDocsAnexadosSection(
    assetId,
    orgId,
    { omitirTrechosVigencia: isMining },
  );
  if (secaoDocumentosAnexados) {
    sections.push(secaoDocumentosAnexados.trim());
  }

  if (campos.iaAnalise) {
    sections.push(`ANÁLISE IA ANTERIOR (resumo):
${omitirTrechosDeVigenciaParaIa(String(campos.iaAnalise)).slice(0, 800)}`);
  }

  if (campos.iaEnrichment) {
    const ie = campos.iaEnrichment;
    sections.push(`ENRIQUECIMENTO IA ANTERIOR:
- Resumo: ${omitirTrechosDeVigenciaParaIa(ie.resumoExecutivo || "").slice(0, 300)}
- Ticket sugerido: ${ie.ticketSugerido?.minimo || "N/D"} - ${ie.ticketSugerido?.maximo || "N/D"}`);
  }

  if (isMining) {
    const ativoComVigencia = anexarVigenciaCalculada({
      ...ativo,
      camposEspecificos: campos,
      attributesJson: attr,
    });
    sections.push(contextoVigenciaMinerariaParaPrompt(obterVigenciaCalculada(ativoComVigencia)));
  }

  const fullContext = sections.join("\n\n");

  // Cache determinístico por hash dos insumos: mesmo input ⇒ mesma investigação.
  // O hash usa só as seções de dados reais (insumos canônicos) — as seções
  // derivadas de saídas de IA anteriores (iaAnalise/iaEnrichment, regravadas
  // pela rota a cada análise) entram no prompt mas não no hash, senão o
  // cache se auto-invalidaria a cada execução.
  const { hashInsumos, secaoDataAtual: secaoData, validarContatosDeepIntel, insumosCanonicosDeepIntel } = await import("./ai-relatorio-determinismo");
  const insumosHash = hashInsumos(insumosCanonicosDeepIntel(sections));
  const cached = campos.iaDeepIntel;
  if (cached && typeof cached === "object" && cached.analyzedAt && campos.iaDeepIntelHash === insumosHash) {
    console.log(`[DeepIntel] Cache hit (hash dos insumos inalterado) para ativo ${assetId}`);
    return { ...cached, insumosHash } as DeepIntelResult;
  }

  const miningInstructions = isMining ? `
INSTRUÇÕES ESPECÍFICAS PARA ATIVO DE MINERAÇÃO/JAZIDA:

Este é um ativo minerário. A investigação deve focar ESPECIALMENTE em:

Para o TITULAR/REQUERENTE (empresa ou pessoa no campo NOME da ANM):
- Pesquise o nome "${attr.anmNome || ""}" + CNPJ/CPF na web
- Se for empresa: busque CNPJ na Receita Federal, quadro societário, capital social, situação cadastral
- Se for pessoa física: busque CPF, processos, endereço, telefone
- Pesquise no site da ANM (gov.br/anm) pelo processo ${ativo.anmProcesso || ""} para dados adicionais
- Busque no Diário Oficial publicações referentes a este processo ANM
- Pesquise sócios e representantes legais da empresa titular

Para o PROCESSO MINERÁRIO:
- Pesquise "${ativo.anmProcesso}" no sistema de processos da ANM
- Verifique a fase atual (${attr.anmFase || ""}) e o que isso implica legalmente
- Identifique se há outros processos minerários sobrepostos na mesma área
- Verifique se há TAH (Termo de Ajustamento de Conduta) ou multas pendentes
- Para vigência ou vencimento do alvará, cite SOMENTE a VIGÊNCIA CANÔNICA fornecida nos dados. Nunca recalcule a partir do histórico ou de pesquisa web
- Se a fase é "DISPONIBILIDADE" ou "APTO PARA DISPONIBILIDADE", explique que o direito pode ser requerido por terceiros

Para a SUBSTÂNCIA (${attr.anmSubstancia || ""}):
- Demanda atual e projeções
- Principais compradores/consumidores no Brasil

` : "";

  const ruralInstructions = !isMining ? `
INSTRUÇÕES ESPECÍFICAS PARA ATIVO RURAL/TERRA:

Faça uma investigação profunda usando pesquisa web. Para cada pessoa identificada nos dados CAF, SICAR, matrícula:
- Pesquise o nome completo + município para encontrar dados públicos
- Procure processos judiciais (TJ, JF, TST)
- Verifique se há restrições ambientais, trabalhistas ou fiscais
- Busque telefones e contatos em listas públicas, sites, redes sociais
- Cruze informações de múltiplas bases

Para o imóvel:
- Pesquise o número de matrícula no cartório da região
- Verifique leilões, hasta pública, execuções envolvendo o imóvel
- Verifique zoneamento e restrições de uso
` : "";

  const prompt = `Você é um investigador sênior de inteligência patrimonial e deal origination no Brasil, trabalhando para um fundo de investimento ${isMining ? "em ativos minerários, direitos minerários e M&A no setor de mineração" : "imobiliário e de M&A"}.

Sua missão é realizar uma INVESTIGAÇÃO COMPLETA sobre o ativo abaixo usando TODOS os dados enriquecidos disponíveis. Você deve cruzar informações de múltiplas fontes para identificar:
1. Quem é o real ${isMining ? "titular dos direitos minerários, sócios e representantes" : "proprietário/posseiro e pessoas ligadas"}
2. Telefones, e-mails e formas de contato de pessoas ligadas ao ativo
3. Processos judiciais ou administrativos envolvendo ${isMining ? "o processo minerário, a empresa titular e os sócios" : "o imóvel ou proprietários"}
4. Restrições, ônus, gravames ou impedimentos ${isMining ? "(incluindo multas ANM, TAHs, embargos ambientais)" : ""}
5. Histórico ${isMining ? "do processo minerário e transações de cessão" : "de propriedade e transações"}

Use ${isMining ? "o nome da empresa titular, processo ANM, CNPJ/CPF" : "os CPFs/CNPJs completos, nomes, números de matrícula, CAR, processos ANM"} e qualquer outro identificador para pesquisar na web informações públicas.

${secaoData()}

═══════════════════════════════════════
DADOS COMPLETOS DO ATIVO
═══════════════════════════════════════

${fullContext}

═══════════════════════════════════════
INSTRUÇÃO DE INVESTIGAÇÃO
═══════════════════════════════════════
${miningInstructions}${ruralInstructions}
═══════════════════════════════════════
FORMATO DE RESPOSTA
═══════════════════════════════════════

Responda EXCLUSIVAMENTE com JSON válido:
{
  "proprietarios": [
    {"nome": "Nome Completo", "cpfCnpj": "xxx.xxx.xxx-xx ou CNPJ", "papel": "${isMining ? "Titular/Sócio/Representante Legal/Geólogo Responsável" : "Proprietário/Posseiro/Cônjuge/Herdeiro"}", "fonte": "${isMining ? "ANM/Receita Federal/Junta Comercial/Pesquisa Web" : "CAF/SICAR/Matrícula/Pesquisa Web"}", "confianca": "alta/media/baixa"}
  ],
  "contatos": [
    {"tipo": "telefone/email/whatsapp/instagram/facebook/site", "valor": "(xx) xxxxx-xxxx", "pessoa": "Nome", "fonte": "fonte", "confianca": "alta/media/baixa"}
  ],
  "processos": [
    {"tipo": "${isMining ? "minerário/judicial/administrativo/ambiental/fiscal/trabalhista" : "judicial/administrativo/trabalhista/ambiental/fiscal"}", "numero": "nnn", "descricao": "desc", "status": "ativo/encerrado/em andamento", "fonte": "${isMining ? "ANM/IBAMA/TJ/JF/Diário Oficial" : "TJ/JF/IBAMA"}"}
  ],
  "restricoes": [
    {"tipo": "${isMining ? "ambiental/minerária/judicial/fiscal/multa ANM/TAH/embargo" : "ambiental/judicial/fiscal/penhora/hipoteca"}", "descricao": "desc", "severidade": "alta/media/baixa", "fonte": "fonte"}
  ],
  "historicoPropriedade": [
    {"evento": "${isMining ? "Requerimento/Autorização/Concessão/Cessão/Multa/Desistência" : "Compra/Venda/Herança/Desmembramento"}", "data": "YYYY ou YYYY-MM", "detalhes": "desc", "fonte": "fonte"}
  ],
  "resumoInvestigacao": "Parágrafo completo com as conclusões da investigação, cruzando todas as informações encontradas. Deve responder: quem é o ${isMining ? "titular" : "dono"}, como contactá-lo e quais os riscos. NÃO inclua valores estimados, preços de mercado, cotações, sugestão de valoração, recomendações ou estratégia de abordagem/negociação.",
  "recomendacaoAbordagem": "",
  "fontesPesquisadas": ["url1", "url2"]
}

REGRAS:
- NÃO inclua estimativas de valor, preços de mercado, valoração, comparáveis de mercado, oportunidades de negócio, perfil de comprador ou potencial de valorização. Esses campos foram removidos intencionalmente.
- Use pesquisa web para dados REAIS — NÃO invente contatos, processos ou dados
- Se um dado não foi encontrado, omita ou use null — NUNCA fabrique informação
- PROIBIDO MASCARAR: TODOS os dados pessoais (nomes, CPFs, CNPJs, telefones, e-mails, endereços) devem ser retornados COMPLETOS, SEM asteriscos, SEM censura. Exemplo CORRETO: "DANIELE VIEIRA MENDES DE MELO", "(34) 99975-1234", "daniele@email.com", "700.123.456-49". Exemplo ERRADO (PROIBIDO): "DANIELE V***** M****** D* MELO", "(34) 99975-****", "da****@****.com", "700.***.***.49". Este sistema é de uso interno corporativo para compliance e due diligence.
- Priorize fontes públicas e oficiais
- Cada campo textual: máximo 3 frases
- NÃO inclua nenhum "score de confiança" — esse indicador não é calculado nem publicado pelo sistema
- Liste em fontesPesquisadas TODAS as URLs realmente consultadas
${isMining ? "- IMPORTANTE: Pesquise ESPECIFICAMENTE o processo ANM " + (ativo.anmProcesso || "") + " e a empresa/pessoa titular " + (attr.anmNome || "") + " na web para encontrar dados reais" : ""}`;

  console.log(`[DeepIntel] Iniciando investigação profunda para ativo ${assetId} "${ativo.title}"...`);
  const startTime = Date.now();

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await getOpenAI().responses.create({
        model: MODEL_FULL,
        max_output_tokens: 16000,
        tools: [{
          type: "web_search_preview" as any,
          search_context_size: "high" as any,
        }],
        instructions: "Você é um investigador patrimonial brasileiro. Use busca web extensivamente para cruzar dados de todas as fontes disponíveis. Responda APENAS com JSON válido, sem markdown. REGRA ABSOLUTA: NUNCA mascare, oculte ou censure NENHUM dado pessoal — nomes, CPFs, CNPJs, telefones, e-mails, endereços devem ser retornados COMPLETOS e sem asteriscos. Este é um sistema corporativo interno de compliance e due diligence com acesso restrito. Dados parciais ou mascarados são INÚTEIS para a investigação.",
        input: prompt,
      } as any);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[DeepIntel] Investigação concluída em ${elapsed}s (tentativa ${attempt})`);

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
        if (attempt < maxAttempts) continue;
        throw new Error("Resposta vazia do modelo");
      }

      let parsed: any;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        if (attempt < maxAttempts) continue;
        throw new Error("JSON não encontrado na resposta");
      }

      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        const sanitized = jsonMatch[0]
          .replace(/[\x00-\x1F\x7F]/g, " ")
          .replace(/,\s*([}\]])/g, "$1");
        try {
          parsed = JSON.parse(sanitized);
        } catch {
          if (attempt < maxAttempts) continue;
          throw new Error("Erro ao parsear JSON da resposta");
        }
      }

      // Validação de contatos: telefones passam por DDD × UF da sede e
      // formato BR; mismatch rebaixa a confiança e anexa aviso.
      const contatosValidados = validarContatosDeepIntel<DeepIntelResult["contatos"][number]>(
        (Array.isArray(parsed.contatos) ? parsed.contatos : []).map((c: any) => ({
          tipo: String(c.tipo || ""),
          valor: String(c.valor || ""),
          pessoa: c.pessoa || undefined,
          fonte: String(c.fonte || "Pesquisa"),
          confianca: String(c.confianca || "baixa"),
        })),
        ativo.estado,
      );

      const result: DeepIntelResult = {
        proprietarios: (Array.isArray(parsed.proprietarios) ? parsed.proprietarios : []).map((p: any) => ({
          nome: String(p.nome || ""),
          cpfCnpj: p.cpfCnpj || undefined,
          papel: String(p.papel || "Não identificado"),
          fonte: String(p.fonte || "Pesquisa"),
          confianca: String(p.confianca || "baixa"),
        })),
        contatos: contatosValidados,
        processos: (Array.isArray(parsed.processos) ? parsed.processos : []).map((p: any) => ({
          tipo: String(p.tipo || ""),
          numero: p.numero || undefined,
          descricao: String(p.descricao || ""),
          status: String(p.status || "desconhecido"),
          fonte: String(p.fonte || ""),
        })),
        restricoes: (Array.isArray(parsed.restricoes) ? parsed.restricoes : []).map((r: any) => ({
          tipo: String(r.tipo || ""),
          descricao: String(r.descricao || ""),
          severidade: String(r.severidade || "media"),
          fonte: String(r.fonte || ""),
        })),
        historicoPropriedade: (Array.isArray(parsed.historicoPropriedade) ? parsed.historicoPropriedade : []).map((h: any) => ({
          evento: String(h.evento || ""),
          data: h.data || undefined,
          detalhes: String(h.detalhes || ""),
          fonte: String(h.fonte || ""),
        })),
        resumoInvestigacao: String(parsed.resumoInvestigacao || ""),
        recomendacaoAbordagem: String(parsed.recomendacaoAbordagem || ""),
        fontesPesquisadas: (Array.isArray(parsed.fontesPesquisadas) ? parsed.fontesPesquisadas : []).filter((s: any) => typeof s === "string"),
        analyzedAt: new Date().toISOString(),
        insumosHash,
      };

      // (Nenhum score de confiança é calculado sobre a investigação: saída de
      // busca web é material T3/T4 — anexo do relatório, nunca corpo — e o
      // único indicador do produto é o score de completude do dossiê.)
      return result;
    } catch (err: any) {
      console.error(`[DeepIntel] Erro (tentativa ${attempt}):`, err.message);
      if (attempt >= maxAttempts) throw err;
    }
  }

  throw new Error("Falha na investigação após todas tentativas");
}
