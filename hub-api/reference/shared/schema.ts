import { pgTable, text, serial, timestamp, jsonb, index, integer, doublePrecision, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

export const agroEntities = pgTable("agro_entities", {
  id: serial("id").primaryKey(),

  entityType: text("entity_type").notNull(),

  name: text("name"),
  cpfCnpj: text("cpf_cnpj"),
  code: text("code"),

  state: text("state"),
  city: text("city"),
  region: text("region"),

  address: text("address"),
  neighborhood: text("neighborhood"),
  cep: text("cep"),

  phone: text("phone"),
  cellphone: text("cellphone"),
  extraPhones: text("extra_phones").array(),
  email: text("email"),

  category: text("category"),
  subCategory: text("sub_category"),
  productType: text("product_type"),
  segment: text("segment"),
  segment2: text("segment2"),

  birthDate: text("birth_date"),

  deliveryAddress: text("delivery_address"),
  deliveryNeighborhood: text("delivery_neighborhood"),
  deliveryCity: text("delivery_city"),
  deliveryState: text("delivery_state"),
  deliveryCep: text("delivery_cep"),

  additionalData: jsonb("additional_data"),

  sourceFile: text("source_file"),
  importedAt: timestamp("imported_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  entityTypeIdx: index("entity_type_idx").on(table.entityType),
  cpfCnpjIdx: index("cpf_cnpj_idx").on(table.cpfCnpj),
  codeIdx: index("code_idx").on(table.code),
  stateIdx: index("state_idx").on(table.state),
  categoryIdx: index("category_idx").on(table.category),
  cepIdx: index("cep_idx").on(table.cep),
  emailIdx: index("email_idx").on(table.email),
  segmentIdx: index("segment_idx").on(table.segment),
}));

export const insertAgroEntitySchema = createInsertSchema(agroEntities, {
  name: z.string().min(1, "Nome e obrigatorio"),
  entityType: z.string().min(1, "Tipo de entidade e obrigatorio"),
  cpfCnpj: z.string().optional(),
  additionalData: z.record(z.any()).optional(),
});

export const selectAgroEntitySchema = createSelectSchema(agroEntities);

export type AgroEntity = typeof agroEntities.$inferSelect;
export type InsertAgroEntity = z.infer<typeof insertAgroEntitySchema>;

export const fileUploads = pgTable("file_uploads", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  recordsImported: integer("records_imported").default(0),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

export const insertFileUploadSchema = createInsertSchema(fileUploads);
export const selectFileUploadSchema = createSelectSchema(fileUploads);

export type FileUpload = typeof fileUploads.$inferSelect;
export type InsertFileUpload = z.infer<typeof insertFileUploadSchema>;

export const apiUsers = pgTable("api_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertApiUserSchema = createInsertSchema(apiUsers).omit({ id: true, createdAt: true });
export type ApiUser = typeof apiUsers.$inferSelect;
export type InsertApiUser = z.infer<typeof insertApiUserSchema>;

export const sicarImoveisCache = pgTable("sicar_imoveis_cache", {
  id: serial("id").primaryKey(),
  codImovel: text("cod_imovel").notNull().unique(),
  uf: text("uf").notNull(),
  municipio: text("municipio"),
  numArea: doublePrecision("num_area"),
  indStatus: text("ind_status"),
  indTipo: text("ind_tipo"),
  datCriacao: timestamp("dat_criacao"),
  dataAtualizacao: timestamp("data_atualizacao"),
  condicao: text("condicao"),
  codMunicipioIbge: integer("cod_municipio_ibge"),
  mFiscal: doublePrecision("m_fiscal"),
  geometry: jsonb("geometry"),
  properties: jsonb("properties"),
  fetchedAt: timestamp("fetched_at").defaultNow(),
}, (table) => ({
  sicarUfIdx: index("sicar_uf_idx").on(table.uf),
  sicarMunicipioIdx: index("sicar_municipio_idx").on(table.municipio),
  sicarCodImovelIdx: index("sicar_cod_imovel_idx").on(table.codImovel),
}));

export const insertSicarImovelSchema = createInsertSchema(sicarImoveisCache);
export type SicarImovel = typeof sicarImoveisCache.$inferSelect;
export type InsertSicarImovel = z.infer<typeof insertSicarImovelSchema>;

export const sicarImportLog = pgTable("sicar_import_log", {
  id: serial("id").primaryKey(),
  uf: text("uf").notNull(),
  municipio: text("municipio"),
  status: text("status").notNull().default("running"),
  totalImoveis: integer("total_imoveis").default(0),
  totalErros: integer("total_erros").default(0),
  tipo: text("tipo").notNull().default("manual"),
  iniciadoEm: timestamp("iniciado_em").defaultNow(),
  finalizadoEm: timestamp("finalizado_em"),
  duracaoSegundos: integer("duracao_segundos"),
});

export const insertSicarImportLogSchema = createInsertSchema(sicarImportLog);
export type SicarImportLog = typeof sicarImportLog.$inferSelect;

export const sicarImportSchedule = pgTable("sicar_import_schedule", {
  id: serial("id").primaryKey(),
  uf: text("uf").notNull(),
  cronExpression: text("cron_expression").notNull(),
  descricao: text("descricao"),
  ativo: boolean("ativo").notNull().default(true),
  ultimaExecucao: timestamp("ultima_execucao"),
  proximaExecucao: timestamp("proxima_execucao"),
  criadoEm: timestamp("criado_em").defaultNow(),
});

export const insertSicarScheduleSchema = createInsertSchema(sicarImportSchedule);
export type SicarSchedule = typeof sicarImportSchedule.$inferSelect;

export const agrofitProdutos = pgTable("agrofit_produtos", {
  id: serial("id").primaryKey(),
  idAgrofit: integer("id_agrofit").notNull().unique(),
  marcaComercial: text("marca_comercial"),
  nrRegistro: text("nr_registro"),
  classe: text("classe"),
  classificacaoToxicologica: text("classificacao_toxicologica"),
  classificacaoAmbiental: text("classificacao_ambiental"),
  formulacao: text("formulacao"),
  ingredienteInerteQtd: text("ingrediente_inerte_qtd"),
  ingredienteInerteUnidade: text("ingrediente_inerte_unidade"),
  titularRegistro: text("titular_registro"),
  status: text("status").default("ativo"),
  fetchedAt: timestamp("fetched_at").defaultNow(),
}, (table) => ({
  agrofitIdIdx: index("agrofit_id_agrofit_idx").on(table.idAgrofit),
  agrofitClasseIdx: index("agrofit_classe_idx").on(table.classe),
  agrofitMarcaIdx: index("agrofit_marca_idx").on(table.marcaComercial),
}));

export const insertAgrofitProdutoSchema = createInsertSchema(agrofitProdutos).omit({ id: true, fetchedAt: true });
export type AgrofitProduto = typeof agrofitProdutos.$inferSelect;
export type InsertAgrofitProduto = z.infer<typeof insertAgrofitProdutoSchema>;

export const agrofitIngredientes = pgTable("agrofit_ingredientes", {
  id: serial("id").primaryKey(),
  produtoId: integer("produto_id").notNull(),
  tipo: text("tipo"),
  nome: text("nome"),
  componente: text("componente"),
  quantidade: text("quantidade"),
  unidadeMedida: text("unidade_medida"),
  percentual: text("percentual"),
  grupoQuimico: text("grupo_quimico"),
  nomeIupac: text("nome_iupac"),
  nomeCa: text("nome_ca"),
  formulaBruta: text("formula_bruta"),
}, (table) => ({
  agrofitIngProdutoIdx: index("agrofit_ing_produto_idx").on(table.produtoId),
}));

export const insertAgrofitIngredienteSchema = createInsertSchema(agrofitIngredientes).omit({ id: true });
export type AgrofitIngrediente = typeof agrofitIngredientes.$inferSelect;
export type InsertAgrofitIngrediente = z.infer<typeof insertAgrofitIngredienteSchema>;

export const agrofitIndicacoes = pgTable("agrofit_indicacoes", {
  id: serial("id").primaryKey(),
  produtoId: integer("produto_id").notNull(),
  cultura: text("cultura"),
  praga: text("praga"),
  nomeComum: text("nome_comum"),
  doseMin: text("dose_min"),
  doseMax: text("dose_max"),
  unidadeDose: text("unidade_dose"),
  volumeCaldaMin: text("volume_calda_min"),
  volumeCaldaMax: text("volume_calda_max"),
  intervaloAplicacao: text("intervalo_aplicacao"),
  intervaloSeguranca: text("intervalo_seguranca"),
  epocaAplicacao: text("epoca_aplicacao"),
  observacao: text("observacao"),
}, (table) => ({
  agrofitIndProdutoIdx: index("agrofit_ind_produto_idx").on(table.produtoId),
  agrofitIndCulturaIdx: index("agrofit_ind_cultura_idx").on(table.cultura),
}));

export const insertAgrofitIndicacaoSchema = createInsertSchema(agrofitIndicacoes).omit({ id: true });
export type AgrofitIndicacao = typeof agrofitIndicacoes.$inferSelect;
export type InsertAgrofitIndicacao = z.infer<typeof insertAgrofitIndicacaoSchema>;

export const agrofitFabricantes = pgTable("agrofit_fabricantes", {
  id: serial("id").primaryKey(),
  produtoId: integer("produto_id").notNull(),
  razaoSocial: text("razao_social"),
  pais: text("pais"),
  tipoFabricante: text("tipo_fabricante"),
}, (table) => ({
  agrofitFabProdutoIdx: index("agrofit_fab_produto_idx").on(table.produtoId),
}));

export const insertAgrofitFabricanteSchema = createInsertSchema(agrofitFabricantes).omit({ id: true });
export type AgrofitFabricante = typeof agrofitFabricantes.$inferSelect;
export type InsertAgrofitFabricante = z.infer<typeof insertAgrofitFabricanteSchema>;

export const agrofitImportLog = pgTable("agrofit_import_log", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("running"),
  idInicio: integer("id_inicio"),
  idFim: integer("id_fim"),
  totalProdutos: integer("total_produtos").default(0),
  totalErros: integer("total_erros").default(0),
  iniciadoEm: timestamp("iniciado_em").defaultNow(),
  finalizadoEm: timestamp("finalizado_em"),
  duracaoSegundos: integer("duracao_segundos"),
});
