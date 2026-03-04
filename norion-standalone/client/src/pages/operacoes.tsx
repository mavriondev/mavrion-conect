import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useLocation, Link } from "wouter";
import {
  DollarSign, TrendingUp, Plus, Search,
  Building2, CheckCircle2, Clock, Send, FileSearch,
  BadgeDollarSign, X, Loader2,
  FileText,
  ExternalLink, Star,
  ArrowUpDown, ArrowUp, ArrowDown, Filter, LayoutList,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";

const STAGES = [
  { key: "identificado", label: "Identificado", icon: Search, color: "bg-slate-100 dark:bg-slate-800 border-slate-300" },
  { key: "diagnostico", label: "Diagnóstico", icon: FileSearch, color: "bg-blue-50 dark:bg-blue-950 border-blue-300" },
  { key: "enviado_fundos", label: "Enviado aos Fundos", icon: Send, color: "bg-indigo-50 dark:bg-indigo-950 border-indigo-300" },
  { key: "em_analise", label: "Em Análise", icon: Clock, color: "bg-amber-50 dark:bg-amber-950 border-amber-300" },
  { key: "aprovado", label: "Aprovado", icon: CheckCircle2, color: "bg-green-50 dark:bg-green-950 border-green-300" },
  { key: "comissao_gerada", label: "Comissão Gerada", icon: BadgeDollarSign, color: "bg-emerald-50 dark:bg-emerald-950 border-emerald-300" },
];

const FINALIDADES = ["Capital de Giro", "Expansão", "Equipamentos", "Imóvel", "Agro", "Outro"];

function formatBRL(value: number | null | undefined) {
  if (value == null) return "R$ 0";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 }).format(value);
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("pt-BR");
}

const STAGE_BADGE_COLORS: Record<string, string> = {
  identificado: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  diagnostico: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  enviado_fundos: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
  em_analise: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  aprovado: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  comissao_gerada: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
};

function MatchBadge({ operationId }: { operationId: number }) {
  const { data: matching = [] } = useQuery<any[]>({
    queryKey: ["/api/norion/operations", operationId, "matching-fundos"],
    queryFn: async () => {
      const res = await fetch(`/api/norion/operations/${operationId}/matching-fundos`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!operationId,
    staleTime: 60000,
  });

  if (!matching || matching.length === 0) return <span className="text-xs text-muted-foreground">—</span>;

  const best = matching.reduce((a: any, b: any) => (a.score >= b.score ? a : b), matching[0]);

  return (
    <div className="flex items-center gap-1" data-testid={`match-badge-${operationId}`}>
      <Badge variant="outline" className={cn("text-[10px] shrink-0",
        best.score >= 80 ? "border-green-400 text-green-600" :
        best.score >= 50 ? "border-amber-400 text-amber-600" :
        "border-slate-300 text-slate-500"
      )}>
        <Star className="w-2.5 h-2.5 mr-0.5" />
        {best.score}%
      </Badge>
      <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">{best.fundo?.nome}</span>
    </div>
  );
}

type SortKey = "empresa" | "cnpj" | "valor" | "finalidade" | "etapa" | "data";
type SortDir = "asc" | "desc";

export default function NorionOperacoesPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: operations = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/norion/operations"] });

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [selectedFinalidade, setSelectedFinalidade] = useState("");
  const [valorMin, setValorMin] = useState("");
  const [valorMax, setValorMax] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("data");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const changeStageMutation = useMutation({
    mutationFn: async ({ opId, stage }: { opId: number; stage: string }) => {
      const res = await fetch(`/api/norion/operations/${opId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Erro" }));
        const error: any = new Error(err.message);
        error.pendingDocs = err.pendingDocs;
        throw error;
      }
      return res.json();
    },
    onError: (err: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/operations"] });
      const description = err.pendingDocs
        ? `Documentos pendentes: ${err.pendingDocs.join(", ")}`
        : err.message;
      toast({ title: "Documentos obrigatórios pendentes", description, variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/operations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/dashboard"] });
    },
  });

  const toggleStageFilter = (stageKey: string) => {
    setSelectedStages(prev =>
      prev.includes(stageKey) ? prev.filter(s => s !== stageKey) : [...prev, stageKey]
    );
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <ArrowUpDown className="w-3 h-3 ml-1 text-muted-foreground/50" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  const filtered = useMemo(() => {
    let list = [...operations];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const digits = searchQuery.replace(/\D/g, "");
      list = list.filter((op: any) => {
        const name = (op.company?.legalName || op.company?.tradeName || "").toLowerCase();
        const cnpj = op.company?.cnpj || "";
        return name.includes(q) || (digits.length >= 2 && cnpj.includes(digits));
      });
    }

    if (selectedStages.length > 0) {
      list = list.filter((op: any) => selectedStages.includes(op.stage));
    }

    if (selectedFinalidade && selectedFinalidade !== "__all__") {
      list = list.filter((op: any) => op.diagnostico?.finalidade === selectedFinalidade);
    }

    const vMin = parseFloat(valorMin);
    const vMax = parseFloat(valorMax);
    if (!isNaN(vMin)) {
      list = list.filter((op: any) => (op.diagnostico?.valorSolicitado || 0) >= vMin);
    }
    if (!isNaN(vMax)) {
      list = list.filter((op: any) => (op.diagnostico?.valorSolicitado || 0) <= vMax);
    }

    list.sort((a: any, b: any) => {
      let cmp = 0;
      switch (sortKey) {
        case "empresa":
          cmp = (a.company?.legalName || "").localeCompare(b.company?.legalName || "");
          break;
        case "cnpj":
          cmp = (a.company?.cnpj || "").localeCompare(b.company?.cnpj || "");
          break;
        case "valor":
          cmp = (a.diagnostico?.valorSolicitado || 0) - (b.diagnostico?.valorSolicitado || 0);
          break;
        case "finalidade":
          cmp = (a.diagnostico?.finalidade || "").localeCompare(b.diagnostico?.finalidade || "");
          break;
        case "etapa": {
          const aIdx = STAGES.findIndex(s => s.key === a.stage);
          const bIdx = STAGES.findIndex(s => s.key === b.stage);
          cmp = aIdx - bIdx;
          break;
        }
        case "data":
          cmp = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [operations, searchQuery, selectedStages, selectedFinalidade, valorMin, valorMax, sortKey, sortDir]);

  const kpis = useMemo(() => {
    const total = operations.length;
    const volumeAprovado = operations
      .filter((op: any) => op.stage === "aprovado" || op.stage === "comissao_gerada")
      .reduce((sum: number, op: any) => sum + (op.valorAprovado || 0), 0);
    const emAnalise = operations.filter((op: any) => op.stage === "em_analise").length;
    const aprovados = operations.filter((op: any) => op.stage === "aprovado" || op.stage === "comissao_gerada").length;
    const taxa = total > 0 ? Math.round((aprovados / total) * 100) : 0;
    return { total, volumeAprovado, emAnalise, taxa };
  }, [operations]);

  const hasActiveFilters = searchQuery || selectedStages.length > 0 || (selectedFinalidade && selectedFinalidade !== "__all__") || valorMin || valorMax;

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedStages([]);
    setSelectedFinalidade("");
    setValorMin("");
    setValorMax("");
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <LayoutList className="w-7 h-7 text-amber-500" />
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-norion-operacoes-title">Operações</h1>
            <p className="text-sm text-muted-foreground">Pipeline de operações de crédito</p>
          </div>
        </div>
        <Link href="/operacoes/nova">
          <Button data-testid="button-n-new-operation">
            <Plus className="w-4 h-4 mr-1.5" /> Nova Operação
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card data-testid="kpi-total">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground">Total Operações</p>
                <p className="text-2xl font-bold">{kpis.total}</p>
              </div>
              <FileText className="w-8 h-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-volume">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground">Volume Aprovado</p>
                <p className="text-2xl font-bold">{formatBRL(kpis.volumeAprovado)}</p>
              </div>
              <DollarSign className="w-8 h-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-analise">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground">Em Análise</p>
                <p className="text-2xl font-bold">{kpis.emAnalise}</p>
              </div>
              <Clock className="w-8 h-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-taxa">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground">Taxa Aprovação</p>
                <p className="text-2xl font-bold">{kpis.taxa}%</p>
              </div>
              <TrendingUp className="w-8 h-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por empresa ou CNPJ..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-operations"
              />
            </div>
            <Select value={selectedFinalidade} onValueChange={setSelectedFinalidade}>
              <SelectTrigger className="w-[160px]" data-testid="select-filter-finalidade">
                <SelectValue placeholder="Finalidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas</SelectItem>
                {FINALIDADES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              type="number"
              placeholder="Valor mín"
              value={valorMin}
              onChange={(e) => setValorMin(e.target.value)}
              className="w-[110px]"
              data-testid="input-filter-valor-min"
            />
            <Input
              type="number"
              placeholder="Valor máx"
              value={valorMax}
              onChange={(e) => setValorMax(e.target.value)}
              className="w-[110px]"
              data-testid="input-filter-valor-max"
            />
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
                <X className="w-3.5 h-3.5 mr-1" /> Limpar
              </Button>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {STAGES.map(stage => (
              <Badge
                key={stage.key}
                variant={selectedStages.includes(stage.key) ? "default" : "outline"}
                className={cn("cursor-pointer text-xs", selectedStages.includes(stage.key) && STAGE_BADGE_COLORS[stage.key])}
                onClick={() => toggleStageFilter(stage.key)}
                data-testid={`filter-stage-${stage.key}`}
              >
                {stage.label}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">Nenhuma operação encontrada</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table data-testid="table-operations">
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("empresa")} data-testid="th-empresa">
                    <div className="flex items-center">Empresa <SortIcon column="empresa" /></div>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("cnpj")} data-testid="th-cnpj">
                    <div className="flex items-center">CNPJ <SortIcon column="cnpj" /></div>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("valor")} data-testid="th-valor">
                    <div className="flex items-center">Valor Solicitado <SortIcon column="valor" /></div>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("finalidade")} data-testid="th-finalidade">
                    <div className="flex items-center">Finalidade <SortIcon column="finalidade" /></div>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("etapa")} data-testid="th-etapa">
                    <div className="flex items-center">Etapa <SortIcon column="etapa" /></div>
                  </TableHead>
                  <TableHead data-testid="th-docs">Docs</TableHead>
                  <TableHead data-testid="th-match">Melhor Match</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("data")} data-testid="th-data">
                    <div className="flex items-center">Data <SortIcon column="data" /></div>
                  </TableHead>
                  <TableHead data-testid="th-acoes">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((op: any) => {
                  const stageInfo = STAGES.find(s => s.key === op.stage);
                  const docProgress = op.docProgress;
                  const docPercent = docProgress && docProgress.total > 0
                    ? Math.round((docProgress.concluidos / docProgress.total) * 100)
                    : 0;

                  return (
                    <TableRow
                      key={op.id}
                      className="cursor-pointer"
                      onClick={() => setLocation(`/operacoes/${op.id}`)}
                      data-testid={`row-operation-${op.id}`}
                    >
                      <TableCell className="font-medium max-w-[180px] truncate" data-testid={`text-empresa-${op.id}`}>
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                          <span className="truncate">{op.company?.legalName || op.company?.tradeName || "Empresa"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground" data-testid={`text-cnpj-${op.id}`}>
                        {op.company?.cnpj || "—"}
                      </TableCell>
                      <TableCell className="text-sm" data-testid={`text-valor-${op.id}`}>
                        {formatBRL(op.diagnostico?.valorSolicitado)}
                      </TableCell>
                      <TableCell className="text-sm" data-testid={`text-finalidade-${op.id}`}>
                        {op.diagnostico?.finalidade || "—"}
                      </TableCell>
                      <TableCell data-testid={`badge-etapa-${op.id}`}>
                        <Badge className={cn("text-[10px]", STAGE_BADGE_COLORS[op.stage] || "")}>
                          {stageInfo?.label || op.stage}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`docs-progress-${op.id}`}>
                        {docProgress && docProgress.total > 0 ? (
                          <div className="flex items-center gap-2 min-w-[80px]">
                            <Progress value={docPercent} className="h-2 flex-1" />
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">{docProgress.concluidos}/{docProgress.total}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell data-testid={`match-cell-${op.id}`}>
                        <MatchBadge operationId={op.id} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap" data-testid={`text-data-${op.id}`}>
                        {formatDate(op.createdAt)}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Select
                            value=""
                            onValueChange={(val) => {
                              if (val) changeStageMutation.mutate({ opId: op.id, stage: val });
                            }}
                          >
                            <SelectTrigger className="h-7 w-[130px] text-xs" data-testid={`select-stage-${op.id}`}>
                              <SelectValue placeholder="Mudar etapa" />
                            </SelectTrigger>
                            <SelectContent>
                              {STAGES.filter(s => s.key !== op.stage).map(s => (
                                <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Link href={`/operacoes/${op.id}`}>
                            <Button
                              variant="ghost"
                              size="icon"
                              data-testid={`button-detail-${op.id}`}
                            >
                              <ExternalLink className="w-4 h-4" />
                            </Button>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="p-3 border-t">
            <p className="text-xs text-muted-foreground">{filtered.length} de {operations.length} operação(ões)</p>
          </div>
        </Card>
      )}
    </div>
  );
}
