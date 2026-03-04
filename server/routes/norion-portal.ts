import type { Express } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and, or, inArray } from "drizzle-orm";
import { norionClientUsers, norionOperations, norionDocuments, norionFormularioCliente, norionFundosParceiros, companies } from "@shared/schema";
import { getOrgId } from "../lib/tenant";
import { uploadToDrive } from "../google-drive";
import { CHECKLIST_HOME_EQUITY } from "./norion";
import { storage } from "../storage";
import { audit } from "../audit";
import crypto from "crypto";

export function registerNorionPortalRoutes(app: Express, db: NodePgDatabase<any>) {

  app.post("/api/norion-portal/login", async (req, res) => {
    try {
      const { taxId, accessToken } = req.body;
      if (!taxId || !accessToken) return res.status(400).json({ message: "CPF/CNPJ e token são obrigatórios" });

      const cleanTaxId = taxId.replace(/\D/g, "");
      const [clientUser] = await db.select().from(norionClientUsers)
        .where(and(eq(norionClientUsers.taxId, cleanTaxId), eq(norionClientUsers.accessToken, accessToken)));

      if (!clientUser) return res.status(401).json({ message: "Credenciais inválidas" });

      if (clientUser.tokenExpiresAt && new Date(clientUser.tokenExpiresAt) < new Date()) {
        return res.status(401).json({ message: "Token expirado. Solicite um novo acesso ao consultor." });
      }

      res.json({
        sessionToken: clientUser.accessToken,
        client: {
          id: clientUser.id,
          name: clientUser.name,
          taxId: clientUser.taxId,
          email: clientUser.email,
          phone: clientUser.phone,
          operationId: clientUser.operationId,
        },
      });
    } catch (err: any) {
      console.error("Portal login error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  const portalAuth = async (req: any, res: any, next: any) => {
    const clientId = req.headers["x-portal-client-id"];
    const token = req.headers["x-portal-token"];
    if (!clientId || !token) return res.status(401).json({ message: "Acesso não autorizado" });

    const [clientUser] = await db.select().from(norionClientUsers)
      .where(and(eq(norionClientUsers.id, Number(clientId)), eq(norionClientUsers.accessToken, String(token))));

    if (!clientUser) return res.status(401).json({ message: "Credenciais inválidas" });
    if (clientUser.tokenExpiresAt && new Date(clientUser.tokenExpiresAt) < new Date()) {
      return res.status(401).json({ message: "Token expirado" });
    }
    req.portalClient = clientUser;
    next();
  };

  app.get("/api/norion-portal/me", portalAuth, async (req: any, res) => {
    try {
      const client = req.portalClient;
      let operation = null;
      let company = null;
      if (client.operationId) {
        const [op] = await db.select().from(norionOperations).where(eq(norionOperations.id, client.operationId));
        operation = op || null;
        if (op?.companyId) {
          const [comp] = await db.select().from(companies).where(eq(companies.id, op.companyId));
          company = comp || null;
        }
      }
      res.json({ client, operation, company });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/norion-portal/documentos", portalAuth, async (req: any, res) => {
    try {
      const client = req.portalClient;
      const orgId = client.orgId;

      const conditions = [eq(norionDocuments.orgId, orgId)];

      if (client.operationId) {
        conditions.push(eq(norionDocuments.operationId, client.operationId));
      } else {
        conditions.push(eq(norionDocuments.clientUserId, client.id));
      }

      const docs = await db.select().from(norionDocuments)
        .where(and(...conditions));

      if (docs.length === 0 && !client.operationId) {
        const existing = await db.select().from(norionDocuments)
          .where(and(eq(norionDocuments.clientUserId, client.id), eq(norionDocuments.orgId, orgId)));

        if (existing.length === 0) {
          const newDocs = CHECKLIST_HOME_EQUITY.map(item => ({
            orgId,
            clientUserId: client.id,
            operationId: null as any,
            categoria: item.categoria,
            tipoDocumento: item.tipoDocumento,
            nome: item.nome,
            obrigatorio: item.obrigatorio,
            status: "pendente",
          }));

          const inserted = await db.insert(norionDocuments).values(newDocs).returning();
          return res.json(inserted);
        }
      }

      res.json(docs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/norion-portal/documentos/:id/upload", portalAuth, async (req: any, res) => {
    try {
      const client = req.portalClient;
      const docId = Number(req.params.id);
      const { fileBase64, fileName, mimeType } = req.body;

      if (!fileBase64 || !fileName) return res.status(400).json({ message: "fileBase64 e fileName são obrigatórios" });

      const docConditions = [
        eq(norionDocuments.id, docId),
        eq(norionDocuments.orgId, client.orgId),
      ];

      if (client.operationId) {
        docConditions.push(eq(norionDocuments.operationId, client.operationId));
      } else {
        docConditions.push(eq(norionDocuments.clientUserId, client.id));
      }

      const [doc] = await db.select().from(norionDocuments)
        .where(and(...docConditions));
      if (!doc) return res.status(404).json({ message: "Documento não encontrado" });

      let companyName = client.name || client.taxId || "Cliente";
      if (client.operationId) {
        const [op] = await db.select().from(norionOperations).where(eq(norionOperations.id, client.operationId));
        if (op?.companyId) {
          const [comp] = await db.select().from(companies).where(eq(companies.id, op.companyId));
          if (comp) companyName = (comp.tradeName || comp.legalName || "Empresa").replace(/[^a-zA-Z0-9_\- ]/g, "");
        }
      } else {
        companyName = (client.name || client.taxId || "Cliente").replace(/[^a-zA-Z0-9_\- ]/g, "");
      }

      const fileBuffer = Buffer.from(fileBase64, "base64");
      const result = await uploadToDrive(fileBuffer, fileName, mimeType || "application/pdf", ["Mavrion Conect", "Norion", "Portal Cliente", companyName]);

      const [updated] = await db.update(norionDocuments)
        .set({
          driveFileId: result.fileId,
          driveFileUrl: result.fileUrl,
          nomeArquivo: fileName,
          status: "enviado",
        })
        .where(eq(norionDocuments.id, docId))
        .returning();

      res.json(updated);
    } catch (err: any) {
      console.error("Portal upload error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/norion-portal/cep/:cep", async (req, res) => {
    try {
      const cep = req.params.cep.replace(/\D/g, "");
      if (cep.length !== 8) return res.status(400).json({ message: "CEP inválido" });

      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await response.json();
      if ((data as any).erro) return res.status(404).json({ message: "CEP não encontrado" });
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/norion-portal/cnpj/:cnpj", async (req, res) => {
    try {
      const cnpj = req.params.cnpj.replace(/\D/g, "");
      if (cnpj.length !== 14) return res.status(400).json({ message: "CNPJ inválido" });

      const apiKey = process.env.CNPJA_API_KEY;
      if (!apiKey) return res.status(503).json({ message: "API CNPJ não configurada" });

      const response = await fetch(`https://api.cnpja.com/office/${cnpj}?strategy=CACHE_IF_FRESH&maxAge=30`, {
        headers: { "Authorization": apiKey },
      });
      if (!response.ok) return res.status(response.status).json({ message: "Erro ao consultar CNPJ" });
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/norion/operations/:id/gerar-acesso-cliente", async (req, res) => {
    try {
      const orgId = getOrgId();
      const opId = Number(req.params.id);
      const { taxId, name, email, phone } = req.body;

      if (!taxId) return res.status(400).json({ message: "CPF/CNPJ é obrigatório" });
      const cleanTaxId = taxId.replace(/\D/g, "");

      const [op] = await db.select().from(norionOperations).where(and(
        eq(norionOperations.id, opId),
        eq(norionOperations.orgId, orgId)
      ));
      if (!op) return res.status(404).json({ message: "Operação não encontrada" });

      const [existing] = await db.select().from(norionClientUsers)
        .where(and(eq(norionClientUsers.operationId, opId), eq(norionClientUsers.orgId, orgId)));

      const accessToken = crypto.randomBytes(16).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      if (existing) {
        const [updated] = await db.update(norionClientUsers)
          .set({
            taxId: cleanTaxId,
            name: name || existing.name,
            email: email || existing.email,
            phone: phone || existing.phone,
            accessToken,
            tokenExpiresAt: expiresAt,
          })
          .where(eq(norionClientUsers.id, existing.id))
          .returning();

        return res.json({
          clientUser: updated,
          portalUrl: `/portal-cliente?token=${accessToken}&taxId=${cleanTaxId}`,
        });
      }

      const [clientUser] = await db.insert(norionClientUsers).values({
        orgId,
        taxId: cleanTaxId,
        name: name || null,
        email: email || null,
        phone: phone || null,
        operationId: opId,
        accessToken,
        tokenExpiresAt: expiresAt,
      }).returning();

      res.json({
        clientUser,
        portalUrl: `/portal-cliente?token=${accessToken}&taxId=${cleanTaxId}`,
      });
    } catch (err: any) {
      console.error("Gerar acesso cliente error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/norion/operations/:id/acesso-cliente", async (req, res) => {
    try {
      const orgId = getOrgId();
      const opId = Number(req.params.id);

      const [clientUser] = await db.select().from(norionClientUsers)
        .where(and(eq(norionClientUsers.operationId, opId), eq(norionClientUsers.orgId, orgId)));

      if (!clientUser) return res.json({ exists: false });

      res.json({
        exists: true,
        clientUser,
        portalUrl: `/portal-cliente?token=${clientUser.accessToken}&taxId=${clientUser.taxId}`,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/norion/gerar-acesso-avulso", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autorizado" });
    try {
      const orgId = getOrgId();
      const { taxId, name, email, phone } = req.body;

      if (!taxId) return res.status(400).json({ message: "CPF/CNPJ é obrigatório" });
      const cleanTaxId = taxId.replace(/\D/g, "");
      if (cleanTaxId.length !== 11 && cleanTaxId.length !== 14) {
        return res.status(400).json({ message: "CPF ou CNPJ inválido" });
      }

      const [existing] = await db.select().from(norionClientUsers)
        .where(and(eq(norionClientUsers.taxId, cleanTaxId), eq(norionClientUsers.orgId, orgId)));

      const accessToken = crypto.randomBytes(16).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      if (existing) {
        const [updated] = await db.update(norionClientUsers)
          .set({
            name: name || existing.name,
            email: email || existing.email,
            phone: phone || existing.phone,
            accessToken,
            tokenExpiresAt: expiresAt,
          })
          .where(eq(norionClientUsers.id, existing.id))
          .returning();

        return res.json({
          clientUser: updated,
          portalUrl: `/portal-cliente`,
          loginTaxId: cleanTaxId,
        });
      }

      const [clientUser] = await db.insert(norionClientUsers).values({
        orgId,
        taxId: cleanTaxId,
        name: name || null,
        email: email || null,
        phone: phone || null,
        operationId: null,
        accessToken,
        tokenExpiresAt: expiresAt,
      }).returning();

      res.json({
        clientUser,
        portalUrl: `/portal-cliente`,
        loginTaxId: cleanTaxId,
      });
    } catch (err: any) {
      console.error("Gerar acesso avulso error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/norion/clientes-portal", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autorizado" });
    try {
      const orgId = getOrgId();
      const clients = await db.select().from(norionClientUsers)
        .where(eq(norionClientUsers.orgId, orgId));
      res.json(clients);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/norion-portal/login-cpf", async (req, res) => {
    try {
      const { taxId } = req.body;
      if (!taxId) return res.status(400).json({ message: "CPF/CNPJ é obrigatório" });

      const cleanTaxId = taxId.replace(/\D/g, "");
      if (cleanTaxId.length !== 11 && cleanTaxId.length !== 14) {
        return res.status(400).json({ message: "CPF ou CNPJ inválido" });
      }

      const [clientUser] = await db.select().from(norionClientUsers)
        .where(eq(norionClientUsers.taxId, cleanTaxId));

      if (!clientUser) return res.status(404).json({ message: "CPF/CNPJ não cadastrado. Entre em contato com seu consultor." });

      res.json({
        sessionToken: clientUser.accessToken,
        client: {
          id: clientUser.id,
          name: clientUser.name,
          taxId: clientUser.taxId,
          email: clientUser.email,
          phone: clientUser.phone,
          operationId: clientUser.operationId,
        },
      });
    } catch (err: any) {
      console.error("Portal login-cpf error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/norion-portal/formulario", portalAuth, async (req: any, res) => {
    try {
      const client = req.portalClient;
      const [existing] = await db.select().from(norionFormularioCliente)
        .where(eq(norionFormularioCliente.clientUserId, client.id));

      if (existing) return res.json(existing);

      const [created] = await db.insert(norionFormularioCliente).values({
        orgId: client.orgId,
        operationId: client.operationId || null,
        clientUserId: client.id,
        cpf: client.taxId,
        nomeCompleto: client.name || null,
        email: client.email || null,
        telefone: client.phone || null,
      }).returning();

      res.json(created);
    } catch (err: any) {
      console.error("GET formulario error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/norion-portal/formulario", portalAuth, async (req: any, res) => {
    try {
      const client = req.portalClient;
      const [existing] = await db.select().from(norionFormularioCliente)
        .where(eq(norionFormularioCliente.clientUserId, client.id));

      if (!existing) return res.status(404).json({ message: "Formulário não encontrado" });

      if (existing.status === "enviado" || existing.status === "aprovado") {
        return res.status(403).json({ message: "Formulário já enviado. Não é possível editar." });
      }

      const allowedFields = [
        "nomeCompleto", "cpf", "rg", "dataNascimento", "estadoCivil", "naturalidade", "nomeMae",
        "email", "telefone", "celular", "cep", "logradouro", "numero", "complemento", "bairro",
        "cidade", "uf", "profissao", "empresaTrabalho", "cnpjEmpresa", "rendaMensal", "tempoEmprego",
        "outrasRendas", "valorSolicitado", "finalidadeCredito", "prazoDesejado", "tipoGarantia",
        "descricaoGarantia", "valorGarantia", "possuiImovel", "valorImovel", "possuiVeiculo",
        "valorVeiculo", "outrosPatrimonios", "currentStep", "dadosExtras",
      ];

      const updateData: any = { updatedAt: new Date() };
      for (const key of allowedFields) {
        if (req.body[key] !== undefined) {
          updateData[key] = req.body[key];
        }
      }

      if (existing.status === "em_revisao") {
        updateData.status = "rascunho";
        updateData.observacaoRevisao = null;
      }

      const [updated] = await db.update(norionFormularioCliente)
        .set(updateData)
        .where(eq(norionFormularioCliente.id, existing.id))
        .returning();

      res.json(updated);
    } catch (err: any) {
      console.error("PATCH formulario error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/norion-portal/formulario/finalizar", portalAuth, async (req: any, res) => {
    try {
      const client = req.portalClient;
      const [existing] = await db.select().from(norionFormularioCliente)
        .where(eq(norionFormularioCliente.clientUserId, client.id));

      if (!existing) return res.status(404).json({ message: "Formulário não encontrado" });

      if (existing.status === "enviado" || existing.status === "aprovado") {
        return res.status(403).json({ message: "Formulário já foi enviado." });
      }

      const [updated] = await db.update(norionFormularioCliente)
        .set({ status: "enviado", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(norionFormularioCliente.id, existing.id))
        .returning();

      res.json(updated);
    } catch (err: any) {
      console.error("POST finalizar error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  const requireAdminAuth = (req: any, res: any, next: any) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    next();
  };

  app.get("/api/norion/formularios-pendentes", requireAdminAuth, async (req, res) => {
    try {
      const formularios = await db.select().from(norionFormularioCliente)
        .where(inArray(norionFormularioCliente.status, ["enviado", "em_revisao", "aprovado"]));

      const results = [];
      for (const f of formularios) {
        let clientUser = null;
        let docs: any[] = [];
        if (f.clientUserId) {
          const [cu] = await db.select().from(norionClientUsers).where(eq(norionClientUsers.id, f.clientUserId));
          clientUser = cu || null;
        }
        if (f.operationId) {
          docs = await db.select().from(norionDocuments).where(eq(norionDocuments.operationId, f.operationId));
        } else if (f.clientUserId) {
          docs = await db.select().from(norionDocuments).where(eq(norionDocuments.clientUserId, f.clientUserId));
        }
        results.push({ ...f, clientUser, documentos: docs });
      }
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/norion/formulario/:id", requireAdminAuth, async (req, res) => {
    try {
      const fId = Number(req.params.id);
      const [f] = await db.select().from(norionFormularioCliente).where(eq(norionFormularioCliente.id, fId));
      if (!f) return res.status(404).json({ message: "Formulário não encontrado" });

      let clientUser = null;
      let docs: any[] = [];
      if (f.clientUserId) {
        const [cu] = await db.select().from(norionClientUsers).where(eq(norionClientUsers.id, f.clientUserId));
        clientUser = cu || null;
      }
      if (f.operationId) {
        docs = await db.select().from(norionDocuments).where(eq(norionDocuments.operationId, f.operationId));
      } else if (f.clientUserId) {
        docs = await db.select().from(norionDocuments).where(eq(norionDocuments.clientUserId, f.clientUserId));
      }
      res.json({ ...f, clientUser, documentos: docs });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/norion/formulario/:id/revisar", requireAdminAuth, async (req, res) => {
    try {
      const fId = Number(req.params.id);
      const { observacao } = req.body;
      if (!observacao) return res.status(400).json({ message: "Informe o motivo da revisão" });

      const [updated] = await db.update(norionFormularioCliente)
        .set({ status: "em_revisao", observacaoRevisao: observacao, updatedAt: new Date() })
        .where(eq(norionFormularioCliente.id, fId))
        .returning();

      if (!updated) return res.status(404).json({ message: "Formulário não encontrado" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/norion/formulario/:id/aprovar", requireAdminAuth, async (req, res) => {
    try {
      const fId = Number(req.params.id);
      const [updated] = await db.update(norionFormularioCliente)
        .set({ status: "aprovado", observacaoRevisao: null, updatedAt: new Date() })
        .where(eq(norionFormularioCliente.id, fId))
        .returning();

      if (!updated) return res.status(404).json({ message: "Formulário não encontrado" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/norion/formulario/:id/criar-operacao", requireAdminAuth, async (req: any, res) => {
    try {
      const orgId = getOrgId();
      const user = req.user as any;
      const fId = Number(req.params.id);

      const [formulario] = await db.select().from(norionFormularioCliente)
        .where(and(eq(norionFormularioCliente.id, fId), eq(norionFormularioCliente.orgId, orgId)));
      if (!formulario) return res.status(404).json({ message: "Formulário não encontrado" });
      if (formulario.status !== "aprovado") return res.status(400).json({ message: "Formulário precisa estar aprovado" });
      if (formulario.operationId) return res.status(400).json({ message: "Já existe uma operação vinculada a este formulário" });

      let companyId: number | null = null;
      const taxId = (formulario.cnpjEmpresa || formulario.cpf || "").replace(/\D/g, "");

      if (taxId && taxId.length === 14) {
        const [existing] = await db.select().from(companies)
          .where(and(eq(companies.cnpj, taxId), eq(companies.orgId, orgId)));

        if (existing) {
          companyId = existing.id;
        } else {
          const [newCompany] = await db.insert(companies).values({
            orgId,
            legalName: formulario.empresaTrabalho || formulario.nomeCompleto || "Empresa",
            tradeName: formulario.empresaTrabalho || null,
            cnpj: taxId,
            address: {
              zip: formulario.cep, street: formulario.logradouro, number: formulario.numero,
              details: formulario.complemento, district: formulario.bairro,
              city: formulario.cidade, state: formulario.uf,
            },
          }).returning();
          companyId = newCompany.id;
        }
      } else if (taxId && taxId.length === 11) {
        const [existing] = await db.select().from(companies)
          .where(and(eq(companies.legalName, formulario.nomeCompleto || "PF"), eq(companies.orgId, orgId)));

        if (existing) {
          companyId = existing.id;
        } else {
          const [newCompany] = await db.insert(companies).values({
            orgId,
            legalName: formulario.nomeCompleto || "Pessoa Física",
            tradeName: formulario.nomeCompleto || null,
            notes: `CPF: ${taxId}`,
            address: {
              zip: formulario.cep, street: formulario.logradouro, number: formulario.numero,
              details: formulario.complemento, district: formulario.bairro,
              city: formulario.cidade, state: formulario.uf,
            },
          }).returning();
          companyId = newCompany.id;
        }
      }

      if (!companyId) return res.status(400).json({ message: "Não foi possível identificar empresa/pessoa do formulário" });

      const garantias: string[] = [];
      if (formulario.tipoGarantia) garantias.push(formulario.tipoGarantia);
      if (formulario.possuiImovel) garantias.push("imovel");
      if (formulario.possuiVeiculo) garantias.push("veiculo");

      const diagnostico = {
        valorSolicitado: formulario.valorSolicitado || 0,
        finalidade: formulario.finalidadeCredito || "",
        prazo: formulario.prazoDesejado || "",
        garantias,
        descricaoGarantia: formulario.descricaoGarantia || "",
        valorGarantia: formulario.valorGarantia || 0,
        rendaMensal: formulario.rendaMensal || 0,
        origem: "portal_cliente",
      };

      const [op] = await db.insert(norionOperations).values({
        orgId,
        companyId,
        ownerUserId: user?.id,
        stage: "diagnostico",
        diagnostico,
        observacoesInternas: `Operação criada a partir do formulário #${formulario.id} (Portal Cliente)`,
      }).returning();

      await audit({
        orgId, userId: user?.id, userName: user?.username,
        entity: "norion_operation", entityId: op.id, entityTitle: formulario.nomeCompleto || "Portal",
        action: "created", changes: { stage: { from: null, to: op.stage }, origem: "portal_cliente" },
      });

      if (formulario.clientUserId) {
        const clientDocs = await db.select().from(norionDocuments)
          .where(and(eq(norionDocuments.clientUserId, formulario.clientUserId), eq(norionDocuments.orgId, orgId)));

        if (clientDocs.length > 0) {
          for (const doc of clientDocs) {
            await db.update(norionDocuments)
              .set({ operationId: op.id })
              .where(eq(norionDocuments.id, doc.id));
          }
        } else {
          for (const item of CHECKLIST_HOME_EQUITY) {
            await storage.createNorionDocument({
              orgId, operationId: op.id,
              categoria: item.categoria, tipoDocumento: item.tipoDocumento,
              nome: item.nome, status: "pendente", obrigatorio: item.obrigatorio,
            });
          }
        }

        await db.update(norionClientUsers)
          .set({ operationId: op.id })
          .where(eq(norionClientUsers.id, formulario.clientUserId));
      } else {
        for (const item of CHECKLIST_HOME_EQUITY) {
          await storage.createNorionDocument({
            orgId, operationId: op.id,
            categoria: item.categoria, tipoDocumento: item.tipoDocumento,
            nome: item.nome, status: "pendente", obrigatorio: item.obrigatorio,
          });
        }
      }

      await db.update(norionFormularioCliente)
        .set({ operationId: op.id, updatedAt: new Date() })
        .where(eq(norionFormularioCliente.id, fId));

      const fundos = await storage.getNorionFundosParceiros(orgId);
      const ativos = fundos.filter(f => f.ativo !== false);
      const diag = diagnostico;

      const scored = ativos.map(f => {
        let score = 0;
        let reasons: string[] = [];

        if (f.tipoOperacao && f.tipoOperacao.length > 0 && diag.finalidade) {
          if (f.tipoOperacao.some(t => t.toLowerCase() === diag.finalidade.toLowerCase())) {
            score += 30;
            reasons.push("Tipo de operação compatível");
          }
        } else {
          score += 15;
        }

        if (diag.valorSolicitado > 0) {
          const min = f.valorMinimo || 0;
          const max = f.valorMaximo || Infinity;
          if (diag.valorSolicitado >= min && diag.valorSolicitado <= max) {
            score += 30;
            reasons.push("Valor dentro da faixa");
          } else if (diag.valorSolicitado >= min * 0.8 && diag.valorSolicitado <= max * 1.2) {
            score += 15;
            reasons.push("Valor próximo da faixa");
          }
        } else {
          score += 15;
        }

        if (f.garantiasAceitas && f.garantiasAceitas.length > 0 && garantias.length > 0) {
          const match = garantias.filter(g => f.garantiasAceitas!.some(ga => ga.toLowerCase() === g.toLowerCase()));
          if (match.length > 0) {
            score += 25 * (match.length / garantias.length);
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
      const topMatches = scored.slice(0, 5);

      res.json({
        operation: op,
        companyId,
        matching: topMatches,
      });
    } catch (err: any) {
      console.error("Criar operação a partir de formulário error:", err);
      res.status(500).json({ message: err.message });
    }
  });
}
