import type { Express } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { db } from "./db";
import { pipelineStages } from "@shared/schema";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";
import path from "path";

import { registerSystemRoutes } from "./routes/system";
import { registerSdrRoutes } from "./routes/sdr";
import { registerCrmRoutes } from "./routes/crm";
import { registerCompanyRoutes } from "./routes/companies";
import { registerMatchingRoutes } from "./routes/matching";
import { registerAssetRoutes } from "./routes/assets";
import { registerGeoRoutes } from "./routes/geo";
import { registerProspeccaoRoutes } from "./routes/prospeccao";
import { registerPortalRoutes } from "./routes/portal";
import { registerCommercialRoutes } from "./routes/commercial";
import { registerAuthRoutes } from "./routes/auth";
import { registerExportRoutes } from "./routes/export";
import { registerDocumentRoutes } from "./routes/documents";

const uploadsDir = path.join(process.cwd(), "server", "uploads");

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupAuth(app);

  app.use("/uploads", express.static(uploadsDir));

  registerSystemRoutes(app, storage);
  registerSdrRoutes(app, storage);
  registerCrmRoutes(app, storage, db as any);
  registerCompanyRoutes(app, storage, db as any);
  registerMatchingRoutes(app, storage, db as any);
  registerAssetRoutes(app, storage, db as any);
  registerGeoRoutes(app, storage, db as any);
  registerProspeccaoRoutes(app, db as any);
  registerPortalRoutes(app, storage, db as any);
  registerCommercialRoutes(app, storage, db as any);
  registerAuthRoutes(app, db as any);
  registerExportRoutes(app, storage);
  registerDocumentRoutes(app);
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
      const org = await storage.createOrganization("Default Org");
      const hashedPassword = await hashPassword("admin");
      await storage.createUser({
        username: "admin",
        password: hashedPassword,
        orgId: org.id,
        role: "admin"
      });

      const stages = [
        { orgId: org.id, pipelineType: "INVESTOR", name: "Prospectado", order: 1, color: "#6366f1" },
        { orgId: org.id, pipelineType: "INVESTOR", name: "Contato Inicial", order: 2, color: "#8b5cf6" },
        { orgId: org.id, pipelineType: "INVESTOR", name: "Qualificado", order: 3, color: "#a78bfa" },
        { orgId: org.id, pipelineType: "INVESTOR", name: "Proposta", order: 4, color: "#f59e0b" },
        { orgId: org.id, pipelineType: "INVESTOR", name: "Fechado", order: 5, color: "#10b981" },
        { orgId: org.id, pipelineType: "ASSET", name: "Prospectado", order: 1, color: "#6366f1" },
        { orgId: org.id, pipelineType: "ASSET", name: "Validação Docs", order: 2, color: "#8b5cf6" },
        { orgId: org.id, pipelineType: "ASSET", name: "Proposta", order: 3, color: "#f59e0b" },
        { orgId: org.id, pipelineType: "ASSET", name: "Fechado", order: 4, color: "#10b981" },
      ];

      for (const s of stages) {
        await db.insert(pipelineStages).values(s as any);
      }

      const comp1 = await storage.createCompany({ orgId: org.id, legalName: "Tech Agro SA", cnpj: "12345678901234" });
      const comp2 = await storage.createCompany({ orgId: org.id, legalName: "Mineração Vale Verde", cnpj: "98765432109876" });

      await storage.createAsset({ orgId: org.id, type: "TERRA", title: "Fazenda 1000ha - MT", location: "Mato Grosso", priceAsking: 5000000, linkedCompanyId: comp1.id });
      await storage.createAsset({ orgId: org.id, type: "MINA", title: "Mina de Calcário - MG", location: "Minas Gerais", priceAsking: 12000000, linkedCompanyId: comp2.id });

      await storage.createInvestor({
        orgId: org.id,
        name: "Fundo Capital Verde",
        assetTypes: ["TERRA", "MINA"],
        ticketMin: 1000000,
        ticketMax: 20000000,
        regionsOfInterest: ["Mato Grosso", "Minas Gerais"],
      });

      await storage.createConnector({ orgId: org.id, name: "ReceitaWS CNPJ", type: "API", status: "active", configJson: { baseUrl: "https://receitaws.com.br/v1" }, schedule: "0 6 * * *" });

      await storage.createConnector({ orgId: org.id, name: "IBGE Dados Municipais", type: "DATABASE", status: "active", configJson: { dbType: "rest_api", endpoint: "https://servicodados.ibge.gov.br/api/v3", resources: ["municipios", "estados", "distritos"], syncMode: "incremental", format: "json" }, schedule: "0 0 1 * *" });

      await storage.createConnector({ orgId: org.id, name: "Portal ANM Scraper", type: "SCRAPER", status: "active", configJson: { targetUrl: "https://geo.anm.gov.br", selectors: { processos: ".processo-item", titular: ".titular-nome", substancia: ".substancia", fase: ".fase-atual" }, retryAttempts: 3, timeout: 30000, rateLimit: "2req/s" }, schedule: "0 8 * * 1" });
    }
  } catch (err) {
    console.error("Failed to seed database:", err);
  }
}
