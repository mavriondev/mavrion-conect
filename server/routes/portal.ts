import type { Express } from "express";
import type { IStorage } from "../storage";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sendNotification, notifId } from "../notifications";
import { insertPortalListingSchema, insertAssetLandingPageSchema, companies, leads, deals, pipelineStages, portalInquiries, assets } from "@shared/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { getOrgId } from "../lib/tenant";

function computeIntent(data: { phone?: string; message?: string; assetId?: number | null }) {
  let score = 20;
  const signals: string[] = [];

  if (data.phone) { score += 25; signals.push("Telefone informado"); }
  if (data.message && data.message.length >= 30) { score += 10; signals.push("Mensagem detalhada"); }
  if (data.message) {
    const urgentTerms = ["proposta", "visita", "reunião", "ligar", "agora", "urgente", "contato", "investir"];
    const msgLower = data.message.toLowerCase();
    if (urgentTerms.some(t => msgLower.includes(t))) {
      score += 25;
      signals.push("Palavras-chave de intenção forte");
    }
  }
  if (data.assetId) { score += 20; signals.push("Interesse em ativo específico"); }

  return { score: Math.min(Math.max(score, 0), 100), signals };
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

export function registerPortalRoutes(app: Express, storage: IStorage, db: NodePgDatabase<any>) {
  app.get("/api/portal/listings", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const data = await storage.getPortalListings(getOrgId());
    res.json(data);
  });

  app.post("/api/portal/listings", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const { orgId: _strip, ...body } = req.body;
    const parsed = insertPortalListingSchema.safeParse({ ...body, orgId: getOrgId() });
    if (!parsed.success) return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.flatten() });
    const listing = await storage.createPortalListing(parsed.data);
    res.status(201).json(listing);
  });

  app.patch("/api/portal/listings/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const id = Number(req.params.id);
    const data = req.body;
    if (data.status === "published" && !data.publishedAt) {
      data.publishedAt = new Date();
    }
    const partial = insertPortalListingSchema.partial().safeParse(data);
    if (!partial.success) return res.status(400).json({ message: "Dados inválidos", errors: partial.error.flatten() });
    const updated = await storage.updatePortalListing(id, partial.data);
    res.json(updated);
  });

  app.delete("/api/portal/listings/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    await storage.deletePortalListing(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get("/api/portal/inquiries", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const data = await storage.getPortalInquiries(getOrgId());
    res.json(data);
  });

  app.patch("/api/portal/inquiries/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const updated = await storage.updatePortalInquiry(Number(req.params.id), req.body);
    res.json(updated);
  });

  app.get("/api/public/listings", async (_req, res) => {
    const listings = await storage.getPublishedListings();
    const safe = listings.map(l => ({
      id: l.id,
      title: l.title,
      subtitle: l.subtitle,
      description: l.description,
      featuredImage: l.featuredImage,
      galleryImages: l.galleryImages || [],
      visibilityLevel: l.visibilityLevel,
      contactEmail: l.contactEmail,
      contactPhone: l.contactPhone,
      accentColor: l.accentColor,
      highlights: l.highlights || [],
      publishedAt: l.publishedAt,
      createdAt: l.createdAt,
      asset: l.asset ? {
        id: l.asset.id,
        type: l.asset.type,
        title: l.asset.title,
        description: l.asset.description,
        municipio: l.asset.municipio,
        estado: l.asset.estado,
        priceAsking: l.visibilityLevel === "full" ? l.asset.priceAsking : null,
        areaHa: l.asset.areaHa,
        areaUtil: l.asset.areaUtil,
        tags: l.asset.tags,
        docsStatus: l.asset.docsStatus,
      } : null,
    }));
    res.json(safe);
  });

  app.get("/api/public/listings/:id", async (req, res) => {
    const listing = await storage.getPortalListing(Number(req.params.id));
    if (!listing || listing.status !== "published") return res.status(404).json({ message: "Não encontrado" });
    try {
      await storage.updatePortalListing(listing.id, { viewCount: (listing.viewCount || 0) + 1 });
    } catch {}
    const safe = {
      id: listing.id,
      title: listing.title,
      subtitle: listing.subtitle,
      description: listing.description,
      featuredImage: listing.featuredImage,
      galleryImages: listing.galleryImages || [],
      visibilityLevel: listing.visibilityLevel,
      contactEmail: listing.contactEmail,
      contactPhone: listing.contactPhone,
      accentColor: listing.accentColor,
      sectionsConfig: listing.sectionsConfig || [],
      highlights: listing.highlights || [],
      publishedAt: listing.publishedAt,
      createdAt: listing.createdAt,
      viewCount: (listing.viewCount || 0) + 1,
      asset: listing.asset ? {
        id: listing.asset.id,
        type: listing.asset.type,
        title: listing.asset.title,
        description: listing.asset.description,
        municipio: listing.asset.municipio,
        estado: listing.asset.estado,
        location: listing.asset.location,
        priceAsking: listing.visibilityLevel === "full" ? listing.asset.priceAsking : null,
        areaHa: listing.asset.areaHa,
        areaUtil: listing.asset.areaUtil,
        tags: listing.asset.tags,
        docsStatus: listing.asset.docsStatus,
        observacoes: listing.asset.observacoes,
      } : null,
    };
    res.json(safe);
  });

  app.post("/api/public/inquiries", async (req, res) => {
    try {
      const clientIp = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkRateLimit(clientIp)) {
        return res.status(429).json({ message: "Muitas solicitações. Tente novamente em breve." });
      }

      const { listingId, landingPageId, name, email, phone, company, message } = req.body;
      if (!name || !email) return res.status(400).json({ message: "Nome e email são obrigatórios" });
      if (!listingId && !landingPageId) return res.status(400).json({ message: "listingId ou landingPageId é obrigatório" });

      const orgId = getOrgId();
      let assetId: number | null = null;
      let contextTitle = "";

      if (listingId) {
        const listing = await storage.getPortalListing(listingId);
        if (listing) {
          assetId = listing.assetId || null;
          contextTitle = listing.title || "Listing";
        }
      } else if (landingPageId) {
        const lp = await storage.getAssetLandingPage(landingPageId);
        if (lp) {
          assetId = lp.assetId || null;
          contextTitle = lp.title;
        }
      }

      const { score: intentScore, signals: intentSignals } = computeIntent({ phone, message, assetId });

      const inquiry = await storage.createPortalInquiry({
        orgId,
        listingId: listingId || null,
        landingPageId: landingPageId || null,
        assetId,
        name, email, phone, company, message,
        intentScore,
        intentSignalsJson: intentSignals,
      });

      setImmediate(async () => {
        try {
          if (!process.env.RESEND_API_KEY) return;
          if (!inquiry || (inquiry.intentScore || 0) < 50) return;
          const notifyEmail = process.env.NOTIFY_EMAIL;
          if (!notifyEmail) return;

          const { Resend } = await import("resend");
          const resend = new Resend(process.env.RESEND_API_KEY);
          const emoji = (inquiry.intentScore || 0) >= 70 ? "🔥" : "⚡";

          await resend.emails.send({
            from: "Mavrion <noreply@mavrion.com.br>",
            to: [notifyEmail],
            subject: `${emoji} Novo lead: ${inquiry.name}`,
            html: `<div style="font-family:sans-serif;max-width:580px">
              <h2 style="color:#059669">Novo lead pelo portal</h2>
              <p><b>Nome:</b> ${inquiry.name}</p>
              <p><b>Email:</b> ${inquiry.email}</p>
              <p><b>Telefone:</b> ${inquiry.phone || "—"}</p>
              <p><b>Score:</b> <strong style="color:${(inquiry.intentScore||0)>=70?"#059669":"#d97706"}">${inquiry.intentScore}/100</strong></p>
              <p><b>Mensagem:</b> ${inquiry.message || "—"}</p>
              <br>
              <a href="${process.env.APP_URL || "https://mavrionconnect.com.br"}/crm"
                 style="background:#059669;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold">
                Ver no CRM →
              </a>
            </div>`,
          });
        } catch (err) {
          console.error("Email lead error:", err);
        }
      });

      try {
        const emailLower = email.toLowerCase().trim();
        const allCompanies = await db.select().from(companies).where(eq(companies.orgId, orgId));
        let existingCompany = allCompanies.find((c: any) => {
          const emails = (c.emails as string[]) || [];
          return emails.some((e: string) => e.toLowerCase() === emailLower);
        });

        let companyId: number;
        if (existingCompany) {
          companyId = existingCompany.id;
        } else {
          const [newCompany] = await db.insert(companies).values({
            orgId,
            legalName: company || name,
            tradeName: company || null,
            emails: [email],
            phones: phone ? [phone] : [],
            source: "portal",
          } as any).returning();
          companyId = newCompany.id;
        }

        const [lead] = await db.insert(leads).values({
          orgId,
          companyId,
          status: "new",
          score: intentScore,
          source: "PORTAL",
          scoreBreakdownJson: { signals: intentSignals, origin: "portal", contextTitle },
        } as any).returning();

        await db.update(portalInquiries).set({ leadId: lead.id } as any).where(eq(portalInquiries.id, inquiry.id));

        let dealCreated = false;
        let dealId: number | null = null;
        if (intentScore >= 50) {
          const stages = await db.select().from(pipelineStages)
            .where(eq(pipelineStages.pipelineType, "INVESTOR"))
            .orderBy(asc(pipelineStages.order))
            .limit(1);
          if (stages.length > 0) {
            let amountEstimate: number | null = null;
            if (assetId) {
              const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
              if (asset) amountEstimate = asset.priceAsking || null;
            }
            const [deal] = await db.insert(deals).values({
              orgId,
              pipelineType: "INVESTOR",
              stageId: stages[0].id,
              title: `Lead Portal: ${name} — ${contextTitle || "Interesse"}`,
              description: `Interesse via portal.\nNome: ${name}\nEmail: ${email}\nTelefone: ${phone || "N/A"}\nMensagem: ${message || "N/A"}\nIntent Score: ${intentScore}%`,
              companyId,
              assetId,
              amountEstimate,
              labels: ["Portal", `Intent ${intentScore}%`],
              source: "PORTAL",
            } as any).returning();
            dealId = deal.id;
            dealCreated = true;
            await db.update(portalInquiries).set({ dealId: deal.id } as any).where(eq(portalInquiries.id, inquiry.id));
          }
        }

        const notifType = dealCreated ? "new_deal_portal" : "new_lead_portal";
        const notifTitle = dealCreated
          ? `Novo Deal via Portal (Intent ${intentScore}%) — Lead qualificado`
          : `Novo Lead via Portal`;
        const notifMsg = `${name} (${company || email}) demonstrou interesse em "${contextTitle || "portal"}"`;

        sendNotification({
          id: notifId(),
          type: notifType,
          orgId,
          title: notifTitle,
          message: notifMsg,
          link: dealCreated ? "/crm" : "/portal-admin",
          createdAt: new Date().toISOString(),
        });
      } catch (crmErr) {
        console.error("Portal→CRM integration error (inquiry saved):", crmErr);
      }

      res.status(201).json({ ...inquiry, dealCreated: !!dealId, dealId });
    } catch (err) {
      console.error("Portal inquiry error:", err);
      res.status(500).json({ message: "Erro ao enviar interesse" });
    }
  });

  app.post("/api/portal/inquiries/:id/create-deal", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId();
      const inqId = Number(req.params.id);
      const inq = await storage.getPortalInquiry(inqId);
      if (!inq || inq.orgId !== orgId) return res.status(404).json({ message: "Inquiry não encontrada" });

      if (inq.dealId) {
        return res.json({ success: true, dealId: inq.dealId, message: "Deal já existe" });
      }

      let companyId: number | null = null;
      let leadId = inq.leadId;

      if (!leadId) {
        const emailLower = (inq.email || "").toLowerCase().trim();
        const allComps = await db.select().from(companies).where(eq(companies.orgId, orgId));
        const existing = allComps.find((c: any) => {
          const emails = (c.emails as string[]) || [];
          return emails.some((e: string) => e.toLowerCase() === emailLower);
        });

        if (existing) {
          companyId = existing.id;
        } else {
          const [newComp] = await db.insert(companies).values({
            orgId,
            legalName: inq.company || inq.name,
            tradeName: inq.company || null,
            emails: inq.email ? [inq.email] : [],
            phones: inq.phone ? [inq.phone] : [],
            source: "portal",
          } as any).returning();
          companyId = newComp.id;
        }

        const [lead] = await db.insert(leads).values({
          orgId,
          companyId,
          status: "new",
          score: inq.intentScore || 50,
          source: "PORTAL",
          scoreBreakdownJson: { origin: "portal_manual_promote" },
        } as any).returning();
        leadId = lead.id;
        await db.update(portalInquiries).set({ leadId: lead.id } as any).where(eq(portalInquiries.id, inqId));
      } else {
        const [existingLead] = await db.select().from(leads).where(eq(leads.id, leadId));
        if (existingLead) companyId = existingLead.companyId;
      }

      const stages = await db.select().from(pipelineStages)
        .where(eq(pipelineStages.pipelineType, "INVESTOR"))
        .orderBy(asc(pipelineStages.order))
        .limit(1);
      if (stages.length === 0) return res.status(400).json({ message: "Nenhum estágio INVESTOR configurado" });

      let contextTitle = "Interesse";
      if (inq.listingId) {
        const listing = await storage.getPortalListing(inq.listingId);
        if (listing) contextTitle = listing.title || "Listing";
      } else if (inq.landingPageId) {
        const lp = await storage.getAssetLandingPage(inq.landingPageId);
        if (lp) contextTitle = lp.title;
      }

      const [deal] = await db.insert(deals).values({
        orgId,
        pipelineType: "INVESTOR",
        stageId: stages[0].id,
        title: `Portal: ${inq.company || inq.name} — ${contextTitle}`,
        description: `Promovido manualmente do portal.\nNome: ${inq.name}\nEmail: ${inq.email}\nTelefone: ${inq.phone || "N/A"}\nMensagem: ${inq.message || "N/A"}`,
        companyId,
        assetId: inq.assetId,
        labels: ["Portal", "Manual"],
        source: "PORTAL",
      } as any).returning();

      await db.update(portalInquiries).set({ dealId: deal.id } as any).where(eq(portalInquiries.id, inqId));

      res.json({ success: true, dealId: deal.id });
    } catch (err) {
      console.error("Create deal from inquiry error:", err);
      res.status(500).json({ message: "Erro ao criar deal" });
    }
  });

  app.get("/api/landing-pages", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const data = await storage.getAssetLandingPages(getOrgId());
    res.json(data);
  });

  app.post("/api/landing-pages", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const { orgId: _s, ...lpBody } = req.body;
    const parsed = insertAssetLandingPageSchema.safeParse({ ...lpBody, orgId: getOrgId() });
    if (!parsed.success) return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.flatten() });
    try {
      const page = await storage.createAssetLandingPage(parsed.data);
      res.status(201).json(page);
    } catch (err: any) {
      if (err.message?.includes("unique") || err.code === "23505") {
        return res.status(409).json({ message: "Slug já existe. Escolha outro." });
      }
      res.status(500).json({ message: "Erro ao criar landing page" });
    }
  });

  app.patch("/api/landing-pages/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const id = Number(req.params.id);
    const data = req.body;
    if (data.status === "published" && !data.publishedAt) {
      data.publishedAt = new Date();
    }
    const partial = insertAssetLandingPageSchema.partial().safeParse(data);
    if (!partial.success) return res.status(400).json({ message: "Dados inválidos", errors: partial.error.flatten() });
    try {
      const updated = await storage.updateAssetLandingPage(id, partial.data);
      res.json(updated);
    } catch (err: any) {
      if (err.message?.includes("unique") || err.code === "23505") {
        return res.status(409).json({ message: "Slug já existe. Escolha outro." });
      }
      res.status(500).json({ message: "Erro ao atualizar landing page" });
    }
  });

  app.delete("/api/landing-pages/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    await storage.deleteAssetLandingPage(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get("/api/public/lp/:slug", async (req, res) => {
    const page = await storage.getAssetLandingPageBySlug(req.params.slug);
    if (!page || page.status !== "published") return res.status(404).json({ message: "Página não encontrada" });
    try {
      await storage.updateAssetLandingPage(page.id, { viewCount: (page.viewCount || 0) + 1 });
    } catch {}
    const safe = {
      id: page.id,
      slug: page.slug,
      title: page.title,
      subtitle: page.subtitle,
      description: page.description,
      featuredImage: page.featuredImage,
      galleryImages: page.galleryImages || [],
      accentColor: page.accentColor,
      sectionsConfig: page.sectionsConfig || [],
      highlights: page.highlights || [],
      contactEmail: page.contactEmail,
      contactPhone: page.contactPhone,
      viewCount: (page.viewCount || 0) + 1,
      publishedAt: page.publishedAt,
      createdAt: page.createdAt,
      asset: page.asset ? {
        id: page.asset.id,
        type: page.asset.type,
        title: page.asset.title,
        description: page.asset.description,
        municipio: page.asset.municipio,
        estado: page.asset.estado,
        location: page.asset.location,
        priceAsking: page.asset.priceAsking,
        areaHa: page.asset.areaHa,
        areaUtil: page.asset.areaUtil,
        tags: page.asset.tags,
        docsStatus: page.asset.docsStatus,
        observacoes: page.asset.observacoes,
      } : null,
    };
    res.json(safe);
  });

  app.get("/api/public/showcase/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "ID inválido" });

    try {
      let rows: any;
      try {
        rows = await db.execute(sql`
          SELECT a.id, a.org_id, a.type, a.title, a.description, a.location, a.municipio, a.estado,
                 a.price_asking, a.area_ha, a.area_util, a.tags, a.fotos,
                 a.campos_especificos, a.attributes_json,
                 a.geo_alt_med, a.geo_alt_min, a.geo_alt_max, a.geo_decliv_med,
                 a.geo_tem_rio, a.geo_tem_lago, a.geo_dist_agua_m, a.geo_tem_energia,
                 a.geo_dist_energia_m, a.geo_score, a.geo_score_energia,
                 a.anm_processo, a.car_cod_imovel, a.created_at,
                 ST_AsGeoJSON(a.geom) as geom_json,
                 c.trade_name
          FROM assets a
          LEFT JOIN companies c ON a.linked_company_id = c.id
          WHERE a.id = ${id}
        `);
      } catch (geoErr: any) {
        if (geoErr?.code === '42883' || geoErr?.code === '42703') {
          rows = await db.execute(sql`
            SELECT a.id, a.org_id, a.type, a.title, a.description, a.location, a.municipio, a.estado,
                   a.price_asking, a.area_ha, a.area_util, a.tags, a.fotos,
                   a.campos_especificos, a.attributes_json,
                   a.geo_alt_med, a.geo_alt_min, a.geo_alt_max, a.geo_decliv_med,
                   a.geo_tem_rio, a.geo_tem_lago, a.geo_dist_agua_m, a.geo_tem_energia,
                   a.geo_dist_energia_m, a.geo_score, a.geo_score_energia,
                   a.anm_processo, a.car_cod_imovel, a.created_at,
                   NULL as geom_json,
                   c.trade_name
            FROM assets a
            LEFT JOIN companies c ON a.linked_company_id = c.id
            WHERE a.id = ${id}
          `);
        } else {
          throw geoErr;
        }
      }

      const asset = (rows as any).rows?.[0];
      if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });

      const campos = asset.campos_especificos || {};
      const attrs = asset.attributes_json || {};

      let settings: Record<string, any> = {};
      try {
        const allSettings = await storage.getOrgSettings(asset.org_id || 1);
        if (allSettings && typeof allSettings === "object") settings = allSettings as any;
      } catch {}

      const anmLive = campos.anmLiveData?.features?.[0] || null;

      const showcase = {
        id: asset.id,
        type: asset.type,
        title: asset.title,
        description: asset.description,
        location: asset.location,
        municipio: asset.municipio,
        estado: asset.estado,
        priceAsking: asset.price_asking,
        areaHa: asset.area_ha,
        areaUtil: asset.area_util,
        tags: asset.tags || [],
        fotos: asset.fotos || [],

        geometry: asset.geom_json ? JSON.parse(asset.geom_json) : null,

        geoAltMed: asset.geo_alt_med,
        geoAltMin: asset.geo_alt_min,
        geoAltMax: asset.geo_alt_max,
        geoDecliv: asset.geo_decliv_med,
        geoTemRio: asset.geo_tem_rio,
        geoTemLago: asset.geo_tem_lago,
        geoDistAgua: asset.geo_dist_agua_m,
        geoDistEnergia: asset.geo_dist_energia_m,
        geoScore: asset.geo_score,
        geoScoreEnergia: asset.geo_score_energia,

        anmProcesso: asset.anm_processo,
        carCodImovel: asset.car_cod_imovel,

        empresa: {
          tradeName: asset.trade_name || null,
        },

        certidoesData: campos.certidoesData ? {
          status: campos.certidoesData.status || null,
          resumo: campos.certidoesData.resumo || null,
        } : null,

        embrapa: campos.embrapa ? {
          solo: campos.embrapa.solo || null,
          zoneamento: campos.embrapa.zoneamento || null,
          ndvi: campos.embrapa.ndvi || null,
          clima: campos.embrapa.clima || null,
          scoreAgro: campos.embrapa.scoreAgro || null,
          resumo: campos.embrapa.resumo || null,
        } : null,

        ibama: {
          temEmbargo: campos.temEmbargoIbama || false,
        },

        mapbiomas: campos.mapbiomas || null,

        anmNome: anmLive?.NOME || attrs.anmNome || null,
        anmSubstancia: anmLive?.SUBS || attrs.anmSubstancia || null,
        anmFase: anmLive?.FASE || attrs.anmFase || null,
        anmUltimoEvento: anmLive?.ULT_EVENTO || attrs.anmUltimoEvento || null,
        anmArea: anmLive?.AREA_HA || attrs.anmArea || null,
        anmTipo: anmLive?.TIPO || null,
        anmSituacao: anmLive?.DSProcesso || null,

        setor: campos.setor || null,

        cafData: campos.cafData ? {
          totalProdutores: campos.cafData.totalProdutores || 0,
          totalFamilias: campos.cafData.totalFamilias || 0,
          totalMembros: campos.cafData.totalMembros || 0,
          areaTotal: campos.cafData.areaTotal || null,
          mediaAreaHa: campos.cafData.mediaAreaHa || null,
          totalComPronaf: campos.cafData.totalComPronaf || 0,
          municipioBuscado: campos.cafData.municipioBuscado || null,
          ufBuscado: campos.cafData.ufBuscado || null,
          produtores: (campos.cafData.produtores || []).slice(0, 30).map((p: any) => ({
            nome: p.nome || "N/D",
            nufpa: p.nufpa || "",
            municipio: p.municipio || "",
            uf: p.uf || "",
            areaHa: p.areaHa || null,
            atividade: p.atividade || "",
            condicaoPosse: p.condicaoPosse || "",
            pronaf: p.pronaf || "",
            status: p.status || "",
            perfil: p.perfil || "baixo",
            totalMembros: p.totalMembros || 1,
          })),
        } : null,
        cafUpdatedAt: campos.cafUpdatedAt || null,

        enrichmentAgro: campos.enrichmentAgro || null,

        companyName: settings.company_name || "Mavrion Connect",
        logoUrl: settings.logo_url || null,
        showcaseWhatsapp: settings.showcase_whatsapp || null,

        updatedAt: campos.embrapaUpdatedAt || campos.certidoesDataUpdatedAt || asset.created_at,
      };

      res.json(showcase);
    } catch (err: any) {
      console.error("Erro showcase:", err);
      res.status(500).json({ message: "Erro ao gerar vitrine" });
    }
  });

  app.get("/api/matching/assets/:id/showcase-check", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const id = Number(req.params.id);
    const asset = await storage.getAsset(id);
    if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });

    const campos = (asset.camposEspecificos || {}) as any;
    const fotos = (asset.fotos || []) as any[];
    const warnings: string[] = [];

    if (!asset.title) warnings.push("Título não definido");
    if (!asset.municipio && !asset.estado) warnings.push("Localização não definida");
    if (fotos.length === 0) warnings.push("Nenhuma foto cadastrada");
    if (!asset.description) warnings.push("Sem descrição");

    res.json({
      ready: warnings.length <= 1,
      warnings,
      url: `/vitrine/${id}`,
    });
  });
}
