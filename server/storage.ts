import { users, connectors, companies, contacts, deals, assets, matchSuggestions, organizations, proposals, orgSettings, portalListings, portalInquiries, contracts, errorReports, auditLogs, assetLandingPages, matchFeedback, companyVisitLog, companyRejectionLog } from "@shared/schema";
import type { User, InsertUser, Connector, InsertConnector, Company, InsertCompany, Contact, InsertContact, Asset, InsertAsset, Organization, OrgSetting, ErrorReport, InsertErrorReport, AuditLog } from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { pool } from "./db";

const PostgresSessionStore = connectPg(session);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  createOrganization(name: string): Promise<Organization>;

  getConnectors(): Promise<Connector[]>;
  getConnector(id: number): Promise<Connector | undefined>;
  createConnector(connector: InsertConnector): Promise<Connector>;
  updateConnector(id: number, data: Partial<Connector>): Promise<Connector>;
  deleteConnector(id: number): Promise<void>;

  getCompanies(orgId?: number): Promise<Company[]>;
  getCompany(id: number): Promise<Company | undefined>;
  createCompany(company: InsertCompany): Promise<Company>;

  getContacts(orgId?: number): Promise<Contact[]>;
  createContact(contact: InsertContact): Promise<Contact>;

  getAssets(orgId?: number): Promise<Asset[]>;
  getAsset(id: number): Promise<Asset | undefined>;
  createAsset(asset: InsertAsset): Promise<Asset>;
  updateAsset(id: number, data: Partial<InsertAsset>): Promise<Asset>;
  mergeAssetCampos(id: number, patch: Record<string, any>, extraFields?: Record<string, any>): Promise<Asset>;
  deleteAsset(id: number): Promise<void>;

  getOrgSetting(orgId: number, key: string): Promise<OrgSetting | undefined>;
  getAllOrgSettings(orgId: number): Promise<Record<string, any>>;
  setOrgSetting(orgId: number, key: string, value: any): Promise<OrgSetting>;

  getErrorReports(orgId: number): Promise<ErrorReport[]>;
  getErrorReport(id: number): Promise<ErrorReport | undefined>;
  createErrorReport(report: InsertErrorReport): Promise<ErrorReport>;
  updateErrorReport(id: number, orgId: number, data: Partial<InsertErrorReport>): Promise<ErrorReport>;
  getErrorReportStats(orgId: number): Promise<{ total: number; open: number; resolved: number; autoCapture: number; apiError: number }>;

  getAuditLogs(orgId: number, filters?: { entity?: string; entityId?: number; limit?: number }): Promise<AuditLog[]>;

  sessionStore: session.Store;
}

export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    this.sessionStore = new PostgresSessionStore({
      pool,
      createTableIfMissing: true
    });
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async createOrganization(name: string): Promise<Organization> {
    const [org] = await db.insert(organizations).values({ name }).returning();
    return org;
  }

  async getConnectors(): Promise<Connector[]> {
    return await db.select().from(connectors).orderBy(desc(connectors.id));
  }

  async getConnector(id: number): Promise<Connector | undefined> {
    const [row] = await db.select().from(connectors).where(eq(connectors.id, id));
    return row;
  }

  async createConnector(connector: InsertConnector): Promise<Connector> {
    const [created] = await db.insert(connectors).values(connector).returning();
    return created;
  }

  async updateConnector(id: number, data: Partial<Connector>): Promise<Connector> {
    const [updated] = await db.update(connectors).set(data as any).where(eq(connectors.id, id)).returning();
    return updated;
  }

  async deleteConnector(id: number): Promise<void> {
    await db.delete(connectors).where(eq(connectors.id, id));
  }

  async getCompanies(orgId?: number): Promise<Company[]> {
    if (orgId) {
      return await db.select().from(companies).where(eq(companies.orgId, orgId)).orderBy(desc(companies.createdAt));
    }
    return await db.select().from(companies).orderBy(desc(companies.createdAt));
  }

  async getCompany(id: number): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
    return company;
  }

  async createCompany(company: InsertCompany): Promise<Company> {
    const [created] = await db.insert(companies).values(company).returning();
    return created;
  }

  async getContacts(orgId?: number): Promise<Contact[]> {
    if (orgId) {
      return await db.select().from(contacts).where(eq(contacts.orgId, orgId)).orderBy(desc(contacts.createdAt));
    }
    return await db.select().from(contacts).orderBy(desc(contacts.createdAt));
  }

  async createContact(contact: InsertContact): Promise<Contact> {
    const [created] = await db.insert(contacts).values(contact).returning();
    return created;
  }

  async getAssets(orgId?: number): Promise<Asset[]> {
    if (orgId) {
      return await db.select().from(assets)
        .where(eq(assets.orgId, orgId))
        .orderBy(desc(assets.createdAt));
    }
    return await db.select().from(assets).orderBy(desc(assets.createdAt));
  }

  async getAsset(id: number): Promise<Asset | undefined> {
    const [a] = await db.select().from(assets).where(eq(assets.id, id));
    return a;
  }

  async createAsset(asset: InsertAsset): Promise<Asset> {
    const [created] = await db.insert(assets).values(asset as any).returning();
    return created;
  }

  async updateAsset(id: number, data: Partial<InsertAsset>): Promise<Asset> {
    // camposEspecificos é aplicado como merge atômico (jsonb ||) em vez de
    // substituir a coluna inteira: PATCHes concorrentes de enriquecimento não
    // podem apagar chaves salvos uns dos outros a partir de cópias desatualizadas.
    // Nenhum fluxo depende de remoção de chaves via update; para limpar um
    // valor, envie a chave explicitamente com null.
    const { camposEspecificos, ...rest } = data as Record<string, any>;
    const set: Record<string, any> = { ...rest };
    if (camposEspecificos !== undefined) {
      const isPlainObject = camposEspecificos !== null &&
        typeof camposEspecificos === "object" && !Array.isArray(camposEspecificos);
      set.camposEspecificos = isPlainObject
        ? sql`COALESCE(${assets.camposEspecificos}, '{}'::jsonb) || ${JSON.stringify(camposEspecificos)}::jsonb`
        : camposEspecificos;
    }
    const [updated] = await db.update(assets).set(set as any).where(eq(assets.id, id)).returning();
    return updated;
  }

  async mergeAssetCampos(id: number, patch: Record<string, any>, extraFields?: Record<string, any>): Promise<Asset> {
    const patchJson = JSON.stringify(patch);
    const setClauses = [
      sql`campos_especificos = COALESCE(campos_especificos, '{}'::jsonb) || ${patchJson}::jsonb`
    ];
    if (extraFields) {
      for (const [key, value] of Object.entries(extraFields)) {
        if (key === 'municipio') setClauses.push(sql`municipio = ${value}`);
        else if (key === 'location') setClauses.push(sql`location = ${value}`);
        else if (key === 'estado') setClauses.push(sql`estado = ${value}`);
        else if (key === 'areaHa') setClauses.push(sql`area_ha = ${value}`);
        else if (key === 'geoScore') setClauses.push(sql`geo_score = ${value}`);
        else if (key === 'carCodImovel') setClauses.push(sql`car_cod_imovel = ${value}`);
        else if (key === 'activityLog') setClauses.push(sql`activity_log = ${JSON.stringify(value)}::jsonb`);
        else if (key === 'attributesJson') setClauses.push(sql`attributes_json = ${JSON.stringify(value)}::jsonb`);
      }
    }
    const setClause = sql.join(setClauses, sql`, `);
    const result = await db.execute(sql`UPDATE assets SET ${setClause} WHERE id = ${id} RETURNING *`);
    return (result as any).rows[0];
  }

  async deleteAsset(id: number): Promise<void> {
    await db.delete(matchFeedback).where(eq(matchFeedback.assetId, id));
    await db.delete(matchSuggestions).where(eq(matchSuggestions.assetId, id));
    await db.update(deals).set({ assetId: null } as any).where(eq(deals.assetId, id));
    await db.delete(proposals).where(eq(proposals.assetId, id));
    await db.delete(portalInquiries).where(eq(portalInquiries.assetId, id));
    await db.delete(portalListings).where(eq(portalListings.assetId, id));
    await db.delete(assetLandingPages).where(eq(assetLandingPages.assetId, id));
    await db.delete(contracts).where(eq(contracts.assetId, id));
    await db.delete(companyVisitLog).where(eq(companyVisitLog.assetId, id));
    await db.delete(companyRejectionLog).where(eq(companyRejectionLog.assetId, id));
    await db.delete(assets).where(eq(assets.id, id));
  }

  async getOrgSetting(orgId: number, key: string): Promise<OrgSetting | undefined> {
    const [s] = await db.select().from(orgSettings).where(and(eq(orgSettings.orgId, orgId), eq(orgSettings.key, key)));
    return s;
  }

  async getAllOrgSettings(orgId: number): Promise<Record<string, any>> {
    const rows = await db.select().from(orgSettings).where(eq(orgSettings.orgId, orgId));
    const result: Record<string, any> = {};
    for (const row of rows) result[row.key] = row.value;
    return result;
  }

  async setOrgSetting(orgId: number, key: string, value: any): Promise<OrgSetting> {
    const existing = await this.getOrgSetting(orgId, key);
    if (existing) {
      const [updated] = await db.update(orgSettings).set({ value }).where(eq(orgSettings.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(orgSettings).values({ orgId, key, value }).returning();
    return created;
  }

  async getErrorReports(orgId: number) {
    return db.select().from(errorReports).where(eq(errorReports.orgId, orgId)).orderBy(desc(errorReports.createdAt));
  }

  async getErrorReport(id: number) {
    const [report] = await db.select().from(errorReports).where(eq(errorReports.id, id));
    return report;
  }

  async createErrorReport(report: InsertErrorReport) {
    const [created] = await db.insert(errorReports).values(report).returning();
    return created;
  }

  async updateErrorReport(id: number, orgId: number, data: Partial<InsertErrorReport>) {
    const [updated] = await db.update(errorReports).set(data as any)
      .where(and(eq(errorReports.id, id), eq(errorReports.orgId, orgId)))
      .returning();
    return updated;
  }

  async getErrorReportStats(orgId: number) {
    const all = await db.select().from(errorReports).where(eq(errorReports.orgId, orgId));
    return {
      total: all.length,
      open: all.filter(r => r.status === "open" || r.status === "in_progress").length,
      resolved: all.filter(r => r.status === "resolved" || r.status === "closed").length,
      autoCapture: all.filter(r => r.type === "auto_capture").length,
      apiError: all.filter(r => r.type === "api_error").length,
    };
  }

  async getAuditLogs(orgId: number, filters?: { entity?: string; entityId?: number; limit?: number }) {
    const conditions = [eq(auditLogs.orgId, orgId)];
    if (filters?.entity) conditions.push(eq(auditLogs.entity, filters.entity));
    if (filters?.entityId) conditions.push(eq(auditLogs.entityId, filters.entityId));
    return db.select().from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.createdAt))
      .limit(filters?.limit || 100);
  }

}

export const storage = new DatabaseStorage();
