import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Shield, Loader2, AlertTriangle, CheckCircle2, MapPin, TreePine, DollarSign, ChevronDown, ChevronUp, RefreshCw, AlertCircle, Landmark, Scale, Map as MapIcon } from "lucide-react";
import { EnrichmentProgressBar } from "@/components/enrichment-progress-bar";

interface DueDiligenceFundiariaProps {
  assetId: number;
  codigoIncra?: string;
  cpfCnpj?: string;
  lat?: number;
  lon?: number;
  areaIncraHa?: number;
  areaCarHa?: number;
  existingData?: any;
}

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const getColor = (s: number) => {
    if (s >= 80) return { text: "text-green-600", bg: "bg-green-100", bar: "bg-green-500" };
    if (s >= 60) return { text: "text-yellow-600", bg: "bg-yellow-100", bar: "bg-yellow-500" };
    if (s >= 40) return { text: "text-orange-600", bg: "bg-orange-100", bar: "bg-orange-500" };
    return { text: "text-red-600", bg: "bg-red-100", bar: "bg-red-500" };
  };
  const c = getColor(score);

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-bold", c.text)}>{score}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", c.bar)} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    sucesso: { label: "OK", className: "bg-green-100 text-green-700 border-green-200" },
    erro: { label: "Erro", className: "bg-red-100 text-red-700 border-red-200" },
    indisponivel: { label: "N/D", className: "bg-gray-100 text-gray-600 border-gray-200" },
    pendente: { label: "...", className: "bg-blue-100 text-blue-600 border-blue-200" },
  };
  const c = config[status] || config.pendente;
  return <Badge className={cn("text-[10px]", c.className)} data-testid={`badge-status-${status}`}>{c.label}</Badge>;
}

function DueDiligenceMap({ geoLayers, assetId }: { geoLayers: any; assetId: number }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const boundsRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!mapRef.current) return;
    const ro = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
        if (boundsRef.current) {
          setTimeout(() => {
            try { mapInstanceRef.current?.fitBounds(boundsRef.current, { padding: [30, 30] }); } catch {}
          }, 100);
        }
      }
    });
    ro.observe(mapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let mapInstance: any = null;

    (async () => {
      try {
        const L = (await import("leaflet")).default;
        await import("leaflet/dist/leaflet.css");
        if (cancelled || !mapRef.current) return;

        mapInstance = L.map(mapRef.current, { zoomControl: true, attributionControl: false });
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 18,
          attribution: "Tiles &copy; Esri",
        }).addTo(mapInstance);

        const allBounds: any[] = [];

        if (geoLayers?.sigefPolygon?.geometry) {
          const sigefLayer = L.geoJSON(geoLayers.sigefPolygon, {
            style: { color: "#059669", weight: 3, fillColor: "#10b981", fillOpacity: 0.15 },
          }).addTo(mapInstance).bindPopup(`<b>Polígono INCRA Certificado (SIGEF)</b><br><small>${geoLayers.sigefPolygon.properties?.fonte || ''}</small>`);
          allBounds.push(sigefLayer.getBounds());
        }

        if (geoLayers?.assetPolygon?.geometry && !geoLayers?.sigefPolygon?.geometry) {
          const assetGeoLayer = L.geoJSON(geoLayers.assetPolygon, {
            style: { color: "#16a34a", weight: 3, fillColor: "#22c55e", fillOpacity: 0.15, dashArray: "4,4" },
          }).addTo(mapInstance).bindPopup("<b>Polígono do Ativo (geom armazenada)</b>");
          allBounds.push(assetGeoLayer.getBounds());
        } else if (geoLayers?.assetPolygon?.geometry && geoLayers?.sigefPolygon?.geometry) {
          L.geoJSON(geoLayers.assetPolygon, {
            style: { color: "#6b7280", weight: 1.5, fillColor: "#9ca3af", fillOpacity: 0.05, dashArray: "6,4" },
          }).addTo(mapInstance).bindPopup("<b>Polígono do Ativo (geom armazenada)</b>");
        } else if (!geoLayers?.sigefPolygon?.geometry) {
          try {
            const res = await fetch(`/api/assets/${assetId}/geometry`, {
              credentials: 'include',
            });
            if (res.ok) {
              const geomData = await res.json();
              if (geomData?.geometry) {
                const assetGeoLayer = L.geoJSON(geomData.geometry, {
                  style: { color: "#16a34a", weight: 3, fillColor: "#22c55e", fillOpacity: 0.15 },
                }).addTo(mapInstance).bindPopup("<b>Polígono do Ativo</b>");
                allBounds.push(assetGeoLayer.getBounds());
              }
            }
          } catch {}
        }

        if (geoLayers?.assetPoint) {
          const { lat, lon } = geoLayers.assetPoint;
          L.circleMarker([lat, lon], {
            radius: 6, color: "#16a34a", fillColor: "#22c55e", fillOpacity: 0.9, weight: 2,
          }).addTo(mapInstance).bindPopup("Localização do ativo");
          if (allBounds.length === 0) {
            allBounds.push(L.latLngBounds([lat - 0.15, lon - 0.15], [lat + 0.15, lon + 0.15]));
          }
        }

        if (geoLayers?.prodesFeatures?.features?.length) {
          const prodesLayer = L.geoJSON(geoLayers.prodesFeatures, {
            style: { color: "#ef4444", weight: 1.5, fillColor: "#ef4444", fillOpacity: 0.35 },
            onEachFeature: (feature: any, layer: any) => {
              const p = feature.properties || {};
              layer.bindPopup(`<b>PRODES</b><br>Ano: ${p.ano}<br>Área: ${p.areaHa} ha`);
            },
          }).addTo(mapInstance);
          allBounds.push(prodesLayer.getBounds());
        }

        if (geoLayers?.sobreposicoesFeatures?.features?.length) {
          const layerColors: Record<string, string> = {
            ti: "#a855f7",
            quilombola: "#f59e0b",
            uc: "#3b82f6",
          };
          const overlapLayer = L.geoJSON(geoLayers.sobreposicoesFeatures, {
            style: (feature: any) => {
              const layerType = feature?.properties?.layer || "uc";
              const color = layerColors[layerType] || "#6366f1";
              return { color, weight: 2, fillColor: color, fillOpacity: 0.2, dashArray: "5,5" };
            },
            onEachFeature: (feature: any, layer: any) => {
              const p = feature.properties || {};
              layer.bindPopup(`<b>${p.tipo || "Área protegida"}</b><br>${p.nome || ""}`);
            },
          }).addTo(mapInstance);
          allBounds.push(overlapLayer.getBounds());
        }

        if (geoLayers?.carPolygon?.geometry) {
          const carLayer = L.geoJSON(geoLayers.carPolygon, {
            style: { color: "#0ea5e9", weight: 2.5, fillColor: "#38bdf8", fillOpacity: 0.1, dashArray: "8,4" },
          }).addTo(mapInstance).bindPopup("<b>Polígono CAR</b>");
          allBounds.push(carLayer.getBounds());
        }

        if (geoLayers?.carIncraIntersection?.geometry) {
          L.geoJSON(geoLayers.carIncraIntersection, {
            style: { color: "#f97316", weight: 2, fillColor: "#fb923c", fillOpacity: 0.3, dashArray: "3,6" },
          }).addTo(mapInstance).bindPopup("<b>Interseção CAR × INCRA</b>");
        }

        mapInstanceRef.current = mapInstance;
        setMapReady(true);
        setTimeout(() => {
          if (!cancelled && mapInstance) {
            mapInstance.invalidateSize();
            if (allBounds.length > 0) {
              let combined = allBounds[0];
              for (let i = 1; i < allBounds.length; i++) {
                if (allBounds[i] && allBounds[i].isValid()) combined = combined.extend(allBounds[i]);
              }
              if (combined && combined.isValid()) {
                boundsRef.current = combined;
                mapInstance.fitBounds(combined, { padding: [30, 30] });
              }
            }
          }
        }, 200);
      } catch (err) {
        console.warn("[DD Map] Erro ao carregar mapa:", err);
      }
    })();

    return () => { cancelled = true; mapInstanceRef.current = null; boundsRef.current = null; if (mapInstance) mapInstance.remove(); };
  }, [geoLayers, assetId]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <MapIcon className="w-4 h-4 text-emerald-500" />
          Mapa de Due Diligence
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!mapReady && (
          <div className="flex items-center justify-center h-[350px] text-muted-foreground text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando mapa...
          </div>
        )}
        <div
          ref={mapRef}
          data-testid="map-due-diligence"
          className="rounded-lg overflow-hidden"
          style={{ height: "350px", display: mapReady ? "block" : "none" }}
        />
        {mapReady && !geoLayers?.sigefPolygon?.geometry && !geoLayers?.assetPolygon?.geometry && (
          <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs" data-testid="alert-sem-poligono">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Polígono do imóvel não disponível — o mapa exibe apenas a localização aproximada (ponto). Para exibir o perímetro, cadastre a geometria do ativo ou aguarde a certificação SIGEF/INCRA.</span>
          </div>
        )}
        <div className="flex flex-wrap gap-3 mt-2 text-[10px]">
          <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-green-500 inline-block" /> Ativo</span>
          <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-red-500 inline-block" /> PRODES</span>
          <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-purple-500 inline-block" /> Terra Indígena</span>
          <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-amber-500 inline-block" /> Quilombola</span>
          <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-blue-500 inline-block" /> UC</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DueDiligenceFundiaria({
  assetId,
  codigoIncra,
  cpfCnpj,
  lat,
  lon,
  areaIncraHa,
  areaCarHa,
  existingData,
}: DueDiligenceFundiariaProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [data, setData] = useState<any>(existingData || null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const autoStartedRef = useRef(false);
  const prevAssetIdRef = useRef(assetId);

  useEffect(() => {
    if (prevAssetIdRef.current !== assetId) {
      prevAssetIdRef.current = assetId;
      setData(existingData || null);
      autoStartedRef.current = false;
    }
  }, [assetId, existingData]);

  useEffect(() => {
    if (existingData && !data) {
      setData(existingData);
    }
  }, [existingData]);

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const executarMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/geo/due-diligence-fundiaria", {
        codigoIncra,
        cpfCnpj,
        assetId,
        lat,
        lon,
        areaIncraHa,
        areaCarHa,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "Falha na consulta");
      }
      return res.json();
    },
    onSuccess: (result) => {
      setData(result);
      qc.invalidateQueries({ queryKey: ["/api/assets", String(assetId)] });
      toast({ title: "Due diligence fundiária concluída" });
    },
    onError: (err: any) => {
      toast({ title: "Erro na due diligence", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (!data && codigoIncra && !autoStartedRef.current) {
      autoStartedRef.current = true;
      executarMutation.mutate();
    }
  }, [codigoIncra, data]);

  if (!codigoIncra) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-3">
          <Shield className="w-10 h-10 mx-auto text-muted-foreground opacity-30" />
          <p className="text-sm text-muted-foreground" data-testid="text-dd-sem-incra">
            Código INCRA não disponível para este ativo
          </p>
          <p className="text-xs text-muted-foreground">
            A due diligence fundiária automática requer o código INCRA (obtido via CCIR)
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data && executarMutation.isPending) {
    return (
      <EnrichmentProgressBar
        message="Executando Due Diligence Fundiária..."
        icon={<Shield className="w-4 h-4" />}
      />
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-3">
          <Shield className="w-10 h-10 mx-auto text-muted-foreground opacity-30" />
          <p className="text-sm font-medium" data-testid="text-dd-disponivel">
            Due Diligence Fundiária
          </p>
          {executarMutation.isError && (
            <p className="text-sm text-destructive" data-testid="text-dd-erro">
              {executarMutation.error instanceof Error ? executarMutation.error.message : "Erro na consulta"}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Código INCRA: <span className="font-mono font-medium">{codigoIncra}</span>
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={executarMutation.isPending}
            onClick={() => executarMutation.mutate()}
            data-testid="button-executar-dd"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" /> Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  const scoreColor = (s: number) => {
    if (s >= 80) return { text: "text-green-600", bg: "bg-green-50 border-green-200", label: "Baixo risco" };
    if (s >= 60) return { text: "text-yellow-600", bg: "bg-yellow-50 border-yellow-200", label: "Atenção" };
    if (s >= 40) return { text: "text-orange-600", bg: "bg-orange-50 border-orange-200", label: "Risco moderado" };
    return { text: "text-red-600", bg: "bg-red-50 border-red-200", label: "Risco elevado" };
  };

  const sc = scoreColor(data?.scoreRiscoFundiario ?? 0);
  const prodes = data?.prodes;
  const sobreposicoes = data?.sobreposicoes;
  const carVsIncra = data?.carVsIncra;
  const sicor = data?.sicor;
  const itrVtn = data?.itrVtn;
  const statusMap = data?.status || {};

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium">Due Diligence Fundiária</p>
            {data?.consultadoEm && (
              <Badge className="text-xs bg-blue-100 text-blue-700 border-blue-200" data-testid="badge-dd-data">
                {new Date(data.consultadoEm).toLocaleDateString("pt-BR")}
              </Badge>
            )}
            <Badge variant="outline" className="text-xs font-mono" data-testid="badge-dd-incra">
              INCRA: {data?.codigoIncra}
            </Badge>
          </div>
          <Button
            size="sm" variant="outline" className="gap-1.5 shrink-0"
            disabled={executarMutation.isPending}
            onClick={() => executarMutation.mutate()}
            data-testid="button-atualizar-dd"
          >
            {executarMutation.isPending
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Atualizando...</>
              : <><RefreshCw className="w-3.5 h-3.5" /> Atualizar</>}
          </Button>
        </CardContent>
      </Card>

      <Card className={cn("border", sc.bg)}>
        <CardContent className="p-5">
          <div className="flex items-center gap-4">
            <div className="shrink-0">
              <div className={cn("w-16 h-16 rounded-full flex items-center justify-center border-4",
                (data?.scoreRiscoFundiario ?? 0) >= 80 ? "border-green-300 bg-green-50" :
                (data?.scoreRiscoFundiario ?? 0) >= 60 ? "border-yellow-300 bg-yellow-50" :
                (data?.scoreRiscoFundiario ?? 0) >= 40 ? "border-orange-300 bg-orange-50" :
                "border-red-300 bg-red-50"
              )}>
                <span className={cn("text-xl font-bold", sc.text)} data-testid="text-score-dd">
                  {data?.scoreRiscoFundiario ?? 0}
                </span>
              </div>
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2">
                <p className={cn("text-lg font-bold", sc.text)} data-testid="text-risco-label">{sc.label}</p>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {data?.scoreBreakdown && Object.entries(data.scoreBreakdown).map(([key, val]) => (
                  <ScoreGauge key={key} score={val as number} label={
                    key === 'ambiental' ? 'Ambiental' :
                    key === 'juridico' ? 'Jurídico' :
                    key === 'documental' ? 'Documental' :
                    key === 'financeiro' ? 'Financeiro' :
                    'Valuation'
                  } />
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            {Object.entries(statusMap).map(([key, status]) => (
              <div key={key} className="flex items-center gap-1 text-[10px]">
                <span className="text-muted-foreground capitalize">{key}:</span>
                <StatusBadge status={status as string} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {data?.geoLayers && (
        <DueDiligenceMap geoLayers={data.geoLayers} assetId={assetId} />
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleSection('prodes')}>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <TreePine className="w-4 h-4 text-red-500" />
                PRODES — Desmatamento Histórico
              </span>
              {expandedSections.prodes ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {prodes ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-muted/40 rounded-lg p-2.5 text-center">
                    <p className={cn("text-xl font-bold", prodes.totalAreaHa > 10 ? "text-red-600" : "text-green-600")}
                       data-testid="text-prodes-area">
                      {prodes.totalAreaHa.toLocaleString("pt-BR")}
                    </p>
                    <p className="text-[10px] text-muted-foreground">ha desmatados</p>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-2.5 text-center">
                    <p className="text-xl font-bold" data-testid="text-prodes-poligonos">{prodes.poligonos}</p>
                    <p className="text-[10px] text-muted-foreground">polígonos</p>
                  </div>
                </div>
                {prodes.totalAreaHa === 0 && (
                  <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    Sem desmatamento histórico detectado
                  </div>
                )}
                {expandedSections.prodes && prodes.porAno?.length > 0 && (
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {prodes.porAno.map((item: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1"
                           data-testid={`row-prodes-${i}`}>
                        <span className="font-medium">{item.ano}</span>
                        <span>{item.areaHa.toLocaleString("pt-BR")} ha</span>
                        <span className="text-muted-foreground">{item.count} polígono(s)</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">{prodes.fonte}</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                Dados PRODES indisponíveis
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleSection('sobreposicoes')}>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-purple-500" />
                Sobreposições (TI / Quilombola / UC)
              </span>
              {expandedSections.sobreposicoes ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sobreposicoes ? (
              <>
                <div className={cn("rounded-lg p-3 text-center",
                  sobreposicoes.riscoMaximo === 'alto' ? "bg-red-50" :
                  sobreposicoes.riscoMaximo === 'medio' ? "bg-yellow-50" :
                  "bg-green-50"
                )}>
                  {sobreposicoes.totalSobreposicoes > 0 ? (
                    <>
                      <p className={cn("text-2xl font-bold",
                        sobreposicoes.riscoMaximo === 'alto' ? "text-red-600" :
                        sobreposicoes.riscoMaximo === 'medio' ? "text-yellow-600" :
                        "text-green-600"
                      )} data-testid="text-sobreposicoes-total">{sobreposicoes.totalSobreposicoes}</p>
                      <p className={cn("text-xs",
                        sobreposicoes.riscoMaximo === 'alto' ? "text-red-600" :
                        "text-yellow-600"
                      )}>sobreposição(ões) detectada(s)</p>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-6 h-6 text-green-600 mx-auto" />
                      <p className="text-xs text-green-700 font-medium mt-1" data-testid="text-sem-sobreposicao">
                        Sem sobreposições detectadas
                      </p>
                    </>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-center">
                  <div className="bg-muted/30 rounded p-1.5">
                    <p className="text-sm font-bold" data-testid="text-ti-count">{sobreposicoes.terrasIndigenas?.length || 0}</p>
                    <p className="text-[9px] text-muted-foreground">TI</p>
                  </div>
                  <div className="bg-muted/30 rounded p-1.5">
                    <p className="text-sm font-bold" data-testid="text-quilombola-count">{sobreposicoes.quilombolas?.length || 0}</p>
                    <p className="text-[9px] text-muted-foreground">Quilombola</p>
                  </div>
                  <div className="bg-muted/30 rounded p-1.5">
                    <p className="text-sm font-bold" data-testid="text-uc-count">{sobreposicoes.unidadesConservacao?.length || 0}</p>
                    <p className="text-[9px] text-muted-foreground">UC</p>
                  </div>
                </div>
                {expandedSections.sobreposicoes && (
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {[...(sobreposicoes.terrasIndigenas || []), ...(sobreposicoes.quilombolas || []), ...(sobreposicoes.unidadesConservacao || [])].map((area: any, i: number) => (
                      <div key={i} className={cn("text-xs rounded px-2.5 py-2 space-y-0.5",
                        area.nivelRisco === 'alto' ? "bg-red-50" : "bg-yellow-50"
                      )} data-testid={`row-sobreposicao-${i}`}>
                        <div className="flex justify-between">
                          <span className="font-medium">{area.nome}</span>
                          <Badge variant="outline" className="text-[10px]">{area.tipo}</Badge>
                        </div>
                        {area.categoria && <p className="text-muted-foreground">{area.categoria}</p>}
                        {(area.percentualSobreposicao > 0 || area.areaIntersecaoHa > 0) && (
                          <div className="flex gap-2 text-[10px]">
                            {area.percentualSobreposicao > 0 && (
                              <span className="text-red-600 font-semibold" data-testid={`text-overlap-pct-${i}`}>
                                {area.percentualSobreposicao}% sobreposição
                              </span>
                            )}
                            {area.areaIntersecaoHa > 0 && (
                              <span className="text-muted-foreground">
                                ({area.areaIntersecaoHa.toLocaleString("pt-BR")} ha)
                              </span>
                            )}
                          </div>
                        )}
                        {area.nivelRisco && (
                          <Badge className={cn("text-[10px]",
                            area.nivelRisco === 'alto' ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"
                          )}>Risco {area.nivelRisco}</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">{sobreposicoes.fonte}</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                Dados de sobreposição indisponíveis
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Scale className="w-4 h-4 text-blue-500" />
              CAR vs INCRA
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {carVsIncra ? (
              <>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Área CAR</span>
                    <span className="font-medium" data-testid="text-area-car">
                      {carVsIncra.areaCarHa !== null ? `${carVsIncra.areaCarHa.toLocaleString("pt-BR")} ha` : "N/D"}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Área INCRA</span>
                    <span className="font-medium" data-testid="text-area-incra">
                      {carVsIncra.areaIncraHa !== null ? `${carVsIncra.areaIncraHa.toLocaleString("pt-BR")} ha` : "N/D"}
                    </span>
                  </div>
                  {carVsIncra.diferencaHa !== null && (
                    <>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Diferença</span>
                        <span className={cn("font-medium",
                          carVsIncra.alertaDiscrepancia ? "text-red-600" : "text-green-600"
                        )} data-testid="text-diferenca-area">
                          {carVsIncra.diferencaHa > 0 ? "+" : ""}{carVsIncra.diferencaHa.toLocaleString("pt-BR")} ha ({carVsIncra.diferencaPct > 0 ? "+" : ""}{carVsIncra.diferencaPct}%)
                        </span>
                      </div>
                      {carVsIncra.alertaDiscrepancia && (
                        <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2" data-testid="alert-discrepancia">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          Discrepância {`>`} 5% — verificar documentação
                        </div>
                      )}
                      {!carVsIncra.alertaDiscrepancia && (
                        <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          Áreas consistentes
                        </div>
                      )}
                    </>
                  )}
                </div>
                {carVsIncra.sobreposicaoGeometrica && (
                  <div className="space-y-1.5 mt-3 pt-3 border-t">
                    <p className="text-xs font-medium text-muted-foreground">Sobreposição Geométrica</p>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Área de interseção</span>
                      <span className="font-medium" data-testid="text-intersecao-area">
                        {carVsIncra.sobreposicaoGeometrica.areaIntersecaoHa.toLocaleString("pt-BR")} ha
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">% sobreposição</span>
                      <span className="font-medium" data-testid="text-intersecao-pct">
                        {carVsIncra.sobreposicaoGeometrica.percentualSobreposicao}%
                      </span>
                    </div>
                    <div className={cn(
                      "flex items-center gap-2 text-xs rounded-lg px-3 py-2",
                      carVsIncra.sobreposicaoGeometrica.carCobreIncra
                        ? "text-green-700 bg-green-50"
                        : "text-amber-700 bg-amber-50"
                    )} data-testid="status-cobertura-car">
                      {carVsIncra.sobreposicaoGeometrica.carCobreIncra ? (
                        <><CheckCircle2 className="w-3.5 h-3.5 shrink-0" />CAR cobre totalmente o polígono INCRA</>
                      ) : (
                        <><AlertTriangle className="w-3.5 h-3.5 shrink-0" />CAR não cobre totalmente o polígono INCRA</>
                      )}
                    </div>
                  </div>
                )}
                {!carVsIncra.sobreposicaoGeometrica && assetId && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-[10px] text-muted-foreground italic">
                      Sobreposição geométrica: polígono CAR não encontrado na base
                    </p>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">{carVsIncra.fonte}</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">N/D</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleSection('sicor')}>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Landmark className="w-4 h-4 text-amber-500" />
                SICOR — Hipotecas
              </span>
              {expandedSections.sicor ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sicor ? (
              <>
                <div className={cn("rounded-lg p-3 text-center",
                  sicor.temHipotecaAtiva ? "bg-amber-50" : "bg-green-50"
                )}>
                  {sicor.temHipotecaAtiva ? (
                    <>
                      <p className="text-2xl font-bold text-amber-600" data-testid="text-sicor-operacoes">
                        {sicor.totalOperacoes}
                      </p>
                      <p className="text-xs text-amber-600">operação(ões) de crédito</p>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-6 h-6 text-green-600 mx-auto" />
                      <p className="text-xs text-green-700 font-medium mt-1" data-testid="text-sicor-ok">
                        Sem hipotecas ativas
                      </p>
                    </>
                  )}
                </div>
                {sicor.valorTotal > 0 && (
                  <div className="text-xs text-center text-muted-foreground" data-testid="text-sicor-valor">
                    Valor total: R$ {sicor.valorTotal.toLocaleString("pt-BR")}
                  </div>
                )}
                {expandedSections.sicor && sicor.operacoes?.length > 0 && (
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {sicor.operacoes.slice(0, 10).map((op: any, i: number) => (
                      <div key={i} className="text-xs bg-muted/30 rounded px-2.5 py-1.5 space-y-0.5"
                           data-testid={`row-sicor-${i}`}>
                        <div className="flex justify-between">
                          <span className="font-medium truncate">{op.programa}</span>
                          <span>R$ {op.valor?.toLocaleString("pt-BR")}</span>
                        </div>
                        {op.instituicao && <p className="text-muted-foreground truncate">{op.instituicao}</p>}
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">{sicor.fonte}</p>
              </>
            ) : (
              <div className="text-center py-4 space-y-1">
                <AlertCircle className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
                <p className="text-xs text-muted-foreground font-medium" data-testid="text-sicor-indisponivel">
                  {cpfCnpj ? "Consulta SICOR por titular indisponível" : "CPF/CNPJ não informado"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {cpfCnpj
                    ? "A API pública do BCB/SICOR não permite consulta por CPF/CNPJ. Dados individuais requerem convênio com o Banco Central."
                    : "Informe o CPF ou CNPJ do proprietário para consultar operações de crédito rural."}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-green-600" />
              ITR / VTN
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {itrVtn ? (
              <>
                <div className="space-y-1.5">
                  {itrVtn.vtn !== null ? (
                    <>
                      <div className="bg-muted/40 rounded-lg p-3 text-center">
                        <p className="text-xl font-bold text-green-700" data-testid="text-vtn-valor">
                          R$ {itrVtn.vtn.toLocaleString("pt-BR")}
                        </p>
                        <p className="text-[10px] text-muted-foreground">Valor da Terra Nua (VTN)</p>
                      </div>
                      {itrVtn.vtnPorHa !== null && (
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">VTN/ha</span>
                          <span className="font-medium" data-testid="text-vtn-por-ha">
                            R$ {itrVtn.vtnPorHa.toLocaleString("pt-BR")}
                          </span>
                        </div>
                      )}
                      {itrVtn.areaDeclarada !== null && (
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Área declarada</span>
                          <span className="font-medium">{itrVtn.areaDeclarada.toLocaleString("pt-BR")} ha</span>
                        </div>
                      )}
                      {itrVtn.aliquota !== null && (
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Alíquota</span>
                          <span className="font-medium">{itrVtn.aliquota}%</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="bg-muted/40 rounded-lg p-3 text-center space-y-1">
                      <AlertCircle className="w-6 h-6 text-muted-foreground mx-auto mb-1" />
                      <p className="text-xs text-muted-foreground font-medium" data-testid="text-vtn-nd">
                        VTN não disponível via API pública
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        O Valor da Terra Nua por propriedade é consultável apenas via CAFIR/Receita Federal com certificado digital (e-CPF/e-CNPJ).
                      </p>
                    </div>
                  )}
                  {itrVtn.nirf && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">NIRF</span>
                      <span className="font-mono font-medium">{itrVtn.nirf}</span>
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">{itrVtn.fonte}</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                Dados ITR/VTN indisponíveis
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
