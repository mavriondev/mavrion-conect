import type { Express } from "express";
import { mapAiError } from "../lib/ai-error";
import { analyzeAsset, summarizeCompany, naturalLanguageSearch, diagnoseError, pricingAdvisor, monitorErrors, deepIntelligenceAnalysis } from "../lib/ai-agents";
import { db } from "../db";
import { storage } from "../storage";
import { companies, errorReports } from "@shared/schema";
import { eq } from "drizzle-orm";


const rateLimitMap = new Map<number, number>();
const RATE_LIMIT_MS = 5000;

function checkRateLimit(userId: number): boolean {
  const last = rateLimitMap.get(userId) || 0;
  if (Date.now() - last < RATE_LIMIT_MS) return false;
  rateLimitMap.set(userId, Date.now());
  return true;
}

export function registerAiRoutes(app: Express) {
  app.post("/api/ai/analyze-asset/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    if (!checkRateLimit(user.id)) return res.status(429).json({ message: "Aguarde alguns segundos antes de fazer outra análise" });

    try {
      const assetId = Number(req.params.id);
      const analise = await analyzeAsset(assetId, user.orgId);

      try {
        // merge atômico: só o delta, sem regravar o objeto inteiro
        await storage.mergeAssetCampos(assetId, { iaAnalise: analise, iaAnaliseDate: new Date().toISOString() });
      } catch (e: any) {
        console.error("[AI] Erro ao persistir análise:", e.message);
      }

      res.json({ analise });
    } catch (error: any) {
      console.error("[AI] Erro analyze-asset:", error.message);
      const mapped = mapAiError(error, "Erro ao analisar ativo");
      res.status(mapped.status).json({ message: mapped.message });
    }
  });

  app.post("/api/ai/summarize-company/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    if (!checkRateLimit(user.id)) return res.status(429).json({ message: "Aguarde alguns segundos antes de fazer outra análise" });

    try {
      const companyId = Number(req.params.id);
      const resumo = await summarizeCompany(companyId, user.orgId);

      try {
        const [empresa] = await db.select().from(companies).where(eq(companies.id, companyId));
        if (empresa) {
          const enrichment = (empresa.enrichmentData || {}) as any;
          enrichment.iaResumo = resumo;
          enrichment.iaResumoDate = new Date().toISOString();
          await db.update(companies).set({ enrichmentData: enrichment }).where(eq(companies.id, companyId));
        }
      } catch (e: any) {
        console.error("[AI] Erro ao persistir resumo:", e.message);
      }

      res.json({ resumo });
    } catch (error: any) {
      console.error("[AI] Erro summarize-company:", error.message);
      const mapped = mapAiError(error, "Erro ao resumir empresa");
      res.status(mapped.status).json({ message: mapped.message });
    }
  });

  app.post("/api/ai/search", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    if (!checkRateLimit(user.id)) return res.status(429).json({ message: "Aguarde alguns segundos" });

    try {
      const { query } = req.body;
      if (!query || typeof query !== "string" || query.trim().length < 3) {
        return res.status(400).json({ message: "Descreva o que procura (mínimo 3 caracteres)" });
      }
      const resultado = await naturalLanguageSearch(query.trim(), user.orgId);
      res.json(resultado);
    } catch (error: any) {
      console.error("[AI] Erro search:", error.message);
      const mapped = mapAiError(error, "Erro na busca");
      res.status(mapped.status).json({ message: mapped.message });
    }
  });

  app.post("/api/ai/diagnose-error/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    if (!checkRateLimit(user.id)) return res.status(429).json({ message: "Aguarde alguns segundos" });

    try {
      const errorId = Number(req.params.id);
      const diagnostico = await diagnoseError(errorId, user.orgId);

      try {
        const [erro] = await db.select().from(errorReports).where(eq(errorReports.id, errorId));
        if (erro) {
          const metadata = (erro.metadata || {}) as any;
          metadata.aiDiagnosis = diagnostico;
          metadata.aiDiagnosisDate = new Date().toISOString();
          await db.update(errorReports).set({ metadata }).where(eq(errorReports.id, errorId));
        }
      } catch (e: any) {
        console.error("[AI] Erro ao persistir diagnóstico:", e.message);
      }

      res.json({ diagnostico });
    } catch (error: any) {
      console.error("[AI] Erro diagnose-error:", error.message);
      const mapped = mapAiError(error, "Erro ao diagnosticar");
      res.status(mapped.status).json({ message: mapped.message });
    }
  });

  app.post("/api/ai/pricing-advisor/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    if (!checkRateLimit(user.id)) return res.status(429).json({ message: "Aguarde alguns segundos" });

    try {
      const assetId = Number(req.params.id);
      const analise = await pricingAdvisor(assetId, user.orgId);

      try {
        // merge atômico: só o delta, sem regravar o objeto inteiro
        await storage.mergeAssetCampos(assetId, { iaPricing: analise, iaPricingDate: new Date().toISOString() });
      } catch (e: any) {
        console.error("[AI] Erro ao persistir pricing:", e.message);
      }

      res.json({ analise });
    } catch (error: any) {
      console.error("[AI] Erro pricing-advisor:", error.message);
      const mapped = mapAiError(error, "Erro na sugestão de preço");
      res.status(mapped.status).json({ message: mapped.message });
    }
  });

  app.post("/api/ai/monitor-errors", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    if (!checkRateLimit(user.id)) return res.status(429).json({ message: "Aguarde alguns segundos" });

    try {
      const resumo = await monitorErrors(user.orgId);
      res.json({ resumo });
    } catch (error: any) {
      console.error("[AI] Erro monitor-errors:", error.message);
      const mapped = mapAiError(error, "Erro no monitoramento");
      res.status(mapped.status).json({ message: mapped.message });
    }
  });

  app.post("/api/ai/deep-intel/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    if (!checkRateLimit(user.id)) return res.status(429).json({ message: "Aguarde alguns segundos" });

    try {
      const assetId = Number(req.params.id);
      const result = await deepIntelligenceAnalysis(assetId, user.orgId);

      try {
        // merge atômico: só o delta, sem regravar o objeto inteiro
        await storage.mergeAssetCampos(assetId, {
          iaDeepIntel: result,
          iaDeepIntelDate: new Date().toISOString(),
          iaDeepIntelHash: result.insumosHash,
        });
      } catch (e: any) {
        console.error("[AI] Erro ao persistir deep intel:", e.message);
      }

      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error("[AI] Erro deep-intel:", error.message);
      const mapped = mapAiError(error, "Erro na investigação inteligente");
      res.status(mapped.status).json({ message: mapped.message });
    }
  });
}
