import type { Express, Request, Response, NextFunction } from "express";
import {
  initSeiSession,
  getSeiCaptchaImage,
  submitSeiCaptcha,
  getSeiFromCache,
  getSeiStatus,
} from "../lib/sei-scraper";

const ensureAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!(req as any).isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
  next();
};

function getUserId(req: Request): number {
  return (req as any).user?.id || 0;
}

function stripRawHtml(row: any) {
  const { rawHtml, ...rest } = row || {};
  return rest;
}

export function registerSeiRoutes(app: Express) {
  // Inicia sessão de consulta: carrega página do SEI + imagem do captcha
  app.post("/api/sei/captcha/iniciar", ensureAuth, async (req: Request, res: Response) => {
    try {
      const { nup, processo } = req.body || {};
      if (!nup || typeof nup !== "string") {
        return res.status(400).json({ message: "NUP é obrigatório (ex.: 48054.832070/2024-14)" });
      }
      const result = await initSeiSession(
        nup.trim(),
        getUserId(req),
        typeof processo === "string" ? processo : null
      );
      res.json(result);
    } catch (err: any) {
      if (err.code === "nup_invalido") {
        return res.status(400).json({ message: err.message, error: err.code });
      }
      if (err.code === "sei_timeout") {
        return res.status(504).json({ message: err.message, error: err.code });
      }
      console.error("[SEI] Erro ao iniciar sessão:", err.message);
      res.status(502).json({
        message: err.message || "Não foi possível acessar o SEI da ANM. Tente novamente.",
        error: err.code || "sei_erro",
      });
    }
  });

  app.get("/api/sei/captcha/imagem/:sessionId", ensureAuth, async (req: Request, res: Response) => {
    try {
      const imgBuffer = getSeiCaptchaImage(String(req.params.sessionId), getUserId(req));
      res.set("Content-Type", "image/png");
      res.set("Cache-Control", "no-cache, no-store");
      res.send(imgBuffer);
    } catch (err: any) {
      if (err.code === "sessao_expirada") {
        return res.status(410).json({ message: "Sessão expirada. Inicie nova consulta." });
      }
      res.status(500).json({ message: "Erro ao buscar imagem do captcha" });
    }
  });

  // Submete o captcha digitado; sucesso persiste o resultado no cache compartilhado.
  // Falhas conhecidas voltam como { success:false, error, message } (mesmo padrão do SCM).
  app.post("/api/sei/captcha/resolver", ensureAuth, async (req: Request, res: Response) => {
    try {
      const { sessionId, captcha } = req.body || {};
      if (!sessionId || !captcha) {
        return res.status(400).json({ message: "sessionId e captcha são obrigatórios" });
      }
      const result = await submitSeiCaptcha(String(sessionId), String(captcha), getUserId(req));
      res.json({ success: true, data: stripRawHtml(result.data) });
    } catch (err: any) {
      const knownCodes = new Set([
        "sessao_expirada",
        "captcha_curto",
        "captcha_invalido",
        "sei_timeout",
        "sei_indisponivel",
        "sei_estrutura_mudou",
        "sei_sem_resultados",
        "sei_resultado_ambiguo",
        "sei_resultado_incompativel",
        "dados_nao_encontrados",
      ]);
      if (err.code && knownCodes.has(err.code)) {
        return res.json({
          success: false,
          error: err.code,
          message: err.message,
          ...(Array.isArray(err.candidatos) && err.candidatos.length ? { candidatos: err.candidatos } : {}),
        });
      }
      console.error("[SEI] Erro ao resolver captcha:", err.message);
      res.status(500).json({ message: "Erro ao processar a consulta SEI" });
    }
  });

  // Cache compartilhado por NUP (dígitos ou formatado) e/ou processo "numero/ano"
  app.get("/api/sei/consulta", ensureAuth, async (req: Request, res: Response) => {
    try {
      const nup = typeof req.query.nup === "string" ? req.query.nup : null;
      const processo = typeof req.query.processo === "string" ? req.query.processo : null;
      if (!nup && !processo) {
        return res.status(400).json({ message: "Informe nup ou processo" });
      }
      const cached = await getSeiFromCache({ nup, processo });
      if (!cached) {
        res.set("X-Expected-404", "1");
        return res.status(404).json({
          message: "Processo ainda não consultado no SEI. Use o fluxo de captcha para consultar.",
          seiConsultado: false,
        });
      }
      res.json(stripRawHtml(cached));
    } catch (err: any) {
      console.error("[SEI] Erro ao ler cache:", err.message);
      res.status(500).json({ message: "Erro ao consultar cache SEI" });
    }
  });

  app.get("/api/sei/status", ensureAuth, async (_req: Request, res: Response) => {
    try {
      res.json(await getSeiStatus());
    } catch (err: any) {
      res.status(500).json({ message: "Erro ao obter status" });
    }
  });
}
