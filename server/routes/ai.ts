import type { Express } from "express";
import { analyzeAsset, summarizeCompany, naturalLanguageSearch, generateReport, diagnoseError, scoreLeadAI, pricingAdvisor, monitorErrors, pipelineIntelligence, dueDiligenceCheck } from "../lib/ai-agents";
import { db } from "../db";
import { assets, companies, errorReports, leads } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

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
        const [ativo] = await db.select().from(assets).where(eq(assets.id, assetId));
        if (ativo) {
          const campos = (ativo.camposEspecificos || {}) as any;
          campos.iaAnalise = analise;
          campos.iaAnaliseDate = new Date().toISOString();
          await db.update(assets).set({ camposEspecificos: campos }).where(eq(assets.id, assetId));
        }
      } catch (e: any) {
        console.error("[AI] Erro ao persistir análise:", e.message);
      }

      res.json({ analise });
    } catch (error: any) {
      console.error("[AI] Erro analyze-asset:", error.message);
      res.status(500).json({ message: error.message || "Erro ao analisar ativo" });
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
      res.status(500).json({ message: error.message || "Erro ao resumir empresa" });
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
      res.status(500).json({ message: error.message || "Erro na busca" });
    }
  });

  app.post("/api/ai/generate-report", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    if (!checkRateLimit(user.id)) return res.status(429).json({ message: "Aguarde alguns segundos" });

    try {
      const { assetId, companyId } = req.body;
      if (!assetId || !companyId) return res.status(400).json({ message: "assetId e companyId obrigatórios" });
      const relatorio = await generateReport(Number(assetId), Number(companyId), user.orgId);
      res.json({ relatorio });
    } catch (error: any) {
      console.error("[AI] Erro generate-report:", error.message);
      res.status(500).json({ message: error.message || "Erro ao gerar relatório" });
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
      res.status(500).json({ message: error.message || "Erro ao diagnosticar" });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // NEW AGENTS (6-10)
  // ═══════════════════════════════════════════════════════════

  app.post("/api/ai/score-lead/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    if (!checkRateLimit(user.id)) return res.status(429).json({ message: "Aguarde alguns segundos" });

    try {
      const leadId = Number(req.params.id);
      const result = await scoreLeadAI(leadId, user.orgId);

      try {
        await db.update(leads).set({
          score: result.score,
          scoreBreakdownJson: {
            aiScore: result.score,
            justificativa: result.justificativa,
            ativoRecomendado: result.ativoRecomendado,
            scoredAt: new Date().toISOString(),
            model: "gpt-4o-mini",
          },
        }).where(eq(leads.id, leadId));
      } catch (e: any) {
        console.error("[AI] Erro ao persistir score:", e.message);
      }

      res.json(result);
    } catch (error: any) {
      console.error("[AI] Erro score-lead:", error.message);
      res.status(500).json({ message: error.message || "Erro ao qualificar lead" });
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
        const [ativo] = await db.select().from(assets).where(eq(assets.id, assetId));
        if (ativo) {
          const campos = (ativo.camposEspecificos || {}) as any;
          campos.iaPricing = analise;
          campos.iaPricingDate = new Date().toISOString();
          await db.update(assets).set({ camposEspecificos: campos }).where(eq(assets.id, assetId));
        }
      } catch (e: any) {
        console.error("[AI] Erro ao persistir pricing:", e.message);
      }

      res.json({ analise });
    } catch (error: any) {
      console.error("[AI] Erro pricing-advisor:", error.message);
      res.status(500).json({ message: error.message || "Erro na sugestão de preço" });
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
      res.status(500).json({ message: error.message || "Erro no monitoramento" });
    }
  });

  app.post("/api/ai/pipeline-briefing", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    if (!checkRateLimit(user.id)) return res.status(429).json({ message: "Aguarde alguns segundos" });

    try {
      const briefing = await pipelineIntelligence(user.orgId);
      res.json({ briefing });
    } catch (error: any) {
      console.error("[AI] Erro pipeline-briefing:", error.message);
      res.status(500).json({ message: error.message || "Erro no briefing" });
    }
  });

  app.post("/api/ai/due-diligence/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    if (!checkRateLimit(user.id)) return res.status(429).json({ message: "Aguarde alguns segundos" });

    try {
      const assetId = Number(req.params.id);
      const analise = await dueDiligenceCheck(assetId, user.orgId);

      try {
        const [ativo] = await db.select().from(assets).where(eq(assets.id, assetId));
        if (ativo) {
          const campos = (ativo.camposEspecificos || {}) as any;
          campos.iaDueDiligence = analise;
          campos.iaDueDiligenceDate = new Date().toISOString();
          await db.update(assets).set({ camposEspecificos: campos }).where(eq(assets.id, assetId));
        }
      } catch (e: any) {
        console.error("[AI] Erro ao persistir due diligence:", e.message);
      }

      res.json({ analise });
    } catch (error: any) {
      console.error("[AI] Erro due-diligence:", error.message);
      res.status(500).json({ message: error.message || "Erro na due diligence" });
    }
  });
}
