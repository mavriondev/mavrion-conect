import cron from "node-cron";
import { db } from "./db";
import { connectors } from "@shared/schema";
import { eq } from "drizzle-orm";

const activeJobs = new Map<number, cron.ScheduledTask>();

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
      case "receita_ws": {
        throw new Error("Connector tipo receita_ws não implementado ainda — dados de CNPJ não estão sendo sincronizados automaticamente");
      }
      case "sicar_scraper": {
        throw new Error("Connector tipo sicar_scraper não implementado ainda — dados do SICAR não estão sendo sincronizados automaticamente");
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
    await db.update(connectors)
      .set({ lastRunAt: new Date(), lastError: errorMsg } as any)
      .where(eq(connectors.id, connector.id));
  }
}

export async function initScheduler() {
  console.log("[Scheduler] Iniciando agendador de connectors...");

  const allConnectors = await db.select().from(connectors);

  for (const connector of allConnectors) {
    if (connector.status === "active" && connector.schedule) {
      scheduleConnector(connector);
    }
  }

  console.log(`[Scheduler] ${activeJobs.size} job(s) agendado(s).`);
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
