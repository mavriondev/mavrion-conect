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
  Banknote, Globe, Star, CheckCircle2, Clock,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, subDays, isAfter, parseISO } from "date-fns";
import { useI18n, getDateLocale } from "@/lib/i18n";

const CHART_COLORS = [
  "hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))",
  "hsl(var(--chart-4))", "hsl(var(--chart-5))",
];

function useTipoLabel(): Record<string, string> {
  const { lang } = useI18n();
  return lang === "en"
    ? { TERRA: "Land/Farms", MINA: "Mining", NEGOCIO: "Business/M&A", FII_CRI: "FII/CRI", DESENVOLVIMENTO: "Development", AGRO: "Agribusiness" }
    : { TERRA: "Terras/Fazendas", MINA: "Mineração", NEGOCIO: "Negócio/M&A", FII_CRI: "FII/CRI", DESENVOLVIMENTO: "Desenvolvimento", AGRO: "Agronegócio" };
}

function usePeriodOptions() {
  const { t } = useI18n();
  return [
    { value: "7",   label: t("reports.period7") },
    { value: "30",  label: t("reports.period30") },
    { value: "90",  label: t("reports.period90") },
    { value: "365", label: t("reports.period365") },
    { value: "all", label: t("reports.periodAll") },
  ];
}

function usePipelineTypeOptions() {
  const { t } = useI18n();
  return [
    { value: "all", label: t("reports.allPipelines") },
    { value: "INVESTOR", label: t("reports.investorPipeline") },
    { value: "ASSET", label: t("reports.assetPipeline") },
  ];
}

function useAssetTypeOptions() {
  const { t } = useI18n();
  return [
    { value: "all", label: t("reports.allTypes") },
    { value: "TERRA", label: t("reports.landsFarms") },
    { value: "MINA", label: t("reports.miningType") },
    { value: "NEGOCIO", label: t("reports.businessMA") },
    { value: "FII_CRI", label: t("reports.fiiCri") },
    { value: "DESENVOLVIMENTO", label: t("reports.development") },
    { value: "AGRO", label: t("reports.agribusiness") },
  ];
}

function usePriorityOptions() {
  const { t } = useI18n();
  return [
    { value: "all", label: t("reports.allPriorities") },
    { value: "high", label: t("reports.highPriority") },
    { value: "medium", label: t("reports.mediumPriority") },
    { value: "low", label: t("reports.lowPriority") },
  ];
}

function useFeeStatusOptions() {
  const { t } = useI18n();
  return [
    { value: "all", label: t("reports.allFeeStatus") },
    { value: "a_receber", label: t("reports.feeToReceive") },
    { value: "recebido", label: t("reports.feeReceived") },
    { value: "pendente", label: t("reports.feePending") },
  ];
}

function useSourceOptions() {
  const { t } = useI18n();
  return [
    { value: "all", label: t("reports.allSources") },
    { value: "manual", label: t("reports.sourceManual") },
    { value: "portal", label: t("reports.sourcePortal") },
    { value: "connector", label: t("reports.sourceConnector") },
    { value: "import", label: t("reports.sourceImport") },
  ];
}

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

function buildMonthlyData(items: any[], field = "createdAt", months = 6, locale?: any) {
  const data: { name: string; value: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = format(d, "MMM/yy", { locale });
    const count = items.filter(it => it[field]?.startsWith(key)).length;
    data.push({ name: label, value: count });
  }
  return data;
}

function buildMonthlyValueData(items: any[], field = "createdAt", valueField = "amountEstimate", months = 6, locale?: any) {
  const data: { name: string; value: number; count: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = format(d, "MMM/yy", { locale });
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

function useActivityConfig() {
  const { t } = useI18n();
  return {
    actions: {
      created: { label: t("reports.actionCreated"), icon: CirclePlus, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
      updated: { label: t("reports.actionUpdated"), icon: PenLine, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-900/20" },
      deleted: { label: t("reports.actionDeleted"), icon: CircleMinus, color: "text-red-600", bg: "bg-red-50 dark:bg-red-900/20" },
      stage_changed: { label: t("reports.actionStageChanged"), icon: Shuffle, color: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-900/20" },
      status_changed: { label: t("reports.actionStatusChanged"), icon: Shuffle, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-900/20" },
    } as Record<string, { label: string; icon: typeof CirclePlus; color: string; bg: string }>,
    entities: {
      deal: t("reports.entityDeal"), lead: t("reports.entityLead"), company: t("reports.entityCompany"), asset: t("reports.entityAsset"), connector: t("reports.entityConnector"),
    } as Record<string, string>,
  };
}

function ActivityFeed() {
  const { t, lang } = useI18n();
  const locale = getDateLocale(lang);
  const { actions: ACTIVITY_ACTION_CONFIG, entities: ENTITY_LABEL } = useActivityConfig();
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
            <History className="w-4 h-4" /> {t("reports.activityHistory")}
          </CardTitle>
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-activity-entity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common.allEntities")}</SelectItem>
              <SelectItem value="deal">{t("common.deals")}</SelectItem>
              <SelectItem value="lead">{t("common.leads")}</SelectItem>
              <SelectItem value="company">{t("common.companies")}</SelectItem>
              <SelectItem value="asset">{t("common.assets")}</SelectItem>
              <SelectItem value="connector">{t("common.connectors")}</SelectItem>
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
            <p className="text-sm">{t("reports.noActivityRecorded")}</p>
            <p className="text-xs mt-1">{t("reports.actionsWillAppear")}</p>
          </div>
        ) : (
          <div className="space-y-6" data-testid="activity-feed">
            {grouped.map(([day, dayLogs]) => (
              <div key={day}>
                <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
                  {format(new Date(day + "T12:00:00"), lang === "en" ? "EEEE, MMMM dd" : "EEEE, dd 'de' MMMM", { locale })}
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
                                <p className="text-[10px] text-muted-foreground/60">+{changeKeys.length - 3} {t("common.moreChanges")}</p>
                              )}
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0 mt-1">
                          {format(new Date(log.createdAt), "HH:mm", { locale })}
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

function FunilConversao({ deals, assets, companies }: {
  deals: any[]; assets: any[]; companies: any[];
}) {
  const { t } = useI18n();
  const etapas = [
    {
      label: t("reports.prospectedCompanies"),
      valor: companies?.length || 0,
      cor: "#6366f1",
      desc: t("reports.totalCRMCompanies")
    },
    {
      label: t("reports.qualifiedLeads"),
      valor: (companies || []).filter((c: any) => c.lead?.status === "qualified").length,
      cor: "#8b5cf6",
      desc: t("reports.qualifiedStatusCompanies")
    },
    {
      label: t("reports.portfolioAssets"),
      valor: assets?.length || 0,
      cor: "#a78bfa",
      desc: t("reports.registeredAssets")
    },
    {
      label: t("reports.generatedMatches"),
      valor: (deals || []).length,
      cor: "#f59e0b",
      desc: t("reports.openPipelineDeals")
    },
    {
      label: t("reports.inDueDiligence"),
      valor: (deals || []).filter((d: any) =>
        d.stage?.name?.toLowerCase().includes("diligence") ||
        d.stage?.name?.toLowerCase().includes("nda")
      ).length,
      cor: "#f97316",
      desc: t("reports.ddDeals")
    },
    {
      label: t("reports.finalNegotiation"),
      valor: (deals || []).filter((d: any) =>
        d.stage?.name?.toLowerCase().includes("negociação") ||
        d.stage?.name?.toLowerCase().includes("loi")
      ).length,
      cor: "#ef4444",
      desc: t("reports.loiDeals")
    },
    {
      label: t("reports.closings"),
      valor: (deals || []).filter((d: any) =>
        d.stage?.name?.toLowerCase().includes("fechamento") ||
        d.stage?.name?.toLowerCase().includes("fechado")
      ).length,
      cor: "#10b981",
      desc: t("reports.closedDeals")
    },
  ];

  const ticketMedio = (() => {
    const comValor = (deals || []).filter((d: any) => d.amountEstimate > 0);
    if (comValor.length === 0) return 0;
    return comValor.reduce((s: number, d: any) => s + d.amountEstimate, 0) / comValor.length;
  })();

  const feesTotal = (deals || []).reduce((s: number, d: any) => s + (d.feeValue || 0), 0);
  const feesRecebidos = (deals || [])
    .filter((d: any) => d.feeStatus === "recebido")
    .reduce((s: number, d: any) => s + (d.feeValue || 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">{t("reports.avgTicket")}</p>
            <p className="text-xl font-bold mt-1" data-testid="kpi-ticket-medio">
              {ticketMedio >= 1_000_000
                ? `R$ ${(ticketMedio / 1_000_000).toFixed(1)}M`
                : `R$ ${(ticketMedio / 1_000).toFixed(0)}k`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">{t("reports.totalFees")}</p>
            <p className="text-xl font-bold mt-1 text-amber-600" data-testid="kpi-fees-totais">
              R$ {(feesTotal / 1_000).toFixed(0)}k
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">{t("reports.receivedFees")}</p>
            <p className="text-xl font-bold mt-1 text-green-600" data-testid="kpi-fees-recebidos">
              R$ {(feesRecebidos / 1_000).toFixed(0)}k
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">{t("reports.closingRate")}</p>
            <p className="text-xl font-bold mt-1" data-testid="kpi-taxa-fechamento">
              {deals?.length > 0
                ? `${Math.round((etapas[6].valor / deals.length) * 100)}%`
                : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">{t("reports.funnelTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {etapas.map((etapa, i) => {
            const maxValor = etapas[0].valor || 1;
            const pct = Math.round((etapa.valor / maxValor) * 100);
            const taxa = i > 0 && etapas[i - 1].valor > 0
              ? Math.round((etapa.valor / etapas[i - 1].valor) * 100)
              : null;
            return (
              <div key={etapa.label} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{etapa.label}</span>
                  <div className="flex items-center gap-3">
                    {taxa !== null && (
                      <span className="text-muted-foreground">
                        {taxa}% {t("reports.previousStage")}
                      </span>
                    )}
                    <span className="font-bold" style={{ color: etapa.cor }}>
                      {etapa.valor}
                    </span>
                  </div>
                </div>
                <div className="h-7 bg-muted rounded-lg overflow-hidden relative">
                  <div
                    className="h-full rounded-lg transition-all flex items-center pl-3"
                    style={{ width: `${Math.max(pct, 3)}%`, backgroundColor: etapa.cor }}
                  >
                    {pct > 15 && (
                      <span className="text-white text-[10px] font-bold">{etapa.valor}</span>
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">{etapa.desc}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

export default function RelatoriosPage() {
  const { t, lang } = useI18n();
  const locale = getDateLocale(lang);
  const TIPO_LABEL = useTipoLabel();
  const PERIOD_OPTIONS = usePeriodOptions();
  const PIPELINE_TYPE_OPTIONS = usePipelineTypeOptions();
  const ASSET_TYPE_OPTIONS = useAssetTypeOptions();
  const PRIORITY_OPTIONS = usePriorityOptions();
  const FEE_STATUS_OPTIONS = useFeeStatusOptions();
  const SOURCE_OPTIONS = useSourceOptions();

  const [period, setPeriod] = useState("30");
  const [activeTab, setActiveTab] = useState("geral");
  const [filterPipelineType, setFilterPipelineType] = useState("all");
  const [filterAssetType, setFilterAssetType] = useState("all");
  const [filterUF, setFilterUF] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterFeeStatus, setFilterFeeStatus] = useState("all");
  const [filterSource, setFilterSource] = useState("all");

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
    if (filterFeeStatus !== "all") {
      result = result.filter(d => d.feeStatus === filterFeeStatus);
    }
    if (filterSource !== "all") {
      result = result.filter(d => (d.source || "manual") === filterSource);
    }
    return result;
  }, [deals, period, filterPipelineType, filterAssetType, filterPriority, filterUF, filterFeeStatus, filterSource, assets]);

  const hasActiveFilters = filterPipelineType !== "all" || filterAssetType !== "all" || filterUF !== "all" || filterPriority !== "all" || filterFeeStatus !== "all" || filterSource !== "all" || period !== "30";

  const clearAllFilters = () => {
    setPeriod("30");
    setFilterPipelineType("all");
    setFilterAssetType("all");
    setFilterUF("all");
    setFilterPriority("all");
    setFilterFeeStatus("all");
    setFilterSource("all");
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
    const grouped = groupBy(filteredDeals as any[], d => stagesMap[d.stageId] || t("reports.noStage"));
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
    const grouped = groupBy(filteredCompanies as any[], co => co.porte || (lang === "en" ? "Not specified" : "Não informado"));
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
    const grouped = groupBy(maDeals as any[], d => stagesMap[d.stageId] || t("reports.noStage"));
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
          <h1 className="text-xl md:text-2xl font-display font-bold" data-testid="text-relatorios-title">{t("reports.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("reports.subtitle")}</p>
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
            <BarChart2 className="w-3.5 h-3.5 mr-1.5" /> {t("reports.tabGeneral")}
          </TabsTrigger>
          <TabsTrigger value="empresas" className="text-xs md:text-sm" data-testid="tab-empresas">
            <Building2 className="w-3.5 h-3.5 mr-1.5" /> {t("reports.tabCompanies")}
          </TabsTrigger>
          <TabsTrigger value="deals" className="text-xs md:text-sm" data-testid="tab-deals">
            <Briefcase className="w-3.5 h-3.5 mr-1.5" /> {t("reports.tabDeals")}
          </TabsTrigger>
          <TabsTrigger value="ativos" className="text-xs md:text-sm" data-testid="tab-ativos">
            <Layers className="w-3.5 h-3.5 mr-1.5" /> {t("reports.tabAssets")}
          </TabsTrigger>
          <TabsTrigger value="ma" className="text-xs md:text-sm" data-testid="tab-ma">
            <Briefcase className="w-3.5 h-3.5 mr-1.5" /> {t("reports.tabMA")}
          </TabsTrigger>
          <TabsTrigger value="funil" className="text-xs md:text-sm" data-testid="tab-funil">
            {t("reports.tabFunnel")}
          </TabsTrigger>
          <TabsTrigger value="honorarios" className="text-xs md:text-sm" data-testid="tab-honorarios">
            <Banknote className="w-3.5 h-3.5 mr-1.5" /> {t("reports.tabFees")}
          </TabsTrigger>
          <TabsTrigger value="geografico" className="text-xs md:text-sm" data-testid="tab-geografico">
            <Globe className="w-3.5 h-3.5 mr-1.5" /> {t("reports.tabGeo")}
          </TabsTrigger>
          <TabsTrigger value="leads" className="text-xs md:text-sm" data-testid="tab-leads">
            <Users className="w-3.5 h-3.5 mr-1.5" /> {t("reports.tabLeads")}
          </TabsTrigger>
          <TabsTrigger value="atividades" className="text-xs md:text-sm" data-testid="tab-atividades">
            <History className="w-3.5 h-3.5 mr-1.5" /> {t("reports.tabActivities")}
          </TabsTrigger>
        </TabsList>

        <div className="flex flex-wrap items-center gap-2 mt-4" data-testid="filter-row">
          <Select value={filterPipelineType} onValueChange={setFilterPipelineType}>
            <SelectTrigger className="w-44" data-testid="select-filter-pipeline">
              <SelectValue placeholder={lang === "en" ? "Pipeline" : "Pipeline"} />
            </SelectTrigger>
            <SelectContent>
              {PIPELINE_TYPE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterAssetType} onValueChange={setFilterAssetType}>
            <SelectTrigger className="w-44" data-testid="select-filter-asset-type">
              <SelectValue placeholder={lang === "en" ? "Asset type" : "Tipo de ativo"} />
            </SelectTrigger>
            <SelectContent>
              {ASSET_TYPE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterUF} onValueChange={setFilterUF}>
            <SelectTrigger className="w-40" data-testid="select-filter-uf">
              <SelectValue placeholder={lang === "en" ? "State" : "Estado/UF"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{lang === "en" ? "All states" : "Todos os estados"}</SelectItem>
              {availableUFs.map(uf => (
                <SelectItem key={uf} value={uf}>{uf}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger className="w-44" data-testid="select-filter-priority">
              <SelectValue placeholder={lang === "en" ? "Priority" : "Prioridade"} />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterFeeStatus} onValueChange={setFilterFeeStatus}>
            <SelectTrigger className="w-44" data-testid="select-filter-fee-status">
              <SelectValue placeholder={lang === "en" ? "Fee status" : "Status fee"} />
            </SelectTrigger>
            <SelectContent>
              {FEE_STATUS_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterSource} onValueChange={setFilterSource}>
            <SelectTrigger className="w-40" data-testid="select-filter-source">
              <SelectValue placeholder={lang === "en" ? "Source" : "Origem"} />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearAllFilters} data-testid="button-clear-filters">
              <X className="w-3.5 h-3.5 mr-1" /> {t("common.clearFilters")}
            </Button>
          )}
        </div>

        {/* ── GERAL ── */}
        <TabsContent value="geral" className="space-y-5 mt-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <KpiTile
              label={t("reports.companiesInPeriod")}
              value={filteredCompanies.length}
              sub={`${(companies as any[]).length} ${t("reports.ofTotal2")}`}
              icon={Building2}
            />
            <KpiTile
              label={t("reports.dealsInPeriod")}
              value={filteredDeals.length}
              sub={`${t("reports.investLabel")}: ${investorDeals} | ${t("reports.assetLabel")}: ${assetDeals}`}
              icon={Briefcase}
            />
            <KpiTile
              label={t("reports.registeredAssetsKpi")}
              value={(assets as any[]).length}
              icon={Layers}
            />
            <KpiTile
              label={t("reports.estimatedPipelineValue")}
              value={totalRevEst >= 1_000_000
                ? `R$ ${(totalRevEst / 1_000_000).toFixed(1)}M`
                : `R$ ${(totalRevEst / 1_000).toFixed(0)}k`}
              sub={t("reports.dealsSum")}
              icon={DollarSign}
            />
            <KpiTile
              label={t("reports.conversionRate")}
              value={`${conversionRate.toFixed(1)}%`}
              sub={t("reports.dealsInLastStage")}
              icon={Target}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">{t("reports.companiesImportedMonth")}</CardTitle>
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
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, t("reports.tabCompanies")]} />
                      <Area type="monotone" dataKey="value" stroke="hsl(var(--chart-1))" strokeWidth={2} fill="url(#cgEmp)" dot={{ r: 3, fill: "hsl(var(--chart-1))" }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">{t("reports.dealsCreatedMonth")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyDeals}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
                      <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, t("reports.tabDeals")]} />
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
            <KpiTile label={t("reports.totalCompanies")} value={(companies as any[]).length} icon={Building2} />
            <KpiTile label={t("reports.inSelectedPeriod")} value={filteredCompanies.length} icon={Calendar} />
            <KpiTile
              label={t("reports.withEmail")}
              value={(filteredCompanies as any[]).filter((c: any) => (c.emails as any[])?.length > 0).length}
              sub={t("reports.withDirectContact")}
              icon={Magnet}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-muted-foreground" /> {t("reports.companiesByState")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={companiesByUF} layout="vertical" margin={{ left: 0, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                      <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                      <YAxis type="category" dataKey="name" fontSize={11} tickLine={false} axisLine={false} width={30} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, t("reports.tabCompanies")]} />
                      <Bar dataKey="value" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">{t("reports.companiesBySize")}</CardTitle>
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
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, t("reports.tabCompanies")]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">{t("reports.topCnaes")}</CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const cnaeGroups = groupBy(filteredCompanies as any[], co => co.cnaePrincipal || (lang === "en" ? "Not specified" : "Não informado"));
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
                      <p className="text-xs text-muted-foreground text-center py-4">{t("reports.noCnaeData")}</p>
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
            <KpiTile label={t("reports.totalDeals")} value={filteredDeals.length} icon={Briefcase} />
            <KpiTile label={t("reports.investorPipelineKpi")} value={investorDeals} icon={TrendingUp} />
            <KpiTile label={t("reports.assetPipelineKpi")} value={assetDeals} icon={Layers} />
            <KpiTile
              label={t("reports.avgEstimatedValue")}
              value={filteredDeals.length > 0
                ? `R$ ${(totalRevEst / filteredDeals.length / 1000).toFixed(0)}k`
                : "—"}
              icon={DollarSign}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">{t("reports.dealsByStageKpi")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dealsByStage}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" tick={{ width: 80 }} />
                      <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, t("reports.tabDeals")]} />
                      <Bar dataKey="count" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">{t("reports.pipelineDistribution")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: lang === "en" ? "Investor" : "Investidor", value: investorDeals },
                          { name: lang === "en" ? "Asset/Capture" : "Ativo/Captação", value: assetDeals },
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
              <CardTitle className="text-sm font-semibold">{t("reports.highestValueDealsKpi")}</CardTitle>
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
                          {deal.pipelineType === "INVESTOR" ? (lang === "en" ? "Investor" : "Investidor") : (lang === "en" ? "Asset" : "Ativo")}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-emerald-600 shrink-0">
                        R$ {Number(deal.amountEstimate).toLocaleString("pt-BR")}
                      </span>
                    </div>
                  ))}
                {(filteredDeals as any[]).filter(d => d.amountEstimate).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    {t("reports.noDealsWithValuePeriod")}
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
              label={t("reports.totalAssetsKpi")}
              value={(assets as any[]).length}
              icon={Layers}
            />
            <KpiTile
              label={t("reports.totalRegisteredAreaKpi")}
              value={`${(assets as any[]).reduce((s, a) => s + (a.areaHa || 0), 0).toLocaleString("pt-BR")} ha`}
              icon={MapPin}
            />
            <KpiTile
              label={t("reports.totalPortfolioValueKpi")}
              value={(() => {
                const total = (assets as any[]).reduce((s, a) => s + (a.priceAsking || 0), 0);
                return total >= 1_000_000 ? `R$ ${(total / 1_000_000).toFixed(1)}M` : `R$ ${(total / 1_000).toFixed(0)}k`;
              })()}
              icon={DollarSign}
            />
            <KpiTile
              label={t("reports.withCompleteDoc")}
              value={(assets as any[]).filter(a => a.docsStatus === "completo").length}
              sub={`${(assets as any[]).length} ${t("reports.tabAssets").toLowerCase()}`}
              icon={Briefcase}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">{t("reports.assetsByTypeKpi")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={assetsByType}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
                      <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, t("reports.tabAssets")]} />
                      <Bar dataKey="count" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">{t("reports.assetsByStateKpi")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={assetsByState} layout="vertical" margin={{ left: 0, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                      <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                      <YAxis type="category" dataKey="name" fontSize={11} tickLine={false} axisLine={false} width={30} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, t("reports.tabAssets")]} />
                      <Bar dataKey="value" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">{t("reports.rankingByPriceKpi")}</CardTitle>
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
                    {t("reports.noAssetWithPriceKpi")}
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
              label={t("reports.totalMADealsKpi")}
              value={maDeals.length}
              sub={`${filteredDeals.length} ${t("reports.tabDeals").toLowerCase()} ${t("reports.ofTotal2")}`}
              icon={Briefcase}
            />
            <KpiTile
              label={t("reports.maPipelineValueKpi")}
              value={maTotalValue >= 1_000_000
                ? `R$ ${(maTotalValue / 1_000_000).toFixed(1)}M`
                : `R$ ${(maTotalValue / 1_000).toFixed(0)}k`}
              icon={DollarSign}
            />
            <KpiTile
              label={t("reports.maAvgTicketKpi")}
              value={maAvgTicket >= 1_000_000
                ? `R$ ${(maAvgTicket / 1_000_000).toFixed(1)}M`
                : maAvgTicket > 0
                  ? `R$ ${(maAvgTicket / 1_000).toFixed(0)}k`
                  : "—"}
              icon={TrendingUp}
            />
            <KpiTile
              label={t("reports.maConversionKpi")}
              value={`${maConversionRate.toFixed(1)}%`}
              sub={t("reports.dealsInLastStage")}
              icon={Target}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">{t("reports.monthlyMAEvolutionKpi")}</CardTitle>
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
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, t("reports.tabDeals")]} />
                      <Area type="monotone" dataKey="count" stroke="hsl(var(--chart-3))" strokeWidth={2} fill="url(#cgMA)" dot={{ r: 3, fill: "hsl(var(--chart-3))" }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">{t("reports.maByStageKpi")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={maDealsByStage} layout="vertical" margin={{ left: 0, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                      <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                      <YAxis type="category" dataKey="name" fontSize={11} tickLine={false} axisLine={false} width={80} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, t("reports.tabDeals")]} />
                      <Bar dataKey="count" fill="hsl(var(--chart-4))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">{t("reports.top8MADealsKpi")}</CardTitle>
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
                          {deal.pipelineType === "INVESTOR" ? (lang === "en" ? "Investor" : "Investidor") : (lang === "en" ? "Asset" : "Ativo")}
                          {deal.priority ? ` — ${lang === "en" ? "Priority" : "Prioridade"}: ${deal.priority}` : ""}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-emerald-600 shrink-0">
                        R$ {Number(deal.amountEstimate).toLocaleString("pt-BR")}
                      </span>
                    </div>
                  ))}
                {maDeals.filter((d: any) => d.amountEstimate).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    {t("reports.noMADealsValuePeriod")}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">{t("reports.segmentComparisonKpi")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-muted/30 space-y-1">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{t("reports.maBusinessesKpi")}</p>
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
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{lang === "en" ? "Mining" : "Mineração"}</p>
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

        <TabsContent value="funil" className="mt-4 space-y-4">
          <FunilConversao deals={deals as any[]} assets={assets as any[]} companies={companies as any[]} />
        </TabsContent>

        {/* ── HONORÁRIOS ── */}
        <TabsContent value="honorarios" className="space-y-5 mt-5">
          {(() => {
            const dealsComFee = (filteredDeals as any[]).filter(d => d.feeValue && d.feeValue > 0);
            const feesTotal = dealsComFee.reduce((s: number, d: any) => s + (d.feeValue || 0), 0);
            const feesRecebidos = dealsComFee
              .filter(d => d.feeStatus === "recebido")
              .reduce((s: number, d: any) => s + (d.feeValue || 0), 0);
            const feesPendentes = feesTotal - feesRecebidos;
            const ticketMedioFee = dealsComFee.length > 0 ? feesTotal / dealsComFee.length : 0;
            const taxaRecebimento = feesTotal > 0 ? (feesRecebidos / feesTotal) * 100 : 0;

            const feesByType = (() => {
              const grouped: Record<string, { count: number; total: number }> = {};
              dealsComFee.forEach(d => {
                const tipo = d.feeType || (lang === "en" ? "Not defined" : "Não definido");
                if (!grouped[tipo]) grouped[tipo] = { count: 0, total: 0 };
                grouped[tipo].count++;
                grouped[tipo].total += d.feeValue || 0;
              });
              return Object.entries(grouped).map(([name, v]) => ({
                name: name === "percentual" ? "Percentual" : name === "fixo" ? "Fixo" : name === "success" ? "Success Fee" : name,
                count: v.count,
                total: v.total,
              }));
            })();

            const feesByMonth = (() => {
              const data: { name: string; recebido: number; pendente: number }[] = [];
              for (let i = 5; i >= 0; i--) {
                const d = new Date();
                d.setMonth(d.getMonth() - i);
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                const label = format(d, "MMM/yy", { locale });
                const matching = dealsComFee.filter(deal => deal.createdAt?.startsWith(key));
                data.push({
                  name: label,
                  recebido: matching.filter(d => d.feeStatus === "recebido").reduce((s: number, d: any) => s + (d.feeValue || 0), 0),
                  pendente: matching.filter(d => d.feeStatus !== "recebido").reduce((s: number, d: any) => s + (d.feeValue || 0), 0),
                });
              }
              return data;
            })();

            const fmtFee = (v: number) => {
              if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
              if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
              return `R$ ${v.toLocaleString("pt-BR")}`;
            };

            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  <KpiTile label={t("reports.totalFees")} value={fmtFee(feesTotal)} icon={Banknote} />
                  <KpiTile label={t("reports.receivedFees")} value={fmtFee(feesRecebidos)} sub={`${taxaRecebimento.toFixed(0)}% ${t("reports.ofTotal2")}`} icon={CheckCircle2} />
                  <KpiTile label={lang === "en" ? "Pending fees" : "Fees pendentes"} value={fmtFee(feesPendentes)} icon={Clock} />
                  <KpiTile label={lang === "en" ? "Avg fee ticket" : "Ticket médio fee"} value={fmtFee(ticketMedioFee)} icon={DollarSign} />
                  <KpiTile label={lang === "en" ? "Deals with fee" : "Deals com fee"} value={dealsComFee.length} sub={`${filteredDeals.length} ${t("reports.tabDeals").toLowerCase()}`} icon={Percent} />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="border-border/50 shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">{t("reports.feeEvolutionKpi")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[240px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={feesByMonth}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                            <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
                            <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: string) => [`R$ ${Number(v).toLocaleString("pt-BR")}`, name === "recebido" ? (lang === "en" ? "Received" : "Recebido") : (lang === "en" ? "Pending" : "Pendente")]} />
                            <Legend formatter={(v) => v === "recebido" ? (lang === "en" ? "Received" : "Recebido") : (lang === "en" ? "Pending" : "Pendente")} />
                            <Bar dataKey="recebido" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} stackId="stack" />
                            <Bar dataKey="pendente" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} stackId="stack" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-border/50 shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">{t("reports.feesByTypeKpi")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[240px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={feesByType}
                              dataKey="total"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={50}
                              outerRadius={80}
                              paddingAngle={3}
                              label={({ name, percent }: any) => `${name} (${(percent * 100).toFixed(0)}%)`}
                              labelLine={false}
                              fontSize={11}
                            >
                              {feesByType.map((_, i) => (
                                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`R$ ${Number(v).toLocaleString("pt-BR")}`, lang === "en" ? "Value" : "Valor"]} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card className="border-border/50 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">{t("reports.topDealsByFeeKpi")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {[...dealsComFee]
                        .sort((a, b) => (b.feeValue || 0) - (a.feeValue || 0))
                        .slice(0, 10)
                        .map((deal: any, i) => (
                          <div key={deal.id} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-muted/40" data-testid={`row-fee-deal-${deal.id}`}>
                            <span className="text-xs font-bold text-muted-foreground w-5 shrink-0">#{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{deal.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {deal.feeType === "percentual" ? `${deal.feePercent}%` : deal.feeType || "—"}
                                {deal.amountEstimate ? ` de ${deal.amountEstimate >= 1_000_000 ? `R$ ${(deal.amountEstimate / 1_000_000).toFixed(1)}M` : `R$ ${(deal.amountEstimate / 1_000).toFixed(0)}k`}` : ""}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge className={cn("text-[10px]",
                                deal.feeStatus === "recebido" ? "bg-green-100 text-green-700 dark:bg-green-900/30" :
                                "bg-amber-100 text-amber-700 dark:bg-amber-900/30"
                              )}>
                                {deal.feeStatus === "recebido" ? (lang === "en" ? "Received" : "Recebido") : (lang === "en" ? "Pending" : "Pendente")}
                              </Badge>
                              <span className="text-sm font-semibold text-emerald-600">
                                R$ {Number(deal.feeValue).toLocaleString("pt-BR")}
                              </span>
                            </div>
                          </div>
                        ))}
                      {dealsComFee.length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-6">
                          {lang === "en" ? "No deals with fee in the selected period." : "Nenhum deal com fee no período selecionado."}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </>
            );
          })()}
        </TabsContent>

        {/* ── GEOGRÁFICO ── */}
        <TabsContent value="geografico" className="space-y-5 mt-5">
          {(() => {
            const assetsList = assets as any[];
            const totalAreaHa = assetsList.reduce((s, a) => s + (a.areaHa || 0), 0);
            const totalValue = assetsList.reduce((s, a) => s + (a.priceAsking || 0), 0);
            const avgPriceHa = totalAreaHa > 0 ? totalValue / totalAreaHa : 0;

            const byState = (() => {
              const grouped: Record<string, { count: number; area: number; value: number }> = {};
              assetsList.forEach(a => {
                const uf = a.estado || "N/I";
                if (!grouped[uf]) grouped[uf] = { count: 0, area: 0, value: 0 };
                grouped[uf].count++;
                grouped[uf].area += a.areaHa || 0;
                grouped[uf].value += a.priceAsking || 0;
              });
              return Object.entries(grouped)
                .map(([name, v]) => ({ name, ...v }))
                .sort((a, b) => b.value - a.value);
            })();

            const byMunicipio = (() => {
              const grouped: Record<string, number> = {};
              assetsList.forEach(a => {
                const mun = a.municipio || "N/I";
                grouped[mun] = (grouped[mun] || 0) + 1;
              });
              return Object.entries(grouped)
                .map(([name, value]) => ({ name, value }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 12);
            })();

            const geoScored = assetsList.filter(a => a.geoScore != null);
            const avgGeoScore = geoScored.length > 0 ? Math.round(geoScored.reduce((s, a) => s + a.geoScore, 0) / geoScored.length) : null;
            const withWater = assetsList.filter(a => a.geoTemRio || a.geoTemLago).length;
            const withEnergy = assetsList.filter(a => a.geoTemEnergia).length;
            const withCAR = assetsList.filter(a => a.carCodImovel).length;
            const withANM = assetsList.filter(a => a.anmProcesso).length;

            const pricePerHaByState = byState
              .filter(s => s.area > 0)
              .map(s => ({ name: s.name, value: Math.round(s.value / s.area) }))
              .sort((a, b) => b.value - a.value)
              .slice(0, 10);

            const fmtVal = (v: number) => {
              if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
              if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
              return `R$ ${v.toLocaleString("pt-BR")}`;
            };

            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  <KpiTile label={t("reports.totalAssetsKpi")} value={assetsList.length} icon={Layers} />
                  <KpiTile label={lang === "en" ? "Total area" : "Área total"} value={`${totalAreaHa.toLocaleString("pt-BR")} ha`} icon={MapPin} />
                  <KpiTile label={lang === "en" ? "Avg R$/ha" : "R$/ha médio"} value={fmtVal(avgPriceHa)} icon={DollarSign} />
                  <KpiTile label={lang === "en" ? "Avg Geo Score" : "Score Geo médio"} value={avgGeoScore != null ? `${avgGeoScore}/100` : "—"} sub={`${geoScored.length} ${lang === "en" ? "assets analyzed" : "ativos analisados"}`} icon={Star} />
                  <KpiTile label={lang === "en" ? "States covered" : "Estados cobertos"} value={byState.filter(s => s.name !== "N/I").length} icon={Globe} />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card className="border-border/50 shadow-sm">
                    <CardContent className="p-4 text-center">
                      <p className="text-xs text-muted-foreground">{lang === "en" ? "Near river/stream" : "Próximo a rio/córrego"}</p>
                      <p className="text-2xl font-bold mt-1">{withWater}</p>
                      <p className="text-[10px] text-muted-foreground">{assetsList.length} {t("reports.ofTotal2")}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-border/50 shadow-sm">
                    <CardContent className="p-4 text-center">
                      <p className="text-xs text-muted-foreground">{lang === "en" ? "With nearby energy" : "Com energia próxima"}</p>
                      <p className="text-2xl font-bold mt-1">{withEnergy}</p>
                      <p className="text-[10px] text-muted-foreground">{assetsList.length} {t("reports.ofTotal2")}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-border/50 shadow-sm">
                    <CardContent className="p-4 text-center">
                      <p className="text-xs text-muted-foreground">{lang === "en" ? "With CAR" : "Com CAR"}</p>
                      <p className="text-2xl font-bold mt-1">{withCAR}</p>
                      <p className="text-[10px] text-muted-foreground">{assetsList.length} {t("reports.ofTotal2")}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-border/50 shadow-sm">
                    <CardContent className="p-4 text-center">
                      <p className="text-xs text-muted-foreground">{lang === "en" ? "With ANM process" : "Com processo ANM"}</p>
                      <p className="text-2xl font-bold mt-1">{withANM}</p>
                      <p className="text-[10px] text-muted-foreground">{assetsList.length} {t("reports.ofTotal2")}</p>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="border-border/50 shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">{lang === "en" ? "Assets by Municipality (Top 12)" : "Ativos por Município (Top 12)"}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={byMunicipio} layout="vertical" margin={{ left: 10, right: 16 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                            <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                            <YAxis type="category" dataKey="name" fontSize={10} tickLine={false} axisLine={false} width={90} stroke="hsl(var(--muted-foreground))" />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, t("reports.tabAssets")]} />
                            <Bar dataKey="value" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-border/50 shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">{lang === "en" ? "R$/Hectare by State" : "R$/Hectare por Estado"}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={pricePerHaByState} layout="vertical" margin={{ left: 0, right: 16 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                            <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                            <YAxis type="category" dataKey="name" fontSize={11} tickLine={false} axisLine={false} width={30} stroke="hsl(var(--muted-foreground))" />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`R$ ${Number(v).toLocaleString("pt-BR")}`, "R$/ha"]} />
                            <Bar dataKey="value" fill="hsl(var(--chart-4))" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card className="border-border/50 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">{lang === "en" ? "Summary by State" : "Resumo por Estado"}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 px-2 text-xs font-semibold text-muted-foreground">{lang === "en" ? "State" : "UF"}</th>
                            <th className="text-right py-2 px-2 text-xs font-semibold text-muted-foreground">{t("reports.tabAssets")}</th>
                            <th className="text-right py-2 px-2 text-xs font-semibold text-muted-foreground">{lang === "en" ? "Area (ha)" : "Área (ha)"}</th>
                            <th className="text-right py-2 px-2 text-xs font-semibold text-muted-foreground">{lang === "en" ? "Total Value" : "Valor Total"}</th>
                            <th className="text-right py-2 px-2 text-xs font-semibold text-muted-foreground">R$/ha</th>
                          </tr>
                        </thead>
                        <tbody>
                          {byState.map((s) => (
                            <tr key={s.name} className="border-b border-border/30 hover:bg-muted/40">
                              <td className="py-2 px-2 font-medium">{s.name}</td>
                              <td className="py-2 px-2 text-right">{s.count}</td>
                              <td className="py-2 px-2 text-right">{s.area.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</td>
                              <td className="py-2 px-2 text-right text-emerald-600 font-medium">{fmtVal(s.value)}</td>
                              <td className="py-2 px-2 text-right">{s.area > 0 ? fmtVal(s.value / s.area) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </>
            );
          })()}
        </TabsContent>

        {/* ── LEADS ── */}
        <TabsContent value="leads" className="space-y-5 mt-5">
          {(() => {
            const companiesList = filteredCompanies as any[];
            const withLead = companiesList.filter(c => c.lead);
            const leadNew = withLead.filter(c => c.lead?.status === "new").length;
            const leadQualified = withLead.filter(c => c.lead?.status === "qualified").length;
            const leadContacted = withLead.filter(c => c.lead?.status === "contacted").length;
            const leadConverted = withLead.filter(c => c.lead?.status === "converted" || c.lead?.status === "won").length;
            const leadLost = withLead.filter(c => c.lead?.status === "lost" || c.lead?.status === "disqualified").length;

            const avgScore = (() => {
              const scored = withLead.filter(c => c.lead?.score != null && c.lead.score > 0);
              if (scored.length === 0) return null;
              return Math.round(scored.reduce((s: number, c: any) => s + c.lead.score, 0) / scored.length);
            })();

            const leadsByScore = [
              { name: lang === "en" ? "Hot (≥70)" : "Quente (≥70)", value: withLead.filter(c => c.lead?.score >= 70).length },
              { name: lang === "en" ? "Warm (40-69)" : "Morno (40-69)", value: withLead.filter(c => c.lead?.score >= 40 && c.lead?.score < 70).length },
              { name: lang === "en" ? "Cold (<40)" : "Frio (<40)", value: withLead.filter(c => c.lead?.score != null && c.lead?.score < 40).length },
              { name: lang === "en" ? "No score" : "Sem score", value: withLead.filter(c => c.lead?.score == null || c.lead.score === 0).length },
            ];

            const leadStatusData = [
              { name: lang === "en" ? "New" : "Novo", value: leadNew },
              { name: lang === "en" ? "Contacted" : "Contatado", value: leadContacted },
              { name: lang === "en" ? "Qualified" : "Qualificado", value: leadQualified },
              { name: lang === "en" ? "Converted" : "Convertido", value: leadConverted },
              { name: lang === "en" ? "Lost" : "Perdido", value: leadLost },
            ].filter(d => d.value > 0);

            const leadMonthly = buildMonthlyData(withLead.map(c => c.lead), "createdAt", 6);

            const conversionRate = withLead.length > 0 ? (leadConverted / withLead.length) * 100 : 0;

            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  <KpiTile label={lang === "en" ? "Total leads" : "Total de leads"} value={withLead.length} icon={Users} />
                  <KpiTile label={lang === "en" ? "New" : "Novos"} value={leadNew} sub={lang === "en" ? "awaiting contact" : "aguardando contato"} icon={CirclePlus} />
                  <KpiTile label={lang === "en" ? "Qualified" : "Qualificados"} value={leadQualified} icon={CheckCircle2} />
                  <KpiTile label={lang === "en" ? "Avg score" : "Score médio"} value={avgScore != null ? avgScore : "—"} icon={Star} />
                  <KpiTile label={t("reports.closingRate")} value={`${conversionRate.toFixed(1)}%`} sub={`${leadConverted} ${lang === "en" ? "converted" : "convertidos"}`} icon={Target} />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="border-border/50 shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">{lang === "en" ? "Leads by Score" : "Leads por Score"}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[240px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={leadsByScore}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={50}
                              outerRadius={80}
                              paddingAngle={3}
                              label={({ name, value }: any) => value > 0 ? `${name} (${value})` : ""}
                              labelLine={false}
                              fontSize={10}
                            >
                              <Cell fill="#10b981" />
                              <Cell fill="#f59e0b" />
                              <Cell fill="#6b7280" />
                              <Cell fill="#d1d5db" />
                            </Pie>
                            <Tooltip contentStyle={tooltipStyle} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-border/50 shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">{lang === "en" ? "Leads by Status" : "Leads por Status"}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[240px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={leadStatusData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                            <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
                            <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, "Leads"]} />
                            <Bar dataKey="value" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card className="border-border/50 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">{lang === "en" ? "Monthly Lead Evolution" : "Evolução Mensal de Leads"}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={leadMonthly}>
                          <defs>
                            <linearGradient id="cgLeads" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(var(--chart-5))" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="hsl(var(--chart-5))" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                          <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
                          <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, "Leads"]} />
                          <Area type="monotone" dataKey="value" stroke="hsl(var(--chart-5))" strokeWidth={2} fill="url(#cgLeads)" dot={{ r: 3, fill: "hsl(var(--chart-5))" }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/50 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">{lang === "en" ? "Top Leads by Score" : "Top Leads por Score"}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {[...withLead]
                        .filter(c => c.lead?.score > 0)
                        .sort((a, b) => (b.lead?.score || 0) - (a.lead?.score || 0))
                        .slice(0, 10)
                        .map((co: any, i) => (
                          <div key={co.id} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-muted/40" data-testid={`row-lead-score-${co.id}`}>
                            <span className="text-xs font-bold text-muted-foreground w-5 shrink-0">#{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{co.tradeName || co.legalName}</p>
                              <p className="text-xs text-muted-foreground">
                                {co.lead?.status || "—"} {co.address?.uf ? `— ${co.address.uf}` : ""}
                              </p>
                            </div>
                            <Badge className={cn("text-[10px] shrink-0",
                              co.lead?.score >= 70 ? "bg-green-100 text-green-700 dark:bg-green-900/30" :
                              co.lead?.score >= 40 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30" :
                              "bg-gray-100 text-gray-500"
                            )}>
                              Score: {co.lead?.score}
                            </Badge>
                          </div>
                        ))}
                      {withLead.filter(c => c.lead?.score > 0).length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-6">
                          {lang === "en" ? "No leads with score." : "Nenhum lead com score."}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </>
            );
          })()}
        </TabsContent>

        <TabsContent value="atividades" className="space-y-5 mt-5">
          <ActivityFeed />
        </TabsContent>
      </Tabs>
    </div>
  );
}
