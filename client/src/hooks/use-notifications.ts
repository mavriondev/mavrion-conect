import { useEffect, useState, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  createdAt: string;
  read: boolean;
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const { toast } = useToast();

  // Alertas persistentes (ex.: rotina VPS defasada): carregados no login a partir
  // do servidor, para não depender de estar online no momento do SSE.
  useEffect(() => {
    fetch("/api/notifications/pending", { credentials: "include" })
      .then(r => (r.ok ? r.json() : []))
      .then((pending: Omit<AppNotification, "read">[]) => {
        if (!Array.isArray(pending) || pending.length === 0) return;
        setNotifications(prev => {
          const existing = new Set(prev.map(n => n.id));
          const novos = pending.filter(p => !existing.has(p.id)).map(p => ({ ...p, read: false }));
          if (novos.length) setUnreadCount(c => c + novos.length);
          return [...novos, ...prev].slice(0, 50);
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/notifications/stream");

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "connected") return;

        const notification: AppNotification = { ...data, read: false };

        setNotifications(prev => [notification, ...prev].slice(0, 50));
        setUnreadCount(prev => prev + 1);

        toast({
          title: notification.title,
          description: notification.message,
          duration: 5000,
        });
      } catch {
      }
    };

    source.onerror = () => {
    };

    return () => source.close();
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  }, []);

  return { notifications, unreadCount, markAllRead };
}
