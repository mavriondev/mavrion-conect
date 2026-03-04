import type { Response } from "express";

export interface Notification {
  id: string;
  type: "deal_due" | "new_inquiry" | "new_match" | "lead_stale" | "connector_error" | "deal_stage";
  title: string;
  message: string;
  link?: string;
  orgId: number;
  createdAt: string;
}

const sseClients = new Map<number, Response[]>();

export function addSSEClient(orgId: number, res: Response) {
  if (!sseClients.has(orgId)) sseClients.set(orgId, []);
  sseClients.get(orgId)!.push(res);

  res.on("close", () => {
    const clients = sseClients.get(orgId) || [];
    const idx = clients.indexOf(res);
    if (idx > -1) clients.splice(idx, 1);
  });
}

export function sendNotification(notification: Notification) {
  const clients = sseClients.get(notification.orgId) || [];
  const data = JSON.stringify(notification);

  for (const client of clients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
    }
  }
}

export function notifId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}
