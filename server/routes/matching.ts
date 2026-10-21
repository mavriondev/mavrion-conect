import type { Express } from "express";
import type { IStorage } from "../storage";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { api } from "@shared/routes";
import { z } from "zod";
import { matchSuggestions, deals, pipelineStages, assets, companies, matchFeedback, investorDynamicProfile, investorProfiles } from "@shared/schema";
import { eq, and, asc, desc, isNull, sql } from "drizzle-orm";
import { sendNotification, notifId } from "../notifications";
import { getOrgId } from "../lib/tenant";
import {
  calculateSmartScore,
  buildMatchingContext,
  updateInvestorDynamicProfile,
  normalizeState,
  matchesRegion,
  CNAE_CODE_MAP,
} from "../lib/smart-matching";
import { suggestInvestorProfile, aiRankBuyers } from "../lib/ai-agents";
import { waterfallEnrich } from "../enrichment/waterfall";
import { aiEnrichAsset } from "../lib/ai-enrichment";

export { matchesRegion } from "../lib/smart-matching";

export function registerMatchingRoutes(app: Express, storage: IStorage, db: NodePgDatabase<any>) {
  app.get("/api/matching/companies-available", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const orgId = getOrgId(req);
    const linkedIds = await db.select({ cid: investorProfiles.companyId })
      .from(investorProfiles)
      .where(and(eq(investorProfiles.orgId, orgId), sql`${investorProfiles.companyId} IS NOT NULL`));
    const excludeIds = linkedIds.map(r => r.cid).filter(Boolean) as number[];

    let query = db.select({
      id: companies.id,
      legalName: companies.legalName,
      tradeName: companies.tradeName,
      cnpj: companies.cnpj,
    }).from(companies).where(eq(companies.orgId, orgId)).orderBy(companies.legalName);

    const rows = await query;
    const filtered = excludeIds.length > 0
      ? rows.filter(c => !excludeIds.includes(c.id))
      : rows;
    res.json(filtered);
  });

  app.get(api.matching.investors.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const orgId = getOrgId(req);
    const investors = await storage.getInvestors(orgId);
    res.json(investors);
  });

  app.post(api.matching.investors.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const input = api.matching.investors.create.input.parse(req.body);
      if (input.companyId) {
        const [company] = await db.select({ id: companies.id }).from(companies)
          .where(and(eq(companies.id, input.companyId), eq(companies.orgId, orgId)));
        if (!company) return res.status(400).json({ message: "Empresa não encontrada ou não pertence à organização" });
      }
      const data = await storage.createInvestor({ ...input, orgId });
      res.status(201).json(data);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json(err.errors);
      res.status(500).json({ message: "Internal Error" });
    }
  });

  app.patch("/api/matching/investors/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const investor = await storage.getInvestor(Number(req.params.id));
      if (!investor || investor.orgId !== orgId) return res.status(404).json({ message: "Investidor não encontrado" });
      if (req.body.companyId) {
        const [company] = await db.select({ id: companies.id }).from(companies)
          .where(and(eq(companies.id, req.body.companyId), eq(companies.orgId, orgId)));
        if (!company) return res.status(400).json({ message: "Empresa não pertence à organização" });
      }
      const updated = await storage.updateInvestor(Number(req.params.id), req.body);
      res.json(updated);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.post("/api/matching/suggest-profile/:companyId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const companyId = Number(req.params.companyId);
      const [company] = await db.select().from(companies)
        .where(and(eq(companies.id, companyId), eq(companies.orgId, orgId)));
      if (!company) return res.status(404).json({ message: "Empresa não encontrada" });
      const suggestion = await suggestInvestorProfile({
        legalName: company.legalName,
        tradeName: company.tradeName,
        cnpj: company.cnpj,
        cnaePrincipal: company.cnaePrincipal,
        cnaeSecundarios: company.cnaeSecundarios,
        porte: company.porte,
        revenueEstimate: company.revenueEstimate,
        shareCapital: company.shareCapital,
        employeeCount: company.employeeCount,
        address: company.address,
        enrichmentData: company.enrichmentData,
      });
      res.json(suggestion);
    } catch (err: any) {
      console.error("Erro ao gerar sugestão de perfil:", err.message);
      res.status(500).json({ message: "Erro ao gerar sugestão" });
    }
  });

  app.delete("/api/matching/investors/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const investor = await storage.getInvestor(Number(req.params.id));
      if (!investor || investor.orgId !== orgId) return res.status(404).json({ message: "Investidor não encontrado" });
      await storage.deleteInvestor(Number(req.params.id));
      res.status(204).end();
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.get(api.matching.suggestions.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const orgId = getOrgId(req);
    const suggestions = await storage.getMatchSuggestions(orgId);
    res.json(suggestions);
  });

  app.patch("/api/matching/suggestions/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const { status } = req.body;
      const [existing] = await db.select().from(matchSuggestions)
        .where(and(eq(matchSuggestions.id, Number(req.params.id)), eq(matchSuggestions.orgId, orgId)));
      if (!existing) return res.status(404).json({ message: "Sugestão não encontrada" });
      const [updated] = await db.update(matchSuggestions)
        .set({ status })
        .where(eq(matchSuggestions.id, Number(req.params.id)))
        .returning();
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Internal Error" });
    }
  });

  app.delete("/api/matching/suggestions/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const [existing] = await db.select().from(matchSuggestions)
        .where(and(eq(matchSuggestions.id, Number(req.params.id)), eq(matchSuggestions.orgId, orgId)));
      if (!existing) return res.status(404).json({ message: "Sugestão não encontrada" });
      await db.delete(matchSuggestions).where(eq(matchSuggestions.id, Number(req.params.id)));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: "Erro ao remover sugestão" });
    }
  });

  app.post("/api/matching/suggestions/:id/accept", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const suggId = Number(req.params.id);
      const { title, stageId, value } = req.body;

      const orgId = getOrgId(req);
      const [suggestion] = await db.select().from(matchSuggestions)
        .where(and(eq(matchSuggestions.id, suggId), eq(matchSuggestions.orgId, orgId)));
      if (!suggestion) return res.status(404).json({ message: "Suggestion não encontrada" });

      if (suggestion.status === "accepted" && suggestion.dealId) {
        return res.json({ success: true, dealId: suggestion.dealId, message: "Já aceita" });
      }

      const finalStageId = stageId ? Number(stageId) : null;
      let resolvedStageId = finalStageId;
      if (!resolvedStageId) {
        const stages = await db.select().from(pipelineStages)
          .where(eq(pipelineStages.pipelineType, "INVESTOR"))
          .orderBy(asc(pipelineStages.order))
          .limit(1);
        if (stages.length > 0) resolvedStageId = stages[0].id;
      }
      if (!resolvedStageId) return res.status(400).json({ message: "Nenhum estágio INVESTOR configurado" });

      if (finalStageId) {
        const [validStage] = await db.select().from(pipelineStages)
          .where(and(eq(pipelineStages.id, finalStageId), eq(pipelineStages.pipelineType, "INVESTOR")));
        if (!validStage) return res.status(400).json({ message: "Estágio inválido para pipeline INVESTOR" });
      }

      const asset = await storage.getAsset(suggestion.assetId!);
      if (asset && asset.orgId !== orgId) return res.status(404).json({ message: "Ativo não encontrado" });
      const investor = suggestion.investorProfileId ? await storage.getInvestor(suggestion.investorProfileId) : null;
      if (investor && investor.orgId !== orgId) return res.status(404).json({ message: "Investidor não encontrado" });

      const dealTitle = title || `Match: ${asset?.title || "Ativo"} ↔ ${investor?.name || "Investidor"}`;

      const [deal] = await db.insert(deals).values({
        orgId,
        pipelineType: "INVESTOR",
        stageId: resolvedStageId,
        title: dealTitle,
        description: `Deal originado via Matching Engine.\nAtivo: ${asset?.title || "N/A"}\nInvestidor: ${investor?.name || "N/A"}\nScore: ${suggestion.score}%`,
        assetId: suggestion.assetId,
        value: value ? Number(value) : null,
        labels: ["Matching", `Score ${suggestion.score}%`],
        source: "MATCHING",
      } as any).returning();

      await db.update(matchSuggestions)
        .set({ status: "accepted", dealId: deal.id } as any)
        .where(eq(matchSuggestions.id, suggId));

      let assetType: string | null = null;
      let assetEstado: string | null = null;
      let assetPrice: number | null = null;
      if (asset) {
        assetType = asset.type;
        assetEstado = normalizeState(asset.estado || asset.location);
        assetPrice = asset.priceAsking || null;
      }
      try {
        await db.insert(matchFeedback).values({
          orgId,
          suggestionId: suggId,
          investorProfileId: suggestion.investorProfileId,
          assetId: suggestion.assetId,
          action: "accepted",
          assetType,
          assetEstado,
          assetPrice,
          scoreAtDecision: suggestion.score,
        });
        if (suggestion.investorProfileId) {
          await updateInvestorDynamicProfile(db, suggestion.investorProfileId, orgId);
        }
      } catch (fbErr) {
        console.warn("Feedback auto-record on accept failed:", fbErr);
      }

      res.json({ success: true, dealId: deal.id });
    } catch (err) {
      console.error("Matching accept error:", err);
      res.status(500).json({ message: "Erro ao aceitar match" });
    }
  });

  app.post(api.matching.suggestions.run.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const allAssets = await storage.getAssets(orgId);
      const allInvestors = await storage.getInvestors(orgId);
      let matchesFound = 0;

      const ctx = await buildMatchingContext(db, orgId, allAssets);

      const allExistingSuggestions = await db.select({ assetId: matchSuggestions.assetId, investorProfileId: matchSuggestions.investorProfileId })
        .from(matchSuggestions).where(eq(matchSuggestions.orgId, orgId));
      const existingSuggestionKeys = new Set(allExistingSuggestions.map(s => `${s.assetId}_${s.investorProfileId}`));

      let assetsSkipped = 0;
      let investorsSkippedNoProfile = 0;
      let pairsEvaluated = 0;

      for (const asset of allAssets) {
        if (["fechado", "arquivado", "em_negociacao"].includes(asset.statusAtivo || "")) { assetsSkipped++; continue; }
        if (asset.exclusivoAte && new Date(asset.exclusivoAte) > new Date()) { assetsSkipped++; continue; }

        for (const investor of allInvestors) {
          if (existingSuggestionKeys.has(`${asset.id}_${investor.id}`)) continue;

          pairsEvaluated++;
          const result = calculateSmartScore(asset, investor, ctx);

          if (result.score >= 40 && result.penalties.length <= 3) {
            await db.insert(matchSuggestions).values({
              orgId: asset.orgId,
              assetId: asset.id,
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
      }

      const allCompanies = await storage.getCompanies?.(orgId) ?? [];

      const CNAE_POR_TIPO = CNAE_CODE_MAP;

      const existingSuggestionsAll = await db.select().from(matchSuggestions).where(eq(matchSuggestions.orgId, orgId));
      const existingCompPairs = new Set(
        existingSuggestionsAll
          .filter(e => (e.reasonsJson as any)?.compradorId)
          .map(e => `${e.assetId}-${(e.reasonsJson as any).compradorId}`)
      );

      for (const asset of allAssets) {
        if (["fechado", "arquivado", "em_negociacao"].includes(asset.statusAtivo || "")) continue;
        if (asset.exclusivoAte && new Date(asset.exclusivoAte) > new Date()) continue;

        const cnaesEsperados = CNAE_POR_TIPO[asset.type] || [];

        for (const comprador of allCompanies) {
          if (existingCompPairs.has(`${asset.id}-${comprador.id}`)) continue;

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

          const aiData = enrichment.aiEnrichment;
          if (aiData && !aiData._failReason) {
            const ms = aiData.matchingSignals;
            if (ms?.buyerPotential === "alto") {
              score += 12;
              reasons.push("Potencial comprador alto (IA)");
            } else if (ms?.buyerPotential === "medio") {
              score += 6;
              reasons.push("Potencial comprador médio (IA)");
            }

            if (ms?.acquisitionHistory && ms.acquisitionHistory !== "null" && ms.acquisitionHistory.length > 5) {
              score += 8;
              reasons.push("Histórico de aquisições (IA)");
            }

            if (ms?.expansionSignals?.length > 0) {
              const expansionBonus = Math.min(ms.expansionSignals.length * 3, 9);
              score += expansionBonus;
              reasons.push(`${ms.expansionSignals.length} sinal(is) de expansão (IA)`);
            }

            if (ms?.interestAreas?.length > 0) {
              const AREA_TIPO: Record<string, string[]> = {
                MINA: ["mineração", "mining", "minério", "minera"],
                TERRA: ["agro", "rural", "terra", "fazenda", "imóvel", "imobili"],
                AGRO: ["agro", "rural", "aliment", "pecuári", "grão"],
                FII_CRI: ["fundo", "financeir", "imobiliári", "investiment", "FII", "CRI"],
                DESENVOLVIMENTO: ["construção", "incorpor", "desenvolv", "imobili"],
                NEGOCIO: ["empresa", "negócio", "indústri", "comérci", "serviço"],
              };
              const tipoKeywords = AREA_TIPO[asset.type] || [];
              if (tipoKeywords.length > 0) {
                const areaMatch = ms.interestAreas.some((area: string) =>
                  tipoKeywords.some(kw => area.toLowerCase().includes(kw.toLowerCase()))
                );
                if (areaMatch) {
                  score += 8;
                  reasons.push("Área de interesse compatível (IA)");
                }
              }
            }

            const fp = aiData.financialProfile;
            if (fp?.estimatedRevenue) {
              const revStr = String(fp.estimatedRevenue).toLowerCase();
              const billions = revStr.includes("bilh") || revStr.includes("billion");
              const hundreds = revStr.match(/(\d+)\s*(milhões|milhão|mi)/i);
              if (billions) {
                score += 10;
                reasons.push("Faturamento bilionário (IA)");
              } else if (hundreds) {
                const val = parseInt(hundreds[1]);
                if (val >= 100) {
                  score += 8;
                  reasons.push(`Faturamento ~R$${val}M (IA)`);
                } else if (val >= 10) {
                  score += 5;
                  reasons.push(`Faturamento ~R$${val}M (IA)`);
                }
              }
            }

            if (fp?.employeeRange) {
              const empStr = String(fp.employeeRange);
              if (empStr.includes("500+") || empStr.includes("1000") || empStr.includes("5000")) {
                score += 5;
                reasons.push("Empresa de grande porte (IA)");
              } else if (empStr.includes("201") || empStr.includes("200")) {
                score += 3;
                reasons.push("Empresa de médio porte (IA)");
              }
            }

            const lc = aiData.legalCompliance;
            if (lc?.debtSignals?.length > 0 && lc.debtSignals.some((s: string) => s && s !== "null")) {
              score -= 5;
              penalties.push("Sinais de endividamento (IA)");
            }
            if (lc?.lawsuits?.length > 1) {
              score -= 3;
              penalties.push("Processos judiciais relevantes (IA)");
            }
          }

          const assetCe = (asset.camposEspecificos as any) || {};
          const assetIa = assetCe.iaEnrichment;
          let matchVersion = "v4";
          if (assetIa && !assetIa._failReason) {
            matchVersion = "v5";
            const pic = assetIa.perfilIdealComprador;
            if (pic?.cnaesIdeais?.length > 0) {
              const cnaeAssetMatch = pic.cnaesIdeais.some((idealCnae: string) =>
                companyCnaes.some(cc => cc.replace(/[^0-9]/g, "").startsWith(idealCnae))
              );
              if (cnaeAssetMatch) {
                score += 10;
                reasons.push("CNAE do comprador compatível com perfil ideal do ativo (IA)");
              }
            }

            if (pic?.porteIdeal && aiData?.financialProfile?.companySize) {
              const porteMap: Record<string, number> = { "MEI": 1, "ME": 2, "EPP": 3, "Médio": 4, "Grande": 5 };
              const idealPorte = porteMap[pic.porteIdeal] || 0;
              const realPorte = porteMap[aiData.financialProfile.companySize] || 0;
              if (realPorte >= idealPorte && idealPorte > 0) {
                score += 5;
                reasons.push("Porte do comprador compatível com perfil ideal (IA ativo)");
              } else if (realPorte > 0 && realPorte < idealPorte) {
                score -= 3;
                penalties.push("Porte do comprador abaixo do ideal para o ativo (IA)");
              }
            }

            if (pic?.regioesInteresse?.length > 0 && comprador.estado) {
              const compradorEstado = normalizeState(comprador.estado || "");
              const MACRO_UFS: Record<string, string[]> = {
                norte: ["AC","AM","AP","PA","RO","RR","TO"],
                nordeste: ["AL","BA","CE","MA","PB","PE","PI","RN","SE"],
                "centro-oeste": ["DF","GO","MS","MT"],
                sudeste: ["ES","MG","RJ","SP"],
                sul: ["PR","RS","SC"],
              };
              const regiaoMatch = pic.regioesInteresse.some((r: string) => {
                if (matchesRegion(compradorEstado, [r])) return true;
                const macroKey = r.toLowerCase().replace(/[^a-zà-ú\-]/g, "");
                const ufs = MACRO_UFS[macroKey];
                if (ufs && ufs.includes(compradorEstado.toUpperCase())) return true;
                return false;
              });
              if (regiaoMatch) {
                score += 5;
                reasons.push("Comprador em região de interesse do ativo (IA)");
              }
            }

            if (assetIa.ticketSugerido && aiData?.financialProfile?.estimatedRevenue) {
              const revStr = String(aiData.financialProfile.estimatedRevenue).toLowerCase();
              const extractMillions = (s: string): number => {
                if (s.includes("bilh") || s.includes("billion")) {
                  const bn = s.match(/(\d+[.,]?\d*)/);
                  return bn ? parseFloat(bn[1].replace(",", ".")) * 1000 : 1000;
                }
                const m = s.match(/(\d+[.,]?\d*)\s*(milhões|milhão|mi)/i);
                return m ? parseFloat(m[1].replace(",", ".")) : 0;
              };
              const buyerRevM = extractMillions(revStr);
              const ticketMinM = extractMillions(assetIa.ticketSugerido.minimo?.toLowerCase() || "");
              if (buyerRevM > 0 && (ticketMinM <= 0 || buyerRevM >= ticketMinM * 0.5)) {
                score += 5;
                reasons.push("Capacidade financeira compatível com ticket do ativo (IA)");
              }
            }

            if (assetIa.riscosIdentificados?.length > 0) {
              const highRisks = assetIa.riscosIdentificados.filter((r: any) => r.severidade === "alta");
              if (highRisks.length > 0 && aiData?.legalCompliance?.debtSignals?.length > 0) {
                score -= 5;
                penalties.push("Ativo com riscos altos + comprador com sinais de risco (IA)");
              }
            }

            if (assetIa.scoreAtratividade >= 70) {
              score += 3;
              reasons.push("Ativo com alta atratividade (IA)");
            }
          }

          const minThreshold = cnaeEmpresaMatch ? 30 : 40;
          if (score >= minThreshold && penalties.length <= 2) {
            await db.insert(matchSuggestions).values({
              orgId,
              assetId: asset.id,
              investorProfileId: null,
              score: Math.min(score, 100),
              reasonsJson: {
                reasons, penalties,
                tipo: isMarkedInvestor ? "estrategico" : "cnae_auto",
                compradorId: comprador.id,
                compradorNome: comprador.tradeName || comprador.legalName,
                cnaeEmpresa: cnaeEmpresaMatch,
                investidorMarcado: isMarkedInvestor,
                version: matchVersion,
              },
              status: "new",
            });
            existingCompPairs.add(`${asset.id}-${comprador.id}`);
            matchesFound++;
          }
        }
      }

      let aiRefined = 0;
      {
        try {
          const assetIds = [...new Set(
            allAssets
              .filter(a => !["fechado", "arquivado", "em_negociacao"].includes(a.statusAtivo || ""))
              .map(a => a.id)
          )];

          for (const assetId of assetIds.slice(0, 5)) {
            const topMatches = await db.select({
              id: matchSuggestions.id,
              orgId: matchSuggestions.orgId,
              assetId: matchSuggestions.assetId,
              investorProfileId: matchSuggestions.investorProfileId,
              score: matchSuggestions.score,
              reasonsJson: matchSuggestions.reasonsJson,
              status: matchSuggestions.status,
              companyId: investorProfiles.companyId,
            })
              .from(matchSuggestions)
              .leftJoin(investorProfiles, eq(matchSuggestions.investorProfileId, investorProfiles.id))
              .where(and(
                eq(matchSuggestions.orgId, orgId),
                eq(matchSuggestions.assetId, assetId),
                eq(matchSuggestions.status, "new"),
              ))
              .orderBy(desc(matchSuggestions.score))
              .limit(15);

            if (topMatches.length === 0) continue;

            const asset = allAssets.find(a => a.id === assetId);
            if (!asset) continue;

            const companyIds = topMatches
              .map(m => m.companyId || (m.reasonsJson as any)?.compradorId)
              .filter(Boolean) as number[];
            if (companyIds.length === 0) continue;

            const matchCompanies = allCompanies.filter(c => companyIds.includes(c.id));
            const candidates = matchCompanies.map(c => {
              const addr = (c.address as any) || {};
              return {
                taxId: c.cnpj || String(c.id),
                legalName: c.legalName || "",
                tradeName: c.tradeName || null,
                cnaePrincipal: c.cnaePrincipal || null,
                porte: c.porte || null,
                city: addr.city || addr.municipio || null,
                state: addr.state || addr.uf || null,
                equity: c.shareCapital || null,
              };
            });

            if (candidates.length === 0) continue;

            const rankings = await aiRankBuyers(
              {
                id: asset.id,
                type: asset.type,
                name: asset.title,
                estado: asset.estado,
                location: asset.location,
                areaHa: asset.areaHa ? Number(asset.areaHa) : null,
                priceAsking: asset.priceAsking ? Number(asset.priceAsking) : null,
                camposEspecificos: asset.camposEspecificos,
                geoScore: asset.geoScore,
                docsStatus: asset.docsStatus,
                attributesJson: asset.attributesJson,
              },
              candidates
            );

            const rankMap = new Map(rankings.map(r => [r.taxId, r]));

            for (const match of topMatches) {
              const compId = match.companyId || (match.reasonsJson as any)?.compradorId;
              const comp = matchCompanies.find(c => c.id === compId);
              if (!comp) continue;

              const key = comp.cnpj || String(comp.id);
              const iaResult = rankMap.get(key);
              if (!iaResult) continue;

              const oldScore = match.score || 0;
              const combinedScore = Math.round(oldScore * 0.7 + iaResult.scoreIA * 0.3);
              const existingReasons = (match.reasonsJson as any) || {};

              await db.update(matchSuggestions)
                .set({
                  score: Math.min(combinedScore, 100),
                  reasonsJson: {
                    ...existingReasons,
                    iaAnalysis: {
                      scoreIA: iaResult.scoreIA,
                      justificativa: iaResult.justificativa,
                      sinergias: iaResult.sinergias,
                      ressalvas: iaResult.ressalvas,
                      recomendado: iaResult.recomendado,
                    },
                    version: "v5-ia",
                  },
                })
                .where(eq(matchSuggestions.id, match.id));
              aiRefined++;
            }
          }
        } catch (aiErr) {
          console.warn("AI refinement in matching (non-fatal):", aiErr);
        }
      }

      if (matchesFound > 0 || aiRefined > 0) {
        sendNotification({
          id: notifId(),
          type: "new_match",
          orgId: getOrgId(req),
          title: aiRefined > 0 && matchesFound === 0 ? "Matches refinados por IA" : "Novos matches encontrados",
          message: `${matchesFound > 0 ? `${matchesFound} nova(s) sugestão(ões)` : ""}${matchesFound > 0 && aiRefined > 0 ? " + " : ""}${aiRefined > 0 ? `${aiRefined} refinado(s) por IA` : ""}`,
          link: "/matching",
          createdAt: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        matchesFound,
        aiRefined,
        details: {
          totalAssets: allAssets.length,
          totalInvestors: allInvestors.length,
          totalCompanies: allCompanies.length,
          assetsSkipped,
          pairsEvaluated,
          existingSuggestions: allExistingSuggestions.length,
        },
      });
    } catch (err) {
      console.error("Matching engine error:", err);
      res.status(500).json({ message: "Matching failed" });
    }
  });

  app.post("/api/matching/assets/:id/ai-enrich", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const assetId = parseInt(req.params.id);
    if (isNaN(assetId)) return res.status(400).json({ message: "ID inválido" });
    const orgId = getOrgId(req);
    try {
      const [asset] = await db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.orgId, orgId)));
      if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });

      const ce = (asset.camposEspecificos as Record<string, any>) || {};
      const result = await aiEnrichAsset({
        title: asset.title,
        type: asset.type,
        location: asset.location || undefined,
        municipio: asset.municipio || undefined,
        estado: asset.estado || undefined,
        areaHa: asset.areaHa || undefined,
        priceAsking: asset.priceAsking || undefined,
        description: asset.description || undefined,
        camposEspecificos: ce,
      });

      const updated = { ...ce, iaEnrichment: result };
      await db.update(assets).set({ camposEspecificos: updated }).where(eq(assets.id, assetId));

      if ((result as any)._failReason) {
        res.json({ success: false, message: `Enriquecimento falhou: ${(result as any)._failReason}`, iaEnrichment: result });
      } else {
        res.json({ success: true, iaEnrichment: result });
      }
    } catch (err: any) {
      console.error("[AI-Asset-Enrich Route] Error:", err.message);
      res.status(500).json({ message: "Erro no enriquecimento IA do ativo" });
    }
  });

  app.post("/api/matching/assets/:assetId/add-buyer", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const assetId = parseInt(req.params.assetId);
    if (isNaN(assetId)) return res.status(400).json({ message: "assetId inválido" });

    const schema = z.object({ companyId: z.number().int().positive(), companyName: z.string().optional(), source: z.string().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "companyId (número) obrigatório" });
    const { companyId, companyName, source } = parsed.data;

    const orgId = getOrgId(req);
    try {
      const [asset] = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.id, assetId), eq(assets.orgId, orgId))).limit(1);
      if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });

      const [company] = await db.select({ id: companies.id, legalName: companies.legalName }).from(companies).where(and(eq(companies.id, companyId), eq(companies.orgId, orgId))).limit(1);
      if (!company) return res.status(404).json({ message: "Empresa não encontrada" });

      const existing = await db.select().from(matchSuggestions).where(
        and(eq(matchSuggestions.assetId, assetId), eq(matchSuggestions.orgId, orgId))
      );
      const alreadyLinked = existing.some(e => (e.reasonsJson as any)?.compradorId === companyId);
      if (alreadyLinked) {
        return res.status(200).json({ alreadyLinked: true });
      }

      const buyerName = companyName || company.legalName || "Empresa";
      const [suggestion] = await db.insert(matchSuggestions).values({
        orgId,
        assetId,
        investorProfileId: null,
        score: 70,
        reasonsJson: {
          tipo: "estrategico",
          compradorId: companyId,
          compradorNome: buyerName,
          reasons: ["Importado da Prospecção Reversa"],
          source: source || "manual_import",
        },
        status: "new",
      }).returning();

      res.status(201).json(suggestion);
    } catch (err) {
      console.error("Add buyer error:", err);
      res.status(500).json({ message: "Erro ao vincular comprador ao ativo" });
    }
  });

  app.post("/api/matching/assets/:assetId/importar-comprador", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const assetId = parseInt(req.params.assetId);
    if (isNaN(assetId)) return res.status(400).json({ message: "assetId inválido" });

    const schema = z.object({
      cnpj: z.string().min(11),
      tradeName: z.string().optional(),
      legalName: z.string().optional(),
      porte: z.string().optional(),
      cnaePrincipal: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "CNPJ obrigatório", errors: parsed.error.errors });
    const { cnpj, tradeName, legalName, porte, cnaePrincipal, city, state } = parsed.data;

    const orgId = getOrgId(req);
    try {
      const [asset] = await db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.orgId, orgId))).limit(1);
      if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });

      const cnpjClean = cnpj.replace(/\D/g, "");
      const [existingCompany] = await db.select().from(companies)
        .where(and(eq(companies.cnpj, cnpjClean), eq(companies.orgId, orgId))).limit(1);

      let company = existingCompany;
      if (!company) {
        let cnpjaData: any = null;
        try {
          const cnpjaKey = process.env.CNPJA_API_KEY;
          if (cnpjaKey) {
            const { getCached, setCached } = await import("../cache");
            const cached = await getCached<any>("cnpja", `office:${cnpjClean}`);
            if (cached) {
              cnpjaData = cached;
            } else {
              const cnpjaRes = await fetch(`https://api.cnpja.com/office/${cnpjClean}?strategy=CACHE_IF_FRESH&maxAge=30`, {
                headers: { Authorization: cnpjaKey },
              });
              if (cnpjaRes.ok) {
                cnpjaData = await cnpjaRes.json();
                await setCached("cnpja", `office:${cnpjClean}`, cnpjaData);
              }
            }
          }
        } catch (e) {
          console.warn("[importar-comprador] CNPJA fetch error:", e);
        }

        let resolvedLegal = legalName || tradeName || cnpjClean;
        let resolvedTrade = tradeName || null;
        let resolvedPorte = porte || null;
        let resolvedCnae = cnaePrincipal || null;
        let phones: string[] = [];
        let emails: string[] = [];
        let address: any = city || state ? { city: city || null, state: state || null } : {};
        let cnaeSecundarios: string[] = [];
        let shareCapital: number | null = null;
        let enrichmentSocios: any[] = [];

        if (cnpjaData) {
          resolvedLegal = cnpjaData.company?.name || resolvedLegal;
          resolvedTrade = cnpjaData.alias || resolvedTrade;
          resolvedPorte = cnpjaData.company?.size?.text || resolvedPorte;
          resolvedCnae = cnpjaData.mainActivity?.text || resolvedCnae;
          cnaeSecundarios = (cnpjaData.sideActivities || []).map((a: any) => a.text);
          shareCapital = cnpjaData.company?.equity != null ? Number(cnpjaData.company.equity) : null;

          phones = (cnpjaData.phones || []).map((p: any) => `(${p.area}) ${p.number}`);
          emails = (cnpjaData.emails || []).map((e: any) => e.address?.toLowerCase()).filter(Boolean);

          if (cnpjaData.address) {
            address = {
              street: cnpjaData.address.street || null,
              number: cnpjaData.address.number || null,
              details: cnpjaData.address.details || null,
              district: cnpjaData.address.district || null,
              city: cnpjaData.address.city || city || null,
              state: cnpjaData.address.state || state || null,
              zip: cnpjaData.address.zip || null,
            };
          }

          enrichmentSocios = (cnpjaData.company?.members || []).map((m: any) => ({
            name: m.person?.name,
            role: m.role?.text,
            since: m.since,
            taxId: m.person?.taxId,
          }));
        }

        const [created] = await db.insert(companies).values({
          orgId,
          cnpj: cnpjClean,
          legalName: resolvedLegal,
          tradeName: resolvedTrade,
          porte: resolvedPorte,
          cnaePrincipal: resolvedCnae,
          cnaeSecundarios,
          shareCapital: shareCapital,
          phones,
          emails,
          address,
          enrichmentData: cnpjaData ? {
            cnpja: cnpjaData,
            socios: enrichmentSocios,
            status: cnpjaData.status?.text || null,
            natureza: cnpjaData.company?.nature?.text || null,
            simplesNacional: cnpjaData.company?.simples?.optant || false,
            cnaeCode: cnpjaData.mainActivity?.id || null,
          } : {},
          enrichedAt: cnpjaData ? new Date() : null,
        } as any).returning();
        company = created;

        const companyIdForEnrich = created.id;
        waterfallEnrich({
          cnpj: cnpjClean,
          name: resolvedTrade || resolvedLegal,
          website: undefined,
          knownPhones: phones,
        }).then(async (result) => {
          try {
            const patch: Record<string, any> = {};
            if (result.estimatedRevenue) patch.revenueEstimateLabel = result.estimatedRevenue;
            if (result.employeeCount) patch.employeeCount = result.employeeCount;
            if (result.shareCapital !== undefined && !shareCapital) patch.shareCapital = result.shareCapital;
            if (result.website) patch.website = result.website;
            if (result.phones?.length && !phones.length) patch.phones = result.phones;
            if (result.emails?.length && !emails.length) patch.emails = result.emails;
            if (result.tradingName && !resolvedTrade) patch.tradeName = result.tradingName;

            const currentEnrich = (created.enrichmentData as any) || {};
            patch.enrichmentData = { ...currentEnrich, waterfall: result.raw || result, waterfallSource: result.source };
            patch.enrichedAt = new Date();

            if (Object.keys(patch).length > 0) {
              await db.update(companies).set(patch).where(eq(companies.id, companyIdForEnrich));
              console.log(`[ImportarComprador] Waterfall enriqueceu empresa ${companyIdForEnrich} via ${result.source}`);
            }
          } catch (e: any) {
            console.error(`[ImportarComprador] Erro ao salvar waterfall para empresa ${companyIdForEnrich}:`, e.message);
          }
        }).catch((e: any) => {
          console.error(`[ImportarComprador] Waterfall falhou para CNPJ ${cnpjClean}:`, e.message);
        });
      }

      const companyName = company.tradeName || company.legalName || tradeName || legalName || "Empresa";

      const existingMatch = await db.select().from(matchSuggestions).where(
        and(eq(matchSuggestions.assetId, assetId), eq(matchSuggestions.orgId, orgId))
      );
      const alreadyLinked = existingMatch.some(e => (e.reasonsJson as any)?.compradorId === company.id);
      if (!alreadyLinked) {
        await db.insert(matchSuggestions).values({
          orgId,
          assetId,
          investorProfileId: null,
          score: 70,
          reasonsJson: {
            tipo: "estrategico",
            compradorId: company.id,
            compradorNome: companyName,
            reasons: ["Importado da Prospecção Reversa"],
            source: "prospeccao_ativo",
          },
          status: "new",
        });
      }

      const [existingProfile] = await db.select().from(investorProfiles)
        .where(and(eq(investorProfiles.companyId, company.id), eq(investorProfiles.orgId, orgId))).limit(1);

      if (!existingProfile) {
        const cnaeList = company.cnaePrincipal ? [company.cnaePrincipal] : [];
        await db.insert(investorProfiles).values({
          orgId,
          name: company.tradeName || company.legalName || "Investidor",
          companyId: company.id,
          buyerType: "estrategico",
          cnaeInteresse: cnaeList,
          regionsOfInterest: state ? [state] : [],
        } as any);
      }

      if (!existingCompany || !(company.enrichmentData as any)?.importedAsInvestor) {
        const currentEnrich = (company.enrichmentData as any) || {};
        await db.update(companies).set({
          enrichmentData: {
            ...currentEnrich,
            importedAsInvestor: true,
            perfilComprador: {
              ...(currentEnrich.perfilComprador || {}),
              buyerType: "estrategico",
              origem: "match_reverso",
            },
          },
        }).where(eq(companies.id, company.id));
      }

      res.status(201).json({ company, alreadyExisted: !!existingCompany });
    } catch (err) {
      console.error("Importar comprador error:", err);
      res.status(500).json({ message: "Erro ao importar comprador" });
    }
  });

  app.get("/api/matching/assets/:id/suggestions", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const orgId = getOrgId(req);
    const assetId = Number(req.params.id);

    try {
      const suggestions = await db
        .select()
        .from(matchSuggestions)
        .where(
          and(
            eq(matchSuggestions.assetId, assetId),
            eq(matchSuggestions.orgId, orgId)
          )
        )
        .orderBy(desc(matchSuggestions.score));

      const enriched = await Promise.all(
        suggestions.map(async (s) => {
          let investorName: string | null = null;
          let investorCnpj: string | null = null;
          let companyId: number | null = null;

          if (s.investorProfileId) {
            const inv = await storage.getInvestor(s.investorProfileId).catch(() => null);
            if (inv) {
              investorName = inv.name;
              companyId = (inv as any).companyId || null;
            }
          }

          if (!investorName && (s as any).companyId) {
            const [co] = await db.select().from(companies)
              .where(and(eq(companies.id, (s as any).companyId), eq(companies.orgId, orgId))).catch(() => []);
            if (co) {
              investorName = co.tradeName || co.legalName;
              investorCnpj = co.cnpj || null;
              companyId = co.id;
            }
          }

          const rj = (s.reasonsJson || {}) as any;
          if (!investorName && rj.compradorNome) {
            investorName = rj.compradorNome;
          }
          if (!companyId && rj.compradorId) {
            try {
              const [co] = await db.select().from(companies)
                .where(and(eq(companies.id, rj.compradorId), eq(companies.orgId, orgId))).limit(1);
              if (co) {
                if (!investorName) investorName = co.tradeName || co.legalName;
                investorCnpj = co.cnpj || null;
                companyId = co.id;
              }
            } catch {}
          }

          const tipo = rj.tipo || null;
          return { ...s, investorName, investorCnpj, companyId, tipo };
        })
      );

      res.json(enriched);
    } catch (err) {
      res.status(500).json({ message: "Erro ao buscar matches" });
    }
  });

  app.post("/api/matching/suggestions/:id/feedback", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const suggId = Number(req.params.id);
      const feedbackSchema = z.object({
        action: z.enum(["accepted", "rejected", "deferred"]),
        rejectionReason: z.string().optional(),
        rejectionNote: z.string().optional(),
      });
      const parsed = feedbackSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.errors });

      const { action, rejectionReason, rejectionNote } = parsed.data;

      const [suggestion] = await db.select().from(matchSuggestions)
        .where(and(eq(matchSuggestions.id, suggId), eq(matchSuggestions.orgId, orgId)));
      if (!suggestion) return res.status(404).json({ message: "Sugestão não encontrada" });

      let assetType: string | null = null;
      let assetEstado: string | null = null;
      let assetPrice: number | null = null;
      if (suggestion.assetId) {
        const asset = await storage.getAsset(suggestion.assetId).catch(() => null);
        if (asset) {
          assetType = asset.type;
          assetEstado = normalizeState(asset.estado || asset.location);
          assetPrice = asset.priceAsking || null;
        }
      }

      const [feedback] = await db.insert(matchFeedback).values({
        orgId,
        suggestionId: suggId,
        investorProfileId: suggestion.investorProfileId,
        assetId: suggestion.assetId,
        action,
        rejectionReason: rejectionReason || null,
        rejectionNote: rejectionNote || null,
        assetType,
        assetEstado,
        assetPrice,
        scoreAtDecision: suggestion.score,
      }).returning();

      if (action === "rejected") {
        await db.update(matchSuggestions)
          .set({ status: "rejected" } as any)
          .where(eq(matchSuggestions.id, suggId));
      } else if (action === "deferred") {
        await db.update(matchSuggestions)
          .set({ status: "deferred" } as any)
          .where(eq(matchSuggestions.id, suggId));
      }

      if (suggestion.investorProfileId) {
        await updateInvestorDynamicProfile(db, suggestion.investorProfileId, orgId);
      }

      res.json({ success: true, feedback });
    } catch (err) {
      console.error("Feedback error:", err);
      res.status(500).json({ message: "Erro ao registrar feedback" });
    }
  });

  app.get("/api/matching/investors/:id/dynamic-profile", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const investorId = Number(req.params.id);

      const [investor] = await db.select().from(investorProfiles)
        .where(and(eq(investorProfiles.id, investorId), eq(investorProfiles.orgId, orgId)));
      if (!investor) return res.status(404).json({ message: "Investidor não encontrado" });

      const [profile] = await db.select().from(investorDynamicProfile)
        .where(and(eq(investorDynamicProfile.investorProfileId, investorId), eq(investorDynamicProfile.orgId, orgId)));

      const feedbacks = await db.select().from(matchFeedback)
        .where(and(eq(matchFeedback.investorProfileId, investorId), eq(matchFeedback.orgId, orgId)));

      res.json({
        investor: { id: investor.id, name: investor.name },
        dynamicProfile: profile || null,
        feedbackSummary: {
          total: feedbacks.length,
          accepted: feedbacks.filter(f => f.action === "accepted").length,
          rejected: feedbacks.filter(f => f.action === "rejected").length,
          deferred: feedbacks.filter(f => f.action === "deferred").length,
          rejectionReasons: feedbacks
            .filter(f => f.rejectionReason)
            .reduce((acc, f) => { acc[f.rejectionReason!] = (acc[f.rejectionReason!] || 0) + 1; return acc; }, {} as Record<string, number>),
        },
      });
    } catch (err) {
      res.status(500).json({ message: "Erro ao buscar perfil dinâmico" });
    }
  });

  app.post("/api/matching/investors/:id/recalculate-profile", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const investorId = Number(req.params.id);

      const [investor] = await db.select().from(investorProfiles)
        .where(and(eq(investorProfiles.id, investorId), eq(investorProfiles.orgId, orgId)));
      if (!investor) return res.status(404).json({ message: "Investidor não encontrado" });

      const profile = await updateInvestorDynamicProfile(db, investorId, orgId);
      res.json({ success: true, profile });
    } catch (err) {
      console.error("Recalculate profile error:", err);
      res.status(500).json({ message: "Erro ao recalcular perfil" });
    }
  });
}
