import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { StatCard } from "@/components/stat-card";
import {
  Magnet, Briefcase, Layers, Zap, Building2, ArrowRight, CalendarDays,
  TreePine, Pickaxe, Home, Factory, Wheat, DollarSign, Target, TrendingUp,
  BarChart3, AlertTriangle, Clock,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function buildWeeklyData(items: any[], dateField = "createdAt") {
  const today = new Date();
  const data = DIAS_SEMANA.map((name, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    const dateStr = d.toISOString().slice(0, 10);
    return { name, value: 0, date: dateStr };
  });
  for (const item of items) {
    if (!item[dateField]) continue;
    const itemDate = new Date(item[dateField]).toISOString().slice(0, 10);
    const entry = data.find(d => d.date === itemDate);
    if (entry) entry.value++;
  }
  return data;
}

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "bg-red-500", high: "bg-amber-500", medium: "bg-blue-500", low: "bg-slate-400",
};

const PRIORITY_CHART_COLOR: Record<string, string> = {
  urgent: "#ef4444", high: "#f59e0b", medium: "#3b82f6", low: "#94a3b8",
};

const PRIORITY_LABEL: Record<string, string> = {
  urgent: "Urgente", high: "Alta", medium: "Média", low: "Baixa",
};

const TIPO_ATIVO: Record<string, { label: string; color: string }> = {
  TERRA:           { label: "Terras",    color: "text-green-600 bg-green-50 dark:bg-green-900/20" },
  MINA:            { label: "Mineração", color: "text-orange-600 bg-orange-50 dark:bg-orange-900/20" },
  NEGOCIO:         { label: "M&A",       color: "text-blue-600 bg-blue-50 dark:bg-blue-900/20" },
  FII_CRI:         { label: "FII/CRI",   color: "text-purple-600 bg-purple-50 dark:bg-purple-900/20" },
  DESENVOLVIMENTO: { label: "Desenv.",   color: "text-pink-600 bg-pink-50 dark:bg-pink-900/20" },
  AGRO:            { label: "Agro",      color: "text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20" },
};

function formatBRL(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(0)}K`;
  return `R$ ${value.toFixed(0)}`;
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/stats/dashboard"],
    queryFn: () => apiRequest("GET", "/api/stats/dashboard").then(r => {
      if (!r.ok) throw new Error("Falha ao carregar estatísticas");
      return r.json();
    }),
    retry: 1,
  });

  const { data: recentDeals = [] } = useQuery({
    queryKey: ["/api/crm/deals"],
    queryFn: () => apiRequest("GET", "/api/crm/deals").then(r => r.json()),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["/api/crm/companies"],
    queryFn: () => apiRequest("GET", "/api/crm/companies").then(r => r.json()),
  });

  const { data: assets = [] } = useQuery({
    queryKey: ["/api/matching/assets"],
    queryFn: () => apiRequest("GET", "/api/matching/assets").then(r => r.json()),
  });

  const weeklyDeals = buildWeeklyData(recentDeals as any[], "createdAt");
  const weeklyCompanies = buildWeeklyData(companies as any[], "createdAt");

  const latestDeals = [...(recentDeals as any[])]
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    .slice(0, 6);

  const latestCompanies = [...(companies as any[])]
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    .slice(0, 5);

  const assetCounts = (assets as any[]).reduce((acc: any, a: any) => {
    acc[a.type] = (acc[a.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const ruralCount = (assets as any[]).filter((a: any) => {
    const attrs = a.attributesJson as Record<string, any> | null;
    return attrs?.carCodImovel;
  }).length;

  const priorityData = stats?.dealsPorPrioridade
    ? Object.entries(stats.dealsPorPrioridade)
        .filter(([, v]) => (v as number) > 0)
        .map(([key, value]) => ({
          name: PRIORITY_LABEL[key] || key,
          value: value as number,
          fill: PRIORITY_CHART_COLOR[key] || "#94a3b8",
        }))
    : [];

  if (statsLoading) {
    return (
      <div className="p-4 md:p-8 space-y-6 animate-pulse">
        <div className="h-10 w-64 bg-muted rounded-lg" />
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-muted rounded-xl" />)}
        </div>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-muted rounded-xl" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-64 bg-muted rounded-xl" />
          <div className="h-64 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  const leadsTrend = stats?.crescimentoLeads ?? 0;
  const leadsTrendStr = leadsTrend > 0 ? `+${leadsTrend}%` : `${leadsTrend}%`;

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl md:text-3xl font-display font-bold" data-testid="text-dashboard-title">Visão Geral</h1>
        <p className="text-sm text-muted-foreground flex items-center gap-1.5">
          <CalendarDays className="w-3.5 h-3.5" />
          {format(new Date(), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
        </p>
      </div>

      {(stats?.dealsVencidos > 0 || stats?.dealsVencendo > 0) && (
        <div className="space-y-2" data-testid="alerts-section">
          {stats.dealsVencidos > 0 && (
            <Link href="/crm">
              <div className="flex items-center gap-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-4 py-3 cursor-pointer hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors" data-testid="alert-deals-vencidos">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
                <span className="text-sm font-medium text-red-800 dark:text-red-300">
                  {stats.dealsVencidos} deal{stats.dealsVencidos > 1 ? "s" : ""} com prazo vencido
                </span>
                <ArrowRight className="w-4 h-4 text-red-400 ml-auto" />
              </div>
            </Link>
          )}
          {stats.dealsVencendo > 0 && (
            <Link href="/crm">
              <div className="flex items-center gap-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors" data-testid="alert-deals-vencendo">
                <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  {stats.dealsVencendo} deal{stats.dealsVencendo > 1 ? "s" : ""} vencendo em 7 dias
                </span>
                <ArrowRight className="w-4 h-4 text-amber-400 ml-auto" />
              </div>
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Valor do Pipeline"
          value={formatBRL(stats?.pipelineValue ?? 0)}
          icon={DollarSign}
          index={0}
          data-testid="stat-pipeline-value"
        />
        <StatCard
          title="Forecast (Ponderado)"
          value={formatBRL(stats?.forecastValue ?? 0)}
          icon={TrendingUp}
          index={1}
          data-testid="stat-forecast"
        />
        <StatCard
          title="Conversão Lead → Deal"
          value={`${stats?.conversionRate ?? 0}%`}
          icon={Target}
          index={2}
          data-testid="stat-conversion"
        />
        <StatCard
          title="Ticket Médio"
          value={formatBRL(stats?.avgTicket ?? 0)}
          icon={BarChart3}
          index={3}
          data-testid="stat-avg-ticket"
        />
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Leads Ativos"
          value={stats?.leadsCount ?? 0}
          icon={Magnet}
          trend={leadsTrend !== 0 ? leadsTrendStr : undefined}
          trendUp={leadsTrend > 0}
          index={4}
          data-testid="stat-leads"
        />
        <StatCard
          title="Deals em Andamento"
          value={stats?.activeDealsCount ?? 0}
          icon={Briefcase}
          index={5}
          data-testid="stat-deals"
        />
        <StatCard
          title="Ativos no Portfólio"
          value={stats?.assetsCount ?? 0}
          icon={Layers}
          index={6}
          data-testid="stat-assets"
        />
        <StatCard
          title="Matches Sugeridos"
          value={stats?.matchesCount ?? 0}
          icon={Zap}
          index={7}
          data-testid="stat-matches"
        />
        <Link href="/geo-rural">
          <StatCard
            title="Oport. Rurais (CAR)"
            value={ruralCount}
            icon={TreePine}
            index={8}
            data-testid="stat-rural"
          />
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="col-span-full lg:col-span-4 border-border/50 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Empresas Importadas — Últimos 7 dias</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weeklyCompanies}>
                  <defs>
                    <linearGradient id="colorEmpresas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                    formatter={(v: any) => [v, "Empresas"]}
                  />
                  <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#colorEmpresas)" dot={{ fill: "hsl(var(--primary))", r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-full lg:col-span-3 border-border/50 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Deals por Prioridade</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]" data-testid="chart-priority">
              {priorityData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={priorityData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} width={60} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                      formatter={(v: any) => [v, "Deals"]}
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {priorityData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  Nenhum deal cadastrado ainda.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="col-span-full lg:col-span-4 border-border/50 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Deals Criados — Últimos 7 dias</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyDeals}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                    contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                    formatter={(v: any) => [v, "Deals"]}
                  />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-full lg:col-span-3 border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-semibold">Últimas Empresas Importadas</CardTitle>
            <Link href="/empresas" className="text-xs text-primary hover:underline flex items-center gap-1">
              Ver todas <ArrowRight className="w-3 h-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-1">
            {latestCompanies.length === 0
              ? <p className="text-xs text-muted-foreground text-center py-6">Nenhuma empresa importada ainda.</p>
              : latestCompanies.map((co: any) => (
                <Link key={co.id} href={`/empresas/${co.id}`}
                  className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-muted/50 transition-colors block">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{co.tradeName || co.legalName}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {co.cnpj ? `CNPJ ${co.cnpj}` : "Sem CNPJ"}
                      {co.address?.municipio ? ` — ${co.address.municipio}/${co.address.uf || "?"}` : ""}
                    </p>
                  </div>
                  {co.porte && <Badge variant="outline" className="text-[10px] h-4 px-1.5 shrink-0">{co.porte}</Badge>}
                </Link>
              ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-semibold">Deals Recentes</CardTitle>
            <Link href="/crm" className="text-xs text-primary hover:underline flex items-center gap-1">
              Ver todos <ArrowRight className="w-3 h-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-1">
            {latestDeals.length === 0
              ? <p className="text-xs text-muted-foreground text-center py-6">Nenhum deal cadastrado ainda.</p>
              : latestDeals.map((deal: any) => (
                <div key={deal.id} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-muted/50 transition-colors" data-testid={`row-deal-${deal.id}`}>
                  <div className={cn("w-2 h-2 rounded-full shrink-0", PRIORITY_COLOR[deal.priority || "medium"])} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{deal.title}</p>
                    {deal.company && (
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                        <Building2 className="w-2.5 h-2.5" />
                        {deal.company.tradeName || deal.company.legalName}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5 shrink-0">
                    {deal.pipelineType === "INVESTOR" ? "Investidor" : "Ativo"}
                  </Badge>
                </div>
              ))}
          </CardContent>
        </Card>

        {Object.keys(assetCounts).length > 0 && (
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm font-semibold">Portfólio de Ativos por Tipo</CardTitle>
              <Link href="/ativos" className="text-xs text-primary hover:underline flex items-center gap-1">
                Gerenciar <ArrowRight className="w-3 h-3" />
              </Link>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 sm:grid-cols-3 gap-3">
                {Object.entries(assetCounts).map(([type, cnt]: [string, any]) => {
                  const cfg = TIPO_ATIVO[type] || { label: type, color: "text-muted-foreground bg-muted" };
                  return (
                    <Link key={type} href={`/ativos/tipo/${type}`}>
                      <div className={cn("rounded-xl p-3 text-center cursor-pointer hover:opacity-80 transition-opacity", cfg.color)} data-testid={`asset-type-${type}`}>
                        <p className="text-2xl font-bold">{cnt}</p>
                        <p className="text-xs font-medium mt-0.5">{cfg.label}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
