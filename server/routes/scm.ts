import type { Express, Request, Response, NextFunction } from "express";
import {
  initSession,
  getCaptchaImage,
  submitCaptcha,
  getProcessoFromCache,
  getProcessosByTitularCnpj,
  getScmStatus,
} from "../lib/scm-scraper";
import { db } from "../db";
import { companies, assets } from "@shared/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import { getOrgId } from "../lib/tenant";

const ensureAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!(req as any).isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
  next();
};

const cnpjaHeaders = () => ({
  "Authorization": process.env.CNPJA_API_KEY || "",
});

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
      console.error("[SCM] Erro ao iniciar sessão:", err.message);
      res.status(500).json({ message: "Não foi possível acessar o SCM. Tente novamente." });
    }
  });

  app.get("/api/scm/captcha/imagem/:sessionId", ensureAuth, async (req: Request, res: Response) => {
    try {
      const imgBuffer = await getCaptchaImage(req.params.sessionId, getUserId(req));
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
      const { sessionId, captcha, assetId } = req.body;
      if (!sessionId || !captcha) {
        return res.status(400).json({ message: "sessionId e captcha são obrigatórios" });
      }

      const userId = getUserId(req);
      const orgId = getOrgId(req);

      const result = await submitCaptcha(sessionId, captcha.trim(), userId);

      if (!result.success) {
        return res.json(result);
      }

      let companyId: number | null = null;
      let enrichmentSteps: string[] = [];

      if (result.data?.titularCnpj && assetId) {
        const numericAssetId = Number(assetId);
        if (!isNaN(numericAssetId)) {
          const [asset] = await db.select().from(assets).where(eq(assets.id, numericAssetId)).limit(1);
          if (asset && asset.orgId === orgId) {
            try {
              const enrichResult = await linkAndEnrichCompany(
                result.data.titularCnpj,
                result.data.titularNome,
                numericAssetId,
                orgId
              );
              companyId = enrichResult.companyId;
              enrichmentSteps = enrichResult.steps;
            } catch (enrichErr: any) {
              console.warn("[SCM] Erro no enriquecimento:", enrichErr.message);
              enrichmentSteps.push("Erro no enriquecimento automático");
            }
          }
        }
      }

      res.json({
        ...result,
        companyId,
        enrichmentSteps,
      });
    } catch (err: any) {
      console.error("[SCM] Erro ao resolver captcha:", err.message);
      res.status(500).json({ message: "Erro ao processar captcha" });
    }
  });

  app.get("/api/scm/processo/:numero/:ano", ensureAuth, async (req: Request, res: Response) => {
    try {
      const processo = `${req.params.numero}/${req.params.ano}`.trim();
      if (!req.params.numero || !req.params.ano) {
        return res.status(400).json({ message: "Processo obrigatório (formato: numero/ano)" });
      }

      const cached = await getProcessoFromCache(processo);
      if (!cached) {
        return res.status(404).json({
          message: "Processo não consultado via SCM. Use o fluxo de captcha para consultar.",
          scmConsultado: false,
        });
      }

      res.json({
        ...cached,
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

  app.get("/api/scm/titular/:cnpj", ensureAuth, async (req: Request, res: Response) => {
    try {
      const rows = await getProcessosByTitularCnpj(req.params.cnpj);
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

async function linkAndEnrichCompany(
  cnpj: string,
  titularNome: string | null,
  assetId: number,
  orgId: number
): Promise<{ companyId: number | null; steps: string[] }> {
  const steps: string[] = [];
  const clean = cnpj.replace(/\D/g, "");
  const formatted = clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

  const existing = await db.select().from(companies).where(
    and(
      or(eq(companies.cnpj, clean), eq(companies.cnpj, formatted)),
      or(eq(companies.orgId, orgId), isNull(companies.orgId))
    )
  ).limit(1);

  let companyId: number | null = null;
  let existed = false;

  if (existing.length > 0) {
    companyId = existing[0].id;
    existed = true;
    steps.push("Empresa já cadastrada no sistema");
  } else {
    const [created] = await db.insert(companies).values({
      legalName: titularNome || "Titular ANM",
      cnpj: formatted,
      orgId,
    }).returning();
    companyId = created.id;
    steps.push("Empresa criada no CRM");
  }

  if (companyId && assetId && !isNaN(assetId)) {
    await db.update(assets).set({ linkedCompanyId: companyId }).where(
      and(eq(assets.id, assetId), eq(assets.orgId, orgId))
    );
    steps.push("Empresa vinculada ao ativo");
  }

  if (companyId && process.env.CNPJA_API_KEY) {
    try {
      const detailUrl = `https://api.cnpja.com/office/${clean}?strategy=CACHE_IF_FRESH&maxAge=30`;
      const detailResp = await fetch(detailUrl, { headers: cnpjaHeaders() });

      if (detailResp.ok) {
        const cnpjaDetail = await detailResp.json() as any;
        const updateData: Record<string, any> = {};

        if (cnpjaDetail.company?.name) updateData.legalName = cnpjaDetail.company.name;
        if (cnpjaDetail.mainActivity?.text) updateData.cnaePrincipal = cnpjaDetail.mainActivity.text;
        if (cnpjaDetail.sideActivities?.length) {
          updateData.cnaeSecundarios = cnpjaDetail.sideActivities.map((a: any) => a.text);
        }
        if (cnpjaDetail.company?.size?.text) updateData.porte = cnpjaDetail.company.size.text;
        if (cnpjaDetail.alias) updateData.tradeName = cnpjaDetail.alias;
        if (cnpjaDetail.company?.equity) updateData.shareCapital = cnpjaDetail.company.equity;

        const phones = (cnpjaDetail.phones || []).map((p: any) => `(${p.area}) ${p.number}`);
        if (phones.length) updateData.phones = phones;
        const emails = (cnpjaDetail.emails || []).map((e: any) => e.address);
        if (emails.length) updateData.emails = emails;

        if (cnpjaDetail.address) {
          updateData.address = {
            street: cnpjaDetail.address.street,
            number: cnpjaDetail.address.number,
            district: cnpjaDetail.address.district,
            city: cnpjaDetail.address.city,
            state: cnpjaDetail.address.state,
            zip: cnpjaDetail.address.zip,
          };
        }

        const existingEnrich = existed ? ((existing[0] as any)?.enrichmentData || {}) : {};
        updateData.enrichmentData = {
          ...existingEnrich,
          cnpja: cnpjaDetail,
          scmResolve: { method: "scm_captcha", timestamp: new Date().toISOString() },
        };

        if (Object.keys(updateData).length > 0) {
          await db.update(companies).set(updateData).where(eq(companies.id, companyId!));
          steps.push("Dados enriquecidos via Receita Federal (CNAE, sócios, endereço, contatos)");
        }
      } else {
        steps.push("CNPJA não disponível — dados parciais salvos");
      }
    } catch (cnpjaErr: any) {
      console.warn("[SCM] CNPJA error:", cnpjaErr.message);
      steps.push("Erro no enriquecimento via CNPJA");
    }
  }

  return { companyId, steps };
}
