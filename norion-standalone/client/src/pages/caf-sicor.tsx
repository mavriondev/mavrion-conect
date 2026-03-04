import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ArrowLeft, Database, Search, MapPin, TrendingUp, FileText, Loader2, AlertTriangle,
} from "lucide-react";

const UF_LIST = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA",
  "PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export default function CafSicorPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [uf, setUf] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [ano, setAno] = useState("2024");
  const [tipo, setTipo] = useState("custeio");
  const [consultaAtiva, setConsultaAtiva] = useState(false);

  const queryParams = new URLSearchParams();
  if (uf) queryParams.set("uf", uf);
  if (municipio.trim()) queryParams.set("municipio", municipio.trim());
  if (ano) queryParams.set("ano", ano);
  queryParams.set("tipo", tipo);
  queryParams.set("top", "100");
  const queryPath = `/api/norion/sicor/consulta?${queryParams.toString()}`;

  const { data: resultado, isLoading, isError, refetch } = useQuery<any>({
    queryKey: ["/api/norion/sicor/consulta", uf, municipio, ano, tipo],
    queryFn: async () => {
      const res = await fetch(queryPath, { credentials: "include" });
      if (!res.ok) throw new Error("Falha na consulta SICOR");
      return res.json();
    },
    enabled: consultaAtiva && uf.length === 2,
    retry: 1,
    staleTime: 60 * 60 * 1000,
  });

  function handleConsultar() {
    if (!uf) {
      toast({ title: "Selecione um estado (UF)", variant: "destructive" });
      return;
    }
    setConsultaAtiva(true);
    refetch();
  }

  const anoOptions = [];
  for (let y = 2024; y >= 2013; y--) anoOptions.push(String(y));

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/caf")} data-testid="button-voltar-caf">
          <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
        </Button>
        <div className="p-2 bg-blue-100 rounded-lg">
          <Database className="w-6 h-6 text-blue-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold" data-testid="title-caf-sicor">SICOR / BCB — Crédito Rural PRONAF</h1>
          <p className="text-sm text-muted-foreground">Dados oficiais do Sistema de Operações do Crédito Rural do Banco Central</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtros de Consulta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Estado (UF) *</Label>
              <Select value={uf} onValueChange={setUf}>
                <SelectTrigger className="w-[100px]" data-testid="sicor-filter-uf"><SelectValue placeholder="UF" /></SelectTrigger>
                <SelectContent>
                  {UF_LIST.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Município</Label>
              <Input className="w-[180px]" placeholder="Ex: Uberaba" value={municipio} onChange={(e) => setMunicipio(e.target.value)} data-testid="sicor-filter-municipio" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ano</Label>
              <Select value={ano} onValueChange={setAno}>
                <SelectTrigger className="w-[100px]" data-testid="sicor-filter-ano"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {anoOptions.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger className="w-[140px]" data-testid="sicor-filter-tipo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="custeio">Custeio</SelectItem>
                  <SelectItem value="investimento">Investimento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleConsultar} disabled={isLoading} data-testid="button-consultar-sicor">
              {isLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
              Consultar
            </Button>
          </div>

          {isError && (
            <div className="border border-red-200 bg-red-50 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2" data-testid="sicor-error">
              <AlertTriangle className="w-4 h-4" />
              A API do Banco Central pode estar instável. Tente novamente em alguns segundos.
            </div>
          )}

          {isLoading && (
            <div className="space-y-3" data-testid="sicor-loading">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[0,1,2,3].map(i => (
                  <div key={i} className="border rounded-lg p-3 animate-pulse">
                    <div className="h-3 w-20 bg-muted rounded mb-2" />
                    <div className="h-6 w-24 bg-muted rounded" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {resultado && !isLoading && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground">Total Contratos</div>
                  <div className="text-xl font-bold" data-testid="sicor-total-registros">
                    {(resultado.totalContratos || resultado.totalRegistros).toLocaleString("pt-BR")}
                  </div>
                </div>
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground">Volume Total</div>
                  <div className="text-xl font-bold text-green-600" data-testid="sicor-total-valor">{formatCurrency(resultado.totalValor)}</div>
                </div>
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground">Área Total</div>
                  <div className="text-xl font-bold">{resultado.totalArea.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} ha</div>
                </div>
                <div className="border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground">Tipo</div>
                  <div className="text-xl font-bold">{resultado.tipo}</div>
                </div>
              </div>

              {resultado.topMunicipios?.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-blue-500" /> Top Municípios
                    </h4>
                    <div className="space-y-1.5">
                      {resultado.topMunicipios.map((m: any, i: number) => (
                        <div key={m.nome} className="flex items-center justify-between border rounded px-2.5 py-1.5 text-xs" data-testid={`sicor-municipio-${i}`}>
                          <span className="font-medium">{i + 1}. {m.nome}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground">{(m.contratos || m.count).toLocaleString("pt-BR")} contr.</span>
                            <span className="font-semibold text-green-600">{formatCurrency(m.valor)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-amber-500" /> Top Produtos
                    </h4>
                    <div className="space-y-1.5">
                      {resultado.topProdutos?.map((p: any, i: number) => (
                        <div key={p.nome} className="flex items-center justify-between border rounded px-2.5 py-1.5 text-xs" data-testid={`sicor-produto-${i}`}>
                          <span className="font-medium truncate max-w-[180px]">{i + 1}. {p.nome}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground">{(p.contratos || p.count).toLocaleString("pt-BR")} contr.</span>
                            <span className="font-semibold text-green-600">{formatCurrency(p.valor)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {resultado.registros?.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" /> Detalhamento dos Contratos
                    <Badge variant="outline" className="text-xs">{resultado.registros.length}</Badge>
                  </h4>
                  <div className="max-h-[400px] overflow-auto border rounded">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">{resultado.nivelConsulta === "municipio" ? "Município" : "UF"}</TableHead>
                          <TableHead className="text-xs">Produto</TableHead>
                          <TableHead className="text-xs">Atividade</TableHead>
                          <TableHead className="text-xs">Mês/Ano</TableHead>
                          <TableHead className="text-xs text-right">Contratos</TableHead>
                          <TableHead className="text-xs text-right">Valor (R$)</TableHead>
                          <TableHead className="text-xs text-right">Área (ha)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {resultado.registros.map((r: any, i: number) => (
                          <TableRow key={i} data-testid={`sicor-row-${i}`}>
                            <TableCell className="text-xs">{r.municipio}</TableCell>
                            <TableCell className="text-xs max-w-[200px] truncate">{r.produto}</TableCell>
                            <TableCell className="text-xs">
                              <Badge variant="outline" className="text-[10px]">{r.atividade}</Badge>
                            </TableCell>
                            <TableCell className="text-xs">{r.mesEmissao}/{r.anoEmissao}</TableCell>
                            <TableCell className="text-xs text-right">{(r.qtdContratos || 1).toLocaleString("pt-BR")}</TableCell>
                            <TableCell className="text-xs text-right font-medium">{formatCurrency(r.valor)}</TableCell>
                            <TableCell className="text-xs text-right">{r.area > 0 ? r.area.toLocaleString("pt-BR") : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          )}

          {!consultaAtiva && !resultado && (
            <div className="text-center py-8 text-sm text-muted-foreground border rounded-lg bg-slate-50/50">
              <Database className="w-8 h-8 mx-auto mb-2 text-blue-300" />
              <p>Selecione os filtros e clique em "Consultar" para buscar dados de crédito rural PRONAF</p>
              <p className="text-xs mt-1">Fonte: SICOR — Banco Central do Brasil</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
