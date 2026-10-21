import type { Express, Request, Response, NextFunction } from "express";
import { importTahCsv, getTahByProcesso, getTahStats, isImportRunning, setImportRunning } from "../lib/tah-importer";
import { payloadFalhaConsulta } from "../lib/consulta-contrato";

export function registerTahRoutes(app: Express) {
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

  app.post("/api/tah/importar", ensureAdmin, async (_req: Request, res: Response) => {
    if (isImportRunning()) {
      return res.status(409).json({ message: "Importação já em andamento" });
    }

    setImportRunning(true);
    res.json({ message: "Importação TAH iniciada em background" });

    try {
      const result = await importTahCsv();
      console.log(`[TAH Route] Importação concluída: ${result.imported} registros`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[TAH Route] Erro na importação:", message);
    } finally {
      setImportRunning(false);
    }
  });

  app.get("/api/tah/status", ensureAuth, async (_req: Request, res: Response) => {
    try {
      const stats = await getTahStats();
      res.json({ ...stats, importRunning: isImportRunning() });
    } catch {
      res.status(500).json({ message: "Erro ao obter status TAH" });
    }
  });

  app.get("/api/tah/processo/:processo", ensureAuth, async (req: Request, res: Response) => {
    const processo = String(req.params.processo || "").replace(/[^0-9/.]/g, "");
    try {
      if (!processo) {
        return res.status(400).json(payloadFalhaConsulta({
          fonte: "TAH — dados abertos ANM",
          tierFonte: "T1",
          motivoFalha: "Processo inválido — identificador vazio após a sanitização",
        }));
      }
      const { registros, ambiguo, ano, numero } = await getTahByProcesso(processo);
      const stats = await getTahStats().catch(() => null);
      const baseCoberta = Boolean(stats && stats.totalRegistros > 0);
      const janelaCobertura = baseCoberta
        ? `base TAH (dados abertos ANM) com ${stats!.totalRegistros.toLocaleString("pt-BR")} registros — cobre os títulos vigentes na data da importação`
        : null;
      const identificadorVinculo = {
        tipo: "processo_anm" as const,
        valor: processo,
        proveniencia: "documento_oficial" as const,
        origem: "TAH dados abertos",
      };
      if (!registros || registros.length === 0) {
        res.set("X-Expected-404", "1");
        if (!baseCoberta) {
          // base vazia/indisponível: NÃO se pode afirmar ausência de registro
          return res.status(404).json(payloadFalhaConsulta({
            fonte: "TAH — dados abertos ANM",
            tierFonte: "T1",
            motivoFalha: "Base TAH (dados abertos ANM) ainda não importada/indisponível neste ambiente — não é possível afirmar ausência de registro",
            identificadorVinculo,
          }));
        }
        // três estados: base coberta e processo ausente = consultada SEM registro
        return res.status(404).json({
          message: "Processo não encontrado na base TAH",
          disponivel: true,
          estadoConsulta: "consultada_sem_registro",
          situacaoRegistro: null,
          tierFonte: "T1",
          fonte: "TAH — dados abertos ANM",
          janelaCobertura,
          identificadorVinculo,
          consultadoEm: new Date().toISOString(),
        });
      }
      // ambiguo = casado só pelo número-base (sem ano) — vínculo não confirmado
      res.json({
        registros,
        ambiguo,
        ano,
        numero,
        estadoConsulta: "registro_existente",
        // a base TAH não informa quitação/pendência do débito — situação indeterminada
        situacaoRegistro: "indeterminada",
        tierFonte: ambiguo ? "T3" : "T1",
        ...(ambiguo ? { tierFonteOriginal: "T1", rebaixadoMotivo: "vinculação não confirmada — casado só pelo número-base do processo" } : {}),
        fonte: "TAH — dados abertos ANM",
        janelaCobertura,
        identificadorVinculo,
        vinculoConfirmado: !ambiguo,
        aviso: ambiguo
          ? "Histórico vinculado só pelo número-base do processo — pode incluir processos distintos de outros anos."
          : null,
        consultadoEm: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[TAH Route] Erro na consulta:", msg);
      // erro inesperado também responde o contrato de três estados completo
      res.status(500).json(payloadFalhaConsulta({
        fonte: "TAH — dados abertos ANM",
        tierFonte: "T1",
        motivoFalha: `Erro inesperado ao consultar a base TAH: ${msg}`,
        identificadorVinculo: processo
          ? { tipo: "processo_anm", valor: processo, proveniencia: "documento_oficial", origem: "TAH dados abertos" }
          : null,
      }));
    }
  });
}
