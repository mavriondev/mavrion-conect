import { pgTable, text, serial, integer, boolean, timestamp, jsonb, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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

export const orgSettings = pgTable("org_settings", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id),
  key: text("key").notNull(),
  value: jsonb("value"),
});

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

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertCompanySchema = createInsertSchema(companies).omit({ id: true, createdAt: true });

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;

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
