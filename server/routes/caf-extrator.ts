import type { Express, Request, Response, NextFunction } from "express";
import { db } from "../db";
import { norionCafRegistros } from "@shared/schema";
import { randomBytes } from "crypto";
import type { CafLead, CafCrawlerJob } from "../services/caf-crawler";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Não autenticado" });
  }
  next();
}

function getOrgIdFromUser(req: Request): number {
  const user = req.user as any;
  return user?.orgId || Number(process.env.DEFAULT_ORG_ID) || 1;
}

const varredurasAtivas = new Map<string, CafCrawlerJob>();

function mapLeadToRegistro(lead: CafLead, orgId: number) {
  return {
    orgId,
    nomeTitular: lead.nome,
    cpfTitular: lead.cpfMascarado,
    numeroUFPA: lead.nufpa,
    municipio: lead.municipio,
    uf: lead.uf,
    areaHa: lead.areaHa,
    condicaoPosse: lead.condicaoPosse,
    atividadePrincipal: lead.atividade,
    enquadramentoPronaf: lead.enquadramentoPronaf ? 'Sim' : 'Não',
    composicaoFamiliar: lead.membros,
    entidadeNome: lead.entidadeCadastradora,
    validade: lead.dataValidade,
    dataInscricao: lead.dataInscricao,
    numImoveis: lead.numImoveis,
    status: lead.situacao === 'ATIVA' ? 'ativo' : lead.situacao === 'INATIVA' ? 'vencido' : 'pendente',
    dadosExtras: {
      idUfpa: lead.idUfpa,
      grauParentesco: lead.grauParentesco,
      classificacao: lead.classificacao,
      norionProfile: lead.norionProfile,
      extraidoEm: lead.extraidoEm,
    },
  };
}

export function registerCafExtratorRoutes(app: Express) {
  app.get("/api/caf-extrator/testar", requireAuth, async (req: Request, res: Response) => {
    try {
      const { consultarNufpa } = await import('../services/caf-crawler');
      const nufpa = (req.query.nufpa as string) || 'RS032025.01.002731822CAF';
      const lead = await consultarNufpa(nufpa);
      res.json({ success: !!lead, nufpa, data: lead });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/caf-extrator/varredura", requireAuth, async (req: Request, res: Response) => {
    try {
      const { executarCrawlerCAF } = await import('../services/caf-crawler');
      const orgId = getOrgIdFromUser(req);
      const {
        uf = 'MG',
        ano = 2025,
        mes = 1,
        seqInicio = 1,
        seqFim = 100,
        areaMinHa = 0,
        areaMaxHa = 0,
        delayMs = 1100,
        apenasProprietario = false,
        apenasAtivos = true,
        apenasComPronaf = false,
        municipio,
        codIBGE,
        modo = 'paginado',
      } = req.body;

      const jobId = randomBytes(8).toString('hex');
      const job: CafCrawlerJob = {
        id: jobId,
        orgId: String(orgId),
        modo: modo as 'paginado' | 'sequencial' | 'municipio',
        uf,
        ano,
        mes,
        seqInicio,
        seqFim,
        municipio,
        codIBGE,
        areaMinHa,
        areaMaxHa,
        delayMs: Math.max(500, Number(delayMs) || 1100),
        apenasProprietario,
        apenasAtivos,
        apenasComPronaf,
        status: 'pendente',
        progresso: 0,
        totalVaridos: 0,
        totalEncontrados: 0,
        totalSalvos: 0,
        totalErros: 0,
        iniciadoEm: null,
        concluidoEm: null,
      };

      varredurasAtivas.set(jobId, job);

      executarCrawlerCAF(
        job,
        (updated) => { varredurasAtivas.set(jobId, { ...updated }); },
        async (lead) => {
          try {
            await db.insert(norionCafRegistros).values(mapLeadToRegistro(lead, orgId));
          } catch (e: any) {
            console.error(`[CAF] Erro ao salvar lead ${lead.nufpa}:`, e.message);
          }
        }
      ).catch((err) => {
        const final = varredurasAtivas.get(jobId);
        if (final) {
          final.status = 'erro';
          final.mensagemErro = err.message;
        }
        console.error(`[CAF] Varredura ${jobId} erro:`, err.message);
      });

      res.json({ jobId, status: 'iniciada', job });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/caf-extrator/varredura/:id", requireAuth, (req: Request, res: Response) => {
    const job = varredurasAtivas.get(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Varredura não encontrada' });
    }
    res.json(job);
  });

  app.post("/api/caf-extrator/varredura/:id/cancelar", requireAuth, async (req: Request, res: Response) => {
    try {
      const { cancelarJob } = await import('../services/caf-crawler');
      const job = varredurasAtivas.get(req.params.id);
      if (!job) {
        return res.status(404).json({ error: 'Varredura não encontrada' });
      }
      cancelarJob(req.params.id);
      res.json({ success: true, message: 'Cancelamento solicitado' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/caf-extrator/varreduras", requireAuth, (_req: Request, res: Response) => {
    const todas = Array.from(varredurasAtivas.values());
    res.json(todas);
  });
}
