import type { Express } from "express";
import type { IStorage } from "../storage";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { api } from "@shared/routes";
import { z } from "zod";
import { matchSuggestions, deals, pipelineStages } from "@shared/schema";
import { eq, and, asc } from "drizzle-orm";
import { sendNotification, notifId } from "../notifications";
import { getOrgId } from "../lib/tenant";

const stateNormalization: Record<string, string[]> = {
  "AC": ["acre", "ac"],
  "AL": ["alagoas", "al"],
  "AP": ["amapá", "amapa", "ap"],
  "AM": ["amazonas", "am"],
  "BA": ["bahia", "ba"],
  "CE": ["ceará", "ceara", "ce"],
  "DF": ["distrito federal", "df"],
  "ES": ["espírito santo", "espirito santo", "es"],
  "GO": ["goiás", "goias", "go"],
  "MA": ["maranhão", "maranhao", "ma"],
  "MT": ["mato grosso", "mt"],
  "MS": ["mato grosso do sul", "ms"],
  "MG": ["minas gerais", "mg"],
  "PA": ["pará", "para", "pa"],
  "PB": ["paraíba", "paraiba", "pb"],
  "PR": ["paraná", "parana", "pr"],
  "PE": ["pernambuco", "pe"],
  "PI": ["piauí", "piaui", "pi"],
  "RJ": ["rio de janeiro", "rj"],
  "RN": ["rio grande do norte", "rn"],
  "RS": ["rio grande do sul", "rs"],
  "RO": ["rondônia", "rondonia", "ro"],
  "RR": ["roraima", "rr"],
  "SC": ["santa catarina", "sc"],
  "SP": ["são paulo", "sao paulo", "sp"],
  "SE": ["sergipe", "se"],
  "TO": ["tocantins", "to"],
};

export function matchesRegion(assetLocation: string | null, investorRegions: string[]): boolean {
  if (!assetLocation || investorRegions.length === 0) return true;
  const loc = assetLocation.toLowerCase();
  return investorRegions.some(r => {
    const rLower = r.toLowerCase();
    if (loc.includes(rLower)) return true;
    const variants = stateNormalization[r.toUpperCase()] || [rLower];
    return variants.some(v => loc.includes(v));
  });
}

export function registerMatchingRoutes(app: Express, storage: IStorage, db: NodePgDatabase<any>) {
  app.get(api.matching.investors.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const investors = await storage.getInvestors();
    res.json(investors);
  });

  app.post(api.matching.investors.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const input = api.matching.investors.create.input.parse(req.body);
      const data = await storage.createInvestor(input);
      res.status(201).json(data);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json(err.errors);
      res.status(500).json({ message: "Internal Error" });
    }
  });

  app.patch("/api/matching/investors/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const updated = await storage.updateInvestor(Number(req.params.id), req.body);
      res.json(updated);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.delete("/api/matching/investors/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      await storage.deleteInvestor(Number(req.params.id));
      res.status(204).end();
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.get(api.matching.suggestions.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const suggestions = await storage.getMatchSuggestions();
    res.json(suggestions);
  });

  app.patch("/api/matching/suggestions/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { status } = req.body;
      const [updated] = await db.update(matchSuggestions)
        .set({ status })
        .where(eq(matchSuggestions.id, Number(req.params.id)))
        .returning();
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Internal Error" });
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
      const investors = await storage.getInvestors();
      const investor = investors.find(i => i.id === suggestion.investorProfileId);

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

      res.json({ success: true, dealId: deal.id });
    } catch (err) {
      console.error("Matching accept error:", err);
      res.status(500).json({ message: "Erro ao aceitar match" });
    }
  });

  app.post(api.matching.suggestions.run.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const allAssets = await storage.getAssets();
      const allInvestors = await storage.getInvestors();
      let matchesFound = 0;

      for (const asset of allAssets) {
        for (const investor of allInvestors) {
          const existing = await db.select().from(matchSuggestions)
            .where(
              and(
                eq(matchSuggestions.assetId, asset.id),
                eq(matchSuggestions.investorProfileId, investor.id)
              )
            );

          if (existing.length > 0) continue;

          let score = 0;
          const reasons: string[] = [];
          const penalties: string[] = [];

          const investorTypes = (investor.assetTypes as string[]) || [];
          const perfilCompleto = investorTypes.length > 0 ||
            investor.ticketMin != null || investor.ticketMax != null ||
            ((investor.regionsOfInterest as string[]) || []).length > 0;

          if (!perfilCompleto) {
            penalties.push("Perfil do investidor incompleto — sem critérios definidos");
          } else if (investorTypes.length === 0) {
            score += 15;
            reasons.push("Investidor aceita qualquer tipo de ativo");
          } else if (investorTypes.includes(asset.type)) {
            score += 40;
            reasons.push(`Tipo "${asset.type}" está nas preferências do investidor`);
          } else {
            score -= 20;
            penalties.push(`Tipo "${asset.type}" não está nas preferências do investidor`);
          }

          if (asset.priceAsking) {
            const min = investor.ticketMin;
            const max = investor.ticketMax;

            if (!min && !max) {
              score += 20;
              reasons.push("Investidor não tem restrição de ticket");
            } else {
              const abaixoDoMin = min && asset.priceAsking < min * 0.8;
              const acimaDoMax = max && asset.priceAsking > max * 1.2;

              if (abaixoDoMin) {
                penalties.push(`Preço R$${(asset.priceAsking / 1e6).toFixed(1)}M abaixo do ticket mínimo R$${(min! / 1e6).toFixed(1)}M`);
              } else if (acimaDoMax) {
                penalties.push(`Preço R$${(asset.priceAsking / 1e6).toFixed(1)}M acima do ticket máximo R$${(max! / 1e6).toFixed(1)}M`);
              } else {
                if (min && max) {
                  const center = (min + max) / 2;
                  const distance = Math.abs(asset.priceAsking - center) / (max - min);
                  const proximity = Math.round((1 - distance) * 35);
                  score += Math.max(proximity, 15);
                  reasons.push(`Preço dentro do ticket (R$${(min / 1e6).toFixed(1)}M - R$${(max / 1e6).toFixed(1)}M)`);
                } else {
                  score += 25;
                  reasons.push("Preço compatível com ticket");
                }
              }
            }
          } else {
            score += 10;
            reasons.push("Preço a negociar");
          }

          const regions = (investor.regionsOfInterest as string[]) || [];
          if (regions.length === 0) {
            score += 15;
            reasons.push("Investidor opera em qualquer região");
          } else if (matchesRegion(asset.location || asset.estado, regions)) {
            score += 20;
            reasons.push(`Localização "${asset.estado || asset.location}" está no interesse do investidor`);
          } else {
            score += 0;
            penalties.push(`Região "${asset.estado || asset.location}" fora do interesse do investidor`);
          }

          if (asset.docsStatus === "completo" || asset.docsStatus === "regularizado") {
            score += 10;
            reasons.push("Documentação completa — menor risco");
          } else if (asset.docsStatus === "pendente") {
            score -= 5;
            penalties.push("Documentação pendente");
          }

          if (!perfilCompleto) continue;

          if (score >= 40 && penalties.length <= 1) {
            await db.insert(matchSuggestions).values({
              orgId: asset.orgId,
              assetId: asset.id,
              investorProfileId: investor.id,
              score: Math.min(score, 100),
              reasonsJson: { reasons, penalties },
              status: "new",
            });
            matchesFound++;
          }
        }
      }

      const orgId = getOrgId(req);
      const allCompanies = await storage.getCompanies?.() ?? [];
      const compradores = allCompanies.filter((c: any) => {
        const prefs = (c.enrichmentData as any) || {};
        return prefs.buyerType === "estrategico" || ((prefs.cnaeInteresse || []).length > 0);
      });

      const CNAE_POR_TIPO: Record<string, string[]> = {
        MINA:    ["0710", "0890", "0810", "0600"],
        TERRA:   ["0111", "0112", "0113", "0114", "0115", "0116", "0119", "0121", "0151"],
        AGRO:    ["0111", "0112", "1011", "1012", "1031", "1061", "1065"],
        FII_CRI: ["6422", "6423", "6431", "6432", "6450", "6630"],
        DESENVOLVIMENTO: ["4110", "4120", "4211", "6810", "6821"],
        NEGOCIO: [],
      };

      for (const asset of allAssets) {
        for (const comprador of compradores) {
          const enrichment = (comprador.enrichmentData as any) || {};
          const cnaeInteresse: string[] = enrichment.cnaeInteresse || [];
          const regioesInteresse: string[] = enrichment.regioesInteresse || [];
          const cnaesEsperados = CNAE_POR_TIPO[asset.type] || [];

          let score = 0;
          const reasons: string[] = [];
          const penalties: string[] = [];

          const cnaeMatch = cnaeInteresse.length === 0
            ? asset.type === "NEGOCIO"
            : cnaeInteresse.some(cnae => cnaesEsperados.some(esp => cnae.startsWith(esp)));

          if (cnaeMatch) {
            score += 40;
            reasons.push(`CNAE compatível com tipo ${asset.type}`);
          } else if (asset.type === "NEGOCIO") {
            score += 20;
            reasons.push("Negócio — comprador estratégico genérico");
          } else {
            penalties.push(`CNAE não compatível com ${asset.type}`);
          }

          if (regioesInteresse.length === 0) {
            score += 15;
            reasons.push("Comprador opera em qualquer região");
          } else if (matchesRegion(asset.location || asset.estado, regioesInteresse)) {
            score += 25;
            reasons.push("Região compatível");
          } else {
            penalties.push("Região fora do interesse");
          }

          if (asset.docsStatus === "completo") { score += 10; reasons.push("Documentação completa"); }

          if (score >= 40 && penalties.length <= 1) {
            const existingComp = await db.select().from(matchSuggestions).where(
              and(eq(matchSuggestions.assetId, asset.id), eq(matchSuggestions.orgId, orgId))
            );
            const jaExiste = existingComp.some(e => (e.reasonsJson as any)?.compradorId === comprador.id);
            if (!jaExiste) {
              await db.insert(matchSuggestions).values({
                orgId,
                assetId: asset.id,
                investorProfileId: null,
                score: Math.min(score, 100),
                reasonsJson: { reasons, penalties, tipo: "estrategico", compradorId: comprador.id, compradorNome: comprador.tradeName || comprador.legalName },
                status: "new",
              });
              matchesFound++;
            }
          }
        }
      }

      if (matchesFound > 0) {
        sendNotification({
          id: notifId(),
          type: "new_match",
          orgId: getOrgId(req),
          title: "Novos matches encontrados",
          message: `${matchesFound} nova(s) sugestão(ões) de match disponível(is)`,
          link: "/matching",
          createdAt: new Date().toISOString(),
        });
      }

      res.json({ success: true, matchesFound });
    } catch (err) {
      console.error("Matching engine error:", err);
      res.status(500).json({ message: "Matching failed" });
    }
  });
}
