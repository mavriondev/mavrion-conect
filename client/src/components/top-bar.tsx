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
        <Button variant="ghost" size="sm" className="relative h-8 w-8 p-0" data-testid="button-notification-bell">
          <BellRing className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold" data-testid="badge-notification-count">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end" data-testid="popover-notifications">
        <div className="p-3 border-b font-semibold text-sm flex items-center justify-between">
          <span>Notificações</span>
          {notifications.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">{notifications.length} recentes</span>
          )}
        </div>
        <ScrollArea className="h-80">
          {notifications.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm p-6">
              <BellRing className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p>Nenhuma notificação</p>
            </div>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                className={`p-3 border-b cursor-pointer hover:bg-muted/50 transition-colors ${!n.read ? "bg-blue-50 dark:bg-blue-950/20" : ""}`}
                onClick={() => n.link && setLocation(n.link)}
                data-testid={`notification-sse-${n.id}`}
              >
                <p className="font-medium text-sm">{n.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                <p className="text-xs text-muted-foreground mt-1">
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
  "Dashboard", "CRM", "Matching", "Prospeccao", "Empresas",
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
        className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        data-testid="button-report-bug"
      >
        <Bug className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Reportar Bug</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-report-bug">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bug className="w-5 h-5 text-red-500" />
              Reportar Bug
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="bug-title">Título *</Label>
              <Input
                id="bug-title"
                placeholder="Descreva o problema em poucas palavras"
                value={title}
                onChange={e => setTitle(e.target.value)}
                data-testid="input-bug-title"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bug-description">Descrição</Label>
              <Textarea
                id="bug-description"
                placeholder="Detalhe o que aconteceu, os passos para reproduzir, o que era esperado..."
                rows={4}
                value={description}
                onChange={e => setDescription(e.target.value)}
                data-testid="input-bug-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Módulo</Label>
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
                <Label>Prioridade</Label>
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
            <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-bug">
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={sending} data-testid="button-submit-bug">
              {sending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Bug className="w-4 h-4 mr-1" />}
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
      className="sticky top-0 z-30 w-full h-11 bg-background/95 backdrop-blur-sm border-b border-border flex items-center justify-end px-4 md:px-6"
      data-testid="top-bar"
    >
      <div className="flex items-center gap-1.5">
        <ReportBugButton />
        <NotificationBell />
      </div>
    </div>
  );
}
