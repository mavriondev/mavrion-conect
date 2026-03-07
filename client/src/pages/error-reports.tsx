import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ErrorReport } from "@shared/schema";
import {
  Bug, AlertCircle, CheckCircle2, Clock, AlertTriangle,
  Info, Eye, Filter, BarChart3, RefreshCw,
  Monitor, User, Globe, Zap, ChevronDown,
  XCircle, ArrowUpDown, Search, Brain, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  open: { label: "Aberto", color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800", icon: AlertCircle },
  in_progress: { label: "Em Análise", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800", icon: Clock },
  resolved: { label: "Resolvido", color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-green-200 dark:border-green-800", icon: CheckCircle2 },
  closed: { label: "Fechado", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700", icon: XCircle },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  low: { label: "Baixa", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", icon: Info },
  medium: { label: "Média", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300", icon: Clock },
  high: { label: "Alta", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300", icon: AlertTriangle },
  critical: { label: "Crítica", color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", icon: AlertCircle },
};

export default function ErrorReportsPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [selectedReport, setSelectedReport] = useState<ErrorReport | null>(null);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [monitorResumo, setMonitorResumo] = useState<string | null>(null);

  const { data: reports = [], isLoading } = useQuery<ErrorReport[]>({
    queryKey: ["/api/error-reports"],
    refetchInterval: 15000,
  });

  const { data: stats } = useQuery<{
    total: number; open: number; resolved: number; autoCapture: number;
  }>({
    queryKey: ["/api/error-reports/stats"],
    refetchInterval: 15000,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      await apiRequest("PATCH", `/api/error-reports/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/error-reports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/error-reports/stats"] });
      toast({ title: "Status atualizado" });
    },
  });

  const filtered = reports.filter((r) => {
    if (tab === "user" && r.type !== "user_report") return false;
    if (tab === "auto" && r.type !== "auto_capture") return false;
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (filterPriority !== "all" && r.priority !== filterPriority) return false;
    if (filterType !== "all" && r.type !== filterType) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        r.title.toLowerCase().includes(s) ||
        r.description?.toLowerCase().includes(s) ||
        r.module?.toLowerCase().includes(s) ||
        r.page?.toLowerCase().includes(s) ||
        r.reportedBy?.toLowerCase().includes(s)
      );
    }
    return true;
  });

  const formatDate = (d: string | Date | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto" data-testid="page-error-reports">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Bug className="w-6 h-6 text-red-500" />
            Painel de Erros & Relatórios
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerenciamento de bugs reportados e erros capturados automaticamente
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-violet-600 border-violet-200 hover:bg-violet-50 dark:border-violet-800 dark:hover:bg-violet-900/20"
            disabled={monitorLoading}
            data-testid="button-monitor-errors"
            onClick={async () => {
              setMonitorLoading(true);
              try {
                const res = await apiRequest("POST", "/api/ai/monitor-errors");
                const data = await res.json();
                setMonitorResumo(data.resumo);
              } catch (e: any) {
                toast({ title: "Erro ao gerar resumo", description: e.message, variant: "destructive" });
              } finally {
                setMonitorLoading(false);
              }
            }}
          >
            {monitorLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
            Resumo IA
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/error-reports"] });
              queryClient.invalidateQueries({ queryKey: ["/api/error-reports/stats"] });
            }}
            className="gap-1.5"
            data-testid="button-refresh-reports"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Atualizar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card data-testid="card-stat-total">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats?.total || 0}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-open">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats?.open || 0}</p>
              <p className="text-xs text-muted-foreground">Abertos</p>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-resolved">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats?.resolved || 0}</p>
              <p className="text-xs text-muted-foreground">Resolvidos</p>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-auto">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center">
              <Monitor className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats?.autoCapture || 0}</p>
              <p className="text-xs text-muted-foreground">Auto-captura</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {monitorResumo && (
        <Card data-testid="text-monitor-resumo">
          <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Brain className="w-4 h-4 text-violet-500" />
              Monitor Inteligente de Erros
            </CardTitle>
            <button
              onClick={() => setMonitorResumo(null)}
              className="text-muted-foreground hover:text-foreground"
              data-testid="button-close-monitor"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed">
            {monitorResumo.split("\n").map((line, i) => {
              if (line.startsWith("## ")) return <h3 key={i} className="text-sm font-semibold mt-3 mb-1">{line.replace("## ", "")}</h3>;
              const parts = line.split(/(\*\*.*?\*\*)/g);
              return (
                <p key={i} className="my-0.5">
                  {parts.map((part, j) =>
                    part.startsWith("**") && part.endsWith("**")
                      ? <strong key={j}>{part.slice(2, -2)}</strong>
                      : part
                  )}
                </p>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <TabsList data-testid="tabs-error-type">
            <TabsTrigger value="all" className="gap-1.5">
              <BarChart3 className="w-3.5 h-3.5" />
              Todos
            </TabsTrigger>
            <TabsTrigger value="user" className="gap-1.5">
              <User className="w-3.5 h-3.5" />
              Reportados
            </TabsTrigger>
            <TabsTrigger value="auto" className="gap-1.5">
              <Monitor className="w-3.5 h-3.5" />
              Automáticos
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 w-48 text-xs"
                data-testid="input-search-reports"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 w-32 text-xs" data-testid="select-filter-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos status</SelectItem>
                <SelectItem value="open">Aberto</SelectItem>
                <SelectItem value="in_progress">Em Análise</SelectItem>
                <SelectItem value="resolved">Resolvido</SelectItem>
                <SelectItem value="closed">Fechado</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger className="h-8 w-32 text-xs" data-testid="select-filter-priority">
                <SelectValue placeholder="Prioridade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="critical">Crítica</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
                <SelectItem value="medium">Média</SelectItem>
                <SelectItem value="low">Baixa</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <TabsContent value={tab} className="mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : filtered.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-500" />
                <h3 className="font-semibold text-lg">Nenhum registro encontrado</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {search || filterStatus !== "all" || filterPriority !== "all"
                    ? "Tente ajustar os filtros."
                    : "Nenhum erro reportado ou capturado ainda."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">#</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Título</TableHead>
                      <TableHead>Módulo</TableHead>
                      <TableHead>Prioridade</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reportado por</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => {
                      const st = STATUS_CONFIG[r.status || "open"] || STATUS_CONFIG.open;
                      const pr = PRIORITY_CONFIG[r.priority || "medium"] || PRIORITY_CONFIG.medium;
                      const StIcon = st.icon;
                      const PrIcon = pr.icon;

                      return (
                        <TableRow
                          key={r.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelectedReport(r)}
                          data-testid={`row-error-${r.id}`}
                        >
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {r.id}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px] gap-1">
                              {r.type === "auto_capture" ? (
                                <><Monitor className="w-2.5 h-2.5" /> Auto</>
                              ) : (
                                <><User className="w-2.5 h-2.5" /> Manual</>
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[250px]">
                            <span className="text-sm font-medium truncate block">{r.title}</span>
                            {r.page && (
                              <span className="text-[11px] text-muted-foreground">{r.page}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {r.module || "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[10px] gap-1 ${pr.color}`}>
                              <PrIcon className="w-2.5 h-2.5" />
                              {pr.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[10px] gap-1 ${st.color}`}>
                              <StIcon className="w-2.5 h-2.5" />
                              {st.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{r.reportedBy || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDate(r.createdAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" data-testid={`button-actions-${r.id}`}>
                                  <ChevronDown className="w-3.5 h-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelectedReport(r); }}>
                                  <Eye className="w-3.5 h-3.5 mr-2" /> Ver Detalhes
                                </DropdownMenuItem>
                                {r.status !== "in_progress" && (
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: r.id, status: "in_progress" }); }}>
                                    <Clock className="w-3.5 h-3.5 mr-2" /> Marcar Em Análise
                                  </DropdownMenuItem>
                                )}
                                {r.status !== "resolved" && (
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: r.id, status: "resolved" }); }}>
                                    <CheckCircle2 className="w-3.5 h-3.5 mr-2" /> Marcar Resolvido
                                  </DropdownMenuItem>
                                )}
                                {r.status !== "closed" && (
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: r.id, status: "closed" }); }}>
                                    <XCircle className="w-3.5 h-3.5 mr-2" /> Fechar
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedReport} onOpenChange={(v) => !v && setSelectedReport(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-error-detail">
          {selectedReport && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-lg">
                  {selectedReport.type === "auto_capture" ? (
                    <Monitor className="w-5 h-5 text-purple-500" />
                  ) : (
                    <Bug className="w-5 h-5 text-red-500" />
                  )}
                  Erro #{selectedReport.id}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-base">{selectedReport.title}</h3>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Badge variant="outline" className={`text-xs gap-1 ${STATUS_CONFIG[selectedReport.status || "open"]?.color || ""}`}>
                      {STATUS_CONFIG[selectedReport.status || "open"]?.label || selectedReport.status}
                    </Badge>
                    <Badge variant="outline" className={`text-xs gap-1 ${PRIORITY_CONFIG[selectedReport.priority || "medium"]?.color || ""}`}>
                      {PRIORITY_CONFIG[selectedReport.priority || "medium"]?.label || selectedReport.priority}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {selectedReport.type === "auto_capture" ? "Auto-captura" : "Reporte manual"}
                    </Badge>
                  </div>
                </div>

                {selectedReport.description && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Descrição</Label>
                    <p className="text-sm mt-1 bg-muted/50 rounded-lg p-3 whitespace-pre-wrap">
                      {selectedReport.description}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <InfoField label="Módulo" value={selectedReport.module} />
                  <InfoField label="Página" value={selectedReport.page} />
                  <InfoField label="Reportado por" value={selectedReport.reportedBy} />
                  <InfoField label="Data" value={formatDate(selectedReport.createdAt)} />
                  {selectedReport.resolvedAt && (
                    <>
                      <InfoField label="Resolvido em" value={formatDate(selectedReport.resolvedAt)} />
                      <InfoField label="Resolvido por" value={selectedReport.resolvedBy} />
                    </>
                  )}
                </div>

                {(selectedReport.requestUrl || selectedReport.requestMethod || selectedReport.statusCode) && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Informações da Requisição</Label>
                    <div className="bg-muted/50 rounded-lg p-3 mt-1 space-y-1 text-sm font-mono">
                      {selectedReport.requestMethod && selectedReport.requestUrl && (
                        <p>
                          <span className="font-bold">{selectedReport.requestMethod}</span>{" "}
                          {selectedReport.requestUrl}
                        </p>
                      )}
                      {selectedReport.statusCode && (
                        <p>Status: <span className={selectedReport.statusCode >= 500 ? "text-red-500 font-bold" : "text-yellow-600"}>{selectedReport.statusCode}</span></p>
                      )}
                    </div>
                  </div>
                )}

                {selectedReport.errorStack && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Stack Trace</Label>
                    <pre className="bg-gray-900 text-green-400 text-xs p-3 rounded-lg mt-1 overflow-x-auto max-h-48 overflow-y-auto">
                      {selectedReport.errorStack}
                    </pre>
                  </div>
                )}

                {selectedReport.userAgent && (
                  <div>
                    <Label className="text-xs text-muted-foreground">User Agent</Label>
                    <p className="text-xs text-muted-foreground mt-1 break-all">{selectedReport.userAgent}</p>
                  </div>
                )}

                <AiDiagnosticSection errorId={selectedReport.id} />

                <div className="flex gap-2 pt-2 border-t">
                  {selectedReport.status !== "in_progress" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => {
                        updateStatus.mutate({ id: selectedReport.id, status: "in_progress" });
                        setSelectedReport({ ...selectedReport, status: "in_progress" });
                      }}
                      data-testid="button-detail-in-progress"
                    >
                      <Clock className="w-3.5 h-3.5" /> Em Análise
                    </Button>
                  )}
                  {selectedReport.status !== "resolved" && (
                    <Button
                      size="sm"
                      variant="default"
                      className="gap-1.5"
                      onClick={() => {
                        updateStatus.mutate({ id: selectedReport.id, status: "resolved" });
                        setSelectedReport({ ...selectedReport, status: "resolved" });
                      }}
                      data-testid="button-detail-resolved"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Resolver
                    </Button>
                  )}
                  {selectedReport.status !== "closed" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5"
                      onClick={() => {
                        updateStatus.mutate({ id: selectedReport.id, status: "closed" });
                        setSelectedReport({ ...selectedReport, status: "closed" });
                      }}
                      data-testid="button-detail-closed"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Fechar
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-xs font-medium text-muted-foreground ${className}`}>{children}</p>;
}

function InfoField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <Label>{label}</Label>
      <p className="text-sm mt-0.5">{value || "—"}</p>
    </div>
  );
}

function AiDiagnosticSection({ errorId }: { errorId: number }) {
  const [diagnostico, setDiagnostico] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const runDiagnose = async () => {
    setLoading(true);
    try {
      const res = await apiRequest("POST", `/api/ai/diagnose-error/${errorId}`);
      const data = await res.json();
      if (data.diagnostico) {
        setDiagnostico(data.diagnostico);
      } else {
        toast({ title: "Erro", description: data.message || "Erro no diagnóstico", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  };

  return (
    <div className="space-y-3 pt-3 border-t">
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 w-full"
        onClick={runDiagnose}
        disabled={loading}
        data-testid="button-diagnosticar-ia"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5 text-violet-500" />}
        {loading ? "Diagnosticando..." : diagnostico ? "Rediagnosticar com IA" : "Diagnosticar com IA"}
      </Button>
      {diagnostico && (
        <div className="p-3 rounded-lg border bg-violet-50 dark:bg-violet-950/30 text-sm" data-testid="text-diagnostico-ia">
          <div className="whitespace-pre-wrap leading-relaxed">
            {diagnostico.split("\n").map((line, i) => {
              if (line.startsWith("## ")) return <h4 key={i} className="text-sm font-semibold mt-3 mb-1">{line.replace("## ", "")}</h4>;
              return <p key={i} className="my-0.5">{line}</p>;
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-2 pt-1 border-t">GPT-4o-mini</p>
        </div>
      )}
    </div>
  );
}
