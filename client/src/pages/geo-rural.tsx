import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Search, Loader2, X, Mountain, Droplets, Zap as ZapIcon,
  ChevronLeft, ChevronRight, Map as MapIcon, Check, ExternalLink,
  Briefcase, TreePine, Download, BarChart2, Gauge, Ruler,
  MapPin, Eye, AlertTriangle, RefreshCcw, Wifi, WifiOff, Activity,
  ArrowUpDown, Save, TrendingUp, Play, Filter, Trophy, Sprout,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const ESTADOS = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
  "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

const PAGE_SIZE = 20;

const SHORTCUTS = [
  { id: "grande", label: "Fazendas Grandes", desc: "> 500 ha", icon: Ruler, color: "text-green-600 bg-green-50 border-green-200", filters: { areaMin: "500" } },
  { id: "media", label: "Fazendas Médias", desc: "100–500 ha", icon: TreePine, color: "text-emerald-600 bg-emerald-50 border-emerald-200", filters: { areaMin: "100", areaMax: "500" } },
  { id: "pequena", label: "Fazendas Pequenas", desc: "< 100 ha", icon: MapPin, color: "text-amber-600 bg-amber-50 border-amber-200", filters: { areaMax: "100" } },
];

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

function LeafletMap({
  features,
  analysisLayers,
  selectedFeature,
  onSelectFeature,
  onMapClick,
}: {
  features: any[];
  analysisLayers?: { rios?: any; massas?: any; energia?: any };
  selectedFeature?: any;
  onSelectFeature?: (f: any) => void;
  onMapClick?: (lat: number, lon: number) => void;
}) {
  const mapRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    let L: any;
    const init = async () => {
      L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");

      if (cancelled || !containerRef.current) return;

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const map = L.map(containerRef.current, {
        center: [-15.8, -47.9],
        zoom: 5,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 18,
      }).addTo(map);

      mapRef.current = map;

      if (onMapClick) {
        map.on('click', (e: any) => {
          onMapClick(e.latlng.lat, e.latlng.lng);
        });
      }

      if (analysisLayers?.rios?.features?.length > 0) {
        L.geoJSON(analysisLayers.rios, {
          style: { color: "#3b82f6", weight: 2, opacity: 0.8 },
        }).addTo(map);
      }
      if (analysisLayers?.massas?.features?.length > 0) {
        L.geoJSON(analysisLayers.massas, {
          style: { color: "#2563eb", weight: 1, fillColor: "#93c5fd", fillOpacity: 0.4 },
        }).addTo(map);
      }
      if (analysisLayers?.energia?.features?.length > 0) {
        L.geoJSON(analysisLayers.energia, {
          style: { color: "#f59e0b", weight: 2, opacity: 0.8, dashArray: "5,5" },
        }).addTo(map);
      }

      const bounds: any[] = [];
      const fg = L.featureGroup();

      features.forEach((f: any) => {
        if (!f.geometry) return;
        const isSelected = selectedFeature && f.id === selectedFeature.id;
        const layer = L.geoJSON(f, {
          style: {
            color: isSelected ? "#ef4444" : "#22c55e",
            weight: isSelected ? 3 : 2,
            fillColor: isSelected ? "#fca5a5" : "#86efac",
            fillOpacity: isSelected ? 0.35 : 0.2,
          },
        });
        layer.on("click", () => onSelectFeature?.(f));

        const props = f.properties || {};
        const tip = props.cod_imovel || props.municipio || "Imóvel";
        layer.bindTooltip(tip, { sticky: true });

        layer.addTo(map);
        fg.addLayer(layer);
      });

      if (fg.getLayers().length > 0) {
        map.fitBounds(fg.getBounds().pad(0.1));
      }

      layerRef.current = fg;

      const timer = setTimeout(() => {
        if (!cancelled && mapRef.current) {
          mapRef.current.invalidateSize();
        }
      }, 200);
    };

    init();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [features, analysisLayers, selectedFeature, onMapClick]);

  return <div ref={containerRef} className="w-full h-full min-h-[400px] rounded-lg" data-testid="map-container" />;
}

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 70 ? "text-green-600" : score >= 40 ? "text-amber-600" : "text-red-500";
  const bg = score >= 70 ? "bg-green-100" : score >= 40 ? "bg-amber-100" : "bg-red-100";
  return (
    <div className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-bold text-lg", bg, color)}>
      <Gauge className="w-5 h-5" />
      {score}/100
    </div>
  );
}

function ScoreBreakdownBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value}/{max}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function formatDist(meters: number | null | undefined): string {
  if (meters == null) return "N/D";
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function EnergiaScoreBadge({ score }: { score?: string }) {
  if (!score) return null;
  const colors: Record<string, string> = {
    ALTA: "bg-green-100 text-green-700 border-green-300",
    MEDIA: "bg-amber-100 text-amber-700 border-amber-300",
    BAIXA: "bg-red-100 text-red-700 border-red-300",
  };
  return <Badge variant="outline" className={cn("text-[10px]", colors[score] || "")} data-testid="badge-score-energia">{score}</Badge>;
}

function AnalysisPanel({
  analysis,
  feature,
  onImport,
  onCreateDeal,
  onSave,
  isImported,
  importing,
  saving,
  enriquecimentoAgro,
  enriquecimentoLoading,
  onEnriquecerAgro,
}: {
  analysis: any;
  feature: any;
  onImport: () => void;
  onCreateDeal: () => void;
  onSave?: () => void;
  isImported: boolean;
  importing: boolean;
  saving?: boolean;
  enriquecimentoAgro?: EnriquecimentoAgro | null;
  enriquecimentoLoading?: boolean;
  onEnriquecerAgro?: () => void;
}) {
  const props = feature?.properties || {};
  const bd = analysis.breakdown || {};
  return (
    <div className="space-y-4">
      <div className="text-center">
        <ScoreGauge score={analysis.score} />
        <p className="text-xs text-muted-foreground mt-1">Score de Oportunidade</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Card className={cn("border", analysis.temRio || analysis.temLago ? "border-blue-300 bg-blue-50/50" : "border-muted")}>
          <CardContent className="p-3 text-center">
            <Droplets className={cn("w-5 h-5 mx-auto mb-1", analysis.temRio || analysis.temLago ? "text-blue-600" : "text-muted-foreground")} />
            <p className="text-xs font-medium">{analysis.temRio ? "Tem Rio" : analysis.temLago ? "Tem Lago" : "Sem Água"}</p>
            <p className="text-[10px] text-muted-foreground">
              {analysis.distAguaM != null ? `a ${formatDist(analysis.distAguaM)}` : `${analysis.qtdRios} rios, ${analysis.qtdLagos} lagos`}
            </p>
          </CardContent>
        </Card>

        <Card className={cn("border", analysis.temEnergia ? "border-amber-300 bg-amber-50/50" : "border-muted")}>
          <CardContent className="p-3 text-center">
            <ZapIcon className={cn("w-5 h-5 mx-auto mb-1", analysis.temEnergia ? "text-amber-600" : "text-muted-foreground")} />
            <span className="text-xs font-medium flex items-center justify-center gap-1">
              {analysis.temEnergia ? "Energia" : "Sem Energia"}
              <EnergiaScoreBadge score={analysis.scoreEnergia} />
            </span>
            <p className="text-[10px] text-muted-foreground">
              {analysis.distEnergiaM != null ? `a ${formatDist(analysis.distEnergiaM)}` : `${analysis.qtdEnergia} linhas`}
            </p>
          </CardContent>
        </Card>

        <Card className="border border-muted">
          <CardContent className="p-3 text-center">
            <Mountain className={cn("w-5 h-5 mx-auto mb-1", analysis.altMedia ? "text-emerald-600" : "text-muted-foreground")} />
            <p className="text-xs font-medium">{analysis.altMedia ? `${analysis.altMedia}m` : "N/D"}</p>
            <p className="text-[10px] text-muted-foreground">
              {analysis.altMin != null ? `${analysis.altMin}–${analysis.altMax}m` : "altitude"}
            </p>
          </CardContent>
        </Card>

        <Card className={cn("border", analysis.declivMed != null ? (analysis.declivMed < 8 ? "border-green-300 bg-green-50/50" : analysis.declivMed < 15 ? "border-amber-300 bg-amber-50/50" : "border-red-300 bg-red-50/50") : "border-muted")}>
          <CardContent className="p-3 text-center">
            <TrendingUp className={cn("w-5 h-5 mx-auto mb-1", analysis.declivMed != null ? (analysis.declivMed < 8 ? "text-green-600" : analysis.declivMed < 15 ? "text-amber-600" : "text-red-600") : "text-muted-foreground")} />
            <p className="text-xs font-medium">{analysis.declivMed != null ? `${analysis.declivMed}%` : "N/D"}</p>
            <p className="text-[10px] text-muted-foreground">declividade</p>
          </CardContent>
        </Card>
      </div>

      {bd && Object.keys(bd).length > 0 && (
        <div className="bg-muted/20 rounded-lg p-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Breakdown do Score</p>
          <ScoreBreakdownBar label="Hidrografia" value={bd.agua || 0} max={30} color="bg-blue-500" />
          <ScoreBreakdownBar label="Energia" value={bd.energia || 0} max={25} color="bg-amber-500" />
          <ScoreBreakdownBar label="Altitude" value={bd.altitude || 0} max={20} color="bg-emerald-500" />
          <ScoreBreakdownBar label="Declividade" value={bd.decliv || 0} max={10} color="bg-purple-500" />
          <ScoreBreakdownBar label="Área" value={bd.area || 0} max={15} color="bg-cyan-500" />
        </div>
      )}

      <div className="bg-muted/30 rounded-lg p-3 space-y-1 text-sm">
        <p><span className="text-muted-foreground">Código:</span> <span className="font-medium">{props.cod_imovel || "N/D"}</span></p>
        <p><span className="text-muted-foreground">Município:</span> <span className="font-medium">{props.municipio || "N/D"}</span></p>
        <p><span className="text-muted-foreground">Área:</span> <span className="font-medium">{props.num_area ? `${Number(props.num_area).toLocaleString("pt-BR")} ha` : "N/D"}</span></p>
        <p><span className="text-muted-foreground">Status:</span> <span className="font-medium">{props.ind_status || props.des_condic || "N/D"}</span></p>
        <p><span className="text-muted-foreground">Tipo:</span> <span className="font-medium">{props.ind_tipo || "N/D"}</span></p>
      </div>

      {(enriquecimentoAgro || enriquecimentoLoading) && (
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Sprout className="w-4 h-4 text-green-600" /> Análise Agro
            </h4>
            {enriquecimentoAgro && (
              <span className={cn("text-xs font-bold px-2 py-1 rounded-full",
                enriquecimentoAgro.scoreAgro >= 70 ? 'bg-green-100 text-green-700' :
                enriquecimentoAgro.scoreAgro >= 40 ? 'bg-yellow-100 text-yellow-700' :
                'bg-red-100 text-red-700'
              )} data-testid="badge-score-agro">
                Score {enriquecimentoAgro.scoreAgro}/100
              </span>
            )}
          </div>

          {enriquecimentoLoading && (
            <div className="text-xs text-muted-foreground flex items-center gap-2 py-2">
              <Loader2 className="w-3 h-3 animate-spin text-green-500" />
              Consultando SoilGrids + Embrapa...
            </div>
          )}

          {enriquecimentoAgro && (
            <div className="space-y-3 text-xs">
              <p className="text-muted-foreground italic bg-green-50 dark:bg-green-950/30 p-2 rounded" data-testid="text-resumo-agro">
                {enriquecimentoAgro.resumo}
              </p>

              {enriquecimentoAgro.solo && (
                <div>
                  <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">Solo (SoilGrids)</p>
                  <div className="grid grid-cols-2 gap-1">
                    {enriquecimentoAgro.solo.phh2o !== null && (
                      <span className="bg-muted/50 px-2 py-1 rounded" data-testid="solo-ph">pH: {enriquecimentoAgro.solo.phh2o}</span>
                    )}
                    {enriquecimentoAgro.solo.clay !== null && (
                      <span className="bg-muted/50 px-2 py-1 rounded" data-testid="solo-argila">Argila: {enriquecimentoAgro.solo.clay}%</span>
                    )}
                    {enriquecimentoAgro.solo.soc !== null && (
                      <span className="bg-muted/50 px-2 py-1 rounded" data-testid="solo-carbono">C. Org: {enriquecimentoAgro.solo.soc} g/kg</span>
                    )}
                    {enriquecimentoAgro.solo.nitrogen !== null && (
                      <span className="bg-muted/50 px-2 py-1 rounded" data-testid="solo-nitrogenio">N: {enriquecimentoAgro.solo.nitrogen} g/kg</span>
                    )}
                    {enriquecimentoAgro.solo.cec !== null && (
                      <span className="bg-muted/50 px-2 py-1 rounded" data-testid="solo-cec">CTC: {enriquecimentoAgro.solo.cec}</span>
                    )}
                    {enriquecimentoAgro.solo.soilClass && (
                      <span className="bg-muted/50 px-2 py-1 rounded col-span-2 text-muted-foreground" data-testid="solo-classe">{enriquecimentoAgro.solo.soilClass}</span>
                    )}
                  </div>
                </div>
              )}

              {enriquecimentoAgro.zarc.length > 0 && (
                <div>
                  <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">ZARC — Aptidão Climática</p>
                  <div className="space-y-1">
                    {enriquecimentoAgro.zarc.map((z, i) => (
                      <div key={i} className="flex items-center justify-between bg-muted/50 px-2 py-1 rounded" data-testid={`zarc-item-${i}`}>
                        <span className="capitalize">{z.cultura}</span>
                        <span className={cn("font-medium",
                          z.aptidao === 'Apto' ? 'text-green-600' :
                          z.aptidao === 'Inapto' ? 'text-red-600' :
                          'text-yellow-600'
                        )}>{z.aptidao || 'N/D'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {enriquecimentoAgro.produtividade.filter(p => p.estimativa).length > 0 && (
                <div>
                  <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">Produtividade Estimada</p>
                  {enriquecimentoAgro.produtividade.filter(p => p.estimativa).map((p, i) => (
                    <div key={i} className="flex justify-between bg-muted/50 px-2 py-1 rounded mb-1" data-testid={`prod-item-${i}`}>
                      <span className="capitalize">{p.cultura}</span>
                      <span className="font-medium">{p.estimativa} {p.unidade}</span>
                    </div>
                  ))}
                </div>
              )}

              {enriquecimentoAgro.parcelasSigef.length > 0 && (
                <div>
                  <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">Parcelas SIGEF/INCRA</p>
                  {enriquecimentoAgro.parcelasSigef.map((p, i) => (
                    <div key={i} className="bg-muted/50 px-2 py-1 rounded mb-1" data-testid={`sigef-item-${i}`}>
                      <span className="font-mono text-muted-foreground">{p.codigo}</span>
                      <span className="ml-2">{p.area.toFixed(0)} ha — {p.municipio}/{p.uf}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {onEnriquecerAgro && !enriquecimentoAgro && !enriquecimentoLoading && (
        <Button
          variant="outline"
          className="w-full text-green-700 border-green-300 dark:text-green-400 dark:border-green-700"
          onClick={onEnriquecerAgro}
          data-testid="button-enriquecer-agro"
        >
          <Sprout className="w-4 h-4 mr-1.5" /> Analisar Solo + ZARC + SIGEF
        </Button>
      )}

      <div className="flex gap-2 flex-wrap">
        {isImported ? (
          <>
            <Button variant="outline" className="flex-1 text-green-600" disabled>
              <Check className="w-4 h-4 mr-1.5" /> Importado
            </Button>
            {onSave && (
              <Button
                variant="outline"
                className="flex-1"
                onClick={onSave}
                disabled={saving}
                data-testid="button-salvar-analise"
              >
                {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
                Salvar Análise
              </Button>
            )}
          </>
        ) : (
          <Button
            variant="outline"
            className="flex-1"
            onClick={onImport}
            disabled={importing}
            data-testid="button-importar-fazenda"
          >
            {importing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />}
            Importar Ativo
          </Button>
        )}
        <Button
          className="flex-1"
          onClick={onCreateDeal}
          disabled={importing}
          data-testid="button-criar-deal-geo"
        >
          <Briefcase className="w-4 h-4 mr-1.5" /> Criar Deal
        </Button>
      </div>
    </div>
  );
}

function CreateDealDialog({
  open,
  onOpenChange,
  feature,
  analysis,
  importedMap,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  feature: any;
  analysis: any;
  importedMap: Record<string, number>;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [stage, setStage] = useState("");
  const [creating, setCreating] = useState(false);

  const { data: stages = [] } = useQuery({
    queryKey: ["/api/crm/stages"],
    queryFn: () => apiRequest("GET", "/api/crm/stages").then(r => r.json()),
  });
  const assetStages = (stages as any[]).filter((s: any) => s.pipelineType === "ASSET");

  useEffect(() => {
    if (assetStages.length > 0 && !stage) setStage(String(assetStages[0].id));
  }, [assetStages]);

  const props = feature?.properties || {};
  const codImovel = props.cod_imovel || "";
  const municipio = props.municipio || "";
  const uf = props.cod_estado || props.uf || "";

  const handleCreate = async () => {
    setCreating(true);
    try {
      let assetId = importedMap[codImovel];

      if (!assetId) {
        const importRes = await apiRequest("POST", "/api/geo/import-fazenda", { feature, analysis });
        if (importRes.status === 409) {
          const data = await importRes.json();
          assetId = data.assetId;
        } else if (importRes.ok) {
          const data = await importRes.json();
          assetId = data.id;
        } else {
          throw new Error("Falha ao importar");
        }
      }

      const description = [
        `Imóvel Rural CAR: ${codImovel}`,
        `Município: ${municipio}/${uf}`,
        `Área: ${props.num_area ? `${Number(props.num_area).toLocaleString("pt-BR")} ha` : "N/D"}`,
        `Score: ${analysis?.score || "N/D"}/100`,
        analysis?.temRio ? "✓ Tem rio/córrego" : "✗ Sem rio próximo",
        analysis?.temLago ? "✓ Tem lago/represa" : "",
        analysis?.temEnergia ? "✓ Energia elétrica próxima" : "✗ Sem energia próxima",
        analysis?.altMedia ? `Altitude média: ${analysis.altMedia}m` : "",
      ].filter(Boolean).join("\n");

      const priority = (analysis?.score || 0) >= 70 ? "high" : (analysis?.score || 0) >= 40 ? "medium" : "low";

      await apiRequest("POST", "/api/crm/deals", {
        title: `Oportunidade Rural — ${municipio}/${uf}`,
        stageId: Number(stage),
        pipelineType: "ASSET",
        priority,
        description,
        labels: ["CAR", "Rural"],
        assetId,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/geo/imported"] });
      toast({ title: "Deal criado com sucesso!", description: "Redirecionando ao CRM..." });
      onOpenChange(false);
      onDone();
      setTimeout(() => navigate("/crm"), 500);
    } catch (err) {
      toast({ title: "Erro ao criar deal", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Criar Deal — Oportunidade Rural</DialogTitle>
          <DialogDescription>Importar fazenda como ativo e criar deal no pipeline ASSET</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
            <p className="font-medium">{municipio}/{uf}</p>
            <p className="text-muted-foreground">CAR: {codImovel || "N/D"}</p>
            <p className="text-muted-foreground">Área: {props.num_area ? `${Number(props.num_area).toLocaleString("pt-BR")} ha` : "N/D"}</p>
            {analysis && <p className="text-muted-foreground">Score: {analysis.score}/100</p>}
          </div>
          <div className="space-y-2">
            <Label>Etapa do Pipeline</Label>
            <Select value={stage} onValueChange={setStage}>
              <SelectTrigger data-testid="select-stage-geo">
                <SelectValue placeholder="Selecionar etapa..." />
              </SelectTrigger>
              <SelectContent>
                {assetStages.map((s: any) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleCreate} disabled={creating || !stage} data-testid="button-confirmar-deal-geo">
            {creating ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Briefcase className="w-4 h-4 mr-1.5" />}
            Criar Deal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function GeoRuralPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [uf, setUf] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [areaMin, setAreaMin] = useState("");
  const [areaMax, setAreaMax] = useState("");
  const [searched, setSearched] = useState(false);
  const [activeSearch, setActiveSearch] = useState("");
  const [page, setPage] = useState(0);

  const [selectedFeature, setSelectedFeature] = useState<any>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

  const [dealFeature, setDealFeature] = useState<any>(null);
  const [dealAnalysis, setDealAnalysis] = useState<any>(null);
  const [dealDialogOpen, setDealDialogOpen] = useState(false);

  const [serverStatus, setServerStatus] = useState<"idle" | "checking" | "online" | "offline">("checking");
  const [serverCheckedAt, setServerCheckedAt] = useState<string | null>(null);
  const [carManualCode, setCarManualCode] = useState("");

  useEffect(() => {
    apiRequest("GET", "/api/geo/sicar-status")
      .then(r => r.json())
      .then(data => {
        setServerStatus(data.online ? "online" : "offline");
        setServerCheckedAt(new Date().toLocaleTimeString("pt-BR"));
      })
      .catch(() => {
        setServerStatus("offline");
        setServerCheckedAt(new Date().toLocaleTimeString("pt-BR"));
      });
  }, []);

  const [soloPreview, setSoloPreview] = useState<SoilGridsData | null>(null);
  const [soloLoading, setSoloLoading] = useState(false);
  const [enriquecimentoAgro, setEnriquecimentoAgro] = useState<EnriquecimentoAgro | null>(null);
  const [enriquecimentoLoading, setEnriquecimentoLoading] = useState(false);

  const testServer = useCallback(async () => {
    setServerStatus("checking");
    try {
      const res = await apiRequest("GET", "/api/health/services");
      if (!res.ok) throw new Error();
      const data = await res.json();
      const sicarStatus = data.sicar === "online" ? "online" : "offline";
      setServerStatus(sicarStatus);
      setServerCheckedAt(new Date().toLocaleTimeString("pt-BR"));
      toast({
        title: sicarStatus === "online" ? "Servidor SICAR Online" : "Servidor SICAR Indisponível",
        description: sicarStatus === "online"
          ? "O geoserver do CAR está respondendo normalmente."
          : "O geoserver do CAR não está respondendo. Tente novamente mais tarde.",
        variant: sicarStatus === "online" ? "default" : "destructive",
      });
    } catch {
      setServerStatus("offline");
      setServerCheckedAt(new Date().toLocaleTimeString("pt-BR"));
      toast({ title: "Erro ao verificar servidor", description: "Não foi possível testar a conexão.", variant: "destructive" });
    }
  }, [toast]);

  const searchParams = useMemo(() => {
    const p = new URLSearchParams();
    if (uf) p.set("uf", uf);
    if (municipio) p.set("municipio", municipio);
    if (areaMin) p.set("areaMin", areaMin);
    if (areaMax) p.set("areaMax", areaMax);
    p.set("count", String(PAGE_SIZE));
    p.set("startIndex", String(page * PAGE_SIZE));
    return p.toString();
  }, [uf, municipio, areaMin, areaMax, page]);

  const { data: rawData, isLoading, error, refetch } = useQuery({
    queryKey: ["/api/geo/fazendas", activeSearch, page],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/geo/fazendas?${activeSearch}&count=${PAGE_SIZE}&startIndex=${page * PAGE_SIZE}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        if (body.sicarOffline || r.status === 502) {
          setServerStatus("offline");
        }
        throw new Error(body.message || "Erro na busca");
      }
      return r.json();
    },
    enabled: searched && !!activeSearch,
    retry: 2,
    retryDelay: 2000,
  });

  const features: any[] = rawData?.features || [];
  const totalFeatures = rawData?.totalFeatures || rawData?.numberMatched || features.length;

  const { data: importedMap = {} } = useQuery({
    queryKey: ["/api/geo/imported"],
    queryFn: () => apiRequest("GET", "/api/geo/imported").then(r => r.json()),
  });

  const handleSearch = () => {
    if (!uf) {
      toast({ title: "Selecione um estado", variant: "destructive" });
      return;
    }
    setPage(0);
    setSelectedFeature(null);
    setAnalysis(null);
    const p = new URLSearchParams();
    p.set("uf", uf);
    if (municipio) p.set("municipio", municipio);
    if (areaMin) p.set("areaMin", areaMin);
    if (areaMax) p.set("areaMax", areaMax);
    setActiveSearch(p.toString());
    setSearched(true);
  };

  const applyShortcut = (filters: any) => {
    if (!uf) {
      toast({ title: "Selecione um estado primeiro", variant: "destructive" });
      return;
    }
    setAreaMin(filters.areaMin || "");
    setAreaMax(filters.areaMax || "");
    setMunicipio(filters.municipio || municipio);
    setPage(0);
    setSelectedFeature(null);
    setAnalysis(null);
    const p = new URLSearchParams();
    p.set("uf", uf);
    if (municipio) p.set("municipio", municipio);
    if (filters.areaMin) p.set("areaMin", filters.areaMin);
    if (filters.areaMax) p.set("areaMax", filters.areaMax);
    setActiveSearch(p.toString());
    setSearched(true);
  };

  const clearFilters = () => {
    setUf(""); setMunicipio(""); setAreaMin(""); setAreaMax("");
    setSearched(false); setActiveSearch(""); setPage(0);
    setSelectedFeature(null); setAnalysis(null);
  };

  const [savingAnalysis, setSavingAnalysis] = useState(false);

  const analyzeFeature = useCallback(async (feature: any) => {
    setSelectedFeature(feature);
    setAnalyzing(true);
    setAnalysis(null);
    setEnriquecimentoAgro(null);
    try {
      const areaHa = feature?.properties?.num_area ? parseFloat(feature.properties.num_area) : null;
      const res = await apiRequest("POST", "/api/geo/analisar", { geometry: feature.geometry, areaHa });
      if (!res.ok) throw new Error("Erro na análise");
      const data = await res.json();
      setAnalysis(data);
    } catch {
      toast({ title: "Erro ao analisar fazenda", variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  }, [toast]);

  const saveAnalysis = useCallback(async () => {
    if (!selectedFeature || !analysis) return;
    const cod = selectedFeature.properties?.cod_imovel || "";
    const assetId = cod ? (importedMap as any)[cod] : null;
    if (!assetId) {
      toast({ title: "Fazenda não importada", description: "Importe primeiro para salvar a análise.", variant: "destructive" });
      return;
    }
    setSavingAnalysis(true);
    try {
      const res = await apiRequest("POST", "/api/geo/persist-analysis", { assetId, analysis });
      if (!res.ok) throw new Error();
      toast({ title: "Análise salva com sucesso!" });
    } catch {
      toast({ title: "Erro ao salvar análise", variant: "destructive" });
    } finally {
      setSavingAnalysis(false);
    }
  }, [selectedFeature, analysis, importedMap, toast]);

  const consultarSoloNoMapa = useCallback(async (lat: number, lon: number) => {
    setSoloLoading(true);
    setSoloPreview(null);
    try {
      const res = await apiRequest('GET', `/api/geo/solo?lat=${lat}&lon=${lon}`);
      const data = await res.json();
      if (data.success) setSoloPreview(data.data);
    } catch (err) {
      console.error('Erro ao consultar solo:', err);
    } finally {
      setSoloLoading(false);
    }
  }, []);

  const enriquecerFazendaSelecionada = useCallback(async () => {
    if (!selectedFeature || !analysis) return;
    const geom = selectedFeature.geometry;
    if (!geom) return;

    let lat: number | null = null;
    let lon: number | null = null;
    if (analysis.centroide) {
      lat = analysis.centroide.lat || analysis.centroide[1];
      lon = analysis.centroide.lon || analysis.centroide[0];
    }
    if (!lat || !lon) {
      const coords = geom.coordinates;
      if (geom.type === 'Polygon' && coords?.[0]) {
        const ring = coords[0];
        lat = ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length;
        lon = ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length;
      } else if (geom.type === 'MultiPolygon' && coords?.[0]?.[0]) {
        const ring = coords[0][0];
        lat = ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length;
        lon = ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length;
      }
    }
    if (!lat || !lon) return;

    const props = selectedFeature.properties || {};
    const codImovel = props.cod_imovel || '';
    const assetId = codImovel ? (importedMap as any)[codImovel] : null;

    setEnriquecimentoLoading(true);
    setEnriquecimentoAgro(null);
    try {
      const res = await apiRequest('POST', '/api/geo/enriquecer-agro', {
        lat,
        lon,
        codIBGE: props.cod_municipio || undefined,
        fazendaId: assetId || undefined,
      });
      const data = await res.json();
      if (data.success) setEnriquecimentoAgro(data.data);
    } catch (err) {
      console.error('Erro no enriquecimento agro:', err);
    } finally {
      setEnriquecimentoLoading(false);
    }
  }, [selectedFeature, analysis, importedMap]);

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/geo/import-fazenda", {
        feature: selectedFeature,
        analysis,
      });
      if (res.status === 409) {
        toast({ title: "Imóvel já importado" });
        return;
      }
      if (!res.ok) throw new Error();
      toast({ title: "Fazenda importada como ativo!" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/geo/imported"] });
      queryClient.invalidateQueries({ queryKey: ["/api/matching/assets"] });
    },
    onError: () => {
      toast({ title: "Erro ao importar fazenda", variant: "destructive" });
    },
  });

  const openDealDialog = (feature: any, analysisData: any) => {
    setDealFeature(feature);
    setDealAnalysis(analysisData);
    setDealDialogOpen(true);
  };

  const hasResults = searched && features.length > 0;
  const totalPages = Math.ceil(totalFeatures / PAGE_SIZE);

  const [activeTab, setActiveTab] = useState("busca");

  const [rankFilters, setRankFilters] = useState<Record<string, string>>({});
  const [rankPage, setRankPage] = useState(0);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; analyzed: number; errors: number } | null>(null);

  const rankParams = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(rankFilters).forEach(([k, v]) => { if (v) p.set(k, v); });
    p.set("limit", "30");
    p.set("offset", String(rankPage * 30));
    return p.toString();
  }, [rankFilters, rankPage]);

  const { data: rankingData, isLoading: rankLoading, refetch: refetchRanking } = useQuery({
    queryKey: ["/api/geo/ranking", rankParams],
    queryFn: () => apiRequest("GET", `/api/geo/ranking?${rankParams}`).then(r => r.json()),
    enabled: activeTab === "ranking",
  });

  const startBatch = useCallback(async () => {
    setBatchRunning(true);
    setBatchProgress({ current: 0, total: 0, analyzed: 0, errors: 0 });
    try {
      const res = await fetch("/api/geo/batch-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No reader");

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === "start") setBatchProgress(p => p ? { ...p, total: evt.total } : { current: 0, total: evt.total, analyzed: 0, errors: 0 });
              else if (evt.type === "progress") setBatchProgress(p => p ? { ...p, current: evt.current } : p);
              else if (evt.type === "analyzed") setBatchProgress(p => p ? { ...p, analyzed: p.analyzed + 1 } : p);
              else if (evt.type === "error") setBatchProgress(p => p ? { ...p, errors: p.errors + 1 } : p);
              else if (evt.type === "complete") {
                toast({ title: "Batch concluído", description: `${evt.analyzed} analisados, ${evt.errors} erros` });
                refetchRanking();
              }
            } catch {}
          }
        }
      }
    } catch {
      toast({ title: "Erro no batch", variant: "destructive" });
    } finally {
      setBatchRunning(false);
    }
  }, [toast, refetchRanking]);

  const rankItems = rankingData?.items || [];
  const rankStats = rankingData?.stats || {};
  const rankTotal = rankingData?.total || 0;

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Prospecção Rural</h1>
          <p className="text-sm text-muted-foreground">Busque imóveis rurais do CAR e analise oportunidades com dados geoespaciais</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={testServer}
                  disabled={serverStatus === "checking"}
                  data-testid="button-testar-servidor"
                  className={cn(
                    serverStatus === "online" && "border-green-500 text-green-600",
                    serverStatus === "offline" && "border-red-500 text-red-600",
                  )}
                >
                  {serverStatus === "checking" ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : serverStatus === "online" ? (
                    <Wifi className="w-4 h-4 mr-1.5" />
                  ) : serverStatus === "offline" ? (
                    <WifiOff className="w-4 h-4 mr-1.5" />
                  ) : (
                    <Activity className="w-4 h-4 mr-1.5" />
                  )}
                  {serverStatus === "checking" ? "Testando..." : serverStatus === "online" ? "SICAR Online" : serverStatus === "offline" ? "SICAR Offline" : "Testar Servidor"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Testa a conexão com o geoserver do SICAR (CAR)</p>
                {serverCheckedAt && <p className="text-xs text-muted-foreground">Último teste: {serverCheckedAt}</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {hasResults && activeTab === "busca" && (
            <Button variant="outline" size="sm" onClick={() => setMapOpen(true)} data-testid="button-ver-mapa">
              <MapIcon className="w-4 h-4 mr-1.5" /> Ver Mapa
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-geo">
          <TabsTrigger value="busca" data-testid="tab-busca">
            <Search className="w-4 h-4 mr-1.5" /> Busca CAR
          </TabsTrigger>
          <TabsTrigger value="ranking" data-testid="tab-ranking">
            <Trophy className="w-4 h-4 mr-1.5" /> Ranking
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ranking" className="space-y-4 mt-4">
          {/* Stats Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold" data-testid="stat-total-analyzed">{rankStats.total_analyzed || 0}</p>
                <p className="text-xs text-muted-foreground">Analisados</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold" data-testid="stat-avg-score">{rankStats.avg_score || 0}</p>
                <p className="text-xs text-muted-foreground">Score Médio</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-blue-600" data-testid="stat-pct-agua">{rankStats.pct_agua || 0}%</p>
                <p className="text-xs text-muted-foreground">Com Água</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-amber-600" data-testid="stat-pct-energia">{rankStats.pct_energia || 0}%</p>
                <p className="text-xs text-muted-foreground">Com Energia</p>
              </CardContent>
            </Card>
          </div>

          {/* Batch + Filters */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold flex items-center gap-2"><Filter className="w-4 h-4" /> Filtros</p>
                <Button
                  size="sm"
                  onClick={startBatch}
                  disabled={batchRunning}
                  data-testid="button-batch-analyze"
                >
                  {batchRunning ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Play className="w-4 h-4 mr-1.5" />}
                  Analisar Todos
                </Button>
              </div>

              {batchRunning && batchProgress && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Progresso: {batchProgress.current}/{batchProgress.total}</span>
                    <span>{batchProgress.analyzed} OK, {batchProgress.errors} erros</span>
                  </div>
                  <Progress value={batchProgress.total > 0 ? (batchProgress.current / batchProgress.total) * 100 : 0} data-testid="progress-batch" />
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 items-end">
                <div className="space-y-1">
                  <Label className="text-[11px]">Score mín</Label>
                  <Input
                    type="number" placeholder="0" value={rankFilters.minScore || ""}
                    onChange={e => { setRankFilters(f => ({ ...f, minScore: e.target.value })); setRankPage(0); }}
                    data-testid="input-rank-min-score"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Área mín (ha)</Label>
                  <Input
                    type="number" placeholder="0" value={rankFilters.minArea || ""}
                    onChange={e => { setRankFilters(f => ({ ...f, minArea: e.target.value })); setRankPage(0); }}
                    data-testid="input-rank-min-area"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Área máx (ha)</Label>
                  <Input
                    type="number" placeholder="∞" value={rankFilters.maxArea || ""}
                    onChange={e => { setRankFilters(f => ({ ...f, maxArea: e.target.value })); setRankPage(0); }}
                    data-testid="input-rank-max-area"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Tem Água</Label>
                  <Select value={rankFilters.temAgua || ""} onValueChange={v => { setRankFilters(f => ({ ...f, temAgua: v === "all" ? "" : v })); setRankPage(0); }}>
                    <SelectTrigger data-testid="select-rank-agua"><SelectValue placeholder="Todos" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="true">Sim</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Score Energia</Label>
                  <Select value={rankFilters.scoreEnergia || ""} onValueChange={v => { setRankFilters(f => ({ ...f, scoreEnergia: v === "all" ? "" : v })); setRankPage(0); }}>
                    <SelectTrigger data-testid="select-rank-energia"><SelectValue placeholder="Todos" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="ALTA">ALTA</SelectItem>
                      <SelectItem value="MEDIA">MÉDIA</SelectItem>
                      <SelectItem value="BAIXA">BAIXA</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Estado</Label>
                  <Select value={rankFilters.estado || ""} onValueChange={v => { setRankFilters(f => ({ ...f, estado: v === "all" ? "" : v })); setRankPage(0); }}>
                    <SelectTrigger data-testid="select-rank-estado"><SelectValue placeholder="Todos" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {ESTADOS.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Ordenar</Label>
                  <Select value={rankFilters.orderBy || "score"} onValueChange={v => { setRankFilters(f => ({ ...f, orderBy: v })); setRankPage(0); }}>
                    <SelectTrigger data-testid="select-rank-order"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="score">Score</SelectItem>
                      <SelectItem value="area">Área</SelectItem>
                      <SelectItem value="altitude">Altitude</SelectItem>
                      <SelectItem value="declivity">Declividade</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Ranking Table */}
          {rankLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : rankItems.length === 0 ? (
            <div className="text-center py-10">
              <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">Nenhuma fazenda analisada</p>
              <p className="text-sm text-muted-foreground">Importe fazendas e clique em "Analisar Todos" para popular o ranking</p>
            </div>
          ) : (
            <>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{rankTotal} fazendas no ranking</span>
                <span>Página {rankPage + 1}</span>
              </div>
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Título</TableHead>
                      <TableHead>Local</TableHead>
                      <TableHead className="text-right">Área (ha)</TableHead>
                      <TableHead className="text-center">Score</TableHead>
                      <TableHead className="text-center">Água</TableHead>
                      <TableHead className="text-center">Energia</TableHead>
                      <TableHead className="text-right">Alt. (m)</TableHead>
                      <TableHead className="text-right">Decliv. (%)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rankItems.map((r: any, idx: number) => (
                      <TableRow key={r.id} data-testid={`rank-row-${r.id}`}>
                        <TableCell className="font-mono text-xs text-muted-foreground">{rankPage * 30 + idx + 1}</TableCell>
                        <TableCell className="font-medium text-sm max-w-[200px] truncate">{r.title}</TableCell>
                        <TableCell className="text-sm">{r.municipio ? `${r.municipio}/${r.estado}` : r.estado || "—"}</TableCell>
                        <TableCell className="text-right">{r.area_ha ? Number(r.area_ha).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : "—"}</TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant="outline"
                            className={cn(
                              "font-bold",
                              r.geo_score >= 70 ? "border-green-500 text-green-700 bg-green-50" :
                              r.geo_score >= 40 ? "border-amber-500 text-amber-700 bg-amber-50" :
                              "border-red-500 text-red-700 bg-red-50"
                            )}
                            data-testid={`badge-score-${r.id}`}
                          >
                            {r.geo_score}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {(r.geo_tem_rio || r.geo_tem_lago) ? (
                            <span className="text-blue-600 text-xs">
                              <Droplets className="w-3.5 h-3.5 inline mr-0.5" />
                              {r.geo_dist_agua_m != null ? formatDist(r.geo_dist_agua_m) : "Sim"}
                            </span>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          <EnergiaScoreBadge score={r.geo_score_energia} />
                          {r.geo_dist_energia_m != null && <span className="text-[10px] text-muted-foreground ml-1">{formatDist(r.geo_dist_energia_m)}</span>}
                        </TableCell>
                        <TableCell className="text-right text-sm">{r.geo_alt_med != null ? Math.round(r.geo_alt_med) : "—"}</TableCell>
                        <TableCell className="text-right text-sm">{r.geo_decliv_med != null ? r.geo_decliv_med : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-center gap-2 py-2">
                <Button variant="outline" size="sm" disabled={rankPage === 0} onClick={() => setRankPage(p => p - 1)} data-testid="button-rank-prev">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm text-muted-foreground px-3">Página {rankPage + 1}</span>
                <Button variant="outline" size="sm" disabled={rankItems.length < 30} onClick={() => setRankPage(p => p + 1)} data-testid="button-rank-next">
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="busca" className="space-y-4 mt-4">

      {/* Shortcuts */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {SHORTCUTS.map(s => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              onClick={() => applyShortcut(s.filters)}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border text-left transition-all hover:shadow-sm",
                s.color
              )}
              data-testid={`shortcut-${s.id}`}
            >
              <Icon className="w-8 h-8 shrink-0" />
              <div>
                <p className="font-semibold text-sm">{s.label}</p>
                <p className="text-xs opacity-80">{s.desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* SICAR Status Banner */}
      {serverStatus === "offline" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-4 space-y-3" data-testid="banner-sicar-offline">
          <div className="flex items-start gap-3">
            <WifiOff className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-amber-800 dark:text-amber-300 text-sm">
                SICAR fora do ar no momento
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                O servidor do governo (geoserver.car.gov.br) está instável.
                A busca por município pode não funcionar. Use o código CAR direto ou acesse o portal público.
              </p>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <Input
              className="flex-1 h-8 text-sm bg-white dark:bg-background"
              placeholder="Cole o código CAR (ex: MT-5107800-ABC123...)"
              value={carManualCode}
              onChange={e => setCarManualCode(e.target.value)}
              data-testid="input-car-manual"
            />
            <Button
              size="sm"
              className="h-8 gap-1.5 shrink-0"
              disabled={!carManualCode.trim()}
              onClick={() => {
                const code = carManualCode.trim();
                if (!code) return;
                window.open(
                  `https://consultapublica.car.gov.br/publico/imoveis/index?codigoCar=${encodeURIComponent(code)}`,
                  "_blank"
                );
              }}
              data-testid="button-buscar-car"
            >
              <Search className="w-3.5 h-3.5" />
              Buscar no CAR
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 shrink-0"
              onClick={() => window.open("https://consultapublica.car.gov.br/publico/imoveis/index", "_blank")}
              data-testid="button-portal-car"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Portal CAR
            </Button>
          </div>
        </div>
      )}

      {serverStatus === "checking" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1" data-testid="status-sicar-checking">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Verificando disponibilidade do SICAR...
        </div>
      )}

      {serverStatus === "online" && (
        <div className="flex items-center gap-1.5 text-xs text-green-600" data-testid="status-sicar-online">
          <Wifi className="w-3.5 h-3.5" />
          SICAR disponível
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">Estado (UF) *</Label>
              <Select value={uf} onValueChange={setUf}>
                <SelectTrigger data-testid="select-uf">
                  <SelectValue placeholder="UF..." />
                </SelectTrigger>
                <SelectContent>
                  {ESTADOS.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Município</Label>
              <Input
                value={municipio}
                onChange={e => setMunicipio(e.target.value)}
                placeholder="Ex: Montes Claros"
                data-testid="input-municipio"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Área min (ha)</Label>
              <Input
                type="number" value={areaMin}
                onChange={e => setAreaMin(e.target.value)}
                placeholder="0"
                data-testid="input-area-min"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Área max (ha)</Label>
              <Input
                type="number" value={areaMax}
                onChange={e => setAreaMax(e.target.value)}
                placeholder="∞"
                data-testid="input-area-max"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSearch} className="flex-1" data-testid="button-buscar">
                <Search className="w-4 h-4 mr-1.5" /> Buscar
              </Button>
              {searched && (
                <Button variant="ghost" size="icon" onClick={clearFilters} data-testid="button-limpar">
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {isLoading && (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      )}

      {error && (
        <div className="text-center py-10 text-destructive" data-testid="error-sicar">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-yellow-500" />
          <p className="font-medium">SICAR indisponível</p>
          <p className="text-sm text-muted-foreground mt-1">O servidor do CAR está fora do ar. Use o código CAR direto ou tente novamente em alguns minutos.</p>
          <div className="flex gap-2 justify-center mt-4">
            <Button variant="outline" onClick={() => refetch()} data-testid="button-retry-sicar">
              <RefreshCcw className="w-4 h-4 mr-2" /> Tentar novamente
            </Button>
            <Button variant="outline" onClick={() => window.open("https://consultapublica.car.gov.br/publico/imoveis/index", "_blank")} data-testid="button-portal-car-error">
              <ExternalLink className="w-4 h-4 mr-2" /> Portal CAR
            </Button>
          </div>
        </div>
      )}

      {searched && !isLoading && features.length === 0 && (
        <div className="text-center py-10">
          <TreePine className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">Nenhum imóvel encontrado</p>
          <p className="text-sm text-muted-foreground">Tente ajustar os filtros ou selecionar outro estado</p>
        </div>
      )}

      {hasResults && (
        <>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{totalFeatures.toLocaleString("pt-BR")} imóveis encontrados</span>
            <span>Página {page + 1}{totalPages > 1 ? ` de ${totalPages}` : ""}</span>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Código CAR</TableHead>
                  <TableHead>Município</TableHead>
                  <TableHead className="text-right">Área (ha)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {features.map((f: any, idx: number) => {
                  const p = f.properties || {};
                  const cod = p.cod_imovel || "";
                  const isImported = !!(cod && (importedMap as any)[cod]);
                  const isSelected = selectedFeature?.id === f.id;

                  return (
                    <TableRow
                      key={f.id || idx}
                      className={cn(
                        "cursor-pointer transition-colors",
                        isSelected && "bg-primary/5",
                        isImported && "bg-green-50/50"
                      )}
                      onClick={() => analyzeFeature(f)}
                      data-testid={`row-fazenda-${idx}`}
                    >
                      <TableCell>
                        {isImported && <Check className="w-4 h-4 text-green-600" />}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{cod || "—"}</TableCell>
                      <TableCell>{p.municipio || "—"}</TableCell>
                      <TableCell className="text-right">
                        {p.num_area ? Number(p.num_area).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">{p.ind_status || p.des_condic || "—"}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{p.ind_tipo || "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost" size="icon" className="h-7 w-7"
                                  onClick={(e) => { e.stopPropagation(); analyzeFeature(f); }}
                                  data-testid={`button-analisar-${idx}`}
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Analisar</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost" size="icon" className="h-7 w-7 text-primary"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (analysis && selectedFeature?.id === f.id) {
                                      openDealDialog(f, analysis);
                                    } else {
                                      analyzeFeature(f).then(() => {});
                                      toast({ title: "Analisando... clique novamente após a análise" });
                                    }
                                  }}
                                  data-testid={`button-deal-${idx}`}
                                >
                                  <Briefcase className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Criar Deal</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-center gap-2 py-2">
            <Button
              variant="outline" size="sm"
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              data-testid="button-prev-page"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-muted-foreground px-3">
              Página {page + 1}
            </span>
            <Button
              variant="outline" size="sm"
              disabled={features.length < PAGE_SIZE}
              onClick={() => setPage(p => p + 1)}
              data-testid="button-next-page"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </>
      )}

      {/* Analysis Panel (below table, or in sheet for small screens) */}
      {selectedFeature && (
        <Card className="border-primary/30">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-primary" />
                Análise Geoespacial
              </h3>
              <Button variant="ghost" size="sm" onClick={() => { setSelectedFeature(null); setAnalysis(null); }}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            {analyzing ? (
              <div className="flex items-center justify-center py-10 gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span className="text-muted-foreground">Analisando camadas geoespaciais...</span>
              </div>
            ) : analysis ? (
              <div className="grid md:grid-cols-2 gap-6">
                <div className="min-h-[350px] relative">
                  <LeafletMap
                    features={[selectedFeature]}
                    analysisLayers={analysis.layers}
                    selectedFeature={selectedFeature}
                    onMapClick={consultarSoloNoMapa}
                  />
                  {soloLoading && (
                    <div className="absolute bottom-4 left-4 bg-white dark:bg-gray-900 rounded-lg shadow-lg p-3 text-xs z-[1000] flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin text-green-500" />
                      Consultando solo...
                    </div>
                  )}
                  {soloPreview && !soloLoading && (
                    <div className="absolute bottom-4 left-4 bg-white dark:bg-gray-900 rounded-lg shadow-lg p-3 text-xs z-[1000] max-w-xs" data-testid="card-solo-preview">
                      <div className="font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1">
                        <Sprout className="w-3 h-3 text-green-600" /> Solo neste ponto
                        <button onClick={() => setSoloPreview(null)} className="ml-auto text-gray-400 hover:text-gray-600" data-testid="button-fechar-solo-preview">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        {soloPreview.phh2o !== null && <span>pH: <b>{soloPreview.phh2o}</b></span>}
                        {soloPreview.clay !== null && <span>Argila: <b>{soloPreview.clay}%</b></span>}
                        {soloPreview.soc !== null && <span>C.Org: <b>{soloPreview.soc} g/kg</b></span>}
                        {soloPreview.soilClass && <span className="col-span-2 text-muted-foreground">{soloPreview.soilClass}</span>}
                      </div>
                    </div>
                  )}
                </div>
                <AnalysisPanel
                  analysis={analysis}
                  feature={selectedFeature}
                  onImport={() => importMutation.mutate()}
                  onCreateDeal={() => openDealDialog(selectedFeature, analysis)}
                  onSave={saveAnalysis}
                  isImported={!!(selectedFeature.properties?.cod_imovel && (importedMap as any)[selectedFeature.properties.cod_imovel])}
                  importing={importMutation.isPending}
                  saving={savingAnalysis}
                  enriquecimentoAgro={enriquecimentoAgro}
                  enriquecimentoLoading={enriquecimentoLoading}
                  onEnriquecerAgro={enriquecerFazendaSelecionada}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

        </TabsContent>

        {/* Análise Agro moved to /analise-agro */}
      </Tabs>


      {/* Full map sheet */}
      <Sheet open={mapOpen} onOpenChange={setMapOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0">
          <SheetHeader className="p-4 pb-2">
            <SheetTitle>Mapa — Imóveis Rurais</SheetTitle>
          </SheetHeader>
          <div className="h-[calc(100vh-80px)]">
            <LeafletMap
              features={features}
              selectedFeature={selectedFeature}
              onSelectFeature={(f) => {
                setMapOpen(false);
                analyzeFeature(f);
              }}
              analysisLayers={analysis?.layers}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Create deal dialog */}
      {dealFeature && (
        <CreateDealDialog
          open={dealDialogOpen}
          onOpenChange={setDealDialogOpen}
          feature={dealFeature}
          analysis={dealAnalysis}
          importedMap={importedMap as any}
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/geo/imported"] });
            queryClient.invalidateQueries({ queryKey: ["/api/matching/assets"] });
          }}
        />
      )}
    </div>
  );
}
