import type { Express } from "express";
import type { IStorage } from "../storage";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { companies, assets, investorProfiles } from "@shared/schema";
import { eq } from "drizzle-orm";
import { uploadToDrive, testDriveConnection } from "../lib/google-drive";
import { getOrgId } from "../lib/tenant";

export function registerCommercialRoutes(app: Express, storage: IStorage, db: NodePgDatabase<any>) {
  app.get("/api/proposals/templates", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const templates = await storage.getProposalTemplates(getOrgId());
      res.json(templates);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.get("/api/proposals/templates/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const template = await storage.getProposalTemplate(Number(req.params.id));
      if (!template) return res.status(404).json({ message: "Template não encontrado" });
      res.json(template);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.post("/api/proposals/templates", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { name, type, bodyHtml, bodyJson } = req.body;
      if (!name || !type) return res.status(400).json({ message: "name e type são obrigatórios" });
      const template = await storage.createProposalTemplate({ orgId: getOrgId(), name, type, bodyHtml, bodyJson });
      res.status(201).json(template);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.put("/api/proposals/templates/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const updated = await storage.updateProposalTemplate(Number(req.params.id), req.body);
      res.json(updated);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.delete("/api/proposals/templates/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      await storage.deleteProposalTemplate(Number(req.params.id));
      res.status(204).end();
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.get("/api/proposals", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const all = await storage.getProposals(getOrgId());
      res.json(all);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.post("/api/proposals", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { templateId, name, type, companyId, dealId, assetId, investorProfileId } = req.body;
      if (!name || !type) return res.status(400).json({ message: "name e type são obrigatórios" });

      const template = templateId ? await storage.getProposalTemplate(Number(templateId)) : null;
      let filledHtml = template?.bodyHtml || "";

      const vars: Record<string, string> = {
        "data.hoje": new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }),
        "data.mes_ano": new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
      };

      if (companyId) {
        const c = await db.select().from(companies).where(eq(companies.id, Number(companyId)));
        if (c[0]) {
          const addr = c[0].address as any;
          vars["empresa.nome"] = c[0].tradeName || c[0].legalName;
          vars["empresa.razao_social"] = c[0].legalName;
          vars["empresa.cnpj"] = c[0].cnpj ? c[0].cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : "";
          vars["empresa.cidade"] = addr?.city || "";
          vars["empresa.estado"] = addr?.state || "";
          vars["empresa.porte"] = c[0].porte || "";
          vars["empresa.website"] = c[0].website || "";
          vars["empresa.cnae_principal"] = c[0].cnaePrincipal || "";
          vars["empresa.telefone"] = ((c[0].phones as string[]) || [])[0] || "";
          vars["empresa.email"] = ((c[0].emails as string[]) || [])[0] || "";
        }
      }

      if (assetId) {
        const a = await storage.getAsset(Number(assetId));
        if (a) {
          vars["ativo.titulo"] = a.title;
          vars["ativo.tipo"] = a.type;
          vars["ativo.preco"] = a.priceAsking ? `R$ ${a.priceAsking.toLocaleString("pt-BR")}` : "";
          vars["ativo.area_ha"] = a.areaHa ? `${a.areaHa.toLocaleString("pt-BR")} ha` : "";
          vars["ativo.localizacao"] = a.location || a.municipio || "";
          vars["ativo.matricula"] = a.matricula || "";
          vars["ativo.observacoes"] = a.observacoes || "";
        }
      }

      if (investorProfileId) {
        const inv = await storage.getInvestor(Number(investorProfileId));
        if (inv) {
          vars["investidor.nome"] = inv.name;
          vars["investidor.ticket_min"] = inv.ticketMin ? `R$ ${inv.ticketMin.toLocaleString("pt-BR")}` : "";
          vars["investidor.ticket_max"] = inv.ticketMax ? `R$ ${inv.ticketMax.toLocaleString("pt-BR")}` : "";
          vars["investidor.regioes"] = ((inv.regionsOfInterest as string[]) || []).join(", ");
          vars["investidor.tipos_ativos"] = ((inv.assetTypes as string[]) || []).join(", ");
        }
      }

      const logoSetting = await storage.getOrgSetting(getOrgId(), "logo_url");
      vars["minha_empresa.logo"] = logoSetting?.value as string || "";
      const nameSetting = await storage.getOrgSetting(getOrgId(), "company_name");
      vars["minha_empresa.nome"] = nameSetting?.value as string || "Minha Empresa";

      for (const [key, val] of Object.entries(vars)) {
        filledHtml = filledHtml.replaceAll(`{{${key}}}`, val);
      }

      const proposal = await storage.createProposal({
        orgId: getOrgId(), templateId: templateId ? Number(templateId) : undefined,
        name, type, companyId: companyId ? Number(companyId) : undefined,
        dealId: dealId ? Number(dealId) : undefined, assetId: assetId ? Number(assetId) : undefined,
        investorProfileId: investorProfileId ? Number(investorProfileId) : undefined,
        filledHtml, status: "generated"
      });
      res.status(201).json(proposal);
    } catch (err) {
      console.error("Proposal generation error:", err);
      res.status(500).json({ message: "Erro ao gerar proposta" });
    }
  });

  app.patch("/api/proposals/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const updated = await storage.updateProposal(Number(req.params.id), req.body);
      res.json(updated);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.delete("/api/proposals/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      await storage.deleteProposal(Number(req.params.id));
      res.status(204).end();
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.post("/api/proposals/:id/send-email", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const proposalId = Number(req.params.id);
      const { recipientEmail, recipientName, subject, customMessage } = req.body;
      if (!recipientEmail || !subject) {
        return res.status(400).json({ message: "recipientEmail e subject são obrigatórios" });
      }

      const proposal = await storage.getProposal(proposalId);
      if (!proposal) return res.status(404).json({ message: "Proposta não encontrada" });

      const senderUser = req.isAuthenticated() ? (req.user as any) : null;
      const replyTo = senderUser?.email || undefined;
      const signature = senderUser?.emailSignature || "";

      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ message: "Serviço de email não configurado. Adicione RESEND_API_KEY nas variáveis de ambiente." });
      }

      const { Resend } = await import("resend");
      const resend = new Resend(apiKey);

      const greeting = recipientName ? `<p>Olá, <strong>${recipientName}</strong>,</p>` : "";
      const customBlock = customMessage ? `<p style="margin-bottom:16px;">${customMessage}</p>` : "";
      const signatureBlock = signature ? `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;">${signature}</div>` : "";

      const htmlBody = `
        <!DOCTYPE html><html><head><meta charset="utf-8" />
        <style>body{font-family:Inter,Arial,sans-serif;color:#111827;line-height:1.7;max-width:740px;margin:0 auto;padding:32px;}
        h1{font-size:26px;font-weight:700;margin:20px 0 10px;}h2{font-size:20px;font-weight:600;margin:18px 0 8px;}
        h3{font-size:16px;font-weight:600;margin:14px 0 6px;}p{margin:0 0 12px;font-size:14px;}
        ul,ol{margin:0 0 12px;padding-left:22px;}li{margin-bottom:3px;font-size:14px;}
        strong{font-weight:600;}em{font-style:italic;}s{text-decoration:line-through;}
        u{text-decoration:underline;}hr{border:none;border-top:1px solid #e5e7eb;margin:20px 0;}
        </style></head><body>
        ${greeting}${customBlock}
        ${proposal.filledHtml || "<p>Proposta sem conteúdo.</p>"}
        ${signatureBlock}
        </body></html>
      `;

      const fromAddress = "Mavrion Connect <noreply@mavrion.com.br>";

      const result = await resend.emails.send({
        from: fromAddress,
        to: [recipientEmail],
        ...(replyTo ? { replyTo } : {}),
        subject,
        html: htmlBody,
      });

      if (result.error) {
        console.error("Resend error:", result.error);
        return res.status(500).json({ message: result.error.message || "Falha ao enviar email" });
      }

      await storage.updateProposal(proposalId, { status: "sent" });

      res.json({ success: true, emailId: result.data?.id });
    } catch (err: any) {
      console.error("Email send error:", err);
      res.status(500).json({ message: err.message || "Erro ao enviar email" });
    }
  });

  app.get("/api/contract-templates", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const data = await storage.getContractTemplates(getOrgId());
    res.json(data);
  });

  app.get("/api/contract-templates/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const t = await storage.getContractTemplate(Number(req.params.id));
    if (!t) return res.status(404).json({ message: "Template não encontrado" });
    res.json(t);
  });

  app.post("/api/contract-templates", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const { orgId: _strip, ...ctBody } = req.body;
    const created = await storage.createContractTemplate({ ...ctBody, orgId: getOrgId() });
    res.status(201).json(created);
  });

  app.put("/api/contract-templates/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const updated = await storage.updateContractTemplate(Number(req.params.id), req.body);
    res.json(updated);
  });

  app.delete("/api/contract-templates/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    await storage.deleteContractTemplate(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get("/api/contracts", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const data = await storage.getContracts(getOrgId());
    res.json(data);
  });

  app.get("/api/contracts/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const c = await storage.getContract(Number(req.params.id));
    if (!c) return res.status(404).json({ message: "Contrato não encontrado" });
    res.json(c);
  });

  app.post("/api/contracts", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { templateId, name, companyId, dealId, assetId, investorProfileId } = req.body;
      const template = await storage.getContractTemplate(templateId);
      if (!template) return res.status(404).json({ message: "Template não encontrado" });

      let filledHtml = template.bodyHtml || "";
      const vars: Record<string, string> = {};

      if (companyId) {
        const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
        if (company) {
          vars["empresa.nome"] = company.tradeName || company.legalName;
          vars["empresa.razao_social"] = company.legalName;
          vars["empresa.cnpj"] = company.cnpj || "";
          vars["empresa.endereco"] = [
            (company.address as any)?.logradouro,
            (company.address as any)?.numero,
            (company.address as any)?.bairro,
            (company.address as any)?.city || (company.address as any)?.municipio,
            (company.address as any)?.state || (company.address as any)?.uf,
          ].filter(Boolean).join(", ");
          vars["empresa.cep"] = (company.address as any)?.cep || "";
          const vc = (company.verifiedContacts as any) || {};
          vars["empresa.contato_nome"] = vc.contactName || "";
          vars["empresa.contato_cargo"] = vc.contactRole || "";
          vars["empresa.contato_email"] = vc.email || ((company.emails as any[])?.[0] || "");
          vars["empresa.contato_telefone"] = vc.phone || ((company.phones as any[])?.[0] || "");
        }
      }
      if (assetId) {
        const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
        if (asset) {
          vars["ativo.titulo"] = asset.title;
          vars["ativo.tipo"] = asset.type;
          vars["ativo.localizacao"] = [asset.municipio, asset.estado].filter(Boolean).join(" - ");
          vars["ativo.area_ha"] = asset.areaHa?.toLocaleString("pt-BR") || "";
          vars["ativo.area_util"] = asset.areaUtil?.toLocaleString("pt-BR") || "";
          vars["ativo.preco"] = asset.priceAsking?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) || "";
          vars["ativo.matricula"] = asset.matricula || "";
          vars["ativo.municipio"] = asset.municipio || "";
          vars["ativo.estado"] = asset.estado || "";
          vars["ativo.docs_status"] = asset.docsStatus || "";
        }
      }
      if (investorProfileId) {
        const [inv] = await db.select().from(investorProfiles).where(eq(investorProfiles.id, investorProfileId));
        if (inv) {
          vars["investidor.nome"] = inv.name;
          vars["investidor.ticket_min"] = inv.ticketMin?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) || "";
          vars["investidor.ticket_max"] = inv.ticketMax?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) || "";
        }
      }

      const orgSettingsData = await storage.getOrgSetting(getOrgId(), "company");
      const orgData = (orgSettingsData?.value as any) || {};
      vars["minha_empresa.nome"] = orgData.name || "Mavrion Connect";
      vars["minha_empresa.cnpj"] = orgData.cnpj || "";
      vars["minha_empresa.endereco"] = orgData.address || "";

      const now = new Date();
      vars["data.hoje"] = now.toLocaleDateString("pt-BR");
      vars["data.mes_ano"] = now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
      vars["data.extenso"] = now.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });

      vars["contrato.foro"] = req.body.foro || "";
      vars["contrato.prazo"] = req.body.prazo || "";
      vars["contrato.valor"] = req.body.valor || "";
      vars["contrato.garantia"] = req.body.garantia || "";
      vars["contrato.clausula_especial"] = req.body.clausulaEspecial || "";

      for (const [key, val] of Object.entries(vars)) {
        filledHtml = filledHtml.replaceAll(`{{${key}}}`, val);
      }

      const contract = await storage.createContract({
        orgId: getOrgId(),
        templateId,
        name: name || `Contrato - ${template.name}`,
        type: template.type,
        companyId: companyId || null,
        dealId: dealId || null,
        assetId: assetId || null,
        investorProfileId: investorProfileId || null,
        filledHtml,
        status: "generated",
      });
      res.status(201).json(contract);
    } catch (err: any) {
      console.error("Contract generation error:", err.message);
      res.status(500).json({ message: "Erro ao gerar contrato" });
    }
  });

  app.delete("/api/contracts/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    await storage.deleteContract(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get("/api/drive/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const connected = await testDriveConnection();
      res.json({ connected });
    } catch {
      res.json({ connected: false });
    }
  });

  app.post("/api/drive/upload-pdf", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { type, id, name, pdfBase64 } = req.body;
      if (!pdfBase64 || !type || !id) return res.status(400).json({ message: "pdfBase64, type e id são obrigatórios" });
      if (!["proposal", "contract"].includes(type)) return res.status(400).json({ message: "type deve ser 'proposal' ou 'contract'" });

      const buffer = Buffer.from(pdfBase64, "base64");
      const folderName = type === "proposal" ? "Propostas" : "Contratos";
      const fileName = `${name || type}_${id}.pdf`;

      const result = await uploadToDrive(buffer, fileName, "application/pdf", ["Mavrion Connect", folderName]);
      if (!result || !result.fileId) throw new Error("Resposta inválida do Google Drive");

      if (type === "proposal") {
        await storage.updateProposal(Number(id), { driveFileId: result.fileId, driveFileUrl: result.fileUrl } as any);
      } else if (type === "contract") {
        await storage.updateContract(Number(id), { driveFileId: result.fileId, driveFileUrl: result.fileUrl } as any);
      }

      res.json(result);
    } catch (err: any) {
      console.error("[Drive Upload] Erro:", err.message);
      res.status(500).json({ message: "Erro ao enviar para o Google Drive" });
    }
  });
}
