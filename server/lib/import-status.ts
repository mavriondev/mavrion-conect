// Persistência do resultado da última importação de bases externas (CFEM,
// SIGBM, ...). Sobrevive a restarts e a importações rodadas fora do processo
// do servidor (ex.: scripts/run-cfem-import.ts).
import { db } from "../db";
import { importStatus } from "@shared/schema";
import { sql, eq } from "drizzle-orm";

export async function saveImportStatus(fonte: string, payload: object): Promise<void> {
  try {
    await db.insert(importStatus)
      .values({ fonte, payload, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: importStatus.fonte,
        set: { payload, updatedAt: sql`NOW()` },
      });
  } catch (e: any) {
    // Não deixa a persistência do status derrubar a importação em si
    console.error(`[ImportStatus] Falha ao gravar status de ${fonte}:`, e.message);
  }
}

export async function getImportStatus<T = Record<string, unknown>>(fonte: string): Promise<T | null> {
  try {
    const [row] = await db.select().from(importStatus).where(eq(importStatus.fonte, fonte)).limit(1);
    return (row?.payload as T) ?? null;
  } catch (e: any) {
    console.error(`[ImportStatus] Falha ao ler status de ${fonte}:`, e.message);
    return null;
  }
}
