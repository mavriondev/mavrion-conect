import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, hashPassword } from "./auth";
import { db } from "./db";
import { registerNorionRoutes } from "./routes/norion";
import { registerNorionPortalRoutes } from "./routes/norion-portal";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupAuth(app);

  registerNorionRoutes(app, db as any);
  registerNorionPortalRoutes(app, db as any);

  await seedDatabase();

  return httpServer;
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
    }
  } catch (err) {
    console.error("Failed to seed database:", err);
  }
}
