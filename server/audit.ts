import { db } from "./db";
import { auditLogs } from "@shared/schema";
import { getOrgId } from "./lib/tenant";

interface AuditOptions {
  orgId?: number;
  userId: number;
  userName: string;
  entity: "deal" | "lead" | "company" | "asset" | "connector";
  entityId: number;
  entityTitle?: string;
  action: "created" | "updated" | "deleted" | "stage_changed" | "status_changed";
  changes?: Record<string, { from: any; to: any }>;
}

export async function audit(opts: AuditOptions) {
  try {
    await db.insert(auditLogs).values({
      orgId: opts.orgId ?? getOrgId(),
      userId: opts.userId,
      userName: opts.userName,
      entity: opts.entity,
      entityId: opts.entityId,
      entityTitle: opts.entityTitle,
      action: opts.action,
      changesJson: opts.changes || {},
    });
  } catch (err) {
    console.error("[Audit] Falha ao registrar:", err);
  }
}

export function diff(before: Record<string, any>, after: Record<string, any>, fields: string[]) {
  const changes: Record<string, { from: any; to: any }> = {};
  for (const field of fields) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      changes[field] = { from: before[field], to: after[field] };
    }
  }
  return changes;
}
