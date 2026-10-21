import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { companies } from "@shared/schema";

export function companyProspectionScope(orgId: number, cnpj: string) {
  return and(eq(companies.orgId, orgId), eq(companies.cnpj, cnpj));
}

export async function getCompanyProspectionState(db: NodePgDatabase<any>, orgId: number) {
  const rows = await db.select({
    id: companies.id, cnpj: companies.cnpj, enrichmentData: companies.enrichmentData,
  }).from(companies).where(eq(companies.orgId, orgId));
  const savedCnpjMap = new Map<string, number>();
  const discardedCnpjs = new Set<string>();
  for (const row of rows) {
    if (!row.cnpj) continue;
    savedCnpjMap.set(row.cnpj, row.id);
    if ((row.enrichmentData as Record<string, unknown> | null)?.prospeccaoDescartada === true) {
      discardedCnpjs.add(row.cnpj);
    }
  }
  return { savedCnpjMap, discardedCnpjs };
}

export async function discardCompanyRecord(db: NodePgDatabase<any>, orgId: number, cnpj: string) {
  const rows = await db.update(companies).set({
    enrichmentData: sql`COALESCE(${companies.enrichmentData}, '{}'::jsonb) || '{"prospeccaoDescartada": true}'::jsonb`,
  }).where(companyProspectionScope(orgId, cnpj)).returning({ id: companies.id });
  return rows[0] || null;
}
