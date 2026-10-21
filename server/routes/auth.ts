import type { Express } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { users } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";
import { getOrgId } from "../lib/tenant";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export function registerAuthRoutes(app: Express, db: NodePgDatabase<any>) {
  app.get("/api/admin/users", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const allUsers = await db.select({
        id: users.id,
        username: users.username,
        role: users.role,
        permissions: users.permissions,
        orgId: users.orgId,
        email: users.email,
        emailSignature: users.emailSignature,
        createdAt: users.createdAt,
      }).from(users).orderBy(desc(users.createdAt));
      res.json(allUsers);
    } catch (err) {
      res.status(500).json({ message: "Falha ao listar usuários" });
    }
  });

  app.post("/api/admin/users", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { username, password, role, permissions } = req.body;
      if (!username || !password || !role) return res.status(400).json({ message: "username, password e role são obrigatórios" });
      const existing = await db.select().from(users).where(eq(users.username, username));
      if (existing.length > 0) return res.status(409).json({ message: "Usuário já existe" });
      const hashed = await hashPassword(password);
      const [newUser] = await db.insert(users).values({
        username, password: hashed, role, permissions: permissions || {}, orgId: getOrgId(),
      } as any).returning({ id: users.id, username: users.username, role: users.role, permissions: users.permissions, createdAt: users.createdAt });
      res.status(201).json(newUser);
    } catch (err) {
      console.error("Create user error:", err);
      res.status(500).json({ message: "Falha ao criar usuário" });
    }
  });

  app.patch("/api/admin/users/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const userId = Number(req.params.id);
      const { role, permissions, password, email, emailSignature } = req.body;
      const updates: any = {};
      if (role) updates.role = role;
      if (permissions !== undefined) updates.permissions = permissions;
      if (password) updates.password = await hashPassword(password);
      if (email !== undefined) updates.email = email;
      if (emailSignature !== undefined) updates.emailSignature = emailSignature;
      const [updated] = await db.update(users).set(updates).where(eq(users.id, userId))
        .returning({ id: users.id, username: users.username, role: users.role, permissions: users.permissions, email: users.email, emailSignature: users.emailSignature });
      if (!updated) return res.status(404).json({ message: "Usuário não encontrado" });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Falha ao atualizar usuário" });
    }
  });

  app.patch("/api/auth/profile", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.sendStatus(401);
      const userId = (req.user as any).id;
      const { email, emailSignature } = req.body;
      const updates: any = {};
      if (email !== undefined) updates.email = email;
      if (emailSignature !== undefined) updates.emailSignature = emailSignature;
      const [updated] = await db.update(users).set(updates).where(eq(users.id, userId))
        .returning({ id: users.id, username: users.username, role: users.role, email: users.email, emailSignature: users.emailSignature });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Falha ao atualizar perfil" });
    }
  });

  app.delete("/api/admin/users/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const userId = Number(req.params.id);
      await db.delete(users).where(eq(users.id, userId));
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ message: "Falha ao remover usuário" });
    }
  });
}
