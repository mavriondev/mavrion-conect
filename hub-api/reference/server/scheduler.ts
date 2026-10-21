import cron from "node-cron";
import cronParser from "cron-parser";
import { pool } from "./db";
import { enqueueImport } from "./lib/sicar-import";

const TIMEZONE = "America/Sao_Paulo";
const activeJobs = new Map<number, cron.ScheduledTask>();
const scheduledBatchTimeout: { ref: ReturnType<typeof setTimeout> | null } = { ref: null };
const scheduledBatchUfs: { scheduleId: number; uf: string }[] = [];

export async function initScheduler(): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT * FROM sicar_import_schedule WHERE ativo = true`
    );

    for (const schedule of result.rows) {
      scheduleImport(schedule);
    }

    console.log(`Scheduler SICAR inicializado: ${result.rows.length} rotina(s) ativa(s)`);
  } catch (error: any) {
    console.error("Erro ao inicializar scheduler SICAR:", error.message);
  }
}

export function scheduleImport(schedule: any): void {
  if (activeJobs.has(schedule.id)) {
    activeJobs.get(schedule.id)!.stop();
    activeJobs.delete(schedule.id);
  }

  if (!schedule.ativo) return;

  if (!cron.validate(schedule.cron_expression)) {
    console.error(`SICAR Scheduler: expressão cron inválida para schedule ${schedule.id}: ${schedule.cron_expression}`);
    return;
  }

  const job = cron.schedule(schedule.cron_expression, async () => {
    console.log(`SICAR Scheduler: agendamento disparado para ${schedule.uf} (schedule ${schedule.id})`);

    try {
      await pool.query(
        `UPDATE sicar_import_schedule SET ultima_execucao = CURRENT_TIMESTAMP WHERE id = $1`,
        [schedule.id]
      );

      const nextDate = getNextCronDate(schedule.cron_expression);
      if (nextDate) {
        await pool.query(
          `UPDATE sicar_import_schedule SET proxima_execucao = $1 WHERE id = $2`,
          [nextDate, schedule.id]
        );
      }
    } catch (error: any) {
      console.error(`SICAR Scheduler: erro ao atualizar schedule ${schedule.id}: ${error.message}`);
    }

    scheduledBatchUfs.push({ scheduleId: schedule.id, uf: schedule.uf });

    if (scheduledBatchTimeout.ref) {
      clearTimeout(scheduledBatchTimeout.ref);
    }
    scheduledBatchTimeout.ref = setTimeout(() => {
      const ufs = scheduledBatchUfs.map(item => item.uf);
      scheduledBatchUfs.length = 0;
      scheduledBatchTimeout.ref = null;

      console.log(`SICAR Scheduler: enfileirando ${ufs.length} UF(s) para importação sequencial: ${ufs.join(", ")}`);
      enqueueImport(ufs, undefined, "scheduled");
    }, 5000);
  }, { timezone: TIMEZONE });

  activeJobs.set(schedule.id, job);

  const nextDate = getNextCronDate(schedule.cron_expression);
  if (nextDate) {
    pool.query(
      `UPDATE sicar_import_schedule SET proxima_execucao = $1 WHERE id = $2`,
      [nextDate, schedule.id]
    ).catch(() => {});
  }
}

export function unscheduleImport(id: number): void {
  if (activeJobs.has(id)) {
    activeJobs.get(id)!.stop();
    activeJobs.delete(id);
  }
}

export function updateSchedule(schedule: any): void {
  unscheduleImport(schedule.id);
  if (schedule.ativo) {
    scheduleImport(schedule);
  }
}

function getNextCronDate(cronExpression: string): Date | null {
  try {
    const interval = cronParser.parseExpression(cronExpression, { tz: TIMEZONE });
    return interval.next().toDate();
  } catch {
    return null;
  }
}

export function isValidCron(expression: string): boolean {
  return cron.validate(expression);
}
