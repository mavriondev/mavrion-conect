import type { Express, Request, Response, NextFunction } from "express";
import {
  importAnmEventos, getEventosByProcesso, getAnmEventosStats,
  isAnmEventosImportRunning, setAnmEventosImportRunning,
} from "../lib/anm-eventos-importer";

export function registerAnmEventosRoutes(app: Express) {
  const ensureAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    next();
  };

  const ensureAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as { role?: string } | undefined;
    if (user?.role !== "admin" && user?.role !== "superadmin") {
      return res.status(403).json({ message: "Acesso restrito a administradores" });
    }
    next();
  };

  // Importação manual da base de eventos (dados abertos ANM — microdados SCM).
  // Roda em background: o download do ZIP (~300 MB) + 9,6M linhas demora.
  app.post("/api/anm-eventos/importar", ensureAdmin, async (_req: Request, res: Response) => {
    if (isAnmEventosImportRunning()) {
      return res.status(409).json({ message: "Importação já em andamento" });
    }
    setAnmEventosImportRunning(true);
    res.json({ message: "Importação de eventos ANM iniciada em background" });
    try {
      const result = await importAnmEventos();
      console.log(`[ANM Eventos Route] Importação concluída: ${result.imported} eventos`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ANM Eventos Route] Erro na importação:", message);
    } finally {
      setAnmEventosImportRunning(false);
    }
  });

  app.get("/api/anm-eventos/status", ensureAuth, async (_req: Request, res: Response) => {
    try {
      const stats = await getAnmEventosStats();
      res.json({ ...stats, importRunning: isAnmEventosImportRunning() });
    } catch {
      res.status(500).json({ message: "Erro ao obter status dos eventos ANM" });
    }
  });

  app.get("/api/anm-eventos/processo/:processo", ensureAuth, async (req: Request, res: Response) => {
    try {
      const processo = String(req.params.processo || "").replace(/[^0-9/.]/g, "");
      if (!processo) return res.status(400).json({ message: "Processo inválido" });
      const result = await getEventosByProcesso(processo);
      if (result.total === 0) {
        res.set("X-Expected-404", "1");
        return res.status(404).json({ message: "Processo não encontrado na base de eventos ANM" });
      }
      res.json({ ...result, consultadoEm: new Date().toISOString() });
    } catch {
      res.status(500).json({ message: "Erro ao consultar eventos ANM" });
    }
  });
}
