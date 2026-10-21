// Saúde consolidada das bases locais da ANM (TAH, CFEM, SIGBM, PGFN) para o
// painel administrativo: última carga, resultado da última rodada (incl.
// validação por pares processo+ano do TAH) e alertas de estagnação abertos
// em error_reports (type 'vps_rotina_stale').
import type { Express, Request, Response, NextFunction } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { getTahStats, isImportRunning as isTahImportRunning } from "../lib/tah-importer";
import { getCfemStats, isCfemImportRunning } from "../lib/cfem-importer";
import { getSigbmStats } from "../lib/sigbm-importer";
import { getPgfnStats, isPgfnImportRunning } from "../lib/pgfn-importer";
import { saveImportStatus } from "../lib/import-status";

type UltimaImportacao = {
  status?: string;
  imported?: number;
  errors?: number;
  startedAt?: string | Date;
  finishedAt?: string | Date;
  errorDetails?: string;
  validacao?: string;
  referencia?: string | null;
  anosProcessados?: number[];
  categoriasProcessadas?: string[];
} | null;

type BaseSaude = {
  fonte: "tah" | "cfem" | "sigbm" | "pgfn";
  nome: string;
  descricao: string;
  status: "ok" | "erro" | "rodando" | "vazia";
  totalRegistros: number;
  ultimaCarga: string | null; // MAX(importado_em) da tabela
  importRunning: boolean;
  ultimaImportacao: UltimaImportacao;
  alertas: Array<{ id: string; title: string; description: string | null; createdAt: string | null }>;
  reimportarEndpoint: string;
  detalhes?: Record<string, unknown>;
};

async function maxImportadoEm(tabela: string): Promise<string | null> {
  try {
    const res = await db.execute(sql.raw(`SELECT MAX(importado_em) AS ultima FROM ${tabela}`));
    const v = (res.rows?.[0] as any)?.ultima;
    return v ? new Date(v).toISOString() : null;
  } catch {
    return null;
  }
}

// O status persistido em import_status nasce como "running" antes do
// trabalho de fato — se o processo cair/reiniciar no meio, ele fica órfão
// para sempre. Como todas as importações rodam neste mesmo processo, o flag
// em memória é a autoridade: persistido "running" sem flag vivo = rodada
// interrompida, convertida em erro para não travar o botão de reimportar.
export function normalizeUltimaImportacao(ui: UltimaImportacao, running: boolean): UltimaImportacao {
  if (ui?.status === "running" && !running) {
    return {
      ...ui,
      status: "error",
      // finishedAt marca o momento da reconciliação — importante para os
      // getters que sintetizam "completed" a partir de MAX(importado_em) não
      // considerarem linhas parciais da rodada interrompida como carga válida.
      finishedAt: ui.finishedAt ?? new Date().toISOString(),
      errorDetails: ui.errorDetails
        || "Importação interrompida — o servidor reiniciou durante a rodada. Reimporte manualmente.",
    };
  }
  return ui;
}

// Normaliza E persiste a reconciliação em import_status, para que rodadas
// órfãs virem erro de forma durável (não só na resposta desta requisição).
export async function reconcileUltimaImportacao(
  fonte: string, ui: UltimaImportacao, running: boolean,
): Promise<UltimaImportacao> {
  const normalized = normalizeUltimaImportacao(ui, running);
  if (normalized !== ui) {
    await saveImportStatus(fonte, normalized as object);
    console.warn(`[Bases ANM] Rodada órfã de '${fonte}' reconciliada como erro (processo reiniciou durante a importação).`);
  }
  return normalized;
}

export function deriveStatus(opts: {
  running: boolean;
  total: number;
  ultimaImportacao: UltimaImportacao; // já normalizada
}): BaseSaude["status"] {
  if (opts.running) return "rodando";
  if (opts.ultimaImportacao?.status === "error") return "erro";
  if (opts.total <= 0) return "vazia";
  return "ok";
}

export function registerBasesAnmRoutes(app: Express) {
  const ensureAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as { role?: string } | undefined;
    if (user?.role !== "admin" && user?.role !== "superadmin") {
      return res.status(403).json({ message: "Acesso restrito a administradores" });
    }
    next();
  };

  app.get("/api/admin/bases-anm/saude", ensureAdmin, async (_req: Request, res: Response) => {
    try {
      const [tah, cfem, sigbm, pgfn, cargas, alertasRes] = await Promise.all([
        getTahStats(),
        getCfemStats(),
        getSigbmStats(),
        getPgfnStats(),
        Promise.all([
          maxImportadoEm("tah_titulares"),
          maxImportadoEm("cfem_arrecadacao"),
          maxImportadoEm("sigbm_barragens"),
          maxImportadoEm("pgfn_divida_ativa"),
        ]),
        db.execute(sql`
          SELECT id, module, title, description, created_at
            FROM error_reports
           WHERE type = 'vps_rotina_stale' AND status = 'open'
           ORDER BY created_at DESC`),
      ]);

      const alertasPorModulo = new Map<string, BaseSaude["alertas"]>();
      for (const row of (alertasRes.rows as any[])) {
        const mod = String(row.module || "");
        const list = alertasPorModulo.get(mod) || [];
        list.push({
          id: String(row.id),
          title: String(row.title || ""),
          description: row.description ? String(row.description) : null,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        });
        alertasPorModulo.set(mod, list);
      }

      const tahRunning = isTahImportRunning();
      const cfemRunning = isCfemImportRunning();
      const pgfnRunning = isPgfnImportRunning();
      const sigbmRunning = (sigbm as any).importRunning === true;

      const [tahUi, cfemUi, sigbmUi, pgfnUi] = await Promise.all([
        reconcileUltimaImportacao("tah", tah.ultimaImportacao as UltimaImportacao, tahRunning),
        reconcileUltimaImportacao("cfem", cfem.ultimaImportacao as UltimaImportacao, cfemRunning),
        reconcileUltimaImportacao("sigbm", (sigbm as any).lastImportResult as UltimaImportacao, sigbmRunning),
        reconcileUltimaImportacao("pgfn", pgfn.ultimaImportacao as UltimaImportacao, pgfnRunning),
      ]);

      const bases: BaseSaude[] = [
        {
          fonte: "tah",
          nome: "TAH — Taxa Anual por Hectare",
          descricao: "Titulares e valores da TAH (dados abertos ANM). Validação por pares processo+ano a cada carga.",
          status: deriveStatus({ running: tahRunning, total: tah.totalRegistros, ultimaImportacao: tahUi }),
          totalRegistros: tah.totalRegistros,
          ultimaCarga: cargas[0],
          importRunning: tahRunning,
          ultimaImportacao: tahUi,
          alertas: alertasPorModulo.get("tah_import") || [],
          reimportarEndpoint: "/api/tah/importar",
          detalhes: { comCnpjCpf: tah.comCnpjCpf },
        },
        {
          fonte: "cfem",
          nome: "CFEM — Arrecadação",
          descricao: "Arrecadação de CFEM por processo/titular/município (dados abertos ANM).",
          status: deriveStatus({ running: cfemRunning, total: cfem.totalRegistros, ultimaImportacao: cfemUi }),
          totalRegistros: cfem.totalRegistros,
          ultimaCarga: cargas[1],
          importRunning: cfemRunning,
          ultimaImportacao: cfemUi,
          alertas: alertasPorModulo.get("cfem_import") || [],
          reimportarEndpoint: "/api/cfem/importar",
          detalhes: { anoMin: cfem.anoMin, anoMax: cfem.anoMax },
        },
        {
          fonte: "sigbm",
          nome: "SIGBM — Barragens de Mineração",
          descricao: "Cadastro de barragens de mineração (SIGBM/ANM).",
          status: deriveStatus({ running: sigbmRunning, total: (sigbm as any).totalBarragens, ultimaImportacao: sigbmUi }),
          totalRegistros: Number((sigbm as any).totalBarragens || 0),
          ultimaCarga: cargas[2],
          importRunning: sigbmRunning,
          ultimaImportacao: sigbmUi,
          alertas: alertasPorModulo.get("sigbm_import") || [],
          reimportarEndpoint: "/api/sigbm/importar",
        },
        {
          fonte: "pgfn",
          nome: "PGFN — Dívida Ativa da União",
          descricao: "Devedores inscritos em dívida ativa (dumps trimestrais da PGFN).",
          status: deriveStatus({ running: pgfnRunning, total: pgfn.totalRegistros, ultimaImportacao: pgfnUi }),
          totalRegistros: pgfn.totalRegistros,
          ultimaCarga: cargas[3],
          importRunning: pgfnRunning,
          ultimaImportacao: pgfnUi,
          alertas: alertasPorModulo.get("pgfn_import") || [],
          reimportarEndpoint: "/api/pgfn/importar",
          detalhes: { referencia: pgfn.referencia },
        },
      ];

      res.json({ bases, consultadoEm: new Date().toISOString() });
    } catch (err: any) {
      console.error("[Bases ANM] Erro ao montar saúde das bases:", err?.message || err);
      res.status(500).json({ message: "Erro ao obter saúde das bases ANM" });
    }
  });
}
