import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Loader2, CheckCircle2, XCircle, BarChart3,
  DollarSign, Clock, Percent,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Link } from "wouter";

function formatBRL(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 }).format(value);
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("pt-BR");
}

export default function FundoDetalhePage({ id }: { id: string }) {
  const { toast } = useToast();
  const fundoId = parseInt(id, 10);

  const { data: historico, isLoading } = useQuery<any>({
    queryKey: ["/api/norion/fundos-parceiros", fundoId, "historico"],
    queryFn: async () => {
      const res = await fetch(`/api/norion/fundos-parceiros/${fundoId}/historico`);
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
    enabled: !isNaN(fundoId),
  });

  const toggleMutation = useMutation({
    mutationFn: async (ativo: boolean) => {
      const res = await apiRequest("PATCH", `/api/norion/fundos-parceiros/${fundoId}`, { ativo });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/fundos-parceiros"] });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/fundos-parceiros", fundoId, "historico"] });
      toast({ title: "Status atualizado" });
    },
  });

  const fundo = historico?.fundo;
  const metricas = historico?.metricas;
  const envios = historico?.envios || [];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/fundos-parceiros">
          <Button variant="ghost" size="icon" data-testid="button-fundo-detalhe-voltar">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-fundo-detalhe-title">
            {fundo?.nome || "Fundo Parceiro"}
          </h1>
          <p className="text-sm text-muted-foreground">Detalhes e histórico do fundo</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : fundo && (
        <div className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              {fundo.categoria && <Badge variant="outline" className="text-xs">{fundo.categoria}</Badge>}
              <Badge variant={fundo.ativo !== false ? "default" : "secondary"} className="text-xs">
                {fundo.ativo !== false ? "Ativo" : "Inativo"}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Ativo</span>
              <Switch checked={fundo.ativo !== false} onCheckedChange={(v) => toggleMutation.mutate(v)} data-testid="switch-fp-ativo" />
            </div>
          </div>

          {fundo.cnpj && <p className="text-sm font-mono text-muted-foreground">{fundo.cnpj}</p>}

          {metricas && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              <Card><CardContent className="p-3 text-center">
                <BarChart3 className="w-4 h-4 mx-auto mb-1 text-blue-600" />
                <p className="text-lg font-bold">{metricas.totalEnvios}</p>
                <p className="text-[10px] text-muted-foreground">Total Envios</p>
              </CardContent></Card>
              <Card><CardContent className="p-3 text-center">
                <Percent className="w-4 h-4 mx-auto mb-1 text-green-600" />
                <p className="text-lg font-bold">{metricas.taxaAprovacao}%</p>
                <p className="text-[10px] text-muted-foreground">Taxa Aprovação</p>
              </CardContent></Card>
              <Card><CardContent className="p-3 text-center">
                <DollarSign className="w-4 h-4 mx-auto mb-1 text-emerald-600" />
                <p className="text-lg font-bold">{formatBRL(metricas.volumeAprovado)}</p>
                <p className="text-[10px] text-muted-foreground">Volume Aprovado</p>
              </CardContent></Card>
              <Card><CardContent className="p-3 text-center">
                <CheckCircle2 className="w-4 h-4 mx-auto mb-1 text-green-600" />
                <p className="text-lg font-bold">{metricas.aprovados}</p>
                <p className="text-[10px] text-muted-foreground">Aprovados</p>
              </CardContent></Card>
              <Card><CardContent className="p-3 text-center">
                <XCircle className="w-4 h-4 mx-auto mb-1 text-red-600" />
                <p className="text-lg font-bold">{metricas.recusados}</p>
                <p className="text-[10px] text-muted-foreground">Recusados</p>
              </CardContent></Card>
              <Card><CardContent className="p-3 text-center">
                <Clock className="w-4 h-4 mx-auto mb-1 text-amber-600" />
                <p className="text-lg font-bold">{metricas.tempoMedioResposta != null ? `${metricas.tempoMedioResposta}d` : "—"}</p>
                <p className="text-[10px] text-muted-foreground">Tempo Médio</p>
              </CardContent></Card>
            </div>
          )}

          <Separator />

          <Card>
            <CardContent className="p-4">
              <p className="text-sm font-medium mb-3">Critérios</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                <div><p className="text-xs text-muted-foreground">Tipos</p><p>{(fundo.tipoOperacao || []).join(", ") || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Garantias</p><p>{(fundo.garantiasAceitas || []).join(", ") || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Valor Mín</p><p>{formatBRL(fundo.valorMinimo)}</p></div>
                <div><p className="text-xs text-muted-foreground">Valor Máx</p><p>{formatBRL(fundo.valorMaximo)}</p></div>
                <div><p className="text-xs text-muted-foreground">Prazo Mín</p><p>{fundo.prazoMinimo || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Prazo Máx</p><p>{fundo.prazoMaximo || "—"}</p></div>
              </div>
            </CardContent>
          </Card>

          {(fundo.contatoNome || fundo.contatoEmail || fundo.contatoTelefone) && (
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium mb-2">Contato</p>
                <div className="text-sm space-y-1">
                  {fundo.contatoNome && <p>{fundo.contatoNome}</p>}
                  {fundo.contatoEmail && <p className="text-muted-foreground">{fundo.contatoEmail}</p>}
                  {fundo.contatoTelefone && <p className="text-muted-foreground">{fundo.contatoTelefone}</p>}
                </div>
              </CardContent>
            </Card>
          )}

          {envios.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium mb-3">Histórico de Envios</p>
                <div className="space-y-2">
                  {envios.map((e: any) => (
                    <div key={e.id} className="border rounded-md p-3 text-sm flex items-center justify-between gap-3" data-testid={`fp-envio-${e.id}`}>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{e.company?.legalName || e.company?.tradeName || "Operação"}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(e.dataEnvio)}</p>
                      </div>
                      <Badge variant="outline" className={cn("text-xs shrink-0",
                        e.status === "aprovado" ? "border-green-400 text-green-600" :
                        e.status === "recusado" ? "border-red-400 text-red-600" :
                        "border-blue-400 text-blue-600"
                      )}>
                        {e.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
