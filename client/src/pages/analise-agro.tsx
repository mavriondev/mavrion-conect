import { useState, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Sprout, Loader2, X, AlertTriangle, Mountain, MapPin, BarChart2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SoilGridsData {
  phh2o: number | null;
  clay: number | null;
  sand: number | null;
  soc: number | null;
  nitrogen: number | null;
  cec: number | null;
  wv0033: number | null;
  wv1500: number | null;
  soilClass: string | null;
}

interface ZarcData {
  cultura: string;
  aptidao: string | null;
  riscoCli: string | null;
  datasPlantio: string[];
}

interface EnriquecimentoAgro {
  solo: SoilGridsData | null;
  zarc: ZarcData[];
  cultivares: Array<{ cultura: string; cultivares: any[] }>;
  produtividade: Array<{ cultura: string; estimativa: number | null; unidade: string }>;
  parcelasSigef: Array<{ codigo: string; area: number; municipio: string; uf: string; situacao: string }>;
  scoreAgro: number;
  resumo: string;
}

export default function AnaliseAgroPage() {
  const { toast } = useToast();
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [cultura, setCultura] = useState("");
  const [result, setResult] = useState<EnriquecimentoAgro | null>(null);
  const [loading, setLoading] = useState(false);

  const executar = useCallback(async () => {
    const latN = parseFloat(lat);
    const lonN = parseFloat(lon);
    if (isNaN(latN) || isNaN(lonN)) {
      toast({ title: "Informe latitude e longitude válidas", variant: "destructive" });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await apiRequest('POST', '/api/geo/enriquecer-agro', {
        lat: latN,
        lon: lonN,
        codIBGE: undefined,
        cnpj: cnpj || undefined,
        culturaPrincipal: cultura || undefined,
      });
      const data = await res.json();
      if (data.success) {
        setResult(data.data);
        toast({ title: "Análise agro concluída!" });
      } else {
        toast({ title: "Erro na análise", description: data.error, variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Erro ao executar análise agro", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [lat, lon, cnpj, cultura, toast]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Sprout className="w-7 h-7 text-green-600" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Análise Agro</h1>
          <p className="text-sm text-muted-foreground">Solo, aptidão ZARC, produtividade e parcelas SIGEF — funciona independente do SICAR</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Latitude *</Label>
              <Input
                placeholder="-15.7942"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                data-testid="input-agro-lat"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Longitude *</Label>
              <Input
                placeholder="-47.8825"
                value={lon}
                onChange={(e) => setLon(e.target.value)}
                data-testid="input-agro-lon"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Cultura Principal</Label>
              <Select value={cultura} onValueChange={setCultura}>
                <SelectTrigger data-testid="select-agro-cultura">
                  <SelectValue placeholder="Selecionar..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="soja">Soja</SelectItem>
                  <SelectItem value="milho">Milho</SelectItem>
                  <SelectItem value="arroz">Arroz</SelectItem>
                  <SelectItem value="feijao">Feijão</SelectItem>
                  <SelectItem value="trigo">Trigo</SelectItem>
                  <SelectItem value="cafe">Café</SelectItem>
                  <SelectItem value="cana">Cana-de-açúcar</SelectItem>
                  <SelectItem value="algodao">Algodão</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">CNPJ (opcional — para SIGEF)</Label>
              <Input
                placeholder="00.000.000/0001-00"
                value={cnpj}
                onChange={(e) => setCnpj(e.target.value)}
                data-testid="input-agro-cnpj"
              />
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <Button
              onClick={executar}
              disabled={loading || !lat || !lon}
              data-testid="button-executar-agro"
            >
              {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Sprout className="w-4 h-4 mr-1.5" />}
              Analisar
            </Button>
            {result && (
              <Button variant="outline" onClick={() => setResult(null)} data-testid="button-limpar-agro">
                <X className="w-4 h-4 mr-1.5" /> Limpar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {loading && (
        <Card>
          <CardContent className="p-8 flex items-center justify-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-green-600" />
            <span className="text-muted-foreground">Consultando SoilGrids + Embrapa + SIGEF...</span>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className="border-green-200 dark:border-green-800">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold flex items-center gap-2">
                <Sprout className="w-5 h-5 text-green-600" /> Resultado da Análise
              </h4>
              <span className={cn("text-sm font-bold px-3 py-1 rounded-full",
                result.scoreAgro >= 70 ? 'bg-green-100 text-green-700' :
                result.scoreAgro >= 40 ? 'bg-yellow-100 text-yellow-700' :
                'bg-red-100 text-red-700'
              )} data-testid="badge-agro-score">
                Score Agro: {result.scoreAgro}/100
              </span>
            </div>

            <p className="text-sm text-muted-foreground italic bg-green-50 dark:bg-green-950/30 p-3 rounded-lg" data-testid="text-agro-resumo">
              {result.resumo}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {result.solo && (
                <Card>
                  <CardContent className="p-4">
                    <p className="font-medium text-sm mb-2 flex items-center gap-1.5">
                      <Mountain className="w-4 h-4 text-amber-600" /> Solo (SoilGrids)
                    </p>
                    <div className="space-y-1.5 text-sm">
                      {result.solo.phh2o !== null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">pH</span>
                          <span className="font-medium" data-testid="agro-solo-ph">{result.solo.phh2o}</span>
                        </div>
                      )}
                      {result.solo.clay !== null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Argila</span>
                          <span className="font-medium" data-testid="agro-solo-argila">{result.solo.clay}%</span>
                        </div>
                      )}
                      {result.solo.sand !== null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Areia</span>
                          <span className="font-medium">{result.solo.sand}%</span>
                        </div>
                      )}
                      {result.solo.soc !== null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">C. Orgânico</span>
                          <span className="font-medium">{result.solo.soc} g/kg</span>
                        </div>
                      )}
                      {result.solo.nitrogen !== null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Nitrogênio</span>
                          <span className="font-medium">{result.solo.nitrogen} g/kg</span>
                        </div>
                      )}
                      {result.solo.cec !== null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">CTC</span>
                          <span className="font-medium">{result.solo.cec}</span>
                        </div>
                      )}
                      {result.solo.wv0033 !== null && result.solo.wv1500 !== null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Água Disponível</span>
                          <span className="font-medium">{(result.solo.wv0033 - result.solo.wv1500).toFixed(1)}%</span>
                        </div>
                      )}
                      {result.solo.soilClass && (
                        <div className="pt-1 border-t">
                          <span className="text-xs text-muted-foreground" data-testid="agro-solo-classe">{result.solo.soilClass}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {result.zarc.length > 0 && (
                <Card>
                  <CardContent className="p-4">
                    <p className="font-medium text-sm mb-2 flex items-center gap-1.5">
                      <Sprout className="w-4 h-4 text-green-600" /> ZARC — Aptidão
                    </p>
                    <div className="space-y-1.5">
                      {result.zarc.map((z, i) => (
                        <div key={i} className="flex items-center justify-between text-sm" data-testid={`agro-zarc-${i}`}>
                          <span className="capitalize">{z.cultura}</span>
                          <Badge variant="outline" className={cn("text-xs",
                            z.aptidao === 'Apto' ? 'border-green-300 text-green-700' :
                            z.aptidao === 'Inapto' ? 'border-red-300 text-red-700' :
                            'border-yellow-300 text-yellow-700'
                          )}>
                            {z.aptidao || 'N/D'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {result.produtividade.filter(p => p.estimativa).length > 0 && (
                <Card>
                  <CardContent className="p-4">
                    <p className="font-medium text-sm mb-2 flex items-center gap-1.5">
                      <BarChart2 className="w-4 h-4 text-blue-600" /> Produtividade
                    </p>
                    <div className="space-y-1.5">
                      {result.produtividade.filter(p => p.estimativa).map((p, i) => (
                        <div key={i} className="flex items-center justify-between text-sm" data-testid={`agro-prod-${i}`}>
                          <span className="capitalize">{p.cultura}</span>
                          <span className="font-medium">{p.estimativa} {p.unidade}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {result.parcelasSigef.length > 0 && (
                <Card className="md:col-span-2 lg:col-span-3">
                  <CardContent className="p-4">
                    <p className="font-medium text-sm mb-2 flex items-center gap-1.5">
                      <MapPin className="w-4 h-4 text-purple-600" /> Parcelas SIGEF/INCRA
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Código</TableHead>
                          <TableHead className="text-xs">Município/UF</TableHead>
                          <TableHead className="text-xs text-right">Área (ha)</TableHead>
                          <TableHead className="text-xs">Situação</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.parcelasSigef.map((p, i) => (
                          <TableRow key={i} data-testid={`agro-sigef-row-${i}`}>
                            <TableCell className="font-mono text-xs">{p.codigo}</TableCell>
                            <TableCell className="text-xs">{p.municipio}/{p.uf}</TableCell>
                            <TableCell className="text-xs text-right">{p.area.toFixed(1)}</TableCell>
                            <TableCell><Badge variant="secondary" className="text-xs">{p.situacao}</Badge></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>

            {!result.solo && result.zarc.length === 0 && result.parcelasSigef.length === 0 && (
              <div className="text-center py-6 text-muted-foreground">
                <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-amber-500" />
                <p className="text-sm">Nenhum dado disponível para estas coordenadas.</p>
                <p className="text-xs">Verifique se as coordenadas estão em território brasileiro.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}