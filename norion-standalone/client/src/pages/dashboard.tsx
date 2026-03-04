import { useQuery } from "@tanstack/react-query";
import {
  DollarSign, TrendingUp, Percent, BarChart3,
  BadgeDollarSign, Search, FileSearch, Send, Clock,
  CheckCircle2, Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STAGES = [
  { key: "identificado", label: "Identificado", icon: Search, color: "bg-slate-100 dark:bg-slate-800 border-slate-300" },
  { key: "diagnostico", label: "Diagnóstico", icon: FileSearch, color: "bg-blue-50 dark:bg-blue-950 border-blue-300" },
  { key: "enviado_fundos", label: "Enviado aos Fundos", icon: Send, color: "bg-indigo-50 dark:bg-indigo-950 border-indigo-300" },
  { key: "em_analise", label: "Em Análise", icon: Clock, color: "bg-amber-50 dark:bg-amber-950 border-amber-300" },
  { key: "aprovado", label: "Aprovado", icon: CheckCircle2, color: "bg-green-50 dark:bg-green-950 border-green-300" },
  { key: "comissao_gerada", label: "Comissão Gerada", icon: BadgeDollarSign, color: "bg-emerald-50 dark:bg-emerald-950 border-emerald-300" },
];

function formatBRL(value: number | null | undefined) {
  if (value == null) return "R$ 0";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 }).format(value);
}

export default function NorionDashboardPage() {
  const { data: dashboard, isLoading } = useQuery<any>({ queryKey: ["/api/norion/dashboard"] });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const d = dashboard || {};

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <DollarSign className="w-7 h-7 text-amber-500" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-norion-dashboard-title">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Visão geral das operações financeiras</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card data-testid="card-n-total-operacoes">
          <CardContent className="p-4 text-center">
            <BarChart3 className="w-6 h-6 mx-auto mb-2 text-blue-600" />
            <p className="text-2xl font-bold">{d.totalOperacoes || 0}</p>
            <p className="text-xs text-muted-foreground">Total Operações</p>
          </CardContent>
        </Card>
        <Card data-testid="card-n-volume-aprovado">
          <CardContent className="p-4 text-center">
            <DollarSign className="w-6 h-6 mx-auto mb-2 text-green-600" />
            <p className="text-2xl font-bold">{formatBRL(d.volumeAprovado)}</p>
            <p className="text-xs text-muted-foreground">Volume Aprovado</p>
          </CardContent>
        </Card>
        <Card data-testid="card-n-comissao-total">
          <CardContent className="p-4 text-center">
            <TrendingUp className="w-6 h-6 mx-auto mb-2 text-emerald-600" />
            <p className="text-2xl font-bold">{formatBRL(d.comissaoTotal)}</p>
            <p className="text-xs text-muted-foreground">Comissão Gerada</p>
          </CardContent>
        </Card>
        <Card data-testid="card-n-comissao-apagar">
          <CardContent className="p-4 text-center">
            <BadgeDollarSign className="w-6 h-6 mx-auto mb-2 text-amber-600" />
            <p className="text-2xl font-bold">{formatBRL(d.comissaoAPagar)}</p>
            <p className="text-xs text-muted-foreground">Comissão a Receber</p>
          </CardContent>
        </Card>
        <Card data-testid="card-n-taxa-aprovacao">
          <CardContent className="p-4 text-center">
            <Percent className="w-6 h-6 mx-auto mb-2 text-purple-600" />
            <p className="text-2xl font-bold">{d.taxaAprovacao || 0}%</p>
            <p className="text-xs text-muted-foreground">Taxa de Aprovação</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Operações por Etapa</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {STAGES.map((s) => {
              const count = d.porEtapa?.[s.key] || 0;
              const Icon = s.icon;
              return (
                <div key={s.key} className={cn("rounded-lg border p-3 text-center", s.color)} data-testid={`n-stage-count-${s.key}`}>
                  <Icon className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-xl font-bold">{count}</p>
                  <p className="text-[11px] text-muted-foreground leading-tight">{s.label}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
