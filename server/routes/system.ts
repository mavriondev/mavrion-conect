import type { Express } from "express";
import type { IStorage } from "../storage";
import { api } from "@shared/routes";
import { rawIngests, deals, assets, leads, matchSuggestions, pipelineStages, portalInquiries } from "@shared/schema";
import { z } from "zod";
import { sql, count, sum, and, eq, gte, lt, desc } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "../db";
import { scheduleConnector, unscheduleConnector, runConnectorJob, getSchedulerStatus } from "../scheduler";
import cron from "node-cron";
import { addSSEClient } from "../notifications";
import { getOrgId } from "../lib/tenant";

const uploadsDir = path.join(process.cwd(), "server", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `logo_${Date.now()}${ext}`);
  },
});
const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Apenas imagens são permitidas"));
  },
});

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Tipo de arquivo não permitido. Apenas JPG, PNG, WebP e GIF são aceitos."));
  },
});

export function registerSystemRoutes(app: Express, storage: IStorage) {
  app.get(api.connectors.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const data = await storage.getConnectors();
    res.json(data);
  });

  app.post(api.connectors.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const input = api.connectors.create.input.parse(req.body);
      if (input.schedule && !cron.validate(input.schedule)) {
        return res.status(400).json({ message: `Expressão cron inválida: "${input.schedule}"` });
      }
      const data = await storage.createConnector(input);
      scheduleConnector(data);
      res.status(201).json(data);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json(err.errors);
      res.status(500).json({ message: "Internal Error" });
    }
  });

  app.put(api.connectors.update.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const input = api.connectors.update.input.parse(req.body);
      if (input.schedule && !cron.validate(input.schedule)) {
        return res.status(400).json({ message: `Expressão cron inválida: "${input.schedule}"` });
      }
      const data = await storage.updateConnector(Number(req.params.id), input);
      scheduleConnector(data);
      res.json(data);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json(err.errors);
      res.status(500).json({ message: "Internal Error" });
    }
  });

  app.delete(api.connectors.delete.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const id = Number(req.params.id);
      unscheduleConnector(id);
      await storage.deleteConnector(id);
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ message: "Internal Error" });
    }
  });

  app.post(api.connectors.run.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const id = Number(req.params.id);
      const connector = await storage.getConnector(id);
      if (!connector) return res.status(404).json({ message: "Connector não encontrado" });
      runConnectorJob(connector).catch(err => console.error("Erro na execução manual:", err));
      res.json({ success: true, message: "Connector iniciado em background" });
    } catch (err) {
      res.status(500).json({ message: "Failed to trigger connector" });
    }
  });

  app.get("/api/org/settings", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const all = await storage.getAllOrgSettings(1);
      res.json({
        logo_url: all.logo_url || null,
        company_name: all.company_name || "",
        drive_connected: all.drive_connected || false,
        portal_hero_image: all.portal_hero_image || null,
        portal_title: all.portal_title || null,
        portal_subtitle: all.portal_subtitle || null,
        portal_why_title: all.portal_why_title || null,
        portal_why_bullets: all.portal_why_bullets || null,
        portal_accent_color: all.portal_accent_color || null,
        portal_contact: all.portal_contact || null,
        showcase_phone: all.showcase_phone || "",
        showcase_whatsapp: all.showcase_whatsapp || "",
      });
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.put("/api/org/settings/:key", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { value } = req.body;
      const setting = await storage.setOrgSetting(1, req.params.key, value);
      res.json(setting);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.post("/api/upload/logo", logoUpload.single("logo"), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
      if (!req.file) return res.status(400).json({ message: "Nenhum arquivo enviado" });
      const logoUrl = `/uploads/${req.file.filename}`;
      await storage.setOrgSetting(1, "logo_url", logoUrl);
      res.json({ url: logoUrl });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Erro ao fazer upload" });
    }
  });

  app.post("/api/upload/images", imageUpload.array("images", 10), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) return res.status(400).json({ message: "Nenhum arquivo enviado" });
      const urls = files.map(f => `/uploads/${f.filename}`);
      res.json({ urls });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Erro ao fazer upload" });
    }
  });

  const validErrorStatuses = ["open", "in_progress", "resolved", "closed"];
  const validErrorPriorities = ["low", "medium", "high", "critical"];

  app.get("/api/error-reports", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const reports = await storage.getErrorReports(getOrgId());
    res.json(reports);
  });

  app.get("/api/error-reports/stats", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const stats = await storage.getErrorReportStats(getOrgId());
    res.json(stats);
  });

  app.get("/api/error-reports/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const report = await storage.getErrorReport(Number(req.params.id));
    if (!report || report.orgId !== getOrgId()) return res.status(404).json({ message: "Not found" });
    res.json(report);
  });

  app.post("/api/error-reports", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const { title, description, page, module, priority } = req.body;
    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ message: "Título é obrigatório" });
    }
    const report = await storage.createErrorReport({
      orgId: getOrgId(),
      type: "user_report",
      title: title.trim(),
      description: description || null,
      page: page || null,
      module: module || null,
      priority: validErrorPriorities.includes(priority) ? priority : "medium",
      reportedBy: user.username || user.name || "unknown",
      userAgent: req.body.userAgent || null,
    });
    res.status(201).json(report);
  });

  app.post("/api/error-reports/auto", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const { url, method, statusCode, errorMessage, stack, page } = req.body;
    const report = await storage.createErrorReport({
      orgId: getOrgId(),
      type: "auto_capture",
      title: `[Auto] ${method || "GET"} ${url || "unknown"} → ${statusCode || "Error"}`,
      description: (errorMessage || "Erro capturado automaticamente").substring(0, 2000),
      page: page || null,
      requestUrl: url || null,
      requestMethod: method || null,
      statusCode: statusCode ? Number(statusCode) : null,
      errorStack: stack ? String(stack).substring(0, 5000) : null,
      reportedBy: user.username || "system",
      priority: statusCode && statusCode >= 500 ? "high" : "medium",
    });
    res.status(201).json(report);
  });

  app.patch("/api/error-reports/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const { status, priority } = req.body;
    const updates: any = {};
    if (status && validErrorStatuses.includes(status)) {
      updates.status = status;
      if (status === "resolved" || status === "closed") {
        updates.resolvedAt = new Date();
        updates.resolvedBy = user.username || user.name;
      }
    }
    if (priority && validErrorPriorities.includes(priority)) {
      updates.priority = priority;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "Nenhum campo válido para atualizar" });
    }
    const report = await storage.updateErrorReport(Number(req.params.id), getOrgId(), updates);
    if (!report) return res.status(404).json({ message: "Not found" });
    res.json(report);
  });

  app.get("/api/health/services", async (_req, res) => {
    const checkService = async (url: string, timeout = 5000): Promise<boolean> => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        const resp = await fetch(url, { signal: controller.signal, method: "HEAD" });
        clearTimeout(timer);
        return resp.ok || resp.status < 500;
      } catch {
        return false;
      }
    };

    const [anm, sicar] = await Promise.all([
      checkService("https://geo.anm.gov.br/arcgis/rest/services"),
      checkService("https://geoserver.car.gov.br/geoserver/web/"),
    ]);

    res.json({
      anm: anm ? "online" : "offline",
      sicar: sicar ? "online" : "offline",
      checkedAt: new Date().toISOString(),
    });
  });

  app.get("/api/scheduler/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    res.json(getSchedulerStatus());
  });

  app.get("/api/audit-logs", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const { entity, entityId, limit } = req.query;
    const logs = await storage.getAuditLogs(getOrgId(), {
      entity: entity as string | undefined,
      entityId: entityId ? Number(entityId) : undefined,
      limit: limit ? Math.min(Number(limit), 500) : 100,
    });
    res.json(logs);
  });

  const CACHE_NS = ["anm", "sicar", "cnpja", "geo"];

  app.get("/api/cache/stats", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    try {
      const rows = await db.select().from(rawIngests);
      const namespaces: Record<string, { count: number; expired: number }> = {};
      let total = 0;
      const now = new Date();
      for (const row of rows) {
        const ns = (row.externalId || "").split(":")[0] || "unknown";
        if (!CACHE_NS.includes(ns)) continue;
        if (!namespaces[ns]) namespaces[ns] = { count: 0, expired: 0 };
        namespaces[ns].count++;
        total++;
        const expiresAt = new Date(row.hashDedupe);
        if (!isNaN(expiresAt.getTime()) && expiresAt < now) {
          namespaces[ns].expired++;
        }
      }
      res.json({ total, namespaces });
    } catch (err) {
      res.status(500).json({ message: "Erro ao obter estatísticas do cache" });
    }
  });

  app.delete("/api/cache/flush/:namespace", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    if (user.role !== "admin") return res.status(403).json({ message: "Forbidden" });

    const ns = req.params.namespace;
    if (ns !== "all" && !CACHE_NS.includes(ns)) {
      return res.status(400).json({ message: `Namespace inválido. Use: ${CACHE_NS.join(", ")} ou all` });
    }
    try {
      if (ns === "all") {
        for (const n of CACHE_NS) {
          await db.execute(sql`DELETE FROM raw_ingests WHERE external_id LIKE ${n + ":%"}`);
        }
      } else {
        await db.execute(sql`DELETE FROM raw_ingests WHERE external_id LIKE ${ns + ":%"}`);
      }
      res.json({ success: true, message: `Cache ${ns} limpo.` });
    } catch (err) {
      res.status(500).json({ message: "Erro ao limpar cache" });
    }
  });

  app.get("/api/notifications/stream", (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).end();
    const user = req.user as any;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 30000);

    res.on("close", () => clearInterval(heartbeat));

    addSSEClient(getOrgId(), res);

    res.write(`data: ${JSON.stringify({ type: "connected", orgId: getOrgId() })}\n\n`);
  });

  app.get("/api/dashboard/quotes", async (req, res) => {
    try {
      const results: Record<string, any> = {};

      const [quotesRes, selicRes] = await Promise.allSettled([
        fetch("https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL,BTC-BRL").then(r => r.json()),
        fetch("https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json").then(r => r.json()),
      ]);

      if (quotesRes.status === "fulfilled") {
        if (quotesRes.value.USDBRL) results.dollar = quotesRes.value.USDBRL;
        if (quotesRes.value.EURBRL) results.euro = quotesRes.value.EURBRL;
        if (quotesRes.value.BTCBRL) results.btc = quotesRes.value.BTCBRL;
      }
      if (selicRes.status === "fulfilled" && selicRes.value?.[0]) {
        results.selic = selicRes.value[0];
      }

      res.json(results);
    } catch (err) {
      res.status(500).json({ message: "Erro ao buscar cotações" });
    }
  });

  app.get("/api/dashboard/stats", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });

    try {
      const orgId = getOrgId(req);
      const agora = new Date();
      const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
      const limite24h = new Date(Date.now() - 86400000);
      const limite15d = new Date(Date.now() - 15 * 86400000);

      const [ativosAtivos, ativosEmNeg, dealsResult, leadsNovos, leadsQualif, portal24h, matchesPend] =
        await Promise.all([
          db.select({ count: count() }).from(assets).where(and(eq(assets.orgId, orgId), eq(assets.statusAtivo, "ativo"))),
          db.select({ count: count() }).from(assets).where(and(eq(assets.orgId, orgId), eq(assets.statusAtivo, "em_negociacao"))),
          db.select({ count: count(), volume: sum(deals.amountEstimate) }).from(deals).where(eq(deals.orgId, orgId)),
          db.select({ count: count() }).from(leads).where(and(eq(leads.orgId, orgId), eq(leads.status, "new"))),
          db.select({ count: count() }).from(leads).where(and(eq(leads.orgId, orgId), gte(leads.score, 60))),
          db.select({ count: count() }).from(portalInquiries).where(and(eq(portalInquiries.orgId, orgId), gte(portalInquiries.createdAt, limite24h))),
          db.select({ count: count() }).from(matchSuggestions).where(and(eq(matchSuggestions.orgId, orgId), eq(matchSuggestions.status, "new"))),
        ]);

      const porEstagio = await db.select({ stageId: deals.stageId, count: count(), volume: sum(deals.amountEstimate) })
        .from(deals).where(eq(deals.orgId, orgId)).groupBy(deals.stageId);

      const stages = await db.select().from(pipelineStages).where(eq(pipelineStages.orgId, orgId));

      const dealsParados = await db.select({ id: deals.id, title: deals.title, updatedAt: deals.createdAt })
        .from(deals).where(and(eq(deals.orgId, orgId), lt(deals.createdAt, limite15d)))
        .orderBy(desc(deals.createdAt)).limit(5);

      const leadsRecentes = await db.select().from(portalInquiries)
        .where(and(eq(portalInquiries.orgId, orgId), gte(portalInquiries.createdAt, limite24h)))
        .orderBy(desc(portalInquiries.createdAt)).limit(8);

      res.json({
        ativos: {
          total: Number(ativosAtivos[0]?.count || 0),
          emNegociacao: Number(ativosEmNeg[0]?.count || 0),
        },
        deals: {
          total: Number(dealsResult[0]?.count || 0),
          volumeTotal: Number(dealsResult[0]?.volume || 0),
          porEstagio: porEstagio.map(e => ({
            stageId: e.stageId,
            stageName: stages.find(s => s.id === e.stageId)?.name || "—",
            count: Number(e.count),
            volumeTotal: Number(e.volume || 0),
          })),
          parados: dealsParados.map(d => ({
            id: d.id, title: d.title,
            diasParado: Math.floor((Date.now() - new Date(d.updatedAt!).getTime()) / 86400000),
          })),
        },
        leads: {
          novos: Number(leadsNovos[0]?.count || 0),
          qualificados: Number(leadsQualif[0]?.count || 0),
          portal24h: Number(portal24h[0]?.count || 0),
          recentes: leadsRecentes,
        },
        matchesPendentes: Number(matchesPend[0]?.count || 0),
      });
    } catch (err) {
      console.error("Dashboard error:", err);
      res.status(500).json({ message: "Erro ao carregar dashboard" });
    }
  });
}
