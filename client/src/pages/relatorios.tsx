import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area, FunnelChart, Funnel, LabelList,
} from "recharts";
import {
  BarChart2, TrendingUp, Layers, Magnet, Building2, Download,
  Filter, Calendar, ArrowUpRight, ArrowDownRight, DollarSign,
  MapPin, Briefcase, X, Target, Percent, History,
  PenLine, Shuffle, CirclePlus, CircleMinus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, subDays, isAfter, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

const CHART_COLORS = [
  "hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))",
  "hsl(var(--chart-4))", "hsl(var(--chart-5))",
];

const TIPO_LABEL: Record<string, string> = {
  TERRA: "Terras/Fazendas", MINA: "Mineração", NEGOCIO: "Negócio/M&A",
  FII_CRI: "FII/CRI", DESENVOLVIMENTO: "Desenvolvimento", AGRO: "Agronegócio",
};

const PERIOD_OPTIONS = [
  { value: "7",   label: "Últimos 7 dias" },
  { value: "30",  label: "Últimos 30 dias" },
  { value: "90",  label: "Últimos 90 dias" },
  { value: "365", label: "Último ano" },
  { value: "all", label: "Todo o período" },
];

const PIPELINE_TYPE_OPTIONS = [
  { value: "all", label: "Todos os pipelines" },
  { value: "INVESTOR", label: "Investidor" },
  { value: "ASSET", label: "Ativo/Captação" },
];

const ASSET_TYPE_OPTIONS = [
  { value: "all", label: "Todos os tipos" },
  { value: "TERRA", label: "Terras/Fazendas" },
  { value: "MINA", label: "Mineração" },
  { value: "NEGOCIO", label: "Negócio/M&A" },
  { value: "FII_CRI", label: "FII/CRI" },
  { value: "DESENVOLVIMENTO", label: "Desenvolvimento" },
  { value: "AGRO", label: "Agronegócio" },
];

const PRIORITY_OPTIONS = [
  { value: "all", label: "Todas as prioridades" },
  { value: "high", label: "Alta" },
  { value: "medium", label: "Média" },
  { value: "low", label: "Baixa" },
];

function filterByPeriod(items: any[], field: string, days: string) {
  if (days === "all") return items;
  const cutoff = subDays(new Date(), parseInt(days));
  return items.filter(item => {
    if (!item[field]) return false;
    try { return isAfter(parseISO(item[field]), cutoff); } catch { return false; }
  });
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of arr) {
    const k = key(item);
    if (!result[k]) result[k] = [];
    result[k].push(item);
  }
  return result;
}

function buildMonthlyData(items: any[], field = "createdAt", months = 6) {
  const data: { name: string; value: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = format(d, "MMM/yy", { locale: ptBR });
    const count = items.filter(it => it[field]?.startsWith(key)).length;
    data.push({ name: label, value: count });
  }
  return data;
}

function buildMonthlyValueData(items: any[], field = "createdAt", valueField = "amountEstimate", months = 6) {
  const data: { name: string; value: number; count: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = format(d, "MMM/yy", { locale: ptBR });
    const matching = items.filter(it => it[field]?.startsWith(key));
    const total = matching.reduce((s, it) => s + (it[valueField] || 0), 0);
    data.push({ name: label, value: total, count: matching.length });
  }
  return data;
}

function KpiTile({ label, value, sub, change, changeUp, icon: Icon, color = "primary" }: {
  label: string; value: string | number; sub?: string; change?: string; changeUp?: boolean;
  icon: any; color?: string;
}) {
  return (
    <Card className="border-border/50 shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
            <p className="text-3xl font-display font-bold mt-1">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Icon className="w-5 h-5 text-primary" />
          </div>
        </div>
        {change && (
          <div className={cn(
            "flex items-center gap-1 text-xs font-medium mt-3",
            changeUp ? "text-emerald-600" : "text-red-500"
          )}>
            {changeUp ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
            {change}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const ACTIVITY_ACTION_CONFIG: Record<string, { label: string; icon: typeof CirclePlus; color: string; bg: string }> = {
  created: { label: "Criado", icon: CirclePlus, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
  updated: { label: "Atualizado", icon: PenLine, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-900/20" },
  deleted: { label: "Excluído", icon: CircleMinus, color: "text-red-600", bg: "bg-red-50 dark:bg-red-900/20" },
  stage_changed: { label: "Etapa alterada", icon: Shuffle, color: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-900/20" },
  status_changed: { label: "Status alterado", icon: Shuffle, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-900/20" },
};

const ENTITY_LABEL: Record<string, string> = {
  deal: "Deal", lead: "Lead", company: "Empresa", asset: "Ativo", connector: "Conector",
};

function ActivityFeed() {
  const [entityFilter, setEntityFilter] = useState("all");
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["/api/audit-logs", entityFilter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "100" });
      if (entityFilter !== "all") params.set("entity", entityFilter);
      return apiRequest("GET", `/api/audit-logs?${params}`).then(r => r.json());
    },
  });

  const grouped = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const log of logs) {
      const day = format(new Date(log.createdAt), "yyyy-MM-dd");
      if (!groups[day]) groups[day] = [];
      groups[day].push(log);
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [logs]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="w-4 h-4" /> Histórico de Atividades
          </CardTitle>
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-activity-entity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as entidades</SelectItem>
              <SelectItem value="deal">Deals</SelectItem>
              <SelectItem value="lead">Leads</SelectItem>
              <SelectItem value="company">Empresas</SelectItem>
              <SelectItem value="asset">Ativos</SelectItem>
              <SelectItem value="connector">Conectores</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <History className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm">Nenhuma atividade registrada.</p>
            <p className="text-xs mt-1">As ações realizadas no sistema aparecerão aqui.</p>
          </div>
        ) : (
          <div className="space-y-6" data-testid="activity-feed">
            {grouped.map(([day, dayLogs]) => (
              <div key={day}>
                <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
                  {format(new Date(day + "T12:00:00"), "EEEE, dd 'de' MMMM", { locale: ptBR })}
                </p>
                <div className="space-y-2">
                  {dayLogs.map((log: any) => {
                    const config = ACTIVITY_ACTION_CONFIG[log.action] || ACTIVITY_ACTION_CONFIG.updated;
                    const Icon = config.icon;
                    const changes = (log.changesJson && typeof log.changesJson === "object") ? log.changesJson as Record<string, any> : {};
                    const changeKeys = Object.keys(changes);
                    return (
                      <div key={log.id} className={cn("flex items-start gap-3 p-3 rounded-lg border", config.bg)} data-testid={`activity-entry-${log.id}`}>
                        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0", config.color, "bg-background border")}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{log.userName}</span>
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5">{config.label}</Badge>
                            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{ENTITY_LABEL[log.entity] || log.entity}</Badge>
                          </div>
                          {log.entityTitle && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                              {log.entityTitle}
                            </p>
                          )}
                          {changeKeys.length > 0 && (
                            <div className="mt-1.5 space-y-0.5">
                              {changeKeys.slice(0, 3).map(field => {
                                const change = changes[field];
                                if (!change || typeof change !== "object") return null;
                                return (
                                  <p key={field} className="text-[11px] text-muted-foreground">
                                    <span className="font-medium">{field}:</span>{" "}
                                    {String(change.from ?? "—")} → {String(change.to ?? "—")}
                                  </p>
                                );
                              })}
                              {changeKeys.length > 3 && (
                                <p className="text-[10px] text-muted-foreground/60">+{changeKeys.length - 3} mais alterações</p>
                              )}
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0 mt-1">
                          {format(new Date(log.createdAt), "HH:mm", { locale: ptBR })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function RelatoriosPage() {
  const [period, setPeriod] = useState("30");
  const [activeTab, setActiveTab] = useState("geral");
  const [filterPipelineType, setFilterPipelineType] = useState("all");
  const [filterAssetType, setFilterAssetType] = useState("all");
  const [filterUF, setFilterUF] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");

  const { data: companies = [] } = useQuery({
    queryKey: ["/api/crm/companies"],
    queryFn: () => apiRequest("GET", "/api/crm/companies").then(r => r.json()),
  });
  const { data: deals = [] } = useQuery({
    queryKey: ["/api/crm/deals"],
    queryFn: () => apiRequest("GET", "/api/crm/deals").then(r => r.json()),
  });
  const { data: assets = [] } = useQuery({
    queryKey: ["/api/matching/assets"],
    queryFn: () => apiRequest("GET", "/api/matching/assets").then(r => r.json()),
  });
  const { data: stages = [] } = useQuery({
    queryKey: ["/api/crm/stages"],
    queryFn: () => apiRequest("GET", "/api/crm/stages").then(r => r.json()),
  });

  const availableUFs = useMemo(() => {
    const ufs = new Set<string>();
    (assets as any[]).forEach(a => { if (a.estado) ufs.add(a.estado); });
    (companies as any[]).forEach(c => { if (c.address?.uf) ufs.add(c.address.uf); });
    return Array.from(ufs).sort();
  }, [assets, companies]);

  const lastStageId = useMemo(() => {
    const sorted = [...(stages as any[])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return sorted.length > 0 ? sorted[sorted.length - 1].id : null;
  }, [stages]);

  const filteredCompanies = useMemo(() => {
    let result = filterByPeriod(companies as any[], "createdAt", period);
    if (filterUF !== "all") {
      result = result.filter(c => c.address?.uf === filterUF);
    }
    return result;
  }, [companies, period, filterUF]);

  const filteredDeals = useMemo(() => {
    let result = filterByPeriod(deals as any[], "createdAt", period);
    if (filterPipelineType !== "all") {
      if (filterPipelineType === "INVESTOR") {
        result = result.filter(d => d.pipelineType === "INVESTOR");
      } else {
        result = result.filter(d => d.pipelineType !== "INVESTOR");
      }
    }
    if (filterAssetType !== "all") {
      const assetIds = new Set((assets as any[]).filter(a => a.type === filterAssetType).map(a => a.id));
      result = result.filter(d => d.assetId && assetIds.has(d.assetId));
    }
    if (filterPriority !== "all") {
      result = result.filter(d => d.priority === filterPriority);
    }
    if (filterUF !== "all") {
      const assetIdsInUF = new Set((assets as any[]).filter(a => a.estado === filterUF).map(a => a.id));
      result = result.filter(d => {
        if (d.assetId && assetIdsInUF.has(d.assetId)) return true;
        return false;
      });
    }
    return result;
  }, [deals, period, filterPipelineType, filterAssetType, filterPriority, filterUF, assets]);

  const hasActiveFilters = filterPipelineType !== "all" || filterAssetType !== "all" || filterUF !== "all" || filterPriority !== "all" || period !== "30";

  const clearAllFilters = () => {
    setPeriod("30");
    setFilterPipelineType("all");
    setFilterAssetType("all");
    setFilterUF("all");
    setFilterPriority("all");
  };

  const totalRevEst = (filteredDeals as any[]).reduce((s, d) => s + (d.amountEstimate || 0), 0);
  const investorDeals = (filteredDeals as any[]).filter(d => d.pipelineType === "INVESTOR").length;
  const assetDeals = (filteredDeals as any[]).filter(d => d.pipelineType !== "INVESTOR").length;

  const conversionRate = useMemo(() => {
    if (!lastStageId || filteredDeals.length === 0) return 0;
    const converted = (filteredDeals as any[]).filter(d => d.stageId === lastStageId).length;
    return (converted / filteredDeals.length) * 100;
  }, [filteredDeals, lastStageId]);

  const monthlyCompanies = buildMonthlyData(companies as any[], "createdAt", 6);
  const monthlyDeals = buildMonthlyData(deals as any[], "createdAt", 6);

  const dealsByStage = useMemo(() => {
    const stagesMap = Object.fromEntries((stages as any[]).map((s: any) => [s.id, s.name]));
    const grouped = groupBy(filteredDeals as any[], d => stagesMap[d.stageId] || "Sem Estágio");
    return Object.entries(grouped).map(([name, items]) => ({
      name,
      count: items.length,
      value: items.reduce((s, d) => s + (d.amountEstimate || 0), 0),
    }));
  }, [filteredDeals, stages]);

  const companiesByUF = useMemo(() => {
    const grouped = groupBy(filteredCompanies as any[], co => co.address?.uf || "N/I");
    return Object.entries(grouped)
      .map(([uf, items]) => ({ name: uf, value: items.length }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
  }, [filteredCompanies]);

  const companiesByPorte = useMemo(() => {
    const grouped = groupBy(filteredCompanies as any[], co => co.porte || "Não informado");
    return Object.entries(grouped).map(([name, items]) => ({ name, value: items.length }));
  }, [filteredCompanies]);

  const assetsByType = useMemo(() => {
    const grouped = groupBy(assets as any[], a => TIPO_LABEL[a.type] || a.type);
    return Object.entries(grouped).map(([name, items]) => ({
      name,
      count: items.length,
      valueTotal: items.reduce((s, a) => s + (a.priceAsking || 0), 0),
      areaTotal: items.reduce((s, a) => s + (a.areaHa || 0), 0),
    }));
  }, [assets]);

  const assetsByState = useMemo(() => {
    const grouped = groupBy(assets as any[], a => a.estado || "N/I");
    return Object.entries(grouped)
      .map(([name, items]) => ({ name, value: items.length }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [assets]);

  const isMaDeal = (deal: any) => {
    const assetMatch = (assets as any[]).find(a => a.id === deal.assetId);
    if (assetMatch && assetMatch.type === "NEGOCIO") return true;
    if (deal.title && deal.title.toLowerCase().includes("m&a")) return true;
    return false;
  };

  const maDeals = useMemo(() => filteredDeals.filter(isMaDeal), [filteredDeals, assets]);

  const maTotalValue = useMemo(() => maDeals.reduce((s, d: any) => s + (d.amountEstimate || 0), 0), [maDeals]);
  const maAvgTicket = maDeals.length > 0 ? maTotalValue / maDeals.length : 0;
  const maConversionRate = useMemo(() => {
    if (!lastStageId || maDeals.length === 0) return 0;
    const converted = maDeals.filter((d: any) => d.stageId === lastStageId).length;
    return (converted / maDeals.length) * 100;
  }, [maDeals, lastStageId]);

  const maMonthlyData = useMemo(() => buildMonthlyValueData(maDeals as any[], "createdAt", "amountEstimate", 6), [maDeals]);

  const maDealsByStage = useMemo(() => {
    const stagesMap = Object.fromEntries((stages as any[]).map((s: any) => [s.id, s.name]));
    const grouped = groupBy(maDeals as any[], d => stagesMap[d.stageId] || "Sem Estágio");
    return Object.entries(grouped).map(([name, items]) => ({
      name,
      count: items.length,
      value: items.reduce((s, d: any) => s + (d.amountEstimate || 0), 0),
    }));
  }, [maDeals, stages]);

  const realEstateDeals = useMemo(() => {
    const reAssetIds = new Set((assets as any[]).filter(a => a.type === "TERRA" || a.type === "FII_CRI" || a.type === "DESENVOLVIMENTO").map(a => a.id));
    return filteredDeals.filter((d: any) => d.assetId && reAssetIds.has(d.assetId));
  }, [filteredDeals, assets]);

  const mineracaoDeals = useMemo(() => {
    const mineAssetIds = new Set((assets as any[]).filter(a => a.type === "MINA").map(a => a.id));
    return filteredDeals.filter((d: any) => d.assetId && mineAssetIds.has(d.assetId));
  }, [filteredDeals, assets]);

  const tooltipStyle = {
    backgroundColor: "hsl(var(--card))",
    borderColor: "hsl(var(--border))",
    borderRadius: "8px",
    fontSize: "12px",
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-display font-bold" data-testid="text-relatorios-title">Relatórios</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Análise e indicadores estratégicos da plataforma</p>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-44" data-testid="select-periodo-relatorio">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="geral" className="text-xs md:text-sm" data-testid="tab-geral">
            <BarChart2 className="w-3.5 h-3.5 mr-1.5" /> Geral
          </TabsTrigger>
          <TabsTrigger value="empresas" className="text-xs md:text-sm" data-testid="tab-empresas">
            <Building2 className="w-3.5 h-3.5 mr-1.5" /> Empresas
          </TabsTrigger>
          <TabsTrigger value="deals" className="text-xs md:text-sm" data-testid="tab-deals">
            <Briefcase className="w-3.5 h-3.5 mr-1.5" /> Deals
          </TabsTrigger>
          <TabsTrigger value="ativos" className="text-xs md:text-sm" data-testid="tab-ativos">
            <Layers className="w-3.5 h-3.5 mr-1.5" /> Ativos
          </TabsTrigger>
          <TabsTrigger value="ma" className="text-xs md:text-sm" data-testid="tab-ma">
            <Briefcase className="w-3.5 h-3.5 mr-1.5" /> M&A
          </TabsTrigger>
          <TabsTrigger value="atividades" className="text-xs md:text-sm" data-testid="tab-atividades">
            <History className="w-3.5 h-3.5 mr-1.5" /> Atividades
          </TabsTrigger>
        </TabsList>

        <div className="flex flex-wrap items-center gap-2 mt-4" data-testid="filter-row">
          <Select value={filterPipelineType} onValueChange={setFilterPipelineType}>
            <SelectTrigger className="w-44" data-testid="select-filter-pipeline">
              <SelectValue placeholder="Pipeline" />
            </SelectTrigger>
            <SelectContent>
              {PIPELINE_TYPE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterAssetType} onValueChange={setFilterAssetType}>
            <SelectTrigger className="w-44" data-testid="select-filter-asset-type">
              <SelectValue placeholder="Tipo de ativo" />
            </SelectTrigger>
            <SelectContent>
              {ASSET_TYPE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterUF} onValueChange={setFilterUF}>
            <SelectTrigger className="w-40" data-testid="select-filter-uf">
              <SelectValue placeholder="Estado/UF" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os estados</SelectItem>
              {availableUFs.map(uf => (
                <SelectItem key={uf} value={uf}>{uf}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger className="w-44" data-testid="select-filter-priority">
              <SelectValue placeholder="Prioridade" />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearAllFilters} data-testid="button-clear-filters">
              <X className="w-3.5 h-3.5 mr-1" /> Limpar filtros
            </Button>
          )}
        </div>

        {/* ── GERAL ── */}
        <TabsContent value="geral" className="space-y-5 mt-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <KpiTile
              label="Empresas no período"
              value={filteredCompanies.length}
              sub={`de ${(companies as any[]).length} total`}
              icon={Building2}
            />
            <KpiTile
              label="Deals no período"
              value={filteredDeals.length}
              sub={`Invest: ${investorDeals} | Ativo: ${assetDeals}`}
              icon={Briefcase}
            />
            <KpiTile
              label="Ativos cadastrados"
              value={(assets as any[]).length}
              icon={Layers}
            />
            <KpiTile
              label="Valor estimado pipeline"
              value={totalRevEst >= 1_000_000
                ? `R$ ${(totalRevEst / 1_000_000).toFixed(1)}M`
                : `R$ ${(totalRevEst / 1_000).toFixed(0)}k`}
              sub="soma dos deals no período"
              icon={DollarSign}
            />
            <KpiTile
              label="Taxa de Conversão"
              value={`${conversionRate.toFixed(1)}%`}
              sub="deals no último estágio"
              icon={Target}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Empresas importadas por mês</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={monthlyCompanies}>
                      <defs>
                        <linearGradient id="cgEmp" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
                      <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, "Empresas"]} />
                      <Area type="monotone" dataKey="value" stroke="hsl(var(--chart-1))" strokeWidth={2} fill="url(#cgEmp)" dot={{ r: 3, fill: "hsl(var(--chart-1))" }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Deals criados por mês</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyDeals}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
                      <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, "Deals"]} />
                      <Bar dataKey="value" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── EMPRESAS ── */}
        <TabsContent value="empresas" className="space-y-5 mt-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <KpiTile label="Total de empresas" value={(companies as any[]).length} icon={Building2} />
            <KpiTile label="No período selecionado" value={filteredCompanies.length} icon={Calendar} />
            <KpiTile
              label="Com e-mail"
              value={(filteredCompanies as any[]).filter((c: any) => (c.emails as any[])?.length > 0).length}
              sub="com contato direto"
              icon={Magnet}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-muted-foreground" /> Empresas por Estado (UF)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={companiesByUF} layout="vertical" margin={{ left: 0, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                      <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                      <YAxis type="category" dataKey="name" fontSize={11} tickLine={false} axisLine={false} width={30} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, "Empresas"]} />
                      <Bar dataKey="value" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Empresas por Porte</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={companiesByPorte}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label={({ name, percent }: any) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        labelLine={false}
                        fontSize={11}
                      >
                        {companiesByPorte.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, "Empresas"]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Top CNAEs Captados</CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const cnaeGroups = groupBy(filteredCompanies as any[], co => co.cnaePrincipal || "Não informado");
                const sorted = Object.entries(cnaeGroups)
                  .map(([cnae, items]) => ({ cnae, count: items.length }))
                  .sort((a, b) => b.count - a.count)
                  .slice(0, 10);
                return (
                  <div className="space-y-2">
                    {sorted.map(({ cnae, count }) => (
                      <div key={cnae} className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{cnae}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full"
                              style={{ width: `${(count / sorted[0].count) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-6 text-right">{count}</span>
                        </div>
                      </div>
                    ))}
                    {sorted.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-4">Sem dados de CNAE.</p>
                    )}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── DEALS ── */}
        <TabsContent value="deals" className="space-y-5 mt-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiTile label="Total de deals" value={filteredDeals.length} icon={Briefcase} />
            <KpiTile label="Pipeline Investidor" value={investorDeals} icon={TrendingUp} />
            <KpiTile label="Pipeline Ativo" value={assetDeals} icon={Layers} />
            <KpiTile
              label="Valor médio estimado"
              value={filteredDeals.length > 0
                ? `R$ ${(totalRevEst / filteredDeals.length / 1000).toFixed(0)}k`
                : "—"}
              icon={DollarSign}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Deals por Estágio</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dealsByStage}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" tick={{ width: 80 }} />
                      <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, "Deals"]} />
                      <Bar dataKey="count" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Distribuição por Pipeline</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: "Investidor", value: investorDeals },
                          { name: "Ativo/Captação", value: assetDeals },
                        ]}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                        fontSize={12}
                      >
                        <Cell fill="hsl(var(--chart-1))" />
                        <Cell fill="hsl(var(--chart-2))" />
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Deals com maior valor estimado</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {[...(filteredDeals as any[])]
                  .filter(d => d.amountEstimate)
                  .sort((a, b) => (b.amountEstimate || 0) - (a.amountEstimate || 0))
                  .slice(0, 8)
                  .map((deal: any) => (
                    <div key={deal.id} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-muted/40" data-testid={`row-deal-${deal.id}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{deal.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {deal.pipelineType === "INVESTOR" ? "Investidor" : "Ativo"}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-emerald-600 shrink-0">
                        R$ {Number(deal.amountEstimate).toLocaleString("pt-BR")}
                      </span>
                    </div>
                  ))}
                {(filteredDeals as any[]).filter(d => d.amountEstimate).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    Nenhum deal com valor estimado no período.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── ATIVOS ── */}
        <TabsContent value="ativos" className="space-y-5 mt-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiTile
              label="Total de ativos"
              value={(assets as any[]).length}
              icon={Layers}
            />
            <KpiTile
              label="Área total cadastrada"
              value={`${(assets as any[]).reduce((s, a) => s + (a.areaHa || 0), 0).toLocaleString("pt-BR")} ha`}
              icon={MapPin}
            />
            <KpiTile
              label="Valor total portfólio"
              value={(() => {
                const total = (assets as any[]).reduce((s, a) => s + (a.priceAsking || 0), 0);
                return total >= 1_000_000 ? `R$ ${(total / 1_000_000).toFixed(1)}M` : `R$ ${(total / 1_000).toFixed(0)}k`;
              })()}
              icon={DollarSign}
            />
            <KpiTile
              label="Com documentação completa"
              value={(assets as any[]).filter(a => a.docsStatus === "completo").length}
              sub={`de ${(assets as any[]).length} ativos`}
              icon={Briefcase}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Ativos por Tipo</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={assetsByType}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
                      <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, "Ativos"]} />
                      <Bar dataKey="count" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Ativos por Estado (UF)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={assetsByState} layout="vertical" margin={{ left: 0, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                      <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                      <YAxis type="category" dataKey="name" fontSize={11} tickLine={false} axisLine={false} width={30} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, "Ativos"]} />
                      <Bar dataKey="value" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Ranking por valor pedido</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {[...(assets as any[])]
                  .filter(a => a.priceAsking)
                  .sort((a, b) => (b.priceAsking || 0) - (a.priceAsking || 0))
                  .slice(0, 8)
                  .map((asset: any, i) => (
                    <div key={asset.id} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-muted/40" data-testid={`row-asset-${asset.id}`}>
                      <span className="text-xs font-bold text-muted-foreground w-5 shrink-0">#{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{asset.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {TIPO_LABEL[asset.type] || asset.type}
                          {asset.estado ? ` — ${asset.estado}` : ""}
                          {asset.areaHa ? ` — ${Number(asset.areaHa).toLocaleString("pt-BR")} ha` : ""}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-emerald-600 shrink-0">
                        {asset.priceAsking >= 1_000_000
                          ? `R$ ${(asset.priceAsking / 1_000_000).toFixed(1)}M`
                          : `R$ ${(asset.priceAsking / 1_000).toFixed(0)}k`}
                      </span>
                    </div>
                  ))}
                {(assets as any[]).filter(a => a.priceAsking).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    Nenhum ativo com preço cadastrado.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── M&A ── */}
        <TabsContent value="ma" className="space-y-5 mt-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiTile
              label="Total deals M&A"
              value={maDeals.length}
              sub={`de ${filteredDeals.length} deals totais`}
              icon={Briefcase}
            />
            <KpiTile
              label="Valor pipeline M&A"
              value={maTotalValue >= 1_000_000
                ? `R$ ${(maTotalValue / 1_000_000).toFixed(1)}M`
                : `R$ ${(maTotalValue / 1_000).toFixed(0)}k`}
              icon={DollarSign}
            />
            <KpiTile
              label="Ticket médio M&A"
              value={maAvgTicket >= 1_000_000
                ? `R$ ${(maAvgTicket / 1_000_000).toFixed(1)}M`
                : maAvgTicket > 0
                  ? `R$ ${(maAvgTicket / 1_000).toFixed(0)}k`
                  : "—"}
              icon={TrendingUp}
            />
            <KpiTile
              label="Conversão M&A"
              value={`${maConversionRate.toFixed(1)}%`}
              sub="deals no último estágio"
              icon={Target}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Evolução mensal — Deals M&A</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={maMonthlyData}>
                      <defs>
                        <linearGradient id="cgMA" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--chart-3))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--chart-3))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
                      <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: string) => {
                        if (name === "count") return [v, "Deals"];
                        return [v, "Deals"];
                      }} />
                      <Area type="monotone" dataKey="count" stroke="hsl(var(--chart-3))" strokeWidth={2} fill="url(#cgMA)" dot={{ r: 3, fill: "hsl(var(--chart-3))" }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Deals M&A por Estágio</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={maDealsByStage} layout="vertical" margin={{ left: 0, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                      <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                      <YAxis type="category" dataKey="name" fontSize={11} tickLine={false} axisLine={false} width={80} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, "Deals"]} />
                      <Bar dataKey="count" fill="hsl(var(--chart-4))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Top 8 Deals M&A por valor estimado</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {[...(maDeals as any[])]
                  .filter(d => d.amountEstimate)
                  .sort((a, b) => (b.amountEstimate || 0) - (a.amountEstimate || 0))
                  .slice(0, 8)
                  .map((deal: any, i) => (
                    <div key={deal.id} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-muted/40" data-testid={`row-ma-deal-${deal.id}`}>
                      <span className="text-xs font-bold text-muted-foreground w-5 shrink-0">#{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{deal.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {deal.pipelineType === "INVESTOR" ? "Investidor" : "Ativo"}
                          {deal.priority ? ` — Prioridade: ${deal.priority}` : ""}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-emerald-600 shrink-0">
                        R$ {Number(deal.amountEstimate).toLocaleString("pt-BR")}
                      </span>
                    </div>
                  ))}
                {maDeals.filter((d: any) => d.amountEstimate).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    Nenhum deal M&A com valor estimado no período.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Comparativo por Segmento</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-muted/30 space-y-1">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">M&A / Negócios</p>
                  <p className="text-2xl font-bold">{maDeals.length}</p>
                  <p className="text-xs text-muted-foreground">
                    {maTotalValue >= 1_000_000
                      ? `R$ ${(maTotalValue / 1_000_000).toFixed(1)}M pipeline`
                      : `R$ ${(maTotalValue / 1_000).toFixed(0)}k pipeline`}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-muted/30 space-y-1">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Real Estate</p>
                  <p className="text-2xl font-bold">{realEstateDeals.length}</p>
                  <p className="text-xs text-muted-foreground">
                    {(() => {
                      const v = realEstateDeals.reduce((s, d: any) => s + (d.amountEstimate || 0), 0);
                      return v >= 1_000_000 ? `R$ ${(v / 1_000_000).toFixed(1)}M pipeline` : `R$ ${(v / 1_000).toFixed(0)}k pipeline`;
                    })()}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-muted/30 space-y-1">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Mineração</p>
                  <p className="text-2xl font-bold">{mineracaoDeals.length}</p>
                  <p className="text-xs text-muted-foreground">
                    {(() => {
                      const v = mineracaoDeals.reduce((s, d: any) => s + (d.amountEstimate || 0), 0);
                      return v >= 1_000_000 ? `R$ ${(v / 1_000_000).toFixed(1)}M pipeline` : `R$ ${(v / 1_000).toFixed(0)}k pipeline`;
                    })()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="atividades" className="space-y-5 mt-5">
          <ActivityFeed />
        </TabsContent>
      </Tabs>
    </div>
  );
}
