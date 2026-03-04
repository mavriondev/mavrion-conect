import type { Express } from "express";
import type { IStorage } from "../storage";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { api } from "@shared/routes";
import { z } from "zod";
import { dealComments } from "@shared/schema";
import { sql } from "drizzle-orm";
import { audit, diff } from "../audit";
import { sendNotification, notifId } from "../notifications";
import { getOrgId } from "../lib/tenant";

export function registerCrmRoutes(app: Express, storage: IStorage, db: NodePgDatabase<any>) {
  app.get(api.crm.deals.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    const dealsList = await storage.getDeals(req.query.pipelineType as string | undefined, user?.orgId);
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

      const data = await storage.createDeal({ ...input, orgId: getOrgId() });
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
      const id = Number(req.params.id);
      const before = await storage.getDeal(id);
      const input = api.crm.deals.update.input.parse(req.body);
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
            if (newStage?.name === "Fechamento") {
              sendNotification({
                id: notifId(),
                type: "deal_stage",
                orgId: getOrgId(),
                title: "Deal chegou ao Fechamento",
                message: `"${data.title}" entrou na etapa de Fechamento!`,
                link: "/crm",
                createdAt: new Date().toISOString(),
              });
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
      const deal = await storage.getDeal(Number(req.params.id));
      if (!deal) return res.status(404).json({ message: "Deal não encontrado" });
      res.json(deal);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.delete("/api/crm/deals/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const id = Number(req.params.id);
      const deal = await storage.getDeal(id);
      await storage.deleteDeal(id);
      const user = req.user as any;
      if (user && deal) {
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
        await storage.createPipelineStage({ orgId: getOrgId(), pipelineType: "INVESTOR", name: investorWorkflow[i], order: i + 1, color: null });
      }
    }
    if (needsMaSeed && assetStages.length === 0) {
      for (let i = 0; i < maWorkflow.length; i++) {
        await storage.createPipelineStage({ orgId: getOrgId(), pipelineType: "ASSET", name: maWorkflow[i].name, order: i + 1, color: maWorkflow[i].color });
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
      const stage = await storage.createPipelineStage({ orgId: getOrgId(), pipelineType, name, order, color: color || null });
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
    const contacts = await storage.getContacts();
    res.json(contacts);
  });

  app.get("/api/deal-comments", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const dealId = Number(req.query.dealId);
      if (!dealId) return res.status(400).json({ message: "dealId é obrigatório" });
      const comments = await storage.getDealComments(dealId);
      res.json(comments);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.post("/api/deal-comments", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { dealId, content, authorName } = req.body;
      if (!dealId || !content) return res.status(400).json({ message: "dealId e content são obrigatórios" });
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
      const dealId = Number(req.params.id);
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
      const dealId = Number(req.params.id);
      const { type, description } = req.body;
      const user = req.user as any;
      await db.execute(
        sql`INSERT INTO deal_activities (deal_id, type, description, created_by, created_at)
            VALUES (${dealId}, ${type || "nota"}, ${description}, ${user?.username || "Sistema"}, NOW())`
      );
      res.status(201).json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: "Erro ao salvar atividade" });
    }
  });

  app.get(api.stats.dashboard.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const stats = await storage.getDashboardStats(getOrgId());
    res.json(stats);
  });
}
