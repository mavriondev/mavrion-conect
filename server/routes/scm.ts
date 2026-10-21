import type { Express, Request, Response, NextFunction } from "express";
import {
  initSession,
  getCaptchaImage,
  submitCaptcha,
  getProcessoFromCache,
  getProcessosByTitularCnpj,
  getScmStatus,
  cleanScmHtmlForDocument,
} from "../lib/scm-scraper";
import { persistTitularCnpjOnAsset, parseAssetId } from "./anm-enrichment";
import { getOrgId } from "../lib/tenant";

const ensureAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!(req as any).isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
  next();
};

function getUserId(req: Request): number {
  return (req as any).user?.id || 0;
}

export function registerScmRoutes(app: Express) {
  app.post("/api/scm/captcha/iniciar", ensureAuth, async (req: Request, res: Response) => {
    try {
      const { processo } = req.body;
      if (!processo || typeof processo !== "string") {
        return res.status(400).json({ message: "Número do processo é obrigatório" });
      }
      const result = await initSession(processo.trim(), getUserId(req));
      res.json(result);
    } catch (err: any) {
      if (err.message === "processo_invalido") {
        return res.status(400).json({ message: `Número de processo ANM inválido: "${req.body?.processo}". Formato esperado: número/ano (ex.: 831522/1984).` });
      }
      if (err.message === "scm_timeout") {
        return res.status(504).json({ message: "O SCM da ANM não respondeu. O site pode estar indisponível no momento — tente novamente." });
      }
      console.error("[SCM] Erro ao iniciar sessão:", err.message);
      res.status(500).json({ message: "Não foi possível acessar o SCM. Tente novamente." });
    }
  });

  app.get("/api/scm/captcha/imagem/:sessionId", ensureAuth, async (req: Request, res: Response) => {
    try {
      const imgBuffer = await getCaptchaImage(String(req.params.sessionId), getUserId(req));
      res.set("Content-Type", "image/png");
      res.set("Cache-Control", "no-cache, no-store");
      res.send(imgBuffer);
    } catch (err: any) {
      if (err.message === "sessao_expirada") {
        return res.status(410).json({ message: "Sessão expirada. Inicie nova consulta." });
      }
      res.status(500).json({ message: "Erro ao buscar imagem do captcha" });
    }
  });

  app.post("/api/scm/captcha/resolver", ensureAuth, async (req: Request, res: Response) => {
    try {
      const { sessionId, captcha } = req.body;
      if (!sessionId || !captcha) {
        return res.status(400).json({ message: "sessionId e captcha são obrigatórios" });
      }

      const userId = getUserId(req);
      const result = await submitCaptcha(sessionId, captcha.trim(), userId);

      if (!result.success) {
        return res.json(result);
      }

      // Persiste o titular resolvido pela consulta SCM no ativo (merge atômico),
      // para que continue visível na sub-aba Titular em visitas futuras.
      const assetIdNum = parseAssetId(req.body.assetId);
      const cnpjScm = String(result.data?.titularCnpj || "").replace(/\D/g, "");
      if (assetIdNum && cnpjScm.length === 14) {
        await persistTitularCnpjOnAsset(assetIdNum, getOrgId(req), cnpjScm, "SCM", result.data?.titularNome || null);
      }

      const responseData = { ...result.data };
      delete responseData.rawHtml;

      res.json({
        success: true,
        data: responseData,
        hasDocument: !!result.data?.rawHtml,
      });
    } catch (err: any) {
      console.error("[SCM] Erro ao resolver captcha:", err.message);
      res.status(500).json({ message: "Erro ao processar captcha" });
    }
  });

  app.get("/api/scm/processo/:numero/:ano", ensureAuth, async (req: Request, res: Response) => {
    try {
      if (!req.params.numero || !req.params.ano) {
        return res.status(400).json({ message: "Processo obrigatório (formato: numero/ano)" });
      }
      // getProcessoFromCache normaliza o formato (pontos, zeros à esquerda)
      // e ignora/limpa registros sem dados reais do processo
      const cached = await getProcessoFromCache(`${req.params.numero}/${req.params.ano}`);
      if (!cached) {
        res.set("X-Expected-404", "1");
        return res.status(404).json({
          message: "Processo não consultado via SCM. Use o fluxo de captcha para consultar.",
          scmConsultado: false,
        });
      }

      const { rawHtml, ...rest } = cached as any;
      res.json({
        ...rest,
        hasDocument: !!rawHtml,
        titular: {
          nome: cached.titularNome,
          cnpj: cached.titularCnpj,
          cpf: cached.titularCpf,
          tipoPessoa: cached.tipoPessoa,
          cadastroEmpresa: cached.cadastroEmpresa,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: "Erro ao consultar processo" });
    }
  });

  app.get("/api/scm/documento/:numero/:ano", ensureAuth, async (req: Request, res: Response) => {
    try {
      const cached = await getProcessoFromCache(`${req.params.numero}/${req.params.ano}`);
      if (!cached || !(cached as any).rawHtml) {
        res.set("X-Expected-404", "1");
        return res.status(404).json({ message: "Documento SCM não disponível para este processo." });
      }
      const cleanedHtml = cleanScmHtmlForDocument(
        (cached as any).rawHtml,
        (cached as any).processo,
        (cached as any).consultadoEm
      );
      res.set("Content-Type", "text/html; charset=utf-8");
      res.set("Content-Disposition", `attachment; filename="SCM_${(cached as any).numero}_${(cached as any).ano}.html"`);
      res.set("X-Content-Type-Options", "nosniff");
      res.send(cleanedHtml);
    } catch (err: any) {
      console.error("[SCM-DOC] Route error:", err.message);
      res.status(500).json({ message: "Erro ao baixar documento" });
    }
  });

  app.get("/api/scm/titular/:cnpj", ensureAuth, async (req: Request, res: Response) => {
    try {
      const rows = await getProcessosByTitularCnpj(String(req.params.cnpj));
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: "Erro ao consultar titular" });
    }
  });

  app.get("/api/scm/status", ensureAuth, async (_req: Request, res: Response) => {
    try {
      const status = await getScmStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ message: "Erro ao obter status" });
    }
  });
}

