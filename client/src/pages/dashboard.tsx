import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { useI18n, getDateLocale, formatDatePattern } from "@/lib/i18n";
import {
  TreePine, Briefcase, DollarSign, Zap, Clock, Users, ArrowRight,
  TrendingUp, Target, BarChart3, Layers, Building2,
  AlertTriangle, Calendar, MapPin, Star, Activity,
  Sun, CloudRain, Wind, Thermometer, Droplets, ArrowUpRight, ArrowDownRight,
  Globe, Percent, Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const CHART_COLORS = [
  "hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))",
  "hsl(var(--chart-4))", "hsl(var(--chart-5))",
];

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  borderColor: "hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

function fmt(v: number) {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
  return `R$ ${v.toLocaleString("pt-BR")}`;
}

const WMO_KEYS: Record<number, string> = {
  0: "dash.clearSky",
  1: "dash.partlyCloudy",
  2: "dash.cloudy",
  3: "dash.overcast",
  45: "dash.fog",
  51: "dash.lightDrizzle",
  53: "dash.drizzle",
  61: "dash.lightRain",
  63: "dash.moderateRain",
  65: "dash.heavyRain",
  80: "dash.showers",
  95: "dash.thunderstorm",
};

const WMO_ICON: Record<number, typeof Sun> = {
  0: Sun, 1: Sun, 2: CloudRain, 3: CloudRain, 45: CloudRain,
  51: CloudRain, 53: CloudRain, 61: CloudRain, 63: CloudRain,
  65: CloudRain, 80: CloudRain, 95: CloudRain,
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

  const { data: s, isLoading } = useQuery({
    queryKey: ["/api/dashboard/stats"],
    queryFn: () => apiRequest("GET", "/api/dashboard/stats").then(r => r.json()),
    refetchInterval: 60000,
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["/api/crm/companies"],
    queryFn: () => apiRequest("GET", "/api/crm/companies").then(r => r.json()),
  });

  const { data: allDeals = [] } = useQuery({
    queryKey: ["/api/crm/deals"],
    queryFn: () => apiRequest("GET", "/api/crm/deals").then(r => r.json()),
  });

  const { data: allAssets = [] } = useQuery({
    queryKey: ["/api/matching/assets"],
    queryFn: () => apiRequest("GET", "/api/matching/assets").then(r => r.json()),
  });

  const { data: logs = [] } = useQuery({
    queryKey: ["/api/audit-logs"],
    queryFn: () => apiRequest("GET", "/api/audit-logs?limit=20").then(r => r.json()),
  });

  const [dollar, setDollar] = useState<any>(null);
  const [euro, setEuro] = useState<any>(null);
  const [btc, setBtc] = useState<any>(null);
  const [weather, setWeather] = useState<any>(null);
  const [weatherCity, setWeatherCity] = useState<string>("São Paulo");
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

    const fetchWeather = (lat: number, lon: number) => {
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=America/Sao_Paulo&forecast_days=3`)
        .then(r => r.json())
        .then(d => setWeather(d))
        .catch(() => {});
    };

    const resolveCity = (lat: number, lon: number) => {
      fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`, {
        headers: { "User-Agent": "MavrionConnect/1.0" },
      })
        .then(r => r.json())
        .then(d => {
          const city = d.address?.city || d.address?.town || d.address?.municipality || d.address?.village;
          if (city) setWeatherCity(city);
        })
        .catch(() => {});
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          fetchWeather(pos.coords.latitude, pos.coords.longitude);
          resolveCity(pos.coords.latitude, pos.coords.longitude);
        },
        () => fetchWeather(-23.55, -46.63),
        { timeout: 5000 }
      );
    } else {
      fetchWeather(-23.55, -46.63);
    }
  }, []);

  const monthlyDeals = useMemo(() => {
    const data: { name: string; count: number; value: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = format(d, "MMM", { locale });
      const matching = (allDeals as any[]).filter(deal => deal.createdAt?.startsWith(key));
      data.push({
        name: label,
        count: matching.length,
        value: matching.reduce((s: number, deal: any) => s + (deal.amountEstimate || 0), 0),
      });
    }
    return data;
  }, [allDeals, locale]);

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

  const dealsByPriority = useMemo(() => {
    const grouped: Record<string, number> = {};
    grouped[t("dash.priorityHigh")] = 0;
    grouped[t("dash.priorityMedium")] = 0;
    grouped[t("dash.priorityLow")] = 0;
    (allDeals as any[]).forEach(d => {
      if (d.priority === "high" || d.priority === "urgent") grouped[t("dash.priorityHigh")]++;
      else if (d.priority === "medium") grouped[t("dash.priorityMedium")]++;
      else grouped[t("dash.priorityLow")]++;
    });
    return Object.entries(grouped).map(([name, value]) => ({ name, value }));
  }, [allDeals, lang]);

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

  const totalPortfolioValue = useMemo(() =>
    (allAssets as any[]).reduce((s, a) => s + (a.priceAsking || 0), 0),
    [allAssets]
  );

  const totalArea = useMemo(() =>
    (allAssets as any[]).reduce((s, a) => s + (a.areaHa || 0), 0),
    [allAssets]
  );

  const avgGeoScore = useMemo(() => {
    const scored = (allAssets as any[]).filter(a => a.geoScore != null);
    if (scored.length === 0) return null;
    return Math.round(scored.reduce((s, a) => s + a.geoScore, 0) / scored.length);
  }, [allAssets]);

  const closingSoonDeals = useMemo(() =>
    (allDeals as any[])
      .filter(d => d.expectedCloseDate)
      .sort((a, b) => new Date(a.expectedCloseDate).getTime() - new Date(b.expectedCloseDate).getTime())
      .slice(0, 5),
    [allDeals]
  );

  const highPriorityDeals = useMemo(() =>
    (allDeals as any[])
      .filter(d => d.priority === "high" || d.priority === "urgent")
      .slice(0, 5),
    [allDeals]
  );

  const maxDeals = Math.max(...(s?.deals?.porEstagio?.map((e: any) => e.count) || [1]), 1);

  if (isLoading) return (
    <div className="p-6 space-y-4">
      <div className="h-8 w-48 bg-muted animate-pulse rounded-lg" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-muted animate-pulse rounded-xl" />)}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-52 bg-muted animate-pulse rounded-xl" />)}
      </div>
    </div>
  );

  const kpis = [
    { label: t("dash.availableAssets"), value: s?.ativos?.total ?? 0, sub: `${s?.ativos?.emNegociacao ?? 0} ${t("dash.inNegotiation")}`, icon: TreePine, color: "text-green-600", bg: "bg-green-50 dark:bg-green-900/20", onClick: () => navigate("/ativos") },
    { label: t("dash.activeDeals"), value: s?.deals?.total ?? 0, sub: `${s?.leads?.novos ?? 0} ${t("dash.newLeads")}`, icon: Briefcase, color: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-900/20", onClick: () => navigate("/crm") },
    { label: t("dash.pipelineVolume"), value: fmt(s?.deals?.volumeTotal ?? 0), sub: `${(allDeals as any[]).filter(d => d.feeValue).length} ${t("dash.withFee")}`, icon: DollarSign, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-900/20", isText: true },
    { label: t("dash.pendingMatches"), value: s?.matchesPendentes ?? 0, sub: `${s?.leads?.portal24h ?? 0} ${t("dash.portalLeads24h")}`, icon: Zap, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-900/20", onClick: () => navigate("/matching") },
  ];

  const kpis2 = [
    { label: t("dash.crmCompanies"), value: (companies as any[]).length, icon: Building2, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-900/20", onClick: () => navigate("/crm") },
    { label: t("dash.portfolioValue"), value: fmt(totalPortfolioValue), icon: Layers, color: "text-indigo-600", bg: "bg-indigo-50 dark:bg-indigo-900/20", isText: true },
    { label: t("dash.totalArea"), value: `${totalArea.toLocaleString("pt-BR")} ha`, icon: MapPin, color: "text-teal-600", bg: "bg-teal-50 dark:bg-teal-900/20", isText: true },
    { label: t("dash.qualifiedLeads"), value: s?.leads?.qualificados ?? 0, sub: `score ≥ 60`, icon: Target, color: "text-rose-600", bg: "bg-rose-50 dark:bg-rose-900/20" },
  ];

  const feesTotal = (allDeals as any[]).reduce((s: number, d: any) => s + (d.feeValue || 0), 0);
  const feesRecebidos = (allDeals as any[])
    .filter((d: any) => d.feeStatus === "recebido")
    .reduce((s: number, d: any) => s + (d.feeValue || 0), 0);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-dashboard-title">{t("dash.title")}</h1>
          <p className="text-sm text-muted-foreground">{format(now, formatDatePattern(lang), { locale })}</p>
        </div>
        <div className="flex items-center gap-2">
          {weather?.current && (
            <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full" data-testid="widget-weather-mini">
              <Thermometer className="w-3.5 h-3.5" />
              <span className="font-medium">{weather.current.temperature_2m}°C</span>
              <span className="text-xs">{weatherCity}</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((k, i) => (
          <Card key={i} className={cn("transition-all duration-200 border-border/50", k.onClick ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5" : "")} onClick={k.onClick} data-testid={`card-kpi-${i}`}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", k.bg)}>
                  <k.icon className={cn("w-5 h-5", k.color)} />
                </div>
                {k.onClick && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />}
              </div>
              <p className={cn("font-bold", k.isText ? "text-xl" : "text-3xl")} data-testid={`kpi-value-${i}`}>{k.value}</p>
              <p className="text-xs font-medium text-muted-foreground">{k.label}</p>
              {k.sub && <p className="text-[10px] text-muted-foreground">{k.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis2.map((k, i) => (
          <Card key={i} className={cn("transition-all duration-200 border-border/50", k.onClick ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5" : "")} onClick={k.onClick} data-testid={`card-kpi2-${i}`}>
            <CardContent className="p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <div className={cn("w-7 h-7 rounded-md flex items-center justify-center", k.bg)}>
                  <k.icon className={cn("w-4 h-4", k.color)} />
                </div>
                <p className="text-xs font-medium text-muted-foreground">{k.label}</p>
              </div>
              <p className={cn("font-bold", k.isText ? "text-lg" : "text-2xl")}>{k.value}</p>
              {k.sub && <p className="text-[10px] text-muted-foreground">{k.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-border/50">
          <CardContent className="p-3 space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{t("dash.totalFees")}</p>
            <p className="text-lg font-bold text-amber-600" data-testid="kpi-fees-total">{fmt(feesTotal)}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3 space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{t("dash.receivedFees")}</p>
            <p className="text-lg font-bold text-green-600" data-testid="kpi-fees-recebidos">{fmt(feesRecebidos)}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3 space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{t("dash.avgGeoScore")}</p>
            <p className="text-lg font-bold" data-testid="kpi-geo-score">{avgGeoScore != null ? `${avgGeoScore}/100` : "—"}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3 space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{t("dash.avgPriceHa")}</p>
            <p className="text-lg font-bold" data-testid="kpi-preco-ha">
              {totalArea > 0 ? fmt(totalPortfolioValue / totalArea) : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <Card className="md:col-span-2 border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-muted-foreground" /> {t("dash.dealPipeline")}
              </CardTitle>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => navigate("/crm")} data-testid="button-ver-crm">
                {t("dash.viewCRM")} <ArrowRight className="w-3 h-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {(s?.deals?.porEstagio || []).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">{t("dash.noDealsYet")}</p>
            )}
            {(s?.deals?.porEstagio || []).map((e: any, i: number) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium truncate max-w-[180px]">{e.stageName}</span>
                  <div className="flex gap-2 items-center">
                    <span className="text-muted-foreground">{e.count} deal{e.count !== 1 ? "s" : ""}</span>
                    {e.volumeTotal > 0 && <span className="text-emerald-600 font-medium">{fmt(e.volumeTotal)}</span>}
                  </div>
                </div>
                <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary/70 rounded-full transition-all" style={{ width: `${(e.count / maxDeals) * 100}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="w-4 h-4 text-muted-foreground" /> {t("dash.assetsByType")}
            </CardTitle>
          </CardHeader>
          <CardContent>
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
                      innerRadius={40}
                      outerRadius={70}
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
              <p className="text-xs text-muted-foreground text-center py-8">{t("dash.noAssetsRegistered")}</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="w-4 h-4 text-muted-foreground" /> {t("dash.dealsByPriority")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dealsByPriority.some(d => d.value > 0) ? (
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={dealsByPriority}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={3}
                      fontSize={10}
                      label={({ name, value }: any) => value > 0 ? `${name} (${value})` : ""}
                      labelLine={false}
                    >
                      <Cell fill="#ef4444" />
                      <Cell fill="#f59e0b" />
                      <Cell fill="#6b7280" />
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-8">{t("dash.noDeals")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-muted-foreground" /> {t("dash.dealsPerMonth")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyDeals}>
                  <defs>
                    <linearGradient id="cgDeals" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
                  <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, "Deals"]} />
                  <Area type="monotone" dataKey="count" stroke="hsl(var(--chart-2))" strokeWidth={2} fill="url(#cgDeals)" dot={{ r: 3, fill: "hsl(var(--chart-2))" }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Building2 className="w-4 h-4 text-muted-foreground" /> {t("dash.companiesPerMonth")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyCompanies}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
                  <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, t("common.companies")]} />
                  <Bar dataKey="value" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600" /> {t("dash.stalledDeals")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(s?.deals?.parados || []).length === 0 && <p className="text-xs text-muted-foreground text-center py-3">{t("dash.noStalledDeals")}</p>}
            {(s?.deals?.parados || []).map((d: any) => (
              <div key={d.id} className="flex items-center justify-between gap-2 text-sm" data-testid={`row-deal-parado-${d.id}`}>
                <span className="truncate flex-1 text-xs">{d.title}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">{d.diasParado}d</Badge>
                  <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => navigate("/crm")}>{t("common.view")}</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" /> {t("dash.highUrgentPriority")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {highPriorityDeals.length === 0 && <p className="text-xs text-muted-foreground text-center py-3">{t("dash.noUrgentDeals")}</p>}
            {highPriorityDeals.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between gap-2 text-sm" data-testid={`row-priority-${d.id}`}>
                <span className="truncate flex-1 text-xs">{d.title}</span>
                <Badge className={cn("text-[10px] shrink-0", d.priority === "urgent" ? "bg-red-100 text-red-700 dark:bg-red-900/30" : "bg-orange-100 text-orange-700 dark:bg-orange-900/30")}>
                  {d.priority === "urgent" ? t("dash.urgent") : t("dash.high")}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-600" /> {t("dash.portalLeads")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(s?.leads?.recentes || []).length === 0 && <p className="text-xs text-muted-foreground text-center py-3">{t("dash.noLeads24h")}</p>}
            {(s?.leads?.recentes || []).slice(0, 5).map((l: any) => (
              <div key={l.id} className="flex items-center justify-between gap-2 text-sm" data-testid={`row-lead-${l.id}`}>
                <span className="truncate flex-1 text-xs">{l.name}</span>
                <Badge className={cn("text-[10px] shrink-0",
                  l.intentScore >= 70 ? "bg-green-100 text-green-700" :
                  l.intentScore >= 40 ? "bg-amber-100 text-amber-700" :
                  "bg-gray-100 text-gray-500"
                )}>
                  {l.intentScore >= 70 ? t("dash.hot") : l.intentScore >= 40 ? t("dash.warm") : t("dash.cold")} {l.intentScore}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" /> {t("dash.upcomingClosings")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {closingSoonDeals.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">{t("dash.noClosingDate")}</p>}
            {closingSoonDeals.map((d: any) => {
              const closeDate = new Date(d.expectedCloseDate);
              const isPast = closeDate < now;
              return (
                <div key={d.id} className="flex items-center justify-between gap-2 py-1.5" data-testid={`row-closing-${d.id}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{d.title}</p>
                    {d.amountEstimate > 0 && <p className="text-[10px] text-emerald-600">{fmt(d.amountEstimate)}</p>}
                  </div>
                  <Badge variant={isPast ? "destructive" : "outline"} className="text-[10px] shrink-0">
                    {isPast ? t("dash.overdue") : format(closeDate, "dd/MM")}
                  </Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground" /> {t("dash.assetsByState")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {assetsByState.length > 0 ? (
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={assetsByState} layout="vertical" margin={{ left: 0, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                    <YAxis type="category" dataKey="name" fontSize={11} tickLine={false} axisLine={false} width={28} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, t("common.assets")]} />
                    <Bar dataKey="value" fill="hsl(var(--chart-4))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-8">{t("dash.noDataShort")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" /> {t("dash.recentActivity")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(logs as any[]).length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">{t("dash.noRecentActivity")}</p>
          ) : (
            <div className="space-y-1.5">
              {(logs as any[]).slice(0, 8).map((log: any) => (
                <div key={log.id} className="flex items-center gap-3 py-1.5 text-xs" data-testid={`activity-${log.id}`}>
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-white",
                    log.action === "created" ? "bg-green-500" :
                    log.action === "deleted" ? "bg-red-500" :
                    log.action === "stage_changed" ? "bg-purple-500" : "bg-blue-500"
                  )}>
                    {log.action === "created" ? "+" : log.action === "deleted" ? "−" : "↻"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{log.userName}</span>
                    <span className="text-muted-foreground"> {log.action === "created" ? t("dash.created") : log.action === "deleted" ? t("dash.deleted") : t("dash.updated")} </span>
                    <span className="font-medium">{log.entityTitle || log.entity}</span>
                  </div>
                  <span className="text-muted-foreground shrink-0">
                    {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true, locale })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {weather?.current && (
        <Card className="border-border/50" data-testid="section-weather">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sun className="w-4 h-4 text-amber-500" /> Clima — {weatherCity}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-900/10 text-center">
                <Thermometer className="w-4 h-4 text-blue-600 mx-auto mb-1" />
                <p className="text-xl font-bold">{weather.current.temperature_2m}°C</p>
                <p className="text-[10px] text-muted-foreground">{t("dash.temperature")}</p>
              </div>
              <div className="p-3 rounded-lg bg-gradient-to-br from-cyan-50 to-cyan-100 dark:from-cyan-900/20 dark:to-cyan-900/10 text-center">
                <Droplets className="w-4 h-4 text-cyan-600 mx-auto mb-1" />
                <p className="text-xl font-bold">{weather.current.relative_humidity_2m}%</p>
                <p className="text-[10px] text-muted-foreground">{t("dash.humidity")}</p>
              </div>
              <div className="p-3 rounded-lg bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800/30 dark:to-gray-800/10 text-center">
                <Wind className="w-4 h-4 text-gray-600 mx-auto mb-1" />
                <p className="text-xl font-bold">{weather.current.wind_speed_10m} km/h</p>
                <p className="text-[10px] text-muted-foreground">{t("dash.wind")}</p>
              </div>
              <div className="p-3 rounded-lg bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/20 dark:to-amber-900/10 text-center">
                {(() => {
                  const wmoKey = WMO_KEYS[weather.current.weather_code] || "dash.clearSky";
                  const WIcon = WMO_ICON[weather.current.weather_code] || Sun;
                  return (
                    <>
                      <WIcon className="w-4 h-4 text-amber-600 mx-auto mb-1" />
                      <p className="text-sm font-bold">{t(wmoKey)}</p>
                      <p className="text-[10px] text-muted-foreground">{t("dash.condition")}</p>
                    </>
                  );
                })()}
              </div>
            </div>
            {weather.daily && (
              <div className="mt-3">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">{t("dash.forecast3d")}</p>
                <div className="grid grid-cols-3 gap-2">
                  {weather.daily.time?.map((day: string, i: number) => (
                    <div key={day} className="p-2 rounded-lg bg-muted/50 text-center text-xs">
                      <p className="font-medium">{new Date(day + "T12:00:00").toLocaleDateString(lang === "en" ? "en-US" : "pt-BR", { weekday: "short", day: "numeric" })}</p>
                      <p className="text-muted-foreground mt-0.5">
                        {weather.daily.temperature_2m_min?.[i]?.toFixed(0)}° — {weather.daily.temperature_2m_max?.[i]?.toFixed(0)}°
                      </p>
                      {weather.daily.precipitation_sum?.[i] > 0 && (
                        <p className="text-blue-600 mt-0.5">{weather.daily.precipitation_sum[i].toFixed(1)} mm</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3" data-testid="section-quotes">
        {dollar && (
          <Card className="border-border/50 bg-gradient-to-br from-green-50/50 to-transparent dark:from-green-900/10">
            <CardContent className="p-3 space-y-1">
              <div className="flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-green-600" />
                <span className="text-[10px] font-medium text-muted-foreground uppercase">{t("dash.dollar")}</span>
              </div>
              <p className="text-lg font-bold" data-testid="quote-dollar">R$ {Number(dollar.bid).toFixed(2)}</p>
              <p className={cn("text-[10px] flex items-center gap-0.5",
                Number(dollar.pctChange) >= 0 ? "text-green-600" : "text-red-500"
              )}>
                {Number(dollar.pctChange) >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {dollar.pctChange}%
              </p>
            </CardContent>
          </Card>
        )}

        {euro && (
          <Card className="border-border/50 bg-gradient-to-br from-blue-50/50 to-transparent dark:from-blue-900/10">
            <CardContent className="p-3 space-y-1">
              <div className="flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-blue-600" />
                <span className="text-[10px] font-medium text-muted-foreground uppercase">{t("dash.euro")}</span>
              </div>
              <p className="text-lg font-bold" data-testid="quote-euro">R$ {Number(euro.bid).toFixed(2)}</p>
              <p className={cn("text-[10px] flex items-center gap-0.5",
                Number(euro.pctChange) >= 0 ? "text-green-600" : "text-red-500"
              )}>
                {Number(euro.pctChange) >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {euro.pctChange}%
              </p>
            </CardContent>
          </Card>
        )}

        {btc && (
          <Card className="border-border/50 bg-gradient-to-br from-orange-50/50 to-transparent dark:from-orange-900/10">
            <CardContent className="p-3 space-y-1">
              <div className="flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-orange-600" />
                <span className="text-[10px] font-medium text-muted-foreground uppercase">{t("dash.bitcoin")}</span>
              </div>
              <p className="text-lg font-bold" data-testid="quote-btc">R$ {Number(Number(btc.bid).toFixed(0)).toLocaleString("pt-BR")}</p>
              <p className={cn("text-[10px] flex items-center gap-0.5",
                Number(btc.pctChange) >= 0 ? "text-green-600" : "text-red-500"
              )}>
                {Number(btc.pctChange) >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {btc.pctChange}%
              </p>
            </CardContent>
          </Card>
        )}

        {selic && (
          <Card className="border-border/50 bg-gradient-to-br from-purple-50/50 to-transparent dark:from-purple-900/10">
            <CardContent className="p-3 space-y-1">
              <div className="flex items-center gap-1.5">
                <Percent className="w-3.5 h-3.5 text-purple-600" />
                <span className="text-[10px] font-medium text-muted-foreground uppercase">{t("dash.selic")}</span>
              </div>
              <p className="text-lg font-bold" data-testid="quote-selic">{selic.valor}%</p>
              <p className="text-[10px] text-muted-foreground">{selic.data}</p>
            </CardContent>
          </Card>
        )}

        <Card className="border-border/50 bg-gradient-to-br from-teal-50/50 to-transparent dark:from-teal-900/10">
          <CardContent className="p-3 space-y-1">
            <div className="flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-teal-600" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase">{t("dash.cdi")}</span>
            </div>
            <p className="text-lg font-bold" data-testid="quote-cdi">{selic ? `${(Number(selic.valor) * 0.9).toFixed(2)}%` : "—"}</p>
            <p className="text-[10px] text-muted-foreground">~90% Selic</p>
          </CardContent>
        </Card>
      </div>

      <p className="text-[10px] text-center text-muted-foreground pb-4">
        {t("dash.realTimeData")} • {format(now, "HH:mm", { locale })}
      </p>
    </div>
  );
}
