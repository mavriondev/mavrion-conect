import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Leaf, Droplets, Thermometer, FlaskConical, Wheat,
  RefreshCw, ExternalLink, Trophy, AlertCircle,
  TrendingUp, MapPin, Loader2, ChevronRight, Map, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

function calcularScore(embrapa: any): number {
  if (!embrapa) return 0;

  if (embrapa.scoreAgro != null) return embrapa.scoreAgro;

  let score = 0;
  let fatores = 0;

  if (embrapa.ndvi?.ndvi != null) {
    score += (embrapa.ndvi.ndvi / 1) * 40;
    fatores += 40;
  }

  if (embrapa.solo?.classificacao) {
    const solosFerteis = ["latossolo vermelho", "latossolo amarelo", "argissolo", "nitossolo"];
    const solosMedios  = ["gleissolo", "cambissolo", "plintossolo"];
    const solo = embrapa.solo.classificacao.toLowerCase();
    const pts = solosFerteis.some(s => solo.includes(s)) ? 30
              : solosMedios.some(s => solo.includes(s)) ? 18 : 8;
    score += pts;
    fatores += 30;
  }

  if (embrapa.zoneamento?.culturas?.length > 0) {
    const baixoRisco = embrapa.zoneamento.culturas.filter(
      (c: any) => c.risco?.includes("20") || c.risco?.toLowerCase() === "baixo"
    ).length;
    const total = embrapa.zoneamento.culturas.length;
    score += (baixoRisco / total) * 30;
    fatores += 30;
  }

  return fatores > 0 ? Math.round((score / fatores) * 100) : 0;
}

function getMedalha(rank: number) {
  if (rank === 1) return { emoji: "🥇", cor: "text-yellow-500" };
  if (rank === 2) return { emoji: "🥈", cor: "text-slate-400" };
  if (rank === 3) return { emoji: "🥉", cor: "text-amber-600" };
  return { emoji: `${rank}º`, cor: "text-muted-foreground" };
}

function getScoreBadge(score: number) {
  if (score >= 75) return { label: "Excelente", cls: "bg-green-100 text-green-700 border-green-200" };
  if (score >= 55) return { label: "Bom", cls: "bg-blue-100 text-blue-700 border-blue-200" };
  if (score >= 35) return { label: "Regular", cls: "bg-amber-100 text-amber-700 border-amber-200" };
  return { label: "Baixo", cls: "bg-red-100 text-red-700 border-red-200" };
}

function NDVIHeatMap({ data, polygon }: { data: any; polygon?: number[][] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || !data?.points?.length) return;

    let L: any;
    let map: any;

    const init = async () => {
      L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      map = L.map(containerRef.current!, {
        zoomControl: true,
        attributionControl: false,
        scrollWheelZoom: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
      }).addTo(map);

      mapRef.current = map;

      if (polygon && polygon.length > 2) {
        const polyLatLngs = polygon.map((c: number[]) => [c[1], c[0]]);
        L.polygon(polyLatLngs, {
          color: '#6366f1',
          weight: 2,
          fillOpacity: 0.05,
          dashArray: '5,5',
        }).addTo(map);
      }

      const points = data.points as { lat: number; lon: number; ndviAtual: number }[];

      const getNdviColor = (v: number) => {
        if (v >= 0.7) return '#22c55e';
        if (v >= 0.55) return '#84cc16';
        if (v >= 0.4) return '#eab308';
        if (v >= 0.2) return '#f97316';
        return '#ef4444';
      };

      points.forEach((pt) => {
        const color = getNdviColor(pt.ndviAtual);
        L.circleMarker([pt.lat, pt.lon], {
          radius: 12,
          fillColor: color,
          fillOpacity: 0.7,
          color: color,
          weight: 2,
          opacity: 0.9,
        })
          .bindTooltip(`NDVI: ${pt.ndviAtual.toFixed(3)}<br>Média: ${(pt as any).ndviMedio?.toFixed(3) || '—'}`, {
            permanent: false,
            direction: 'top',
          })
          .addTo(map);
      });

      const lats = points.map(p => p.lat);
      const lons = points.map(p => p.lon);
      const pad = 0.002;
      map.fitBounds([
        [Math.min(...lats) - pad, Math.min(...lons) - pad],
        [Math.max(...lats) + pad, Math.max(...lons) + pad],
      ]);
    };

    init();

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [data, polygon]);

  return <div ref={containerRef} className="w-full h-64 rounded-lg border" data-testid="ndvi-heatmap" />;
}

function ZonasPanel({ data }: { data: any }) {
  if (!data?.zonas?.length && !data?.alertas?.length) return null;

  const zonaIcons: Record<string, string> = {
    alta: '✅',
    media: '🟡',
    baixa: '🟠',
    critica: '🔴',
  };

  return (
    <div className="space-y-3" data-testid="zonas-panel">
      {data.stats && (
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2 rounded bg-muted/50 text-center">
            <p className="text-xs text-muted-foreground">Mínimo</p>
            <p className="text-sm font-bold">{data.stats.min?.toFixed(3)}</p>
          </div>
          <div className="p-2 rounded bg-muted/50 text-center">
            <p className="text-xs text-muted-foreground">Média</p>
            <p className="text-sm font-bold">{data.stats.media?.toFixed(3)}</p>
          </div>
          <div className="p-2 rounded bg-muted/50 text-center">
            <p className="text-xs text-muted-foreground">Máximo</p>
            <p className="text-sm font-bold">{data.stats.max?.toFixed(3)}</p>
          </div>
        </div>
      )}

      {data.stats && (
        <div className="flex items-center gap-3 px-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">CV:</span>
            <Badge variant="outline" className={cn("text-xs",
              data.stats.cv > 20 ? "bg-red-50 text-red-700 border-red-200" :
              data.stats.cv > 10 ? "bg-amber-50 text-amber-700 border-amber-200" :
              "bg-green-50 text-green-700 border-green-200"
            )}>
              {data.stats.cv?.toFixed(1)}%
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Uniformidade:</span>
            <Badge variant="outline" className={cn("text-xs",
              data.stats.uniformidade >= 90 ? "bg-green-50 text-green-700 border-green-200" :
              data.stats.uniformidade >= 80 ? "bg-blue-50 text-blue-700 border-blue-200" :
              "bg-amber-50 text-amber-700 border-amber-200"
            )}>
              {data.stats.uniformidade?.toFixed(0)}%
            </Badge>
          </div>
        </div>
      )}

      {data.zonas?.length > 0 && (
        <div className="space-y-1.5">
          {data.zonas.map((z: any, i: number) => (
            <div key={i} className="flex items-center justify-between p-2 rounded-lg border" style={{ borderLeftColor: z.cor, borderLeftWidth: 4 }}>
              <div className="flex items-center gap-2">
                <span className="text-sm">{zonaIcons[z.classificacao] || '📍'}</span>
                <span className="text-sm font-medium">{z.nome}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{z.pontos?.length || 0} pts</span>
                <Badge variant="outline" className="text-xs" style={{ color: z.cor, borderColor: z.cor }}>
                  {z.percentual}%
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.alertas?.length > 0 && (
        <div className="space-y-1.5">
          {data.alertas.map((a: string, i: number) => (
            <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 dark:text-amber-300">{a}</p>
            </div>
          ))}
        </div>
      )}

      {data.diagnostico && (
        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200">
          <p className="text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
            <BarChart3 className="w-3.5 h-3.5 inline mr-1" />
            {data.diagnostico}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <span className="text-[10px] text-muted-foreground">Legenda NDVI:</span>
        {[
          { cor: '#ef4444', label: '< 0.2' },
          { cor: '#f97316', label: '0.2–0.4' },
          { cor: '#eab308', label: '0.4–0.55' },
          { cor: '#84cc16', label: '0.55–0.7' },
          { cor: '#22c55e', label: '> 0.7' },
        ].map((l, i) => (
          <div key={i} className="flex items-center gap-0.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.cor }} />
            <span className="text-[9px] text-muted-foreground">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type ModalTipo = "solo" | "clima" | "culturas" | "ndvi" | null;

function ModalDetalhes({ tipo, embrapa, titulo, onClose, ativoId, ndviGridData, onAnaliseVariabilidade, analisandoGrid, embrapaUpdatedAt }: {
  tipo: ModalTipo; embrapa: any; titulo: string; onClose: () => void;
  ativoId?: number; ndviGridData?: any; onAnaliseVariabilidade?: (id: number) => void; analisandoGrid?: boolean;
  embrapaUpdatedAt?: string;
}) {
  if (!tipo || !embrapa) return null;

  const configs: Record<string, { title: string; icon: any; cor: string }> = {
    solo:     { title: "Classificação do Solo",     icon: FlaskConical, cor: "text-amber-600" },
    clima:    { title: "Dados Climáticos",           icon: Droplets,     cor: "text-blue-500" },
    culturas: { title: "Zoneamento Agrícola",        icon: Wheat,        cor: "text-green-600" },
    ndvi:     { title: "Índice de Vegetação (NDVI)", icon: Leaf,         cor: "text-emerald-600" },
  };

  const config = configs[tipo];
  const Icon = config.icon;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={cn("max-w-md", tipo === "ndvi" && (ndviGridData?.points?.length > 0) && "max-w-2xl")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Icon className={cn("w-4 h-4", config.cor)} />
            {config.title}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {titulo}
            {embrapaUpdatedAt && (
              <span className="ml-2 text-[10px] opacity-60">
                (dados de {new Date(embrapaUpdatedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })})
              </span>
            )}
          </p>
        </DialogHeader>

        <div className="space-y-3 pt-1">

          {tipo === "solo" && embrapa.solo && (
            <>
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200">
                <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
                  {embrapa.solo.classificacao}
                </p>
                {embrapa.solo.aptidao && (
                  <p className="text-xs text-amber-700 mt-1">
                    Aptidão agrícola: {embrapa.solo.aptidao}
                  </p>
                )}
                {embrapa.solo.textura && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Textura: {embrapa.solo.textura}
                  </p>
                )}
              </div>
              {(embrapa.solo.ph != null || embrapa.solo.argila != null || embrapa.solo.carbonoOrganico != null) && (
                <div className="grid grid-cols-2 gap-2">
                  {embrapa.solo.ph != null && (
                    <div className="p-2 rounded bg-muted/50 text-center">
                      <p className="text-xs text-muted-foreground">pH</p>
                      <p className="text-sm font-bold">{embrapa.solo.ph}</p>
                    </div>
                  )}
                  {embrapa.solo.argila != null && (
                    <div className="p-2 rounded bg-muted/50 text-center">
                      <p className="text-xs text-muted-foreground">Argila</p>
                      <p className="text-sm font-bold">{embrapa.solo.argila}%</p>
                    </div>
                  )}
                  {embrapa.solo.carbonoOrganico != null && (
                    <div className="p-2 rounded bg-muted/50 text-center">
                      <p className="text-xs text-muted-foreground">C. Orgânico</p>
                      <p className="text-sm font-bold">{embrapa.solo.carbonoOrganico} g/kg</p>
                    </div>
                  )}
                  {embrapa.solo.areia != null && (
                    <div className="p-2 rounded bg-muted/50 text-center">
                      <p className="text-xs text-muted-foreground">Areia</p>
                      <p className="text-sm font-bold">{embrapa.solo.areia}%</p>
                    </div>
                  )}
                </div>
              )}
              {embrapa.solo.fonte && (
                <p className="text-[10px] text-muted-foreground text-right">
                  Fonte: {embrapa.solo.fonte}
                </p>
              )}
            </>
          )}

          {tipo === "clima" && embrapa.clima && (
            <>
              {embrapa.clima.precipitacaoMedia > 0 && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200">
                  <span className="text-sm flex items-center gap-2">
                    <Droplets className="w-4 h-4 text-blue-500" /> Precipitação
                  </span>
                  <span className="font-bold text-blue-700">{embrapa.clima.precipitacaoMedia} mm</span>
                </div>
              )}
              {embrapa.clima.temperaturaMedia > 0 && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200">
                  <span className="text-sm flex items-center gap-2">
                    <Thermometer className="w-4 h-4 text-orange-500" /> Temperatura média
                  </span>
                  <span className="font-bold text-orange-700">{embrapa.clima.temperaturaMedia}°C</span>
                </div>
              )}
              {embrapa.clima.indiceSeca && (
                <p className="text-xs text-muted-foreground px-1">{embrapa.clima.indiceSeca}</p>
              )}
            </>
          )}

          {tipo === "culturas" && embrapa.zoneamento && (
            <>
              {embrapa.zoneamento.culturas?.length > 0 ? (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {embrapa.zoneamento.culturas.map((c: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30 border">
                      <span className="text-sm font-medium capitalize">{c.nome}</span>
                      <div className="flex items-center gap-2">
                        {c.epocaPlantio && (
                          <span className="text-xs text-muted-foreground">{c.epocaPlantio}</span>
                        )}
                        <Badge variant="outline" className={
                          c.risco === "baixo" || c.risco?.includes("20")
                            ? "text-xs bg-green-50 text-green-700 border-green-200"
                            : c.risco === "medio" || c.risco?.includes("30")
                            ? "text-xs bg-amber-50 text-amber-700 border-amber-200"
                            : "text-xs bg-red-50 text-red-700 border-red-200"
                        }>
                          {c.risco || "—"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Sem dados de zoneamento disponíveis.
                </p>
              )}
            </>
          )}

          {tipo === "ndvi" && embrapa.ndvi && (
            <>
              <div className="text-center py-3">
                <p className="text-5xl font-black text-emerald-600">
                  {embrapa.ndvi.ndvi.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">NDVI — Índice de Vegetação (centroide)</p>
              </div>
              <Progress value={embrapa.ndvi.ndvi * 100} className="h-3" />
              <div className="flex justify-between text-xs text-muted-foreground px-1">
                <span>0.0 — Sem vegetação</span>
                <span>1.0 — Vegetação densa</span>
              </div>
              <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200">
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                  {embrapa.ndvi.classificacao}
                </p>
              </div>
              {embrapa.ndvi.evi != null && (
                <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                  <span className="text-xs text-muted-foreground">EVI</span>
                  <span className="text-sm font-bold">{embrapa.ndvi.evi.toFixed(2)}</span>
                </div>
              )}
              {embrapa.ndvi.periodo && (
                <p className="text-[10px] text-muted-foreground">
                  Período: {embrapa.ndvi.periodo}
                </p>
              )}
              {embrapa.ndvi.fonte && (
                <p className="text-[10px] text-muted-foreground text-right">
                  Fonte: {embrapa.ndvi.fonte}
                </p>
              )}

              <div className="border-t pt-3 mt-2">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    <Map className="w-4 h-4 text-indigo-500" />
                    Mapa de Variabilidade
                  </p>
                  {ativoId && onAnaliseVariabilidade && !ndviGridData?.points?.length && (
                    <Button
                      size="sm" variant="outline"
                      className="h-7 text-xs gap-1"
                      disabled={analisandoGrid}
                      onClick={() => onAnaliseVariabilidade(ativoId)}
                      data-testid={`button-variabilidade-${ativoId}`}
                    >
                      {analisandoGrid
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <BarChart3 className="w-3 h-3" />
                      }
                      {analisandoGrid ? "Analisando..." : "Analisar Variabilidade"}
                    </Button>
                  )}
                </div>

                {ndviGridData?.points?.length > 0 ? (
                  <div className="space-y-3">
                    <NDVIHeatMap data={ndviGridData} polygon={ndviGridData.polygon} />
                    <ZonasPanel data={ndviGridData} />
                  </div>
                ) : !analisandoGrid ? (
                  <p className="text-xs text-muted-foreground text-center py-3">
                    Clique em "Analisar Variabilidade" para gerar o mapa de calor NDVI com zonas de manejo.
                    O sistema amostra {5*5} pontos via SATVeg/MODIS dentro do polígono do ativo.
                  </p>
                ) : (
                  <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-xs">Consultando SATVeg ({5*5} pontos)...</span>
                  </div>
                )}
              </div>
            </>
          )}

        </div>
      </DialogContent>
    </Dialog>
  );
}

function AtivoRankCard({ ativo, rank, onEnriquecer, enriquecendo, onAnaliseVariabilidade, analisandoGrid }: {
  ativo: any; rank: number; onEnriquecer: (id: number) => void; enriquecendo: boolean;
  onAnaliseVariabilidade: (id: number) => void; analisandoGrid: boolean;
}) {
  const [modal, setModal] = useState<ModalTipo>(null);
  const [, navigate] = useLocation();

  const embrapa = ativo.camposEspecificos?.embrapa;
  const ndviGridData = ativo.camposEspecificos?.ndviGrid;
  const embrapaUpdatedAt = ativo.camposEspecificos?.embrapaUpdatedAt;
  const score   = calcularScore(embrapa);
  const medalha = getMedalha(rank);
  const badge   = getScoreBadge(score);

  const botoes = [
    { key: "solo",     icon: FlaskConical, label: "Solo",     disabled: !embrapa?.solo,      cor: "text-amber-600" },
    { key: "clima",    icon: Droplets,     label: "Clima",    disabled: !embrapa?.clima,     cor: "text-blue-500"  },
    { key: "culturas", icon: Wheat,        label: "Culturas", disabled: !embrapa?.zoneamento,cor: "text-green-600" },
    { key: "ndvi",     icon: Leaf,         label: "NDVI",     disabled: !embrapa?.ndvi,      cor: "text-emerald-600"},
  ] as const;

  return (
    <>
      <Card className={cn(
        "transition-all duration-200 hover:shadow-md",
        rank === 1 && "border-yellow-300 dark:border-yellow-700",
        rank === 2 && "border-slate-300 dark:border-slate-600",
        rank === 3 && "border-amber-300 dark:border-amber-700",
      )} data-testid={`card-ativo-rank-${ativo.id}`}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">

            <div className={cn("text-2xl font-black shrink-0 w-10 text-center mt-1", medalha.cor)}>
              {medalha.emoji}
            </div>

            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate" data-testid={`text-ativo-title-${ativo.id}`}>{ativo.title}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {ativo.estado && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> {ativo.estado}
                      </span>
                    )}
                    <Badge variant="outline" className="text-[10px]">
                      {ativo.type}
                    </Badge>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p className="text-xl font-black text-primary" data-testid={`text-score-${ativo.id}`}>{score}</p>
                  <p className="text-[10px] text-muted-foreground">pts</p>
                </div>
              </div>

              <div className="space-y-1">
                <Progress value={score} className="h-1.5" />
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className={cn("text-[10px]", badge.cls)}>
                    {badge.label}
                  </Badge>
                  {embrapa?.ndvi && (
                    <span className="text-[10px] text-muted-foreground">
                      NDVI {embrapa.ndvi.ndvi.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                {botoes.map(b => {
                  const Icon = b.icon;
                  return (
                    <Button
                      key={b.key}
                      variant="outline"
                      size="sm"
                      className={cn(
                        "h-7 text-xs gap-1 px-2",
                        b.disabled && "opacity-40 cursor-not-allowed"
                      )}
                      disabled={b.disabled}
                      onClick={() => !b.disabled && setModal(b.key as ModalTipo)}
                      data-testid={`button-modal-${b.key}-${ativo.id}`}
                    >
                      <Icon className={cn("w-3 h-3", b.cor)} />
                      {b.label}
                    </Button>
                  );
                })}

                <div className="ml-auto flex items-center gap-1.5">
                  {!embrapa ? (
                    <Button
                      variant="outline" size="sm"
                      className="h-7 text-xs gap-1 px-2"
                      disabled={enriquecendo}
                      onClick={() => onEnriquecer(ativo.id)}
                      data-testid={`button-analisar-${ativo.id}`}
                    >
                      {enriquecendo
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <RefreshCw className="w-3 h-3" />
                      }
                      Analisar
                    </Button>
                  ) : (
                    <Button
                      variant="ghost" size="sm"
                      className="h-7 text-[10px] gap-1 px-2 text-muted-foreground"
                      disabled={enriquecendo}
                      onClick={() => onEnriquecer(ativo.id)}
                      data-testid={`button-atualizar-${ativo.id}`}
                    >
                      {enriquecendo
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <RefreshCw className="w-3 h-3" />
                      }
                      Atualizar
                    </Button>
                  )}
                  <Button
                    variant="ghost" size="sm"
                    className="h-7 text-xs gap-1 px-2"
                    onClick={() => navigate(`/ativos/${ativo.id}`)}
                    data-testid={`button-ver-ativo-${ativo.id}`}
                  >
                    <ExternalLink className="w-3 h-3" />
                    Ver
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <ModalDetalhes
        tipo={modal}
        embrapa={embrapa}
        titulo={ativo.title}
        onClose={() => setModal(null)}
        ativoId={ativo.id}
        ndviGridData={ndviGridData}
        onAnaliseVariabilidade={onAnaliseVariabilidade}
        analisandoGrid={analisandoGrid}
        embrapaUpdatedAt={embrapaUpdatedAt}
      />
    </>
  );
}

export default function InteligenciaAgroPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filtroTipo, setFiltroTipo] = useState("all");
  const [filtroScore, setFiltroScore] = useState("all");
  const [enriquecendoId, setEnriquecendoId] = useState<number | null>(null);
  const [analisandoGridId, setAnalisandoGridId] = useState<number | null>(null);

  const { data: ativos = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/matching/assets"],
    queryFn: () => apiRequest("GET", "/api/matching/assets").then(r => r.json()),
  });

  const enriquecerMutation = useMutation({
    mutationFn: ({ id, force }: { id: number; force?: boolean }) =>
      apiRequest("POST", `/api/matching/assets/${id}/enriquecer-embrapa`, { force: force || false }).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/matching/assets"] });
      if (data.cached) {
        toast({ title: "Dados carregados do cache", description: "Clique em 'Atualizar' para buscar dados novos." });
      } else {
        toast({ title: "Análise concluída!", description: "Dados Embrapa atualizados com sucesso." });
      }
      setEnriquecendoId(null);
    },
    onError: (err: any) => {
      toast({ title: "Erro ao analisar", description: err.message, variant: "destructive" });
      setEnriquecendoId(null);
    },
  });

  const ndviGridMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/matching/assets/${id}/ndvi-grid`, { gridSize: 5 }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/matching/assets"] });
      toast({ title: "Variabilidade NDVI analisada!", description: "Mapa de calor e zonas de manejo gerados." });
      setAnalisandoGridId(null);
    },
    onError: (err: any) => {
      toast({ title: "Erro na análise de variabilidade", description: err.message, variant: "destructive" });
      setAnalisandoGridId(null);
    },
  });

  const handleEnriquecer = (id: number) => {
    setEnriquecendoId(id);
    const ativo = ativos.find((a: any) => a.id === id);
    const hasData = !!ativo?.camposEspecificos?.embrapa;
    enriquecerMutation.mutate({ id, force: hasData });
  };

  const handleAnaliseVariabilidade = (id: number) => {
    setAnalisandoGridId(id);
    ndviGridMutation.mutate(id);
  };

  const ativosRankeados = useMemo(() => {
    const rurais = ativos.filter((a: any) =>
      a.type === "TERRA" || a.type === "AGRO"
    );

    const filtrados = rurais.filter((a: any) => {
      if (filtroTipo !== "all" && a.type !== filtroTipo) return false;
      const score = calcularScore(a.camposEspecificos?.embrapa);
      if (filtroScore === "excelente" && score < 75) return false;
      if (filtroScore === "bom" && (score < 55 || score >= 75)) return false;
      if (filtroScore === "regular" && (score < 35 || score >= 55)) return false;
      if (filtroScore === "baixo" && score >= 35) return false;
      if (filtroScore === "sem_analise" && a.camposEspecificos?.embrapa) return false;
      return true;
    });

    return filtrados.sort((a: any, b: any) => {
      const sa = calcularScore(a.camposEspecificos?.embrapa);
      const sb = calcularScore(b.camposEspecificos?.embrapa);
      return sb - sa;
    });
  }, [ativos, filtroTipo, filtroScore]);

  const semAnalise = ativos.filter((a: any) =>
    (a.type === "TERRA" || a.type === "AGRO") && !a.camposEspecificos?.embrapa
  ).length;

  const mediaScore = useMemo(() => {
    const comDados = ativosRankeados.filter(a =>
      a.camposEspecificos?.embrapa
    );
    if (comDados.length === 0) return 0;
    const soma = comDados.reduce((acc: number, a: any) =>
      acc + calcularScore(a.camposEspecificos?.embrapa), 0
    );
    return Math.round(soma / comDados.length);
  }, [ativosRankeados]);

  const handleAnalisarTodos = async () => {
    const semDados = ativos.filter((a: any) =>
      (a.type === "TERRA" || a.type === "AGRO") && !a.camposEspecificos?.embrapa
    );
    for (const ativo of semDados) {
      setEnriquecendoId(ativo.id);
      await enriquecerMutation.mutateAsync({ id: ativo.id, force: false }).catch(() => {});
      await new Promise(r => setTimeout(r, 800));
    }
    setEnriquecendoId(null);
    toast({ title: "✅ Análise em lote concluída!" });
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Leaf className="w-6 h-6 text-green-600" />
            Inteligência Agro
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Ranking de qualidade dos ativos rurais com dados oficiais Embrapa
          </p>
        </div>
        {semAnalise > 0 && (
          <Button
            size="sm" variant="outline" className="gap-2 h-8 shrink-0"
            onClick={handleAnalisarTodos}
            disabled={enriquecerMutation.isPending}
            data-testid="button-analisar-todos"
          >
            {enriquecerMutation.isPending
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />
            }
            Analisar todos ({semAnalise})
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-black text-primary" data-testid="text-total-rurais">{ativosRankeados.length}</p>
            <p className="text-xs text-muted-foreground">Ativos rurais</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-black text-green-600" data-testid="text-score-medio">{mediaScore}</p>
            <p className="text-xs text-muted-foreground">Score médio</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className={cn("text-2xl font-black", semAnalise > 0 ? "text-amber-500" : "text-green-600")} data-testid="text-sem-analise">
              {semAnalise}
            </p>
            <p className="text-xs text-muted-foreground">Sem análise</p>
          </CardContent>
        </Card>
      </div>

      {semAnalise > 0 && (
        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-900/10">
          <CardContent className="p-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-xs text-amber-800 dark:text-amber-300">
              <strong>{semAnalise} ativo{semAnalise > 1 ? "s" : ""}</strong> ainda não
              {semAnalise > 1 ? " foram analisados" : " foi analisado"}.
              Clique em "Analisar todos" ou em "Analisar" em cada card para buscar os dados da Embrapa.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2 flex-wrap">
        <Select value={filtroTipo} onValueChange={setFiltroTipo}>
          <SelectTrigger className="h-8 text-xs w-40" data-testid="select-filtro-tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="TERRA">🌿 Terras & Fazendas</SelectItem>
            <SelectItem value="AGRO">🌾 Agronegócio</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filtroScore} onValueChange={setFiltroScore}>
          <SelectTrigger className="h-8 text-xs w-44" data-testid="select-filtro-score">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os scores</SelectItem>
            <SelectItem value="excelente">⭐ Excelente (75+)</SelectItem>
            <SelectItem value="bom">👍 Bom (55–74)</SelectItem>
            <SelectItem value="regular">⚠️ Regular (35–54)</SelectItem>
            <SelectItem value="baixo">🔴 Baixo (0–34)</SelectItem>
            <SelectItem value="sem_analise">📭 Sem análise</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <TrendingUp className="w-3.5 h-3.5" />
          Score = NDVI (40%) + Solo (30%) + Zoneamento (30%)
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-sm">Carregando ativos...</span>
        </div>
      ) : ativosRankeados.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground space-y-2">
          <Leaf className="w-12 h-12 mx-auto opacity-20" />
          <p className="text-sm">Nenhum ativo rural encontrado.</p>
          <p className="text-xs">Cadastre ativos do tipo TERRA ou AGRO no Portfólio.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {ativosRankeados.map((ativo: any, i: number) => (
            <AtivoRankCard
              key={ativo.id}
              ativo={ativo}
              rank={i + 1}
              onEnriquecer={handleEnriquecer}
              enriquecendo={enriquecendoId === ativo.id}
              onAnaliseVariabilidade={handleAnaliseVariabilidade}
              analisandoGrid={analisandoGridId === ativo.id}
            />
          ))}
        </div>
      )}

    </div>
  );
}