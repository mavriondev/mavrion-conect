import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and, gte } from "drizzle-orm";
import { assets, companyBuyerProfiles, companyVisitLog, companyRejectionLog } from "@shared/schema";

export interface CompanyBuyerProfile {
  id: number;
  companyId: number;
  totalDeals: number;
  preferredTypes: string[];
  preferredCultures: string[];
  avgAreaHa: number | null;
  minAreaHa: number | null;
  maxAreaHa: number | null;
  avgPricePerHa: number | null;
  minPricePerHa: number | null;
  maxPricePerHa: number | null;
  avgGeoScore: number | null;
  minGeoScore: number | null;
  maxGeoScore: number | null;
  requiresCompleteDocs: boolean;
  acceptsPendingDocs: boolean;
  acceptsIrregularDocs: boolean;
  lastVisitDate: Date | null;
  visitsLast30Days: number;
  rejectionsLast30Days: number;
  acceptancesLast30Days: number;
  avgDecisionDays: number | null;
  portfolioRegions: string[];
  portfolioCultures: string[];
  portfolioConcentration: Record<string, number>;
}

export interface ScoringBreakdown {
  history: { score: number; weight: number; reason: string };
  intention: { score: number; weight: number; reason: string };
  complementarity: { score: number; weight: number; reason: string };
  size: { score: number; weight: number; reason: string };
  price: { score: number; weight: number; reason: string };
  geoScore: { score: number; weight: number; reason: string };
  docs: { score: number; weight: number; reason: string };
  velocity: { score: number; weight: number; reason: string };
}

export interface IntelligentScore {
  totalScore: number;
  confidence: "high" | "medium" | "low";
  breakdown: ScoringBreakdown;
  humanReason: string;
}

function calculateHistoryScore(
  asset: any,
  profile: CompanyBuyerProfile
): { score: number; reason: string } {
  if (profile.totalDeals === 0) {
    return { score: 0, reason: "Nenhum histórico de compra" };
  }
  const aptidao = (asset.camposEspecificos as any)?.aptidaoAgricola || (asset.camposEspecificos as any)?.culturas || "";
  if (aptidao && profile.preferredCultures?.includes(aptidao.toLowerCase())) {
    return { score: 100, reason: `Comprou ${aptidao} ${profile.totalDeals}x antes` };
  }
  if (profile.preferredTypes?.includes(asset.type)) {
    return { score: 70, reason: `Comprou ${asset.type} ${profile.totalDeals}x antes` };
  }
  return { score: 20, reason: `Histórico em outros tipos/culturas` };
}

function calculateIntentionScore(
  profile: CompanyBuyerProfile
): { score: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];

  if (profile.lastVisitDate) {
    const daysSince = Math.floor(
      (Date.now() - profile.lastVisitDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSince <= 7) {
      score += 40;
      reasons.push(`Visitou há ${daysSince} dias`);
    }
  }

  if (profile.visitsLast30Days >= 10) {
    score += 30;
    reasons.push(`${profile.visitsLast30Days} visitas no último mês`);
  }

  if (profile.rejectionsLast30Days >= 3) {
    score += 20;
    reasons.push(`Rejeitou ${profile.rejectionsLast30Days} ativos (está procurando)`);
  }

  if (profile.acceptancesLast30Days >= 1) {
    score += 30;
    reasons.push(`Aceitou ${profile.acceptancesLast30Days} ativo(s) recentemente`);
  }

  return {
    score: Math.min(score, 100),
    reason: reasons.length > 0 ? reasons.join("; ") : "Sem sinais recentes de intenção",
  };
}

function calculateComplementarityScore(
  asset: any,
  profile: CompanyBuyerProfile
): { score: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];
  const aptidao = (asset.camposEspecificos as any)?.aptidaoAgricola || (asset.camposEspecificos as any)?.culturas || "";

  if (aptidao && profile.preferredCultures?.includes(aptidao.toLowerCase())) {
    score += 40;
    reasons.push(`${aptidao} é cultura padrão`);
  }

  if (!profile.portfolioRegions?.includes(asset.estado)) {
    score += 30;
    reasons.push(`${asset.estado} é nova região (diversificação)`);
  } else {
    const concentration = profile.portfolioConcentration?.[asset.estado] || 0;
    if (concentration >= 0.5) {
      score -= 20;
      reasons.push(`${asset.estado} já representa ${(concentration * 100).toFixed(0)}% do portfólio`);
    }
  }

  if (
    asset.areaHa &&
    profile.minAreaHa &&
    profile.maxAreaHa &&
    asset.areaHa >= profile.minAreaHa &&
    asset.areaHa <= profile.maxAreaHa
  ) {
    score += 20;
    reasons.push(`${asset.areaHa} ha está no range ${profile.minAreaHa}-${profile.maxAreaHa}`);
  }

  return {
    score: Math.max(0, Math.min(score, 100)),
    reason: reasons.length > 0 ? reasons.join("; ") : "Complementaridade neutra",
  };
}

function calculateSizeScore(
  asset: any,
  profile: CompanyBuyerProfile
): { score: number; reason: string } {
  if (!asset.areaHa || !profile.avgAreaHa) {
    return { score: 50, reason: "Sem dados de tamanho para comparação" };
  }
  const diff = Math.abs(asset.areaHa - profile.avgAreaHa);
  const tolerance = profile.avgAreaHa * 0.3;
  if (diff <= tolerance) {
    return { score: 100, reason: `${asset.areaHa} ha é perfeito (média ${profile.avgAreaHa} ha)` };
  }
  if (diff <= tolerance * 2) {
    return { score: 70, reason: `${asset.areaHa} ha é aceitável (média ${profile.avgAreaHa} ha)` };
  }
  return { score: 30, reason: `${asset.areaHa} ha está fora do padrão (média ${profile.avgAreaHa} ha)` };
}

function calculatePriceScore(
  asset: any,
  profile: CompanyBuyerProfile
): { score: number; reason: string } {
  if (!asset.priceAsking || !asset.areaHa || !profile.avgPricePerHa) {
    return { score: 50, reason: "Sem dados de preço para comparação" };
  }
  const pricePerHa = asset.priceAsking / asset.areaHa;
  const diff = Math.abs(pricePerHa - profile.avgPricePerHa);
  const tolerance = profile.avgPricePerHa * 0.2;
  if (diff <= tolerance) {
    return { score: 100, reason: `R$ ${pricePerHa.toFixed(0)}/ha é perfeito (média R$ ${profile.avgPricePerHa.toFixed(0)}/ha)` };
  }
  if (diff <= tolerance * 2) {
    return { score: 70, reason: `R$ ${pricePerHa.toFixed(0)}/ha é aceitável (média R$ ${profile.avgPricePerHa.toFixed(0)}/ha)` };
  }
  return { score: 30, reason: `R$ ${pricePerHa.toFixed(0)}/ha está fora do padrão (média R$ ${profile.avgPricePerHa.toFixed(0)}/ha)` };
}

function calculateGeoScoreScore(
  asset: any,
  profile: CompanyBuyerProfile
): { score: number; reason: string } {
  if (!asset.geoScore || !profile.avgGeoScore) {
    return { score: 50, reason: "Sem dados geoespaciais para comparação" };
  }
  if (
    profile.minGeoScore != null && profile.maxGeoScore != null &&
    asset.geoScore >= profile.minGeoScore &&
    asset.geoScore <= profile.maxGeoScore
  ) {
    return { score: 100, reason: `GeoScore ${asset.geoScore} está no range ${profile.minGeoScore}-${profile.maxGeoScore}` };
  }
  if (profile.minGeoScore != null && asset.geoScore < profile.minGeoScore) {
    return { score: 40, reason: `GeoScore ${asset.geoScore} está abaixo do mínimo (${profile.minGeoScore})` };
  }
  return { score: 60, reason: `GeoScore ${asset.geoScore} está acima do máximo (${profile.maxGeoScore})` };
}

function calculateDocsScore(
  asset: any,
  profile: CompanyBuyerProfile
): { score: number; reason: string } {
  const docsStatus = (asset.docsStatus || "unknown").toLowerCase();
  if (docsStatus === "completo" || docsStatus === "complete") {
    return { score: 100, reason: "Documentação completa (padrão esperado)" };
  }
  if (docsStatus === "pendente" || docsStatus === "pending") {
    if (profile.acceptsPendingDocs) {
      return { score: 70, reason: "Docs pendentes (empresa aceita)" };
    }
    return { score: 20, reason: "Docs pendentes (empresa não aceita)" };
  }
  if (docsStatus === "irregular") {
    if (profile.acceptsIrregularDocs) {
      return { score: 50, reason: "Docs irregulares (empresa aceita)" };
    }
    return { score: 10, reason: "Docs irregulares (empresa não aceita)" };
  }
  return { score: 50, reason: "Status documental desconhecido" };
}

function calculateVelocityScore(
  asset: any,
  profile: CompanyBuyerProfile
): { score: number; reason: string } {
  if (!profile.avgDecisionDays) {
    return { score: 50, reason: "Sem histórico de velocidade" };
  }
  let assetUrgency = 999;
  const campos = (asset.camposEspecificos as any) || {};
  if (campos.exclusivoAte) {
    assetUrgency = Math.floor(
      (new Date(campos.exclusivoAte).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
  }
  if (assetUrgency < 30) {
    if (profile.avgDecisionDays <= 21) {
      return { score: 100, reason: `Ativo urgente (${assetUrgency}d), empresa decide rápido (${profile.avgDecisionDays}d)` };
    }
    if (profile.avgDecisionDays <= 45) {
      return { score: 60, reason: `Ativo urgente (${assetUrgency}d), empresa é lenta (${profile.avgDecisionDays}d)` };
    }
    return { score: 20, reason: `Ativo urgente (${assetUrgency}d), empresa muito lenta (${profile.avgDecisionDays}d)` };
  }
  return { score: 70, reason: `Ativo normal, velocidade média da empresa: ${profile.avgDecisionDays}d` };
}

export async function calculateIntelligentScore(
  asset: any,
  companyId: number,
  profile: CompanyBuyerProfile,
  db: NodePgDatabase<any>,
  orgId: number
): Promise<IntelligentScore> {
  let totalScore = 0;
  const breakdown: ScoringBreakdown = {} as ScoringBreakdown;

  const history = calculateHistoryScore(asset, profile);
  breakdown.history = { ...history, weight: 0.3 };
  totalScore += history.score * 0.3;

  const intention = calculateIntentionScore(profile);
  breakdown.intention = { ...intention, weight: 0.25 };
  totalScore += intention.score * 0.25;

  const complementarity = calculateComplementarityScore(asset, profile);
  breakdown.complementarity = { ...complementarity, weight: 0.2 };
  totalScore += complementarity.score * 0.2;

  const size = calculateSizeScore(asset, profile);
  breakdown.size = { ...size, weight: 0.15 };
  totalScore += size.score * 0.15;

  const price = calculatePriceScore(asset, profile);
  breakdown.price = { ...price, weight: 0.1 };
  totalScore += price.score * 0.1;

  const geoScoreResult = calculateGeoScoreScore(asset, profile);
  breakdown.geoScore = { ...geoScoreResult, weight: 0.1 };
  totalScore += geoScoreResult.score * 0.1;

  const docs = calculateDocsScore(asset, profile);
  breakdown.docs = { ...docs, weight: 0.05 };
  totalScore += docs.score * 0.05;

  const velocity = calculateVelocityScore(asset, profile);
  breakdown.velocity = { ...velocity, weight: 0.05 };
  totalScore += velocity.score * 0.05;

  let confidence: "high" | "medium" | "low" = "low";
  if (profile.totalDeals >= 5 && profile.visitsLast30Days > 0) {
    confidence = "high";
  } else if (profile.totalDeals >= 2 || profile.visitsLast30Days > 0) {
    confidence = "medium";
  }

  const topReasons = [
    breakdown.history.reason,
    breakdown.intention.reason,
    breakdown.complementarity.reason,
  ]
    .filter(r => r && !r.includes("Nenhum") && !r.includes("Sem") && !r.includes("desconhecido"))
    .slice(0, 3);

  const humanReason =
    topReasons.length > 0
      ? topReasons.join(" | ")
      : "Perfil incompleto, mas empresa está no sistema";

  return {
    totalScore: Math.round(totalScore),
    confidence,
    breakdown,
    humanReason,
  };
}

export async function updateCompanyBuyerProfile(
  db: NodePgDatabase<any>,
  companyId: number,
  orgId: number
) {
  const dealRows = await db
    .select()
    .from(assets)
    .where(and(eq(assets.linkedCompanyId, companyId), eq(assets.orgId, orgId)));

  if (dealRows.length === 0) {
    await db.insert(companyBuyerProfiles).values({
      orgId,
      companyId,
      totalDeals: 0,
    } as any).onConflictDoUpdate({
      target: companyBuyerProfiles.companyId,
      set: { totalDeals: 0, updatedAt: new Date() },
    });
    return;
  }

  const types = dealRows.map(d => d.type);
  const cultures = dealRows
    .map(d => (d.camposEspecificos as any)?.aptidaoAgricola || (d.camposEspecificos as any)?.culturas)
    .filter(Boolean);
  const areas = dealRows.map(d => d.areaHa).filter(Boolean) as number[];
  const prices = dealRows
    .filter(d => d.priceAsking && d.areaHa)
    .map(d => (d.priceAsking! / d.areaHa!));
  const geoScores = dealRows.map(d => d.geoScore).filter(Boolean) as number[];

  const avgArea = areas.length > 0 ? areas.reduce((a, b) => a + b) / areas.length : null;
  const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b) / prices.length : null;
  const avgGeo = geoScores.length > 0 ? geoScores.reduce((a, b) => a + b) / geoScores.length : null;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const visitsLast30 = await db
    .select()
    .from(companyVisitLog)
    .where(
      and(
        eq(companyVisitLog.companyId, companyId),
        eq(companyVisitLog.orgId, orgId),
        gte(companyVisitLog.visitedAt, thirtyDaysAgo)
      )
    );

  const rejectionsLast30 = await db
    .select()
    .from(companyRejectionLog)
    .where(
      and(
        eq(companyRejectionLog.companyId, companyId),
        eq(companyRejectionLog.orgId, orgId),
        gte(companyRejectionLog.rejectedAt, thirtyDaysAgo)
      )
    );

  const lastVisit = visitsLast30.length > 0
    ? new Date(Math.max(...visitsLast30.map(v => v.visitedAt?.getTime() || 0)))
    : null;

  const regions = [...new Set(dealRows.map(d => d.estado).filter(Boolean))] as string[];
  const regionConcentration: Record<string, number> = {};
  for (const region of regions) {
    const count = dealRows.filter(d => d.estado === region).length;
    regionConcentration[region] = count / dealRows.length;
  }

  const profileData = {
    orgId,
    companyId,
    totalDeals: dealRows.length,
    preferredTypes: [...new Set(types)],
    preferredCultures: [...new Set(cultures)],
    avgAreaHa: avgArea,
    minAreaHa: areas.length > 0 ? Math.min(...areas) : null,
    maxAreaHa: areas.length > 0 ? Math.max(...areas) : null,
    avgPricePerHa: avgPrice,
    minPricePerHa: prices.length > 0 ? Math.min(...prices) : null,
    maxPricePerHa: prices.length > 0 ? Math.max(...prices) : null,
    avgGeoScore: avgGeo ? Math.round(avgGeo) : null,
    minGeoScore: geoScores.length > 0 ? Math.min(...geoScores) : null,
    maxGeoScore: geoScores.length > 0 ? Math.max(...geoScores) : null,
    lastVisitDate: lastVisit,
    visitsLast30Days: visitsLast30.length,
    rejectionsLast30Days: rejectionsLast30.length,
    portfolioRegions: regions,
    portfolioCultures: [...new Set(cultures)],
    portfolioConcentration: regionConcentration,
    updatedAt: new Date(),
  };

  await db
    .insert(companyBuyerProfiles)
    .values(profileData as any)
    .onConflictDoUpdate({
      target: companyBuyerProfiles.companyId,
      set: profileData as any,
    });
}
