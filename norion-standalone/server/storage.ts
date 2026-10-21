import { db } from "./db";
import { pool } from "./db";
import {
  users, organizations, companies, orgSettings,
  norionOperations, norionDocuments, norionFundosParceiros, norionEnviosFundos,
  norionCafRegistros, norionClientUsers, norionFormularioCliente,
  type User, type InsertCompany, type Company,
  type NorionDocument, type InsertNorionDocument,
  type NorionFundoParceiro, type InsertNorionFundoParceiro,
  type NorionEnvioFundo, type InsertNorionEnvioFundo,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

const PgStore = connectPgSimple(session);

const DEFAULT_ORG_ID = 1;
export function getOrgId(): number {
  return DEFAULT_ORG_ID;
}

export async function audit(
  orgId: number,
  userId: number | null,
  action: string,
  entity: string,
  entityId: number | null,
  details?: any
) {
  console.log(`[AUDIT] org=${orgId} user=${userId} action=${action} entity=${entity} entityId=${entityId}`);
}

class DatabaseStorage {
  sessionStore: session.Store;

  constructor() {
    this.sessionStore = new PgStore({ pool, createTableIfMissing: true });
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(data: { username: string; password: string; orgId: number; role: string }): Promise<User> {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  }

  async createOrganization(name: string) {
    const [org] = await db.insert(organizations).values({ name }).returning();
    return org;
  }

  async getCompanies(orgId?: number): Promise<Company[]> {
    if (orgId) {
      return db.select().from(companies).where(eq(companies.orgId, orgId));
    }
    return db.select().from(companies);
  }

  async getCompany(id: number): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return company;
  }

  async createCompany(data: InsertCompany): Promise<Company> {
    const [company] = await db.insert(companies).values(data).returning();
    return company;
  }

  async updateCompany(id: number, data: Partial<Company>): Promise<Company> {
    const [updated] = await db.update(companies).set(data as any).where(eq(companies.id, id)).returning();
    return updated;
  }

  async getOrgSetting(orgId: number, key: string) {
    const [setting] = await db.select().from(orgSettings)
      .where(and(eq(orgSettings.orgId, orgId), eq(orgSettings.key, key)));
    return setting?.value;
  }

  async setOrgSetting(orgId: number, key: string, value: any) {
    const existing = await this.getOrgSetting(orgId, key);
    if (existing !== undefined) {
      await db.update(orgSettings).set({ value }).where(and(eq(orgSettings.orgId, orgId), eq(orgSettings.key, key)));
    } else {
      await db.insert(orgSettings).values({ orgId, key, value });
    }
  }

  async getNorionDocuments(operationId: number, orgId: number) {
    return db.select().from(norionDocuments)
      .where(and(eq(norionDocuments.operationId, operationId), eq(norionDocuments.orgId, orgId)))
      .orderBy(norionDocuments.id);
  }

  async createNorionDocument(doc: InsertNorionDocument) {
    const [created] = await db.insert(norionDocuments).values(doc).returning();
    return created;
  }

  async updateNorionDocument(id: number, orgId: number, data: Partial<NorionDocument>) {
    const [updated] = await db.update(norionDocuments)
      .set({ ...data, updatedAt: new Date() } as any)
      .where(and(eq(norionDocuments.id, id), eq(norionDocuments.orgId, orgId)))
      .returning();
    return updated;
  }

  async deleteNorionDocument(id: number, orgId: number) {
    await db.delete(norionDocuments).where(and(eq(norionDocuments.id, id), eq(norionDocuments.orgId, orgId)));
  }

  async getNorionFundosParceiros(orgId: number) {
    return db.select().from(norionFundosParceiros)
      .where(eq(norionFundosParceiros.orgId, orgId))
      .orderBy(desc(norionFundosParceiros.createdAt));
  }

  async getNorionFundoParceiro(id: number, orgId: number) {
    const [fp] = await db.select().from(norionFundosParceiros)
      .where(and(eq(norionFundosParceiros.id, id), eq(norionFundosParceiros.orgId, orgId)));
    return fp;
  }

  async createNorionFundoParceiro(data: InsertNorionFundoParceiro) {
    const [created] = await db.insert(norionFundosParceiros).values(data).returning();
    return created;
  }

  async updateNorionFundoParceiro(id: number, orgId: number, data: Partial<NorionFundoParceiro>) {
    const [updated] = await db.update(norionFundosParceiros)
      .set({ ...data, updatedAt: new Date() } as any)
      .where(and(eq(norionFundosParceiros.id, id), eq(norionFundosParceiros.orgId, orgId)))
      .returning();
    return updated;
  }

  async deleteNorionFundoParceiro(id: number, orgId: number) {
    await db.delete(norionEnviosFundos).where(and(eq(norionEnviosFundos.fundoParceiroId, id), eq(norionEnviosFundos.orgId, orgId)));
    await db.delete(norionFundosParceiros).where(and(eq(norionFundosParceiros.id, id), eq(norionFundosParceiros.orgId, orgId)));
  }

  async getNorionEnviosFundos(operationId: number, orgId: number) {
    return db.select().from(norionEnviosFundos)
      .where(and(eq(norionEnviosFundos.operationId, operationId), eq(norionEnviosFundos.orgId, orgId)))
      .orderBy(desc(norionEnviosFundos.dataEnvio));
  }

  async getNorionEnviosByFundo(fundoId: number, orgId: number) {
    return db.select().from(norionEnviosFundos)
      .where(and(eq(norionEnviosFundos.fundoParceiroId, fundoId), eq(norionEnviosFundos.orgId, orgId)))
      .orderBy(desc(norionEnviosFundos.dataEnvio));
  }

  async createNorionEnvioFundo(data: InsertNorionEnvioFundo) {
    const [created] = await db.insert(norionEnviosFundos).values(data).returning();
    return created;
  }

  async updateNorionEnvioFundo(id: number, orgId: number, data: Partial<NorionEnvioFundo>) {
    const [updated] = await db.update(norionEnviosFundos)
      .set({ ...data, updatedAt: new Date() } as any)
      .where(and(eq(norionEnviosFundos.id, id), eq(norionEnviosFundos.orgId, orgId)))
      .returning();
    return updated;
  }

  async deleteNorionEnviosByOperation(operationId: number, orgId: number) {
    await db.delete(norionEnviosFundos).where(and(eq(norionEnviosFundos.operationId, operationId), eq(norionEnviosFundos.orgId, orgId)));
  }
}

export const storage = new DatabaseStorage();
