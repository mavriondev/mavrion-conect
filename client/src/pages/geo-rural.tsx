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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, SortableTableHead,
} from "@/components/ui/table";
import { useTableSort } from "@/hooks/use-table-sort";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Search, Loader2, X, Mountain, Droplets, Zap as ZapIcon, ChevronLeft, ChevronRight, Map as MapIcon, Check, ExternalLink, TreePine, Download, BarChart2, Gauge, Ruler, MapPin, Eye, AlertTriangle, RefreshCcw, Wifi, WifiOff, Activity, TrendingUp, Play, Filter, Trophy, Sprout, ChevronsUpDown } from "lucide-react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
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

      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        attribution: "&copy; Esri, Maxar, Earthstar Geographics",
        maxZoom: 18,
      }).addTo(map);

      mapRef.current = map;

      if (onMapClick) {
        map.on('click', (e: any) => {
          onMapClick(e.latlng.lat, e.latlng.lng);
        });
      }

      if (analysisLayers?.rios?.features?.length > 0) {
        L.geoJSON(analysisLayers!.rios, {
          style: { color: "#3b82f6", weight: 2, opacity: 0.8 },
          pointToLayer: (_: any, latlng: any) =>
            L.circleMarker(latlng, { radius: 3, color: "#3b82f6", fillColor: "#3b82f6", fillOpacity: 0.8, weight: 1 }),
        }).addTo(map);
      }
      if (analysisLayers?.massas?.features?.length > 0) {
        L.geoJSON(analysisLayers!.massas, {
          style: { color: "#2563eb", weight: 1, fillColor: "#93c5fd", fillOpacity: 0.4 },
          pointToLayer: (_: any, latlng: any) =>
            L.circleMarker(latlng, { radius: 3, color: "#2563eb", fillColor: "#93c5fd", fillOpacity: 0.6, weight: 1 }),
        }).addTo(map);
      }
      if (analysisLayers?.energia?.features?.length > 0) {
        L.geoJSON(analysisLayers!.energia, {
          style: { color: "#f59e0b", weight: 2, opacity: 0.8, dashArray: "5,5" },
          pointToLayer: (_: any, latlng: any) =>
            L.circleMarker(latlng, { radius: 3, color: "#f59e0b", fillColor: "#f59e0b", fillOpacity: 0.8, weight: 1 }),
        }).addTo(map);
      }

      const bounds: any[] = [];
      const fg = L.featureGroup();

      features.forEach((f: any) => {
        if (!f.geometry) return;
        const isSelected = selectedFeature && f.id === selectedFeature.id;
        const featureColor = isSelected ? "#ef4444" : "#22c55e";
        const featureFill = isSelected ? "#fca5a5" : "#86efac";
        const layer = L.geoJSON(f, {
          style: {
            color: featureColor,
            weight: isSelected ? 3 : 2,
            fillColor: featureFill,
            fillOpacity: isSelected ? 0.35 : 0.2,
          },
          pointToLayer: (_: any, latlng: any) =>
            L.circleMarker(latlng, { radius: 5, color: featureColor, fillColor: featureFill, fillOpacity: 0.5, weight: 2 }),
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

      [100, 300, 600, 1200].forEach(ms => {
        setTimeout(() => {
          if (!cancelled && mapRef.current) {
            mapRef.current.invalidateSize();
            if (fg.getLayers().length > 0) {
              mapRef.current.fitBounds(fg.getBounds().pad(0.1));
            }
          }
        }, ms);
      });
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

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (mapRef.current) {
        mapRef.current.invalidateSize();
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  return <div ref={containerRef} style={{ width: "100%", height: "100%", minHeight: "400px" }} className="rounded-lg" data-testid="map-container" />;
}

function scoreColor(score: number | null): { color: string; fill: string } {
  if (score == null) return { color: "#6b7280", fill: "#9ca3af" };
  if (score >= 70) return { color: "#16a34a", fill: "#86efac" };
  if (score >= 40) return { color: "#d97706", fill: "#fcd34d" };
  return { color: "#dc2626", fill: "#fca5a5" };
}

function AssetExplorerMap({ onSelectAsset, onAnalyzeSicar }: { onSelectAsset: (id: number) => void; onAnalyzeSicar?: (feature: any) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const popupRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSicarProps, setSelectedSicarProps] = useState<any>(null);
  const [sicarSheetOpen, setSicarSheetOpen] = useState(false);
  const [mapStyle, setMapStyle] = useState<"satellite" | "streets" | "topo" | "dark">("satellite");
  const [projection, setProjection] = useState<"globe" | "mercator">("globe");
  const [show3DBuildings, setShow3DBuildings] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchUf, setSearchUf] = useState("");
  const [searchMunicipio, setSearchMunicipio] = useState("");
  const [searchAreaMin, setSearchAreaMin] = useState("");
  const [searchAreaMax, setSearchAreaMax] = useState("");


  const [searchAltMediaMin, setSearchAltMediaMin] = useState("");
  const [searchAltMediaMax, setSearchAltMediaMax] = useState("");
  const [searchArgilaMediaMin, setSearchArgilaMediaMin] = useState("");
  const [searchArgilaMediaMax, setSearchArgilaMediaMax] = useState("");
  const [searchLimit, setSearchLimit] = useState("50");
  const [sicarLoading, setSicarLoading] = useState(false);
  const [sicarData, setSicarData] = useState<any>(null);
  const [sicarTotal, setSicarTotal] = useState(0);
  const [municipios, setMunicipios] = useState<string[]>([]);
  const [municipiosLoading, setMunicipiosLoading] = useState(false);
  const [municipioOpen, setMunicipioOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!searchUf) { setMunicipios([]); setSearchMunicipio(""); return; }
    let cancelled = false;
    setMunicipiosLoading(true);
    fetch(`/api/municipios?uf=${searchUf}`, { credentials: "include" })
      .then(r => r.json())
      .then((data: any[]) => {
        if (!cancelled) setMunicipios(data.map((m: any) => m.nome || m));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setMunicipiosLoading(false); });
    return () => { cancelled = true; };
  }, [searchUf]);

  const [selectedSicarGeom, setSelectedSicarGeom] = useState<any>(null);
  const [sicarImporting, setSicarImporting] = useState(false);
  const [sicarImported, setSicarImported] = useState(false);

  function handleSicarClick(props: any, _geometry?: any) {
    if (onAnalyzeSicar) {
      const feature = {
        type: "Feature",
        properties: props,
        geometry: _geometry || null,
      };
      onAnalyzeSicar(feature);
      return;
    }
    setSelectedSicarProps(props);
    setSelectedSicarGeom(_geometry || null);
    setSicarImporting(false);
    setSicarImported(false);
    setSicarSheetOpen(true);
  }

  async function importSicarAsset() {
    if (!selectedSicarProps || sicarImporting || sicarImported) return;
    setSicarImporting(true);
    try {
      const body: any = {
        cod_imovel: selectedSicarProps.cod_imovel,
        uf: selectedSicarProps.uf,
        municipio: selectedSicarProps.municipio,
        num_area: selectedSicarProps.num_area,
        ind_status: selectedSicarProps.ind_status,
        ind_tipo: selectedSicarProps.ind_tipo,
        condicao: selectedSicarProps.condicao,
        dat_criacao: selectedSicarProps.dat_criacao,
        m_fiscal: selectedSicarProps.m_fiscal,
        cod_municipio_ibge: selectedSicarProps.cod_municipio_ibge,
      };
      if (selectedSicarGeom) body.geojson = selectedSicarGeom;
      const resp = await fetch("/api/geo/fazendas/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (resp.status === 409) {
        toast({ title: "Já importado", description: "Esta propriedade já foi importada como ativo." });
        setSicarImported(true);
      } else if (resp.ok) {
        toast({ title: "Importado com sucesso", description: "Propriedade adicionada aos seus ativos." });
        setSicarImported(true);
      } else {
        const errData = await resp.json().catch(() => ({}));
        toast({ title: "Erro", description: errData.message || "Falha ao importar.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Erro", description: "Falha na conexão.", variant: "destructive" });
    } finally {
      setSicarImporting(false);
    }
  }

  async function searchSicar() {
    if (!searchUf) {
      toast({ title: "Selecione um estado (UF)", variant: "destructive" });
      return;
    }
    setSicarLoading(true);
    try {
      const limitNum = Math.max(1, Math.min(500, parseInt(searchLimit) || 50));
      const params = new URLSearchParams({ uf: searchUf, limit: String(limitNum) });
      if (searchMunicipio) params.set("municipio", searchMunicipio);
      if (searchAreaMin) params.set("areaMin", searchAreaMin);
      if (searchAreaMax) params.set("areaMax", searchAreaMax);
      params.set("tipo", "IRU");
      if (searchAltMediaMin) params.set("altMediaMin", searchAltMediaMin);
      if (searchAltMediaMax) params.set("altMediaMax", searchAltMediaMax);
      if (searchArgilaMediaMin) params.set("argilaMediaMin", searchArgilaMediaMin);
      if (searchArgilaMediaMax) params.set("argilaMediaMax", searchArgilaMediaMax);
      const resp = await fetch(`/api/geo/fazendas/geojson?${params.toString()}`, { credentials: "include" });
      if (!resp.ok) throw new Error("Erro ao buscar");
      const data = await resp.json();
      setSicarData(data);
      setSicarTotal(data.total || data.features?.length || 0);
      applySicarToMap(mapRef.current, data);
      toast({ title: `${data.features?.length || 0} propriedades encontradas (de ${data.total?.toLocaleString("pt-BR") || "?"} total)` });
    } catch (err: any) {
      toast({ title: "Erro na pesquisa", description: err.message, variant: "destructive" });
    } finally {
      setSicarLoading(false);
    }
  }

  function clearSicar() {
    setSicarData(null);
    setSicarTotal(0);
    setSearchUf("");
    setSearchMunicipio("");
    setSearchAreaMin("");
    setSearchAreaMax("");


    setSearchAltMediaMin("");
    setSearchAltMediaMax("");
    setSearchArgilaMediaMin("");
    setSearchArgilaMediaMax("");
    setSearchLimit("50");
    const map = mapRef.current;
    if (map) {
      if (map.getSource("sicar")) (map.getSource("sicar") as any).setData({ type: "FeatureCollection", features: [] });
      if (map.getSource("sicar-centers")) (map.getSource("sicar-centers") as any).setData({ type: "FeatureCollection", features: [] });
    }
  }

  function buildSicarCentroids(features: any[]) {
    return features.map((f: any) => {
      if (!f.geometry?.coordinates) return null;
      const coords: number[][] = [];
      const flatten = (arr: any[]): void => {
        if (typeof arr[0] === "number") { coords.push(arr as number[]); return; }
        arr.forEach((a: any) => flatten(a));
      };
      flatten(f.geometry.coordinates);
      if (coords.length === 0) return null;
      const lon = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      const p = f.properties || {};
      const areaLabel = p.num_area != null ? `${Number(p.num_area).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} ha` : "";
      return {
        type: "Feature",
        id: f.id,
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: { ...p, label: areaLabel },
      };
    }).filter(Boolean);
  }

  function applySicarToMap(map: any, data: any) {
    if (!map || !data?.features) return;
    const fc = { type: "FeatureCollection", features: data.features };
    if (map.getSource("sicar")) {
      (map.getSource("sicar") as any).setData(fc);
    }
    const centers = buildSicarCentroids(data.features);
    if (map.getSource("sicar-centers")) {
      (map.getSource("sicar-centers") as any).setData({ type: "FeatureCollection", features: centers });
    }
    if (data.features.length > 0) {
      import("maplibre-gl").then(({ LngLatBounds }) => {
        const bounds = new LngLatBounds();
        const flatten = (arr: any[]): void => {
          if (typeof arr[0] === "number") { bounds.extend(arr as [number, number]); return; }
          arr.forEach((a: any) => flatten(a));
        };
        data.features.forEach((f: any) => {
          if (f.geometry?.coordinates) flatten(f.geometry.coordinates);
        });
        try { if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, maxZoom: 13 }); } catch {}
      });
    }
  }

  const rasterStyle = (tiles: string[], attribution = "") => ({
    version: 8 as const,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      raster: {
        type: "raster" as const,
        tiles: [tiles[0]],
        tileSize: 256,
        attribution,
      },
    },
    layers: [{ id: "raster-layer", type: "raster" as const, source: "raster" }],
  });

  const STYLES: Record<string, any> = {
    satellite: rasterStyle(
      ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      "Esri"
    ),
    streets: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    topo: rasterStyle(
      ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
      "OpenTopoMap"
    ),
    dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  };

  function addLayersToMap(map: any) {
    if (map.getSource("sicar")) return;

    map.addSource("sicar", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    map.addLayer({
      id: "sicar-fill",
      type: "fill",
      source: "sicar",
      paint: {
        "fill-color": "#3b82f6",
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false], 0.5,
          0.25,
        ],
      },
    });

    map.addLayer({
      id: "sicar-border",
      type: "line",
      source: "sicar",
      paint: {
        "line-color": "#2563eb",
        "line-width": 1.5,
      },
    });

    map.addSource("sicar-centers", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    map.addLayer({
      id: "sicar-markers",
      type: "circle",
      source: "sicar-centers",
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          3, 5,
          8, 8,
          12, 10,
        ],
        "circle-color": "#3b82f6",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-opacity": 0.9,
      },
    });

    map.addLayer({
      id: "sicar-labels",
      type: "symbol",
      source: "sicar-centers",
      minzoom: 7,
      layout: {
        "text-field": ["get", "label"],
        "text-size": 11,
        "text-offset": [0, 1.8],
        "text-anchor": "top",
        "text-allow-overlap": false,
        "text-font": ["Open Sans Regular"],
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "rgba(0,0,0,0.7)",
        "text-halo-width": 1.5,
      },
    });

    map.on("mousemove", "sicar-fill", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "sicar-fill", () => { map.getCanvas().style.cursor = ""; });
    map.on("mousemove", "sicar-markers", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "sicar-markers", () => { map.getCanvas().style.cursor = ""; });

    map.on("click", "sicar-fill", (e: any) => {
      if (e.features.length > 0) handleSicarClick(e.features[0].properties, e.features[0].geometry);
    });
    map.on("click", "sicar-markers", (e: any) => {
      if (e.features.length > 0) handleSicarClick(e.features[0].properties, e.features[0].geometry);
    });
  }

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    const init = async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      await import("maplibre-gl/dist/maplibre-gl.css");
      if (cancelled || !containerRef.current) return;

      if (mapRef.current) { mapRef.current.remove(); }

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLES.satellite,
        center: [-51.9, -14.2],
        zoom: 4,
        pitch: 0,
        bearing: 0,
        ...({ projection: { type: "globe" } } as any),
        attributionControl: false,
      });

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
      map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
      map.addControl(new maplibregl.FullscreenControl(), "top-right");

      map.on("load", () => {
        if (cancelled) return;
        setLoading(false);
        addLayersToMap(map);
      });

      map.on("style.load", () => {
        if (cancelled) return;
        addLayersToMap(map);
        if (sicarData) applySicarToMap(map, sicarData);
      });

      mapRef.current = map;
    };
    init();
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setLoading(true);
    map.setStyle(STYLES[mapStyle]);
  }, [mapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try { (map as any).setProjection({ type: projection }); } catch {}
  }, [projection]);

  return (
    <div className="relative w-full h-[calc(100dvh-64px)]" data-testid="asset-explorer-map">
      <div ref={containerRef} className="w-full h-full rounded-lg border overflow-hidden" />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60 rounded-lg z-[500]">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      )}

      <div className="absolute top-3 left-3 z-[5] flex flex-col gap-2" style={{ maxHeight: "calc(100% - 24px)" }} data-testid="map-controls">
        <div className="bg-background/95 backdrop-blur-md rounded-xl shadow-xl border border-border/60 p-2.5 space-y-2 max-w-[240px]">
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className={cn(
              "flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-all",
              searchOpen
                ? "bg-emerald-600 text-white shadow-md"
                : "bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]"
            )}
            data-testid="btn-toggle-search"
          >
            <Search className="w-4 h-4" />
            Pesquisa SICAR
            {sicarData && <Badge className="text-[10px] px-1.5 py-0 ml-auto bg-white/20 text-white border-0">{sicarData.features?.length || 0}</Badge>}
          </button>

          {searchOpen && (
            <div className="space-y-1.5 pt-1 max-h-[60vh] overflow-y-auto pr-0.5">
              <Select value={searchUf} onValueChange={setSearchUf}>
                <SelectTrigger className="h-7 text-xs" data-testid="search-uf">
                  <SelectValue placeholder="UF *" />
                </SelectTrigger>
                <SelectContent>
                  {ESTADOS.map(uf => (
                    <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Popover open={municipioOpen} onOpenChange={setMunicipioOpen}>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "flex items-center justify-between w-full h-7 px-2 text-xs rounded-xl border bg-card text-left",
                      !searchMunicipio && "text-muted-foreground"
                    )}
                    disabled={!searchUf}
                    data-testid="search-municipio"
                  >
                    <span className="truncate">{searchMunicipio || "Município"}</span>
                    {municipiosLoading ? <Loader2 className="w-3 h-3 animate-spin shrink-0" /> : <ChevronsUpDown className="w-3 h-3 opacity-50 shrink-0" />}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[220px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Buscar cidade..." className="h-8 text-xs" />
                    <CommandList className="max-h-[200px]">
                      <CommandEmpty className="text-xs py-3 text-center">Nenhuma cidade encontrada</CommandEmpty>
                      <CommandGroup>
                        {searchMunicipio && (
                          <CommandItem
                            value="__clear__"
                            onSelect={() => { setSearchMunicipio(""); setMunicipioOpen(false); }}
                            className="text-xs text-muted-foreground"
                          >
                            <X className="w-3 h-3 mr-1.5" /> Limpar
                          </CommandItem>
                        )}
                        {municipios.map(m => (
                          <CommandItem
                            key={m}
                            value={m}
                            onSelect={() => { setSearchMunicipio(m); setMunicipioOpen(false); }}
                            className="text-xs"
                          >
                            <Check className={cn("w-3 h-3 mr-1.5", searchMunicipio === m ? "opacity-100" : "opacity-0")} />
                            {m}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <div className="grid grid-cols-2 gap-1">
                <Input
                  placeholder="Área mín (ha)"
                  type="number"
                  value={searchAreaMin}
                  onChange={e => setSearchAreaMin(e.target.value)}
                  className="h-7 text-xs"
                  data-testid="search-area-min"
                />
                <Input
                  placeholder="Área máx (ha)"
                  type="number"
                  value={searchAreaMax}
                  onChange={e => setSearchAreaMax(e.target.value)}
                  className="h-7 text-xs"
                  data-testid="search-area-max"
                />
              </div>
              <div className="space-y-0.5">
                <label className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Mountain className="w-3 h-3" />Altitude Média (m)
                </label>
                <div className="grid grid-cols-2 gap-1">
                  <Input
                    placeholder="Min"
                    type="number"
                    value={searchAltMediaMin}
                    onChange={e => setSearchAltMediaMin(e.target.value)}
                    className="h-7 text-xs"
                    data-testid="search-alt-media-min"
                  />
                  <Input
                    placeholder="Max"
                    type="number"
                    value={searchAltMediaMax}
                    onChange={e => setSearchAltMediaMax(e.target.value)}
                    className="h-7 text-xs"
                    data-testid="search-alt-media-max"
                  />
                </div>
              </div>
              <div className="space-y-0.5">
                <label className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Sprout className="w-3 h-3" />Argila Média (%)
                </label>
                <div className="grid grid-cols-2 gap-1">
                  <Input
                    placeholder="Min"
                    type="number"
                    value={searchArgilaMediaMin}
                    onChange={e => setSearchArgilaMediaMin(e.target.value)}
                    className="h-7 text-xs"
                    data-testid="search-argila-media-min"
                  />
                  <Input
                    placeholder="Max"
                    type="number"
                    value={searchArgilaMediaMax}
                    onChange={e => setSearchArgilaMediaMax(e.target.value)}
                    className="h-7 text-xs"
                    data-testid="search-argila-media-max"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Resultados (1-500)</label>
                <Input
                  placeholder="Qtd resultados"
                  type="number"
                  min={1}
                  max={500}
                  value={searchLimit}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === "" || (parseInt(v) >= 0 && parseInt(v) <= 500)) setSearchLimit(v);
                  }}
                  onBlur={() => {
                    const n = parseInt(searchLimit);
                    if (!n || n < 1) setSearchLimit("1");
                    else if (n > 500) setSearchLimit("500");
                  }}
                  className="h-7 text-xs"
                  data-testid="search-limit"
                />
              </div>
              <div className="flex gap-1">
                {SHORTCUTS.map(s => (
                  <button
                    key={s.id}
                    onClick={() => { setSearchAreaMin(s.filters.areaMin || ""); setSearchAreaMax(s.filters.areaMax || ""); }}
                    className={cn("text-[9px] px-1.5 py-0.5 rounded border", s.color)}
                    data-testid={`shortcut-${s.id}`}
                  >
                    {s.desc}
                  </button>
                ))}
              </div>
              <div className="flex gap-1 pt-1">
                <Button
                  size="sm"
                  className="h-7 text-xs flex-1"
                  onClick={searchSicar}
                  disabled={sicarLoading || !searchUf}
                  data-testid="btn-search-sicar"
                >
                  {sicarLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Search className="w-3 h-3 mr-1" />}
                  Pesquisar
                </Button>
                {sicarData && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={clearSicar} data-testid="btn-clear-sicar">
                    <X className="w-3 h-3" />
                  </Button>
                )}
              </div>
              {sicarData && (
                <p className="text-[10px] text-muted-foreground px-1">
                  <span className="text-blue-500 font-medium">{sicarData.features?.length || 0}</span> no mapa de <span className="font-medium">{sicarTotal.toLocaleString("pt-BR")}</span> total
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <Sheet open={sicarSheetOpen} onOpenChange={(open) => { setSicarSheetOpen(open); if (!open) setSelectedSicarProps(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 overflow-y-auto" data-testid="sheet-sicar-detail">
          <SheetHeader className="p-4 pb-2 border-b">
            <SheetTitle className="text-base flex items-center gap-2">
              <MapPin className="w-4 h-4 text-blue-500" />
              Propriedade SICAR
            </SheetTitle>
          </SheetHeader>
          {selectedSicarProps && (
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs">{selectedSicarProps.ind_tipo || "IRU"}</Badge>
                <Badge variant={selectedSicarProps.ind_status === "AT" ? "default" : "secondary"} className="text-xs">
                  {selectedSicarProps.ind_status || "—"}
                </Badge>
                {selectedSicarProps.condicao && (
                  <Badge variant="outline" className="text-[10px]">{selectedSicarProps.condicao}</Badge>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="space-y-1">
                  <p className="text-muted-foreground">Código CAR</p>
                  <p className="font-mono text-[11px] font-medium break-all">{selectedSicarProps.cod_imovel || "—"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-muted-foreground">Área (ha)</p>
                  <p className="font-semibold text-base">{selectedSicarProps.num_area != null ? Number(selectedSicarProps.num_area).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-muted-foreground">Município</p>
                  <p className="font-medium">{selectedSicarProps.municipio || "—"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-muted-foreground">UF</p>
                  <p className="font-medium">{selectedSicarProps.uf || "—"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-muted-foreground">Módulo Fiscal</p>
                  <p className="font-medium">{selectedSicarProps.m_fiscal != null ? Number(selectedSicarProps.m_fiscal).toLocaleString("pt-BR") : "—"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-muted-foreground">Data Criação</p>
                  <p className="font-medium">{selectedSicarProps.dat_criacao ? new Date(selectedSicarProps.dat_criacao).toLocaleDateString("pt-BR") : "—"}</p>
                </div>
                {selectedSicarProps.alt_media != null && (
                  <div className="space-y-1">
                    <p className="text-muted-foreground flex items-center gap-1"><Mountain className="w-3 h-3" />Altitude Média</p>
                    <p className="font-medium">{Number(selectedSicarProps.alt_media).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} m</p>
                  </div>
                )}
                {selectedSicarProps.argila_media != null && (
                  <div className="space-y-1">
                    <p className="text-muted-foreground flex items-center gap-1"><Sprout className="w-3 h-3" />Argila Média (%)</p>
                    <p className="font-medium">{Number(selectedSicarProps.argila_media).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</p>
                  </div>
                )}
              </div>
              <div className="pt-2 border-t">
                <Button
                  className="w-full h-9 text-sm"
                  onClick={importSicarAsset}
                  disabled={sicarImporting || sicarImported}
                  data-testid="btn-import-sicar"
                >
                  {sicarImporting ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" />Importando...</>
                  ) : sicarImported ? (
                    <><Check className="w-4 h-4 mr-2" />Importado</>
                  ) : (
                    <><Download className="w-4 h-4 mr-2" />Importar como Ativo</>
                  )}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

    </div>
  );
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
  isImported,
  importing,
  enriquecimentoAgro,
  enriquecimentoLoading,
  onEnriquecerAgro,
  assetId,
}: {
  analysis: any;
  feature: any;
  onImport: () => void;
  isImported: boolean;
  importing: boolean;
  enriquecimentoAgro?: EnriquecimentoAgro | null;
  enriquecimentoLoading?: boolean;
  onEnriquecerAgro?: () => void;
  assetId?: number | null;
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
          <CardContent className="p-3 text-center relative">
            {analysis.fonteHidro === "OSM" && (
              <span
                className="absolute top-1 right-1 text-[8px] font-bold bg-blue-100 text-blue-700 px-1 rounded cursor-help"
                title="Dados do OpenStreetMap (fonte IBGE indisponível para esta região)"
                data-testid="badge-fonte-hidro"
              >OSM</span>
            )}
            <Droplets className={cn("w-5 h-5 mx-auto mb-1", analysis.temRio || analysis.temLago ? "text-blue-600" : "text-muted-foreground")} />
            <p className="text-xs font-medium" data-testid="text-hidro-status">{analysis.temRio ? "Tem Rio" : analysis.temLago ? "Tem Lago" : "Sem Água"}</p>
            <p className="text-[10px] text-muted-foreground">
              {analysis.distAguaM != null ? `a ${formatDist(analysis.distAguaM)}` : `${analysis.qtdRios} rios, ${analysis.qtdLagos} lagos`}
            </p>
          </CardContent>
        </Card>

        <Card className={cn("border", analysis.temEnergia ? "border-amber-300 bg-amber-50/50" : "border-muted")}>
          <CardContent className="p-3 text-center relative">
            {analysis.fonteEnergia === "OSM" && (
              <span
                className="absolute top-1 right-1 text-[8px] font-bold bg-amber-100 text-amber-700 px-1 rounded cursor-help"
                title="Dados do OpenStreetMap (fonte IBGE indisponível para esta região)"
                data-testid="badge-fonte-energia"
              >OSM</span>
            )}
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

              {(enriquecimentoAgro.zarc?.length ?? 0) > 0 && (
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

              {(enriquecimentoAgro.produtividade ?? []).filter(p => p.estimativa).length > 0 && (
                <div>
                  <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">Produtividade Estimada</p>
                  {(enriquecimentoAgro.produtividade ?? []).filter(p => p.estimativa).map((p, i) => (
                    <div key={i} className="flex justify-between bg-muted/50 px-2 py-1 rounded mb-1" data-testid={`prod-item-${i}`}>
                      <span className="capitalize">{p.cultura}</span>
                      <span className="font-medium">{p.estimativa} {p.unidade}</span>
                    </div>
                  ))}
                </div>
              )}

              {(enriquecimentoAgro.parcelasSigef?.length ?? 0) > 0 && (
                <div>
                  <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">Parcelas SIGEF/INCRA</p>
                  {(enriquecimentoAgro.parcelasSigef ?? []).map((p, i) => (
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

      {onEnriquecerAgro && enriquecimentoAgro && !enriquecimentoLoading && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={onEnriquecerAgro}
          data-testid="button-enriquecer-agro"
        >
          <RefreshCcw className="w-3.5 h-3.5 mr-1.5" /> Re-analisar Solo / ZARC / SIGEF
        </Button>
      )}

      <div className="flex gap-2 flex-wrap">
        {isImported ? (
          <Button variant="outline" className="flex-1 text-green-600" disabled>
            <Check className="w-4 h-4 mr-1.5" /> Importado
          </Button>
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
        {isImported && assetId && (
          <Button
            className="flex-1"
            onClick={() => window.location.href = `/ativos/${assetId}`}
            data-testid="button-ver-ativo-geo"
          >
            <Eye className="w-4 h-4 mr-1.5" /> Ver Ativo
          </Button>
        )}
      </div>
    </div>
  );
}

export default function GeoRuralPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [uf, setUf] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [buscaMunicipios, setBuscaMunicipios] = useState<string[]>([]);
  const [buscaMunicipiosLoading, setBuscaMunicipiosLoading] = useState(false);
  const [buscaMunicipioOpen, setBuscaMunicipioOpen] = useState(false);

  useEffect(() => {
    if (!uf) { setBuscaMunicipios([]); setMunicipio(""); return; }
    let cancelled = false;
    setBuscaMunicipiosLoading(true);
    fetch(`/api/municipios?uf=${uf}`, { credentials: "include" })
      .then(r => r.json())
      .then((data: any[]) => {
        if (!cancelled) setBuscaMunicipios(data.map((m: any) => m.nome || m));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setBuscaMunicipiosLoading(false); });
    return () => { cancelled = true; };
  }, [uf]);

  const [areaMin, setAreaMin] = useState("");
  const [areaMax, setAreaMax] = useState("");


  const [altMediaMinFilter, setAltMediaMinFilter] = useState("");
  const [altMediaMaxFilter, setAltMediaMaxFilter] = useState("");
  const [argilaMediaMinFilter, setArgilaMediaMinFilter] = useState("");
  const [argilaMediaMaxFilter, setArgilaMediaMaxFilter] = useState("");
  const [searched, setSearched] = useState(false);
  const [activeSearch, setActiveSearch] = useState("");
  const [page, setPage] = useState(0);
  const [searchProgress, setSearchProgress] = useState(0);
  const [searchStage, setSearchStage] = useState("");

  const [selectedFeature, setSelectedFeature] = useState<any>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapFullscreen, setMapFullscreen] = useState(false);

  useEffect(() => {
    if (!mapFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMapFullscreen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mapFullscreen]);

  const [serverStatus, setServerStatus] = useState<"idle" | "checking" | "online" | "offline">("checking");
  const [serverCheckedAt, setServerCheckedAt] = useState<string | null>(null);
  const [carManualCode, setCarManualCode] = useState("");
  const [carSearching, setCarSearching] = useState(false);
  const [carResult, setCarResult] = useState<any>(null);
  const [apiCacheStats, setApiCacheStats] = useState<any>(null);

  useEffect(() => {
    apiRequest("GET", "/api/geo/sicar-status")
      .then(r => r.json())
      .then(data => {
        setServerStatus(data.apiOnline ? "online" : "offline");
        if (data.cacheStats) setApiCacheStats(data.cacheStats);
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
      const res = await apiRequest("GET", "/api/geo/sicar-status");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setServerStatus(data.apiOnline ? "online" : "offline");
      if (data.cacheStats) setApiCacheStats(data.cacheStats);
      setServerCheckedAt(new Date().toLocaleTimeString("pt-BR"));
      toast({
        title: data.apiOnline ? "API SICARIOn Online" : "API Indisponível",
        description: data.apiOnline
          ? `API SICARIOn respondendo. ${data.cacheStats?.total ? data.cacheStats.total.toLocaleString("pt-BR") + " imóveis disponíveis." : ""}`
          : "A API SICARIOn não está respondendo no momento.",
        variant: data.apiOnline ? "default" : "destructive",
      });
    } catch {
      setServerStatus("offline");
      setServerCheckedAt(new Date().toLocaleTimeString("pt-BR"));
      toast({ title: "Erro ao verificar servidor", description: "Não foi possível testar a conexão.", variant: "destructive" });
    }
  }, [toast]);

  const { data: rawData, isLoading, error, refetch, isError } = useQuery({
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
      const json = await r.json();
      return json;
    },
    enabled: searched && !!activeSearch,
    retry: 2,
    retryDelay: 2000,
  });

  const anySearching = isLoading || carSearching;
  useEffect(() => {
    if (!anySearching) {
      setSearchProgress(0);
      setSearchStage("");
      return;
    }
    setSearchProgress(5);
    setSearchStage("Consultando base SICAR...");
    const stages = [
      { at: 15, msg: "Filtrando imóveis..." },
      { at: 30, msg: "Processando resultados..." },
      { at: 50, msg: "Carregando dados geográficos..." },
      { at: 70, msg: "Calculando métricas..." },
      { at: 85, msg: "Finalizando..." },
    ];
    let idx = 0;
    const interval = setInterval(() => {
      if (idx < stages.length) {
        setSearchProgress(stages[idx].at);
        setSearchStage(stages[idx].msg);
        idx++;
      } else {
        setSearchProgress(p => Math.min(p + 1, 95));
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [anySearching]);

  const regularFeatures: any[] = rawData?.features || [];
  const carFeatures: any[] = carResult?.features || [];
  const features: any[] = carFeatures.length > 0 ? carFeatures : regularFeatures;
  const totalFeatures = carFeatures.length > 0 ? carFeatures.length : (rawData?.totalFeatures || rawData?.numberMatched || features.length);

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
    p.set("tipo", "IRU");
    if (altMediaMinFilter) p.set("altMediaMin", altMediaMinFilter);
    if (altMediaMaxFilter) p.set("altMediaMax", altMediaMaxFilter);
    if (argilaMediaMinFilter) p.set("argilaMediaMin", argilaMediaMinFilter);
    if (argilaMediaMaxFilter) p.set("argilaMediaMax", argilaMediaMaxFilter);
    setActiveSearch(p.toString());
    setSearched(true);
  };

  const handleCarSearch = async () => {
    const code = carManualCode.trim();
    if (!code || code.length < 5) {
      toast({ title: "Código CAR inválido", description: "Informe um código CAR válido (mínimo 5 caracteres).", variant: "destructive" });
      return;
    }
    setCarSearching(true);
    setCarResult(null);
    setSelectedFeature(null);
    setAnalysis(null);
    try {
      const r = await apiRequest("GET", `/api/geo/fazendas/car/${encodeURIComponent(code)}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message || body.suggestion || "Imóvel não encontrado");
      }
      const data = await r.json();
      const feats = data?.features || [];
      if (feats.length === 0) {
        toast({ title: "Imóvel não encontrado", description: "Nenhum imóvel com esse código CAR foi localizado.", variant: "destructive" });
      } else {
        setCarResult(data);
        setSearched(true);
        toast({ title: "Imóvel encontrado!", description: `${feats.length} resultado(s) para o código CAR.` });
      }
    } catch (err: any) {
      toast({ title: "Erro na busca por CAR", description: err.message, variant: "destructive" });
    } finally {
      setCarSearching(false);
    }
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
    p.set("tipo", "IRU");
    if (altMediaMinFilter) p.set("altMediaMin", altMediaMinFilter);
    if (altMediaMaxFilter) p.set("altMediaMax", altMediaMaxFilter);
    if (argilaMediaMinFilter) p.set("argilaMediaMin", argilaMediaMinFilter);
    if (argilaMediaMaxFilter) p.set("argilaMediaMax", argilaMediaMaxFilter);
    setActiveSearch(p.toString());
    setSearched(true);
  };

  const clearFilters = () => {
    setUf(""); setMunicipio(""); setAreaMin(""); setAreaMax("");


    setAltMediaMinFilter(""); setAltMediaMaxFilter("");
    setArgilaMediaMinFilter(""); setArgilaMediaMaxFilter("");
    setCarManualCode(""); setCarResult(null);
    setSearched(false); setActiveSearch(""); setPage(0);
    setSelectedFeature(null); setAnalysis(null);
  };

  const handleUnifiedSearch = () => {
    const code = carManualCode.trim();
    if (code && code.length >= 5) {
      handleCarSearch();
    } else if (code && code.length > 0 && code.length < 5) {
      toast({ title: "Código CAR inválido", description: "O código CAR deve ter pelo menos 5 caracteres.", variant: "destructive" });
    } else {
      handleSearch();
    }
  };

  const [savingAnalysis, setSavingAnalysis] = useState(false);

  const analyzeFeature = useCallback(async (feature: any) => {
    setSelectedFeature(feature);
    setAnalyzing(true);
    setAnalysis(null);
    setEnriquecimentoAgro(null);
    try {
      let geometry = feature.geometry;
      if (!geometry || !geometry.coordinates) {
        const codImovel = feature.properties?.cod_imovel || feature.id;
        if (!codImovel) throw new Error("Sem código CAR para buscar geometria");
        const geoRes = await apiRequest("GET", `/api/geo/fazendas/car/${encodeURIComponent(codImovel)}`);
        if (!geoRes.ok) throw new Error("Falha ao buscar geometria da fazenda");
        const geoData = await geoRes.json();
        const feat = geoData.features?.[0];
        if (!feat?.geometry?.coordinates) throw new Error("Geometria não disponível para esta fazenda");
        geometry = feat.geometry;
        const updatedFeature = { ...feature, geometry };
        setSelectedFeature(updatedFeature);
      }
      const areaHa = feature?.properties?.num_area ? parseFloat(feature.properties.num_area) : null;
      const res = await apiRequest("POST", "/api/geo/analisar", { geometry, areaHa });
      if (!res.ok) throw new Error("Erro na análise");
      const data = await res.json();
      setAnalysis(data);
    } catch (err: any) {
      toast({ title: "Erro ao analisar fazenda", description: err.message, variant: "destructive" });
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
    if (analysis.centroid) {
      lat = analysis.centroid.lat || analysis.centroid[1];
      lon = analysis.centroid.lng || analysis.centroid.lon || analysis.centroid[0];
    } else if (analysis.centroide) {
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

  const autoEnrichTriggeredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!analysis || !selectedFeature || enriquecimentoAgro || enriquecimentoLoading) return;
    const featureId = selectedFeature.properties?.cod_imovel || selectedFeature.id || '';
    if (autoEnrichTriggeredRef.current === featureId) return;
    autoEnrichTriggeredRef.current = featureId;
    enriquecerFazendaSelecionada();
  }, [analysis, selectedFeature, enriquecimentoAgro, enriquecimentoLoading, enriquecerFazendaSelecionada]);

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
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
    },
    onError: () => {
      toast({ title: "Erro ao importar fazenda", variant: "destructive" });
    },
  });

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

  const { sort: rankSort, toggleSort: rawToggleRankSort, sortedData: sortedRankItems } = useTableSort(rankItems);
  const toggleRankSort = useCallback((column: string) => {
    rawToggleRankSort(column);
    setRankPage(0);
  }, [rawToggleRankSort]);

  const [fazendaSort, setFazendaSort] = useState<{ column: string | null; direction: "asc" | "desc" }>({ column: null, direction: "asc" });
  const toggleFazendaSort = useCallback((column: string) => {
    setFazendaSort(prev => prev.column === column ? { column, direction: prev.direction === "asc" ? "desc" : "asc" } : { column, direction: "asc" });
  }, []);
  const sortedFeatures = useMemo(() => {
    if (!fazendaSort.column) return features;
    const col = fazendaSort.column;
    const dir = fazendaSort.direction === "asc" ? 1 : -1;
    return [...features].sort((a: any, b: any) => {
      let valA = a.properties?.[col] ?? a.properties?.[col.toUpperCase()];
      let valB = b.properties?.[col] ?? b.properties?.[col.toUpperCase()];
      if (valA == null && valB == null) return 0;
      if (valA == null) return 1;
      if (valB == null) return -1;
      const numA = Number(valA);
      const numB = Number(valB);
      if (!isNaN(numA) && !isNaN(numB) && valA !== "" && valB !== "") return (numA - numB) * dir;
      return String(valA).toLowerCase().localeCompare(String(valB).toLowerCase(), "pt-BR") * dir;
    });
  }, [features, fazendaSort.column, fazendaSort.direction]);

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="text-page-title">Prospecção Rural</h1>
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
                  {serverStatus === "checking" ? "Testando..." : serverStatus === "online" ? "API Online" : serverStatus === "offline" ? "API Offline" : "Testar Servidor"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>API SICARIOn: {serverStatus === "online" ? "Online" : "Offline"}</p>
                {apiCacheStats?.total && <p className="text-xs">{apiCacheStats.total.toLocaleString("pt-BR")} imóveis na API</p>}
                {serverCheckedAt && <p className="text-xs text-muted-foreground">Último teste: {serverCheckedAt}</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {apiCacheStats?.total && (
            <Badge variant="secondary" className="text-[11px] font-normal gap-1" data-testid="badge-api-stats">
              <Activity className="w-3 h-3" />
              {(apiCacheStats.total || 0).toLocaleString("pt-BR")} imóveis
            </Badge>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => {
        if (v === "mapa") {
          setMapFullscreen(true);
        } else {
          setActiveTab(v);
        }
      }}>

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
                      <SortableTableHead sortKey="title" sort={rankSort} onSort={toggleRankSort}>Título</SortableTableHead>
                      <SortableTableHead sortKey="municipio" sort={rankSort} onSort={toggleRankSort}>Local</SortableTableHead>
                      <SortableTableHead className="text-right" sortKey="area_ha" sort={rankSort} onSort={toggleRankSort}>Área (ha)</SortableTableHead>
                      <SortableTableHead className="text-center" sortKey="geo_score" sort={rankSort} onSort={toggleRankSort}>Score</SortableTableHead>
                      <SortableTableHead className="text-center" sortKey="geo_dist_agua_m" sort={rankSort} onSort={toggleRankSort}>Água</SortableTableHead>
                      <SortableTableHead className="text-center" sortKey="geo_dist_energia_m" sort={rankSort} onSort={toggleRankSort}>Energia</SortableTableHead>
                      <SortableTableHead className="text-right" sortKey="geo_alt_med" sort={rankSort} onSort={toggleRankSort}>Alt. (m)</SortableTableHead>
                      <SortableTableHead className="text-right" sortKey="geo_decliv_med" sort={rankSort} onSort={toggleRankSort}>Decliv. (%)</SortableTableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedRankItems.map((r: any, idx: number) => (
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

        <TabsContent value="mapa" className="mt-4 space-y-3">
          <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 dark:border-emerald-800 p-3" data-testid="banner-mapa-convite">
            <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center shrink-0">
              <MapIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                Explore ativos rurais no mapa interativo
              </p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                Visualize fazendas, terras e propriedades com dados geográficos. Use a Pesquisa SICAR para buscar imóveis diretamente pelo CAR.
              </p>
            </div>
          </div>
          <AssetExplorerMap onSelectAsset={(assetId) => navigate(`/ativos/${assetId}`)} onAnalyzeSicar={analyzeFeature} />
        </TabsContent>

        <TabsContent value="busca" className="space-y-4 mt-4">

      {anySearching && (
        <div className="flex flex-col items-center justify-center py-6 space-y-3" data-testid="search-progress">
          <Loader2 className="w-7 h-7 animate-spin text-emerald-500" />
          <div className="w-full max-w-sm space-y-2">
            <Progress value={searchProgress} className="h-2" />
            <p className="text-sm text-muted-foreground text-center">{searchStage}</p>
          </div>
        </div>
      )}


      <>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-muted-foreground" />
                  <Label className="text-sm font-semibold">Filtros</Label>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => window.open("https://consultapublica.car.gov.br/publico/imoveis/index", "_blank")}
                  data-testid="button-portal-car"
                >
                  <ExternalLink className="w-3 h-3" />
                  Portal CAR
                </Button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs">UF</Label>
                  <Select value={uf} onValueChange={setUf}>
                    <SelectTrigger data-testid="select-uf">
                      <SelectValue placeholder="Todas" />
                    </SelectTrigger>
                    <SelectContent>
                      {ESTADOS.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Município</Label>
                  <Popover open={buscaMunicipioOpen} onOpenChange={setBuscaMunicipioOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className={cn("w-full justify-between h-9 font-normal", !municipio && "text-muted-foreground")}
                        disabled={!uf}
                        data-testid="input-municipio"
                      >
                        <span className="truncate">{municipio || "Selecione..."}</span>
                        {buscaMunicipiosLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 ml-2" /> : <ChevronsUpDown className="w-3.5 h-3.5 opacity-50 shrink-0 ml-2" />}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[260px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Buscar cidade..." className="h-9" />
                        <CommandList className="max-h-[250px]">
                          <CommandEmpty className="text-xs py-3 text-center">Nenhuma cidade encontrada</CommandEmpty>
                          <CommandGroup>
                            {municipio && (
                              <CommandItem
                                value="__clear__"
                                onSelect={() => { setMunicipio(""); setBuscaMunicipioOpen(false); }}
                                className="text-muted-foreground"
                              >
                                <X className="w-3.5 h-3.5 mr-2" /> Limpar
                              </CommandItem>
                            )}
                            {buscaMunicipios.map(m => (
                              <CommandItem
                                key={m}
                                value={m}
                                onSelect={() => { setMunicipio(m); setBuscaMunicipioOpen(false); }}
                              >
                                <Check className={cn("w-3.5 h-3.5 mr-2", municipio === m ? "opacity-100" : "opacity-0")} />
                                {m}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1.5 lg:col-span-2">
                  <Label className="text-xs">Código CAR</Label>
                  <Input
                    value={carManualCode}
                    onChange={e => setCarManualCode(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleUnifiedSearch()}
                    placeholder="Buscar..."
                    data-testid="input-car-manual"
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
                  <Label className="text-xs">Área máx (ha)</Label>
                  <Input
                    type="number" value={areaMax}
                    onChange={e => setAreaMax(e.target.value)}
                    placeholder="∞"
                    data-testid="input-area-max"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end mt-3">
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Mountain className="w-3 h-3" />Altitude Média (m) - Min</Label>
                  <Input
                    type="number" value={altMediaMinFilter}
                    onChange={e => setAltMediaMinFilter(e.target.value)}
                    placeholder="0"
                    data-testid="input-alt-media-min"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Mountain className="w-3 h-3" />Altitude Média (m) - Max</Label>
                  <Input
                    type="number" value={altMediaMaxFilter}
                    onChange={e => setAltMediaMaxFilter(e.target.value)}
                    placeholder="∞"
                    data-testid="input-alt-media-max"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Sprout className="w-3 h-3" />Argila Média (%) - Min</Label>
                  <Input
                    type="number" value={argilaMediaMinFilter}
                    onChange={e => setArgilaMediaMinFilter(e.target.value)}
                    placeholder="0"
                    data-testid="input-argila-media-min"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Sprout className="w-3 h-3" />Argila Média (%) - Max</Label>
                  <Input
                    type="number" value={argilaMediaMaxFilter}
                    onChange={e => setArgilaMediaMaxFilter(e.target.value)}
                    placeholder="∞"
                    data-testid="input-argila-media-max"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <Button onClick={handleUnifiedSearch} size="sm" className="gap-1.5" data-testid="button-buscar">
                  <Search className="w-3.5 h-3.5" /> Filtrar
                </Button>
                <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5" data-testid="button-limpar">
                  <X className="w-3.5 h-3.5" /> Limpar
                </Button>
                {carSearching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-2" />}
              </div>
            </CardContent>
          </Card>
        </>

      {/* Results */}
      {(error || isError) && (
        <div className="text-center py-10" data-testid="error-sicar">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-yellow-500" />
          <p className="font-medium text-foreground">Dados temporariamente indisponíveis</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            A API SICARIOn não está respondendo. Tente novamente em instantes.
          </p>
          <div className="flex gap-2 justify-center mt-4">
            <Button variant="outline" onClick={() => refetch()} data-testid="button-retry-sicar">
              <RefreshCcw className="w-4 h-4 mr-2" /> Tentar novamente
            </Button>
            <Button variant="outline" onClick={() => window.open("https://consultapublica.car.gov.br/publico/imoveis/index", "_blank")} data-testid="button-portal-car-error">
              <ExternalLink className="w-4 h-4 mr-2" /> Consultar Portal CAR
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
            <span>
              {totalFeatures.toLocaleString("pt-BR")} imóveis encontrados
              {rawData?.source === "mavrion-api" && (
                <Badge variant="outline" className="ml-2 text-[10px] border-blue-300 text-blue-600">API Mavrion</Badge>
              )}
            </span>
            <span>Página {page + 1}{totalPages > 1 ? ` de ${totalPages}` : ""}</span>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <SortableTableHead sortKey="municipio" sort={fazendaSort} onSort={toggleFazendaSort}>Imóvel</SortableTableHead>
                  <SortableTableHead className="text-right" sortKey="num_area" sort={fazendaSort} onSort={toggleFazendaSort}>Área (ha)</SortableTableHead>
                  <SortableTableHead sortKey="ind_status" sort={fazendaSort} onSort={toggleFazendaSort}>Condição</SortableTableHead>
                  <SortableTableHead className="text-right" sortKey="declividade" sort={fazendaSort} onSort={toggleFazendaSort}>Decliv. (%)</SortableTableHead>
                  <SortableTableHead className="text-right" sortKey="alt_media" sort={fazendaSort} onSort={toggleFazendaSort}>Alt. (m)</SortableTableHead>
                  <SortableTableHead className="text-right" sortKey="argila_media" sort={fazendaSort} onSort={toggleFazendaSort}>Argila (%)</SortableTableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedFeatures.map((f: any, idx: number) => {
                  const p = f.properties || {};
                  const cod = p.cod_imovel || p.COD_IMOVEL || "";
                  const isImported = !!(cod && (importedMap as any)[cod]);
                  const isSelected = selectedFeature?.id === f.id;
                  const areaVal = p.num_area ?? p.area ?? null;
                  const statusRaw = p.ind_status || p.status_imovel || "";
                  const tipoRaw = p.ind_tipo || p.tipo_imovel || "";
                  const munName = p.municipio || p.nom_municipio || "";
                  const ufVal = p.uf || (cod.length >= 2 ? cod.substring(0, 2) : "");
                  const statusMap: Record<string, { label: string; cls: string }> = {
                    AT: { label: "Ativo", cls: "bg-green-100 text-green-700 border-green-200" },
                    PE: { label: "Pendente", cls: "bg-amber-100 text-amber-700 border-amber-200" },
                    CA: { label: "Cancelado", cls: "bg-red-100 text-red-700 border-red-200" },
                    SU: { label: "Suspenso", cls: "bg-orange-100 text-orange-700 border-orange-200" },
                  };
                  const st = statusMap[statusRaw] || { label: statusRaw || p.des_condic || "—", cls: "" };
                  const tipoMap: Record<string, string> = { IRU: "Imóvel Rural", ASS: "Assentamento", TI: "Terra Indígena", UC: "Unid. Conservação", PCT: "Territ. Quilombola" };
                  const tipoLabel = tipoMap[tipoRaw] || tipoRaw || "";
                  const codShort = cod.length > 20 ? "…" + cod.slice(-12) : cod;
                  const declividade = p.declividade != null ? Number(p.declividade) : null;

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
                      <TableCell>
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-sm" data-testid={`text-municipio-${idx}`}>{munName || "—"}</span>
                            {ufVal && <span className="text-muted-foreground text-xs">/{ufVal}</span>}
                            <Badge className={cn("text-[10px] px-1.5 py-0", st.cls)} data-testid={`badge-status-${idx}`}>{st.label}</Badge>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="font-mono cursor-help" data-testid={`text-car-${idx}`}>{codShort || "—"}</span>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="font-mono text-xs">{cod}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            {tipoLabel && <span>· {tipoLabel}</span>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium" data-testid={`text-area-${idx}`}>
                        {areaVal != null ? Number(areaVal).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "—"}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs" data-testid={`text-condicao-${idx}`}>{p.condicao || "—"}</span>
                      </TableCell>
                      <TableCell className="text-right text-sm" data-testid={`text-declividade-${idx}`}>
                        {declividade != null ? `${declividade.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm" data-testid={`text-alt-media-${idx}`}>
                        {p.alt_media != null ? Number(p.alt_media).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm" data-testid={`text-argila-media-${idx}`}>
                        {p.argila_media != null ? `${Number(p.argila_media).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"}
                      </TableCell>
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
                          {/* Criar Deal — comentado por enquanto
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
                          */}
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

        </TabsContent>

        {/* Análise Agro moved to /analise-agro */}

      </Tabs>

      <Dialog open={!!selectedFeature} onOpenChange={(open) => { if (!open) { setSelectedFeature(null); setAnalysis(null); } }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" data-testid="dialog-analise">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-primary" />
              Análise Geoespacial
              {selectedFeature?.properties?.cod_imovel && (
                <span className="text-xs font-normal text-muted-foreground ml-2 truncate max-w-[300px]">
                  {selectedFeature.properties.cod_imovel}
                </span>
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Análise geoespacial do imóvel rural selecionado
            </DialogDescription>
          </DialogHeader>

          {analyzing ? (
            <div className="flex items-center justify-center py-16 gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="text-muted-foreground">Analisando camadas geoespaciais...</span>
            </div>
          ) : analysis ? (
            <div className="grid md:grid-cols-2 gap-6">
              <div className="h-[450px] relative rounded-lg overflow-hidden border">
                <LeafletMap
                  features={selectedFeature ? [selectedFeature] : []}
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
                isImported={!!(selectedFeature?.properties?.cod_imovel && (importedMap as any)[selectedFeature.properties.cod_imovel])}
                importing={importMutation.isPending}
                enriquecimentoAgro={enriquecimentoAgro}
                enriquecimentoLoading={enriquecimentoLoading}
                onEnriquecerAgro={enriquecerFazendaSelecionada}
                assetId={selectedFeature?.properties?.cod_imovel ? (importedMap as any)[selectedFeature.properties.cod_imovel] : null}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {mapFullscreen && (
        <div className="fixed inset-0 z-50 bg-background" data-testid="map-fullscreen-overlay">
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[60]">
            <Button
              variant="secondary"
              size="sm"
              className="shadow-xl bg-background/95 backdrop-blur-md border px-5"
              onClick={() => setMapFullscreen(false)}
              data-testid="button-exit-fullscreen-map"
            >
              <X className="w-4 h-4 mr-1.5" /> Fechar Mapa
            </Button>
          </div>
          <div className="w-full h-full">
            <AssetExplorerMap
              onSelectAsset={(assetId) => {
                setMapFullscreen(false);
                navigate(`/ativos/${assetId}`);
              }}
              onAnalyzeSicar={(feature) => {
                setMapFullscreen(false);
                setActiveTab("busca");
                analyzeFeature(feature);
              }}
            />
          </div>
        </div>
      )}

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

    </div>
  );
}
