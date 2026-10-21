import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and, sql } from "drizzle-orm";
import {
  matchSuggestions,
  matchFeedback,
  investorDynamicProfile,
  deals,
} from "@shared/schema";

const STATE_NORMALIZATION: Record<string, string[]> = {
  "AC": ["acre", "ac"], "AL": ["alagoas", "al"], "AP": ["amapá", "amapa", "ap"],
  "AM": ["amazonas", "am"], "BA": ["bahia", "ba"], "CE": ["ceará", "ceara", "ce"],
  "DF": ["distrito federal", "df"], "ES": ["espírito santo", "espirito santo", "es"],
  "GO": ["goiás", "goias", "go"], "MA": ["maranhão", "maranhao", "ma"],
  "MT": ["mato grosso", "mt"], "MS": ["mato grosso do sul", "ms"],
  "MG": ["minas gerais", "mg"], "PA": ["pará", "para", "pa"],
  "PB": ["paraíba", "paraiba", "pb"], "PR": ["paraná", "parana", "pr"],
  "PE": ["pernambuco", "pe"], "PI": ["piauí", "piaui", "pi"],
  "RJ": ["rio de janeiro", "rj"], "RN": ["rio grande do norte", "rn"],
  "RS": ["rio grande do sul", "rs"], "RO": ["rondônia", "rondonia", "ro"],
  "RR": ["roraima", "rr"], "SC": ["santa catarina", "sc"],
  "SP": ["são paulo", "sao paulo", "sp"], "SE": ["sergipe", "se"],
  "TO": ["tocantins", "to"],
};

export interface ScoreBreakdown {
  tipoAtivo: number;
  ticket: number;
  regiao: number;
  documentacao: number;
  risco: number;
  urgencia: number;
  diversificacao: number;
  historico: number;
  capacidadeFinanceira: number;
  porteEmpresa: number;
}

export interface SmartScoreResult {
  score: number;
  reasons: string[];
  penalties: string[];
  breakdown: ScoreBreakdown;
  confidence: "alta" | "media" | "baixa";
  explanation: string;
}

export interface AssetRiskProfile {
  riskScore: number;
  riskLevel: "baixo" | "medio" | "alto" | "critico";
  riskFactors: string[];
}

export interface MatchingContext {
  feedbacks: any[];
  dynamicProfiles: Map<number, any>;
  portfolioAssets: Map<number, { types: Record<string, number>; regions: Record<string, number>; total: number }>;
}

export function normalizeState(location: string | null | undefined): string | null {
  if (!location) return null;
  const loc = location.toLowerCase().trim();
  if (loc.length === 2) {
    const upper = loc.toUpperCase();
    if (STATE_NORMALIZATION[upper]) return upper;
  }
  const fullNameEntries = Object.entries(STATE_NORMALIZATION)
    .map(([uf, variants]) => [uf, variants.filter(v => v.length > 2)] as [string, string[]])
    .sort((a, b) => {
      const maxA = Math.max(...a[1].map(v => v.length));
      const maxB = Math.max(...b[1].map(v => v.length));
      return maxB - maxA;
    });
  for (const [uf, longVariants] of fullNameEntries) {
    if (longVariants.some(v => loc.includes(v))) return uf;
  }
  const siglaRegex = /(?:^|[\s\/\-,])([a-z]{2})(?:$|[\s\/\-,])/g;
  let match;
  while ((match = siglaRegex.exec(loc)) !== null) {
    const candidate = match[1].toUpperCase();
    if (STATE_NORMALIZATION[candidate]) return candidate;
  }
  const trailingSigla = loc.match(/[\/\-]([a-z]{2})$/);
  if (trailingSigla) {
    const candidate = trailingSigla[1].toUpperCase();
    if (STATE_NORMALIZATION[candidate]) return candidate;
  }
  return location.toUpperCase().substring(0, 2);
}

export function matchesRegion(assetLocation: string | null, investorRegions: string[]): boolean {
  if (!assetLocation || investorRegions.length === 0) return true;
  const loc = assetLocation.toLowerCase();
  const normalizedAsset = normalizeState(assetLocation);
  return investorRegions.some(r => {
    const rLower = r.toLowerCase();
    if (loc.includes(rLower)) return true;
    const directVariants = STATE_NORMALIZATION[r.toUpperCase()];
    if (directVariants && directVariants.some(v => loc.includes(v))) return true;
    const normalizedRegion = normalizeState(r);
    if (normalizedRegion && normalizedAsset && normalizedRegion === normalizedAsset) return true;
    return false;
  });
}

export function analyzeAssetRisk(asset: any): AssetRiskProfile {
  let riskScore = 0;
  const riskFactors: string[] = [];

  if (asset.docsStatus === "pendente") {
    riskScore += 30;
    riskFactors.push("Documentação pendente");
  } else if (asset.docsStatus === "irregular") {
    riskScore += 50;
    riskFactors.push("Documentação irregular");
  } else if (asset.docsStatus === "completo" || asset.docsStatus === "regularizado") {
    riskScore -= 10;
  }

  if (asset.createdAt) {
    const diasNoMercado = Math.floor((Date.now() - new Date(asset.createdAt).getTime()) / 86400000);
    if (diasNoMercado > 365) {
      riskScore += 20;
      riskFactors.push(`Ativo há ${Math.floor(diasNoMercado / 30)} meses no mercado`);
    } else if (diasNoMercado > 180) {
      riskScore += 10;
      riskFactors.push(`Ativo há ${Math.floor(diasNoMercado / 30)} meses no mercado`);
    }
  }

  if (!asset.priceAsking) {
    riskScore += 15;
    riskFactors.push("Preço não informado");
  }

  if (["TERRA", "AGRO", "MINA"].includes(asset.type) && !asset.areaHa) {
    riskScore += 10;
    riskFactors.push("Área não informada");
  }

  if (["TERRA", "AGRO"].includes(asset.type) && asset.geoScore !== null && asset.geoScore !== undefined) {
    if (asset.geoScore < 30) {
      riskScore += 15;
      riskFactors.push(`Score geoespacial baixo (${asset.geoScore}/100)`);
    }
  }

  const campos = asset.camposEspecificos ?? {};
  if (campos.certidoes && Object.keys(campos.certidoes).length > 0) {
    riskScore -= 5;
  }
  if (campos.matricula || campos.numMatricula || asset.matricula) {
    riskScore -= 5;
  }

  const clampedScore = Math.max(0, Math.min(100, riskScore));
  const riskLevel =
    clampedScore >= 60 ? "critico" :
    clampedScore >= 40 ? "alto" :
    clampedScore >= 20 ? "medio" : "baixo";

  return { riskScore: clampedScore, riskLevel, riskFactors };
}

export function calcAssetUrgency(asset: any): { urgencyBonus: number; urgencyLabel: string } {
  if (!asset.createdAt) return { urgencyBonus: 0, urgencyLabel: "desconhecida" };

  const diasNoMercado = Math.floor((Date.now() - new Date(asset.createdAt).getTime()) / 86400000);

  if (diasNoMercado <= 30) {
    return { urgencyBonus: 15, urgencyLabel: "novo no mercado" };
  }
  if (diasNoMercado <= 90) {
    return { urgencyBonus: 8, urgencyLabel: "recente" };
  }
  if (diasNoMercado > 180) {
    return { urgencyBonus: -5, urgencyLabel: "há muito tempo no mercado" };
  }

  return { urgencyBonus: 0, urgencyLabel: "normal" };
}

export function calcDiversificationBonus(
  asset: any,
  investorId: number,
  ctx: MatchingContext
): { bonus: number; reason: string } {
  const portfolio = ctx.portfolioAssets.get(investorId);
  if (!portfolio || portfolio.total === 0) {
    return { bonus: 10, reason: "Primeiro match — prioridade máxima" };
  }

  const typeCount = portfolio.types[asset.type] || 0;
  const regionCount = asset.estado ? (portfolio.regions[normalizeState(asset.estado) || ""] || 0) : 0;
  const total = portfolio.total;

  if (typeCount / total > 0.6) {
    return {
      bonus: -10,
      reason: `Portfólio já concentrado em ${asset.type} (${Math.round(typeCount / total * 100)}%)`
    };
  }

  if (asset.estado && regionCount / total > 0.5) {
    return {
      bonus: -5,
      reason: `Portfólio já concentrado em ${normalizeState(asset.estado)} (${Math.round(regionCount / total * 100)}%)`
    };
  }

  if (typeCount === 0) {
    return { bonus: 15, reason: `Diversificação: novo tipo ${asset.type} no portfólio` };
  }

  if (asset.estado && regionCount === 0) {
    return { bonus: 10, reason: `Diversificação: nova região ${normalizeState(asset.estado)} no portfólio` };
  }

  return { bonus: 0, reason: "" };
}

export function calcHistoryAdjustment(
  asset: any,
  investorId: number,
  ctx: MatchingContext
): { adjustment: number; reason: string } {
  const feedbacks = ctx.feedbacks.filter(f => f.investorProfileId === investorId);
  if (feedbacks.length === 0) return { adjustment: 0, reason: "" };

  const assetEstado = normalizeState(asset.estado || asset.location);

  const rejectionsByType = feedbacks.filter(
    f => f.action === "rejected" && f.assetType === asset.type
  ).length;
  const acceptancesByType = feedbacks.filter(
    f => f.action === "accepted" && f.assetType === asset.type
  ).length;
  const rejectionsByRegion = feedbacks.filter(
    f => f.action === "rejected" && assetEstado && f.assetEstado === assetEstado
  ).length;

  if (rejectionsByType >= 3 && acceptancesByType === 0) {
    return {
      adjustment: -20,
      reason: `Histórico: rejeitou ${rejectionsByType} ativos do tipo ${asset.type} sem aceitar nenhum`
    };
  }
  if (rejectionsByType >= 2 && acceptancesByType === 0) {
    return {
      adjustment: -10,
      reason: `Histórico: tendência de rejeição para tipo ${asset.type}`
    };
  }
  if (acceptancesByType >= 2) {
    return {
      adjustment: 15,
      reason: `Histórico: aceitou ${acceptancesByType} ativos do tipo ${asset.type}`
    };
  }
  if (rejectionsByRegion >= 3) {
    return {
      adjustment: -10,
      reason: `Histórico: rejeitou ${rejectionsByRegion} ativos em ${assetEstado}`
    };
  }

  const priceRejections = feedbacks.filter(
    f => f.action === "rejected" && f.rejectionReason === "preco_alto" && f.assetType === asset.type
  ).length;
  if (priceRejections >= 2 && asset.priceAsking) {
    return {
      adjustment: -10,
      reason: `Histórico: rejeitou ${priceRejections} ativos por preço alto neste tipo`
    };
  }

  return { adjustment: 0, reason: "" };
}

export const CNAE_CODE_MAP: Record<string, string[]> = {
  MINA:    ["0710", "0890", "0810", "0600", "0729", "0721"],
  TERRA:   ["0111", "0112", "0113", "0114", "0115", "0116", "0119", "0121", "0131", "0141", "0151", "0161", "0163", "0210", "6810", "4623", "6470"],
  AGRO:    ["0111", "0112", "0113", "0114", "0115", "0116", "0119", "0121", "0131", "0132", "0133", "0141", "0142", "0151", "0152", "0153", "0154", "0155", "0161", "0162", "0163", "0210", "1011", "1012", "1013", "1051", "1052", "1053", "4622", "4623", "4683", "6470", "6612"],
  FII_CRI: ["6422", "6423", "6431", "6432", "6450", "6630"],
  DESENVOLVIMENTO: ["4110", "4120", "4211", "6810", "6821"],
  NEGOCIO: ["6420", "6430", "6470", "6499", "7490"],
};

const CNAE_KEYWORDS_MAP: { keywords: string[]; types: string[] }[] = [
  { keywords: ["mineração", "mineracao", "extração de min", "extracao de min", "minério", "minerio", "metais", "pedra", "calcário", "calcario", "bauxita", "ferro", "carvão", "carvao", "quartzo", "granito", "areia", "argila", "fosfato", "ouro", "preciosos"], types: ["MINA"] },
  { keywords: ["agropecuária", "agropecuaria", "pecuária", "pecuaria", "bovinos", "criação de", "criacao de", "suínos", "suinos", "ovinos", "caprinos", "eqüinos", "equinos", "aves", "avicultura"], types: ["TERRA", "AGRO"] },
  { keywords: ["cultivo de", "plantadas", "florestal", "reflorestamento", "celulose", "madeira", "sementes", "defensivos agrícolas", "defensivos agricolas", "adubos", "fertilizantes", "corretivos do solo", "agrícolas", "agricolas", "agropecuários", "agropecuarios", "agrícola", "agricola"], types: ["TERRA", "AGRO"] },
  { keywords: ["construção", "construcao", "incorporação", "incorporacao", "empreendimentos imobiliários", "empreendimentos imobiliarios", "loteamento"], types: ["DESENVOLVIMENTO"] },
  { keywords: ["fundo de investimento", "securitização", "securitizacao", "créditos imobiliários", "creditos imobiliarios"], types: ["FII_CRI"] },
  { keywords: ["holding", "participações", "participacoes", "administração de empresa", "administracao de empresa", "gestão de ativo", "gestao de ativo"], types: ["NEGOCIO"] },
];

export function inferAssetTypesFromCnae(company: any): string[] {
  if (!company) return [];

  const allCnaes: string[] = [];
  if (company.cnaePrincipal) allCnaes.push(String(company.cnaePrincipal));
  const sec = (company.cnaeSecundarios as string[]) || [];
  for (const s of sec) allCnaes.push(String(s));

  const matched = new Set<string>();

  for (const cnae of allCnaes) {
    const digits = cnae.replace(/[^0-9]/g, "");
    if (digits.length >= 4) {
      for (const [assetType, prefixes] of Object.entries(CNAE_CODE_MAP)) {
        if (prefixes.some(p => digits.startsWith(p))) {
          matched.add(assetType);
        }
      }
    }
  }

  if (matched.size === 0) {
    const joined = allCnaes.map(c => c.toLowerCase()).join(" | ");
    for (const entry of CNAE_KEYWORDS_MAP) {
      for (const kw of entry.keywords) {
        if (joined.includes(kw)) {
          for (const t of entry.types) matched.add(t);
          break;
        }
      }
    }
  }

  return Array.from(matched);
}

export function calculateSmartScore(
  asset: any,
  investor: any,
  ctx: MatchingContext
): SmartScoreResult {
  const reasons: string[] = [];
  const penalties: string[] = [];
  const breakdown: ScoreBreakdown = {
    tipoAtivo: 0, ticket: 0, regiao: 0, documentacao: 0,
    risco: 0, urgencia: 0, diversificacao: 0, historico: 0,
    capacidadeFinanceira: 0, porteEmpresa: 0,
  };

  let investorTypes = (investor.assetTypes as string[]) || [];
  let typesInferred = false;

  if (investorTypes.length === 0 && investor.company) {
    const inferred = inferAssetTypesFromCnae(investor.company);
    if (inferred.length > 0) {
      investorTypes = inferred;
      typesInferred = true;
    }
  }

  if (investorTypes.length === 0) {
    breakdown.tipoAtivo = 5;
    reasons.push("Perfil incompleto — sem tipo de ativo definido");
  } else if (investorTypes.includes(asset.type)) {
    if (typesInferred) {
      breakdown.tipoAtivo = 25;
      reasons.push(`Tipo "${asset.type}" compatível com CNAE da empresa`);
    } else {
      breakdown.tipoAtivo = 35;
      reasons.push(`Tipo "${asset.type}" está nas preferências do investidor`);
    }
  } else {
    if (typesInferred) {
      breakdown.tipoAtivo = -15;
      penalties.push(`CNAE da empresa não é compatível com tipo "${asset.type}"`);
    } else {
      breakdown.tipoAtivo = -20;
      penalties.push(`Tipo "${asset.type}" não está nas preferências do investidor`);
    }
  }

  if (asset.priceAsking) {
    const min = investor.ticketMin;
    const max = investor.ticketMax;
    if (!min && !max) {
      breakdown.ticket = 20;
      reasons.push("Investidor sem restrição de ticket");
    } else {
      const abaixoDoMin = min && asset.priceAsking < min * 0.8;
      const acimaDoMax = max && asset.priceAsking > max * 1.2;
      if (abaixoDoMin) {
        breakdown.ticket = -15;
        penalties.push(`Preço R$${(asset.priceAsking / 1e6).toFixed(1)}M abaixo do ticket mínimo`);
      } else if (acimaDoMax) {
        breakdown.ticket = -15;
        penalties.push(`Preço R$${(asset.priceAsking / 1e6).toFixed(1)}M acima do ticket máximo`);
      } else if (min && max) {
        const center = (min + max) / 2;
        const distance = Math.abs(asset.priceAsking - center) / (max - min);
        breakdown.ticket = Math.max(Math.round((1 - distance) * 30), 10);
        reasons.push(`Preço dentro do ticket (R$${(min / 1e6).toFixed(1)}M–R$${(max / 1e6).toFixed(1)}M)`);
      } else {
        breakdown.ticket = 20;
        reasons.push("Preço compatível com ticket");
      }
    }
  } else {
    breakdown.ticket = 8;
    reasons.push("Preço a negociar");
  }

  const regions = (investor.regionsOfInterest as string[]) || [];
  if (regions.length === 0) {
    breakdown.regiao = 10;
    reasons.push("Investidor opera em qualquer região");
  } else if (matchesRegion(asset.location || asset.estado, regions)) {
    breakdown.regiao = 15;
    reasons.push(`Região "${asset.estado || asset.location}" compatível`);
  } else {
    breakdown.regiao = 0;
    penalties.push(`Região "${asset.estado || asset.location}" fora do interesse`);
  }

  if (asset.docsStatus === "completo" || asset.docsStatus === "regularizado") {
    breakdown.documentacao = 10;
    reasons.push("Documentação completa — menor risco");
  } else if (asset.docsStatus === "pendente") {
    breakdown.documentacao = -5;
    penalties.push("Documentação pendente");
  } else if (asset.docsStatus === "irregular") {
    breakdown.documentacao = -15;
    penalties.push("Documentação irregular — alto risco");
  }

  const riskProfile = analyzeAssetRisk(asset);
  if (riskProfile.riskLevel === "critico") {
    breakdown.risco = -20;
    penalties.push(`Ativo de risco crítico: ${riskProfile.riskFactors.join(", ")}`);
  } else if (riskProfile.riskLevel === "alto") {
    breakdown.risco = -10;
    penalties.push(`Ativo de risco alto: ${riskProfile.riskFactors.join(", ")}`);
  } else if (riskProfile.riskLevel === "baixo") {
    breakdown.risco = 5;
    reasons.push("Ativo de baixo risco");
  }

  const urgency = calcAssetUrgency(asset);
  if (urgency.urgencyBonus !== 0) {
    breakdown.urgencia = urgency.urgencyBonus;
    if (urgency.urgencyBonus > 0) {
      reasons.push(`Urgência: ativo ${urgency.urgencyLabel}`);
    } else {
      penalties.push(`Atenção: ativo ${urgency.urgencyLabel}`);
    }
  }

  try {
    const diversif = calcDiversificationBonus(asset, investor.id, ctx);
    if (diversif.bonus !== 0) {
      breakdown.diversificacao = diversif.bonus;
      if (diversif.bonus > 0) reasons.push(diversif.reason);
      else penalties.push(diversif.reason);
    }
  } catch (_e) {}

  try {
    const history = calcHistoryAdjustment(asset, investor.id, ctx);
    if (history.adjustment !== 0) {
      breakdown.historico = history.adjustment;
      if (history.adjustment > 0) reasons.push(history.reason);
      else penalties.push(history.reason);
    }
  } catch (_e) {}

  const company = investor.company;
  if (company && asset.priceAsking) {
    const revenue = company.revenueEstimate;
    const capital = company.shareCapital;
    const referencia = revenue || capital || 0;

    if (referencia > 0) {
      const ratio = referencia / asset.priceAsking;
      if (ratio >= 3) {
        breakdown.capacidadeFinanceira = 15;
        reasons.push(`Capacidade financeira alta (faturamento ${(referencia / 1e6).toFixed(1)}M vs preço ${(asset.priceAsking / 1e6).toFixed(1)}M)`);
      } else if (ratio >= 1.5) {
        breakdown.capacidadeFinanceira = 10;
        reasons.push(`Capacidade financeira compatível (${(referencia / 1e6).toFixed(1)}M)`);
      } else if (ratio >= 0.5) {
        breakdown.capacidadeFinanceira = 3;
        reasons.push(`Capacidade financeira apertada para este ativo`);
      } else {
        breakdown.capacidadeFinanceira = -10;
        penalties.push(`Faturamento R$${(referencia / 1e6).toFixed(1)}M pode ser insuficiente para ativo de R$${(asset.priceAsking / 1e6).toFixed(1)}M`);
      }
    }

    const empStr = company.employeeCount;
    if (empStr) {
      const empNum = parseInt(String(empStr).replace(/[^0-9]/g, ""), 10);
      if (!isNaN(empNum) && empNum > 0) {
        if (empNum >= 500) {
          breakdown.porteEmpresa = 10;
          reasons.push(`Empresa de grande porte (${empNum} funcionários)`);
        } else if (empNum >= 100) {
          breakdown.porteEmpresa = 5;
          reasons.push(`Empresa de médio porte (${empNum} funcionários)`);
        } else if (empNum >= 20) {
          breakdown.porteEmpresa = 2;
        } else {
          if (asset.priceAsking > 10_000_000) {
            breakdown.porteEmpresa = -5;
            penalties.push(`Empresa pequena (${empNum} func.) para ativo de R$${(asset.priceAsking / 1e6).toFixed(1)}M`);
          }
        }
      }
    }
  }

  let onboardingBonus = 0;
  const prefs = (investor.preferencesJson as any) || {};

  if (prefs.perfilRisco && riskProfile) {
    if (prefs.perfilRisco === "agressivo" && riskProfile.riskLevel === "alto") {
      onboardingBonus += 5;
      reasons.push("Investidor agressivo aceita risco alto");
    } else if (prefs.perfilRisco === "conservador" && riskProfile.riskLevel === "baixo") {
      onboardingBonus += 5;
      reasons.push("Perfil conservador alinhado com ativo de baixo risco");
    }
  }

  if (prefs.restricoesAmbientais !== undefined) {
    const carStatus = asset.camposEspecificos?.sicarStatus || asset.camposEspecificos?.statusCar;
    if (prefs.restricoesAmbientais === false && carStatus && (carStatus === "Regular" || carStatus === "Ativo")) {
      onboardingBonus += 5;
      reasons.push("Investidor requer compliance ambiental — ativo com CAR regular");
    } else if (prefs.restricoesAmbientais === true) {
      onboardingBonus += 3;
      reasons.push("Investidor flexível com restrições ambientais");
    }
  }

  if (prefs.fonteCapital === "fundo" && asset.priceAsking) {
    onboardingBonus += 5;
    reasons.push("Investidor com capital de fundo — maior capacidade de aquisição");
  }

  if (prefs.aceitaPermuta === true) {
    const assetPermuta = asset.camposEspecificos?.aceitaPermuta;
    if (assetPermuta) {
      onboardingBonus += 5;
      reasons.push("Ambos aceitam permuta — flexibilidade na negociação");
    }
  }

  if (prefs.setorPrioritario) {
    const sectorMap: Record<string, string[]> = {
      agro: ["TERRA", "AGRO"], mineracao: ["MINA"], imobiliario: ["FII_CRI", "TERRA"],
      industrial: ["NEGOCIO"], energia: ["TERRA", "MINA"],
    };
    const matchTypes = sectorMap[prefs.setorPrioritario] || [];
    if (matchTypes.includes(asset.type)) {
      onboardingBonus += 5;
      reasons.push(`Setor prioritário "${prefs.setorPrioritario}" alinhado com tipo ${asset.type}`);
    }
  }

  let enrichmentBonus = 0;
  const enrich = asset.camposEspecificos?.enrichment || {};

  if (enrich.situacaoDocumental === "Regularizado") {
    enrichmentBonus += 5;
    reasons.push("Documentação regularizada (enriquecimento)");
  } else if (enrich.situacaoDocumental === "Irregular") {
    enrichmentBonus -= 3;
    penalties.push("Documentação irregular (enriquecimento)");
  }

  if (enrich.aceitaPermuta === true && prefs.aceitaPermuta === true) {
    enrichmentBonus += 3;
  }

  if (["TERRA", "AGRO"].includes(asset.type)) {
    if (enrich.aptidaoUso && prefs.setorPrioritario) {
      const aptMatch: Record<string, string[]> = {
        agro: ["Grãos", "Cana", "Café", "Fruticultura", "Mista"],
        energia: ["Cana", "Reflorestamento"],
        imobiliario: ["Pecuária", "Mista"],
      };
      if ((aptMatch[prefs.setorPrioritario] || []).includes(enrich.aptidaoUso)) {
        enrichmentBonus += 5;
        reasons.push(`Aptidão "${enrich.aptidaoUso}" alinhada com setor prioritário`);
      }
    }
    if (enrich.possuiReservaLegal === true) {
      enrichmentBonus += 3;
      reasons.push("Reserva legal demarcada");
    }
    if (enrich.acessoPrincipal === "Asfalto") {
      enrichmentBonus += 2;
      reasons.push("Acesso asfaltado");
    }
  }

  if (asset.type === "MINA") {
    if (enrich.faseExploracao === "Lavra") {
      enrichmentBonus += 5;
      reasons.push("Mina em fase de lavra (avançada)");
    } else if (enrich.faseExploracao === "Licenciamento") {
      enrichmentBonus += 3;
    }
    if (enrich.possuiLicencaAmbiental === true) {
      enrichmentBonus += 5;
      reasons.push("Possui licença ambiental");
    }
  }

  if (asset.type === "NEGOCIO") {
    if (enrich.ebitda && Number(enrich.ebitda) > 0) {
      enrichmentBonus += 5;
      reasons.push("EBITDA positivo informado");
    }
    if (enrich.faturamentoAnual && Number(enrich.faturamentoAnual) > 0 && investor.ticketMin) {
      const fatAnual = Number(enrich.faturamentoAnual);
      if (fatAnual >= investor.ticketMin * 0.3) {
        enrichmentBonus += 3;
        reasons.push("Faturamento compatível com ticket");
      }
    }
    if (enrich.motivoVenda && !["Saúde"].includes(enrich.motivoVenda)) {
      enrichmentBonus += 2;
    }
  }

  if (asset.type === "FII_CRI") {
    if (enrich.rentabilidadeAnual && Number(enrich.rentabilidadeAnual) > 0) {
      enrichmentBonus += 5;
      reasons.push(`Rentabilidade ${enrich.rentabilidadeAnual}% a.a.`);
    }
    if (enrich.vacanciaMedia !== undefined && enrich.vacanciaMedia !== "" && Number.isFinite(Number(enrich.vacanciaMedia)) && Number(enrich.vacanciaMedia) < 15) {
      enrichmentBonus += 3;
      reasons.push("Vacância baixa");
    }
    if (enrich.dividendYield && Number(enrich.dividendYield) > 0) {
      enrichmentBonus += 3;
    }
  }

  enrichmentBonus = Math.min(enrichmentBonus, 25);

  const rawScore =
    breakdown.tipoAtivo + breakdown.ticket + breakdown.regiao + breakdown.documentacao +
    breakdown.risco + breakdown.urgencia + breakdown.diversificacao + breakdown.historico +
    breakdown.capacidadeFinanceira + breakdown.porteEmpresa + onboardingBonus + enrichmentBonus;

  const score = Math.max(0, Math.min(100, rawScore));

  const hasHistory = breakdown.historico !== 0;
  const originalTypes = (investor.assetTypes as string[]) || [];
  const hasCompleteProfile = originalTypes.length > 0 && (investor.ticketMin || investor.ticketMax);
  const hasPartialProfile = originalTypes.length > 0 || typesInferred;
  const confidence: "alta" | "media" | "baixa" =
    hasHistory && hasCompleteProfile ? "alta" :
    hasCompleteProfile ? "media" :
    hasPartialProfile ? "media" : "baixa";

  const topReasons = reasons.slice(0, 3).join("; ");
  const topPenalties = penalties.slice(0, 2).join("; ");
  let explanation = `Score ${score}/100 — ${topReasons}`;
  if (topPenalties) explanation += ` | Atenção: ${topPenalties}`;

  return { score, reasons, penalties, breakdown, confidence, explanation };
}

export async function buildMatchingContext(
  db: NodePgDatabase<any>,
  orgId: number,
  allAssets: any[]
): Promise<MatchingContext> {
  const feedbacks = await db.select().from(matchFeedback).where(eq(matchFeedback.orgId, orgId));
  const dynamicProfileRows = await db.select().from(investorDynamicProfile).where(eq(investorDynamicProfile.orgId, orgId));
  const dynamicProfiles = new Map(dynamicProfileRows.map(dp => [dp.investorProfileId, dp]));

  const acceptedSuggestions = await db.select({
    investorProfileId: matchSuggestions.investorProfileId,
    assetId: matchSuggestions.assetId,
  }).from(matchSuggestions).where(
    and(eq(matchSuggestions.orgId, orgId), eq(matchSuggestions.status, "accepted"))
  );

  const portfolioAssets = new Map<number, { types: Record<string, number>; regions: Record<string, number>; total: number }>();
  for (const s of acceptedSuggestions) {
    if (!s.investorProfileId) continue;
    const asset = allAssets.find(a => a.id === s.assetId);
    if (!asset) continue;

    if (!portfolioAssets.has(s.investorProfileId)) {
      portfolioAssets.set(s.investorProfileId, { types: {}, regions: {}, total: 0 });
    }
    const p = portfolioAssets.get(s.investorProfileId)!;
    p.total++;
    p.types[asset.type] = (p.types[asset.type] || 0) + 1;
    const estado = normalizeState(asset.estado || asset.location);
    if (estado) p.regions[estado] = (p.regions[estado] || 0) + 1;
  }

  return { feedbacks, dynamicProfiles, portfolioAssets };
}

export async function updateInvestorDynamicProfile(
  db: NodePgDatabase<any>,
  investorProfileId: number,
  orgId: number
): Promise<any> {
  const feedbacks = await db.select().from(matchFeedback)
    .where(and(eq(matchFeedback.investorProfileId, investorProfileId), eq(matchFeedback.orgId, orgId)));

  if (feedbacks.length === 0) return null;

  const accepted = feedbacks.filter(f => f.action === "accepted");
  const rejected = feedbacks.filter(f => f.action === "rejected");

  const typeWeights: Record<string, number> = {};
  const regionWeights: Record<string, number> = {};
  const acceptedPrices: number[] = [];

  for (const f of feedbacks) {
    const weight = f.action === "accepted" ? 1 : f.action === "rejected" ? -0.3 : 0;
    if (f.assetType) {
      typeWeights[f.assetType] = (typeWeights[f.assetType] || 0) + weight;
    }
    if (f.assetEstado) {
      regionWeights[f.assetEstado] = (regionWeights[f.assetEstado] || 0) + weight;
    }
    if (f.action === "accepted" && f.assetPrice && f.assetPrice > 0) {
      acceptedPrices.push(f.assetPrice);
    }
  }

  const normalizeWeights = (weights: Record<string, number>) => {
    const max = Math.max(...Object.values(weights), 1);
    const result: Record<string, number> = {};
    for (const [k, v] of Object.entries(weights)) {
      result[k] = Math.max(0, Math.round((v / max) * 100) / 100);
    }
    return result;
  };

  let realTicketMin: number | null = null;
  let realTicketMax: number | null = null;
  let realTicketAvg: number | null = null;

  if (acceptedPrices.length >= 2) {
    acceptedPrices.sort((a, b) => a - b);
    realTicketMin = acceptedPrices[0];
    realTicketMax = acceptedPrices[acceptedPrices.length - 1];
    realTicketAvg = acceptedPrices.reduce((a, b) => a + b, 0) / acceptedPrices.length;
  }

  const decisionFeedbacks = feedbacks.filter(f => (f.action === "accepted" || f.action === "rejected") && f.suggestionId);
  const suggestionIds = [...new Set(decisionFeedbacks.map(f => f.suggestionId!))];
  const suggestionCreatedMap = new Map<number, Date>();
  if (suggestionIds.length > 0) {
    const suggRows = await db.select({ id: matchSuggestions.id, createdAt: matchSuggestions.createdAt })
      .from(matchSuggestions)
      .where(sql`${matchSuggestions.id} IN (${sql.join(suggestionIds.map(id => sql`${id}`), sql`, `)})`);
    for (const row of suggRows) {
      if (row.createdAt) suggestionCreatedMap.set(row.id, new Date(row.createdAt));
    }
  }

  let totalDecisionDays = 0;
  let decisionCount = 0;
  for (const f of decisionFeedbacks) {
    const suggCreatedAt = suggestionCreatedMap.get(f.suggestionId!);
    if (suggCreatedAt && f.createdAt) {
      const days = (new Date(f.createdAt).getTime() - suggCreatedAt.getTime()) / 86400000;
      if (days >= 0) { totalDecisionDays += days; decisionCount++; }
    }
  }
  const avgDecisionDays = decisionCount > 0 ? Math.round((totalDecisionDays / decisionCount) * 10) / 10 : null;

  const acceptedTypes = new Set(accepted.map(f => f.assetType).filter(Boolean));
  const acceptedRegions = new Set(accepted.map(f => f.assetEstado).filter(Boolean));
  const prefersDiversification = acceptedTypes.size >= 3 || acceptedRegions.size >= 3;

  let riskTolerance: "conservative" | "moderate" | "aggressive" = "moderate";
  const acceptRate = feedbacks.length > 0 ? accepted.length / feedbacks.length : 0;
  const lowScoreAccepts = accepted.filter(f => f.scoreAtDecision !== null && f.scoreAtDecision < 50).length;
  const highScoreAccepts = accepted.filter(f => f.scoreAtDecision !== null && f.scoreAtDecision >= 70).length;
  if (acceptRate > 0.7 || lowScoreAccepts >= 2) riskTolerance = "aggressive";
  else if (acceptRate < 0.3 && highScoreAccepts === 0) riskTolerance = "conservative";

  const dealsCount = await db.select({ count: sql<number>`count(*)::int` })
    .from(deals)
    .innerJoin(matchSuggestions, and(
      eq(matchSuggestions.dealId, deals.id),
      eq(matchSuggestions.investorProfileId, investorProfileId)
    ))
    .where(eq(deals.orgId, orgId));

  const profileData = {
    orgId,
    investorProfileId,
    typeWeights: normalizeWeights(typeWeights),
    regionWeights: normalizeWeights(regionWeights),
    realTicketMin,
    realTicketMax,
    realTicketAvg,
    avgDecisionDays,
    totalSuggestions: feedbacks.length,
    totalAccepted: accepted.length,
    totalRejected: rejected.length,
    totalDeals: dealsCount[0]?.count || 0,
    prefersDiversification,
    riskTolerance,
    updatedAt: new Date(),
  };

  const [existing] = await db.select().from(investorDynamicProfile)
    .where(eq(investorDynamicProfile.investorProfileId, investorProfileId));

  if (existing) {
    const [updated] = await db.update(investorDynamicProfile)
      .set(profileData as any)
      .where(eq(investorDynamicProfile.investorProfileId, investorProfileId))
      .returning();
    return updated;
  } else {
    const [created] = await db.insert(investorDynamicProfile)
      .values(profileData)
      .returning();
    return created;
  }
}
