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
