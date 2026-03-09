import { 
  users, connectors, companies, contacts, leads, deals, 
  assets, investorProfiles, matchSuggestions, pipelineStages, leadRules, organizations,
  dealComments, proposalTemplates, proposals, orgSettings,
  portalListings, portalInquiries, contractTemplates, contracts,
  errorReports, auditLogs, assetLandingPages
} from "@shared/schema";
import type { 
  User, InsertUser, Connector, InsertConnector, Company, InsertCompany,
  Contact, InsertContact, Lead, InsertLead, Deal, InsertDeal,
  Asset, InsertAsset, InvestorProfile, InsertInvestorProfile, MatchSuggestion,
  PipelineStage, InsertPipelineStage, LeadRule, Organization,
  DealComment, InsertDealComment, ProposalTemplate, InsertProposalTemplate,
  Proposal, InsertProposal, OrgSetting,
  PortalListing, InsertPortalListing, PortalInquiry, InsertPortalInquiry,
  ContractTemplate, InsertContractTemplate, Contract, InsertContract,
  ErrorReport, InsertErrorReport, AuditLog,
  AssetLandingPage, InsertAssetLandingPage
} from "@shared/schema";
import { db } from "./db";
import { eq, count, and, desc, gte, lt } from "drizzle-orm";
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
  createCompany(company: InsertCompany): Promise<Company>;

  getContacts(orgId?: number): Promise<Contact[]>;
  createContact(contact: InsertContact): Promise<Contact>;

  getLeadsQueue(orgId?: number): Promise<(Lead & { company: Company })[]>;
  updateLead(id: number, status: string, notes?: string): Promise<Lead>;

  getDeals(pipelineType?: string, orgId?: number, companyId?: number): Promise<(Deal & { company: Company | null })[]>;
  getDeal(id: number): Promise<(Deal & { company: Company | null }) | undefined>;
  createDeal(deal: InsertDeal): Promise<Deal>;
  updateDeal(id: number, deal: Partial<InsertDeal>): Promise<Deal>;
  deleteDeal(id: number): Promise<void>;
  getPipelineStages(): Promise<PipelineStage[]>;
  createPipelineStage(stage: InsertPipelineStage): Promise<PipelineStage>;
  updatePipelineStage(id: number, data: Partial<PipelineStage>): Promise<PipelineStage>;
  deletePipelineStage(id: number): Promise<void>;

  getDealComments(dealId: number): Promise<DealComment[]>;
  createDealComment(comment: InsertDealComment): Promise<DealComment>;
  deleteDealComment(id: number): Promise<void>;

  getAssets(orgId?: number): Promise<Asset[]>;
  getAsset(id: number): Promise<Asset | undefined>;
  createAsset(asset: InsertAsset): Promise<Asset>;
  updateAsset(id: number, data: Partial<InsertAsset>): Promise<Asset>;
  deleteAsset(id: number): Promise<void>;

  getInvestors(orgId?: number): Promise<InvestorProfile[]>;
  getInvestor(id: number): Promise<InvestorProfile | undefined>;
  createInvestor(investor: InsertInvestorProfile): Promise<InvestorProfile>;
  updateInvestor(id: number, data: Partial<InsertInvestorProfile>): Promise<InvestorProfile>;
  deleteInvestor(id: number): Promise<void>;

  getMatchSuggestions(orgId: number): Promise<(MatchSuggestion & { asset: Asset, investor: InvestorProfile })[]>;

  getProposalTemplates(orgId: number): Promise<ProposalTemplate[]>;
  getProposalTemplate(id: number): Promise<ProposalTemplate | undefined>;
  createProposalTemplate(template: InsertProposalTemplate): Promise<ProposalTemplate>;
  updateProposalTemplate(id: number, data: Partial<InsertProposalTemplate>): Promise<ProposalTemplate>;
  deleteProposalTemplate(id: number): Promise<void>;

  getProposals(orgId: number): Promise<Proposal[]>;
  getProposal(id: number): Promise<Proposal | undefined>;
  createProposal(proposal: InsertProposal): Promise<Proposal>;
  updateProposal(id: number, data: Partial<InsertProposal>): Promise<Proposal>;
  deleteProposal(id: number): Promise<void>;

  getOrgSetting(orgId: number, key: string): Promise<OrgSetting | undefined>;
  getAllOrgSettings(orgId: number): Promise<Record<string, any>>;
  setOrgSetting(orgId: number, key: string, value: any): Promise<OrgSetting>;

  getDashboardStats(orgId: number): Promise<any>;

  getPortalListings(orgId: number): Promise<(PortalListing & { asset: Asset | null })[]>;
  getPortalListing(id: number): Promise<(PortalListing & { asset: Asset | null }) | undefined>;
  createPortalListing(listing: InsertPortalListing): Promise<PortalListing>;
  updatePortalListing(id: number, data: Partial<InsertPortalListing>): Promise<PortalListing>;
  deletePortalListing(id: number): Promise<void>;
  getPublishedListings(): Promise<(PortalListing & { asset: Asset | null })[]>;

  getPortalInquiries(orgId: number): Promise<(PortalInquiry & { listing: { title: string } | null })[]>;
  getPortalInquiry(id: number): Promise<PortalInquiry | undefined>;
  createPortalInquiry(inquiry: InsertPortalInquiry): Promise<PortalInquiry>;
  updatePortalInquiry(id: number, data: Partial<InsertPortalInquiry>): Promise<PortalInquiry>;

  getContractTemplates(orgId: number): Promise<ContractTemplate[]>;
  getContractTemplate(id: number): Promise<ContractTemplate | undefined>;
  createContractTemplate(template: InsertContractTemplate): Promise<ContractTemplate>;
  updateContractTemplate(id: number, data: Partial<InsertContractTemplate>): Promise<ContractTemplate>;
  deleteContractTemplate(id: number): Promise<void>;

  getContracts(orgId: number): Promise<Contract[]>;
  getContract(id: number): Promise<Contract | undefined>;
  createContract(contract: InsertContract): Promise<Contract>;
  updateContract(id: number, data: Partial<InsertContract>): Promise<Contract>;
  deleteContract(id: number): Promise<void>;

  getErrorReports(orgId: number): Promise<ErrorReport[]>;
  getErrorReport(id: number): Promise<ErrorReport | undefined>;
  createErrorReport(report: InsertErrorReport): Promise<ErrorReport>;
  updateErrorReport(id: number, orgId: number, data: Partial<InsertErrorReport>): Promise<ErrorReport>;
  getErrorReportStats(orgId: number): Promise<{ total: number; open: number; resolved: number; autoCapture: number; apiError: number }>;

  getAssetLandingPages(orgId: number): Promise<(AssetLandingPage & { asset: Asset | null })[]>;
  getAssetLandingPage(id: number): Promise<(AssetLandingPage & { asset: Asset | null }) | undefined>;
  getAssetLandingPageBySlug(slug: string): Promise<(AssetLandingPage & { asset: Asset | null }) | undefined>;
  createAssetLandingPage(page: InsertAssetLandingPage): Promise<AssetLandingPage>;
  updateAssetLandingPage(id: number, data: Partial<InsertAssetLandingPage>): Promise<AssetLandingPage>;
  deleteAssetLandingPage(id: number): Promise<void>;

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

  async getLeadsQueue(orgId?: number): Promise<(Lead & { company: Company })[]> {
    let query = db.select({ lead: leads, company: companies })
      .from(leads)
      .innerJoin(companies, eq(leads.companyId, companies.id))
      .orderBy(desc(leads.createdAt));
    if (orgId) {
      query = query.where(eq(leads.orgId, orgId)) as any;
    }
    const rows = await query;
    return rows.map(r => ({ ...r.lead, company: r.company }));
  }

  async updateLead(id: number, status: string, notes?: string): Promise<Lead> {
    const updates: any = { status, updatedAt: new Date() };
    if (notes !== undefined) updates.notes = notes;
    const [updated] = await db.update(leads).set(updates).where(eq(leads.id, id)).returning();
    return updated;
  }

  async getDeals(pipelineType?: string, orgId?: number, companyId?: number): Promise<(Deal & { company: Company | null })[]> {
    const conditions: any[] = [];
    if (pipelineType) conditions.push(eq(deals.pipelineType, pipelineType));
    if (orgId) conditions.push(eq(deals.orgId, orgId));
    if (companyId) conditions.push(eq(deals.companyId, companyId));
    let query = db.select({ deal: deals, company: companies })
      .from(deals)
      .leftJoin(companies, eq(deals.companyId, companies.id))
      .orderBy(desc(deals.createdAt));
    if (conditions.length === 1) {
      query = query.where(conditions[0]) as any;
    } else if (conditions.length > 1) {
      query = query.where(and(...conditions)) as any;
    }
    const rows = await query;
    return rows.map(r => ({ ...r.deal, company: r.company }));
  }

  async getDeal(id: number): Promise<(Deal & { company: Company | null }) | undefined> {
    const rows = await db.select({ deal: deals, company: companies })
      .from(deals)
      .leftJoin(companies, eq(deals.companyId, companies.id))
      .where(eq(deals.id, id));
    if (!rows[0]) return undefined;
    return { ...rows[0].deal, company: rows[0].company };
  }

  async createDeal(deal: InsertDeal): Promise<Deal> {
    const [created] = await db.insert(deals).values(deal).returning();
    return created;
  }

  async updateDeal(id: number, deal: Partial<InsertDeal>): Promise<Deal> {
    const [updated] = await db.update(deals).set(deal as any).where(eq(deals.id, id)).returning();
    return updated;
  }

  async deleteDeal(id: number): Promise<void> {
    await db.delete(matchSuggestions).where(eq(matchSuggestions.dealId, id));
    await db.delete(dealComments).where(eq(dealComments.dealId, id));
    await db.delete(deals).where(eq(deals.id, id));
  }

  async getPipelineStages(): Promise<PipelineStage[]> {
    return await db.select().from(pipelineStages);
  }

  async createPipelineStage(stage: InsertPipelineStage): Promise<PipelineStage> {
    const [created] = await db.insert(pipelineStages).values(stage).returning();
    return created;
  }

  async updatePipelineStage(id: number, data: Partial<PipelineStage>): Promise<PipelineStage> {
    const [updated] = await db.update(pipelineStages).set(data as any).where(eq(pipelineStages.id, id)).returning();
    return updated;
  }

  async deletePipelineStage(id: number): Promise<void> {
    await db.delete(pipelineStages).where(eq(pipelineStages.id, id));
  }

  async getDealComments(dealId: number): Promise<DealComment[]> {
    return await db.select().from(dealComments).where(eq(dealComments.dealId, dealId)).orderBy(desc(dealComments.createdAt));
  }

  async createDealComment(comment: InsertDealComment): Promise<DealComment> {
    const [created] = await db.insert(dealComments).values(comment).returning();
    return created;
  }

  async deleteDealComment(id: number): Promise<void> {
    await db.delete(dealComments).where(eq(dealComments.id, id));
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
    const [created] = await db.insert(assets).values(asset).returning();
    return created;
  }

  async updateAsset(id: number, data: Partial<InsertAsset>): Promise<Asset> {
    const [updated] = await db.update(assets).set(data as any).where(eq(assets.id, id)).returning();
    return updated;
  }

  async deleteAsset(id: number): Promise<void> {
    await db.delete(matchSuggestions).where(eq(matchSuggestions.assetId, id));
    await db.update(deals).set({ assetId: null } as any).where(eq(deals.assetId, id));
    await db.delete(portalInquiries).where(eq(portalInquiries.assetId, id));
    await db.delete(portalListings).where(eq(portalListings.assetId, id));
    await db.delete(assetLandingPages).where(eq(assetLandingPages.assetId, id));
    await db.delete(contracts).where(eq(contracts.assetId, id));
    await db.delete(assets).where(eq(assets.id, id));
  }

  async getInvestors(orgId?: number): Promise<InvestorProfile[]> {
    if (orgId) {
      return await db.select().from(investorProfiles).where(eq(investorProfiles.orgId, orgId)).orderBy(desc(investorProfiles.createdAt));
    }
    return await db.select().from(investorProfiles).orderBy(desc(investorProfiles.createdAt));
  }

  async getInvestor(id: number): Promise<InvestorProfile | undefined> {
    const [inv] = await db.select().from(investorProfiles).where(eq(investorProfiles.id, id));
    return inv;
  }

  async createInvestor(investor: InsertInvestorProfile): Promise<InvestorProfile> {
    const [created] = await db.insert(investorProfiles).values(investor).returning();
    return created;
  }

  async updateInvestor(id: number, data: Partial<InsertInvestorProfile>): Promise<InvestorProfile> {
    const [updated] = await db.update(investorProfiles).set(data as any).where(eq(investorProfiles.id, id)).returning();
    return updated;
  }

  async deleteInvestor(id: number): Promise<void> {
    await db.delete(matchSuggestions).where(eq(matchSuggestions.investorProfileId, id));
    await db.delete(investorProfiles).where(eq(investorProfiles.id, id));
  }

  async getMatchSuggestions(orgId: number): Promise<(MatchSuggestion & { asset: Asset, investor: InvestorProfile })[]> {
    const rows = await db.selectDistinctOn([matchSuggestions.assetId, matchSuggestions.investorProfileId], { match: matchSuggestions, asset: assets, investor: investorProfiles })
      .from(matchSuggestions)
      .innerJoin(assets, eq(matchSuggestions.assetId, assets.id))
      .innerJoin(investorProfiles, eq(matchSuggestions.investorProfileId, investorProfiles.id))
      .where(eq(matchSuggestions.orgId, orgId))
      .orderBy(matchSuggestions.assetId, matchSuggestions.investorProfileId, desc(matchSuggestions.createdAt));
    return rows.map(r => ({ ...r.match, asset: r.asset, investor: r.investor }));
  }

  async getProposalTemplates(orgId: number): Promise<ProposalTemplate[]> {
    return await db.select().from(proposalTemplates).where(eq(proposalTemplates.orgId, orgId)).orderBy(desc(proposalTemplates.createdAt));
  }

  async getProposalTemplate(id: number): Promise<ProposalTemplate | undefined> {
    const [t] = await db.select().from(proposalTemplates).where(eq(proposalTemplates.id, id));
    return t;
  }

  async createProposalTemplate(template: InsertProposalTemplate): Promise<ProposalTemplate> {
    const [created] = await db.insert(proposalTemplates).values(template).returning();
    return created;
  }

  async updateProposalTemplate(id: number, data: Partial<InsertProposalTemplate>): Promise<ProposalTemplate> {
    const [updated] = await db.update(proposalTemplates).set({ ...data as any, updatedAt: new Date() }).where(eq(proposalTemplates.id, id)).returning();
    return updated;
  }

  async deleteProposalTemplate(id: number): Promise<void> {
    await db.delete(proposalTemplates).where(eq(proposalTemplates.id, id));
  }

  async getProposals(orgId: number): Promise<Proposal[]> {
    return await db.select().from(proposals).where(eq(proposals.orgId, orgId)).orderBy(desc(proposals.createdAt));
  }

  async getProposal(id: number): Promise<Proposal | undefined> {
    const [p] = await db.select().from(proposals).where(eq(proposals.id, id));
    return p;
  }

  async createProposal(proposal: InsertProposal): Promise<Proposal> {
    const [created] = await db.insert(proposals).values(proposal).returning();
    return created;
  }

  async updateProposal(id: number, data: Partial<InsertProposal>): Promise<Proposal> {
    const [updated] = await db.update(proposals).set(data as any).where(eq(proposals.id, id)).returning();
    return updated;
  }

  async deleteProposal(id: number): Promise<void> {
    await db.delete(proposals).where(eq(proposals.id, id));
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

  async getDashboardStats(orgId: number) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [leadsTotal] = await db.select({ c: count() }).from(leads).where(eq(leads.orgId, orgId));
    const [leadsUltimos30] = await db.select({ c: count() }).from(leads)
      .where(and(eq(leads.orgId, orgId), gte(leads.createdAt, thirtyDaysAgo)));
    const [leadsAnterios30] = await db.select({ c: count() }).from(leads)
      .where(and(eq(leads.orgId, orgId), gte(leads.createdAt, sixtyDaysAgo), lt(leads.createdAt, thirtyDaysAgo)));

    const allDeals = await db.select().from(deals).where(eq(deals.orgId, orgId));
    const activeDeals = allDeals.filter(d => d.pipelineType === "INVESTOR");
    const pipelineValue = activeDeals.reduce((sum, d) => sum + (d.amountEstimate || 0), 0);
    const avgTicket = activeDeals.length > 0 ? pipelineValue / activeDeals.length : 0;

    const forecastValue = activeDeals.reduce((sum, d) => {
      const prob = (d.probability || 50) / 100;
      return sum + (d.amountEstimate || 0) * prob;
    }, 0);

    const [leadsQualified] = await db.select({ c: count() }).from(leads)
      .where(and(eq(leads.orgId, orgId), eq(leads.status, "qualified"), gte(leads.createdAt, thirtyDaysAgo)));
    const [dealsUltimos30] = await db.select({ c: count() }).from(deals)
      .where(and(eq(deals.orgId, orgId), gte(deals.createdAt, thirtyDaysAgo)));

    const conversionRate = Number(leadsQualified?.c || 0) > 0
      ? (Number(dealsUltimos30?.c || 0) / Number(leadsQualified?.c || 0)) * 100
      : 0;

    const dealsPorPrioridade = {
      urgent: allDeals.filter(d => d.priority === "urgent").length,
      high: allDeals.filter(d => d.priority === "high").length,
      medium: allDeals.filter(d => d.priority === "medium").length,
      low: allDeals.filter(d => d.priority === "low").length,
    };

    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const dealsVencendo = allDeals.filter(d =>
      d.dueDate && new Date(d.dueDate) <= sevenDaysFromNow && new Date(d.dueDate) >= now
    ).length;
    const dealsVencidos = allDeals.filter(d =>
      d.dueDate && new Date(d.dueDate) < now
    ).length;

    const crescimentoLeads = Number(leadsAnterios30?.c || 0) > 0
      ? ((Number(leadsUltimos30?.c || 0) - Number(leadsAnterios30?.c || 0)) / Number(leadsAnterios30?.c || 0)) * 100
      : 0;

    return {
      leadsCount: Number(leadsTotal?.c || 0),
      leadsUltimos30: Number(leadsUltimos30?.c || 0),
      crescimentoLeads: Math.round(crescimentoLeads * 10) / 10,
      activeDealsCount: activeDeals.length,
      pipelineValue,
      avgTicket,
      forecastValue,
      conversionRate: Math.round(conversionRate * 10) / 10,
      dealsVencendo,
      dealsVencidos,
      dealsPorPrioridade,
      assetsCount: Number((await db.select({ c: count() }).from(assets).where(eq(assets.orgId, orgId)))[0]?.c || 0),
      investorsCount: Number((await db.select({ c: count() }).from(investorProfiles).where(eq(investorProfiles.orgId, orgId)))[0]?.c || 0),
      matchesCount: Number((await db.select({ c: count() }).from(matchSuggestions).where(eq(matchSuggestions.orgId, orgId)))[0]?.c || 0),
    };
  }

  async getPortalListings(orgId: number) {
    const rows = await db.select().from(portalListings).where(eq(portalListings.orgId, orgId)).orderBy(desc(portalListings.createdAt));
    const result = [];
    for (const r of rows) {
      let asset: Asset | null = null;
      if (r.assetId) {
        const [a] = await db.select().from(assets).where(eq(assets.id, r.assetId));
        asset = a || null;
      }
      result.push({ ...r, asset });
    }
    return result;
  }

  async getPortalListing(id: number) {
    const [r] = await db.select().from(portalListings).where(eq(portalListings.id, id));
    if (!r) return undefined;
    let asset: Asset | null = null;
    if (r.assetId) {
      const [a] = await db.select().from(assets).where(eq(assets.id, r.assetId));
      asset = a || null;
    }
    return { ...r, asset };
  }

  async createPortalListing(listing: InsertPortalListing) {
    const [created] = await db.insert(portalListings).values(listing).returning();
    return created;
  }

  async updatePortalListing(id: number, data: Partial<InsertPortalListing>) {
    const [updated] = await db.update(portalListings).set(data as any).where(eq(portalListings.id, id)).returning();
    return updated;
  }

  async deletePortalListing(id: number) {
    await db.delete(portalInquiries).where(eq(portalInquiries.listingId, id));
    await db.delete(portalListings).where(eq(portalListings.id, id));
  }

  async getPublishedListings() {
    const rows = await db.select().from(portalListings).where(eq(portalListings.status, "published")).orderBy(desc(portalListings.publishedAt));
    const result = [];
    for (const r of rows) {
      let asset: Asset | null = null;
      if (r.assetId) {
        const [a] = await db.select().from(assets).where(eq(assets.id, r.assetId));
        asset = a || null;
      }
      result.push({ ...r, asset });
    }
    return result;
  }

  async getPortalInquiries(orgId: number) {
    const allInquiries = await db.select().from(portalInquiries)
      .where(eq(portalInquiries.orgId, orgId))
      .orderBy(desc(portalInquiries.createdAt));

    const results: (PortalInquiry & { listing: { title: string } | null })[] = [];
    for (const inq of allInquiries) {
      let listing: { title: string } | null = null;
      if (inq.listingId) {
        const [l] = await db.select({ title: portalListings.title }).from(portalListings).where(eq(portalListings.id, inq.listingId));
        if (l) listing = { title: l.title || "Listing" };
      } else if (inq.landingPageId) {
        const [lp] = await db.select({ title: assetLandingPages.title }).from(assetLandingPages).where(eq(assetLandingPages.id, inq.landingPageId));
        if (lp) listing = { title: lp.title };
      }
      results.push({ ...inq, listing });
    }
    return results;
  }

  async getPortalInquiry(id: number) {
    const [inq] = await db.select().from(portalInquiries).where(eq(portalInquiries.id, id));
    return inq;
  }

  async createPortalInquiry(inquiry: InsertPortalInquiry) {
    const [created] = await db.insert(portalInquiries).values(inquiry).returning();
    return created;
  }

  async updatePortalInquiry(id: number, data: Partial<InsertPortalInquiry>) {
    const [updated] = await db.update(portalInquiries).set(data as any).where(eq(portalInquiries.id, id)).returning();
    return updated;
  }

  async getContractTemplates(orgId: number) {
    return await db.select().from(contractTemplates).where(eq(contractTemplates.orgId, orgId)).orderBy(desc(contractTemplates.createdAt));
  }

  async getContractTemplate(id: number) {
    const [t] = await db.select().from(contractTemplates).where(eq(contractTemplates.id, id));
    return t;
  }

  async createContractTemplate(template: InsertContractTemplate) {
    const [created] = await db.insert(contractTemplates).values(template).returning();
    return created;
  }

  async updateContractTemplate(id: number, data: Partial<InsertContractTemplate>) {
    const [updated] = await db.update(contractTemplates).set({ ...data as any, updatedAt: new Date() }).where(eq(contractTemplates.id, id)).returning();
    return updated;
  }

  async deleteContractTemplate(id: number) {
    await db.delete(contractTemplates).where(eq(contractTemplates.id, id));
  }

  async getContracts(orgId: number) {
    return await db.select().from(contracts).where(eq(contracts.orgId, orgId)).orderBy(desc(contracts.createdAt));
  }

  async getContract(id: number) {
    const [c] = await db.select().from(contracts).where(eq(contracts.id, id));
    return c;
  }

  async createContract(contract: InsertContract) {
    const [created] = await db.insert(contracts).values(contract).returning();
    return created;
  }

  async updateContract(id: number, data: Partial<InsertContract>) {
    const [updated] = await db.update(contracts).set(data as any).where(eq(contracts.id, id)).returning();
    return updated;
  }

  async deleteContract(id: number) {
    await db.delete(contracts).where(eq(contracts.id, id));
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

  async getAssetLandingPages(orgId: number) {
    const rows = await db.select().from(assetLandingPages).where(eq(assetLandingPages.orgId, orgId)).orderBy(desc(assetLandingPages.createdAt));
    const allAssets = await db.select().from(assets);
    return rows.map(r => ({ ...r, asset: allAssets.find(a => a.id === r.assetId) || null }));
  }

  async getAssetLandingPage(id: number) {
    const [r] = await db.select().from(assetLandingPages).where(eq(assetLandingPages.id, id));
    if (!r) return undefined;
    const asset = r.assetId ? (await db.select().from(assets).where(eq(assets.id, r.assetId)))[0] || null : null;
    return { ...r, asset };
  }

  async getAssetLandingPageBySlug(slug: string) {
    const [r] = await db.select().from(assetLandingPages).where(eq(assetLandingPages.slug, slug));
    if (!r) return undefined;
    const asset = r.assetId ? (await db.select().from(assets).where(eq(assets.id, r.assetId)))[0] || null : null;
    return { ...r, asset };
  }

  async createAssetLandingPage(page: InsertAssetLandingPage) {
    const [created] = await db.insert(assetLandingPages).values(page).returning();
    return created;
  }

  async updateAssetLandingPage(id: number, data: Partial<InsertAssetLandingPage>) {
    const [updated] = await db.update(assetLandingPages).set(data as any).where(eq(assetLandingPages.id, id)).returning();
    return updated;
  }

  async deleteAssetLandingPage(id: number) {
    await db.delete(assetLandingPages).where(eq(assetLandingPages.id, id));
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
