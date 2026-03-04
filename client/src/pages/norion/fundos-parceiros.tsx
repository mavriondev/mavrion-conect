import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useLocation, Link } from "wouter";
import {
  Handshake, Plus, Loader2, BarChart3, TrendingUp,
  Search, ChevronDown, ChevronUp, Send, Building2, Target,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function formatBRL(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 }).format(value);
}

function OperacoesMatchingSection() {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(true);
  const [matchingOpId, setMatchingOpId] = useState<number | null>(null);

  const { data: operations = [], isLoading: opsLoading } = useQuery<any[]>({
    queryKey: ["/api/norion/operations"],
  });

  const pendingOps = operations.filter((op: any) =>
    ["identificado", "diagnostico"].includes(op.stage)
  );

  const { data: matchResults, isLoading: matchLoading } = useQuery<any[]>({
    queryKey: ["/api/norion/operations", matchingOpId, "matching-fundos"],
    queryFn: async () => {
      const res = await fetch(`/api/norion/operations/${matchingOpId}/matching-fundos`);
      if (!res.ok) throw new Error("Erro ao buscar matching");
      return res.json();
    },
    enabled: !!matchingOpId,
  });

  const envioMutation = useMutation({
    mutationFn: async ({ opId, fundoId }: { opId: number; fundoId: number }) => {
      const res = await apiRequest("POST", `/api/norion/operations/${opId}/envios`, { fundoParceiroId: fundoId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/operations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/operations", matchingOpId, "matching-fundos"] });
      toast({ title: "Operação enviada ao fundo" });
    },
    onError: (err: any) => toast({ title: "Erro ao enviar", description: err.message, variant: "destructive" }),
  });

  if (opsLoading) return null;
  if (pendingOps.length === 0) return null;

  return (
    <Card className="border-amber-200/50 bg-amber-50/30 dark:bg-amber-950/10 dark:border-amber-800/30">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setExpanded(!expanded)} data-testid="toggle-matching-section">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-5 h-5 text-amber-600" />
            Operações Aguardando Crédito
            <Badge variant="secondary" className="ml-1 text-xs">{pendingOps.length}</Badge>
          </CardTitle>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-3 pt-0">
          {pendingOps.map((op: any) => {
            const isMatchOpen = matchingOpId === op.id;
            const diag = op.diagnostico || {};
            return (
              <div key={op.id} className="border rounded-lg bg-background" data-testid={`matching-op-${op.id}`}>
                <div className="p-3 flex items-center gap-3 flex-wrap">
                  <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{op.company?.legalName || op.company?.tradeName || "Empresa"}</p>
                    <div className="flex flex-wrap gap-2 mt-0.5">
                      {diag.valorSolicitado && <span className="text-xs text-muted-foreground">{formatBRL(diag.valorSolicitado)}</span>}
                      {diag.finalidade && <Badge variant="outline" className="text-[10px]">{diag.finalidade}</Badge>}
                      {(diag.garantias || []).map((g: string) => <Badge key={g} variant="secondary" className="text-[10px]">{g}</Badge>)}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {op.stage === "identificado" ? "Identificado" : "Diagnóstico"}
                  </Badge>
                  <Button
                    size="sm"
                    variant={isMatchOpen ? "secondary" : "default"}
                    className="text-xs h-7 shrink-0"
                    onClick={() => setMatchingOpId(isMatchOpen ? null : op.id)}
                    data-testid={`button-match-op-${op.id}`}
                  >
                    <Search className="w-3 h-3 mr-1" />
                    {isMatchOpen ? "Fechar" : "Buscar Fundos"}
                  </Button>
                </div>

                {isMatchOpen && (
                  <div className="border-t px-3 py-3 space-y-2 bg-muted/20">
                    {matchLoading ? (
                      <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                    ) : !matchResults || matchResults.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-3">Nenhum fundo compatível encontrado</p>
                    ) : (
                      matchResults.map((m: any) => (
                        <div key={m.fundo.id} className="flex items-center gap-3 p-2 rounded-md border bg-background" data-testid={`match-result-${m.fundo.id}`}>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{m.fundo.nome}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Progress value={m.score} className="h-1.5 flex-1 max-w-[100px]" />
                              <span className={cn("text-xs font-bold",
                                m.score >= 70 ? "text-green-600" : m.score >= 40 ? "text-amber-600" : "text-red-500"
                              )}>{m.score}%</span>
                            </div>
                            {m.reasons?.length > 0 && (
                              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{m.reasons.join(" · ")}</p>
                            )}
                          </div>
                          {m.fundo.categoria && <Badge variant="outline" className="text-[10px] shrink-0">{m.fundo.categoria}</Badge>}
                          <Button
                            size="sm"
                            className="text-xs h-7 shrink-0"
                            onClick={() => envioMutation.mutate({ opId: op.id, fundoId: m.fundo.id })}
                            disabled={envioMutation.isPending}
                            data-testid={`button-enviar-${m.fundo.id}`}
                          >
                            <Send className="w-3 h-3 mr-1" />
                            Enviar
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}

export default function NorionFundosParceirosPage() {
  const [search, setSearch] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: fundos = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/norion/fundos-parceiros"] });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { const res = await apiRequest("DELETE", `/api/norion/fundos-parceiros/${id}`); return res.json(); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/fundos-parceiros"] });
      toast({ title: "Fundo removido" });
    },
  });

  const filtered = (fundos as any[]).filter((f: any) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return f.nome?.toLowerCase().includes(q) || f.cnpj?.includes(q) || f.categoria?.toLowerCase().includes(q);
  });

  const ativos = (fundos as any[]).filter((f: any) => f.ativo !== false).length;

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Handshake className="w-7 h-7 text-amber-500" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-norion-fp-title">Fundos Parceiros</h1>
          <p className="text-sm text-muted-foreground">Gestão de fundos parceiros para envio de operações</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><CardContent className="p-4 text-center">
          <Handshake className="w-5 h-5 mx-auto mb-1.5 text-blue-600" />
          <p className="text-xl font-bold">{ativos}</p>
          <p className="text-xs text-muted-foreground">Fundos Ativos</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <BarChart3 className="w-5 h-5 mx-auto mb-1.5 text-emerald-600" />
          <p className="text-xl font-bold">{fundos.length}</p>
          <p className="text-xs text-muted-foreground">Total Fundos</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <TrendingUp className="w-5 h-5 mx-auto mb-1.5 text-amber-600" />
          <p className="text-xl font-bold">{(fundos as any[]).reduce((acc: number, f: any) => acc + ((f.tipoOperacao || []).length), 0)}</p>
          <p className="text-xs text-muted-foreground">Tipos Aceitos</p>
        </CardContent></Card>
      </div>

      <OperacoesMatchingSection />

      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar fundo..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-fp-search" />
        </div>
        <Link href="/norion-app/fundos-parceiros/novo">
          <Button data-testid="button-fp-new">
            <Plus className="w-4 h-4 mr-1.5" /> Cadastrar Fundo
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="text-center py-12 text-muted-foreground">
          <Handshake className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p>Nenhum fundo parceiro cadastrado</p>
        </CardContent></Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Tipos Aceitos</TableHead>
                <TableHead>Faixa de Valor</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((f: any) => (
                <TableRow key={f.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/norion-app/fundos-parceiros/${f.id}`)} data-testid={`row-fp-${f.id}`}>
                  <TableCell className="font-medium">{f.nome}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{f.categoria || "—"}</Badge></TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">{(f.tipoOperacao || []).map((t: string) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}</div>
                  </TableCell>
                  <TableCell className="text-sm">{f.valorMinimo || f.valorMaximo ? `${formatBRL(f.valorMinimo)} — ${formatBRL(f.valorMaximo)}` : "—"}</TableCell>
                  <TableCell className="text-sm">{f.contatoNome || f.contatoEmail || "—"}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={f.ativo !== false ? "default" : "secondary"} className="text-xs">{f.ativo !== false ? "Ativo" : "Inativo"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

    </div>
  );
}
