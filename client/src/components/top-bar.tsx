import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useNotifications } from "@/hooks/use-notifications";
import {
  Bell, Bug, ChevronDown, AlertCircle, CheckCircle2,
  Clock, Send, AlertTriangle, Info, X, BellRing,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ErrorReport } from "@shared/schema";

const MODULE_OPTIONS = [
  { value: "dashboard", label: "Dashboard" },
  { value: "sdr", label: "SDR / Leads" },
  { value: "crm", label: "CRM Pipeline" },
  { value: "ativos", label: "Ativos" },
  { value: "empresas", label: "Empresas" },
  { value: "propostas", label: "Propostas" },
  { value: "contratos", label: "Contratos" },
  { value: "portal", label: "Portal Investidor" },
  { value: "matching", label: "Matching" },
  { value: "anm", label: "ANM Geoportal" },
  { value: "geo-rural", label: "Prospecção Rural" },
  { value: "analise-agro", label: "Análise Agro" },
  { value: "configuracoes", label: "Configurações" },
  { value: "relatorios", label: "Relatórios" },
  { value: "outro", label: "Outro" },
];

const PRIORITY_CONFIG = {
  low: { label: "Baixa", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  medium: { label: "Média", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300" },
  high: { label: "Alta", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  critical: { label: "Crítica", color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
};

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

export default function TopBar() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [bugDialogOpen, setBugDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [module, setModule] = useState("");
  const [priority, setPriority] = useState("medium");

  const { data: stats } = useQuery<{
    total: number; open: number; resolved: number; autoCapture: number;
  }>({
    queryKey: ["/api/error-reports/stats"],
    refetchInterval: 30000,
  });

  const { data: recentReports = [] } = useQuery<ErrorReport[]>({
    queryKey: ["/api/error-reports"],
    refetchInterval: 30000,
  });

  const openReports = recentReports.filter(
    (r) => r.status === "open" || r.status === "in_progress"
  );
  const recentOpen = openReports.slice(0, 5);

  const submitBug = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/error-reports", {
        type: "user_report",
        title,
        description,
        page: window.location.pathname,
        module: module || null,
        priority,
        userAgent: navigator.userAgent,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/error-reports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/error-reports/stats"] });
      toast({ title: "Bug reportado!", description: "Seu relatório foi enviado ao administrador." });
      setBugDialogOpen(false);
      setTitle("");
      setDescription("");
      setModule("");
      setPriority("medium");
    },
    onError: () => {
      toast({ title: "Erro", description: "Não foi possível enviar o relatório.", variant: "destructive" });
    },
  });

  const priorityIcon = (p: string) => {
    if (p === "critical") return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
    if (p === "high") return <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />;
    if (p === "medium") return <Clock className="w-3.5 h-3.5 text-yellow-500" />;
    return <Info className="w-3.5 h-3.5 text-blue-500" />;
  };

  const typeLabel = (t: string) => {
    if (t === "auto_capture") return "Auto";
    return "Manual";
  };

  if (!user) return null;

  return (
    <>
      <div
        className="sticky top-0 z-30 w-full h-11 bg-background/95 backdrop-blur-sm border-b border-border flex items-center justify-between px-4 md:px-6"
        data-testid="top-bar"
      >
        <div className="flex items-center gap-2">
          {stats && stats.open > 0 && (
            <Badge variant="outline" className="text-xs gap-1 border-red-300 dark:border-red-700 text-red-600 dark:text-red-400" data-testid="badge-open-errors">
              <AlertCircle className="w-3 h-3" />
              {stats.open} {stats.open === 1 ? "pendente" : "pendentes"}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <NotificationBell />

          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs h-8"
            onClick={() => setBugDialogOpen(true)}
            data-testid="button-report-bug"
          >
            <Bug className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reportar Bug</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="relative h-8 w-8 p-0"
                data-testid="button-notifications"
              >
                <Bell className="w-4 h-4" />
                {openReports.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">
                    {openReports.length > 9 ? "9+" : openReports.length}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80" data-testid="dropdown-notifications">
              <DropdownMenuLabel className="flex items-center justify-between">
                <span>Notificações & Erros</span>
                {stats && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {stats.open} abertos · {stats.resolved} resolvidos
                  </span>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {recentOpen.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />
                  Nenhum erro pendente
                </div>
              ) : (
                recentOpen.map((r) => (
                  <DropdownMenuItem
                    key={r.id}
                    className="flex flex-col items-start gap-1 cursor-pointer py-2.5"
                    onClick={() => setLocation("/error-reports")}
                    data-testid={`notification-item-${r.id}`}
                  >
                    <div className="flex items-center gap-2 w-full">
                      {priorityIcon(r.priority || "medium")}
                      <span className="text-xs font-medium flex-1 truncate">{r.title}</span>
                      <Badge variant="outline" className="text-[10px] h-4">
                        {typeLabel(r.type)}
                      </Badge>
                    </div>
                    <span className="text-[11px] text-muted-foreground line-clamp-1 pl-5">
                      {r.description?.substring(0, 80) || "Sem descrição"}
                    </span>
                  </DropdownMenuItem>
                ))
              )}
              {openReports.length > 5 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-center text-xs text-primary justify-center cursor-pointer"
                    onClick={() => setLocation("/error-reports")}
                    data-testid="link-view-all-errors"
                  >
                    Ver todos ({openReports.length})
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-center text-xs justify-center cursor-pointer gap-1.5"
                onClick={() => setLocation("/error-reports")}
                data-testid="link-error-panel"
              >
                <Bug className="w-3 h-3" />
                Painel de Erros & Relatórios
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={bugDialogOpen} onOpenChange={setBugDialogOpen}>
        <DialogContent className="sm:max-w-lg" data-testid="dialog-report-bug">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bug className="w-5 h-5 text-red-500" />
              Reportar Bug ou Problema
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="bug-title">Título *</Label>
              <Input
                id="bug-title"
                placeholder="Descreva brevemente o problema..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="input-bug-title"
              />
            </div>

            <div>
              <Label htmlFor="bug-description">Descrição</Label>
              <Textarea
                id="bug-description"
                placeholder="Detalhe o que aconteceu, passos para reproduzir, o que esperava..."
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                data-testid="input-bug-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Módulo</Label>
                <Select value={module} onValueChange={setModule}>
                  <SelectTrigger data-testid="select-bug-module">
                    <SelectValue placeholder="Selecionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {MODULE_OPTIONS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Prioridade</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger data-testid="select-bug-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">🟢 Baixa</SelectItem>
                    <SelectItem value="medium">🟡 Média</SelectItem>
                    <SelectItem value="high">🟠 Alta</SelectItem>
                    <SelectItem value="critical">🔴 Crítica</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Informações automáticas incluídas:</p>
              <p>• Página atual: {window.location.pathname}</p>
              <p>• Usuário: {user?.username}</p>
              <p>• Navegador detectado automaticamente</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setBugDialogOpen(false)} data-testid="button-cancel-bug">
              Cancelar
            </Button>
            <Button
              onClick={() => submitBug.mutate()}
              disabled={!title.trim() || submitBug.isPending}
              className="gap-1.5"
              data-testid="button-submit-bug"
            >
              <Send className="w-3.5 h-3.5" />
              {submitBug.isPending ? "Enviando..." : "Enviar Relatório"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
