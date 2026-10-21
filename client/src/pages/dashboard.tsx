import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { useI18n, getDateLocale, formatDatePattern } from "@/lib/i18n";
import {
  TreePine, DollarSign, ArrowRight,
  Layers, Building2, MapPin,
  AlertTriangle, Activity,
  ArrowUpRight, ArrowDownRight,
  Globe, Percent, Hash, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const CHART_COLORS = [
  "hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))",
  "hsl(var(--chart-4))", "hsl(var(--chart-5))",
];

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  borderColor: "hsl(var(--border))",
  borderRadius: "12px",
  fontSize: "12px",
  boxShadow: "0 8px 30px rgba(0,0,0,0.08)",
};

export default function Dashboard() {
  const [, navigate] = useLocation();
  const [now, setNow] = useState(new Date());
  const { t, lang } = useI18n();
  const locale = getDateLocale(lang);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const { data: s, isLoading, isError } = useQuery({
    queryKey: ["/api/dashboard/stats"],
    queryFn: () => apiRequest("GET", "/api/dashboard/stats").then(r => r.json()),
    refetchInterval: 60000,
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["/api/companies"],
    queryFn: () => apiRequest("GET", "/api/companies").then(r => r.json()),
  });

  const { data: allAssets = [] } = useQuery({
    queryKey: ["/api/assets"],
    queryFn: () => apiRequest("GET", "/api/assets").then(r => r.json()),
  });

  const { data: logs = [] } = useQuery({
    queryKey: ["/api/audit-logs"],
    queryFn: () => apiRequest("GET", "/api/audit-logs?limit=20").then(r => r.json()),
  });

  const [dollar, setDollar] = useState<any>(null);
  const [euro, setEuro] = useState<any>(null);
  const [btc, setBtc] = useState<any>(null);
  const [selic, setSelic] = useState<any>(null);

  useEffect(() => {
    apiRequest("GET", "/api/dashboard/quotes")
      .then(r => r.json())
      .then(d => {
        if (d.dollar) setDollar(d.dollar);
        if (d.euro) setEuro(d.euro);
        if (d.btc) setBtc(d.btc);
        if (d.selic) setSelic(d.selic);
      })
      .catch(() => {});
  }, []);

  const monthlyCompanies = useMemo(() => {
    const data: { name: string; value: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = format(d, "MMM", { locale });
      data.push({
        name: label,
        value: (companies as any[]).filter(c => c.createdAt?.startsWith(key)).length,
      });
    }
    return data;
  }, [companies, locale]);

  const TIPO_LABEL: Record<string, string> = {
    TERRA: t("dash.lands"), MINA: t("dash.mining"), NEGOCIO: t("dash.ma"),
    FII_CRI: t("dash.fiiCri"), DESENVOLVIMENTO: t("dash.dev"), AGRO: t("dash.agro"),
  };

  const assetsByType = useMemo(() => {
    const grouped: Record<string, number> = {};
    (allAssets as any[]).forEach(a => {
      const key = TIPO_LABEL[a.type] || a.type;
      grouped[key] = (grouped[key] || 0) + 1;
    });
    return Object.entries(grouped).map(([name, value]) => ({ name, value }));
  }, [allAssets, lang]);

  const assetsByState = useMemo(() => {
    const grouped: Record<string, number> = {};
    (allAssets as any[]).forEach(a => {
      const uf = a.estado || "N/I";
      grouped[uf] = (grouped[uf] || 0) + 1;
    });
    return Object.entries(grouped)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [allAssets]);

  const totalArea = useMemo(() =>
    (allAssets as any[]).reduce((s, a) => s + (a.areaHa || 0), 0),
    [allAssets]
  );

  if (isLoading) return (
    <div className="p-5 md:p-8 space-y-6">
      <div className="h-8 w-48 bg-muted/60 animate-pulse rounded-xl" />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <div key={i} className="h-28 bg-muted/40 animate-pulse rounded-2xl" />)}
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <div key={i} className="h-56 bg-muted/40 animate-pulse rounded-2xl" />)}
      </div>
    </div>
  );

  if (isError) return (
    <div className="p-6 flex flex-col items-center justify-center py-20 text-center" data-testid="dashboard-error">
      <AlertTriangle className="w-10 h-10 text-red-400/60 mb-4" />
      <p className="text-base font-semibold mb-1.5">Erro ao carregar</p>
      <p className="text-sm text-muted-foreground mb-5">Não foi possível buscar os dados.</p>
      <button onClick={() => window.location.reload()} className="text-sm px-5 py-2 rounded-xl border border-border/60 hover:bg-muted transition-all duration-150 hover:shadow-sm" data-testid="button-reload-dashboard">Recarregar</button>
    </div>
  );

  const kpis = [
    { label: t("dash.availableAssets"), value: s?.ativos?.total ?? 0, sub: `${s?.ativos?.emNegociacao ?? 0} ${t("dash.inNegotiation")}`, icon: TreePine, color: "text-emerald-600 dark:text-emerald-400", bgIcon: "bg-emerald-100 dark:bg-emerald-900/40", onClick: () => navigate("/ativos") },
    { label: t("dash.totalArea"), value: `${totalArea.toLocaleString("pt-BR")} ha`, icon: MapPin, color: "text-teal-600 dark:text-teal-400", bgIcon: "bg-teal-100 dark:bg-teal-900/40", isText: true },
  ];

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-baseline justify-between animate-fade-in-up">
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-dashboard-title">{t("dash.title")}</h1>
        <span className="text-xs text-muted-foreground/50 font-medium">{format(now, formatDatePattern(lang), { locale })}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 animate-fade-in-up" style={{ animationDelay: '50ms' }}>
        {kpis.map((k, i) => (
          <Card
            key={i}
            className={cn(
              "border-border/30 hover:shadow-lg transition-all duration-200",
              k.onClick ? "cursor-pointer hover:border-primary/30 hover:-translate-y-0.5" : ""
            )}
            onClick={k.onClick}
            data-testid={`card-kpi-${i}`}
          >
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", k.bgIcon)}>
                  <k.icon className={cn("w-5 h-5", k.color)} />
                </div>
                {k.onClick && <ArrowRight className="w-4 h-4 text-muted-foreground/30" />}
              </div>
              <div>
                <p className={cn("font-bold tracking-tight", k.isText ? "text-xl" : "text-3xl")} data-testid={`kpi-value-${i}`}>{k.value}</p>
                <p className="text-xs text-muted-foreground mt-1 font-medium">{k.label}</p>
              </div>
              {k.sub && <p className="text-[11px] text-muted-foreground/50">{k.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
        <Card className="border-border/30">
          <CardHeader className="pb-2 pt-5 px-5">
            <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center gap-2 uppercase tracking-wide">
              <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center">
                <Layers className="w-3.5 h-3.5 text-primary" />
              </div>
              {t("dash.assetsByType")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {assetsByType.length > 0 ? (
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={assetsByType}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={42}
                      outerRadius={68}
                      paddingAngle={3}
                      fontSize={10}
                      label={({ name, value }: any) => `${name} (${value})`}
                      labelLine={false}
                    >
                      {assetsByType.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-10">{t("dash.noAssetsRegistered")}</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/30">
          <CardHeader className="pb-2 pt-5 px-5">
            <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center gap-2 uppercase tracking-wide">
              <div className="w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <MapPin className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              </div>
              {t("dash.assetsByState")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {assetsByState.length > 0 ? (
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={assetsByState} layout="vertical" margin={{ left: 0, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" opacity={0.4} />
                    <XAxis type="number" fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                    <YAxis type="category" dataKey="name" fontSize={10} tickLine={false} axisLine={false} width={24} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, t("common.assets")]} />
                    <Bar dataKey="value" fill="hsl(var(--chart-4))" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-10">{t("dash.noDataShort")}</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/30">
          <CardHeader className="pb-2 pt-5 px-5">
            <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center gap-2 uppercase tracking-wide">
              <div className="w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Building2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              </div>
              {t("dash.companiesPerMonth")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyCompanies}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis dataKey="name" fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
                  <YAxis fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, t("common.companies")]} />
                  <Bar dataKey="value" fill="hsl(var(--chart-1))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/30 animate-fade-in-up" style={{ animationDelay: '150ms' }}>
        <CardHeader className="pb-2 pt-5 px-5">
          <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center gap-2 uppercase tracking-wide">
            <div className="w-6 h-6 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Activity className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
            </div>
            {t("dash.recentActivity")}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {(logs as any[]).length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">{t("dash.noRecentActivity")}</p>
          ) : (
            <div className="space-y-0.5">
              {(logs as any[]).slice(0, 8).map((log: any) => (
                <div key={log.id} className="flex items-center gap-3 py-2.5 px-2 text-sm rounded-lg hover:bg-muted/50 transition-colors duration-150" data-testid={`activity-${log.id}`}>
                  <div className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    log.action === "created" ? "bg-emerald-500" :
                    log.action === "deleted" ? "bg-red-400" :
                    log.action === "stage_changed" ? "bg-purple-500" : "bg-blue-500"
                  )} />
                  <div className="flex-1 min-w-0 truncate text-xs">
                    <span className="font-medium">{log.userName}</span>
                    <span className="text-muted-foreground"> {log.action === "created" ? t("dash.created") : log.action === "deleted" ? t("dash.deleted") : t("dash.updated")} </span>
                    <span className="font-medium">{log.entityTitle || log.entity}</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground/50 shrink-0 font-medium">
                    {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true, locale })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 animate-fade-in-up" style={{ animationDelay: '200ms' }} data-testid="section-quotes">
        {dollar && (
          <Card className="border-border/30 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">{t("dash.dollar")}</span>
              </div>
              <p className="text-lg font-bold tracking-tight" data-testid="quote-dollar">R$ {Number(dollar.bid).toFixed(2)}</p>
              <p className={cn("text-[11px] flex items-center gap-0.5 font-medium",
                Number(dollar.pctChange) >= 0 ? "text-emerald-600" : "text-red-500"
              )}>
                {Number(dollar.pctChange) >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {dollar.pctChange}%
              </p>
            </CardContent>
          </Card>
        )}

        {euro && (
          <Card className="border-border/30 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                  <Globe className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                </div>
                <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">{t("dash.euro")}</span>
              </div>
              <p className="text-lg font-bold tracking-tight" data-testid="quote-euro">R$ {Number(euro.bid).toFixed(2)}</p>
              <p className={cn("text-[11px] flex items-center gap-0.5 font-medium",
                Number(euro.pctChange) >= 0 ? "text-emerald-600" : "text-red-500"
              )}>
                {Number(euro.pctChange) >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {euro.pctChange}%
              </p>
            </CardContent>
          </Card>
        )}

        {btc && (
          <Card className="border-border/30 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center">
                  <Hash className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
                </div>
                <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">{t("dash.bitcoin")}</span>
              </div>
              <p className="text-lg font-bold tracking-tight" data-testid="quote-btc">R$ {Number(Number(btc.bid).toFixed(0)).toLocaleString("pt-BR")}</p>
              <p className={cn("text-[11px] flex items-center gap-0.5 font-medium",
                Number(btc.pctChange) >= 0 ? "text-emerald-600" : "text-red-500"
              )}>
                {Number(btc.pctChange) >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {btc.pctChange}%
              </p>
            </CardContent>
          </Card>
        )}

        {selic && (
          <Card className="border-border/30 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center">
                  <Percent className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                </div>
                <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">{t("dash.selic")}</span>
              </div>
              <p className="text-lg font-bold tracking-tight" data-testid="quote-selic">{selic.valor}%</p>
              <p className="text-[11px] text-muted-foreground/40 font-medium">{selic.data}</p>
            </CardContent>
          </Card>
        )}

        <Card className="border-border/30 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center">
                <BarChart3 className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
              </div>
              <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">{t("dash.cdi")}</span>
            </div>
            <p className="text-lg font-bold tracking-tight" data-testid="quote-cdi">{selic ? `${(Number(selic.valor) * 0.9).toFixed(2)}%` : "—"}</p>
            <p className="text-[11px] text-muted-foreground/40 font-medium">~90% Selic</p>
          </CardContent>
        </Card>
      </div>

      <p className="text-[10px] text-center text-muted-foreground/30 pb-4 font-medium">
        {t("dash.realTimeData")} • {format(now, "HH:mm", { locale })}
      </p>
    </div>
  );
}
