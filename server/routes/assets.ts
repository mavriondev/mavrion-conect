import type { Express } from "express";
import type { IStorage } from "../storage";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { api } from "@shared/routes";
import { z } from "zod";
import { matchSuggestions } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sendNotification, notifId } from "../notifications";
import { matchesRegion } from "./matching";
import { enriquecerAtivoEmbrapa } from "../lib/embrapa";

export function registerAssetRoutes(app: Express, storage: IStorage, db: NodePgDatabase<any>) {
  app.get(api.matching.assets.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    const assetsList = await storage.getAssets(user?.orgId);
    res.json(assetsList);
  });

  app.post(api.matching.assets.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const input = api.matching.assets.create.input.parse(req.body);
      if (input.priceAsking !== undefined && input.priceAsking !== null && input.priceAsking < 0) {
        return res.status(400).json({ message: "Preço não pode ser negativo" });
      }
      const novoAtivo = await storage.createAsset(input);

      const camposEsp = (novoAtivo.camposEspecificos as any) || {};
      if (camposEsp.origemAtivo === "oferta_recebida" || camposEsp.origemAtivo === "indicacao") {
        setImmediate(async () => {
          try {
            const allInvestors = await storage.getInvestors();
            let autoMatches = 0;
            for (const investor of allInvestors) {
              const tipos = (investor.assetTypes as string[]) || [];
              const regioes = (investor.regionsOfInterest as string[]) || [];
              const tipoOk = tipos.length === 0 || tipos.includes(novoAtivo.type);
              const regiaoOk = matchesRegion(novoAtivo.location || novoAtivo.estado, regioes);
              if (tipoOk && regiaoOk) {
                const [existing] = await db.select().from(matchSuggestions).where(
                  and(
                    eq(matchSuggestions.assetId, novoAtivo.id),
                    eq(matchSuggestions.investorProfileId, investor.id)
                  )
                );
                if (!existing) {
                  await db.insert(matchSuggestions).values({
                    orgId: novoAtivo.orgId,
                    assetId: novoAtivo.id,
                    investorProfileId: investor.id,
                    score: 60,
                    reasonsJson: { reasons: ["Ativo recebido por oferta — match prioritário"], penalties: [], origem: "oferta_automatica" },
                    status: "new",
                  });
                  autoMatches++;
                }
              }
            }
            if (autoMatches > 0) {
              sendNotification({
                id: notifId(),
                type: "new_match",
                orgId: novoAtivo.orgId,
                title: "Novo ativo por oferta",
                message: `"${novoAtivo.title}" foi cadastrado e ${autoMatches} match(es) gerados automaticamente`,
                link: `/ativos/${novoAtivo.id}`,
                createdAt: new Date().toISOString(),
              });
            }
          } catch (err) { console.error("Auto-matching oferta error:", err); }
        });
      }

      res.status(201).json(novoAtivo);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json(err.errors);
      res.status(500).json({ message: "Internal Error" });
    }
  });

  app.get("/api/matching/assets/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const asset = await storage.getAsset(Number(req.params.id));
      if (!asset) return res.status(404).json({ message: "Asset not found" });

      const allDeals = await storage.getDeals?.() ?? [];
      const linkedDeals = allDeals.filter((d: any) =>
        d.assetId === asset.id ||
        d.title?.toLowerCase().includes((asset.title || "").toLowerCase().slice(0, 15))
      ).map((d: any) => ({
        id: d.id,
        title: d.title,
        stageId: d.stageId,
        stageName: d.stage?.name || null,
        amountEstimate: d.amountEstimate,
        pipelineType: d.pipelineType,
        createdAt: d.createdAt,
      }));

      const emNegociacao = linkedDeals.length > 0;

      res.json({ ...asset, linkedDeals, emNegociacao });
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.patch("/api/matching/assets/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const updated = await storage.updateAsset(Number(req.params.id), req.body);
      res.json(updated);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.delete("/api/matching/assets/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      await storage.deleteAsset(Number(req.params.id));
      res.status(204).end();
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.post("/api/matching/assets/:id/enriquecer-embrapa", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const asset = await storage.getAsset(Number(req.params.id));
      if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });

      const campos = (asset.camposEspecificos as any) || {};

      const dados = await enriquecerAtivoEmbrapa({
        codigoIbge: campos.codigoIbge || req.body.codigoIbge,
        lat:        campos.latitude   || req.body.lat,
        lon:        campos.longitude  || req.body.lon,
        tipo:       asset.type,
      });

      const updated = await storage.updateAsset(Number(req.params.id), {
        camposEspecificos: {
          ...campos,
          embrapa: dados,
        },
      });

      res.json({ success: true, dados, ativo: updated });
    } catch (err: any) {
      console.error("Erro enriquecimento Embrapa:", err.message);
      res.status(500).json({ message: err.message || "Erro ao enriquecer ativo" });
    }
  });

  app.get("/api/embrapa/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { getZoneamentoAgricola } = await import("../lib/embrapa");
      await getZoneamentoAgricola("3509502");
      res.json({ status: "online", message: "Conexão com Embrapa OK" });
    } catch (err: any) {
      res.json({ status: "offline", message: err.message });
    }
  });
}
