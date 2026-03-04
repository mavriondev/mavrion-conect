import type { Express } from "express";
import type { IStorage } from "../storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { audit } from "../audit";
import { getOrgId } from "../lib/tenant";
import { db } from "../db";
import { leads, deals } from "@shared/schema";
import { eq } from "drizzle-orm";

export function registerSdrRoutes(app: Express, storage: IStorage) {
  app.get(api.sdr.queue.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const queue = await storage.getLeadsQueue();
    res.json(queue);
  });

  app.patch(api.sdr.updateLead.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const leadId = Number(req.params.id);
      const input = api.sdr.updateLead.input.parse(req.body);
      const queue = await storage.getLeadsQueue();
      const leadBefore = queue.find(l => l.id === leadId);
      const data = await storage.updateLead(leadId, input.status);
      const user = req.user as any;
      if (user && leadBefore) {
        await audit({
          userId: user.id, userName: user.username,
          entity: "lead", entityId: leadId, entityTitle: leadBefore.company?.legalName || `Lead #${leadId}`,
          action: "status_changed",
          changes: { status: { from: leadBefore.status, to: input.status } },
        });
      }
      res.json(data);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json(err.errors);
      res.status(500).json({ message: "Internal Error" });
    }
  });

  const promoteInput = z.object({
    title: z.string().min(1),
    pipelineType: z.string().min(1),
    stageId: z.number().int().positive(),
    amountEstimate: z.number().optional(),
    probability: z.number().optional(),
    source: z.string().optional(),
    description: z.string().optional(),
  });

  app.post("/api/sdr/leads/:id/promote", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const leadId = Number(req.params.id);
      const input = promoteInput.parse(req.body);

      const orgId = getOrgId();
      const result = await db.transaction(async (tx) => {
        const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId));
        if (!lead || lead.orgId !== orgId) throw new Error("NOT_FOUND");

        if (lead.status === "converted") {
          throw new Error("ALREADY_CONVERTED");
        }

        const [deal] = await tx.insert(deals).values({
          orgId: lead.orgId,
          pipelineType: input.pipelineType,
          stageId: input.stageId,
          title: input.title,
          companyId: lead.companyId,
          amountEstimate: input.amountEstimate ?? 0,
          probability: input.probability ?? 50,
          source: input.source || "SDR",
          description: input.description || null,
        }).returning();

        await tx.update(leads).set({ status: "converted" }).where(eq(leads.id, leadId));

        return deal;
      });

      const user = req.user as any;
      if (user) {
        await audit({
          userId: user.id, userName: user.username,
          entity: "lead", entityId: leadId, entityTitle: result.title,
          action: "status_changed",
          changes: { status: { from: "qualified", to: "converted" } },
        });
      }

      res.status(201).json(result);
    } catch (err: any) {
      if (err?.message === "NOT_FOUND") return res.status(404).json({ message: "Lead não encontrado" });
      if (err?.message === "ALREADY_CONVERTED") return res.status(409).json({ message: "Lead já foi convertido" });
      res.status(500).json({ message: "Erro interno ao promover lead" });
    }
  });
}
