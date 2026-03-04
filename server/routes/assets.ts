import type { Express } from "express";
import type { IStorage } from "../storage";
import { api } from "@shared/routes";
import { z } from "zod";

export function registerAssetRoutes(app: Express, storage: IStorage) {
  app.get(api.matching.assets.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const assetsList = await storage.getAssets();
    res.json(assetsList);
  });

  app.post(api.matching.assets.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const input = api.matching.assets.create.input.parse(req.body);
      const data = await storage.createAsset(input);
      res.status(201).json(data);
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
      res.json(asset);
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
}
