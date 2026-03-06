import { pgTable, text, serial, integer, boolean, timestamp, jsonb, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// === TENANT & AUTH ===
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("sdr"),
  permissions: jsonb("permissions").default({}),
  email: text("email"),
  emailSignature: text("email_signature"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === ORG SETTINGS ===
export const orgSettings = pgTable("org_settings", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  key: text("key").notNull(),
  value: jsonb("value"),
});

// === CONNECTORS ===
export const connectors = pgTable("connectors", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  name: text("name").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull().default("active"),
  configJson: jsonb("config_json").notNull().default({}),
  schedule: text("schedule"),
  lastRunAt: timestamp("last_run_at"),
  lastError: text("last_error"),
});

export const rawIngests = pgTable("raw_ingests", {
  id: serial("id").primaryKey(),
  connectorId: integer("connector_id").references(() => connectors.id),
  externalId: text("external_id"),
  payloadJson: jsonb("payload_json").notNull(),
  hashDedupe: text("hash_dedupe").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow(),
});

// === CRM ENTITIES ===
export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  legalName: text("legal_name").notNull(),
  tradeName: text("trade_name"),
  cnpj: text("cnpj").unique(),
  cnaePrincipal: text("cnae_principal"),
  cnaeSecundarios: jsonb("cnae_secundarios").default([]),
  porte: text("porte"),
  revenueEstimate: doublePrecision("revenue_estimate"),
  website: text("website"),
  phones: jsonb("phones").default([]),
  emails: jsonb("emails").default([]),
  address: jsonb("address").default({}),
  geo: jsonb("geo").default({}),
  tags: jsonb("tags").default([]),
  notes: text("notes"),
  enrichmentData: jsonb("enrichment_data").default(null),
  enrichedAt: timestamp("enriched_at"),
  researchNotes: jsonb("research_notes").default([]),
  verifiedContacts: jsonb("verified_contacts").default({}),
  norionProfile: text("norion_profile").default("baixo"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  companyId: integer("company_id").references(() => companies.id),
  name: text("name").notNull(),
  roleTitle: text("role_title"),
  phone: text("phone"),
  email: text("email"),
  whatsapp: text("whatsapp"),
  linkedin: text("linkedin"),
  tags: jsonb("tags").default([]),
  consentFlagsJson: jsonb("consent_flags_json").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

// === SDR (LEADS & RULES) ===
export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  companyId: integer("company_id").references(() => companies.id),
  status: text("status").notNull().default("new"),
  score: integer("score").default(0),
  scoreBreakdownJson: jsonb("score_breakdown_json").default({}),
  source: text("source"),
  notes: text("notes"),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  lastEnrichedAt: timestamp("last_enriched_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const leadRules = pgTable("lead_rules", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  name: text("name").notNull(),
  enabled: boolean("enabled").default(true),
  rulesJson: jsonb("rules_json").notNull(),
});

// === DEALS & PIPELINES ===
export const pipelineStages = pgTable("pipeline_stages", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  pipelineType: text("pipeline_type").notNull(),
  name: text("name").notNull(),
  order: integer("order").notNull(),
  color: text("color"),
});

export const deals = pgTable("deals", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  pipelineType: text("pipeline_type").notNull(),
  stageId: integer("stage_id").references(() => pipelineStages.id),
  title: text("title").notNull(),
  amountEstimate: doublePrecision("amount_estimate"),
  probability: integer("probability"),
  expectedCloseDate: timestamp("expected_close_date"),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  source: text("source"),
  description: text("description"),
  labels: jsonb("labels").default([]),
  priority: text("priority").default("medium"), // low, medium, high, urgent
  dueDate: timestamp("due_date"),
  attachments: jsonb("attachments").default([]), // [{name, driveId, driveUrl, size, uploadedAt}]
  companyId: integer("company_id").references(() => companies.id),
  assetId: integer("asset_id").references(() => assets.id),
  feeType: text("fee_type"),
  feePercent: doublePrecision("fee_percent"),
  feeValue: doublePrecision("fee_value"),
  feeStatus: text("fee_status").default("a_receber"),
  feeNotes: text("fee_notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const dealComments = pgTable("deal_comments", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").references(() => deals.id),
  authorName: text("author_name").notNull().default("Usuário"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// === ASSETS & INVESTORS (MATCHING) ===
export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  municipio: text("municipio"),
  estado: text("estado"),
  priceAsking: doublePrecision("price_asking"),
  areaHa: doublePrecision("area_ha"),
  areaUtil: doublePrecision("area_util"),
  matricula: text("matricula"),
  docsStatus: text("docs_status"),
  documentosJson: jsonb("documentos_json").default({}), // {certidoes: [], laudo: null, ccir: null, itr: null, car: null}
  observacoes: text("observacoes"),
  tags: jsonb("tags").default([]),
  attributesJson: jsonb("attributes_json").default({}),
  anmProcesso: text("anm_processo"),
  carCodImovel: text("car_cod_imovel"),
  linkedCompanyId: integer("linked_company_id").references(() => companies.id),
  geoAltMed: doublePrecision("geo_alt_med"),
  geoAltMin: doublePrecision("geo_alt_min"),
  geoAltMax: doublePrecision("geo_alt_max"),
  geoDeclivityMed: doublePrecision("geo_decliv_med"),
  geoTemRio: boolean("geo_tem_rio").default(false),
  geoTemLago: boolean("geo_tem_lago").default(false),
  geoDistAguaM: doublePrecision("geo_dist_agua_m"),
  geoTemEnergia: boolean("geo_tem_energia").default(false),
  geoDistEnergiaM: doublePrecision("geo_dist_energia_m"),
  geoScoreEnergia: text("geo_score_energia"),
  geoScore: integer("geo_score"),
  geoAnalyzedAt: timestamp("geo_analyzed_at"),
  statusAtivo: text("status_ativo").default("ativo"),
  exclusivoAte: timestamp("exclusivo_ate"),
  exclusividadeEmpresaId: integer("exclusividade_empresa_id").references(() => companies.id),
  activityLog: jsonb("activity_log").default([]),
  camposEspecificos: jsonb("campos_especificos").default({}),
  fotos: jsonb("fotos").default([]),
  createdAt: timestamp("created_at").defaultNow(),
});

export const investorProfiles = pgTable("investor_profiles", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  name: text("name").notNull(),
  contactId: integer("contact_id").references(() => contacts.id),
  regionsOfInterest: jsonb("regions_of_interest").default([]),
  assetTypes: jsonb("asset_types").default([]),
  ticketMin: doublePrecision("ticket_min"),
  ticketMax: doublePrecision("ticket_max"),
  preferencesJson: jsonb("preferences_json").default({}),
  tags: jsonb("tags").default([]),
  buyerType: text("buyer_type").default("financeiro"),
  cnaeInteresse: jsonb("cnae_interesse").default([]),
  prazoDecisao: text("prazo_decisao"),
  dealsAnteriores: boolean("deals_anteriores").default(false),
  capacidadeAquisicao: doublePrecision("capacidade_aquisicao"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const matchSuggestions = pgTable("match_suggestions", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  assetId: integer("asset_id").references(() => assets.id),
  investorProfileId: integer("investor_profile_id").references(() => investorProfiles.id),
  score: integer("score").default(0),
  reasonsJson: jsonb("reasons_json").default({}),
  status: text("status").default("new"),
  dealId: integer("deal_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === PROPOSALS ===
export const proposalTemplates = pgTable("proposal_templates", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  name: text("name").notNull(),
  type: text("type").notNull(), // INVESTOR | ASSET_OWNER
  bodyHtml: text("body_html"),
  bodyJson: jsonb("body_json"), // Tiptap JSON state
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const proposals = pgTable("proposals", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  templateId: integer("template_id").references(() => proposalTemplates.id),
  name: text("name").notNull(),
  type: text("type").notNull(), // INVESTOR | ASSET_OWNER
  companyId: integer("company_id").references(() => companies.id),
  dealId: integer("deal_id").references(() => deals.id),
  assetId: integer("asset_id").references(() => assets.id),
  investorProfileId: integer("investor_profile_id").references(() => investorProfiles.id),
  filledHtml: text("filled_html"),
  driveFileId: text("drive_file_id"),
  driveFileUrl: text("drive_file_url"),
  status: text("status").default("draft"), // draft | generated | sent
  createdAt: timestamp("created_at").defaultNow(),
});

// === PORTAL ===
export const portalListings = pgTable("portal_listings", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  assetId: integer("asset_id").references(() => assets.id),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  description: text("description"),
  featuredImage: text("featured_image"),
  galleryImages: jsonb("gallery_images").default([]),
  status: text("status").notNull().default("draft"),
  visibilityLevel: text("visibility_level").notNull().default("teaser"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  accentColor: text("accent_color").default("#1a365d"),
  sectionsConfig: jsonb("sections_config").default([]),
  highlights: jsonb("highlights").default([]),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow(),
  viewCount: integer("view_count").default(0),
});

export const portalInquiries = pgTable("portal_inquiries", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  listingId: integer("listing_id").references(() => portalListings.id),
  landingPageId: integer("landing_page_id").references(() => assetLandingPages.id),
  assetId: integer("asset_id").references(() => assets.id),
  leadId: integer("lead_id").references(() => leads.id),
  dealId: integer("deal_id").references(() => deals.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  company: text("company"),
  message: text("message"),
  status: text("status").notNull().default("new"),
  intentScore: integer("intent_score").default(0),
  intentSignalsJson: jsonb("intent_signals_json").default([]),
  createdAt: timestamp("created_at").defaultNow(),
});

// === CONTRACTS ===
export const contractTemplates = pgTable("contract_templates", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  name: text("name").notNull(),
  type: text("type").notNull(),
  bodyHtml: text("body_html"),
  bodyJson: jsonb("body_json"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const contracts = pgTable("contracts", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  templateId: integer("template_id").references(() => contractTemplates.id),
  name: text("name").notNull(),
  type: text("type").notNull(),
  companyId: integer("company_id").references(() => companies.id),
  dealId: integer("deal_id").references(() => deals.id),
  assetId: integer("asset_id").references(() => assets.id),
  investorProfileId: integer("investor_profile_id").references(() => investorProfiles.id),
  filledHtml: text("filled_html"),
  status: text("status").default("draft"),
  driveFileId: text("drive_file_id"),
  driveFileUrl: text("drive_file_url"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === ERROR REPORTS ===
export const errorReports = pgTable("error_reports", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  type: text("type").notNull().default("user_report"),
  title: text("title").notNull(),
  description: text("description"),
  page: text("page"),
  module: text("module"),
  priority: text("priority").default("medium"),
  status: text("status").default("open"),
  reportedBy: text("reported_by"),
  userAgent: text("user_agent"),
  requestUrl: text("request_url"),
  requestMethod: text("request_method"),
  statusCode: integer("status_code"),
  errorStack: text("error_stack"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
});

// === ASSET LANDING PAGES ===
export const assetLandingPages = pgTable("asset_landing_pages", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  assetId: integer("asset_id").references(() => assets.id),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  description: text("description"),
  featuredImage: text("featured_image"),
  galleryImages: jsonb("gallery_images").default([]),
  accentColor: text("accent_color").default("#1a365d"),
  sectionsConfig: jsonb("sections_config").default([]),
  highlights: jsonb("highlights").default([]),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  status: text("status").notNull().default("draft"),
  viewCount: integer("view_count").default(0),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === AUDIT LOG ===
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  userId: integer("user_id").references(() => users.id),
  userName: text("user_name").notNull(),
  entity: text("entity").notNull(),
  entityId: integer("entity_id").notNull(),
  entityTitle: text("entity_title"),
  action: text("action").notNull(),
  changesJson: jsonb("changes_json").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

// === SCHEMAS ===
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertOrgSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true });
export const insertConnectorSchema = createInsertSchema(connectors).omit({ id: true, lastRunAt: true });
export const insertCompanySchema = createInsertSchema(companies).omit({ id: true, createdAt: true });
export const insertContactSchema = createInsertSchema(contacts).omit({ id: true, createdAt: true });
export const insertLeadSchema = createInsertSchema(leads).omit({ id: true, createdAt: true, lastEnrichedAt: true });
export const insertDealSchema = createInsertSchema(deals).omit({ id: true, createdAt: true });
export const insertDealCommentSchema = createInsertSchema(dealComments).omit({ id: true, createdAt: true });
export const insertAssetSchema = createInsertSchema(assets).omit({ id: true, createdAt: true });
export const insertInvestorProfileSchema = createInsertSchema(investorProfiles).omit({ id: true, createdAt: true });
export const insertMatchSuggestionSchema = createInsertSchema(matchSuggestions).omit({ id: true, createdAt: true });
export const insertPipelineStageSchema = createInsertSchema(pipelineStages).omit({ id: true });
export const insertLeadRuleSchema = createInsertSchema(leadRules).omit({ id: true });
export const insertProposalTemplateSchema = createInsertSchema(proposalTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export const insertProposalSchema = createInsertSchema(proposals).omit({ id: true, createdAt: true });
export const insertOrgSettingSchema = createInsertSchema(orgSettings).omit({ id: true });
export const insertPortalListingSchema = createInsertSchema(portalListings).omit({ id: true, createdAt: true, publishedAt: true });
export const insertPortalInquirySchema = createInsertSchema(portalInquiries).omit({ id: true, createdAt: true });
export const insertContractTemplateSchema = createInsertSchema(contractTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export const insertContractSchema = createInsertSchema(contracts).omit({ id: true, createdAt: true });
export const insertErrorReportSchema = createInsertSchema(errorReports).omit({ id: true, createdAt: true, resolvedAt: true });
export const insertAssetLandingPageSchema = createInsertSchema(assetLandingPages).omit({ id: true, createdAt: true, publishedAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });

// === TYPES ===
export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Connector = typeof connectors.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type DealComment = typeof dealComments.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type InvestorProfile = typeof investorProfiles.$inferSelect;
export type MatchSuggestion = typeof matchSuggestions.$inferSelect;
export type PipelineStage = typeof pipelineStages.$inferSelect;
export type LeadRule = typeof leadRules.$inferSelect;
export type ProposalTemplate = typeof proposalTemplates.$inferSelect;
export type Proposal = typeof proposals.$inferSelect;
export type OrgSetting = typeof orgSettings.$inferSelect;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertConnector = z.infer<typeof insertConnectorSchema>;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type InsertContact = z.infer<typeof insertContactSchema>;
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type InsertDeal = z.infer<typeof insertDealSchema>;
export type InsertDealComment = z.infer<typeof insertDealCommentSchema>;
export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type InsertInvestorProfile = z.infer<typeof insertInvestorProfileSchema>;
export type InsertPipelineStage = z.infer<typeof insertPipelineStageSchema>;
export type InsertProposalTemplate = z.infer<typeof insertProposalTemplateSchema>;
export type InsertProposal = z.infer<typeof insertProposalSchema>;
export type PortalListing = typeof portalListings.$inferSelect;
export type PortalInquiry = typeof portalInquiries.$inferSelect;
export type ContractTemplate = typeof contractTemplates.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type InsertPortalListing = z.infer<typeof insertPortalListingSchema>;
export type InsertPortalInquiry = z.infer<typeof insertPortalInquirySchema>;
export type InsertContractTemplate = z.infer<typeof insertContractTemplateSchema>;
export type InsertContract = z.infer<typeof insertContractSchema>;
export type AssetLandingPage = typeof assetLandingPages.$inferSelect;
export type InsertAssetLandingPage = z.infer<typeof insertAssetLandingPageSchema>;
export type ErrorReport = typeof errorReports.$inferSelect;
export type InsertErrorReport = z.infer<typeof insertErrorReportSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

export const norionOperations = pgTable("norion_operations", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  companyId: integer("company_id").references(() => companies.id),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  stage: text("stage").notNull().default("identificado"),
  diagnostico: jsonb("diagnostico").default({}),
  valorAprovado: doublePrecision("valor_aprovado"),
  percentualComissao: doublePrecision("percentual_comissao").default(0),
  valorComissao: doublePrecision("valor_comissao"),
  comissaoRecebida: boolean("comissao_recebida").default(false),
  comissaoRecebidaEm: timestamp("comissao_recebida_em"),
  observacoesInternas: text("observacoes_internas"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type NorionOperation = typeof norionOperations.$inferSelect;
export type InsertNorionOperation = typeof norionOperations.$inferInsert;

export const norionDocuments = pgTable("norion_documents", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  operationId: integer("operation_id").references(() => norionOperations.id),
  clientUserId: integer("client_user_id").references(() => norionClientUsers.id),
  categoria: text("categoria").notNull(),
  tipoDocumento: text("tipo_documento").notNull(),
  nome: text("nome").notNull(),
  status: text("status").notNull().default("pendente"),
  obrigatorio: boolean("obrigatorio").default(true),
  driveFileId: text("drive_file_id"),
  driveFileUrl: text("drive_file_url"),
  nomeArquivo: text("nome_arquivo"),
  observacao: text("observacao"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export const insertNorionDocumentSchema = createInsertSchema(norionDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNorionDocument = z.infer<typeof insertNorionDocumentSchema>;
export type NorionDocument = typeof norionDocuments.$inferSelect;

export const norionFundosParceiros = pgTable("norion_fundos_parceiros", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  nome: text("nome").notNull(),
  cnpj: text("cnpj"),
  categoria: text("categoria"),
  tipoOperacao: text("tipo_operacao").array(),
  valorMinimo: doublePrecision("valor_minimo"),
  valorMaximo: doublePrecision("valor_maximo"),
  prazoMinimo: text("prazo_minimo"),
  prazoMaximo: text("prazo_maximo"),
  garantiasAceitas: text("garantias_aceitas").array(),
  contatoNome: text("contato_nome"),
  contatoEmail: text("contato_email"),
  contatoTelefone: text("contato_telefone"),
  observacoes: text("observacoes"),
  ativo: boolean("ativo").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export const insertNorionFundoParceiroSchema = createInsertSchema(norionFundosParceiros).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNorionFundoParceiro = z.infer<typeof insertNorionFundoParceiroSchema>;
export type NorionFundoParceiro = typeof norionFundosParceiros.$inferSelect;

export const norionEnviosFundos = pgTable("norion_envios_fundos", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  operationId: integer("operation_id").references(() => norionOperations.id),
  fundoParceiroId: integer("fundo_parceiro_id").references(() => norionFundosParceiros.id),
  status: text("status").notNull().default("enviado"),
  valorAprovado: doublePrecision("valor_aprovado"),
  taxaJuros: doublePrecision("taxa_juros"),
  prazoAprovado: text("prazo_aprovado"),
  motivoRecusa: text("motivo_recusa"),
  dataEnvio: timestamp("data_envio").defaultNow(),
  dataResposta: timestamp("data_resposta"),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export const insertNorionEnvioFundoSchema = createInsertSchema(norionEnviosFundos).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNorionEnvioFundo = z.infer<typeof insertNorionEnvioFundoSchema>;
export type NorionEnvioFundo = typeof norionEnviosFundos.$inferSelect;

export const norionCafRegistros = pgTable("norion_caf_registros", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  companyId: integer("company_id").references(() => companies.id),
  cpfTitular: text("cpf_titular"),
  nomeTitular: text("nome_titular").notNull(),
  numeroCAF: text("numero_caf"),
  numeroDAPAntigo: text("numero_dap_antigo"),
  numeroUFPA: text("numero_ufpa"),
  grupo: text("grupo"),
  enquadramentoPronaf: text("enquadramento_pronaf"),
  validade: text("validade"),
  dataInscricao: text("data_inscricao"),
  ultimaAtualizacao: text("ultima_atualizacao"),
  municipio: text("municipio"),
  uf: text("uf"),
  codigoMunicipio: text("codigo_municipio"),
  areaHa: doublePrecision("area_ha"),
  totalEstabelecimentoHa: doublePrecision("total_estabelecimento_ha"),
  totalEstabelecimentoM3: doublePrecision("total_estabelecimento_m3").default(0),
  numImoveis: integer("num_imoveis").default(1),
  condicaoPosse: text("condicao_posse"),
  atividadePrincipal: text("atividade_principal"),
  caracterizacaoUfpa: text("caracterizacao_ufpa"),
  atividadesProdutivas: text("atividades_produtivas"),
  composicaoFamiliar: jsonb("composicao_familiar").default([]),
  rendaBrutaAnual: doublePrecision("renda_bruta_anual"),
  entidadeNome: text("entidade_nome"),
  entidadeCnpj: text("entidade_cnpj"),
  cadastrador: text("cadastrador"),
  status: text("status").notNull().default("ativo"),
  norionProfile: text("norion_profile").default("baixo"),
  classificacao: text("classificacao").default("pendente"),
  observacoes: text("observacoes"),
  dadosExtras: jsonb("dados_extras").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export const insertNorionCafRegistroSchema = createInsertSchema(norionCafRegistros).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNorionCafRegistro = z.infer<typeof insertNorionCafRegistroSchema>;
export type NorionCafRegistro = typeof norionCafRegistros.$inferSelect;

export const norionClientUsers = pgTable("norion_client_users", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull(),
  taxId: text("tax_id").notNull(),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  operationId: integer("operation_id").references(() => norionOperations.id),
  accessToken: text("access_token").notNull(),
  tokenExpiresAt: timestamp("token_expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertNorionClientUserSchema = createInsertSchema(norionClientUsers).omit({ id: true, createdAt: true });
export type InsertNorionClientUser = z.infer<typeof insertNorionClientUserSchema>;
export type NorionClientUser = typeof norionClientUsers.$inferSelect;

export const norionFormularioCliente = pgTable("norion_formulario_cliente", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  operationId: integer("operation_id").references(() => norionOperations.id),
  clientUserId: integer("client_user_id").references(() => norionClientUsers.id),
  nomeCompleto: text("nome_completo"),
  cpf: text("cpf"),
  rg: text("rg"),
  dataNascimento: text("data_nascimento"),
  estadoCivil: text("estado_civil"),
  naturalidade: text("naturalidade"),
  nomeMae: text("nome_mae"),
  email: text("email"),
  telefone: text("telefone"),
  celular: text("celular"),
  cep: text("cep"),
  logradouro: text("logradouro"),
  numero: text("numero"),
  complemento: text("complemento"),
  bairro: text("bairro"),
  cidade: text("cidade"),
  uf: text("uf"),
  profissao: text("profissao"),
  empresaTrabalho: text("empresa_trabalho"),
  cnpjEmpresa: text("cnpj_empresa"),
  rendaMensal: doublePrecision("renda_mensal"),
  tempoEmprego: text("tempo_emprego"),
  outrasRendas: text("outras_rendas"),
  valorSolicitado: doublePrecision("valor_solicitado"),
  finalidadeCredito: text("finalidade_credito"),
  prazoDesejado: text("prazo_desejado"),
  tipoGarantia: text("tipo_garantia"),
  descricaoGarantia: text("descricao_garantia"),
  valorGarantia: doublePrecision("valor_garantia"),
  possuiImovel: boolean("possui_imovel").default(false),
  valorImovel: doublePrecision("valor_imovel"),
  possuiVeiculo: boolean("possui_veiculo").default(false),
  valorVeiculo: doublePrecision("valor_veiculo"),
  outrosPatrimonios: text("outros_patrimonios"),
  currentStep: integer("current_step").default(1),
  status: text("status").notNull().default("rascunho"),
  observacaoRevisao: text("observacao_revisao"),
  completedAt: timestamp("completed_at"),
  dadosExtras: jsonb("dados_extras").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export const insertNorionFormularioSchema = createInsertSchema(norionFormularioCliente).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNorionFormulario = z.infer<typeof insertNorionFormularioSchema>;
export type NorionFormulario = typeof norionFormularioCliente.$inferSelect;

// === MATCHING INTELIGENTE ===

export const matchFeedback = pgTable("match_feedback", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  suggestionId: integer("suggestion_id").references(() => matchSuggestions.id),
  investorProfileId: integer("investor_profile_id").references(() => investorProfiles.id),
  assetId: integer("asset_id").references(() => assets.id),
  action: text("action").notNull(),
  rejectionReason: text("rejection_reason"),
  rejectionNote: text("rejection_note"),
  assetType: text("asset_type"),
  assetEstado: text("asset_estado"),
  assetPrice: doublePrecision("asset_price"),
  scoreAtDecision: integer("score_at_decision"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertMatchFeedbackSchema = createInsertSchema(matchFeedback).omit({ id: true, createdAt: true });
export type InsertMatchFeedback = z.infer<typeof insertMatchFeedbackSchema>;
export type MatchFeedback = typeof matchFeedback.$inferSelect;

export const investorDynamicProfile = pgTable("investor_dynamic_profile", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  investorProfileId: integer("investor_profile_id").references(() => investorProfiles.id).unique(),
  typeWeights: jsonb("type_weights").default({}),
  regionWeights: jsonb("region_weights").default({}),
  realTicketMin: doublePrecision("real_ticket_min"),
  realTicketMax: doublePrecision("real_ticket_max"),
  realTicketAvg: doublePrecision("real_ticket_avg"),
  avgDecisionDays: doublePrecision("avg_decision_days"),
  totalSuggestions: integer("total_suggestions").default(0),
  totalAccepted: integer("total_accepted").default(0),
  totalRejected: integer("total_rejected").default(0),
  totalDeals: integer("total_deals").default(0),
  prefersDiversification: boolean("prefers_diversification").default(false),
  riskTolerance: text("risk_tolerance").default("moderate"),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export const insertInvestorDynamicProfileSchema = createInsertSchema(investorDynamicProfile).omit({ id: true, updatedAt: true });
export type InsertInvestorDynamicProfile = z.infer<typeof insertInvestorDynamicProfileSchema>;
export type InvestorDynamicProfile = typeof investorDynamicProfile.$inferSelect;

export const sicarImoveisCache = pgTable("sicar_imoveis_cache", {
  id: serial("id").primaryKey(),
  codImovel: text("cod_imovel").notNull().unique(),
  uf: text("uf").notNull(),
  municipio: text("municipio"),
  numArea: doublePrecision("num_area"),
  indStatus: text("ind_status"),
  indTipo: text("ind_tipo"),
  geometry: jsonb("geometry"),
  properties: jsonb("properties"),
  fetchedAt: timestamp("fetched_at").defaultNow(),
});
export type SicarImovelCache = typeof sicarImoveisCache.$inferSelect;
