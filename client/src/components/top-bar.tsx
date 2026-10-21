import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useNotifications } from "@/hooks/use-notifications";
import { useLocation } from "wouter";
import { BellRing, Bug, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

function NotificationBell() {
  const { notifications, unreadCount, markAllRead } = useNotifications();
  const [, setLocation] = useLocation();

  return (
    <Popover onOpenChange={(open) => { if (open) markAllRead(); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative h-7 w-7 p-0 text-muted-foreground/60 hover:text-foreground" data-testid="button-notification-bell">
          <BellRing className="w-3.5 h-3.5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 text-white text-[9px] flex items-center justify-center font-bold" data-testid="badge-notification-count">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end" data-testid="popover-notifications">
        <div className="p-3 border-b font-medium text-sm flex items-center justify-between">
          <span>Notificações</span>
          {notifications.length > 0 && (
            <span className="text-[11px] font-normal text-muted-foreground">{notifications.length} recentes</span>
          )}
        </div>
        <ScrollArea className="h-72">
          {notifications.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm p-8">
              <BellRing className="w-6 h-6 mx-auto mb-2 opacity-15" />
              <p className="text-xs">Nenhuma notificação</p>
            </div>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                className={`p-3 border-b cursor-pointer hover:bg-muted/40 transition-colors ${!n.read ? "bg-emerald-50/50 dark:bg-emerald-950/10" : ""}`}
                onClick={() => n.link && setLocation(n.link)}
                data-testid={`notification-sse-${n.id}`}
              >
                <p className="font-medium text-[13px]">{n.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  {new Date(n.createdAt).toLocaleString("pt-BR")}
                </p>
              </div>
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

const MODULE_OPTIONS = [
  "Dashboard", "Prospeccao", "Empresas",
  "Ativos", "Propostas", "Contratos", "Portal", "Geo/Rural",
  "ANM", "Configuracoes", "Outro",
];

function ReportBugButton() {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [module, setModule] = useState("");
  const [priority, setPriority] = useState("medium");
  const { toast } = useToast();
  const { user } = useAuth();
  const [location] = useLocation();

  const reset = () => {
    setTitle("");
    setDescription("");
    setModule("");
    setPriority("medium");
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast({ title: "Título obrigatório", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      await apiRequest("POST", "/api/error-reports", {
        title: title.trim(),
        description: description.trim() || title.trim(),
        module: module || "Outro",
        priority,
        page: location,
        userAgent: navigator.userAgent,
      });
      toast({ title: "Bug reportado com sucesso" });
      reset();
      setOpen(false);
    } catch {
      toast({ title: "Erro ao enviar relatório", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 text-[11px] text-muted-foreground/50 hover:text-foreground"
        onClick={() => setOpen(true)}
        data-testid="button-report-bug"
      >
        <Bug className="w-3 h-3" />
        <span className="hidden sm:inline">Bug</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-report-bug">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Bug className="w-4 h-4 text-red-500" />
              Reportar Bug
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="bug-title" className="text-xs">Título *</Label>
              <Input
                id="bug-title"
                placeholder="Descreva o problema em poucas palavras"
                value={title}
                onChange={e => setTitle(e.target.value)}
                data-testid="input-bug-title"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bug-description" className="text-xs">Descrição</Label>
              <Textarea
                id="bug-description"
                placeholder="Detalhe o que aconteceu, os passos para reproduzir, o que era esperado..."
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                data-testid="input-bug-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Módulo</Label>
                <Select value={module} onValueChange={setModule}>
                  <SelectTrigger data-testid="select-bug-module">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {MODULE_OPTIONS.map(m => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Prioridade</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger data-testid="select-bug-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Baixa</SelectItem>
                    <SelectItem value="medium">Média</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="critical">Crítica</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} data-testid="button-cancel-bug">
              Cancelar
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={sending} data-testid="button-submit-bug">
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function TopBar() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div
      className="sticky top-0 z-30 w-full h-9 bg-background/80 backdrop-blur-md border-b border-border/40 flex items-center justify-end px-4 md:px-5"
      data-testid="top-bar"
    >
      <div className="flex items-center gap-0.5">
        <ReportBugButton />
        <NotificationBell />
      </div>
    </div>
  );
}
