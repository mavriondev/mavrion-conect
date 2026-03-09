import { db } from "../db";
import { errorReports } from "@shared/schema";
import { and, eq, gte } from "drizzle-orm";

interface ApiErrorOpts {
  service: string;
  endpoint: string;
  statusCode?: number;
  errorMessage: string;
  metadata?: any;
  orgId?: number;
}

const recentErrors = new Map<string, number>();
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

function cleanupOldEntries() {
  const now = Date.now();
  for (const [key, ts] of recentErrors) {
    if (now - ts > DEDUP_WINDOW_MS) recentErrors.delete(key);
  }
}

export async function logApiError(opts: ApiErrorOpts) {
  try {
    const dedupKey = `${opts.service}|${opts.endpoint}|${opts.statusCode || ""}`;
    const now = Date.now();

    cleanupOldEntries();

    const lastSeen = recentErrors.get(dedupKey);
    if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) return;
    recentErrors.set(dedupKey, now);

    const title = `[${opts.service}] ${opts.errorMessage.slice(0, 120)}`;

    await db.insert(errorReports).values({
      orgId: opts.orgId || null,
      type: "api_error",
      title,
      description: opts.errorMessage,
      module: opts.service,
      priority: opts.statusCode && opts.statusCode >= 500 ? "high" : "medium",
      status: "open",
      reportedBy: "system",
      requestUrl: opts.endpoint,
      statusCode: opts.statusCode || null,
      errorStack: opts.metadata?.stack || null,
      metadata: {
        service: opts.service,
        endpoint: opts.endpoint,
        ...(opts.metadata || {}),
      },
    });
  } catch (err: any) {
    console.warn("[ApiErrorLogger] Failed to log API error:", err.message);
  }
}
