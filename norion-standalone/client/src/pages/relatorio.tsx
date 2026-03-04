import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  DollarSign, TrendingUp, BarChart3, BadgeDollarSign,
  CheckCircle2, Loader2, Download,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function formatBRL(value: number | null | undefined) {
  if (value == null) return "R$ 0";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 }).format(value);
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("pt-BR");
}

export default function NorionRelatorioPage() {
  const { toast } = useToast();
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [relatorio, setRelatorio] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const gerarRelatorio = async () => {
    setLoading(true); setRelatorio(null);
    try {
      const params = new URLSearchParams();
      if (de) params.set("de", de);
      if (ate) params.set("ate", ate);
      const res = await fetch(`/api/norion/relatorio-comissoes?${params.toString()}`);
      if (!res.ok) { toast({ title: "Erro ao gerar relatório", variant: "destructive" }); return; }
      setRelatorio(await res.json());
    } catch { toast({ title: "Erro ao gerar relatório", variant: "destructive" }); } finally { setLoading(false); }
  };

  const exportarCSV = () => {
    if (!relatorio?.linhas?.length) return;
    const headers = ["Empresa", "CNPJ", "Valor Aprovado", "% Comissão", "Valor Comissão", "Status", "Data Operação", "Data Recebimento"];
    const rows = relatorio.linhas.map((l: any) => [
      l.empresa, l.cnpj, l.valorAprovado, l.percentualComissao, l.valorComissao,
      l.comissaoRecebida ? "Recebida" : "Pendente",
      l.dataOperacao ? new Date(l.dataOperacao).toLocaleDateString("pt-BR") : "—",
      l.dataRecebimento ? new Date(l.dataRecebimento).toLocaleDateString("pt-BR") : "—",
    ]);
    const csv = [headers.join(";"), ...rows.map((r: any[]) => r.join(";"))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `relatorio-comissoes-norion-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="w-7 h-7 text-amber-500" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-norion-relatorio-title">Relatório de Comissões</h1>
          <p className="text-sm text-muted-foreground">Análise de comissões das operações aprovadas</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Filtros</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div><Label className="text-xs">De</Label><Input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-40" data-testid="input-n-rel-de" /></div>
            <div><Label className="text-xs">Até</Label><Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-40" data-testid="input-n-rel-ate" /></div>
            <Button onClick={gerarRelatorio} disabled={loading} data-testid="button-n-gerar-relatorio">
              {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <BarChart3 className="w-4 h-4 mr-1.5" />}Gerar Relatório
            </Button>
            {relatorio?.linhas?.length > 0 && (
              <Button variant="outline" onClick={exportarCSV} data-testid="button-n-exportar-csv"><Download className="w-4 h-4 mr-1.5" />Exportar CSV</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {loading && <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}

      {relatorio && !loading && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <Card><CardContent className="p-4 text-center"><BarChart3 className="w-5 h-5 mx-auto mb-1.5 text-blue-600" /><p className="text-xl font-bold">{relatorio.totalOperacoes}</p><p className="text-xs text-muted-foreground">Total Operações</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><DollarSign className="w-5 h-5 mx-auto mb-1.5 text-green-600" /><p className="text-xl font-bold">{formatBRL(relatorio.volumeAprovado)}</p><p className="text-xs text-muted-foreground">Volume Aprovado</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><TrendingUp className="w-5 h-5 mx-auto mb-1.5 text-emerald-600" /><p className="text-xl font-bold">{formatBRL(relatorio.comissaoTotal)}</p><p className="text-xs text-muted-foreground">Comissão Total</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><CheckCircle2 className="w-5 h-5 mx-auto mb-1.5 text-green-600" /><p className="text-xl font-bold">{formatBRL(relatorio.comissaoRecebida)}</p><p className="text-xs text-muted-foreground">Comissão Recebida</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><BadgeDollarSign className="w-5 h-5 mx-auto mb-1.5 text-amber-600" /><p className="text-xl font-bold">{formatBRL(relatorio.comissaoAPagar)}</p><p className="text-xs text-muted-foreground">Comissão a Receber</p></CardContent></Card>
          </div>
          {relatorio.linhas.length > 0 ? (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead>CNPJ</TableHead>
                    <TableHead className="text-right">Valor Aprovado</TableHead>
                    <TableHead className="text-center">% Comissão</TableHead>
                    <TableHead className="text-right">Valor Comissão</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead>Data Operação</TableHead>
                    <TableHead>Data Recebimento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {relatorio.linhas.map((l: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{l.empresa}</TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono">{l.cnpj}</TableCell>
                      <TableCell className="text-right">{formatBRL(l.valorAprovado)}</TableCell>
                      <TableCell className="text-center">{l.percentualComissao}%</TableCell>
                      <TableCell className="text-right font-medium">{formatBRL(l.valorComissao)}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={cn("text-xs", l.comissaoRecebida ? "bg-green-50 text-green-700 border-green-300" : "bg-amber-50 text-amber-700 border-amber-300")}>
                          {l.comissaoRecebida ? "Recebida" : "Pendente"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{formatDate(l.dataOperacao)}</TableCell>
                      <TableCell className="text-sm">{formatDate(l.dataRecebimento)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ) : (
            <Card><CardContent className="text-center py-8 text-muted-foreground">Nenhuma operação aprovada no período</CardContent></Card>
          )}
        </>
      )}

      {!relatorio && !loading && (
        <Card><CardContent className="text-center py-12 text-muted-foreground"><BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-20" /><p>Clique em "Gerar Relatório" para visualizar as comissões</p></CardContent></Card>
      )}
    </div>
  );
}
