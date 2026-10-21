import cron, { type ScheduledTask } from "node-cron";
import { db } from "./db";
import { connectors, organizations, errorReports } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { logApiError } from "./lib/api-error-logger";
import { sendNotification, notifId } from "./notifications";
import { importTahCsv, isImportRunning, setImportRunning } from "./lib/tah-importer";
import { verificarEspelhoSigef } from "./lib/sigef-parcelas";
import { importCfemCsv, isCfemImportRunning, setCfemImportRunning } from "./lib/cfem-importer";
import { importSigbmCsv, isSigbmImportRunning } from "./lib/sigbm-importer";
import { importPgfnDividaAtiva, isPgfnImportRunning, setPgfnImportRunning, descobrirTrimestreMaisRecente, getLastPgfnImportResult, PGFN_CATEGORIAS } from "./lib/pgfn-importer";
import { getImportStatus } from "./lib/import-status";

const activeJobs = new Map<number, ScheduledTask>();

async function runConnectorJob(connector: { id: number; type: string; configJson: any; name: string }) {
  console.log(`[Scheduler] Executando connector ${connector.id} (${connector.name}) - tipo: ${connector.type}`);

  try {
    switch (connector.type) {
      case "anm_scraper": {
        const config = connector.configJson as { uf?: string; substancia?: string };
        const uf = config?.uf || "MG";
        const url = `http://localhost:${process.env.PORT || 5000}/api/anm/processos?uf=${uf}${config?.substancia ? `&substancia=${config.substancia}` : ""}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`ANM fetch falhou: ${resp.status}`);
        console.log(`[Scheduler] ANM connector ${connector.id} executado com sucesso.`);
        break;
      }
      case "sicar_scraper": {
        throw new Error("Connector tipo sicar_scraper não implementado ainda — dados do SICAR não estão sendo sincronizados automaticamente");
      }
      case "tah_import": {
        if (isImportRunning()) {
          console.log("[Scheduler] TAH import já em andamento, pulando execução");
          break;
        }
        setImportRunning(true);
        try {
          const result = await importTahCsv();
          console.log(`[Scheduler] TAH import concluído: ${result.imported} registros em ${(result.durationMs / 1000).toFixed(1)}s`);
        } finally {
          setImportRunning(false);
        }
        break;
      }
      case "cfem_import": {
        if (isCfemImportRunning()) {
          console.log("[Scheduler] CFEM import já em andamento, pulando execução");
          break;
        }
        setCfemImportRunning(true);
        try {
          const result = await importCfemCsv();
          console.log(`[Scheduler] CFEM import concluído: ${result.imported} registros agregados em ${(result.durationMs / 1000).toFixed(1)}s`);
        } finally {
          setCfemImportRunning(false);
        }
        break;
      }
      case "sigbm_import": {
        if (isSigbmImportRunning()) {
          console.log("[Scheduler] SIGBM import já em andamento, pulando execução");
          break;
        }
        const result = await importSigbmCsv();
        console.log(`[Scheduler] SIGBM import concluído: ${result.imported} barragens`);
        break;
      }
      case "pgfn_import": {
        // Adquire o guard ANTES de qualquer await, para não sobrepor rodadas
        // (a checagem+set síncronos são atômicos no event loop do Node)
        if (isPgfnImportRunning()) {
          console.log("[Scheduler] PGFN import já em andamento, pulando execução");
          break;
        }
        setPgfnImportRunning(true);
        try {
          // Só reimporta quando a PGFN publica um trimestre novo E a carga
          // anterior cobriu todas as categorias (importações parciais/manuais
          // de uma categoria só não contam como base atualizada)
          const trimestreAtual = await descobrirTrimestreMaisRecente();
          const ultimo = getLastPgfnImportResult()
            ?? await getImportStatus<{ status?: string; referencia?: string | null; categoriasProcessadas?: string[] }>("pgfn");
          const todasCategorias = Object.keys(PGFN_CATEGORIAS);
          const cargaCompleta = ultimo?.status === "completed"
            && ultimo?.referencia === trimestreAtual
            && todasCategorias.every(c => (ultimo?.categoriasProcessadas || []).includes(c));
          if (cargaCompleta) {
            console.log(`[Scheduler] PGFN já está na referência ${trimestreAtual} (todas as categorias), nada a importar`);
            break;
          }
          const result = await importPgfnDividaAtiva({ trimestre: trimestreAtual });
          console.log(`[Scheduler] PGFN import concluído: ${result.imported} devedores (${result.referencia}) em ${(result.durationMs / 1000).toFixed(0)}s`);
        } finally {
          setPgfnImportRunning(false);
        }
        break;
      }
      default: {
        throw new Error(`Connector tipo "${connector.type}" desconhecido — nenhuma ação executada`);
      }
    }

    await db.update(connectors)
      .set({ lastRunAt: new Date(), lastError: null } as any)
      .where(eq(connectors.id, connector.id));

  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    console.error(`[Scheduler] Erro no connector ${connector.id}:`, errorMsg);
    logApiError({ service: `Connector:${connector.name}`, endpoint: connector.type, errorMessage: errorMsg });
    await db.update(connectors)
      .set({ lastRunAt: new Date(), lastError: errorMsg } as any)
      .where(eq(connectors.id, connector.id));
  }
}

// Provisiona (idempotente) os connectors de atualização das bases locais de
// dados abertos da ANM, para que instalações limpas também agendem as rotinas.
async function ensureDadosAbertosConnectors() {
  const defaults = [
    { name: "TAH Titulares (ANM)", type: "tah_import", schedule: "0 3 2 * *" },       // mensal (dia 2, 03h)
    { name: "CFEM Arrecadação (ANM)", type: "cfem_import", schedule: "0 4 3 * *" },   // mensal (dia 3, 04h)
    { name: "SIGBM Barragens (ANM)", type: "sigbm_import", schedule: "0 4 * * 1" },   // semanal (segunda, 04h)
    { name: "PGFN Dívida Ativa", type: "pgfn_import", schedule: "0 3 5 * *" },        // mensal (dia 5, 03h) — só reimporta se o trimestre mudou
  ];
  for (const def of defaults) {
    try {
      const existing = await db.select({ id: connectors.id }).from(connectors)
        .where(eq(connectors.type, def.type)).limit(1);
      if (existing.length === 0) {
        await db.insert(connectors).values({
          name: def.name, type: def.type, schedule: def.schedule,
          status: "active", configJson: {},
        } as any);
        console.log(`[Scheduler] Connector ${def.type} provisionado (${def.schedule})`);
      }
    } catch (e: any) {
      console.error(`[Scheduler] Falha ao provisionar connector ${def.type}:`, e.message);
    }
  }
}

// Limpeza idempotente: remove o connector legado "ReceitaWS CNPJ" (tipos
// históricos "API"/"receita_ws"), que nunca teve implementação e apenas
// gravava erro diário às 06h. Roda antes de agendar os connectors, para que
// bancos já provisionados também parem de agendar o job inútil.
async function removeLegacyReceitaWsConnectors() {
  try {
    const removed = await db.delete(connectors)
      .where(sql`${connectors.type} = 'receita_ws' OR ${connectors.name} ILIKE '%receitaws%' OR (${connectors.type} = 'API' AND ${connectors.configJson}->>'baseUrl' ILIKE '%receitaws.com.br%')`)
      .returning({ id: connectors.id, name: connectors.name });
    for (const r of removed) {
      unscheduleConnector(r.id);
      console.log(`[Scheduler] Connector legado removido: ${r.id} (${r.name})`);
    }
  } catch (e: any) {
    console.error("[Scheduler] Falha ao remover connectors legados ReceitaWS:", e.message);
  }
}

export async function initScheduler() {
  console.log("[Scheduler] Iniciando agendador de connectors...");

  await removeLegacyReceitaWsConnectors();
  await ensureDadosAbertosConnectors();

  const allConnectors = await db.select().from(connectors);

  for (const connector of allConnectors) {
    if (connector.status === "active" && connector.schedule) {
      scheduleConnector(connector);
    }
  }

  console.log(`[Scheduler] ${activeJobs.size} job(s) agendado(s).`);

  // Health-check do espelho SIGEF: diário às 07h e uma vez no startup (após 30s)
  cron.schedule("0 7 * * *", () => { runSigefHealthCheck(); }, { timezone: "America/Sao_Paulo" });
  setTimeout(() => { runSigefHealthCheck(); }, 30_000);

  // Alertas de rotinas sidecar do VPS: diário às 07h30 e uma vez no startup (após 45s)
  cron.schedule("30 7 * * *", () => { runVpsRotinasCheck(); }, { timezone: "America/Sao_Paulo" });
  setTimeout(() => { runVpsRotinasCheck(); }, 45_000);

  // Frescor das bases locais da ANM (TAH/CFEM): diário às 07h e uma vez no
  // startup (após 60s), ANTES do runVpsRotinasCheck das 07h30 notificar.
  // A base de TAH ficou parada de mar–ago/2026 sem ninguém perceber — este
  // watchdog garante que a estagnação vira alerta persistente, mesmo que o
  // connector agendado falhe silenciosamente ou o app esteja fora do ar na
  // hora agendada.
  cron.schedule("0 7 * * *", () => { runBasesAnmFreshnessCheck(); }, { timezone: "America/Sao_Paulo" });
  setTimeout(() => { runBasesAnmFreshnessCheck(); }, 60_000);
}

// Espelha o padrão do freshness-check.cjs do VPS: alerta persistente em
// error_reports (type 'vps_rotina_stale' — o runVpsRotinasCheck transforma em
// notificação), dedupe de 20h e auto-resolve quando a base volta a atualizar.
// Limites por base conforme a cadência de atualização: TAH/CFEM mensais
// (+folga p/ atraso da ANM), SIGBM semanal, PGFN trimestral.
async function runBasesAnmFreshnessCheck() {
  const bases = [
    { module: "tah_import", nome: "TAH (taxa anual por hectare)", tabela: "tah_titulares", maxDias: 45 },
    { module: "cfem_import", nome: "CFEM (arrecadação)", tabela: "cfem_arrecadacao", maxDias: 45 },
    { module: "sigbm_import", nome: "SIGBM (barragens de mineração)", tabela: "sigbm_barragens", maxDias: 21 },
    { module: "pgfn_import", nome: "PGFN (dívida ativa da União)", tabela: "pgfn_divida_ativa", maxDias: 120 },
  ];
  for (const base of bases) {
    try {
      const res = await db.execute(sql.raw(`SELECT MAX(importado_em) AS ultima FROM ${base.tabela}`));
      const ultima = (res.rows?.[0] as any)?.ultima ? new Date((res.rows[0] as any).ultima) : null;
      const idadeDias = ultima ? (Date.now() - ultima.getTime()) / 86_400_000 : Infinity;
      const stale = idadeDias > base.maxDias;

      if (!stale) {
        // Auto-resolve alertas abertos quando a base recupera
        await db.execute(sql`
          UPDATE error_reports SET status='resolved', resolved_at=now(), resolved_by='freshness-check-app'
           WHERE type='vps_rotina_stale' AND status='open' AND module=${base.module}`);
        continue;
      }

      const title = `Base ${base.nome} desatualizada`;
      const description = ultima
        ? `A base local ${base.nome} não é atualizada desde ${ultima.toLocaleDateString("pt-BR")} (${Math.floor(idadeDias)} dias — limite ${base.maxDias}). Verifique o connector agendado e o log de erros.`
        : `A base local ${base.nome} está vazia — a importação inicial nunca rodou ou falhou.`;
      console.warn(`[Bases ANM] ${title}: ${description}`);
      logApiError({ service: "BasesANM", endpoint: base.module, errorMessage: description });

      // Dedupe: no máximo um alerta por módulo a cada 20h
      const existing = await db.execute(sql`
        SELECT id FROM error_reports
         WHERE type='vps_rotina_stale' AND module=${base.module}
           AND created_at > now() - interval '20 hours' LIMIT 1`);
      if (existing.rows.length > 0) continue;

      await db.insert(errorReports).values({
        type: "vps_rotina_stale",
        title,
        description,
        module: base.module,
        priority: "high",
        status: "open",
        reportedBy: "freshness-check-app",
        metadata: { module: base.module, lastSuccess: ultima ? ultima.toISOString() : null, thresholdDays: base.maxDias },
      } as any);
      console.log(`[Bases ANM] Alerta "${base.module}" registrado em error_reports.`);
    } catch (err: any) {
      console.error(`[Bases ANM] Falha ao checar frescor de ${base.module}: ${err?.message || err}`);
    }
  }
}

// Anti-spam: no máximo uma notificação por dia por tipo de problema.
// O estado é persistido como marcador em error_reports (type "sigef_notify_marker"),
// para sobreviver a restarts e funcionar entre múltiplas instâncias.
const SIGEF_NOTIFY_MARKER = "sigef_notify_marker";

function todaySaoPaulo(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/**
 * Reserva atômica do aviso diário: dentro de uma transação com advisory lock
 * (chaveado por tipo+dia), verifica se o marcador do dia já existe e, se não,
 * insere-o. Duas execuções concorrentes (mesmo em instâncias diferentes
 * apontando para o mesmo banco) serializam no lock e só uma ganha a reserva.
 */
export async function reserveSigefDailyAlert(kind: string, message: string): Promise<boolean> {
  const today = todaySaoPaulo();
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`sigef_notify:${kind}:${today}`}))`);

    const since = new Date(Date.now() - 36 * 60 * 60 * 1000);
    const rows = await tx.select({ metadata: errorReports.metadata })
      .from(errorReports)
      .where(and(
        eq(errorReports.type, SIGEF_NOTIFY_MARKER),
        eq(errorReports.title, kind),
        gte(errorReports.createdAt, since),
      ));
    if (rows.some(r => (r.metadata as any)?.day === today)) return false;

    await tx.insert(errorReports).values({
      type: SIGEF_NOTIFY_MARKER,
      title: kind,
      description: message,
      status: "resolved",
      metadata: { day: today },
    } as any);
    return true;
  });
}

async function notifySigefProblem(kind: "offline" | "defasada", title: string, message: string) {
  try {
    // Marcador é gravado na reserva (antes do disparo): o envio SSE abaixo é
    // best-effort para os clientes conectados a esta instância e não falha de
    // forma detectável, então a reserva atômica é o que evita spam diário.
    const reserved = await reserveSigefDailyAlert(kind, message);
    if (!reserved) return;

    const orgs = await db.select({ id: organizations.id }).from(organizations);
    for (const org of orgs) {
      sendNotification({
        id: notifId(),
        type: "sigef_health",
        orgId: org.id,
        title,
        message,
        createdAt: new Date().toISOString(),
      });
    }
    console.log(`[SIGEF health-check] Notificação "${kind}" enviada a ${orgs.length} organização(ões).`);
  } catch (err: any) {
    console.error(`[SIGEF health-check] Falha ao notificar equipe: ${err?.message || err}`);
  }
}

async function runVpsRotinasCheck() {
  try {
    const since = new Date(Date.now() - 30 * 60 * 60 * 1000);
    const pending = await db.select().from(errorReports).where(and(
      eq(errorReports.type, "vps_rotina_stale"),
      gte(errorReports.createdAt, since),
    ));
    const toNotify = pending.filter(r => (r.metadata as any)?.notified !== true);
    if (toNotify.length === 0) return;

    const orgs = await db.select({ id: organizations.id }).from(organizations);
    for (const report of toNotify) {
      // Claim atômico: só a instância que conseguir marcar notified=true dispara o SSE
      const claimed = await db.execute(sql`
        UPDATE error_reports
           SET metadata = coalesce(metadata, '{}'::jsonb) || '{"notified": true}'::jsonb
         WHERE id = ${report.id}
           AND coalesce(metadata->>'notified','') <> 'true'
         RETURNING id`);
      if (!claimed.rows.length) continue;

      for (const org of orgs) {
        sendNotification({
          id: notifId(),
          type: "connector_error",
          orgId: org.id,
          title: report.title,
          message: report.description || report.title,
          createdAt: new Date().toISOString(),
        });
      }
      console.log(`[VPS rotinas] Alerta "${report.module}" notificado a ${orgs.length} organização(ões).`);
    }
  } catch (err: any) {
    console.error(`[VPS rotinas] Falha ao verificar alertas: ${err?.message || err}`);
  }
}
async function runSigefHealthCheck() {
  try {
    const health = await verificarEspelhoSigef();
    if (!health.ok) {
      const msg = `Espelho SIGEF fora do ar ou com formato alterado: ${health.erro}`;
      console.error(`[SIGEF health-check] ${msg}`);
      logApiError({ service: "SIGEF", endpoint: "health-check", errorMessage: msg });
      await notifySigefProblem(
        "offline",
        "Espelho SIGEF fora do ar",
        `O espelho SIGEF está fora do ar ou com formato alterado: ${health.erro}`,
      );
      return;
    }
    for (const aviso of health.avisos) {
      console.warn(`[SIGEF health-check] ${aviso}`);
      logApiError({ service: "SIGEF", endpoint: "health-check", errorMessage: aviso });
    }
    if (health.baseDefasada) {
      await notifySigefProblem(
        "defasada",
        "Base do espelho SIGEF defasada",
        health.avisos[0] || `A base do espelho SIGEF está defasada (data-base: ${health.dataBase}, ${health.idadeDias} dias).`,
      );
    }
    if (health.avisos.length === 0) {
      console.log(`[SIGEF health-check] OK — base de ${health.dataBase} (${health.idadeDias} dias)`);
    }
  } catch (err: any) {
    console.error(`[SIGEF health-check] Falha inesperada: ${err?.message || err}`);
  }
}

export function scheduleConnector(connector: { id: number; schedule: string | null; status: string; type: string; configJson: any; name: string }) {
  if (activeJobs.has(connector.id)) {
    activeJobs.get(connector.id)!.stop();
    activeJobs.delete(connector.id);
  }

  if (connector.status !== "active" || !connector.schedule) return;

  if (!cron.validate(connector.schedule)) {
    console.warn(`[Scheduler] Expressão cron inválida para connector ${connector.id}: "${connector.schedule}"`);
    return;
  }

  const task = cron.schedule(connector.schedule, () => {
    runConnectorJob(connector);
  }, { timezone: "America/Sao_Paulo" });

  activeJobs.set(connector.id, task);
  console.log(`[Scheduler] Connector ${connector.id} (${connector.name}) agendado: ${connector.schedule}`);
}

export function unscheduleConnector(connectorId: number) {
  if (activeJobs.has(connectorId)) {
    activeJobs.get(connectorId)!.stop();
    activeJobs.delete(connectorId);
    console.log(`[Scheduler] Connector ${connectorId} desagendado.`);
  }
}

export function getSchedulerStatus() {
  return {
    activeJobs: activeJobs.size,
    jobIds: Array.from(activeJobs.keys()),
  };
}

export { runConnectorJob };
