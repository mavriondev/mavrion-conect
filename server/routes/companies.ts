import type { Express } from "express";
import type { IStorage } from "../storage";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { api } from "@shared/routes";
import { companies, leads, contacts, deals, proposals, contracts, norionOperations, norionCafRegistros, assets } from "@shared/schema";
import { eq, and, desc, inArray, or, isNull } from "drizzle-orm";
import { spawn } from "child_process";
import path from "path";
import { getCached, setCached } from "../cache";
import { audit } from "../audit";
import { waterfallEnrich } from "../enrichment/waterfall";
import { getOrgId } from "../lib/tenant";

const cnpjaHeaders = () => ({
  "Authorization": process.env.CNPJA_API_KEY || "",
});

function mapCnpjaOffice(data: any, cleanCnpj: string) {
  return {
    raw: data,
    legalName: data.company?.name || "",
    tradeName: data.alias || null,
    cnpj: cleanCnpj,
    cnaePrincipal: data.mainActivity?.text || null,
    cnaeCode: data.mainActivity?.id || null,
    cnaeSecundarios: (data.sideActivities || []).map((a: any) => a.text),
    porte: data.company?.size?.text || null,
    porteId: data.company?.size?.id || null,
    status: data.status?.text || null,
    statusId: data.status?.id || null,
    natureza: data.company?.nature?.text || null,
    simplesNacional: data.company?.simples?.optant || false,
    phones: (data.phones || []).map((p: any) => `(${p.area}) ${p.number}`),
    emails: (data.emails || []).map((e: any) => e.address),
    address: data.address ? {
      street: data.address.street,
      number: data.address.number,
      district: data.address.district,
      city: data.address.city,
      state: data.address.state,
      zip: data.address.zip,
    } : {},
    socios: (data.company?.members || []).map((m: any) => ({
      name: m.person?.name,
      role: m.role?.text,
      since: m.since,
    })),
    website: null,
  };
}

export function registerCompanyRoutes(app: Express, storage: IStorage, db: NodePgDatabase<any>) {
  app.get(api.crm.companies.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const companiesList = await storage.getCompanies();
    res.json(companiesList);
  });

  app.get("/api/companies/with-leads", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const allCompanies = await db.select().from(companies).orderBy(desc(companies.createdAt));
      const allLeads = await db.select().from(leads);
      const leadsByCompany = new Map<number, typeof allLeads[0]>();
      for (const lead of allLeads) {
        if (lead.companyId && !leadsByCompany.has(lead.companyId)) {
          leadsByCompany.set(lead.companyId, lead);
        }
      }
      const result = allCompanies.map(c => ({
        ...c,
        phones: (c.phones as string[]) || [],
        emails: (c.emails as string[]) || [],
        cnaeSecundarios: (c.cnaeSecundarios as string[]) || [],
        address: (c.address as Record<string, string>) || {},
        lead: leadsByCompany.has(c.id)
          ? (() => {
              const l = leadsByCompany.get(c.id)!;
              return { id: l.id, status: l.status, score: l.score ?? 0, source: l.source };
            })()
          : null,
      }));
      res.json(result);
    } catch (err) {
      console.error("Companies with leads error:", err);
      res.status(500).json({ message: "Falha ao buscar empresas" });
    }
  });

  app.get("/api/companies/:id/relationships", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const companyId = Number(req.params.id);
      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      if (!company) return res.status(404).json({ message: "Empresa não encontrada" });

      let socios: { name: string; role: string; since: string; taxId?: string }[] = [];

      if (company.cnpj) {
        try {
          const cached = await getCached<any>("cnpja", `office:${company.cnpj}`);
          let data = cached;
          if (!data) {
            const url = `https://api.cnpja.com/office/${company.cnpj}?strategy=CACHE_IF_FRESH&maxAge=30`;
            const response = await fetch(url, { headers: cnpjaHeaders() });
            if (response.ok) {
              data = await response.json() as any;
              await setCached("cnpja", `office:${company.cnpj}`, data);
            }
          }
          if (data) {
            socios = (data.company?.members || []).map((m: any) => ({
              name: m.person?.name || m.name || "Desconhecido",
              role: m.role?.text || "",
              since: m.since || "",
              taxId: m.person?.taxId || undefined,
            }));
          }
        } catch {
        }
      }

      res.json({ company, socios });
    } catch (err) {
      console.error("Relationships error:", err);
      res.status(500).json({ message: "Falha ao buscar relacionamentos" });
    }
  });

  app.post("/api/companies/:id/lead", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const companyId = Number(req.params.id);
      const existingLead = await db.select().from(leads).where(eq(leads.companyId, companyId));
      if (existingLead.length > 0) {
        return res.status(409).json({ message: "Esta empresa já possui um lead" });
      }
      const [lead] = await db.insert(leads).values({
        orgId: getOrgId(),
        companyId,
        status: "new",
        score: 50,
        source: "manual",
        scoreBreakdownJson: { source: "manual_from_company" },
      } as any).returning();
      res.status(201).json(lead);
    } catch (err) {
      console.error("Create lead from company error:", err);
      res.status(500).json({ message: "Falha ao criar lead" });
    }
  });

  app.post(api.crm.companies.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const input = api.crm.companies.create.input.parse(req.body);
      const data = await storage.createCompany({ ...input, orgId: getOrgId() });
      res.status(201).json(data);
    } catch (err) {
      const { z } = await import("zod");
      if (err instanceof z.ZodError) return res.status(400).json(err.errors);
      res.status(500).json({ message: "Internal Error" });
    }
  });

  app.get("/api/socios/:taxId/companies", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { taxId } = req.params;
      const cleanTaxId = taxId.replace(/\D/g, "");
      const cached = await getCached<any>("cnpja", `person:${cleanTaxId}`);
      let data = cached;
      if (!data) {
        const url = `https://api.cnpja.com/person/${cleanTaxId}?strategy=CACHE_IF_FRESH&maxAge=30`;
        const response = await fetch(url, { headers: cnpjaHeaders() });
        if (!response.ok) return res.json({ companies: [] });
        data = await response.json() as any;
        await setCached("cnpja", `person:${cleanTaxId}`, data);
      }
      const related = (data.participations || data.companies || []).map((p: any) => ({
        taxId: p.taxId || p.cnpj || "",
        legalName: p.company?.name || p.name || p.legalName || "Empresa",
        tradeName: p.alias || p.tradeName || null,
        role: p.role?.text || p.role || "",
        since: p.since || "",
        status: p.status?.text || p.statusText || null,
      })).filter((c: any) => c.taxId && c.taxId !== cleanTaxId);
      res.json({ companies: related });
    } catch (err) {
      res.json({ companies: [] });
    }
  });

      app.post("/api/companies/:id/enrich", async (req, res) => {
        if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
        try {
          const companyId = Number(req.params.id);
          const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
          if (!company) return res.status(404).json({ message: "Empresa não encontrada" });

          const result = await waterfallEnrich({
            cnpj: company.cnpj || "",
            name: company.tradeName || company.legalName,
            website: company.website || undefined,
            knownPhones: (company.phones as string[]) || [],
          });

          const updateData: Record<string, any> = {
            enrichmentData: result.raw || result,
            enrichedAt: new Date(),
          };
          if (result.website && !company.website) updateData.website = result.website;
          if (result.phones.length && !(company.phones as string[])?.length) updateData.phones = result.phones;
          if (result.emails.length && !(company.emails as string[])?.length) updateData.emails = result.emails;

          await db.update(companies).set(updateData as any).where(eq(companies.id, companyId));

          if (result.phones.length || result.emails.length) {
            const leadRows = await db.select().from(leads).where(eq(leads.companyId, companyId));
            const lead = leadRows[0];
            if (lead && lead.status === "new") {
              await db.update(leads).set({ status: "in_progress" }).where(eq(leads.id, lead.id));
            }
          }

          const [updated] = await db.select().from(companies).where(eq(companies.id, companyId));
          const user = req.user as any;
          if (user) {
            await audit({
              userId: user.id, userName: user.username,
              entity: "company", entityId: companyId, entityTitle: company.legalName,
              action: "updated",
              changes: { enrichment: { from: null, to: `Enriquecimento via ${result.source} — ${result.phones.length} tel, ${result.emails.length} email` } },
            });
          }

          res.json({ company: updated, enrichment: result, source: result.source });
        } catch (err: any) {
          console.error("Enrichment error:", err.message);
          res.status(500).json({ message: err.message || "Erro ao enriquecer empresa" });
        }
      });

  app.patch("/api/companies/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const companyId = Number(req.params.id);
      const { enrichmentData } = req.body;
      if (!enrichmentData || typeof enrichmentData !== "object") return res.status(400).json({ message: "enrichmentData inválido" });
      const [updated] = await db.update(companies)
        .set({ enrichmentData } as any)
        .where(and(eq(companies.id, companyId), or(eq(companies.orgId, getOrgId()), isNull(companies.orgId))))
        .returning();
      if (!updated) return res.status(404).json({ message: "Empresa não encontrada" });
      const user = req.user as any;
      await audit({
        userId: user.id, userName: user.username,
        entity: "company", entityId: companyId, entityTitle: updated.legalName,
        action: "updated",
        changes: { enrichmentData: { from: null, to: "perfilComprador atualizado" } },
      });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Erro ao atualizar empresa" });
    }
  });

  app.patch("/api/companies/:id/research-notes", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const companyId = Number(req.params.id);
      const { notes } = req.body;
      if (!Array.isArray(notes)) return res.status(400).json({ message: "notes deve ser um array" });
      const [updated] = await db.update(companies)
        .set({ researchNotes: notes } as any)
        .where(eq(companies.id, companyId))
        .returning();
      if (!updated) return res.status(404).json({ message: "Empresa não encontrada" });
      res.json({ researchNotes: updated.researchNotes });
    } catch (err) {
      res.status(500).json({ message: "Erro ao salvar notas" });
    }
  });

  app.patch("/api/companies/:id/verified-contacts", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
      const companyId = Number(req.params.id);
      const user = req.user as any;
      const { phone, email, whatsapp, contactName, contactRole, notes } = req.body;
      const verifiedData = {
        phone: phone || null,
        email: email || null,
        whatsapp: whatsapp || null,
        contactName: contactName || null,
        contactRole: contactRole || null,
        notes: notes || null,
        verifiedAt: new Date().toISOString(),
        verifiedBy: user?.username || "admin",
      };
      const [updated] = await db.update(companies)
        .set({ verifiedContacts: verifiedData } as any)
        .where(and(eq(companies.id, companyId), eq(companies.orgId, getOrgId())))
        .returning();
      if (!updated) return res.status(404).json({ message: "Empresa não encontrada" });
      await audit({
        userId: user.id, userName: user.username,
        entity: "company", entityId: companyId, entityTitle: updated.legalName,
        action: "updated",
        changes: { verifiedContacts: { from: null, to: `${contactName || ""} (${contactRole || ""})` } },
      });
      res.json({ verifiedContacts: (updated as any).verifiedContacts });
    } catch (err) {
      res.status(500).json({ message: "Erro ao salvar contatos verificados" });
    }
  });

  app.get("/api/companies/:id/verified-contacts", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
      const companyId = Number(req.params.id);
      const user = req.user as any;
      const [row] = await db.select().from(companies).where(and(eq(companies.id, companyId), eq(companies.orgId, getOrgId()))).limit(1);
      if (!row) return res.status(404).json({ message: "Empresa não encontrada" });
      res.json({ verifiedContacts: (row as any).verifiedContacts || {} });
    } catch (err) {
      res.status(500).json({ message: "Erro interno" });
    }
  });

  app.get("/api/cnpj/:cnpj", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const { cnpj } = req.params;
    const cleanCnpj = cnpj.replace(/\D/g, "");
    if (cleanCnpj.length !== 14) {
      return res.status(400).json({ message: "CNPJ deve ter 14 dígitos" });
    }
    try {
      const cached = await getCached<any>("cnpja", cleanCnpj);
      if (cached) {
        const existingCached = await db.select({ id: companies.id }).from(companies).where(eq(companies.cnpj, cleanCnpj)).limit(1);
        return res.json({ ...cached, savedCompanyId: existingCached.length > 0 ? existingCached[0].id : null });
      }

      const response = await fetch(`https://api.cnpja.com/office/${cleanCnpj}`, { headers: cnpjaHeaders() });
      if (!response.ok) {
        if (response.status === 404) return res.status(404).json({ message: "CNPJ não encontrado na Receita Federal" });
        if (response.status === 401) return res.status(502).json({ message: "Chave CNPJA expirada ou inválida. Atualize CNPJA_API_KEY." });
        return res.status(response.status).json({ message: `Erro na consulta CNPJA (HTTP ${response.status})` });
      }
      const data = await response.json() as any;
      const result = mapCnpjaOffice(data, cleanCnpj);
      await setCached("cnpja", cleanCnpj, result);
      const existing = await db.select({ id: companies.id }).from(companies).where(eq(companies.cnpj, cleanCnpj)).limit(1);
      res.json({ ...result, savedCompanyId: existing.length > 0 ? existing[0].id : null });
    } catch (err) {
      console.error("CNPJ lookup error:", err);
      res.status(500).json({ message: "Falha ao consultar CNPJ" });
    }
  });

  app.post("/api/cnpj/:cnpj/import", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const { cnpj } = req.params;
    const cleanCnpj = cnpj.replace(/\D/g, "");
    try {
      let data = await getCached<any>("cnpja", cleanCnpj);
      if (!data) {
        const response = await fetch(`https://api.cnpja.com/office/${cleanCnpj}`, { headers: cnpjaHeaders() });
        if (!response.ok) {
          if (response.status === 401) return res.status(502).json({ message: "Chave CNPJA expirada ou inválida. Atualize CNPJA_API_KEY." });
          if (response.status === 404) return res.status(404).json({ message: "CNPJ não encontrado na Receita Federal" });
          return res.status(response.status).json({ message: `Erro ao consultar CNPJA (HTTP ${response.status})` });
        }
        data = await response.json() as any;
        await setCached("cnpja", cleanCnpj, data);
      }

      const legalName = data.company?.name || data.razao_social || data.legalName || "Empresa sem nome";
      const tradeName = data.alias || data.tradeName || null;
      const cnaePrincipal = data.mainActivity?.text || data.cnaePrincipal || null;
      const cnaeSecundarios = (data.sideActivities || []).map((a: any) => a.text);
      const porte = data.company?.size?.text || data.porte || null;
      const phones = data.phones ? (data.phones || []).map((p: any) => typeof p === 'string' ? p : `(${p.area}) ${p.number}`) : [];
      const emails = data.emails ? (data.emails || []).map((e: any) => typeof e === 'string' ? e : e.address) : [];

      const existing = await db.select().from(companies).where(eq(companies.cnpj, cleanCnpj));
      let company;

      if (existing.length > 0) {
        company = existing[0];
      } else {
        [company] = await db.insert(companies).values({
          orgId: getOrgId(),
          legalName,
          tradeName,
          cnpj: cleanCnpj,
          cnaePrincipal,
          cnaeSecundarios,
          porte,
          phones,
          emails,
          address: data.address || {},
          notes: `Situação: ${data.status?.text || "?"} | ${data.company?.nature?.text || ""}`,
        } as any).returning();
      }

      const existingLead = await db.select().from(leads).where(eq(leads.companyId, company.id)).limit(1);
      if (existingLead.length > 0) {
        return res.status(200).json({ company, lead: existingLead[0], alreadyImported: true });
      }

      const [lead] = await db.insert(leads).values({
        orgId: getOrgId(),
        companyId: company.id,
        status: "new",
        score: 50,
        source: "cnpja.com",
        scoreBreakdownJson: { source: "cnpja_import", cnae: cnaePrincipal },
      } as any).returning();

      res.status(201).json({ company, lead });
    } catch (err) {
      console.error("CNPJ import error:", err);
      res.status(500).json({ message: "Falha ao importar CNPJ" });
    }
  });

  app.post("/api/cnpj/:cnpj/disqualify", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const { cnpj } = req.params;
    const cleanCnpj = cnpj.replace(/\D/g, "");
    try {
      let company;
      const existing = await db.select().from(companies).where(eq(companies.cnpj, cleanCnpj));
      if (existing.length > 0) {
        company = existing[0];
      } else {
        let data = await getCached<any>("cnpja", cleanCnpj);
        if (!data) {
          const response = await fetch(`https://api.cnpja.com/office/${cleanCnpj}?strategy=CACHE_IF_FRESH&maxAge=30`, { headers: cnpjaHeaders() });
          if (!response.ok) return res.status(404).json({ message: "CNPJ não encontrado" });
          data = await response.json() as any;
          await setCached("cnpja", cleanCnpj, data);
        }
        [company] = await db.insert(companies).values({
          orgId: getOrgId(),
          legalName: data.company?.name || "Empresa sem nome",
          tradeName: data.alias || null,
          cnpj: cleanCnpj,
          cnaePrincipal: data.mainActivity?.text || null,
          cnaeSecundarios: (data.sideActivities || []).map((a: any) => a.text),
          porte: data.company?.size?.text || null,
          phones: (data.phones || []).map((p: any) => `(${p.area}) ${p.number}`),
          emails: (data.emails || []).map((e: any) => e.address),
          address: data.address || {},
          notes: `Situação: ${data.status?.text || "?"} | ${data.company?.nature?.text || ""}`,
        } as any).returning();
      }
      const existingLead = await db.select().from(leads).where(eq(leads.companyId, company.id));
      if (existingLead.length > 0) {
        await db.update(leads).set({ status: "disqualified" } as any).where(eq(leads.companyId, company.id));
      } else {
        await db.insert(leads).values({
          orgId: getOrgId(), companyId: company.id, status: "disqualified",
          score: 0, source: "manual_disqualify",
        } as any);
      }
      res.status(201).json({ success: true });
    } catch (err) {
      console.error("Disqualify error:", err);
      res.status(500).json({ message: "Falha ao desqualificar" });
    }
  });

  app.delete("/api/companies/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ message: "ID inválido" });

      const orgId = getOrgId();
      const [existing] = await db.select({ id: companies.id }).from(companies).where(and(eq(companies.id, id), eq(companies.orgId, orgId)));
      if (!existing) return res.status(404).json({ message: "Empresa não encontrada" });

      await db.delete(leads).where(eq(leads.companyId, id));
      await db.delete(contacts).where(eq(contacts.companyId, id));
      await db.delete(deals).where(eq(deals.companyId, id));
      await db.delete(proposals).where(eq(proposals.companyId, id));
      await db.delete(contracts).where(eq(contracts.companyId, id));
      await db.delete(norionOperations).where(eq(norionOperations.companyId, id));
      await db.delete(norionCafRegistros).where(eq(norionCafRegistros.companyId, id));
      await db.update(assets).set({ linkedCompanyId: null } as any).where(eq(assets.linkedCompanyId, id));
      await db.delete(companies).where(eq(companies.id, id));

      await audit({ action: "deleted", entity: "company", entityId: id, userId: (req as any).user?.id, userName: (req as any).user?.username || "" });
      res.json({ success: true, id });
    } catch (err) {
      console.error("Delete company error:", err);
      res.status(500).json({ message: "Falha ao excluir empresa" });
    }
  });

  app.post("/api/companies/batch-delete", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "IDs inválidos" });

      const numIds = ids.map(Number).filter(Boolean);
      if (numIds.length === 0) return res.status(400).json({ message: "IDs inválidos" });

      const orgId = getOrgId();
      const ownedCompanies = await db.select({ id: companies.id }).from(companies).where(and(inArray(companies.id, numIds), eq(companies.orgId, orgId)));
      const ownedIds = ownedCompanies.map(c => c.id);
      if (ownedIds.length === 0) return res.status(404).json({ message: "Nenhuma empresa encontrada" });

      await db.delete(leads).where(inArray(leads.companyId, ownedIds));
      await db.delete(contacts).where(inArray(contacts.companyId, ownedIds));
      await db.delete(deals).where(inArray(deals.companyId, ownedIds));
      await db.delete(proposals).where(inArray(proposals.companyId, ownedIds));
      await db.delete(contracts).where(inArray(contracts.companyId, ownedIds));
      await db.delete(norionOperations).where(inArray(norionOperations.companyId, ownedIds));
      await db.delete(norionCafRegistros).where(inArray(norionCafRegistros.companyId, ownedIds));
      await db.update(assets).set({ linkedCompanyId: null } as any).where(inArray(assets.linkedCompanyId, ownedIds));
      await db.delete(companies).where(inArray(companies.id, ownedIds));

      await audit({ action: "deleted", entity: "company", entityId: 0, userId: (req as any).user?.id, userName: (req as any).user?.username || "", changes: { batch: { from: numIds.length, to: ownedIds.length } } });
      res.json({ success: true, deleted: ownedIds.length });
    } catch (err) {
      console.error("Batch delete companies error:", err);
      res.status(500).json({ message: "Falha ao excluir empresas em lote" });
    }
  });
}
