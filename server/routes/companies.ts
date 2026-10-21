import type { Express } from "express";
import type { IStorage } from "../storage";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { api } from "@shared/routes";
import { companies, leads, contacts, deals, proposals, contracts, norionOperations, norionCafRegistros, assets, investorProfiles, matchSuggestions, dealComments, portalInquiries, companyBuyerProfiles, companyVisitLog, companyRejectionLog } from "@shared/schema";
import { eq, and, desc, inArray, or, isNull, sql } from "drizzle-orm";
import path from "path";
import { getCached, setCached } from "../cache";
import { audit } from "../audit";
import { waterfallEnrich } from "../enrichment/waterfall";
import { getOrgId } from "../lib/tenant";
import { consultarCertidoes } from "../lib/certidoes";
import { companyProspectionScope, discardCompanyRecord } from "../lib/company-prospecting";

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
  app.get(api.companies.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const companiesList = await storage.getCompanies();
    res.json(companiesList);
  });

  app.get("/api/companies/catalogo", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const allCompanies = await db.select().from(companies).where(eq(companies.orgId, getOrgId(req))).orderBy(desc(companies.createdAt));
      const linkedAssets = await db
        .select({ linkedCompanyId: assets.linkedCompanyId, assetType: assets.type })
        .from(assets)
        .where(sql`${assets.linkedCompanyId} IS NOT NULL`);
      const assetCountByCompany = new Map<number, { count: number; types: Set<string> }>();
      for (const a of linkedAssets) {
        if (!a.linkedCompanyId) continue;
        const entry = assetCountByCompany.get(a.linkedCompanyId) || { count: 0, types: new Set() };
        entry.count++;
        if (a.assetType) entry.types.add(a.assetType);
        assetCountByCompany.set(a.linkedCompanyId, entry);
      }

      const result = allCompanies.map(c => ({
        ...c,
        phones: (c.phones as string[]) || [],
        emails: (c.emails as string[]) || [],
        cnaeSecundarios: (c.cnaeSecundarios as string[]) || [],
        address: (c.address as Record<string, string>) || {},
        ownedAssets: assetCountByCompany.has(c.id)
          ? { count: assetCountByCompany.get(c.id)!.count, types: Array.from(assetCountByCompany.get(c.id)!.types) }
          : null,
      }));
      res.json(result);
    } catch (err) {
      console.error("Companies catalog error:", err);
      res.status(500).json({ message: "Falha ao buscar empresas" });
    }
  });

  app.post("/api/companies/find-or-create-by-cnpj", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { cnpj, legalName, assetId } = req.body;
      if (!cnpj && !legalName) return res.status(400).json({ message: "CNPJ ou nome obrigatório" });

      let companyId: number | null = null;
      let existed = false;

      if (cnpj) {
        const cleanCnpj = cnpj.replace(/\D/g, "");
        const formatted = cleanCnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

        const existing = await db.select().from(companies).where(
          or(eq(companies.cnpj, cleanCnpj), eq(companies.cnpj, formatted))
        ).limit(1);

        if (existing.length > 0) {
          companyId = existing[0].id;
          existed = true;
        } else {
          const [created] = await db.insert(companies).values({
            legalName: legalName || "Empresa " + formatted,
            cnpj: formatted,
            orgId: getOrgId(req),
          }).returning();
          companyId = created.id;
        }
      } else if (legalName) {
        const existing = await db.select().from(companies).where(
          eq(companies.legalName, legalName)
        ).limit(1);

        if (existing.length > 0) {
          companyId = existing[0].id;
          existed = true;
        } else {
          const [created] = await db.insert(companies).values({
            legalName,
            orgId: getOrgId(req),
          }).returning();
          companyId = created.id;
        }
      }

      if (companyId && assetId) {
        const numericAssetId = Number(assetId);
        if (!isNaN(numericAssetId)) {
          await db.update(assets).set({ linkedCompanyId: companyId }).where(eq(assets.id, numericAssetId));
        }
      }

      if (companyId) {
        const [comp] = await db.select().from(companies).where(
          and(eq(companies.id, companyId), or(eq(companies.orgId, getOrgId(req)), isNull(companies.orgId)))
        );
        if (comp?.cnpj && (!comp.cnaePrincipal || !comp.porte)) {
          const cleanCnpj = comp.cnpj.replace(/\D/g, "");
          try {
            let data = await getCached<any>("cnpja", `office:${cleanCnpj}`);
            if (!data) {
              const url = `https://api.cnpja.com/office/${cleanCnpj}?strategy=CACHE_IF_FRESH&maxAge=30`;
              const response = await fetch(url, { headers: cnpjaHeaders() });
              if (response.ok) {
                data = await response.json() as any;
                await setCached("cnpja", `office:${cleanCnpj}`, data);
              }
            }
            if (data) {
              const updateData: Record<string, any> = {};
              if (data.mainActivity?.text && !comp.cnaePrincipal) updateData.cnaePrincipal = data.mainActivity.text;
              if (data.sideActivities?.length && !(comp.cnaeSecundarios as string[])?.length) {
                updateData.cnaeSecundarios = data.sideActivities.map((a: any) => a.text);
              }
              if (data.company?.size?.text && !comp.porte) updateData.porte = data.company.size.text;
              if (data.alias && !comp.tradeName) updateData.tradeName = data.alias;
              if (data.company?.equity && !comp.shareCapital) updateData.shareCapital = data.company.equity;
              const phones = (data.phones || []).map((p: any) => `(${p.area}) ${p.number}`);
              if (phones.length && !(comp.phones as string[])?.length) updateData.phones = phones;
              const emails = (data.emails || []).map((e: any) => e.address);
              if (emails.length && !(comp.emails as string[])?.length) updateData.emails = emails;
              if (data.company?.members?.length) {
                const existingEnrich = (comp.enrichmentData as any) || {};
                updateData.enrichmentData = { ...existingEnrich, cnpja: data };
              }
              if (Object.keys(updateData).length > 0) {
                await db.update(companies).set(updateData).where(
                  and(eq(companies.id, companyId!), or(eq(companies.orgId, getOrgId(req)), isNull(companies.orgId)))
                );
                console.log(`[find-or-create] Auto-enriched company ${companyId} with CNPJA data (${Object.keys(updateData).join(", ")})`);
              }
            }
          } catch (e: any) {
            console.warn(`[find-or-create] CNPJA auto-enrich error for company ${companyId}:`, e.message || e);
          }
        }
      }

      res.json({ companyId, existed });
    } catch (err: any) {
      console.error("[find-or-create-by-cnpj]", err.message || err);
      res.status(500).json({ message: "Erro ao buscar/criar empresa" });
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


  app.post(api.companies.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const input = api.companies.create.input.parse(req.body);
      const data = await storage.createCompany({ ...input, orgId: getOrgId(req) });
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
          const [company] = await db.select().from(companies)
            .where(and(eq(companies.id, companyId), or(eq(companies.orgId, getOrgId(req)), isNull(companies.orgId))));
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
          if (result.estimatedRevenue) updateData.revenueEstimateLabel = result.estimatedRevenue;
          if (result.employeeCount) updateData.employeeCount = result.employeeCount;
          if (result.shareCapital !== undefined) updateData.shareCapital = result.shareCapital;
          if (result.tradingName && !company.tradeName) updateData.tradeName = result.tradingName;

          if (company.cnpj && (!(company.cnaeSecundarios as string[])?.length || !company.cnaePrincipal)) {
            try {
              const cnpjaKey = process.env.CNPJA_API_KEY;
              if (cnpjaKey) {
                const cnpjClean = company.cnpj.replace(/\D/g, "");
                const cnpjaRes = await fetch(`https://api.cnpja.com/office/${cnpjClean}?strategy=CACHE_IF_FRESH&maxAge=30`, {
                  headers: { Authorization: cnpjaKey },
                });
                if (cnpjaRes.ok) {
                  const cnpjaData = await cnpjaRes.json();
                  if (cnpjaData.sideActivities?.length && !(company.cnaeSecundarios as string[])?.length) {
                    updateData.cnaeSecundarios = cnpjaData.sideActivities.map((a: any) => a.text);
                  }
                  if (cnpjaData.mainActivity?.text && !company.cnaePrincipal) {
                    updateData.cnaePrincipal = cnpjaData.mainActivity.text;
                  }
                  const existingEnrich = (updateData.enrichmentData as any) || {};
                  updateData.enrichmentData = { ...existingEnrich, cnpja: cnpjaData };
                }
              }
            } catch (e) {
              console.warn("[enrich] CNPJA re-fetch error:", e);
            }
          }

          let aiEnrichment = null;
          try {
            const { aiEnrichCompany } = await import("../lib/ai-enrichment");
            aiEnrichment = await aiEnrichCompany({
              name: company.tradeName || company.legalName,
              cnpj: company.cnpj || "",
              existingPhones: [
                ...((company.phones as string[]) || []),
                ...(result.phones || []),
              ],
              existingEmails: [
                ...((company.emails as string[]) || []),
                ...(result.emails || []),
              ],
              website: result.website || company.website || undefined,
              city: (company as any).city || "",
              state: (company as any).state || "",
              porte: (company as any).porte || "",
              cnae: (company as any).cnaePrincipal || "",
              shareCapital: (company as any).shareCapital || undefined,
              scraperData: result.raw || result,
            });

            if (aiEnrichment) {
              const existingEnrichData = (updateData.enrichmentData as any) || {};
              if ((aiEnrichment as any)._failReason) {
                updateData.enrichmentData = {
                  ...existingEnrichData,
                  aiEnrichment,
                  aiEnrichmentFailed: true,
                  aiEnrichmentFailReason: (aiEnrichment as any)._failReason,
                  aiEnrichmentFailedAt: new Date().toISOString(),
                };
              } else {
                updateData.enrichmentData = {
                  ...existingEnrichData,
                  aiEnrichment,
                  aiEnrichmentFailed: false,
                  aiEnrichmentFailReason: null,
                };
              }

              if (aiEnrichment.website?.url && !company.website && !updateData.website) {
                updateData.website = aiEnrichment.website.url;
              }

              const aiPhones = (aiEnrichment.validatedPhones || [])
                .filter((p: any) => p.confidence !== "baixa")
                .map((p: any) => p.number);
              const aiEmails = (aiEnrichment.validatedEmails || [])
                .filter((e: any) => e.confidence !== "baixa")
                .map((e: any) => e.email);

              const currentPhones = new Set(
                [...((company.phones as string[]) || []), ...(updateData.phones || [])].map(
                  (p: string) => p.replace(/\D/g, "")
                )
              );
              const currentEmails = new Set(
                [...((company.emails as string[]) || []), ...(updateData.emails || [])].map(
                  (e: string) => e.toLowerCase()
                )
              );

              const newAiPhones = aiPhones.filter(
                (p: string) => !currentPhones.has(p.replace(/\D/g, ""))
              );
              const newAiEmails = aiEmails.filter(
                (e: string) => !currentEmails.has(e.toLowerCase())
              );

              if (newAiPhones.length > 0) {
                updateData.phones = [
                  ...((updateData.phones as string[]) || (company.phones as string[]) || []),
                  ...newAiPhones,
                ];
              }
              if (newAiEmails.length > 0) {
                updateData.emails = [
                  ...((updateData.emails as string[]) || (company.emails as string[]) || []),
                  ...newAiEmails,
                ];
              }

              const fp = aiEnrichment.financialProfile || {};
              if (fp.companySize && !company.porte) {
                updateData.porte = fp.companySize;
              }
              if (fp.estimatedRevenue) {
                updateData.revenueEstimateLabel = fp.estimatedRevenue;
              }
              if (fp.employeeRange && !company.employeeCount) {
                updateData.employeeCount = fp.employeeRange;
              }
            }
          } catch (aiErr: any) {
            console.error("[AI-Enrichment] Error (non-blocking):", aiErr.message);
          }

          await db.update(companies).set(updateData as any).where(eq(companies.id, companyId));


          const [updated] = await db.select().from(companies).where(eq(companies.id, companyId));
          const user = req.user as any;
          const totalPhones = (updateData.phones || result.phones || []).length;
          const totalEmails = (updateData.emails || result.emails || []).length;
          const aiLabel = aiEnrichment
            ? ` + IA (${aiEnrichment.validatedPhones?.length || 0} tel, ${aiEnrichment.validatedEmails?.length || 0} email, ${aiEnrichment.decisionMakers?.length || 0} decisores)`
            : "";
          if (user) {
            await audit({
              userId: user.id, userName: user.username,
              entity: "company", entityId: companyId, entityTitle: company.legalName,
              action: "updated",
              changes: { enrichment: { from: null, to: `Enriquecimento via ${result.source} — ${totalPhones} tel, ${totalEmails} email${aiLabel}` } },
            });
          }

          res.json({ company: updated, enrichment: result, aiEnrichment, source: result.source });
        } catch (err: any) {
          console.error("Enrichment error:", err.message);
          res.status(500).json({ message: err.message || "Erro ao enriquecer empresa" });
        }
      });

  app.post("/api/companies/:id/refresh-financial", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const companyId = Number(req.params.id);
      const [company] = await db.select().from(companies)
        .where(and(eq(companies.id, companyId), or(eq(companies.orgId, getOrgId(req)), isNull(companies.orgId))));
      if (!company) return res.status(404).json({ message: "Empresa não encontrada" });
      if (!company.cnpj) return res.status(400).json({ message: "Empresa sem CNPJ — não é possível consultar dados financeiros" });

      const result = await waterfallEnrich({
        cnpj: company.cnpj,
        name: company.tradeName || company.legalName,
        website: company.website || undefined,
        knownPhones: (company.phones as string[]) || [],
      });

      const patch: Record<string, any> = {};
      if (result.estimatedRevenue) patch.revenueEstimateLabel = result.estimatedRevenue;
      if (result.employeeCount) patch.employeeCount = result.employeeCount;
      if (result.shareCapital !== undefined) patch.shareCapital = result.shareCapital;
      if (result.website && !company.website) patch.website = result.website;
      if (result.tradingName && !company.tradeName) patch.tradeName = result.tradingName;

      const currentEnrich = (company.enrichmentData as any) || {};
      patch.enrichmentData = {
        ...currentEnrich,
        waterfall: result.raw || result,
        waterfallSource: result.source,
        waterfallRefreshedAt: new Date().toISOString(),
      };
      patch.enrichedAt = new Date();

      await db.update(companies).set(patch).where(eq(companies.id, companyId));
      const [updated] = await db.select().from(companies).where(eq(companies.id, companyId));

      console.log(`[RefreshFinancial] Empresa ${companyId} atualizada via ${result.source}`);
      res.json({
        company: updated,
        source: result.source,
        found: {
          revenue: result.estimatedRevenue || null,
          employees: result.employeeCount || null,
          shareCapital: result.shareCapital || null,
        },
      });
    } catch (err: any) {
      console.error("Refresh financial error:", err.message);
      res.status(500).json({ message: err.message || "Erro ao atualizar dados financeiros" });
    }
  });

  app.patch("/api/companies/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const companyId = Number(req.params.id);
      const allowed = ["legalName", "tradeName", "porte", "phones", "emails", "address", "cnaePrincipal", "enrichedAt"];
      const updates: any = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      if (updates.enrichedAt && typeof updates.enrichedAt === "string") {
        updates.enrichedAt = new Date(updates.enrichedAt);
      }
      if (Object.keys(updates).length === 0) return res.status(400).json({ message: "Nenhum campo válido para atualizar" });
      const [updated] = await db.update(companies)
        .set(updates)
        .where(and(eq(companies.id, companyId), or(eq(companies.orgId, getOrgId(req)), isNull(companies.orgId))))
        .returning();
      if (!updated) return res.status(404).json({ message: "Empresa não encontrada" });
      const user = req.user as any;
      await audit({
        userId: user.id, userName: user.username,
        entity: "company", entityId: companyId, entityTitle: updated.legalName,
        action: "updated",
        changes: { cnpja: { from: null, to: "Dados atualizados via CNPJA" } },
      });
      res.json(updated);
    } catch (err: any) {
      console.error("[PATCH /api/companies/:id]", err.message || err);
      res.status(500).json({ message: "Erro ao atualizar empresa" });
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
        .where(and(eq(companies.id, companyId), or(eq(companies.orgId, getOrgId(req)), isNull(companies.orgId))))
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
    } catch (err: any) {
      console.error("[PATCH /api/companies/:id]", err.message || err);
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
        .where(and(eq(companies.id, companyId), eq(companies.orgId, getOrgId(req))))
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
      const [row] = await db.select().from(companies).where(and(eq(companies.id, companyId), eq(companies.orgId, getOrgId(req)))).limit(1);
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
          orgId: getOrgId(req),
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
          enrichmentData: { importedAt: new Date().toISOString() },
        } as any).returning();
      }

      res.status(201).json({ company });
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
      const orgId = getOrgId(req);
      let company;
      const existing = await db.select().from(companies).where(companyProspectionScope(orgId, cleanCnpj));
      if (existing.length > 0) {
        company = existing[0];
      } else {
        // CNPJ é único: não reutilizar nem modificar um cadastro de outro tenant.
        const [elsewhere] = await db.select({ id: companies.id }).from(companies).where(eq(companies.cnpj, cleanCnpj));
        if (elsewhere) return res.status(404).json({ message: "Empresa não encontrada" });
        let data = await getCached<any>("cnpja", cleanCnpj);
        if (!data) {
          const response = await fetch(`https://api.cnpja.com/office/${cleanCnpj}?strategy=CACHE_IF_FRESH&maxAge=30`, { headers: cnpjaHeaders() });
          if (!response.ok) return res.status(404).json({ message: "CNPJ não encontrado" });
          data = await response.json() as any;
          await setCached("cnpja", cleanCnpj, data);
        }
        [company] = await db.insert(companies).values({
          orgId: getOrgId(req),
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
      const discarded = await discardCompanyRecord(db, orgId, cleanCnpj);
      if (!discarded) return res.status(404).json({ message: "Empresa não encontrada" });
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

      const orgId = getOrgId(req);
      const [existing] = await db.select({ id: companies.id }).from(companies).where(and(eq(companies.id, id), eq(companies.orgId, orgId)));
      if (!existing) return res.status(404).json({ message: "Empresa não encontrada" });

      const investorProfileIds = await db.select({ id: investorProfiles.id }).from(investorProfiles).where(eq(investorProfiles.companyId, id));
      if (investorProfileIds.length > 0) {
        await db.delete(matchSuggestions).where(inArray(matchSuggestions.investorProfileId, investorProfileIds.map(p => p.id)));
        await db.delete(investorProfiles).where(eq(investorProfiles.companyId, id));
      }
      const companyDeals = await db.select({ id: deals.id }).from(deals).where(eq(deals.companyId, id));
      if (companyDeals.length > 0) {
        const dealIds = companyDeals.map(d => d.id);
        await db.delete(dealComments).where(inArray(dealComments.dealId, dealIds));
        await db.execute(sql`DELETE FROM deal_activities WHERE deal_id = ANY(${dealIds})`);
        await db.update(matchSuggestions).set({ status: "new", dealId: null } as any).where(inArray(matchSuggestions.dealId, dealIds));
        await db.update(portalInquiries).set({ dealId: null } as any).where(inArray(portalInquiries.dealId, dealIds));
      }
      await db.delete(leads).where(eq(leads.companyId, id));
      await db.delete(contacts).where(eq(contacts.companyId, id));
      await db.delete(proposals).where(eq(proposals.companyId, id));
      await db.delete(contracts).where(eq(contracts.companyId, id));
      await db.delete(deals).where(eq(deals.companyId, id));
      await db.delete(norionOperations).where(eq(norionOperations.companyId, id));
      await db.delete(norionCafRegistros).where(eq(norionCafRegistros.companyId, id));
      await db.delete(companyBuyerProfiles).where(eq(companyBuyerProfiles.companyId, id));
      await db.delete(companyVisitLog).where(eq(companyVisitLog.companyId, id));
      await db.delete(companyRejectionLog).where(eq(companyRejectionLog.companyId, id));
      await db.update(assets).set({ linkedCompanyId: null } as any).where(eq(assets.linkedCompanyId, id));
      await db.update(assets).set({ exclusividadeEmpresaId: null } as any).where(eq(assets.exclusividadeEmpresaId, id));
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

      const orgId = getOrgId(req);
      const ownedCompanies = await db.select({ id: companies.id }).from(companies).where(and(inArray(companies.id, numIds), eq(companies.orgId, orgId)));
      const ownedIds = ownedCompanies.map(c => c.id);
      if (ownedIds.length === 0) return res.status(404).json({ message: "Nenhuma empresa encontrada" });

      const investorProfileRows = await db.select({ id: investorProfiles.id }).from(investorProfiles).where(inArray(investorProfiles.companyId, ownedIds));
      if (investorProfileRows.length > 0) {
        await db.delete(matchSuggestions).where(inArray(matchSuggestions.investorProfileId, investorProfileRows.map(p => p.id)));
        await db.delete(investorProfiles).where(inArray(investorProfiles.companyId, ownedIds));
      }
      const batchDeals = await db.select({ id: deals.id }).from(deals).where(inArray(deals.companyId, ownedIds));
      if (batchDeals.length > 0) {
        const dealIds = batchDeals.map(d => d.id);
        await db.delete(dealComments).where(inArray(dealComments.dealId, dealIds));
        await db.execute(sql`DELETE FROM deal_activities WHERE deal_id = ANY(${dealIds})`);
        await db.update(matchSuggestions).set({ status: "new", dealId: null } as any).where(inArray(matchSuggestions.dealId, dealIds));
        await db.update(portalInquiries).set({ dealId: null } as any).where(inArray(portalInquiries.dealId, dealIds));
      }
      await db.delete(leads).where(inArray(leads.companyId, ownedIds));
      await db.delete(contacts).where(inArray(contacts.companyId, ownedIds));
      await db.delete(proposals).where(inArray(proposals.companyId, ownedIds));
      await db.delete(contracts).where(inArray(contracts.companyId, ownedIds));
      await db.delete(deals).where(inArray(deals.companyId, ownedIds));
      await db.delete(norionOperations).where(inArray(norionOperations.companyId, ownedIds));
      await db.delete(norionCafRegistros).where(inArray(norionCafRegistros.companyId, ownedIds));
      await db.delete(companyBuyerProfiles).where(inArray(companyBuyerProfiles.companyId, ownedIds));
      await db.delete(companyVisitLog).where(inArray(companyVisitLog.companyId, ownedIds));
      await db.delete(companyRejectionLog).where(inArray(companyRejectionLog.companyId, ownedIds));
      await db.update(assets).set({ linkedCompanyId: null } as any).where(inArray(assets.linkedCompanyId, ownedIds));
      await db.update(assets).set({ exclusividadeEmpresaId: null } as any).where(inArray(assets.exclusividadeEmpresaId, ownedIds));
      await db.delete(companies).where(inArray(companies.id, ownedIds));

      await audit({ action: "deleted", entity: "company", entityId: 0, userId: (req as any).user?.id, userName: (req as any).user?.username || "", changes: { batch: { from: numIds.length, to: ownedIds.length } } });
      res.json({ success: true, deleted: ownedIds.length });
    } catch (err) {
      console.error("Batch delete companies error:", err);
      res.status(500).json({ message: "Falha ao excluir empresas em lote" });
    }
  });

  app.post("/api/companies/:id/certidoes", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });

    const [company] = await db.select().from(companies).where(and(eq(companies.id, Number(req.params.id)), eq(companies.orgId, getOrgId(req))));
    if (!company) return res.status(404).json({ message: "Empresa não encontrada" });
    if (!company.cnpj) return res.status(400).json({ message: "Empresa sem CNPJ" });

    try {
      const certidoes = await consultarCertidoes(company.cnpj);

      const enrichmentAtual = (company.enrichmentData as any) || {};
      await db.update(companies).set({
        enrichmentData: {
          ...enrichmentAtual,
          certidoes,
          certidoesConsultadasEm: new Date().toISOString(),
        },
      } as any).where(eq(companies.id, company.id));

      res.json(certidoes);
    } catch (err: any) {
      console.error(`[Certidões] Erro inesperado ao consultar certidões para empresa ${company.id}:`, err);
      res.status(500).json({ message: err.message || "Erro inesperado ao consultar certidões" });
    }
  });
}
