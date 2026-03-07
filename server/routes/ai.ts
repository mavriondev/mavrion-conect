import type { Express } from "express";
import { analyzeAsset, summarizeCompany, naturalLanguageSearch, generateReport, diagnoseError } from "../lib/ai-agents";

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
      const analise = await analyzeAsset(Number(req.params.id), user.orgId);
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
      const resumo = await summarizeCompany(Number(req.params.id), user.orgId);
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
      const diagnostico = await diagnoseError(Number(req.params.id), user.orgId);
      res.json({ diagnostico });
    } catch (error: any) {
      console.error("[AI] Erro diagnose-error:", error.message);
      res.status(500).json({ message: error.message || "Erro ao diagnosticar" });
    }
  });
}
