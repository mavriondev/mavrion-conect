import type { Express } from "express";
import express from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { db } from "./db";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";
import path from "path";

import { registerSystemRoutes } from "./routes/system";
import { registerCompanyRoutes } from "./routes/companies";

import { registerAssetRoutes } from "./routes/assets";
import { registerGeoRoutes } from "./routes/geo";
import { registerProspeccaoRoutes } from "./routes/prospeccao";
import { registerAuthRoutes } from "./routes/auth";
import { registerExportRoutes } from "./routes/export";
import { registerDocumentRoutes } from "./routes/documents";
import { registerAiRoutes } from "./routes/ai";
import { registerCafExtratorRoutes } from "./routes/caf-extrator";
import { registerAnmEnrichmentRoutes } from "./routes/anm-enrichment";
import { registerScmRoutes } from "./routes/scm";
import { registerTahRoutes } from "./routes/tah";
import { registerAnmEventosRoutes } from "./routes/anm-eventos";
import { registerDossieRoutes } from "./routes/dossie";
import { registerBasesAnmRoutes } from "./routes/bases-anm";
import { registerSeiRoutes } from "./routes/sei";
import { registerJazidaPesquisaRoutes } from "./routes/jazida-pesquisa";

const uploadsDir = path.join(process.cwd(), "server", "uploads");

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupAuth(app);

  app.use("/uploads", express.static(uploadsDir));

  registerSystemRoutes(app, storage);
  registerCompanyRoutes(app, storage, db as any);

  registerAssetRoutes(app, storage, db as any);
  registerGeoRoutes(app, storage, db as any);
  registerProspeccaoRoutes(app, db as any);
  registerAuthRoutes(app, db as any);
  registerExportRoutes(app, storage);
  registerDocumentRoutes(app);
  registerAiRoutes(app);
  registerCafExtratorRoutes(app);
  registerAnmEnrichmentRoutes(app);
  registerJazidaPesquisaRoutes(app);
  registerScmRoutes(app);
  registerSeiRoutes(app);
  registerTahRoutes(app);
  registerAnmEventosRoutes(app);
  registerDossieRoutes(app);
  registerBasesAnmRoutes(app);

  const SICAR_API_URL = "https://api.mavrionconnect.com.br";
  const SICAR_API_KEY = process.env.MAVRION_API_KEY || "";
  const ensureAuth = (req: any, res: any, next: any) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    next();
  };

  app.get("/api/sicar-worker/status", ensureAuth, async (_req, res) => {
    try {
      const r = await fetch(SICAR_API_URL + "/api/sicar/altitude/status?apikey=" + SICAR_API_KEY);
      const d = await r.json();
      res.json(d);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/sicar-worker/data", ensureAuth, async (req, res) => {
    try {
      const qs = new URLSearchParams(req.query as any);
      qs.set("apikey", SICAR_API_KEY);
      const r = await fetch(SICAR_API_URL + "/api/sicar/altitude/data?" + qs.toString());
      const d = await r.json();
      res.json(d);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/sicar-worker/start", ensureAuth, async (_req, res) => {
    try {
      const r = await fetch(SICAR_API_URL + "/api/sicar/altitude/start?apikey=" + SICAR_API_KEY, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const d = await r.json();
      res.json(d);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/sicar-worker/stop", ensureAuth, async (_req, res) => {
    try {
      const r = await fetch(SICAR_API_URL + "/api/sicar/altitude/stop?apikey=" + SICAR_API_KEY, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const d = await r.json();
      res.json(d);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  await seedDatabase();

  return httpServer;
}

const scryptAsync = promisify(scrypt);
async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function seedDatabase() {
  try {
    const existingAdmin = await storage.getUserByUsername("admin");
    if (!existingAdmin) {
      const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
      if (!bootstrapPassword) {
        console.warn("[Bootstrap] Banco sem administrador: configure BOOTSTRAP_ADMIN_PASSWORD para criar o primeiro acesso.");
        return;
      }
      const org = await storage.createOrganization("Default Org");
      const hashedPassword = await hashPassword(bootstrapPassword);
      await storage.createUser({
        username: "admin",
        password: hashedPassword,
        orgId: org.id,
        role: "admin"
      });


      const comp1 = await storage.createCompany({ orgId: org.id, legalName: "Tech Agro SA", cnpj: "12345678901234" });
      const comp2 = await storage.createCompany({ orgId: org.id, legalName: "Mineração Vale Verde", cnpj: "98765432109876" });

      await storage.createAsset({ orgId: org.id, type: "TERRA", title: "Fazenda 1000ha - MT", location: "Mato Grosso", priceAsking: 5000000, linkedCompanyId: comp1.id });
      await storage.createAsset({ orgId: org.id, type: "MINA", title: "Mina de Calcário - MG", location: "Minas Gerais", priceAsking: 12000000, linkedCompanyId: comp2.id });


      // Nota: não criar connectors de exemplo com tipos que o scheduler não
      // sabe executar (ex.: "DATABASE"/"SCRAPER") — eles ficariam em erro
      // permanente ("Connector tipo desconhecido"). Os connectors reais
      // (cfem_import, sigbm_import) são provisionados pelo scheduler.
    }
  } catch (err) {
    console.error("Failed to seed database:", err);
  }
}
