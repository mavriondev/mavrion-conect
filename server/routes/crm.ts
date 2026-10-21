import type { Express } from "express";
import type { IStorage } from "../storage";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { api } from "@shared/routes";
import { z } from "zod";
import { dealComments, assets, matchSuggestions, portalListings, companies, investorProfiles, leads } from "@shared/schema";
import { sql, eq, and } from "drizzle-orm";
import { audit, diff } from "../audit";
import { sendNotification, notifId } from "../notifications";
import { getOrgId } from "../lib/tenant";

export function registerCrmRoutes(app: Express, storage: IStorage, db: NodePgDatabase<any>) {
  app.get(api.crm.deals.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    const companyIdParam = req.query.companyId ? Number(req.query.companyId) : undefined;
    const dealsList = await storage.getDeals(req.query.pipelineType as string | undefined, user?.orgId, companyIdParam);
    const commentCounts = await db
      .select({ dealId: dealComments.dealId, count: sql<number>`count(*)::int` })
      .from(dealComments)
      .groupBy(dealComments.dealId);
    const countMap = new Map(commentCounts.map(c => [c.dealId, c.count]));
    const enriched = dealsList.map(d => ({
      ...d,
      commentCount: countMap.get(d.id) || 0,
      attachmentCount: Array.isArray(d.attachments) ? d.attachments.length : 0,
    }));
    res.json(enriched);
  });

  app.post(api.crm.deals.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const input = api.crm.deals.create.input.parse(req.body);

      if (!input.stageId) {
        return res.status(400).json({ message: "stageId é obrigatório" });
      }
      if (input.stageId) {
        const stages = await storage.getPipelineStages();
        const stage = stages.find(s => s.id === input.stageId);
        if (!stage) {
          return res.status(400).json({ message: `Stage com id ${input.stageId} não encontrado` });
        }
        if (input.pipelineType && stage.pipelineType !== input.pipelineType) {
          return res.status(400).json({
            message: `Stage '${stage.name}' pertence ao pipeline '${stage.pipelineType}', não '${input.pipelineType}'`
          });
        }
      }

      const data = await storage.createDeal({ ...input, orgId: getOrgId(req) });
      const user = req.user as any;
      if (user) {
        await audit({
          userId: user.id, userName: user.username,
          entity: "deal", entityId: data.id, entityTitle: data.title,
          action: "created",
        });
      }
      res.status(201).json(data);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json(err.errors);
      res.status(500).json({ message: "Internal Error" });
    }
  });

  app.patch(api.crm.deals.update.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const id = Number(req.params.id);
      const before = await storage.getDeal(id);
      if (!before || before.orgId !== orgId) return res.status(404).json({ message: "Deal não encontrado" });
      const body = { ...req.body };
      if (typeof body.dueDate === "string") body.dueDate = new Date(body.dueDate);
      if (typeof body.expectedCloseDate === "string") body.expectedCloseDate = new Date(body.expectedCloseDate);
      if (typeof body.createdAt === "string") body.createdAt = new Date(body.createdAt);
      const input = api.crm.deals.update.input.parse(body);
      const data = await storage.updateDeal(id, input);
      const user = req.user as any;
      if (user && before) {
        const changes = diff(before, data, ["stageId", "amountEstimate", "priority", "probability", "title", "dueDate", "labels"]);
        if (Object.keys(changes).length > 0) {
          await audit({
            userId: user.id, userName: user.username,
            entity: "deal", entityId: data.id, entityTitle: data.title,
            action: changes.stageId ? "stage_changed" : "updated",
            changes,
          });

          if (changes.stageId) {
            const stages = await storage.getPipelineStages();
            const newStage = stages.find(s => s.id === data.stageId);
            const stageName = newStage?.name || "";

            if (stageName === "Fechamento") {
              sendNotification({
                id: notifId(),
                type: "deal_stage",
                orgId: getOrgId(req),
                title: "Deal chegou ao Fechamento",
                message: `"${data.title}" entrou na etapa de Fechamento!`,
                link: "/crm",
                createdAt: new Date().toISOString(),
              });

              if (data.assetId) {
                await db.update(assets)
                  .set({ statusAtivo: "fechado" } as any)
                  .where(and(eq(assets.id, data.assetId), eq(assets.orgId, orgId)));

                await db.update(matchSuggestions)
                  .set({ status: "dismissed" })
                  .where(and(
                    eq(matchSuggestions.assetId, data.assetId),
                    eq(matchSuggestions.orgId, orgId),
                    eq(matchSuggestions.status, "new")
                  ));

                await db.update(portalListings)
                  .set({ status: "archived" } as any)
                  .where(and(
                    eq(portalListings.assetId, data.assetId),
                    eq(portalListings.orgId, orgId),
                    eq(portalListings.status, "published")
                  ));
              }
            }

            const negotiationStages = ["Due Diligence", "LOI / Carta de Intenção", "LOI", "Negociação Final"];
            if (negotiationStages.includes(stageName) && data.assetId) {
              await db.update(assets)
                .set({ statusAtivo: "em_negociacao" } as any)
                .where(and(eq(assets.id, data.assetId), eq(assets.orgId, orgId)));
            }
          }
        }
      }
      res.json(data);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json(err.errors);
      res.status(500).json({ message: "Internal Error" });
    }
  });

  app.get("/api/crm/deals/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const deal = await storage.getDeal(Number(req.params.id));
      if (!deal || deal.orgId !== orgId) return res.status(404).json({ message: "Deal não encontrado" });
      res.json(deal);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.delete("/api/crm/deals/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const id = Number(req.params.id);
      const deal = await storage.getDeal(id);
      if (!deal || deal.orgId !== orgId) return res.status(404).json({ message: "Deal não encontrado" });
      await storage.deleteDeal(id);
      const user = req.user as any;
      if (user) {
        await audit({
          userId: user.id, userName: user.username,
          entity: "deal", entityId: id, entityTitle: deal.title,
          action: "deleted",
        });
      }
      res.status(204).end();
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.get(api.crm.stages.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const stages = await storage.getPipelineStages();

    const investorStages = stages.filter(s => s.pipelineType === "INVESTOR");
    const assetStages = stages.filter(s => s.pipelineType === "ASSET");
    const investorNames = investorStages.map(s => s.name);
    const assetNames = assetStages.map(s => s.name);

    const investorWorkflow = ["Prospecção", "Análise", "LOI", "Due Diligence", "Fechamento"];
    const maWorkflow = [
      { name: "Identificado",             color: "#94a3b8" },
      { name: "Contato Inicial",           color: "#60a5fa" },
      { name: "NDA Assinado",              color: "#818cf8" },
      { name: "Due Diligence",             color: "#f59e0b" },
      { name: "LOI / Carta de Intenção",   color: "#f97316" },
      { name: "Negociação Final",          color: "#ef4444" },
      { name: "Fechamento",                color: "#10b981" },
    ];

    const needsInvestorSeed = !investorWorkflow.every(n => investorNames.includes(n));
    const needsMaSeed = !maWorkflow.some(s => assetNames.includes(s.name));

    if (needsInvestorSeed && investorStages.length === 0) {
      for (let i = 0; i < investorWorkflow.length; i++) {
        await storage.createPipelineStage({ orgId: getOrgId(req), pipelineType: "INVESTOR", name: investorWorkflow[i], order: i + 1, color: null });
      }
    }
    if (needsMaSeed && assetStages.length === 0) {
      for (let i = 0; i < maWorkflow.length; i++) {
        await storage.createPipelineStage({ orgId: getOrgId(req), pipelineType: "ASSET", name: maWorkflow[i].name, order: i + 1, color: maWorkflow[i].color });
      }
      console.log("✓ Estágios M&A criados no pipeline de Ativos");
    }

    const finalStages = (investorStages.length < 5 || assetStages.length < 5)
      ? await storage.getPipelineStages()
      : stages;

    res.json(finalStages);
  });

  app.post("/api/crm/stages", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { name, pipelineType, color } = req.body;
      if (!name || !pipelineType) return res.status(400).json({ message: "name e pipelineType são obrigatórios" });
      const stages = await storage.getPipelineStages();
      const sameType = stages.filter(s => s.pipelineType === pipelineType);
      const order = sameType.length > 0 ? Math.max(...sameType.map(s => s.order)) + 1 : 1;
      const stage = await storage.createPipelineStage({ orgId: getOrgId(req), pipelineType, name, order, color: color || null });
      res.status(201).json(stage);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.delete("/api/crm/stages/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const id = Number(req.params.id);
      const user2 = req.user as any;
      const allDeals = await storage.getDeals(undefined, user2?.orgId);
      const stageDeals = allDeals.filter(d => d.stageId === id);
      if (stageDeals.length > 0) return res.status(409).json({ message: "Remova todos os deals desta coluna antes de excluí-la" });
      await storage.deletePipelineStage(id);
      res.status(204).end();
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.patch("/api/crm/stages/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const updated = await storage.updatePipelineStage(Number(req.params.id), req.body);
      res.json(updated);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.get(api.crm.contacts.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const orgId = getOrgId(req);
    const contacts = await storage.getContacts(orgId);
    res.json(contacts);
  });

  app.get("/api/deal-comments", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const dealId = Number(req.query.dealId);
      if (!dealId) return res.status(400).json({ message: "dealId é obrigatório" });
      const deal = await storage.getDeal(dealId);
      if (!deal || deal.orgId !== orgId) return res.status(404).json({ message: "Deal não encontrado" });
      const comments = await storage.getDealComments(dealId);
      res.json(comments);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.post("/api/deal-comments", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const { dealId, content, authorName } = req.body;
      if (!dealId || !content) return res.status(400).json({ message: "dealId e content são obrigatórios" });
      const deal = await storage.getDeal(dealId);
      if (!deal || deal.orgId !== orgId) return res.status(404).json({ message: "Deal não encontrado" });
      const comment = await storage.createDealComment({ dealId, content, authorName: authorName || "Usuário" });
      res.status(201).json(comment);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.delete("/api/deal-comments/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      await storage.deleteDealComment(Number(req.params.id));
      res.status(204).end();
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.get("/api/crm/deals/:id/activities", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const dealId = Number(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal || deal.orgId !== orgId) return res.status(404).json({ message: "Deal não encontrado" });
      const activities = await db.execute(
        sql`SELECT * FROM deal_activities WHERE deal_id = ${dealId} ORDER BY created_at DESC`
      );
      res.json(activities.rows);
    } catch (err: any) {
      res.status(500).json({ message: "Erro ao buscar atividades" });
    }
  });

  app.post("/api/crm/deals/:id/activities", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const dealId = Number(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal || deal.orgId !== orgId) return res.status(404).json({ message: "Deal não encontrado" });
      const { type, description } = req.body;
      const user = req.user as any;
      await db.execute(
        sql`INSERT INTO deal_activities (deal_id, type, description, created_by, created_at)
            VALUES (${dealId}, ${type || "nota"}, ${description}, ${user?.username || "Sistema"}, NOW())`
      );
      res.status(201).json({ success: true });
    } catch (err: any) {
      console.error("Erro ao salvar atividade:", err);
      res.status(500).json({ message: "Erro ao salvar atividade" });
    }
  });

  app.get(api.stats.dashboard.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const stats = await storage.getDashboardStats(getOrgId(req));
    res.json(stats);
  });

  const ONBOARDING_FIELDS = [
    "buyerType", "regionsOfInterest", "assetTypes", "ticketMin", "ticketMax",
    "prazoDecisao", "capacidadeAquisicao", "cnaeInteresse", "dealsAnteriores",
    "fonteCapital", "experienciaSetor", "estruturaSocietaria", "setorPrioritario",
    "volumeOperacoesAnual", "restricoesAmbientais", "aceitaPermuta", "perfilRisco", "observacoes",
  ];

  function calcOnboardingProgress(profile: any): number {
    let filled = 0;
    const p = profile || {};
    const prefs = (p.preferencesJson as any) || {};
    for (const field of ONBOARDING_FIELDS) {
      const val = p[field] ?? prefs[field];
      if (val !== null && val !== undefined && val !== "" && !(Array.isArray(val) && val.length === 0)) {
        filled++;
      }
    }
    return Math.round((filled / ONBOARDING_FIELDS.length) * 100);
  }

  app.get("/api/crm/onboarding", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const orgId = getOrgId(req);
    try {
      const rows = await db.select({
        profile: investorProfiles,
        company: companies,
      }).from(investorProfiles)
        .innerJoin(companies, eq(investorProfiles.companyId, companies.id))
        .where(eq(investorProfiles.orgId, orgId));

      const result = rows.map(r => {
        const enrichData = (r.company.enrichmentData as any) || {};
        const leadSource = enrichData.perfilComprador?.origem || (enrichData.importedAsInvestor ? "cnpja" : "manual");
        return {
          id: r.profile.id,
          companyId: r.company.id,
          companyName: r.company.tradeName || r.company.legalName,
          cnpj: r.company.cnpj,
          buyerType: r.profile.buyerType,
          origem: leadSource,
          createdAt: r.profile.createdAt,
          progress: calcOnboardingProgress(r.profile),
          profile: {
            ...r.profile,
            preferencesJson: r.profile.preferencesJson || {},
          },
          companyPorte: r.company.porte,
          companyCnae: r.company.cnaePrincipal,
          companyCity: (r.company.address as any)?.city || null,
          companyState: (r.company.address as any)?.state || null,
        };
      });

      result.sort((a, b) => a.progress - b.progress);
      res.json(result);
    } catch (err) {
      console.error("[onboarding] list error:", err);
      res.status(500).json({ message: "Erro ao listar onboarding" });
    }
  });

  app.patch("/api/crm/onboarding/:companyId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const orgId = getOrgId(req);
    const companyId = Number(req.params.companyId);
    if (isNaN(companyId)) return res.status(400).json({ message: "companyId inválido" });

    try {
      const [profile] = await db.select().from(investorProfiles)
        .where(and(eq(investorProfiles.companyId, companyId), eq(investorProfiles.orgId, orgId))).limit(1);

      if (!profile) return res.status(404).json({ message: "Perfil de investidor não encontrado" });

      const body = req.body;

      const directFields: any = {};
      if (body.buyerType !== undefined) directFields.buyerType = body.buyerType;
      if (body.regionsOfInterest !== undefined) directFields.regionsOfInterest = body.regionsOfInterest;
      if (body.assetTypes !== undefined) directFields.assetTypes = body.assetTypes;
      if (body.ticketMin !== undefined) directFields.ticketMin = body.ticketMin;
      if (body.ticketMax !== undefined) directFields.ticketMax = body.ticketMax;
      if (body.prazoDecisao !== undefined) directFields.prazoDecisao = body.prazoDecisao;
      if (body.capacidadeAquisicao !== undefined) directFields.capacidadeAquisicao = body.capacidadeAquisicao;
      if (body.cnaeInteresse !== undefined) directFields.cnaeInteresse = body.cnaeInteresse;
      if (body.dealsAnteriores !== undefined) directFields.dealsAnteriores = body.dealsAnteriores;

      const prefsFields = ["fonteCapital", "experienciaSetor", "estruturaSocietaria", "setorPrioritario",
        "volumeOperacoesAnual", "restricoesAmbientais", "aceitaPermuta", "perfilRisco", "observacoes"];
      const currentPrefs = (profile.preferencesJson as any) || {};
      const newPrefs = { ...currentPrefs };
      let prefsChanged = false;
      for (const f of prefsFields) {
        if (body[f] !== undefined) { newPrefs[f] = body[f]; prefsChanged = true; }
      }
      if (prefsChanged) directFields.preferencesJson = newPrefs;

      if (Object.keys(directFields).length > 0) {
        await db.update(investorProfiles).set(directFields).where(eq(investorProfiles.id, profile.id));
      }

      const [company] = await db.select().from(companies)
        .where(and(eq(companies.id, companyId), eq(companies.orgId, orgId))).limit(1);
      if (company) {
        const currentEnrich = (company.enrichmentData as any) || {};
        const perfilComprador = { ...(currentEnrich.perfilComprador || {}) };
        for (const f of ONBOARDING_FIELDS) {
          const val = body[f] ?? directFields[f];
          if (val !== undefined) perfilComprador[f] = val;
        }
        await db.update(companies).set({
          enrichmentData: { ...currentEnrich, perfilComprador, importedAsInvestor: true },
        }).where(and(eq(companies.id, companyId), eq(companies.orgId, orgId)));
      }

      const [updated] = await db.select().from(investorProfiles).where(eq(investorProfiles.id, profile.id)).limit(1);
      res.json({ success: true, progress: calcOnboardingProgress(updated), profile: updated });
    } catch (err) {
      console.error("[onboarding] update error:", err);
      res.status(500).json({ message: "Erro ao atualizar onboarding" });
    }
  });

  app.post("/api/crm/onboarding/:companyId/create-profile", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const orgId = getOrgId(req);
    const companyId = Number(req.params.companyId);
    if (isNaN(companyId)) return res.status(400).json({ message: "companyId inválido" });

    try {
      const [company] = await db.select().from(companies)
        .where(and(eq(companies.id, companyId), eq(companies.orgId, orgId))).limit(1);
      if (!company) return res.status(404).json({ message: "Empresa não encontrada" });

      const [existing] = await db.select().from(investorProfiles)
        .where(and(eq(investorProfiles.companyId, companyId), eq(investorProfiles.orgId, orgId))).limit(1);
      if (existing) return res.json({ success: true, profile: existing, alreadyExisted: true });

      const [created] = await db.insert(investorProfiles).values({
        orgId,
        name: company.tradeName || company.legalName || "Investidor",
        companyId: company.id,
        buyerType: "estrategico",
        cnaeInteresse: company.cnaePrincipal ? [company.cnaePrincipal] : [],
      } as any).returning();

      const currentEnrich = (company.enrichmentData as any) || {};
      await db.update(companies).set({
        enrichmentData: {
          ...currentEnrich,
          importedAsInvestor: true,
          perfilComprador: { ...(currentEnrich.perfilComprador || {}), buyerType: "estrategico", origem: "manual" },
        },
      }).where(eq(companies.id, companyId));

      res.status(201).json({ success: true, profile: created });
    } catch (err) {
      console.error("[onboarding] create-profile error:", err);
      res.status(500).json({ message: "Erro ao criar perfil" });
    }
  });
}
