import type { Express } from "express";
import type { IStorage } from "../storage";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { api } from "@shared/routes";
import { z } from "zod";
import { matchSuggestions, deals, pipelineStages, assets, companies, leads, matchFeedback, investorDynamicProfile, investorProfiles } from "@shared/schema";
import { eq, and, asc, desc, isNull, sql } from "drizzle-orm";
import { sendNotification, notifId } from "../notifications";
import { getOrgId } from "../lib/tenant";
import {
  calculateSmartScore,
  buildMatchingContext,
  updateInvestorDynamicProfile,
  normalizeState,
  matchesRegion,
} from "../lib/smart-matching";

export { matchesRegion } from "../lib/smart-matching";

export function registerMatchingRoutes(app: Express, storage: IStorage, db: NodePgDatabase<any>) {
  app.get(api.matching.investors.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const orgId = getOrgId(req);
    const investors = await storage.getInvestors(orgId);
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
      const orgId = getOrgId(req);
      const investor = await storage.getInvestor(Number(req.params.id));
      if (!investor || investor.orgId !== orgId) return res.status(404).json({ message: "Investidor não encontrado" });
      const updated = await storage.updateInvestor(Number(req.params.id), req.body);
      res.json(updated);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
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

      for (const asset of allAssets) {
        if (["fechado", "arquivado", "em_negociacao"].includes(asset.statusAtivo || "")) continue;
        if (asset.exclusivoAte && new Date(asset.exclusivoAte) > new Date()) continue;

        for (const investor of allInvestors) {
          if (existingSuggestionKeys.has(`${asset.id}_${investor.id}`)) continue;

          const investorTypes = (investor.assetTypes as string[]) || [];
          const perfilCompleto = investorTypes.length > 0 ||
            investor.ticketMin != null || investor.ticketMax != null ||
            ((investor.regionsOfInterest as string[]) || []).length > 0;
          if (!perfilCompleto) continue;

          const result = calculateSmartScore(asset, investor, ctx);

          if (result.score >= 40 && result.penalties.length <= 2) {
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
      const compradores = allCompanies.filter((c: any) => {
        const prefs = (c.enrichmentData as any) || {};
        return prefs.buyerType === "estrategico" || ((prefs.cnaeInteresse || []).length > 0);
      });

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
        NEGOCIO: [],
      };

      for (const asset of allAssets) {
        if (["fechado", "arquivado", "em_negociacao"].includes(asset.statusAtivo || "")) continue;
        if (asset.exclusivoAte && new Date(asset.exclusivoAte) > new Date()) continue;

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

          if (cnaeMatch) { score += 40; reasons.push(`CNAE compatível com tipo ${asset.type}`); }
          else if (asset.type === "NEGOCIO") { score += 20; reasons.push("Negócio — comprador estratégico genérico"); }
          else { penalties.push(`CNAE não compatível com ${asset.type}`); }

          if (regioesInteresse.length === 0) { score += 15; reasons.push("Comprador opera em qualquer região"); }
          else if (matchesRegion(asset.location || asset.estado, regioesInteresse)) { score += 25; reasons.push("Região compatível"); }
          else { penalties.push("Região fora do interesse"); }

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
                reasonsJson: { reasons, penalties, tipo: "estrategico", compradorId: comprador.id, compradorNome: comprador.tradeName || comprador.legalName, version: "v2" },
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
            const cnpjaRes = await fetch(`https://api.cnpja.com/office/${cnpjClean}`, {
              headers: { Authorization: cnpjaKey },
            });
            if (cnpjaRes.ok) cnpjaData = await cnpjaRes.json();
          }
        } catch (e) {
          console.warn("[importar-comprador] CNPJA fetch error:", e);
        }

        const phones: string[] = [];
        const emails: string[] = [];
        let address: any = {};
        let resolvedPorte = porte || null;
        let resolvedCnae = cnaePrincipal || null;
        let resolvedLegal = legalName || tradeName || cnpjClean;
        let resolvedTrade = tradeName || null;

        if (cnpjaData) {
          resolvedLegal = cnpjaData.company?.name || resolvedLegal;
          resolvedTrade = cnpjaData.alias || resolvedTrade;
          resolvedPorte = cnpjaData.company?.size?.text || resolvedPorte;
          resolvedCnae = cnpjaData.mainActivity?.text || resolvedCnae;

          if (cnpjaData.phones?.length) {
            for (const p of cnpjaData.phones) {
              const num = `(${p.area}) ${p.number}`;
              if (!phones.includes(num)) phones.push(num);
            }
          }
          if (cnpjaData.emails?.length) {
            for (const e of cnpjaData.emails) {
              if (e.address && !emails.includes(e.address.toLowerCase())) emails.push(e.address.toLowerCase());
            }
          }
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
        } else if (city || state) {
          address = { city: city || null, state: state || null };
        }

        const [created] = await db.insert(companies).values({
          orgId,
          cnpj: cnpjClean,
          legalName: resolvedLegal,
          tradeName: resolvedTrade,
          porte: resolvedPorte,
          cnaePrincipal: resolvedCnae,
          phones,
          emails,
          address,
          source: "prospeccao_ativo",
          enrichmentData: cnpjaData ? { cnpja: cnpjaData } : {},
          enrichedAt: cnpjaData ? new Date() : null,
        } as any).returning();
        company = created;
      }

      const [existingLead] = await db.select().from(leads)
        .where(and(eq(leads.companyId, company.id), eq(leads.orgId, orgId), eq(leads.source, "prospeccao_ativo"))).limit(1);

      let lead = existingLead;
      if (!lead) {
        const [created] = await db.insert(leads).values({
          orgId,
          companyId: company.id,
          source: "prospeccao_ativo",
          status: "new",
          score: 60,
        }).returning();
        lead = created;
      }

      const [firstStage] = await db.select().from(pipelineStages)
        .where(eq(pipelineStages.pipelineType, "ASSET"))
        .orderBy(asc(pipelineStages.order))
        .limit(1);

      if (!firstStage) return res.status(400).json({ message: "Nenhum estágio ASSET configurado no pipeline" });

      const companyName = tradeName || legalName || company.legalName || "Empresa";
      const dealTitle = `${companyName} — Interesse em ${asset.title || "Ativo"}`;

      const [existingDeal] = await db.select().from(deals)
        .where(and(
          eq(deals.assetId, assetId),
          eq(deals.companyId, company.id),
          eq(deals.orgId, orgId),
          eq(deals.pipelineType, "ASSET")
        )).limit(1);

      let deal = existingDeal;
      if (!deal) {
        const [created] = await db.insert(deals).values({
          orgId,
          pipelineType: "ASSET",
          stageId: firstStage.id,
          title: dealTitle,
          assetId,
          companyId: company.id,
          source: "PROSPECCAO",
          amountEstimate: asset.priceAsking || null,
          labels: ["Prospecção"],
        } as any).returning();
        deal = created;
      }

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

      res.status(201).json({ company, lead, deal, alreadyExisted: !!existingCompany });
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
          if (!investorName && rj.compradorId) {
            try {
              const [co] = await db.select().from(companies)
                .where(and(eq(companies.id, rj.compradorId), eq(companies.orgId, orgId))).limit(1);
              if (co) {
                investorName = co.tradeName || co.legalName;
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
