import type { IStorage } from "../storage";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { matchSuggestions } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sendNotification, notifId } from "../notifications";
import {
  calculateSmartScore,
  buildMatchingContext,
  matchesRegion,
} from "../lib/smart-matching";

const CNAE_POR_TIPO: Record<string, string[]> = {
  MINA:    ["0710", "0890", "0810", "0600"],
  TERRA:   ["0111", "0112", "0113", "0114", "0115", "0116", "0119", "0121", "0131", "0141", "0151", "0161", "0163", "0210", "6810", "4623", "6470"],
  AGRO:    [
    "0111", "0112", "0113", "0114", "0115", "0116", "0119",
    "0121", "0131", "0132", "0133",
    "0141", "0142", "0151", "0152", "0153", "0154", "0155",
    "0161", "0162", "0163", "0210",
    "1011", "1012", "1013", "1051", "1052", "1053",
    "4622", "4623", "4683",
    "6470", "6612",
  ],
  FII_CRI: ["6422", "6423", "6431", "6432", "6450", "6630"],
  DESENVOLVIMENTO: ["4110", "4120", "4211", "6810", "6821"],
  NEGOCIO: ["6420", "6430", "6470", "6499", "7490"],
};

export async function runMatchingForAsset(
  assetId: number,
  orgId: number,
  storage: IStorage,
  db: NodePgDatabase<any>,
): Promise<number> {
  const asset = await storage.getAsset(assetId);
  if (!asset) return 0;

  if (["fechado", "arquivado", "em_negociacao"].includes(asset.statusAtivo || "")) return 0;
  if (asset.exclusivoAte && new Date(asset.exclusivoAte as string) > new Date()) return 0;

  let matchesFound = 0;

  const allInvestors = await storage.getInvestors(orgId);
  const allAssets = await storage.getAssets(orgId);
  const ctx = await buildMatchingContext(db, orgId, allAssets);

  const existingSuggestions = await db.select({
    investorProfileId: matchSuggestions.investorProfileId,
  }).from(matchSuggestions).where(
    and(eq(matchSuggestions.assetId, assetId), eq(matchSuggestions.orgId, orgId))
  );
  const existingInvestorIds = new Set(
    existingSuggestions.filter(s => s.investorProfileId != null).map(s => s.investorProfileId)
  );

  for (const investor of allInvestors) {
    if (existingInvestorIds.has(investor.id)) continue;

    const investorTypes = (investor.assetTypes as string[]) || [];
    const perfilCompleto = investorTypes.length > 0 ||
      investor.ticketMin != null || investor.ticketMax != null ||
      ((investor.regionsOfInterest as string[]) || []).length > 0;
    if (!perfilCompleto) continue;

    const result = calculateSmartScore(asset, investor, ctx);

    if (result.score >= 40 && result.penalties.length <= 2) {
      await db.insert(matchSuggestions).values({
        orgId,
        assetId,
        investorProfileId: investor.id,
        score: result.score,
        reasonsJson: {
          reasons: result.reasons,
          penalties: result.penalties,
          breakdown: result.breakdown,
          confidence: result.confidence,
          explanation: result.explanation,
          version: "v3",
        },
        status: "new",
      });
      matchesFound++;
    }
  }

  const allCompanies = await storage.getCompanies?.(orgId) ?? [];
  const cnaesEsperados = CNAE_POR_TIPO[asset.type] || [];

  const existingSuggestionsAll = await db.select().from(matchSuggestions).where(
    and(eq(matchSuggestions.assetId, assetId), eq(matchSuggestions.orgId, orgId))
  );
  const existingCompPairs = new Set(
    existingSuggestionsAll
      .filter(e => (e.reasonsJson as any)?.compradorId)
      .map(e => `${assetId}-${(e.reasonsJson as any).compradorId}`)
  );

  for (const comprador of allCompanies) {
    if (existingCompPairs.has(`${assetId}-${comprador.id}`)) continue;

    const enrichment = (comprador.enrichmentData as any) || {};
    const cnaeInteresse: string[] = enrichment.cnaeInteresse || [];
    const regioesInteresse: string[] = enrichment.regioesInteresse || [];
    const isMarkedInvestor = enrichment.buyerType === "estrategico" || enrichment.buyerType === "financeiro";

    const companyCnaes: string[] = [];
    if (comprador.cnaePrincipal) companyCnaes.push(String(comprador.cnaePrincipal));
    const secundarios = (comprador.cnaeSecundarios as string[]) || [];
    for (const s of secundarios) companyCnaes.push(String(s));

    const cnaeEmpresaMatch = cnaesEsperados.length > 0 && companyCnaes.some(cnae => {
      const cnaeStr = cnae.replace(/[^0-9]/g, "");
      return cnaesEsperados.some(esp => cnaeStr.startsWith(esp));
    });

    const cnaeInteresseMatch = cnaeInteresse.length > 0 && cnaesEsperados.length > 0 &&
      cnaeInteresse.some(cnae => cnaesEsperados.some(esp => String(cnae).startsWith(esp)));

    if (!cnaeEmpresaMatch && !cnaeInteresseMatch && !isMarkedInvestor) continue;

    let score = 0;
    const reasons: string[] = [];
    const penalties: string[] = [];

    if (cnaeEmpresaMatch) {
      score += 30;
      reasons.push(`CNAE da empresa compatível com ${asset.type}`);
    } else if (asset.type === "NEGOCIO" && isMarkedInvestor) {
      score += 20;
      reasons.push("Negócio — comprador genérico");
    } else if (!cnaeInteresseMatch) {
      penalties.push(`CNAE não compatível com ${asset.type}`);
    }

    if (cnaeInteresseMatch) {
      score += 10;
      reasons.push("Interesse declarado compatível");
    }

    if (isMarkedInvestor) {
      score += 15;
      reasons.push(`Investidor marcado (${enrichment.buyerType})`);
    }

    if (regioesInteresse.length === 0) {
      score += 15;
      reasons.push("Opera em qualquer região");
    } else if (matchesRegion(asset.location || asset.estado, regioesInteresse)) {
      score += 25;
      reasons.push("Região compatível");
    } else {
      penalties.push("Região fora do interesse");
    }

    if (asset.docsStatus === "completo") { score += 10; reasons.push("Documentação completa"); }

    const minThreshold = cnaeEmpresaMatch ? 30 : 40;
    if (score >= minThreshold && penalties.length <= 1) {
      await db.insert(matchSuggestions).values({
        orgId,
        assetId,
        investorProfileId: null,
        score: Math.min(score, 100),
        reasonsJson: {
          reasons, penalties,
          tipo: isMarkedInvestor ? "estrategico" : "cnae_auto",
          compradorId: comprador.id,
          compradorNome: comprador.tradeName || comprador.legalName,
          cnaeEmpresa: cnaeEmpresaMatch,
          investidorMarcado: isMarkedInvestor,
          version: "v3",
        },
        status: "new",
      });
      matchesFound++;
    }
  }

  if (matchesFound > 0) {
    sendNotification({
      id: notifId(),
      type: "new_match",
      orgId,
      title: "Matches automáticos gerados",
      message: `Ativo "${asset.title}" — ${matchesFound} match(es) encontrado(s) automaticamente`,
      link: `/ativos/${assetId}`,
      createdAt: new Date().toISOString(),
    });
  }

  console.log(`[Auto-match] Ativo ${assetId} ("${asset.title}"): ${matchesFound} match(es) gerados`);
  return matchesFound;
}
