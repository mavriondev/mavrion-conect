import type { Express } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and, desc, ilike, sql, gte, lte } from "drizzle-orm";
import { companies, norionOperations, norionDocuments, norionFundosParceiros, norionEnviosFundos, orgSettings, norionCafRegistros } from "@shared/schema";
import { audit } from "../audit";
import { getOrgId } from "../lib/tenant";
import { consultarFundoCVM, listarFundosEstruturadosANBIMA, isAnbimaConfigured, clearAnbimaTokenCache, type AnbimaCredentials } from "../enrichment/fundos";
import { storage } from "../storage";
import { uploadToDrive } from "../google-drive";

export const CHECKLIST_HOME_EQUITY = [
  { categoria: "pessoal", tipoDocumento: "rg_cnh", nome: "RG ou CNH (documento com foto)", obrigatorio: true },
  { categoria: "pessoal", tipoDocumento: "certidao_estado_civil", nome: "Certidão de nascimento ou casamento atualizada", obrigatorio: true },
  { categoria: "pessoal", tipoDocumento: "comprovante_residencia", nome: "Comprovante de residência (último mês)", obrigatorio: true },
  { categoria: "pessoal", tipoDocumento: "ir_protocolo_socios", nome: "IR + protocolo sócios/cônjuges (últimos 2 anos)", obrigatorio: true },
  { categoria: "imovel", tipoDocumento: "matricula_imovel", nome: "Cópia da matrícula do imóvel", obrigatorio: true },
  { categoria: "imovel", tipoDocumento: "iptu", nome: "IPTU", obrigatorio: true },
  { categoria: "imovel", tipoDocumento: "escritura", nome: "Escritura pública de compra e venda", obrigatorio: false },
  { categoria: "imovel", tipoDocumento: "fotos_imovel", nome: "Fotos do imóvel (externas e internas)", obrigatorio: true },
  { categoria: "imovel", tipoDocumento: "planilha_garantias", nome: "Planilha de garantias", obrigatorio: true },
  { categoria: "renda", tipoDocumento: "extratos_bancarios", nome: "Extratos bancários dos últimos 6 meses", obrigatorio: true },
  { categoria: "renda", tipoDocumento: "irpf", nome: "Declaração do IRPF", obrigatorio: true },
  { categoria: "renda", tipoDocumento: "recibo_irpf", nome: "Recibo de entrega do IRPF", obrigatorio: true },
  { categoria: "renda", tipoDocumento: "dre_balanco", nome: "DRE, faturamento e Balanço Patrimonial (PJ)", obrigatorio: false },
  { categoria: "renda", tipoDocumento: "balanco_dre_3anos", nome: "Balanço/DRE últimos 3 anos + balancete recente", obrigatorio: true },
  { categoria: "renda", tipoDocumento: "relacao_faturamento_12m", nome: "Relação de faturamento últimos 12 meses (assinada)", obrigatorio: true },
  { categoria: "renda", tipoDocumento: "relacao_endividamento", nome: "Relação de endividamento (assinada)", obrigatorio: true },
  { categoria: "briefing", tipoDocumento: "valor_motivo_credito", nome: "Valor do crédito e motivo do crédito", obrigatorio: true },
  { categoria: "briefing", tipoDocumento: "profissao_tomador", nome: "Profissão do tomador", obrigatorio: true },
  { categoria: "briefing", tipoDocumento: "contrato_social", nome: "Contrato Social consolidado", obrigatorio: true },
  { categoria: "briefing", tipoDocumento: "comprovante_endereco_empresa", nome: "Comprovante de endereço da empresa", obrigatorio: true },
  { categoria: "briefing", tipoDocumento: "apresentacao_institucional", nome: "Apresentação institucional / plano de negócios", obrigatorio: false },
];

const SETORES_ALTO = ["01","02","03","41","42","43","10","11","12","13","14","45","46","47","49","50","51","52"];
const SETORES_MEDIO = ["56","55","62","63","68","85","86"];

function calcularPerfil(company: any): "alto" | "medio" | "baixo" {
  const cnae = (company.cnaePrincipal || "").substring(0, 2);
  const porte = (company.porte || "").toUpperCase();
  if (!company.cnpj) return "baixo";
  const isAlto = SETORES_ALTO.includes(cnae);
  const isMedio = SETORES_MEDIO.includes(cnae);
  const isGrande = ["MEDIO","GRANDE","DEMAIS"].includes(porte);
  if (isAlto && isGrande) return "alto";
  if (isAlto || (isMedio && isGrande)) return "medio";
  return "baixo";
}

export function registerNorionRoutes(app: Express, db: NodePgDatabase<any>) {

  app.use("/api/norion", (req, res, next) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    next();
  });

  app.get("/api/norion/operations", async (req, res) => {
    try {
      const orgId = getOrgId();
      const ops = await db.select().from(norionOperations)
        .where(eq(norionOperations.orgId, orgId))
        .orderBy(desc(norionOperations.createdAt));
      const enriched = await Promise.all(ops.map(async (op) => {
        const [company] = op.companyId ? await db.select().from(companies).where(eq(companies.id, op.companyId)) : [null];
        const docs = await storage.getNorionDocuments(op.id, orgId);
        const docProgress = {
          total: docs.length,
          concluidos: docs.filter(d => d.status === "aprovado" || d.status === "enviado").length,
        };
        return { ...op, company, docProgress };
      }));
      res.json(enriched);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/norion/operations", async (req, res) => {
    try {
      const orgId = getOrgId();
      const user = req.user as any;
      const { companyId, diagnostico, observacoesInternas } = req.body;
      if (!companyId) return res.status(400).json({ message: "companyId é obrigatório" });
      const [company] = await db.select().from(companies).where(and(eq(companies.id, companyId), eq(companies.orgId, orgId)));
      if (!company) return res.status(404).json({ message: "Empresa não encontrada" });
      const [op] = await db.insert(norionOperations).values({
        orgId, companyId, ownerUserId: user?.id,
        stage: diagnostico ? "diagnostico" : "identificado",
        diagnostico: diagnostico || {}, observacoesInternas: observacoesInternas || null,
      }).returning();
      await audit({ orgId, userId: user?.id, userName: user?.username,
        entity: "norion_operation", entityId: op.id, entityTitle: company.legalName,
        action: "created", changes: { stage: { from: null, to: op.stage } } });
      for (const item of CHECKLIST_HOME_EQUITY) {
        await storage.createNorionDocument({
          orgId, operationId: op.id,
          categoria: item.categoria, tipoDocumento: item.tipoDocumento,
          nome: item.nome, status: "pendente", obrigatorio: item.obrigatorio,
        });
      }
      res.json(op);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.patch("/api/norion/operations/:id", async (req, res) => {
    try {
      const orgId = getOrgId();
      const user = req.user as any;
      const opId = Number(req.params.id);
      const { stage, diagnostico, valorAprovado, percentualComissao, observacoesInternas, comissaoRecebida } = req.body;
      const [existing] = await db.select().from(norionOperations).where(and(eq(norionOperations.id, opId), eq(norionOperations.orgId, orgId)));
      if (!existing) return res.status(404).json({ message: "Operação não encontrada" });
      const updateData: Record<string, any> = { updatedAt: new Date() };
      if (stage) {
        const advancedStages = ["enviado_fundos", "em_analise", "aprovado", "comissao_gerada"];
        if (advancedStages.includes(stage) && !advancedStages.includes(existing.stage)) {
          const docs = await storage.getNorionDocuments(opId, orgId);
          const pendingRequired = docs.filter(d => d.obrigatorio && d.status !== "aprovado" && d.status !== "enviado");
          if (pendingRequired.length > 0) {
            return res.status(400).json({
              message: `${pendingRequired.length} documento(s) obrigatório(s) pendente(s)`,
              pendingDocs: pendingRequired.map(d => d.nome),
            });
          }
        }
        updateData.stage = stage;
      }
      if (diagnostico) updateData.diagnostico = diagnostico;
      if (observacoesInternas !== undefined) updateData.observacoesInternas = observacoesInternas;
      if (valorAprovado !== undefined) updateData.valorAprovado = valorAprovado;
      if (percentualComissao !== undefined) {
        updateData.percentualComissao = percentualComissao;
        updateData.valorComissao = ((valorAprovado || existing.valorAprovado || 0) * percentualComissao) / 100;
      }
      if (comissaoRecebida === true) {
        updateData.comissaoRecebida = true;
        updateData.comissaoRecebidaEm = new Date();
        updateData.stage = "comissao_gerada";
      }
      const [updated] = await db.update(norionOperations).set(updateData).where(and(eq(norionOperations.id, opId), eq(norionOperations.orgId, orgId))).returning();
      await audit({ orgId, userId: user?.id, userName: user?.username,
        entity: "norion_operation", entityId: opId, entityTitle: "Operação #" + opId,
        action: "updated", changes: updateData });
      res.json(updated);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/norion/operations/:id", async (req, res) => {
    try {
      const orgId = getOrgId();
      const opId = Number(req.params.id);
      const [existing] = await db.select().from(norionOperations).where(and(eq(norionOperations.id, opId), eq(norionOperations.orgId, orgId)));
      if (!existing) return res.status(404).json({ message: "Operação não encontrada" });
      await storage.deleteNorionEnviosByOperation(opId, orgId);
      await db.delete(norionDocuments).where(eq(norionDocuments.operationId, opId));
      await db.delete(norionOperations).where(and(eq(norionOperations.id, opId), eq(norionOperations.orgId, orgId)));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/norion/profile/:companyId", async (req, res) => {
    try {
      const orgId = getOrgId();
      const companyId = Number(req.params.companyId);
      const [company] = await db.select().from(companies).where(and(eq(companies.id, companyId), eq(companies.orgId, orgId)));
      if (!company) return res.status(404).json({ message: "Empresa não encontrada" });
      const perfil = calcularPerfil(company);
      await db.update(companies).set({ norionProfile: perfil } as any).where(eq(companies.id, companyId));
      res.json({ companyId, norionProfile: perfil });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/norion/recalculate-profiles", async (req, res) => {
    try {
      const orgId = getOrgId();
      const all = await db.select().from(companies).where(eq(companies.orgId, orgId));
      let alto = 0, medio = 0, baixo = 0;
      for (const c of all) {
        const perfil = calcularPerfil(c);
        await db.update(companies).set({ norionProfile: perfil } as any).where(eq(companies.id, c.id));
        if (perfil === "alto") alto++; else if (perfil === "medio") medio++; else baixo++;
      }
      res.json({ total: all.length, alto, medio, baixo });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/norion/dashboard", async (req, res) => {
    try {
      const orgId = getOrgId();
      const ops = await db.select().from(norionOperations).where(eq(norionOperations.orgId, orgId));
      const aprovadas = ops.filter(o => ["aprovado","comissao_gerada"].includes(o.stage));
      const recebidas = ops.filter(o => o.comissaoRecebida);
      res.json({
        totalOperacoes: ops.length,
        volumeAprovado: aprovadas.reduce((s, o) => s + (o.valorAprovado || 0), 0),
        comissaoTotal: recebidas.reduce((s, o) => s + (o.valorComissao || 0), 0),
        comissaoAPagar: aprovadas.filter(o => !o.comissaoRecebida).reduce((s, o) => s + (o.valorComissao || 0), 0),
        taxaAprovacao: ops.length > 0 ? Math.round((aprovadas.length / ops.length) * 100) : 0,
        porEtapa: {
          identificado: ops.filter(o => o.stage === "identificado").length,
          diagnostico: ops.filter(o => o.stage === "diagnostico").length,
          enviado_fundos: ops.filter(o => o.stage === "enviado_fundos").length,
          em_analise: ops.filter(o => o.stage === "em_analise").length,
          aprovado: ops.filter(o => o.stage === "aprovado").length,
          comissao_gerada: ops.filter(o => o.stage === "comissao_gerada").length,
        },
      });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/norion/seed-demo", async (req, res) => {
    try {
      const orgId = getOrgId();

      const empresas = await db.select().from(companies)
        .where(eq(companies.orgId, orgId))
        .limit(6);

      if (empresas.length === 0) {
        return res.status(400).json({ message: "Cadastre algumas empresas antes de rodar o demo" });
      }

      await db.delete(norionOperations).where(eq(norionOperations.orgId, orgId));

      const operacoesDemo = [
        {
          companyId: empresas[0]?.id,
          stage: "comissao_gerada",
          diagnostico: {
            valorSolicitado: 850000,
            finalidade: "Expansão",
            prazo: "24 a 36 meses",
            garantias: ["Imóvel", "Recebíveis"],
            faturamento: "R$2M a R$10M",
            possuiDivida: false,
            observacoes: "Empresa com histórico sólido, expansão para nova unidade"
          },
          valorAprovado: 800000,
          percentualComissao: 2.5,
          valorComissao: 20000,
          comissaoRecebida: true,
          comissaoRecebidaEm: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          observacoesInternas: "Operação fechada com FIDC Agro Brasil. Cliente satisfeito.",
        },
        {
          companyId: empresas[1]?.id,
          stage: "aprovado",
          diagnostico: {
            valorSolicitado: 1200000,
            finalidade: "Agro",
            prazo: "12 a 24 meses",
            garantias: ["Terra", "CPR"],
            faturamento: "Acima de R$10M",
            possuiDivida: false,
            observacoes: "Produtor rural, safra de soja. Garantia em terra e recebíveis de contrato."
          },
          valorAprovado: 1100000,
          percentualComissao: 2,
          valorComissao: 22000,
          comissaoRecebida: false,
          observacoesInternas: "Aprovado pelo Fundo Capital Agro. Aguardando assinatura.",
        },
        {
          companyId: empresas[2]?.id,
          stage: "em_analise",
          diagnostico: {
            valorSolicitado: 500000,
            finalidade: "Capital de Giro",
            prazo: "Até 12 meses",
            garantias: ["Recebíveis"],
            faturamento: "R$500k a R$2M",
            possuiDivida: true,
            observacoes: "Empresa de varejo, necessidade de capital para estoque."
          },
          observacoesInternas: "Enviado para 3 fundos. Retorno esperado em 5 dias úteis.",
        },
        {
          companyId: empresas[3]?.id,
          stage: "enviado_fundos",
          diagnostico: {
            valorSolicitado: 2500000,
            finalidade: "Imóvel",
            prazo: "Acima de 36 meses",
            garantias: ["Imóvel"],
            faturamento: "Acima de R$10M",
            possuiDivida: false,
            observacoes: "Incorporadora. Desenvolvimento de loteamento residencial."
          },
          observacoesInternas: "Estruturado com SPE. Enviado a 5 fundos imobiliários.",
        },
        {
          companyId: empresas[4]?.id,
          stage: "diagnostico",
          diagnostico: {
            valorSolicitado: 320000,
            finalidade: "Equipamentos",
            prazo: "12 a 24 meses",
            garantias: ["Equipamentos", "Recebíveis"],
            faturamento: "R$500k a R$2M",
            possuiDivida: false,
            observacoes: "Indústria de pequeno porte. Modernização de maquinário."
          },
          observacoesInternas: "Diagnóstico concluído. Preparando dossiê para envio.",
        },
        {
          companyId: empresas[5]?.id || empresas[0]?.id,
          stage: "identificado",
          diagnostico: {},
          observacoesInternas: "Empresa indicada pelo SDR João. Aguardando reunião inicial.",
        },
      ];

      for (const op of operacoesDemo) {
        if (!op.companyId) continue;
        await db.insert(norionOperations).values({
          orgId,
          companyId: op.companyId,
          stage: op.stage,
          diagnostico: op.diagnostico,
          valorAprovado: (op as any).valorAprovado || null,
          percentualComissao: (op as any).percentualComissao || 0,
          valorComissao: (op as any).valorComissao || null,
          comissaoRecebida: (op as any).comissaoRecebida || false,
          comissaoRecebidaEm: (op as any).comissaoRecebidaEm || null,
          observacoesInternas: op.observacoesInternas,
        });
      }

      res.json({ success: true, message: `${operacoesDemo.length} operações de demonstração criadas com sucesso` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  async function getAnbimaCredentials(): Promise<AnbimaCredentials | null> {
    const orgId = getOrgId();
    const [setting] = await db.select().from(orgSettings)
      .where(and(eq(orgSettings.orgId, orgId), eq(orgSettings.key, "anbima_credentials")));
    if (setting?.value && typeof setting.value === "object") {
      const v = setting.value as any;
      if (v.clientId && v.clientSecret) return { clientId: v.clientId, clientSecret: v.clientSecret };
    }
    if (process.env.ANBIMA_CLIENT_ID && process.env.ANBIMA_CLIENT_SECRET) {
      return { clientId: process.env.ANBIMA_CLIENT_ID, clientSecret: process.env.ANBIMA_CLIENT_SECRET };
    }
    return null;
  }

  app.get("/api/norion/fundo/:cnpj", async (req, res) => {
    try {
      const fundo = await consultarFundoCVM(req.params.cnpj);
      if (!fundo) return res.status(404).json({ message: "Fundo não encontrado na CVM" });
      res.json(fundo);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/norion/fundos-estruturados", async (req, res) => {
    try {
      const creds = await getAnbimaCredentials();
      if (!isAnbimaConfigured(creds)) {
        return res.json({ configured: false, total: 0, fundos: [], message: "Credenciais ANBIMA não configuradas. Configure em Norion Capital > Fundos > Configurar ANBIMA." });
      }
      const tipo = req.query.tipo as string | undefined;
      const fundos = await listarFundosEstruturadosANBIMA(tipo, creds);
      res.json({ configured: true, total: fundos.length, fundos });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/norion/settings", async (req, res) => {
    try {
      const orgId = getOrgId();
      const [setting] = await db.select().from(orgSettings)
        .where(and(eq(orgSettings.orgId, orgId), eq(orgSettings.key, "anbima_credentials")));
      const val = (setting?.value as any) || {};
      const fromDb = !!(val.clientId && val.clientSecret);
      const fromEnv = !!(process.env.ANBIMA_CLIENT_ID && process.env.ANBIMA_CLIENT_SECRET);
      const configured = fromDb || fromEnv;
      const maskedId = val.clientId
        ? val.clientId.substring(0, 4) + "***"
        : (process.env.ANBIMA_CLIENT_ID ? process.env.ANBIMA_CLIENT_ID.substring(0, 4) + "***" : "");
      res.json({ configured, clientId: maskedId, source: fromDb ? "database" : (fromEnv ? "env" : "none") });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/norion/settings", async (req, res) => {
    try {
      const orgId = getOrgId();
      const { clientId, clientSecret } = req.body;
      if (!clientId || !clientSecret) return res.status(400).json({ message: "clientId e clientSecret são obrigatórios" });
      const [existing] = await db.select().from(orgSettings)
        .where(and(eq(orgSettings.orgId, orgId), eq(orgSettings.key, "anbima_credentials")));
      if (existing) {
        await db.update(orgSettings).set({ value: { clientId, clientSecret } })
          .where(and(eq(orgSettings.orgId, orgId), eq(orgSettings.key, "anbima_credentials")));
      } else {
        await db.insert(orgSettings).values({ orgId, key: "anbima_credentials", value: { clientId, clientSecret } });
      }
      clearAnbimaTokenCache();
      res.json({ success: true, message: "Credenciais ANBIMA salvas com sucesso" });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/norion/relatorio-comissoes", async (req, res) => {
    try {
      const orgId = getOrgId();
      const { de, ate } = req.query;
      const ops = await db.select().from(norionOperations).where(eq(norionOperations.orgId, orgId));
      const comEmpresas = await Promise.all(ops.map(async (op) => {
        const [company] = op.companyId
          ? await db.select().from(companies).where(eq(companies.id, op.companyId))
          : [null];
        return { ...op, company };
      }));
      const filtradas = comEmpresas.filter(op => {
        if (!de && !ate) return true;
        const data = op.createdAt ? new Date(op.createdAt) : null;
        if (!data) return false;
        if (de && data < new Date(de as string)) return false;
        if (ate && data > new Date(ate as string)) return false;
        return true;
      });
      const aprovadas = filtradas.filter(o => ["aprovado","comissao_gerada"].includes(o.stage));
      const recebidas = filtradas.filter(o => o.comissaoRecebida);
      const linhas = aprovadas.map(op => ({
        empresa: op.company?.legalName || op.company?.tradeName || "—",
        cnpj: op.company?.cnpj || "—",
        valorAprovado: op.valorAprovado || 0,
        percentualComissao: op.percentualComissao || 0,
        valorComissao: op.valorComissao || 0,
        comissaoRecebida: op.comissaoRecebida,
        dataOperacao: op.createdAt,
        dataRecebimento: op.comissaoRecebidaEm,
        stage: op.stage,
      }));
      res.json({
        periodo: { de: de || null, ate: ate || null },
        totalOperacoes: aprovadas.length,
        volumeAprovado: aprovadas.reduce((s, o) => s + (o.valorAprovado || 0), 0),
        comissaoTotal: aprovadas.reduce((s, o) => s + (o.valorComissao || 0), 0),
        comissaoRecebida: recebidas.reduce((s, o) => s + (o.valorComissao || 0), 0),
        comissaoAPagar: aprovadas.filter(o => !o.comissaoRecebida).reduce((s, o) => s + (o.valorComissao || 0), 0),
        linhas,
      });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/norion/operations/:id/documents", async (req, res) => {
    try {
      const orgId = getOrgId();
      const operationId = Number(req.params.id);
      const docs = await storage.getNorionDocuments(operationId, orgId);
      const total = docs.length;
      const concluidos = docs.filter(d => d.status === "aprovado" || d.status === "enviado").length;
      const obrigatorios = docs.filter(d => d.obrigatorio);
      const obrigatoriosConcluidos = obrigatorios.filter(d => d.status === "aprovado" || d.status === "enviado").length;
      res.json({
        documents: docs,
        progress: { total, concluidos, obrigatorios: obrigatorios.length, obrigatoriosConcluidos },
      });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/norion/operations/:id/documents/generate", async (req, res) => {
    try {
      const orgId = getOrgId();
      const operationId = Number(req.params.id);
      const [op] = await db.select().from(norionOperations).where(and(eq(norionOperations.id, operationId), eq(norionOperations.orgId, orgId)));
      if (!op) return res.status(404).json({ message: "Operação não encontrada" });
      const existing = await storage.getNorionDocuments(operationId, orgId);
      if (existing.length > 0) return res.json({ message: "Checklist já gerado", documents: existing });
      const created = [];
      for (const item of CHECKLIST_HOME_EQUITY) {
        const doc = await storage.createNorionDocument({
          orgId, operationId,
          categoria: item.categoria,
          tipoDocumento: item.tipoDocumento,
          nome: item.nome,
          status: "pendente",
          obrigatorio: item.obrigatorio,
        });
        created.push(doc);
      }
      res.json({ message: "Checklist gerado", documents: created });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.patch("/api/norion/documents/:id", async (req, res) => {
    try {
      const orgId = getOrgId();
      const docId = Number(req.params.id);
      const { status, observacao, driveFileId, driveFileUrl, nomeArquivo } = req.body;
      const updateData: Record<string, any> = {};
      if (status) updateData.status = status;
      if (observacao !== undefined) updateData.observacao = observacao;
      if (driveFileId !== undefined) updateData.driveFileId = driveFileId;
      if (driveFileUrl !== undefined) updateData.driveFileUrl = driveFileUrl;
      if (nomeArquivo !== undefined) updateData.nomeArquivo = nomeArquivo;
      const updated = await storage.updateNorionDocument(docId, orgId, updateData);
      if (!updated) return res.status(404).json({ message: "Documento não encontrado" });
      res.json(updated);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/norion/documents/:id", async (req, res) => {
    try {
      const orgId = getOrgId();
      await storage.deleteNorionDocument(Number(req.params.id), orgId);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/norion/documents/:id/upload", async (req, res) => {
    try {
      const orgId = getOrgId();
      const docId = Number(req.params.id);
      const { fileBase64, fileName, mimeType } = req.body;
      if (!fileBase64 || !fileName) return res.status(400).json({ message: "fileBase64 e fileName são obrigatórios" });

      const [doc] = await db.select().from(norionDocuments).where(and(eq(norionDocuments.id, docId), eq(norionDocuments.orgId, orgId)));
      if (!doc) return res.status(404).json({ message: "Documento não encontrado" });

      const [op] = await db.select().from(norionOperations).where(eq(norionOperations.id, doc.operationId!));
      let companyName = "Operacao_" + doc.operationId;
      if (op?.companyId) {
        const [company] = await db.select().from(companies).where(eq(companies.id, op.companyId));
        if (company) companyName = (company.tradeName || company.legalName || "Empresa").replace(/[^a-zA-Z0-9_\- ]/g, "");
      }

      const fileBuffer = Buffer.from(fileBase64, "base64");
      const result = await uploadToDrive(fileBuffer, fileName, mimeType || "application/pdf", ["Mavrion Conect", "Norion", companyName]);

      const updated = await storage.updateNorionDocument(docId, orgId, {
        driveFileId: result.fileId,
        driveFileUrl: result.fileUrl,
        nomeArquivo: fileName,
        status: "enviado",
      });
      res.json(updated);
    } catch (err: any) {
      console.error("Upload error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/norion/fundos-parceiros", async (req, res) => {
    try {
      const orgId = getOrgId();
      const fundos = await storage.getNorionFundosParceiros(orgId);
      res.json(fundos);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/norion/fundos-parceiros", async (req, res) => {
    try {
      const orgId = getOrgId();
      const user = req.user as any;
      const { nome, cnpj, categoria, tipoOperacao, valorMinimo, valorMaximo, prazoMinimo, prazoMaximo, garantiasAceitas, contatoNome, contatoEmail, contatoTelefone, observacoes } = req.body;
      if (!nome) return res.status(400).json({ message: "Nome é obrigatório" });
      const fundo = await storage.createNorionFundoParceiro({
        orgId, nome, cnpj, categoria, tipoOperacao, valorMinimo, valorMaximo,
        prazoMinimo, prazoMaximo, garantiasAceitas, contatoNome, contatoEmail, contatoTelefone, observacoes,
      });
      await audit({ orgId, userId: user?.id, userName: user?.username,
        entity: "norion_fundo_parceiro", entityId: fundo.id, entityTitle: nome,
        action: "created", changes: {} });
      res.json(fundo);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.patch("/api/norion/fundos-parceiros/:id", async (req, res) => {
    try {
      const orgId = getOrgId();
      const user = req.user as any;
      const id = Number(req.params.id);
      const existing = await storage.getNorionFundoParceiro(id, orgId);
      if (!existing) return res.status(404).json({ message: "Fundo não encontrado" });
      const updated = await storage.updateNorionFundoParceiro(id, orgId, req.body);
      await audit({ orgId, userId: user?.id, userName: user?.username,
        entity: "norion_fundo_parceiro", entityId: id, entityTitle: existing.nome,
        action: "updated", changes: req.body });
      res.json(updated);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/norion/fundos-parceiros/:id", async (req, res) => {
    try {
      const orgId = getOrgId();
      const id = Number(req.params.id);
      const existing = await storage.getNorionFundoParceiro(id, orgId);
      if (!existing) return res.status(404).json({ message: "Fundo não encontrado" });
      await storage.deleteNorionFundoParceiro(id, orgId);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/norion/fundos-parceiros/:id/historico", async (req, res) => {
    try {
      const orgId = getOrgId();
      const fundoId = Number(req.params.id);
      const fundo = await storage.getNorionFundoParceiro(fundoId, orgId);
      if (!fundo) return res.status(404).json({ message: "Fundo não encontrado" });
      const envios = await storage.getNorionEnviosByFundo(fundoId, orgId);
      const enriched = await Promise.all(envios.map(async (e) => {
        const [op] = e.operationId ? await db.select().from(norionOperations).where(eq(norionOperations.id, e.operationId)) : [null];
        let company = null;
        if (op?.companyId) {
          const [c] = await db.select().from(companies).where(eq(companies.id, op.companyId));
          company = c || null;
        }
        return { ...e, operation: op, company };
      }));
      const aprovados = envios.filter(e => e.status === "aprovado");
      const recusados = envios.filter(e => e.status === "recusado");
      const tempoRespostas = envios.filter(e => e.dataEnvio && e.dataResposta).map(e => {
        const diff = new Date(e.dataResposta!).getTime() - new Date(e.dataEnvio!).getTime();
        return diff / (1000 * 60 * 60 * 24);
      });
      res.json({
        fundo,
        envios: enriched,
        metricas: {
          totalEnvios: envios.length,
          aprovados: aprovados.length,
          recusados: recusados.length,
          taxaAprovacao: envios.length > 0 ? Math.round((aprovados.length / envios.length) * 100) : 0,
          volumeAprovado: aprovados.reduce((s, e) => s + (e.valorAprovado || 0), 0),
          tempoMedioResposta: tempoRespostas.length > 0 ? Math.round(tempoRespostas.reduce((a, b) => a + b, 0) / tempoRespostas.length) : null,
        },
      });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/norion/operations/:id/envios", async (req, res) => {
    try {
      const orgId = getOrgId();
      const operationId = Number(req.params.id);
      const envios = await storage.getNorionEnviosFundos(operationId, orgId);
      const enriched = await Promise.all(envios.map(async (e) => {
        const fundo = e.fundoParceiroId ? await storage.getNorionFundoParceiro(e.fundoParceiroId, orgId) : null;
        return { ...e, fundoParceiro: fundo };
      }));
      res.json(enriched);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/norion/operations/:id/envios", async (req, res) => {
    try {
      const orgId = getOrgId();
      const user = req.user as any;
      const operationId = Number(req.params.id);
      const { fundoParceiroId, observacoes } = req.body;
      if (!fundoParceiroId) return res.status(400).json({ message: "fundoParceiroId é obrigatório" });
      const [op] = await db.select().from(norionOperations).where(and(eq(norionOperations.id, operationId), eq(norionOperations.orgId, orgId)));
      if (!op) return res.status(404).json({ message: "Operação não encontrada" });
      const fundo = await storage.getNorionFundoParceiro(fundoParceiroId, orgId);
      if (!fundo) return res.status(404).json({ message: "Fundo parceiro não encontrado" });
      const envio = await storage.createNorionEnvioFundo({
        orgId, operationId, fundoParceiroId, status: "enviado", observacoes: observacoes || null,
      });
      if (["identificado", "diagnostico"].includes(op.stage)) {
        await db.update(norionOperations).set({ stage: "enviado_fundos", updatedAt: new Date() })
          .where(eq(norionOperations.id, operationId));
      }
      await audit({ orgId, userId: user?.id, userName: user?.username,
        entity: "norion_envio_fundo", entityId: envio.id, entityTitle: `Envio para ${fundo.nome}`,
        action: "created", changes: { operationId, fundoParceiroId } });
      res.json(envio);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.patch("/api/norion/envios/:id", async (req, res) => {
    try {
      const orgId = getOrgId();
      const user = req.user as any;
      const envioId = Number(req.params.id);
      const { status, valorAprovado, taxaJuros, prazoAprovado, motivoRecusa, observacoes } = req.body;
      const updateData: Record<string, any> = {};
      if (status) {
        updateData.status = status;
        if (["aprovado", "recusado"].includes(status)) updateData.dataResposta = new Date();
      }
      if (valorAprovado !== undefined) updateData.valorAprovado = valorAprovado;
      if (taxaJuros !== undefined) updateData.taxaJuros = taxaJuros;
      if (prazoAprovado !== undefined) updateData.prazoAprovado = prazoAprovado;
      if (motivoRecusa !== undefined) updateData.motivoRecusa = motivoRecusa;
      if (observacoes !== undefined) updateData.observacoes = observacoes;
      const updated = await storage.updateNorionEnvioFundo(envioId, orgId, updateData);
      if (!updated) return res.status(404).json({ message: "Envio não encontrado" });
      if (status === "aprovado" && updated.operationId && valorAprovado) {
        await db.update(norionOperations).set({ valorAprovado, stage: "aprovado", updatedAt: new Date() })
          .where(and(eq(norionOperations.id, updated.operationId), eq(norionOperations.orgId, orgId)));
      }
      await audit({ orgId, userId: user?.id, userName: user?.username,
        entity: "norion_envio_fundo", entityId: envioId, entityTitle: `Envio #${envioId}`,
        action: "updated", changes: updateData });
      res.json(updated);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.patch("/api/norion/companies/:id/caf", async (req, res) => {
    try {
      const orgId = getOrgId();
      const companyId = Number(req.params.id);
      const [company] = await db.select().from(companies).where(and(eq(companies.id, companyId), eq(companies.orgId, orgId)));
      if (!company) return res.status(404).json({ message: "Empresa não encontrada" });
      const currentEnrichment = (company.enrichmentData as any) || {};
      const cafData = req.body;
      const updated = { ...currentEnrichment, caf: cafData };
      const [result] = await db.update(companies).set({ enrichmentData: updated } as any).where(eq(companies.id, companyId)).returning();
      res.json(result);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.patch("/api/norion/companies/:id/socios-contato", async (req, res) => {
    try {
      const orgId = getOrgId();
      const companyId = Number(req.params.id);
      const [company] = await db.select().from(companies).where(and(eq(companies.id, companyId), eq(companies.orgId, orgId)));
      if (!company) return res.status(404).json({ message: "Empresa não encontrada" });
      const currentEnrichment = (company.enrichmentData as any) || {};
      const updated = { ...currentEnrichment, sociosContato: req.body.sociosContato };
      const [result] = await db.update(companies).set({ enrichmentData: updated } as any).where(eq(companies.id, companyId)).returning();
      res.json(result);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  const sicorCache = new Map<string, { data: any; expiry: number }>();
  const SICOR_CACHE_TTL = 24 * 60 * 60 * 1000;

  const sicorQueryCache = new Map<string, { data: any; expiry: number }>();

  app.get("/api/norion/sicor/consulta", async (req, res) => {
    try {
      const { uf, municipio, ano, tipo, top: topN } = req.query;
      if (!uf || typeof uf !== "string" || uf.length !== 2) {
        return res.status(400).json({ message: "Parâmetro 'uf' é obrigatório (sigla de 2 letras)" });
      }
      const limit = Math.min(Number(topN) || 100, 200);

      const cacheKey = `${uf||""}_${municipio||""}_${ano||""}_${tipo||""}_${limit}`;
      const cached = sicorQueryCache.get(cacheKey);
      if (cached && cached.expiry > Date.now()) return res.json(cached.data);

      const baseUrl = "https://olinda.bcb.gov.br/olinda/servico/SICOR/versao/v2/odata";
      const isCusteio = !tipo || tipo === "custeio";
      const hasMunicipio = municipio && typeof municipio === "string" && municipio.trim().length > 0;

      let rows: any[] = [];
      let totalContratos = 0;

      if (hasMunicipio) {
        const filters: string[] = ["cdPrograma eq '0001'"];
        const sanitizedMun = (municipio as string).toUpperCase().trim().replace(/'/g, "''");
        filters.push(`contains(Municipio,'${sanitizedMun}')`);
        if (ano && typeof ano === "string") filters.push(`AnoEmissao eq '${ano}'`);
        const filterStr = filters.join(" and ");
        const endpoint = isCusteio ? "CusteioMunicipioProduto" : "InvestMunicipioProduto";
        const valorField = isCusteio ? "VlCusteio" : "VlInvest";
        const areaField = isCusteio ? "AreaCusteio" : "AreaInvest";
        const url = `${baseUrl}/${endpoint}?$format=json&$filter=${encodeURIComponent(filterStr)}&$top=${limit}&$orderby=${valorField} desc`;

        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) return res.status(502).json({ message: "Falha ao consultar SICOR/BCB", status: response.status });
        const json = await response.json();
        rows = (json.value || []).map((r: any) => ({
          municipio: r.Municipio,
          produto: (r.nomeProduto || "").replace(/"/g, ""),
          mesEmissao: r.MesEmissao,
          anoEmissao: r.AnoEmissao,
          valor: r[valorField] || 0,
          area: r[areaField] || 0,
          qtdContratos: 1,
          codIbge: r.codIbge || r.cdMunicipio,
          atividade: r.Atividade === "1" ? "Agrícola" : r.Atividade === "2" ? "Pecuária" : "Outra",
          cdSubPrograma: r.cdSubPrograma,
        }));
        totalContratos = rows.length;
      } else {
        const filters: string[] = ["cdPrograma eq '0001'"];
        if (uf && typeof uf === "string") filters.push(`nomeUF eq '${uf.toUpperCase()}'`);
        if (ano && typeof ano === "string") filters.push(`AnoEmissao eq '${ano}'`);
        const filterStr = filters.join(" and ");
        const endpoint = isCusteio ? "CusteioRegiaoUFProduto" : "InvestRegiaoUFProduto";
        const valorField = isCusteio ? "VlCusteio" : "VlInvest";
        const qtdField = isCusteio ? "QtdCusteio" : "QtdInvest";
        const areaField = isCusteio ? "AreaCusteio" : "AreaInvest";
        const url = `${baseUrl}/${endpoint}?$format=json&$filter=${encodeURIComponent(filterStr)}&$top=${limit}&$orderby=${valorField} desc`;

        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) return res.status(502).json({ message: "Falha ao consultar SICOR/BCB", status: response.status });
        const json = await response.json();
        rows = (json.value || []).map((r: any) => ({
          municipio: r.nomeUF || "-",
          regiao: r.nomeRegiao,
          produto: (r.nomeProduto || "").replace(/"/g, ""),
          mesEmissao: r.MesEmissao,
          anoEmissao: r.AnoEmissao,
          valor: r[valorField] || 0,
          area: r[areaField] || 0,
          qtdContratos: r[qtdField] || 0,
          atividade: r.Atividade === "1" ? "Agrícola" : r.Atividade === "2" ? "Pecuária" : "Outra",
          cdSubPrograma: r.cdSubPrograma,
        }));
        totalContratos = rows.reduce((s: number, r: any) => s + (r.qtdContratos || 0), 0);
      }

      const totalValor = rows.reduce((s: number, r: any) => s + r.valor, 0);
      const totalArea = rows.reduce((s: number, r: any) => s + (r.area || 0), 0);

      const porMunicipio: Record<string, { valor: number; count: number; contratos: number }> = {};
      const porProduto: Record<string, { valor: number; count: number; contratos: number }> = {};
      rows.forEach((r: any) => {
        const mKey = r.municipio;
        if (!porMunicipio[mKey]) porMunicipio[mKey] = { valor: 0, count: 0, contratos: 0 };
        porMunicipio[mKey].valor += r.valor;
        porMunicipio[mKey].count += 1;
        porMunicipio[mKey].contratos += r.qtdContratos || 1;
        if (!porProduto[r.produto]) porProduto[r.produto] = { valor: 0, count: 0, contratos: 0 };
        porProduto[r.produto].valor += r.valor;
        porProduto[r.produto].count += 1;
        porProduto[r.produto].contratos += r.qtdContratos || 1;
      });

      const topMunicipios = Object.entries(porMunicipio)
        .sort((a, b) => b[1].valor - a[1].valor)
        .slice(0, 10)
        .map(([nome, d]) => ({ nome, ...d }));

      const topProdutos = Object.entries(porProduto)
        .sort((a, b) => b[1].valor - a[1].valor)
        .slice(0, 10)
        .map(([nome, d]) => ({ nome, ...d }));

      const result = {
        tipo: isCusteio ? "Custeio" : "Investimento",
        nivelConsulta: hasMunicipio ? "municipio" : "uf",
        totalRegistros: rows.length,
        totalContratos,
        totalValor,
        totalArea,
        topMunicipios,
        topProdutos,
        registros: rows,
        filtros: { uf, municipio, ano, tipo: isCusteio ? "custeio" : "investimento" },
        consultadoEm: new Date().toISOString(),
      };

      sicorQueryCache.set(cacheKey, { data: result, expiry: Date.now() + 60 * 60 * 1000 });
      res.json(result);
    } catch (err: any) {
      console.error("SICOR consulta error:", err);
      res.status(502).json({ message: "Falha ao consultar SICOR/BCB. A API do Banco Central pode estar instável.", detail: err.message });
    }
  });

  app.get("/api/norion/sicor/:codigoMunicipio", async (req, res) => {
    try {
      const codigo = req.params.codigoMunicipio;
      const cached = sicorCache.get(codigo);
      if (cached && cached.expiry > Date.now()) return res.json(cached.data);

      const baseUrl = "https://olinda.bcb.gov.br/olinda/servico/SICOR/versao/v2/odata";
      const custeioUrl = `${baseUrl}/CusteioMunicipioProduto?$format=json&$filter=CodigoMunicipio eq ${codigo}&$top=50&$orderby=ValorContratos desc`;
      const programaUrl = `${baseUrl}/ProgramaSubprograma?$format=json&$filter=contains(Programa,'PRONAF')&$top=20`;

      const [custeioRes, programaRes] = await Promise.all([
        fetch(custeioUrl).then(r => r.ok ? r.json() : { value: [] }),
        fetch(programaUrl).then(r => r.ok ? r.json() : { value: [] }),
      ]);

      const custeioData = custeioRes.value || [];
      const programaData = programaRes.value || [];

      const totalContratos = custeioData.reduce((sum: number, c: any) => sum + (c.QuantidadeContratos || 0), 0);
      const totalValor = custeioData.reduce((sum: number, c: any) => sum + (c.ValorContratos || 0), 0);
      const topProdutos = custeioData.slice(0, 5).map((c: any) => ({
        produto: c.Produto || c.NomeProduto || "Desconhecido",
        contratos: c.QuantidadeContratos || 0,
        valor: c.ValorContratos || 0,
      }));

      const result = {
        codigoMunicipio: codigo,
        totalContratos,
        totalValor,
        topProdutos,
        pronafResumo: programaData.slice(0, 10).map((p: any) => ({
          programa: p.Programa,
          subprograma: p.Subprograma,
          contratos: p.QuantidadeContratos || 0,
          valor: p.ValorContratos || 0,
        })),
        consultadoEm: new Date().toISOString(),
      };

      sicorCache.set(codigo, { data: result, expiry: Date.now() + SICOR_CACHE_TTL });
      res.json(result);
    } catch (err: any) {
      console.error("SICOR lookup error:", err);
      res.status(500).json({ message: "Falha ao consultar SICOR/BCB" });
    }
  });

  const PRONAF_LINHAS = [
    { id: 1, nome: "Pronaf Custeio - Alimentos Básicos", modalidade: "Custeio", taxa: 3, limite: 250000, prazoMaximo: "2 anos", gruposElegiveis: ["A/C", "B", "V"] },
    { id: 2, nome: "Pronaf Custeio - Sociobiodiversidade", modalidade: "Custeio", taxa: 2, limite: 250000, prazoMaximo: "2 anos", gruposElegiveis: ["A/C", "B", "V"] },
    { id: 3, nome: "Pronaf Custeio - Orgânico/Agroecológico", modalidade: "Custeio", taxa: 2, limite: 250000, prazoMaximo: "2 anos", gruposElegiveis: ["A/C", "B", "V"] },
    { id: 4, nome: "Pronaf A (Reforma Agrária)", modalidade: "Investimento", taxa: 0.5, limite: 52500, prazoMaximo: "10 anos + 3 carência", gruposElegiveis: ["A"] },
    { id: 5, nome: "Pronaf B (Microcrédito)", modalidade: "Investimento", taxa: 0.5, limite: 12000, prazoMaximo: "2 anos + 1 carência", gruposElegiveis: ["B"] },
    { id: 6, nome: "Pronaf Mais Alimentos - Máquinas Pequenas", modalidade: "Investimento", taxa: 2.5, limite: 100000, prazoMaximo: "7 anos + 3 carência", gruposElegiveis: ["V"] },
    { id: 7, nome: "Pronaf Mais Alimentos - Tratores e Máquinas", modalidade: "Investimento", taxa: 5, limite: 250000, prazoMaximo: "7 anos + 3 carência", gruposElegiveis: ["V"] },
    { id: 8, nome: "Pronaf Floresta", modalidade: "Investimento", taxa: 3, limite: 250000, prazoMaximo: "12 anos + 8 carência", gruposElegiveis: ["A", "A/C", "B", "V"] },
    { id: 9, nome: "Pronaf Semiárido", modalidade: "Investimento", taxa: 3, limite: 40000, prazoMaximo: "10 anos + 3 carência", gruposElegiveis: ["A", "A/C", "B", "V"] },
    { id: 10, nome: "Pronaf Mulher", modalidade: "Investimento", taxa: 3, limite: 250000, prazoMaximo: "10 anos + 3 carência", gruposElegiveis: ["A", "A/C", "B", "V"] },
    { id: 11, nome: "Pronaf Jovem (16-29 anos)", modalidade: "Investimento", taxa: 3, limite: 250000, prazoMaximo: "10 anos + 3 carência", gruposElegiveis: ["A", "A/C", "B", "V"] },
    { id: 12, nome: "Pronaf Agroecologia", modalidade: "Investimento", taxa: 3, limite: 250000, prazoMaximo: "10 anos + 3 carência", gruposElegiveis: ["A/C", "B", "V"] },
    { id: 13, nome: "Pronaf Bioeconomia", modalidade: "Investimento", taxa: 3, limite: 250000, prazoMaximo: "10 anos + 3 carência", gruposElegiveis: ["A/C", "B", "V"] },
    { id: 14, nome: "Pronaf Produtivo Orientado", modalidade: "Investimento", taxa: 3, limite: 250000, prazoMaximo: "10 anos + 3 carência", gruposElegiveis: ["V"] },
    { id: 15, nome: "Pronaf B Agroecologia", modalidade: "Investimento", taxa: 0.5, limite: 20000, prazoMaximo: "2 anos + 1 carência", gruposElegiveis: ["B"] },
  ];

  app.get("/api/norion/pronaf/linhas", async (req, res) => {
    try {
      const { grupo, renda } = req.query;
      let linhas = [...PRONAF_LINHAS];
      if (grupo && typeof grupo === "string") {
        linhas = linhas.filter(l => l.gruposElegiveis.includes(grupo));
      }
      if (renda && typeof renda === "string") {
        const rendaNum = parseFloat(renda);
        if (!isNaN(rendaNum)) {
          linhas = linhas.filter(l => l.limite >= rendaNum * 0.1);
        }
      }
      res.json(linhas);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/norion/operations/:id/matching-fundos", async (req, res) => {
    try {
      const orgId = getOrgId();
      const operationId = Number(req.params.id);
      const [op] = await db.select().from(norionOperations).where(and(eq(norionOperations.id, operationId), eq(norionOperations.orgId, orgId)));
      if (!op) return res.status(404).json({ message: "Operação não encontrada" });
      const fundos = await storage.getNorionFundosParceiros(orgId);
      const ativos = fundos.filter(f => f.ativo !== false);
      const diag = (op.diagnostico as any) || {};
      const valorSolicitado = diag.valorSolicitado || 0;
      const garantiasOp = (diag.garantias || []) as string[];
      const finalidade = (diag.finalidade || "") as string;

      const scored = ativos.map(f => {
        let score = 0;
        let reasons: string[] = [];

        if (f.tipoOperacao && f.tipoOperacao.length > 0 && finalidade) {
          if (f.tipoOperacao.some(t => t.toLowerCase() === finalidade.toLowerCase())) {
            score += 30;
            reasons.push("Tipo de operação compatível");
          }
        } else {
          score += 15;
        }

        if (valorSolicitado > 0) {
          const min = f.valorMinimo || 0;
          const max = f.valorMaximo || Infinity;
          if (valorSolicitado >= min && valorSolicitado <= max) {
            score += 30;
            reasons.push("Valor dentro da faixa");
          } else if (valorSolicitado >= min * 0.8 && valorSolicitado <= max * 1.2) {
            score += 15;
            reasons.push("Valor próximo da faixa");
          }
        } else {
          score += 15;
        }

        if (f.garantiasAceitas && f.garantiasAceitas.length > 0 && garantiasOp.length > 0) {
          const match = garantiasOp.filter(g => f.garantiasAceitas!.some(ga => ga.toLowerCase() === g.toLowerCase()));
          if (match.length > 0) {
            score += 25 * (match.length / garantiasOp.length);
            reasons.push(`Garantias compatíveis (${match.join(", ")})`);
          }
        } else {
          score += 12;
        }

        score += 15;
        reasons.push("Fundo ativo");

        return { fundo: f, score: Math.min(Math.round(score), 100), reasons };
      });

      scored.sort((a, b) => b.score - a.score);
      res.json(scored);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/norion/caf", async (req, res) => {
    try {
      const orgId = getOrgId();
      const { status, grupo, uf, search, areaMin, areaMax } = req.query;
      let conditions = [eq(norionCafRegistros.orgId, orgId)];
      if (status && typeof status === "string") conditions.push(eq(norionCafRegistros.status, status));
      if (grupo && typeof grupo === "string") conditions.push(eq(norionCafRegistros.grupo, grupo));
      if (uf && typeof uf === "string") conditions.push(eq(norionCafRegistros.uf, uf));
      if (areaMin && typeof areaMin === "string" && !isNaN(Number(areaMin))) conditions.push(gte(norionCafRegistros.areaHa, Number(areaMin)));
      if (areaMax && typeof areaMax === "string" && !isNaN(Number(areaMax))) conditions.push(lte(norionCafRegistros.areaHa, Number(areaMax)));
      
      let rows = await db.select().from(norionCafRegistros).where(and(...conditions)).orderBy(desc(norionCafRegistros.createdAt));
      
      if (search && typeof search === "string" && search.trim()) {
        const term = search.trim().toLowerCase();
        rows = rows.filter(r => 
          r.nomeTitular?.toLowerCase().includes(term) ||
          r.cpfTitular?.includes(term) ||
          r.numeroCAF?.toLowerCase().includes(term) ||
          r.municipio?.toLowerCase().includes(term)
        );
      }
      res.json(rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/norion/caf/exportar-csv", async (req, res) => {
    try {
      const orgId = getOrgId();
      const all = await db.select().from(norionCafRegistros).where(eq(norionCafRegistros.orgId, orgId)).orderBy(norionCafRegistros.nomeTitular);
      const headers = ["Nome Titular","CPF","Nº UFPA","Nº CAF","DAP Antigo","Grupo","Enquadramento PRONAF","Data Inscrição","Validade","Última Atualização","Município","UF","Área Imóvel (ha)","Total Estabelecimento (ha)","Total Estabelecimento (m³)","Nº Imóveis","Condição de Posse","Caracterização UFPA","Atividade Principal","Atividades Produtivas","Renda Bruta Anual","Composição Familiar","Entidade","CNPJ Entidade","Cadastrador","Status","Observações","Criado Em"];
      const csvRows = [headers.join(";")];
      for (const r of all) {
        const comp = Array.isArray(r.composicaoFamiliar) ? (r.composicaoFamiliar as any[]).map((m: any) => `${m.nome || ""}(${m.parentesco || ""})`).join(", ") : "";
        csvRows.push([
          r.nomeTitular || "",
          r.cpfTitular || "",
          r.numeroUFPA || "",
          r.numeroCAF || "",
          r.numeroDAPAntigo || "",
          r.grupo || "",
          r.enquadramentoPronaf || "",
          r.dataInscricao || "",
          r.validade || "",
          r.ultimaAtualizacao || "",
          r.municipio || "",
          r.uf || "",
          r.areaHa != null ? String(r.areaHa).replace(".", ",") : "",
          r.totalEstabelecimentoHa != null ? String(r.totalEstabelecimentoHa).replace(".", ",") : "",
          r.totalEstabelecimentoM3 != null ? String(r.totalEstabelecimentoM3).replace(".", ",") : "",
          r.numImoveis != null ? String(r.numImoveis) : "",
          r.condicaoPosse || "",
          r.caracterizacaoUfpa || "",
          r.atividadePrincipal || "",
          r.atividadesProdutivas || "",
          r.rendaBrutaAnual != null ? String(r.rendaBrutaAnual).replace(".", ",") : "",
          comp,
          r.entidadeNome || "",
          r.entidadeCnpj || "",
          r.cadastrador || "",
          r.status || "",
          (r.observacoes || "").replace(/[\n\r;]/g, " "),
          r.createdAt ? new Date(r.createdAt).toLocaleDateString("pt-BR") : "",
        ].map(v => `"${v}"`).join(";"));
      }
      const csvContent = "\uFEFF" + csvRows.join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="caf_registros_${new Date().toISOString().slice(0,10)}.csv"`);
      res.send(csvContent);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/norion/caf/stats", async (req, res) => {
    try {
      const orgId = getOrgId();
      const all = await db.select().from(norionCafRegistros).where(eq(norionCafRegistros.orgId, orgId));
      const total = all.length;
      const ativos = all.filter(r => r.status === "ativo").length;
      const vencidos = all.filter(r => r.status === "vencido").length;
      const porGrupo: Record<string, number> = {};
      const porUf: Record<string, number> = {};
      let totalArea = 0;
      let totalRenda = 0;
      all.forEach(r => {
        if (r.grupo) porGrupo[r.grupo] = (porGrupo[r.grupo] || 0) + 1;
        if (r.uf) porUf[r.uf] = (porUf[r.uf] || 0) + 1;
        if (r.areaHa) totalArea += r.areaHa;
        if (r.rendaBrutaAnual) totalRenda += r.rendaBrutaAnual;
      });
      res.json({ total, ativos, vencidos, porGrupo, porUf, totalArea, totalRenda });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/norion/caf/:id", async (req, res) => {
    try {
      const orgId = getOrgId();
      const [row] = await db.select().from(norionCafRegistros).where(and(eq(norionCafRegistros.id, Number(req.params.id)), eq(norionCafRegistros.orgId, orgId)));
      if (!row) return res.status(404).json({ message: "Registro CAF não encontrado" });
      res.json(row);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/norion/caf", async (req, res) => {
    try {
      const orgId = getOrgId();
      const data = { ...req.body, orgId };
      if (data.validade) {
        const v = new Date(data.validade);
        if (v < new Date()) data.status = "vencido";
      }
      const [row] = await db.insert(norionCafRegistros).values(data).returning();
      if (data.companyId) {
        const [company] = await db.select().from(companies).where(and(eq(companies.id, data.companyId), eq(companies.orgId, orgId)));
        if (company) {
          const enrichment = (company.enrichmentData as any) || {};
          enrichment.caf = {
            numeroCAF: data.numeroCAF,
            grupo: data.grupo,
            validade: data.validade,
            areaHa: data.areaHa,
            atividadesProdutivas: data.atividadesProdutivas,
            rendaBrutaAnual: data.rendaBrutaAnual,
          };
          await db.update(companies).set({ enrichmentData: enrichment } as any).where(eq(companies.id, data.companyId));
        }
      }
      res.json(row);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.patch("/api/norion/caf/:id", async (req, res) => {
    try {
      const orgId = getOrgId();
      const cafId = Number(req.params.id);
      const [existing] = await db.select().from(norionCafRegistros).where(and(eq(norionCafRegistros.id, cafId), eq(norionCafRegistros.orgId, orgId)));
      if (!existing) return res.status(404).json({ message: "Registro CAF não encontrado" });
      const updateData = { ...req.body, updatedAt: new Date() };
      if (updateData.validade) {
        const v = new Date(updateData.validade);
        if (v < new Date()) updateData.status = "vencido";
      }
      const [row] = await db.update(norionCafRegistros).set(updateData).where(eq(norionCafRegistros.id, cafId)).returning();
      if (row.companyId) {
        const [company] = await db.select().from(companies).where(and(eq(companies.id, row.companyId), eq(companies.orgId, orgId)));
        if (company) {
          const enrichment = (company.enrichmentData as any) || {};
          enrichment.caf = {
            numeroCAF: row.numeroCAF,
            grupo: row.grupo,
            validade: row.validade,
            areaHa: row.areaHa,
            atividadesProdutivas: row.atividadesProdutivas,
            rendaBrutaAnual: row.rendaBrutaAnual,
          };
          await db.update(companies).set({ enrichmentData: enrichment } as any).where(eq(companies.id, row.companyId));
        }
      }
      res.json(row);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/norion/caf/:id", async (req, res) => {
    try {
      const orgId = getOrgId();
      const cafId = Number(req.params.id);
      const [existing] = await db.select().from(norionCafRegistros).where(and(eq(norionCafRegistros.id, cafId), eq(norionCafRegistros.orgId, orgId)));
      if (!existing) return res.status(404).json({ message: "Registro CAF não encontrado" });
      await db.delete(norionCafRegistros).where(eq(norionCafRegistros.id, cafId));
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/norion/caf/importar-csv", async (req, res) => {
    try {
      const orgId = getOrgId();
      const { registros } = req.body;
      if (!Array.isArray(registros) || registros.length === 0) {
        return res.status(400).json({ message: "Envie um array 'registros'" });
      }
      const inserted: any[] = [];
      for (const r of registros) {
        const data = {
          orgId,
          nomeTitular: r.nomeTitular || r.nome || r.NOME || "",
          cpfTitular: r.cpfTitular || r.cpf || r.CPF || null,
          numeroCAF: r.numeroCAF || r.caf || r.CAF || null,
          numeroDAPAntigo: r.numeroDAPAntigo || r.dap || r.DAP || null,
          grupo: r.grupo || r.GRUPO || null,
          validade: r.validade || r.VALIDADE || null,
          municipio: r.municipio || r.MUNICIPIO || null,
          uf: r.uf || r.UF || null,
          codigoMunicipio: r.codigoMunicipio || null,
          areaHa: r.areaHa ? parseFloat(String(r.areaHa)) : null,
          atividadesProdutivas: r.atividadesProdutivas || r.atividades || null,
          rendaBrutaAnual: r.rendaBrutaAnual || r.renda ? parseFloat(String(r.rendaBrutaAnual || r.renda)) : null,
          status: "ativo" as const,
        };
        if (!data.nomeTitular) continue;
        if (data.validade && new Date(data.validade) < new Date()) data.status = "vencido" as any;
        const [row] = await db.insert(norionCafRegistros).values(data).returning();
        inserted.push(row);
      }
      res.json({ importados: inserted.length, registros: inserted });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/norion/caf/consulta-dap/:cpf", async (req, res) => {
    try {
      const cpf = req.params.cpf.replace(/\D/g, "");
      if (cpf.length !== 11) return res.status(400).json({ message: "CPF inválido" });
      const dapUrl = `https://dap.mda.gov.br/publico/dap/consulta/${cpf}`;
      const response = await fetch(dapUrl, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html,application/json" },
        signal: AbortSignal.timeout(10000),
      }).catch(() => null);
      if (!response || !response.ok) {
        return res.json({
          encontrado: false,
          mensagem: "Consulta automática não disponível. Use o portal para consulta manual.",
          portalUrl: "https://caf.mda.gov.br/",
          dapPortalUrl: "https://dap.mda.gov.br/",
          cpf,
        });
      }
      const text = await response.text();
      const hasData = text.includes("DAP") || text.includes("dap") || text.includes("Cadastro");
      res.json({
        encontrado: hasData,
        mensagem: hasData ? "Dados encontrados no portal DAP" : "Nenhum registro DAP encontrado para este CPF",
        portalUrl: "https://caf.mda.gov.br/",
        dapPortalUrl: `https://dap.mda.gov.br/`,
        cpf,
      });
    } catch (err: any) {
      res.json({
        encontrado: false,
        mensagem: "Consulta automática indisponível. Utilize o portal oficial.",
        portalUrl: "https://caf.mda.gov.br/",
        dapPortalUrl: "https://dap.mda.gov.br/",
      });
    }
  });

}
