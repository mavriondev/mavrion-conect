import { useState, useRef, useCallback, useEffect } from "react";
import type { CamposEspecificos } from "@shared/schema";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, MapPin, Ruler, Building2, FileText, Pencil, Trash2, Loader2, CheckCircle2, AlertCircle, AlertTriangle, Clock, TreePine, Pickaxe, Briefcase, Home, Wheat, Factory, Link2, Tag, MessageSquare, Zap, Search, Leaf, Thermometer, Droplets, RefreshCw, Upload, ExternalLink, Paperclip, X as XIcon, Phone, Mail, Camera, Image, Users, BarChart3, Sparkles, Shield, ChevronDown, ChevronUp, FileDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AtivoFormDialog } from "./ativos";
import { Map } from "lucide-react";
import DocumentsPanel from "@/components/documents-panel";
import { AnmEnrichmentTabs, ANM_TAB_GROUPS } from "@/components/anm-enrichment-tabs";
import DueDiligenceFundiaria from "@/components/due-diligence-fundiaria";
import { SigefDetentoresDialog } from "@/components/sigef-detentores-dialog";
import { EnrichmentProgressBar } from "@/components/enrichment-progress-bar";

function AssetPolygonMap({ assetId, highlightCodigo, onParcelaClick, highlightCarCodigo, onCarClick }: {
  assetId: number;
  highlightCodigo?: string | null;
  onParcelaClick?: (codigoParcela: string) => void;
  highlightCarCodigo?: string | null;
  onCarClick?: (codImovel: string) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const geoLayerRef = useRef<any>(null);
  const sigefLayerRef = useRef<any>(null);
  const carLayerRef = useRef<any>(null);
  const parcelaLayersRef = useRef<Record<string, { layer: any; sobreposta: boolean }>>({});
  const carLayersRef = useRef<Record<string, { layer: any; sobreposto: boolean }>>({});
  const onParcelaClickRef = useRef(onParcelaClick);
  onParcelaClickRef.current = onParcelaClick;
  const onCarClickRef = useRef(onCarClick);
  onCarClickRef.current = onCarClick;
  const [mapReady, setMapReady] = useState(false);
  const [noGeom, setNoGeom] = useState(false);

  // Geometrias das parcelas SIGEF já consultadas (vazio se a consulta nunca rodou)
  const { data: sigefGeoms } = useQuery<{ parcelas: any[] }>({
    queryKey: ["/api/assets", String(assetId), "sigef-parcelas-geometrias"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/assets/${assetId}/sigef-parcelas/geometrias`);
      if (!res.ok) return { parcelas: [] };
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  // Geometrias dos imóveis CAR já consultados (vazio se a consulta nunca rodou)
  const { data: carGeoms } = useQuery<{ imoveis: any[] }>({
    queryKey: ["/api/assets", String(assetId), "car-imoveis-geometrias"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/assets/${assetId}/car-imoveis/geometrias`);
      if (!res.ok) return { imoveis: [] };
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest("GET", `/api/assets/${assetId}/geometry`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!data.geometry || cancelled) { setNoGeom(true); return; }

        const L = (await import("leaflet")).default;
        await import("leaflet/dist/leaflet.css");
        if (cancelled || !mapRef.current) return;

        const m = L.map(mapRef.current, { zoomControl: true, attributionControl: false });
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 18,
          attribution: "Tiles &copy; Esri",
        }).addTo(m);

        const gl = L.geoJSON(data.geometry, {
          style: { color: "#16a34a", weight: 2, fillColor: "#22c55e", fillOpacity: 0.25 },
          // não intercepta cliques — os cliques devem chegar às parcelas SIGEF por baixo
          interactive: false,
        }).addTo(m);

        mapInstanceRef.current = m;
        geoLayerRef.current = gl;
        setMapReady(true);
        setTimeout(() => {
          if (!cancelled && m) {
            m.invalidateSize();
            m.fitBounds(gl.getBounds(), { padding: [30, 30] });
          }
        }, 200);
      } catch { if (!cancelled) setNoGeom(true); }
    })();
    return () => { cancelled = true; if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; } };
  }, [assetId]);

  // Sobrepõe as parcelas SIGEF no mapa (sobrepostas em laranja, vizinhas esmaecidas)
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    const parcelas = sigefGeoms?.parcelas || [];
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapInstanceRef.current) return;
      if (sigefLayerRef.current) {
        try { mapInstanceRef.current.removeLayer(sigefLayerRef.current); } catch {}
        sigefLayerRef.current = null;
      }
      parcelaLayersRef.current = {};
      if (parcelas.length === 0) return;
      const group = L.layerGroup();
      const fmtHa = (v: any) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
      for (const p of parcelas) {
        const sobreposta = p.relacao === "sobreposta";
        const layer = L.geoJSON(p.geometry, {
          style: sobreposta
            ? { color: "#f97316", weight: 2, fillColor: "#fb923c", fillOpacity: 0.35 }
            : { color: "#cbd5e1", weight: 1, dashArray: "4 3", fillColor: "#94a3b8", fillOpacity: 0.12 },
        });
        // Tooltip montado via DOM + textContent (nunca innerHTML) — dados
        // externos (código, denominação, detentor) não podem injetar HTML.
        const tip = document.createElement("div");
        tip.style.cssText = "font-size:11px;line-height:1.4";
        const addLine = (text: string, style?: string) => {
          const div = document.createElement("div");
          if (style) div.style.cssText = style;
          div.textContent = text;
          tip.appendChild(div);
        };
        addLine(p.codigoParcela || "—", "font-family:monospace");
        addLine(p.nomeArea || "Sem denominação", "font-weight:bold");
        if (p.detentor) addLine(p.detentor);
        addLine(`Área: ${fmtHa(p.areaHa)} ha${sobreposta ? ` · ${fmtHa(p.sobreposicaoHa)} ha sobre o processo` : " (vizinha)"}`);
        layer.bindTooltip(tip, { sticky: true });
        if (p.codigoParcela) {
          parcelaLayersRef.current[p.codigoParcela] = { layer, sobreposta };
          layer.on("click", () => onParcelaClickRef.current?.(p.codigoParcela));
        }
        group.addLayer(layer);
      }
      group.addTo(mapInstanceRef.current);
      // mantém o polígono do processo por cima das parcelas
      try { geoLayerRef.current?.bringToFront(); } catch {}
      sigefLayerRef.current = group;
    })();
    return () => { cancelled = true; };
  }, [mapReady, sigefGeoms]);

  // Sobrepõe os imóveis CAR no mapa (sobrepostos em violeta, vizinhos esmaecidos)
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    const imoveis = carGeoms?.imoveis || [];
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapInstanceRef.current) return;
      if (carLayerRef.current) {
        try { mapInstanceRef.current.removeLayer(carLayerRef.current); } catch {}
        carLayerRef.current = null;
      }
      carLayersRef.current = {};
      if (imoveis.length === 0) return;
      const group = L.layerGroup();
      const fmtHa = (v: any) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
      for (const i of imoveis) {
        const sobreposto = i.relacao === "sobreposto";
        const layer = L.geoJSON(i.geometry, {
          style: sobreposto
            ? { color: "#8b5cf6", weight: 2, fillColor: "#a78bfa", fillOpacity: 0.3 }
            : { color: "#ddd6fe", weight: 1, dashArray: "4 3", fillColor: "#c4b5fd", fillOpacity: 0.1 },
        });
        // Tooltip via DOM + textContent (nunca innerHTML) — dados externos não podem injetar HTML.
        const tip = document.createElement("div");
        tip.style.cssText = "font-size:11px;line-height:1.4";
        const addLine = (text: string, style?: string) => {
          const div = document.createElement("div");
          if (style) div.style.cssText = style;
          div.textContent = text;
          tip.appendChild(div);
        };
        addLine(i.codImovel || "—", "font-family:monospace");
        addLine(`CAR${i.municipio ? ` · ${i.municipio}` : ""}${i.status ? ` · ${i.status}` : ""}`, "font-weight:bold");
        addLine(`Área: ${fmtHa(i.areaHa)} ha${sobreposto ? ` · ${fmtHa(i.sobreposicaoHa)} ha sobre o processo (${fmtHa(i.sobreposicaoPct)}%)` : " (vizinho)"}`);
        layer.bindTooltip(tip, { sticky: true });
        if (i.codImovel) {
          carLayersRef.current[i.codImovel] = { layer, sobreposto };
          layer.on("click", () => onCarClickRef.current?.(i.codImovel));
        }
        group.addLayer(layer);
      }
      group.addTo(mapInstanceRef.current);
      // ordem: CAR abaixo, parcelas SIGEF acima, polígono do processo por cima
      try { geoLayerRef.current?.bringToFront(); } catch {}
      carLayerRef.current = group;
    })();
    return () => { cancelled = true; };
  }, [mapReady, carGeoms]);

  // Destaca no mapa o imóvel CAR selecionado/hover da tabela
  useEffect(() => {
    const entries = carLayersRef.current;
    for (const [codigo, { layer, sobreposto }] of Object.entries(entries)) {
      const highlighted = highlightCarCodigo != null && codigo === highlightCarCodigo;
      try {
        layer.setStyle(
          highlighted
            ? { color: "#7c3aed", weight: 3, dashArray: undefined, fillColor: "#8b5cf6", fillOpacity: 0.5 }
            : sobreposto
              ? { color: "#8b5cf6", weight: 2, dashArray: undefined, fillColor: "#a78bfa", fillOpacity: 0.3 }
              : { color: "#ddd6fe", weight: 1, dashArray: "4 3", fillColor: "#c4b5fd", fillOpacity: 0.1 },
        );
        if (highlighted) {
          layer.bringToFront?.();
          const b = layer.getBounds?.();
          if (b?.isValid?.() && mapInstanceRef.current && !mapInstanceRef.current.getBounds().contains(b)) {
            mapInstanceRef.current.fitBounds(b, { padding: [40, 40] });
          }
        }
      } catch {}
    }
    try { geoLayerRef.current?.bringToFront(); } catch {}
    if (highlightCarCodigo && entries[highlightCarCodigo]) {
      try { entries[highlightCarCodigo].layer.bringToFront?.(); } catch {}
    }
  }, [highlightCarCodigo, mapReady, carGeoms]);

  // Destaca no mapa a parcela selecionada/hover da tabela SIGEF
  useEffect(() => {
    const entries = parcelaLayersRef.current;
    for (const [codigo, { layer, sobreposta }] of Object.entries(entries)) {
      const highlighted = highlightCodigo != null && codigo === highlightCodigo;
      try {
        layer.setStyle(
          highlighted
            ? { color: "#eab308", weight: 3, dashArray: undefined, fillColor: "#facc15", fillOpacity: 0.5 }
            : sobreposta
              ? { color: "#f97316", weight: 2, dashArray: undefined, fillColor: "#fb923c", fillOpacity: 0.35 }
              : { color: "#cbd5e1", weight: 1, dashArray: "4 3", fillColor: "#94a3b8", fillOpacity: 0.12 },
        );
        if (highlighted) {
          layer.bringToFront?.();
          const b = layer.getBounds?.();
          if (b?.isValid?.() && mapInstanceRef.current && !mapInstanceRef.current.getBounds().contains(b)) {
            mapInstanceRef.current.fitBounds(b, { padding: [40, 40] });
          }
        }
      } catch {}
    }
    // polígono do processo abaixo, parcela destacada por cima
    try { geoLayerRef.current?.bringToFront(); } catch {}
    if (highlightCodigo && entries[highlightCodigo]) {
      try { entries[highlightCodigo].layer.bringToFront?.(); } catch {}
    }
  }, [highlightCodigo, mapReady, sigefGeoms]);

  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
        if (geoLayerRef.current) {
          try { mapInstanceRef.current.fitBounds(geoLayerRef.current.getBounds(), { padding: [30, 30] }); } catch {}
        }
      }
    }, { threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [mapReady]);

  if (noGeom) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Map className="w-4 h-4" /> Polígono do Ativo
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!mapReady && (
          <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando mapa...
          </div>
        )}
        <div
          ref={mapRef}
          data-testid="map-asset-polygon"
          className="rounded-lg overflow-hidden"
          style={{ height: 300, width: "100%" }}
        />
        {mapReady && (sigefGeoms?.parcelas?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-muted-foreground" data-testid="legend-sigef-parcelas">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm border-2" style={{ backgroundColor: "rgba(34,197,94,0.25)", borderColor: "#16a34a" }} />
              Polígono do processo
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm border-2" style={{ backgroundColor: "rgba(251,146,60,0.35)", borderColor: "#f97316" }} />
              Parcela SIGEF sobre o processo
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm border border-dashed" style={{ backgroundColor: "rgba(148,163,184,0.12)", borderColor: "#94a3b8" }} />
              Parcela vizinha
            </span>
          </div>
        )}
        {mapReady && (carGeoms?.imoveis?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-[11px] text-muted-foreground" data-testid="legend-car-imoveis">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm border-2" style={{ backgroundColor: "rgba(167,139,250,0.3)", borderColor: "#8b5cf6" }} />
              Imóvel CAR sobre o processo
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm border border-dashed" style={{ backgroundColor: "rgba(196,181,253,0.1)", borderColor: "#ddd6fe" }} />
              Imóvel CAR vizinho
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const CLASSE_COR: Record<number, string> = {
  1: "#006400", 3: "#1f6e1f", 4: "#b8af4f", 5: "#687537", 6: "#76a5af",
  9: "#935132", 11: "#45c2a5", 12: "#b8d68f", 13: "#d6bc74", 14: "#ffefc3",
  15: "#edde8e", 18: "#e974ed", 19: "#c27ba0", 20: "#db7093", 21: "#ffefc3",
  22: "#d4271e", 23: "#ffa07a", 24: "#d4271e", 25: "#db4d4f", 26: "#0000ff",
  29: "#ffaa5f", 30: "#9c0027", 31: "#091077", 33: "#0000ff", 39: "#d082de",
  40: "#982c9e", 41: "#e6ccff", 46: "#cd49e4", 47: "#f3b4f1", 48: "#9065d0",
  62: "#ff69b4",
};

function LandUseTimeline({ historico }: { historico: Array<{ ano: number; classe: number; descricao: string }> }) {
  if (!historico || historico.length === 0) return null;
  const groups: Array<{ classe: number; descricao: string; de: number; ate: number }> = [];
  for (const h of historico) {
    const last = groups[groups.length - 1];
    if (last && last.classe === h.classe) { last.ate = h.ano; }
    else { groups.push({ classe: h.classe, descricao: h.descricao, de: h.ano, ate: h.ano }); }
  }
  const totalYears = (historico[historico.length - 1]?.ano || 2024) - (historico[0]?.ano || 1985) + 1;
  return (
    <div className="space-y-2">
      <div className="flex rounded-md overflow-hidden h-6" data-testid="timeline-uso-solo">
        {groups.map((g, i) => {
          const span = g.ate - g.de + 1;
          const pct = (span / totalYears) * 100;
          return (
            <div
              key={i}
              className="relative group cursor-default"
              style={{ width: `${pct}%`, backgroundColor: CLASSE_COR[g.classe] || "#888", minWidth: pct > 3 ? undefined : "4px" }}
              title={`${g.descricao} (${g.de}–${g.ate})`}
            >
              {pct > 12 && <span className="absolute inset-0 flex items-center justify-center text-[9px] text-white font-medium truncate px-0.5">{g.descricao.length > 12 ? g.descricao.substring(0, 10) + "…" : g.descricao}</span>}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{historico[0]?.ano}</span>
        <span>{historico[historico.length - 1]?.ano}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {groups.map((g, i) => (
          <div key={i} className="flex items-center gap-1 text-[10px]">
            <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: CLASSE_COR[g.classe] || "#888" }} />
            <span className="text-muted-foreground">{g.descricao} ({g.de === g.ate ? g.de : `${g.de}–${g.ate}`})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CCIRTab({ assetId, camposEspecificos, ccirState, onStartCcir, onCancelCcir }: {
  assetId: number;
  camposEspecificos: CamposEspecificos | null;
  ccirState: { loading: boolean; error: string | null; startedAt: number | null };
  onStartCcir: (cpfCnpj?: string) => void;
  onCancelCcir: () => void;
}) {
  const [cpfCnpjInput, setCpfCnpjInput] = useState("");
  const autoStartedRef = useRef(false);
  const prevAssetIdRef = useRef(assetId);

  const campos = camposEspecificos ?? {};
  const hasData = !!campos.ccirConsultadoEm;

  useEffect(() => {
    if (prevAssetIdRef.current !== assetId) {
      prevAssetIdRef.current = assetId;
      autoStartedRef.current = false;
    }
  }, [assetId]);

  useEffect(() => {
    if (!hasData && !ccirState.loading && !ccirState.error && !ccirState.startedAt && !autoStartedRef.current) {
      autoStartedRef.current = true;
      onStartCcir();
    }
  }, [hasData, ccirState.loading, ccirState.error, ccirState.startedAt, onStartCcir]);

  if (!hasData && (ccirState.loading || (!ccirState.error && !ccirState.startedAt))) {
    return (
      <EnrichmentProgressBar
        message="Consultando dados CCIR / INCRA..."
        icon={<FileText className="w-4 h-4" />}
      />
    );
  }

  if (!hasData) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-4">
          <FileText className="w-10 h-10 mx-auto text-muted-foreground opacity-30" />
          <p className="text-sm text-muted-foreground" data-testid="text-ccir-vazio">
            {ccirState.error || "Dados do CCIR ainda não consultados para este ativo"}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={ccirState.loading}
            onClick={() => onStartCcir()}
            data-testid="button-retry-ccir"
            className="mx-auto"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" /> Tentar novamente
          </Button>
          <div className="border-t pt-3 mt-1">
            <p className="text-xs text-muted-foreground mb-2">
              Ou informe o CPF/CNPJ do proprietário para busca direta
            </p>
            <div className="flex items-center justify-center gap-2 max-w-sm mx-auto">
              <Input
                placeholder="CPF ou CNPJ do proprietário"
                value={cpfCnpjInput}
                onChange={(e) => setCpfCnpjInput(e.target.value)}
                data-testid="input-ccir-cpfcnpj"
                className="text-sm"
              />
              <Button
                size="sm"
                disabled={cpfCnpjInput.replace(/\D/g, "").length < 11}
                onClick={() => onStartCcir(cpfCnpjInput)}
                data-testid="button-consultar-ccir"
              >
                <Search className="w-3.5 h-3.5 mr-1" /> Consultar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const proprietarios = campos.ccirProprietarios || [];

  return (
    <>
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium">Dados CCIR / INCRA</p>
            {campos.ccirConsultadoEm && (
              <Badge className="bg-green-100 text-green-700 border-green-200 text-xs" data-testid="badge-ccir-consultado">
                Consultado em {new Date(campos.ccirConsultadoEm).toLocaleDateString("pt-BR")}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="CPF ou CNPJ"
              value={cpfCnpjInput}
              onChange={(e) => setCpfCnpjInput(e.target.value)}
              className="text-sm w-44 h-8"
              data-testid="input-ccir-cpfcnpj-update"
            />
            <Button
              size="sm" variant="outline"
              disabled={ccirState.loading || cpfCnpjInput.replace(/\D/g, "").length < 11}
              onClick={() => onStartCcir(cpfCnpjInput)}
              data-testid="button-reconsultar-ccir"
            >
              {ccirState.loading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      {proprietarios.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="w-4 h-4" /> Proprietário(s) / Detentor(es)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {proprietarios.map((p: any, i: number) => (
                <div key={i} className="p-3 rounded bg-muted/50 flex items-center justify-between" data-testid={`card-ccir-proprietario-${i}`}>
                  <div>
                    <p className="text-sm font-medium" data-testid={`text-ccir-prop-nome-${i}`}>{p.nome || "—"}</p>
                    {p.tipo && <p className="text-xs text-muted-foreground">{p.tipo}</p>}
                  </div>
                  <Badge variant="outline" className="text-xs font-mono" data-testid={`text-ccir-prop-doc-${i}`}>{p.cpfCnpj || "—"}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Dados do Imóvel no INCRA</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {campos.ccirDenominacao && (
              <div className="p-2.5 rounded bg-muted/50 col-span-2 md:col-span-3">
                <p className="text-[10px] text-muted-foreground">Denominação</p>
                <p className="text-sm font-bold" data-testid="text-ccir-denominacao">{campos.ccirDenominacao}</p>
              </div>
            )}
            {campos.ccirCodigoIncra && (
              <div className="p-2.5 rounded bg-muted/50 text-center">
                <p className="text-[10px] text-muted-foreground">Código INCRA</p>
                <p className="text-sm font-bold font-mono" data-testid="text-ccir-codigo">{campos.ccirCodigoIncra}</p>
              </div>
            )}
            {campos.ccirNirf && (
              <div className="p-2.5 rounded bg-muted/50 text-center">
                <p className="text-[10px] text-muted-foreground">NIRF</p>
                <p className="text-sm font-bold font-mono" data-testid="text-ccir-nirf">{campos.ccirNirf}</p>
              </div>
            )}
            {campos.ccirModulosFiscais != null && (
              <div className="p-2.5 rounded bg-muted/50 text-center">
                <p className="text-[10px] text-muted-foreground">Módulos Fiscais</p>
                <p className="text-sm font-bold" data-testid="text-ccir-modulos">{Number(campos.ccirModulosFiscais).toFixed(2)}</p>
              </div>
            )}
            {campos.ccirClassificacao && (
              <div className="p-2.5 rounded bg-muted/50 text-center">
                <p className="text-[10px] text-muted-foreground">Classificação Fundiária</p>
                <p className="text-sm font-bold" data-testid="text-ccir-classificacao">{campos.ccirClassificacao}</p>
              </div>
            )}
            {campos.ccirFracaoMinima && (
              <div className="p-2.5 rounded bg-muted/50 text-center">
                <p className="text-[10px] text-muted-foreground">Fração Mínima de Parcelamento</p>
                <p className="text-sm font-bold" data-testid="text-ccir-fracao">{campos.ccirFracaoMinima}</p>
              </div>
            )}
            {campos.ccirSituacao && (
              <div className="p-2.5 rounded bg-muted/50 text-center">
                <p className="text-[10px] text-muted-foreground">Situação Cadastral</p>
                <p className="text-sm font-bold" data-testid="text-ccir-situacao">{campos.ccirSituacao}</p>
              </div>
            )}
            {campos.ccirDataEmissao && (
              <div className="p-2.5 rounded bg-muted/50 text-center">
                <p className="text-[10px] text-muted-foreground">Data de Emissão</p>
                <p className="text-sm font-bold" data-testid="text-ccir-emissao">{campos.ccirDataEmissao}</p>
              </div>
            )}
            {campos.ccirAreaTotalIncra && (
              <div className="p-2.5 rounded bg-muted/50 text-center">
                <p className="text-[10px] text-muted-foreground">Área Total (INCRA)</p>
                <p className="text-sm font-bold" data-testid="text-ccir-area">{campos.ccirAreaTotalIncra}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function AmbientalTab({ assetId, camposEspecificos }: { assetId: number; camposEspecificos: CamposEspecificos | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showDeterDetails, setShowDeterDetails] = useState(false);
  const [showIbamaDetails, setShowIbamaDetails] = useState(false);
  const ambiental = camposEspecificos?.ambiental || null;
  const deter = ambiental?.deter || null;
  const mapbiomas = ambiental?.mapbiomas || null;
  const ibama = ambiental?.ibama || null;

  const consultarMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", `/api/assets/${assetId}/ambiental`);
      if (!res.ok) throw new Error("Falha na consulta");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/assets", String(assetId)] });
      toast({ title: "Consulta ambiental concluída" });
    },
    onError: () => {
      toast({ title: "Erro na consulta ambiental", variant: "destructive" });
    },
  });

  if (!ambiental || !ambiental.consultadoEm) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-3">
          <TreePine className="w-10 h-10 mx-auto text-muted-foreground opacity-30" />
          <p className="text-sm text-muted-foreground" data-testid="text-ambiental-vazio">
            Dados ambientais ainda não consultados para este ativo
          </p>
          <p className="text-xs text-muted-foreground">
            Consulta DETER/INPE, MapBiomas Alerta, IBAMA Embargos e histórico de uso do solo
          </p>
          <Button
            size="sm"
            disabled={consultarMutation.isPending}
            onClick={() => consultarMutation.mutate()}
            data-testid="button-consultar-ambiental"
          >
            {consultarMutation.isPending
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Consultando...</>
              : <><Search className="w-3.5 h-3.5" /> Consultar dados ambientais</>}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const allUnavailable = ambiental?.deterStatus === "indisponivel" && ambiental?.mapbiomasStatus === "indisponivel" && ambiental?.ibamaStatus === "indisponivel";
  const totalAlertasDesmatamento = (deter?.totalAlertas || 0) + (mapbiomas?.alertasDesmatamento || 0);
  const temEmbargo = ibama?.temEmbargo === true;

  let riskLevel: "baixo" | "atencao" | "alto" | "indisponivel" = "baixo";
  if (allUnavailable) riskLevel = "indisponivel";
  else if (temEmbargo || totalAlertasDesmatamento > 3) riskLevel = "alto";
  else if (totalAlertasDesmatamento > 0) riskLevel = "atencao";

  const riskConfig = {
    baixo: { color: "text-green-600", bg: "bg-green-50 border-green-200", badge: "bg-green-100 text-green-700 border-green-200", label: "Baixo risco", icon: CheckCircle2 },
    atencao: { color: "text-yellow-600", bg: "bg-yellow-50 border-yellow-200", badge: "bg-yellow-100 text-yellow-700 border-yellow-200", label: "Atenção", icon: AlertCircle },
    alto: { color: "text-red-600", bg: "bg-red-50 border-red-200", badge: "bg-red-100 text-red-700 border-red-200", label: "Risco elevado", icon: AlertCircle },
    indisponivel: { color: "text-gray-500", bg: "bg-gray-50 border-gray-200", badge: "bg-gray-100 text-gray-600 border-gray-200", label: "Dados indisponíveis", icon: AlertCircle },
  };
  const rc = riskConfig[riskLevel];
  const RiskIcon = rc.icon;

  const transicoes = mapbiomas?.transicoes || [];
  const historico = mapbiomas?.historico || [];
  const usoEstavel = historico.length > 0 && transicoes.length === 0;

  return (
    <>
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium">Due Diligence Ambiental</p>
            {ambiental.consultadoEm && (
              <Badge className={cn("text-xs", rc.badge)} data-testid="badge-ambiental-status">
                Consultado em {new Date(ambiental.consultadoEm).toLocaleDateString("pt-BR")}
              </Badge>
            )}
          </div>
          <Button
            size="sm" variant="outline" className="gap-1.5 shrink-0"
            disabled={consultarMutation.isPending}
            onClick={() => consultarMutation.mutate()}
            data-testid="button-atualizar-ambiental"
          >
            {consultarMutation.isPending
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Atualizando...</>
              : <><RefreshCw className="w-3.5 h-3.5" /> Atualizar</>}
          </Button>
        </CardContent>
      </Card>

      <Card className={cn("border", rc.bg)}>
        <CardContent className="p-5">
          <div className="flex items-center gap-4">
            <div className="shrink-0">
              <RiskIcon className={cn("w-10 h-10", rc.color)} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className={cn("text-lg font-bold", rc.color)} data-testid="text-risk-level">{rc.label}</p>
                <Badge className={cn("text-xs", rc.badge)} data-testid="badge-risco-ambiental">{rc.label}</Badge>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span data-testid="text-total-alertas">{totalAlertasDesmatamento} alerta(s) de desmatamento</span>
                <span data-testid="text-ibama-status">{!ibama ? "IBAMA não consultado" : temEmbargo ? `${ibama.totalEmbargos} embargo(s) IBAMA` : "Sem embargos IBAMA"}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {historico.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-600" />
              Histórico de Uso do Solo (1985–{historico[historico.length - 1]?.ano || 2024})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <LandUseTimeline historico={historico} />
            {usoEstavel && (
              <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2" data-testid="text-uso-estavel">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                Uso estável: <span className="font-medium">{mapbiomas.usoAtual}</span> desde {historico[0]?.ano}
              </div>
            )}
            {transicoes.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Transições detectadas:</p>
                {transicoes.map((t: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-amber-50 rounded-lg px-3 py-2" data-testid={`row-transicao-${i}`}>
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span className="text-amber-800"><strong>{t.ano}:</strong> {t.de} → {t.para}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="w-4 h-4 text-blue-500" />
              Território
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="space-y-1.5">
              {mapbiomas?.bioma && mapbiomas.bioma !== "Não identificado" && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Bioma</span>
                  <span className="font-medium" data-testid="text-bioma">{mapbiomas.bioma}</span>
                </div>
              )}
              {mapbiomas?.bacia && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Bacia</span>
                  <span className="font-medium" data-testid="text-bacia">{mapbiomas.bacia}</span>
                </div>
              )}
              {mapbiomas?.municipio && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Município</span>
                  <span className="font-medium" data-testid="text-municipio-mb">{mapbiomas.municipio}</span>
                </div>
              )}
              {mapbiomas?.estado && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Estado</span>
                  <span className="font-medium" data-testid="text-estado-mb">{mapbiomas.estado}</span>
                </div>
              )}
              {mapbiomas?.usoAtual && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Uso atual</span>
                  <span className="font-medium" data-testid="text-uso-solo">{mapbiomas.usoAtual}</span>
                </div>
              )}
              {mapbiomas?.propriedade && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Área CAR</span>
                  <span className="font-medium" data-testid="text-area-car">{mapbiomas.propriedade.areaHa?.toFixed(1)} ha</span>
                </div>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground pt-1">MapBiomas Cobertura + Territórios</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="w-4 h-4 text-red-500" />
              IBAMA
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {ibama ? (
              <>
                <div className={cn("rounded-lg p-3 text-center", ibama.temEmbargo ? "bg-red-50" : "bg-green-50")}>
                  {ibama.temEmbargo ? (
                    <>
                      <p className="text-2xl font-bold text-red-600" data-testid="text-ibama-embargos">{ibama.totalEmbargos}</p>
                      <p className="text-xs text-red-600">Embargo(s) no município</p>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-6 h-6 text-green-600 mx-auto" />
                      <p className="text-xs text-green-700 font-medium mt-1" data-testid="text-ibama-ok">Sem embargos IBAMA</p>
                    </>
                  )}
                </div>
                {ibama.totalInfracoes > 0 && (
                  <div className="rounded-lg p-2 bg-muted/50 text-center">
                    <p className="text-lg font-semibold" data-testid="text-ibama-infracoes">{ibama.totalInfracoes}</p>
                    <p className="text-[10px] text-muted-foreground">Infrações ambientais no município</p>
                  </div>
                )}
                {ibama.embargos && ibama.embargos.length > 0 && (
                  <Button
                    variant="ghost" size="sm" className="w-full text-xs gap-1"
                    onClick={() => setShowIbamaDetails(!showIbamaDetails)}
                    data-testid="button-ibama-detalhes"
                  >
                    {showIbamaDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {showIbamaDetails ? "Ocultar detalhes" : `Ver ${ibama.embargos.length} infração(ões)`}
                  </Button>
                )}
                {showIbamaDetails && ibama.embargos?.map((e: any, i: number) => (
                  <div key={i} className={cn("text-xs rounded px-2.5 py-2 space-y-0.5", e.temEmbargo ? "bg-red-50" : "bg-muted/30")} data-testid={`row-ibama-embargo-${i}`}>
                    <div className="flex justify-between">
                      <span className="font-medium">Auto: {e.numAuto || e.numero || "—"}</span>
                      <span className="text-muted-foreground">{e.dataInfracao || e.data || "—"}</span>
                    </div>
                    {(e.tipInfracao || e.tipoInfracao) && <p className="text-muted-foreground truncate">{e.tipInfracao || e.tipoInfracao}</p>}
                    {e.descricao && <p className="text-muted-foreground truncate">{e.descricao}</p>}
                    <div className="flex gap-1">
                      {e.situacao && <Badge variant="outline" className="text-[10px]">{e.situacao}</Badge>}
                      {e.temEmbargo && <Badge variant="destructive" className="text-[10px]">Embargado</Badge>}
                    </div>
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground">{ibama.fonte}</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">Dados IBAMA indisponíveis</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-orange-500" />
              Alertas de Desmatamento
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-muted/40 rounded-lg p-2.5 text-center">
                <p className="text-xl font-bold" data-testid="text-deter-alertas">{deter?.totalAlertas ?? "—"}</p>
                <p className="text-[10px] text-muted-foreground">DETER</p>
              </div>
              <div className="bg-muted/40 rounded-lg p-2.5 text-center">
                <p className="text-xl font-bold" data-testid="text-mapbiomas-alertas">{mapbiomas?.alertasDesmatamento ?? "—"}</p>
                <p className="text-[10px] text-muted-foreground">MapBiomas</p>
              </div>
            </div>
            {(deter?.areaDesmatadaHa > 0 || mapbiomas?.areaDesmatadaHa > 0) && (
              <div className="text-xs text-center text-muted-foreground" data-testid="text-area-desmatada">
                Área total: {((deter?.areaDesmatadaHa || 0) + (mapbiomas?.areaDesmatadaHa || 0)).toFixed(1)} ha
              </div>
            )}
            {deter?.alertas && deter.alertas.length > 0 && (
              <>
                <Button
                  variant="ghost" size="sm" className="w-full text-xs gap-1"
                  onClick={() => setShowDeterDetails(!showDeterDetails)}
                  data-testid="button-deter-detalhes"
                >
                  {showDeterDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {showDeterDetails ? "Ocultar alertas" : `Ver ${deter.alertas.length} alerta(s)`}
                </Button>
                {showDeterDetails && (
                  <div className="space-y-1 max-h-[180px] overflow-y-auto">
                    {deter.alertas.slice(0, 10).map((a: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-[10px] bg-muted/30 rounded px-2 py-1" data-testid={`row-deter-alerta-${i}`}>
                        <span className="font-medium">{a.classe}</span>
                        <span>{a.areaHa} ha</span>
                        <span className="text-muted-foreground">{a.data}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {totalAlertasDesmatamento === 0 && (
              <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                Nenhum alerta de desmatamento
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">DETER/INPE + MapBiomas Alerta</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

const TIPO_CONFIG: Record<string, { label: string; icon: any; color: string; badge: string }> = {
  TERRA:           { label: "Terra / Fazenda",       icon: TreePine,  color: "text-green-600",  badge: "bg-green-100 text-green-800" },
  MINA:            { label: "Mineração",              icon: Pickaxe,   color: "text-orange-600", badge: "bg-orange-100 text-orange-800" },
  NEGOCIO:         { label: "Negócio / M&A",          icon: Briefcase, color: "text-blue-600",   badge: "bg-blue-100 text-blue-800" },
  FII_CRI:         { label: "Ativo legado", icon: Home, color: "text-muted-foreground", badge: "bg-muted" },
  DESENVOLVIMENTO: { label: "Desenvolvimento Imob.", icon: Factory,   color: "text-pink-600",   badge: "bg-pink-100 text-pink-800" },
  AGRO:            { label: "Agronegócio",            icon: Wheat,     color: "text-yellow-600", badge: "bg-yellow-100 text-yellow-800" },
};

const DOCS_STATUS: Record<string, { label: string; icon: any; color: string }> = {
  completo: { label: "Documentação completa", icon: CheckCircle2, color: "text-green-600" },
  parcial:  { label: "Documentação parcial",  icon: AlertCircle,  color: "text-amber-600" },
  pendente: { label: "Documentação pendente", icon: Clock,        color: "text-red-500" },
};

const ABAS_POR_TIPO: Record<string, Array<{id: string, label: string}>> = {
  TERRA: [
    { id: "info",       label: "Informações" },
    // { id: "matches",    label: "Matches" },
    { id: "geo",        label: "Geo & CAR" },
    { id: "ccir",       label: "CCIR" },
    { id: "embrapa",    label: "Embrapa" },
    { id: "ambiental",  label: "Ambiental" },
    { id: "duediligence", label: "Due Diligence" },
    { id: "ia",         label: "IA" },
  ],
  AGRO: [
    { id: "info",       label: "Informações" },
    // { id: "matches",    label: "Matches" },
    { id: "geo",        label: "Geo & CAR" },
    { id: "ccir",       label: "CCIR" },
    { id: "embrapa",    label: "Embrapa" },
    { id: "ambiental",  label: "Ambiental" },
    { id: "duediligence", label: "Due Diligence" },
    { id: "ia",         label: "IA" },
  ],
  MINA: [
    { id: "info",       label: "Informações" },
    // { id: "matches",    label: "Matches" },
    // Enriquecimento ANM dividido em 3 abas (grupos de ANM_TAB_GROUPS)
    { id: "anm",        label: "ANM" },
    { id: "titular-financas", label: "Titular & Finanças" },
    { id: "territorio", label: "Território" },
    { id: "geo",        label: "Geo" },
    { id: "documentos", label: "Documentos" },
    { id: "ia",         label: "IA" },
  ],
  NEGOCIO: [
    { id: "info",       label: "Informações" },
    // { id: "enriquecimento", label: "Onboarding" },
    // { id: "matches",    label: "Matches" },
    { id: "empresa",    label: "Empresa" },
    { id: "ia",         label: "IA" },
  ],
  DESENVOLVIMENTO: [
    { id: "info",       label: "Informações" },
    // { id: "enriquecimento", label: "Onboarding" },
    // { id: "matches",    label: "Matches" },
    { id: "geo",        label: "Geo" },
    { id: "empresa",    label: "Empresa" },
    { id: "ia",         label: "IA" },
  ],
};
// JAZIDA compartilha as mesmas abas do ativo minerário MINA
ABAS_POR_TIPO["JAZIDA"] = ABAS_POR_TIPO["MINA"];

// Ativos minerários (MINA/JAZIDA) compartilham polígono ANM, base fundiária etc.
const isTipoMinerario = (t?: string | null) => t === "MINA" || t === "JAZIDA";

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ── Parcelas certificadas SIGEF/INCRA sobre o processo (ativo MINA) ──
function SigefParcelasCard({ ativoId, savedData, selecionada, onSelect, onHover }: {
  ativoId: number;
  savedData?: any;
  selecionada?: string | null;
  onSelect?: (codigoParcela: string | null) => void;
  onHover?: (codigoParcela: string | null) => void;
}) {
  const { toast } = useToast();
  const [detentoresOpen, setDetentoresOpen] = useState(false);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  // Quando a seleção vem do mapa, rola até a linha correspondente
  useEffect(() => {
    if (!selecionada) return;
    const row = rowRefs.current[selecionada];
    if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selecionada]);
  const consultarMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/assets/${ativoId}/sigef-parcelas`);
      return await res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets", String(ativoId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/assets", ativoId] });
      queryClient.invalidateQueries({ queryKey: ["/api/assets", String(ativoId), "sigef-parcelas-geometrias"] });
      toast({
        title: "Consulta SIGEF concluída",
        description: data.totalSobrepostas > 0
          ? `${data.totalSobrepostas} parcela(s) certificada(s) sobre o processo`
          : "Nenhuma parcela certificada sobre o processo",
      });
    },
    onError: (e: any) => {
      toast({ title: "Falha na consulta SIGEF", description: e?.message || "Serviço indisponível", variant: "destructive" });
    },
  });

  const data = consultarMutation.data || savedData;
  const sobrepostas = (data?.parcelas || []).filter((p: any) => p.relacao === "sobreposta");
  const vizinhas = (data?.parcelas || []).filter((p: any) => p.relacao === "vizinha");
  const semDetentor = (data?.parcelas || []).filter((p: any) => !p.detentor && p.codigoImovel).length;

  const tabela = (parcelas: any[], testId: string) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" data-testid={testId}>
        <thead>
          <tr className="text-left text-muted-foreground border-b">
            <th className="py-1.5 pr-2 font-medium">Código da parcela</th>
            <th className="py-1.5 pr-2 font-medium">Denominação</th>
            <th className="py-1.5 pr-2 font-medium">Detentor</th>
            <th className="py-1.5 pr-2 font-medium text-right">Área (ha)</th>
            <th className="py-1.5 pr-2 font-medium text-right">Sobrepos. (%)</th>
            <th className="py-1.5 font-medium">Situação</th>
          </tr>
        </thead>
        <tbody>
          {parcelas.map((p: any, i: number) => (
            <tr
              key={p.codigoParcela || i}
              ref={(el) => { if (p.codigoParcela) rowRefs.current[p.codigoParcela] = el; }}
              className={cn(
                "border-b last:border-0",
                p.codigoParcela && "cursor-pointer hover:bg-muted/50",
                p.codigoParcela && selecionada === p.codigoParcela && "bg-amber-100 dark:bg-amber-900/40",
              )}
              onClick={() => { if (p.codigoParcela) onSelect?.(selecionada === p.codigoParcela ? null : p.codigoParcela); }}
              onMouseEnter={() => { if (p.codigoParcela) onHover?.(p.codigoParcela); }}
              onMouseLeave={() => onHover?.(null)}
              data-testid={`row-sigef-parcela-${p.codigoParcela || i}`}
            >
              <td className="py-1.5 pr-2 font-mono text-[11px]">{p.codigoParcela || "—"}</td>
              <td className="py-1.5 pr-2">{p.nomeArea || "—"}</td>
              <td className="py-1.5 pr-2" data-testid={`text-sigef-detentor-${i}`}>{p.detentor || "—"}</td>
              <td className="py-1.5 pr-2 text-right">{p.areaHa != null ? p.areaHa.toLocaleString("pt-BR") : "—"}</td>
              <td className="py-1.5 pr-2 text-right">{p.sobreposicaoPct != null ? `${p.sobreposicaoPct.toLocaleString("pt-BR")}%` : "—"}</td>
              <td className="py-1.5">{p.situacao || p.status || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">Propriedades sobre o processo (SIGEF)</CardTitle>
          <div className="flex items-center gap-1.5">
            {data && semDetentor > 0 && (
              <Button size="sm" variant="outline" className="gap-1.5"
                onClick={() => setDetentoresOpen(true)} data-testid="button-buscar-detentores">
                <Users className="w-3.5 h-3.5" /> Buscar detentores
              </Button>
            )}
            <Button size="sm" variant="outline" className="gap-1.5" disabled={consultarMutation.isPending}
              onClick={() => consultarMutation.mutate()} data-testid="button-consultar-sigef">
              {consultarMutation.isPending
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Consultando...</>
                : <><Search className="w-3.5 h-3.5" /> {data ? "Atualizar" : "Consultar SIGEF"}</>}
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Parcelas georreferenciadas certificadas (SIGEF/INCRA) que intersectam o polígono do processo — indica com quem negociar acesso, servidão ou compra da superfície.
        </p>
      </CardHeader>
      {data && (
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" data-testid="badge-sigef-sobrepostas">{data.totalSobrepostas} sobre o processo</Badge>
            <Badge variant="outline" data-testid="badge-sigef-vizinhas">{data.totalVizinhas} vizinha(s)</Badge>
            {data.coberturaPct != null && (
              <Badge variant="outline">{Number(data.coberturaPct).toLocaleString("pt-BR")}% do processo coberto por área certificada</Badge>
            )}
            {data.truncado && (
              <Badge variant="outline" className="border-amber-400 text-amber-700">Lista parcial — muitas parcelas na região</Badge>
            )}
          </div>
          {data.avisoDataBase && (
            <div className="p-3 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200" data-testid="text-sigef-base-defasada">
              {data.avisoDataBase}
            </div>
          )}
          {sobrepostas.length > 0 ? (
            <div>
              <p className="text-xs font-semibold mb-1">Parcelas sobre o processo</p>
              {tabela(sobrepostas, "table-sigef-sobrepostas")}
            </div>
          ) : (
            <div className="p-3 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200" data-testid="text-sigef-vazio">
              Nenhuma parcela certificada sobre o processo — a área possivelmente não está georreferenciada no SIGEF (sinal de informalidade fundiária). Isso não significa ausência de proprietário: verifique matrículas em cartório.
            </div>
          )}
          {vizinhas.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-1">Parcelas vizinhas imediatas</p>
              {tabela(vizinhas, "table-sigef-vizinhas")}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            Fonte: {data.fonte} · base {data.dataBase} · consultado em {data.consultadoEm ? new Date(data.consultadoEm).toLocaleString("pt-BR") : "—"}. Detentores via Consulta Pública do SNCR (sem CPF completo).
          </p>
        </CardContent>
      )}
      <SigefDetentoresDialog ativoId={ativoId} open={detentoresOpen} onOpenChange={setDetentoresOpen} />
    </Card>
  );
}

// ── Imóveis CAR sobrepostos ao processo (ativo MINA) ──
function CarImoveisCard({ ativoId, savedData, selecionado, onSelect, onHover }: {
  ativoId: number;
  savedData?: any;
  selecionado?: string | null;
  onSelect?: (codImovel: string | null) => void;
  onHover?: (codImovel: string | null) => void;
}) {
  const { toast } = useToast();
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  useEffect(() => {
    if (!selecionado) return;
    const row = rowRefs.current[selecionado];
    if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selecionado]);

  const consultarMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/assets/${ativoId}/car-imoveis`);
      return await res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets", String(ativoId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/assets", ativoId] });
      queryClient.invalidateQueries({ queryKey: ["/api/assets", String(ativoId), "car-imoveis-geometrias"] });
      toast({
        title: "Consulta CAR concluída",
        description: data.totalSobrepostos > 0
          ? `${data.totalSobrepostos} imóvel(is) CAR sobre o processo`
          : "Nenhum imóvel CAR sobre o processo",
      });
    },
    onError: (e: any) => {
      toast({ title: "Falha na consulta CAR", description: e?.message || "GeoServer do SICAR indisponível", variant: "destructive" });
    },
  });

  const data = consultarMutation.data || savedData;
  const sobrepostos = (data?.imoveis || []).filter((i: any) => i.relacao === "sobreposto");
  const vizinhos = (data?.imoveis || []).filter((i: any) => i.relacao === "vizinho");

  const tabela = (imoveis: any[], testId: string) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" data-testid={testId}>
        <thead>
          <tr className="text-left text-muted-foreground border-b">
            <th className="py-1.5 pr-2 font-medium">Código CAR</th>
            <th className="py-1.5 pr-2 font-medium">Município/UF</th>
            <th className="py-1.5 pr-2 font-medium text-right">Área (ha)</th>
            <th className="py-1.5 pr-2 font-medium">Status</th>
            <th className="py-1.5 pr-2 font-medium">Tipo</th>
            <th className="py-1.5 font-medium text-right">Sobrepos. (%)</th>
          </tr>
        </thead>
        <tbody>
          {imoveis.map((i: any, idx: number) => (
            <tr
              key={i.codImovel || idx}
              ref={(el) => { if (i.codImovel) rowRefs.current[i.codImovel] = el; }}
              className={cn(
                "border-b last:border-0",
                i.codImovel && "cursor-pointer hover:bg-muted/50",
                i.codImovel && selecionado === i.codImovel && "bg-violet-100 dark:bg-violet-900/40",
              )}
              onClick={() => { if (i.codImovel) onSelect?.(selecionado === i.codImovel ? null : i.codImovel); }}
              onMouseEnter={() => { if (i.codImovel) onHover?.(i.codImovel); }}
              onMouseLeave={() => onHover?.(null)}
              data-testid={`row-car-imovel-${i.codImovel || idx}`}
            >
              <td className="py-1.5 pr-2 font-mono text-[11px]">{i.codImovel || "—"}</td>
              <td className="py-1.5 pr-2">{[i.municipio, i.uf].filter(Boolean).join("/") || "—"}</td>
              <td className="py-1.5 pr-2 text-right">{i.areaHa != null ? i.areaHa.toLocaleString("pt-BR") : "—"}</td>
              <td className="py-1.5 pr-2">{i.status || "—"}{i.condicao ? ` · ${i.condicao}` : ""}</td>
              <td className="py-1.5 pr-2">{i.tipo || "—"}</td>
              <td className="py-1.5 text-right">{i.sobreposicaoPct != null ? `${i.sobreposicaoPct.toLocaleString("pt-BR")}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">Imóveis CAR sobre o processo (SICAR)</CardTitle>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={consultarMutation.isPending}
            onClick={() => consultarMutation.mutate()} data-testid="button-consultar-car">
            {consultarMutation.isPending
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Consultando...</>
              : <><Search className="w-3.5 h-3.5" /> {data ? "Atualizar" : "Consultar CAR"}</>}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Imóveis declarados no Cadastro Ambiental Rural que intersectam o polígono do processo — revela ocupantes/posseiros declarados mesmo onde não há parcela certificada no SIGEF.
        </p>
      </CardHeader>
      {data && (
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" data-testid="badge-car-sobrepostos">{data.totalSobrepostos} sobre o processo</Badge>
            <Badge variant="outline" data-testid="badge-car-vizinhos">{data.totalVizinhos} vizinho(s)</Badge>
            {data.coberturaPct != null && (
              <Badge variant="outline">{Number(data.coberturaPct).toLocaleString("pt-BR")}% do processo coberto por imóveis CAR</Badge>
            )}
            {data.truncado && (
              <Badge variant="outline" className="border-amber-400 text-amber-700">Lista parcial — muitos imóveis na região</Badge>
            )}
          </div>
          {sobrepostos.length > 0 ? (
            <div>
              <p className="text-xs font-semibold mb-1">Imóveis sobre o processo</p>
              {tabela(sobrepostos, "table-car-sobrepostos")}
            </div>
          ) : (
            <div className="p-3 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200" data-testid="text-car-vazio">
              Nenhum imóvel CAR sobre o processo — ausência de declaração no CAR não significa ausência de ocupantes. Verifique em campo e em cartório.
            </div>
          )}
          {vizinhos.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-1">Imóveis vizinhos imediatos</p>
              {tabela(vizinhos, "table-car-vizinhos")}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            Fonte: {data.fonte} · consultado em {data.consultadoEm ? new Date(data.consultadoEm).toLocaleString("pt-BR") : "—"}. Status/condição refletem a análise do CAR pelo órgão estadual.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

// ── CCIR / base fundiária por imóvel identificado (ativo MINA) ──
function CcirMinaCard({ ativoId, savedData, temInsumos }: {
  ativoId: number;
  savedData?: any;
  temInsumos: boolean;
}) {
  const { toast } = useToast();

  const consultarMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/enrichment/ccir/${ativoId}`);
      return await res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets", String(ativoId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/assets", ativoId] });
      toast({
        title: "Base fundiária consolidada",
        description: `${data.ccirImoveis?.totalImoveis ?? 0} imóvel(is) identificado(s) sobre o processo`,
      });
    },
    onError: (e: any) => {
      toast({ title: "Falha na consolidação CCIR", description: e?.message || "Serviço indisponível", variant: "destructive" });
    },
  });

  const data = consultarMutation.data?.ccirImoveis || savedData;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">CCIR / Base fundiária por imóvel</CardTitle>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={consultarMutation.isPending || !temInsumos}
            onClick={() => consultarMutation.mutate()} data-testid="button-consultar-ccir-mina">
            {consultarMutation.isPending
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Consolidando...</>
              : <><Search className="w-3.5 h-3.5" /> {data ? "Atualizar" : "Consolidar"}</>}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Consolida por imóvel os dados de CCIR/SNCR disponíveis (código INCRA, denominação, detentores, situação, área) a partir das parcelas SIGEF e dos imóveis CAR sobre o processo.
        </p>
        {!temInsumos && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1" data-testid="text-ccir-mina-sem-insumos">
            Consulte primeiro as parcelas SIGEF e/ou os imóveis CAR acima.
          </p>
        )}
      </CardHeader>
      {data && (
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" data-testid="badge-ccir-total">{data.totalImoveis} imóvel(is)</Badge>
            <Badge variant="outline" data-testid="badge-ccir-incra">{data.comCodigoIncra} com código INCRA</Badge>
            <Badge variant="outline" data-testid="badge-ccir-detentor">{data.comDetentor} com detentor</Badge>
            {data.municipiosPendentesSncr > 0 && (
              <Badge variant="outline" className="border-amber-400 text-amber-700">
                {data.municipiosPendentesSncr} município(s) SNCR pendente(s) — use "Buscar detentores" no card SIGEF
              </Badge>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="table-ccir-imoveis">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-1.5 pr-2 font-medium">Código INCRA</th>
                  <th className="py-1.5 pr-2 font-medium">Código CAR</th>
                  <th className="py-1.5 pr-2 font-medium">Denominação</th>
                  <th className="py-1.5 pr-2 font-medium">Detentores</th>
                  <th className="py-1.5 pr-2 font-medium text-right">Área (ha)</th>
                  <th className="py-1.5 pr-2 font-medium text-right">Sobrepos. (%)</th>
                  <th className="py-1.5 pr-2 font-medium">Situação</th>
                  <th className="py-1.5 font-medium">Origem</th>
                </tr>
              </thead>
              <tbody>
                {(data.imoveis || []).map((i: any, idx: number) => (
                  <tr key={idx} className="border-b last:border-0" data-testid={`row-ccir-imovel-${idx}`}>
                    <td className="py-1.5 pr-2 font-mono text-[11px]">{i.codigoIncra || "—"}</td>
                    <td className="py-1.5 pr-2 font-mono text-[11px] max-w-[180px] truncate" title={i.codigoCar || undefined}>{i.codigoCar || "—"}</td>
                    <td className="py-1.5 pr-2">{i.denominacao || "—"}</td>
                    <td className="py-1.5 pr-2">{Array.isArray(i.detentores) && i.detentores.length > 0 ? i.detentores.join("; ") : "—"}</td>
                    <td className="py-1.5 pr-2 text-right">{i.areaHa != null ? Number(i.areaHa).toLocaleString("pt-BR") : "—"}</td>
                    <td className="py-1.5 pr-2 text-right">{i.sobreposicaoPct != null ? `${Number(i.sobreposicaoPct).toLocaleString("pt-BR")}%` : "—"}</td>
                    <td className="py-1.5 pr-2">{i.situacao || "—"}</td>
                    <td className="py-1.5">
                      <Badge variant="outline" className="text-[10px]">{i.origem}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.observacao && (
            <p className="text-[10px] text-muted-foreground">{data.observacao}</p>
          )}
          <p className="text-[10px] text-muted-foreground">
            Fonte: {data.fonte} · consultado em {data.consultadoEm ? new Date(data.consultadoEm).toLocaleString("pt-BR") : "—"}.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

function AnmLiveQuery({ processoAnm, onSave, savedData }: { processoAnm?: string | null; onSave?: (data: any) => void; savedData?: any }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(savedData || null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (savedData && !result) setResult(savedData); }, [savedData]);

  const consultar = async () => {
    if (!processoAnm) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiRequest("GET", `/api/anm/processos?processo=${encodeURIComponent(processoAnm)}`);
      if (!res.ok) throw new Error();
      const data = await res.json() as any;
      setResult(data);
      if (onSave && data) onSave(data);
    } catch {
      setError("Não foi possível consultar o ANM agora");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Consulta ao Vivo — ANM</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          variant="outline"
          size="sm"
          onClick={consultar}
          disabled={loading || !processoAnm}
          data-testid="button-atualizar-anm"
        >
          {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
          {loading ? "Consultando..." : "Atualizar dados ANM"}
        </Button>

        {!processoAnm && (
          <p className="text-xs text-muted-foreground" data-testid="text-anm-sem-processo">Nenhum nº de processo ANM vinculado a este ativo.</p>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span data-testid="text-anm-erro">{error}</span>
          </div>
        )}

        {result && result.features?.length > 0 && (
          <div className="space-y-2">
            {result.features.map((f: any, idx: number) => (
              <Card key={idx} className="border-muted">
                <CardContent className="p-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  {f.PROCESSO && (
                    <div>
                      <p className="text-xs text-muted-foreground">Processo</p>
                      <p className="font-medium" data-testid={`text-anm-live-processo-${idx}`}>{f.PROCESSO}</p>
                    </div>
                  )}
                  {f.NOME && (
                    <div>
                      <p className="text-xs text-muted-foreground">Titular</p>
                      <p className="font-medium truncate" data-testid={`text-anm-live-titular-${idx}`}>{f.NOME}</p>
                    </div>
                  )}
                  {f.FASE && (
                    <div>
                      <p className="text-xs text-muted-foreground">Fase</p>
                      <Badge variant="outline" className="text-xs mt-0.5" data-testid={`text-anm-live-fase-${idx}`}>{f.FASE}</Badge>
                    </div>
                  )}
                  {f.SUBS && (
                    <div>
                      <p className="text-xs text-muted-foreground">Substância</p>
                      <p className="font-medium" data-testid={`text-anm-live-subs-${idx}`}>{f.SUBS}</p>
                    </div>
                  )}
                  {f.UF && (
                    <div>
                      <p className="text-xs text-muted-foreground">UF</p>
                      <p className="font-medium">{f.UF}</p>
                    </div>
                  )}
                  {f.AREA_HA && (
                    <div>
                      <p className="text-xs text-muted-foreground">Área (ha)</p>
                      <p className="font-medium">{Number(f.AREA_HA).toLocaleString("pt-BR")}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            <p className="text-xs text-muted-foreground">{result.total} resultado(s) retornado(s) pelo geoportal ANM</p>
          </div>
        )}

        {result && result.features?.length === 0 && (
          <p className="text-xs text-muted-foreground" data-testid="text-anm-sem-resultado">Nenhum resultado encontrado no geoportal ANM para este processo.</p>
        )}
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value, className }: { label: string; value?: string | null; className?: string }) {
  if (!value) return null;
  return (
    <div className={cn("space-y-0.5", className)}>
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function InfoRowAlways({ label, value, testId, className }: { label: string; value?: string | null; testId?: string; className?: string }) {
  return (
    <div className={cn("space-y-0.5", className)}>
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      <p className={cn("text-sm font-medium", !value && "text-muted-foreground")} data-testid={testId}>{value || "—"}</p>
    </div>
  );
}

function ChecklistItemRow({ item, checked, onToggle, ativoId, ativoType, ativoTitle }: {
  item: string;
  checked: boolean;
  onToggle: () => void;
  ativoId: number;
  ativoType: string;
  ativoTitle: string;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const filesQuery = useQuery({
    queryKey: ["/api/documents/ativo", ativoId, "checklist", item],
    queryFn: async () => {
      const params = new URLSearchParams({ tipo: ativoType, titulo: `${ativoTitle} — ${item}` });
      const res = await apiRequest("GET", `/api/documents/ativo/${ativoId}?${params.toString()}`);
      if (!res.ok) return { arquivos: [] };
      return res.json();
    },
    enabled: expanded,
  });

  const arquivos = (filesQuery.data?.arquivos || []) as Array<{ id: string; name: string; webViewLink: string; mimeType: string; createdTime: string }>;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("arquivo", file);
      formData.append("tipo", ativoType);
      formData.append("titulo", `${ativoTitle} — ${item}`);
      const res = await fetch(`/api/documents/ativo/${ativoId}`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as any;
        throw new Error(err.message || "Erro no upload");
      }
      toast({ title: "Documento enviado" });
      filesQuery.refetch();
      if (!checked) onToggle();
    } catch (err: any) {
      toast({ title: err.message || "Erro ao enviar documento", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (fileId: string) => {
    try {
      await apiRequest("DELETE", `/api/documents/${fileId}`);
      toast({ title: "Documento removido" });
      filesQuery.refetch();
    } catch {
      toast({ title: "Erro ao remover documento", variant: "destructive" });
    }
  };

  return (
    <div
      className="rounded-lg border hover:border-primary/30 transition-colors"
      data-testid={`checklist-item-${item.slice(0, 20).replace(/\s/g, '-')}`}
    >
      <div className="flex items-center gap-3 p-2.5 cursor-pointer" onClick={onToggle}>
        <div className={cn(
          "w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
          checked ? "bg-green-500 border-green-500" : "border-muted-foreground/40"
        )}>
          {checked && <CheckCircle2 className="w-3 h-3 text-white" />}
        </div>
        <span className={cn("text-sm flex-1", checked ? "line-through text-muted-foreground" : "")}>
          {item}
        </span>
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.txt"
            onChange={handleUpload}
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            data-testid={`button-upload-doc-${item.slice(0, 15).replace(/\s/g, '-')}`}
          >
            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
            Enviar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={cn("h-7 px-2 text-xs gap-1", expanded ? "text-primary" : "text-muted-foreground")}
            onClick={() => setExpanded(!expanded)}
            data-testid={`button-toggle-docs-${item.slice(0, 15).replace(/\s/g, '-')}`}
          >
            <Paperclip className="w-3 h-3" />
            {expanded ? "Ocultar" : "Docs"}
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="px-2.5 pb-2.5 pt-0">
          {filesQuery.isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Carregando...
            </div>
          ) : arquivos.length === 0 ? (
            <p className="text-xs text-muted-foreground py-1 pl-7">Nenhum documento enviado</p>
          ) : (
            <div className="space-y-1 pl-7">
              {arquivos.map((arq) => (
                <div key={arq.id} className="flex items-center gap-2 group/file" data-testid={`doc-file-${arq.id}`}>
                  <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                  <a
                    href={arq.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline truncate flex-1"
                    data-testid={`link-doc-${arq.id}`}
                  >
                    {arq.name.replace(/^\d{8}_\d{6}_/, "")}
                  </a>
                  <a
                    href={arq.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <button
                    onClick={() => handleDelete(arq.id)}
                    className="text-muted-foreground hover:text-destructive opacity-0 group-hover/file:opacity-100 transition-opacity"
                    data-testid={`button-delete-doc-${arq.id}`}
                  >
                    <XIcon className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChecklistSection({ title, items, savedChecks, ativoId, checkKey, camposEspecificos, ativoType, ativoTitle }: {
  title: string;
  items: Array<{ item: string; obrigatorio: boolean }>;
  savedChecks: Record<string, boolean>;
  ativoId: number;
  checkKey: string;
  camposEspecificos: CamposEspecificos;
  ativoType: string;
  ativoTitle: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [localChecks, setLocalChecks] = useState<Record<string, boolean>>(savedChecks);

  const toggleItem = async (item: string) => {
    const newChecks = { ...localChecks, [item]: !localChecks[item] };
    setLocalChecks(newChecks);
    try {
      // Só o delta do checklist — o servidor faz merge atômico e preserva
      // enriquecimentos salvos em paralelo.
      await apiRequest("PATCH", `/api/assets/${ativoId}`, {
        camposEspecificos: {
          [checkKey]: newChecks,
        },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/assets", String(ativoId)] });
    } catch {
      toast({ title: "Erro ao salvar checklist", variant: "destructive" });
      setLocalChecks(localChecks);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
      {items.map(({ item }) => (
        <ChecklistItemRow
          key={item}
          item={item}
          checked={!!localChecks[item]}
          onToggle={() => toggleItem(item)}
          ativoId={ativoId}
          ativoType={ativoType}
          ativoTitle={ativoTitle}
        />
      ))}
    </div>
  );
}

function AssetPhotosSection({ ativo, assetId }: { ativo: any; assetId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const fotos: string[] = Array.isArray(ativo.fotos) ? ativo.fotos : [];

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("images", files[i]);
      }
      const uploadRes = await fetch("/api/upload/images", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({})) as any;
        throw new Error(err.message || "Erro no upload");
      }
      const { urls } = await uploadRes.json();
      const novasFotos = [...fotos, ...urls];
      await apiRequest("PATCH", `/api/assets/${assetId}`, { fotos: novasFotos });
      queryClient.invalidateQueries({ queryKey: ["/api/assets", String(assetId)] });
      toast({ title: `${urls.length} foto(s) enviada(s)` });
    } catch (err: any) {
      toast({ title: err.message || "Erro ao enviar fotos", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemove = async (url: string) => {
    const novasFotos = fotos.filter((f: string) => f !== url);
    try {
      await apiRequest("PATCH", `/api/assets/${assetId}`, { fotos: novasFotos });
      queryClient.invalidateQueries({ queryKey: ["/api/assets", String(assetId)] });
      toast({ title: "Foto removida" });
    } catch {
      toast({ title: "Erro ao remover foto", variant: "destructive" });
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm flex items-center gap-2">
              <Camera className="w-4 h-4 text-muted-foreground" /> Fotos do Ativo
              {fotos.length > 0 && (
                <Badge variant="secondary" className="text-xs">{fotos.length}</Badge>
              )}
            </CardTitle>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                onChange={handleUpload}
                data-testid="input-upload-fotos"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                data-testid="button-upload-fotos"
              >
                {uploading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}
                {uploading ? "Enviando..." : "Adicionar fotos"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {fotos.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-8 text-muted-foreground cursor-pointer rounded-lg border-2 border-dashed hover:border-primary/30 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              data-testid="dropzone-fotos"
            >
              <Image className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">Nenhuma foto adicionada</p>
              <p className="text-xs mt-1">Clique para enviar fotos do ativo</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {fotos.map((url: string, idx: number) => (
                <div
                  key={idx}
                  className="relative group rounded-lg overflow-visible border"
                  data-testid={`foto-ativo-${idx}`}
                >
                  <img
                    src={url}
                    alt={`Foto ${idx + 1}`}
                    className="w-full h-32 object-cover rounded-lg cursor-pointer"
                    onClick={() => setPreviewUrl(url)}
                    data-testid={`img-foto-${idx}`}
                  />
                  <Button
                    size="icon"
                    variant="destructive"
                    className="absolute top-1 right-1 w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleRemove(url)}
                    data-testid={`button-remove-foto-${idx}`}
                  >
                    <XIcon className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewUrl(null)}
          data-testid="modal-preview-foto"
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img
              src={previewUrl}
              alt="Preview"
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
            />
            <Button
              size="icon"
              variant="secondary"
              className="absolute top-2 right-2"
              onClick={() => setPreviewUrl(null)}
              data-testid="button-fechar-preview"
            >
              <XIcon className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

const ENRICHMENT_FIELDS_CONFIG: Record<string, Array<{
  key: string; label: string; type: "select" | "text" | "number" | "boolean" | "multiselect" | "textarea";
  options?: string[];
}>> = {
  TERRA: [
    { key: "aptidaoUso", label: "Aptidão de uso", type: "select", options: ["Pecuária", "Grãos", "Reflorestamento", "Fruticultura", "Cana", "Café", "Mista"] },
    { key: "topografia", label: "Topografia", type: "select", options: ["Plano", "Suave Ondulado", "Ondulado", "Montanhoso"] },
    { key: "acessoPrincipal", label: "Acesso principal", type: "select", options: ["Asfalto", "Terra transitável", "Precário"] },
    { key: "aguaDisponivel", label: "Água disponível", type: "select", options: ["Rio", "Poço artesiano", "Represa", "Nascente", "Sem recurso hídrico"] },
    { key: "energiaEletrica", label: "Possui energia elétrica", type: "boolean" },
    { key: "benfeitorias", label: "Benfeitorias", type: "multiselect", options: ["Sede", "Curral", "Galpão", "Irrigação", "Nenhuma"] },
    { key: "aceitaPermuta", label: "Aceita permuta", type: "boolean" },
    { key: "situacaoDocumental", label: "Situação documental", type: "select", options: ["Regularizado", "Pendente", "Irregular", "Em regularização"] },
    { key: "possuiReservaLegal", label: "Possui reserva legal demarcada", type: "boolean" },
    { key: "observacoesQualitativas", label: "Observações qualitativas", type: "textarea" },
  ],
  AGRO: [
    { key: "aptidaoUso", label: "Aptidão de uso", type: "select", options: ["Pecuária", "Grãos", "Reflorestamento", "Fruticultura", "Cana", "Café", "Mista"] },
    { key: "topografia", label: "Topografia", type: "select", options: ["Plano", "Suave Ondulado", "Ondulado", "Montanhoso"] },
    { key: "acessoPrincipal", label: "Acesso principal", type: "select", options: ["Asfalto", "Terra transitável", "Precário"] },
    { key: "aguaDisponivel", label: "Água disponível", type: "select", options: ["Rio", "Poço artesiano", "Represa", "Nascente", "Sem recurso hídrico"] },
    { key: "energiaEletrica", label: "Possui energia elétrica", type: "boolean" },
    { key: "benfeitorias", label: "Benfeitorias", type: "multiselect", options: ["Sede", "Curral", "Galpão", "Irrigação", "Nenhuma"] },
    { key: "aceitaPermuta", label: "Aceita permuta", type: "boolean" },
    { key: "situacaoDocumental", label: "Situação documental", type: "select", options: ["Regularizado", "Pendente", "Irregular", "Em regularização"] },
    { key: "possuiReservaLegal", label: "Possui reserva legal demarcada", type: "boolean" },
    { key: "observacoesQualitativas", label: "Observações qualitativas", type: "textarea" },
  ],
  MINA: [
    { key: "substanciaMineral", label: "Substância mineral", type: "text" },
    { key: "faseExploracao", label: "Fase de exploração", type: "select", options: ["Pesquisa", "Lavra", "Requerimento", "Licenciamento"] },
    { key: "reservaEstimada", label: "Reserva estimada", type: "text" },
    { key: "possuiLicencaAmbiental", label: "Possui licença ambiental", type: "boolean" },
    { key: "tipoLavra", label: "Tipo de lavra", type: "select", options: ["Céu aberto", "Subterrânea", "Aluvionar"] },
    { key: "infraestruturaLocal", label: "Infraestrutura local", type: "select", options: ["Completa", "Parcial", "Inexistente"] },
    { key: "aceitaPermuta", label: "Aceita permuta", type: "boolean" },
    { key: "situacaoDocumental", label: "Situação documental", type: "select", options: ["Regularizado", "Pendente", "Irregular", "Em regularização"] },
    { key: "observacoesQualitativas", label: "Observações qualitativas", type: "textarea" },
  ],
  NEGOCIO: [
    { key: "setorAtuacao", label: "Setor de atuação", type: "text" },
    { key: "faturamentoAnual", label: "Faturamento anual (R$)", type: "number" },
    { key: "ebitda", label: "EBITDA (R$)", type: "number" },
    { key: "margemOperacional", label: "Margem operacional (%)", type: "number" },
    { key: "qtdFuncionarios", label: "Número de funcionários", type: "number" },
    { key: "motivoVenda", label: "Motivo da venda", type: "select", options: ["Aposentadoria", "Reestruturação", "Oportunidade", "Saúde", "Outro"] },
    { key: "possuiPassivos", label: "Passivos", type: "select", options: ["Sem passivos", "Passivos controlados", "Passivos relevantes"] },
    { key: "aceitaPermuta", label: "Aceita permuta", type: "boolean" },
    { key: "situacaoDocumental", label: "Situação documental", type: "select", options: ["Regularizado", "Pendente", "Irregular", "Em regularização"] },
    { key: "observacoesQualitativas", label: "Observações qualitativas", type: "textarea" },
  ],
};
ENRICHMENT_FIELDS_CONFIG["JAZIDA"] = ENRICHMENT_FIELDS_CONFIG["MINA"];

const ONBOARDING_CHECKLIST: Record<string, Array<{ item: string; obrigatorio: boolean }>> = {
  TERRA: [
    { item: "Matrícula atualizada do imóvel (30 dias)", obrigatorio: true },
    { item: "CAR — Cadastro Ambiental Rural", obrigatorio: true },
    { item: "CCIR — Certificado de Cadastro de Imóvel Rural", obrigatorio: true },
    { item: "ITR — Imposto Territorial Rural (últimos 5 anos)", obrigatorio: true },
    { item: "Georreferenciamento / SIGEF", obrigatorio: false },
    { item: "Certidão negativa de débitos municipais", obrigatorio: false },
    { item: "Laudo de avaliação", obrigatorio: false },
    { item: "Planta do imóvel", obrigatorio: false },
  ],
  MINA: [
    { item: "Processo ANM — Portaria de lavra ou concessão", obrigatorio: true },
    { item: "Licença Ambiental (LP, LI ou LO)", obrigatorio: true },
    { item: "Relatório Anual de Lavra (RAL)", obrigatorio: true },
    { item: "Plano de Aproveitamento Econômico (PAE)", obrigatorio: false },
    { item: "Laudo de reserva geológica", obrigatorio: false },
    { item: "Certidão de regularidade ANM", obrigatorio: false },
    { item: "Matrícula do terreno", obrigatorio: false },
  ],
  NEGOCIO: [
    { item: "Contrato Social e últimas alterações", obrigatorio: true },
    { item: "Balanços dos últimos 3 anos", obrigatorio: true },
    { item: "DRE — Demonstrativo de Resultado", obrigatorio: true },
    { item: "Certidão negativa de débitos federais", obrigatorio: true },
    { item: "Certidão negativa trabalhista", obrigatorio: true },
    { item: "Relação de contratos vigentes", obrigatorio: false },
    { item: "Relação de ativos imobilizados", obrigatorio: false },
    { item: "NDA / Acordo de Confidencialidade", obrigatorio: false },
  ],
  AGRO: [
    { item: "CAR — Cadastro Ambiental Rural", obrigatorio: true },
    { item: "CCIR do imóvel", obrigatorio: true },
    { item: "Contrato de arrendamento (se houver)", obrigatorio: false },
    { item: "Laudos de solo e produtividade", obrigatorio: false },
    { item: "Certificações (Orgânico, Rainforest etc.)", obrigatorio: false },
  ],
  DESENVOLVIMENTO: [
    { item: "Matrícula do terreno", obrigatorio: true },
    { item: "Alvará de construção", obrigatorio: true },
    { item: "Licença ambiental", obrigatorio: true },
    { item: "Projeto arquitetônico aprovado", obrigatorio: false },
    { item: "Memorial de incorporação", obrigatorio: false },
    { item: "Estudo de viabilidade (VGV)", obrigatorio: false },
  ],
};
ONBOARDING_CHECKLIST["JAZIDA"] = ONBOARDING_CHECKLIST["MINA"];

function EnrichmentTab({ ativo, assetId }: { ativo: any; assetId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const tipo = ativo.type as string;
  const fields = ENRICHMENT_FIELDS_CONFIG[tipo] || ENRICHMENT_FIELDS_CONFIG["NEGOCIO"];
  const existingEnrich = ativo?.camposEspecificos?.enrichment || {};
  const [activeSection, setActiveSection] = useState<"dados" | "documentos">("dados");

  const [formData, setFormData] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {};
    for (const f of fields) {
      initial[f.key] = existingEnrich[f.key] ?? (f.type === "boolean" ? false : f.type === "multiselect" ? [] : f.type === "number" ? "" : "");
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState<Record<string, string>>({});

  useEffect(() => {
    const enrich = ativo.camposEspecificos?.enrichment || {};
    const updated: Record<string, any> = {};
    for (const f of fields) {
      updated[f.key] = enrich[f.key] ?? (f.type === "boolean" ? false : f.type === "multiselect" ? [] : f.type === "number" ? "" : "");
    }
    setFormData(updated);
  }, [ativo?.id, ativo?.camposEspecificos]);

  const filledCount = fields.filter(f => {
    const val = formData[f.key];
    if (f.type === "boolean") return val === true;
    if (val === null || val === undefined || val === "") return false;
    if (Array.isArray(val) && val.length === 0) return false;
    return true;
  }).length;
  const progress = fields.length > 0 ? Math.round((filledCount / fields.length) * 100) : 0;

  const checklist = ONBOARDING_CHECKLIST[tipo] || [];
  const camposEsp = ativo.camposEspecificos ?? {};
  const checkKey = `checklist_${tipo}`;
  const savedChecks: Record<string, boolean> = camposEsp[checkKey] || {};
  const obrigatorios = checklist.filter(c => c.obrigatorio);
  const opcionais = checklist.filter(c => !c.obrigatorio);
  const totalObrig = obrigatorios.length;
  const marcadosObrig = obrigatorios.filter(c => savedChecks[c.item]).length;
  const docPct = totalObrig > 0 ? Math.round((marcadosObrig / totalObrig) * 100) : 0;

  const overallProgress = Math.round((progress + docPct) / 2);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiRequest("PATCH", `/api/assets/${assetId}/enrichment`, formData);
      if (!res.ok) throw new Error("Erro ao salvar");
      qc.invalidateQueries({ queryKey: ["/api/assets", String(assetId)] });
      toast({ title: "Enriquecimento salvo", description: `${progress}% preenchido` });
    } catch {
      toast({ title: "Erro ao salvar enriquecimento", variant: "destructive" });
    }
    setSaving(false);
  };

  const updateField = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const addTag = (key: string) => {
    const val = (tagInput[key] || "").trim();
    if (!val) return;
    const current = Array.isArray(formData[key]) ? formData[key] : [];
    if (!current.includes(val)) {
      updateField(key, [...current, val]);
    }
    setTagInput(prev => ({ ...prev, [key]: "" }));
  };

  const removeTag = (key: string, tag: string) => {
    const current = Array.isArray(formData[key]) ? formData[key] : [];
    updateField(key, current.filter((t: string) => t !== tag));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-medium" data-testid="text-enrichment-title">Onboarding do Ativo</p>
              <p className="text-xs text-muted-foreground">Preencha dados qualitativos e envie os documentos necessários</p>
            </div>
            <Badge variant="outline" className="text-xs" data-testid="badge-enrichment-progress">
              {overallProgress}% completo
            </Badge>
          </div>
          <Progress value={overallProgress} className="h-2" data-testid="progress-enrichment" />
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span data-testid="text-dados-progress">Dados: {progress}%</span>
            <span>·</span>
            <span data-testid="text-docs-progress">Documentos: {docPct}% ({marcadosObrig}/{totalObrig} obrigatórios)</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-1 p-1 bg-muted/50 rounded-lg">
        <Button
          size="sm"
          variant={activeSection === "dados" ? "default" : "ghost"}
          className="flex-1 gap-1.5 text-xs h-8"
          onClick={() => setActiveSection("dados")}
          data-testid="button-section-dados"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Dados Qualitativos
          <Badge variant={activeSection === "dados" ? "secondary" : "outline"} className="text-[10px] px-1 py-0 ml-1">
            {progress}%
          </Badge>
        </Button>
        <Button
          size="sm"
          variant={activeSection === "documentos" ? "default" : "ghost"}
          className="flex-1 gap-1.5 text-xs h-8"
          onClick={() => setActiveSection("documentos")}
          data-testid="button-section-documentos"
        >
          <FileText className="w-3.5 h-3.5" />
          Documentos
          <Badge variant={activeSection === "documentos" ? "secondary" : "outline"} className="text-[10px] px-1 py-0 ml-1">
            {marcadosObrig}/{totalObrig}
          </Badge>
        </Button>
      </div>

      {activeSection === "dados" && (
        <Card>
          <CardContent className="p-4">
            <div className="grid md:grid-cols-2 gap-4">
              {fields.map(field => (
                <div key={field.key} className={cn("space-y-1.5", field.type === "textarea" && "md:col-span-2")}>
                  <Label className="text-xs font-medium" htmlFor={`enrich-${field.key}`}>{field.label}</Label>

                  {field.type === "select" && (
                    <Select
                      value={formData[field.key] || ""}
                      onValueChange={(v) => updateField(field.key, v)}
                    >
                      <SelectTrigger id={`enrich-${field.key}`} data-testid={`input-enrich-${field.key}`}>
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options?.map(opt => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {field.type === "text" && (
                    <Input
                      id={`enrich-${field.key}`}
                      value={formData[field.key] || ""}
                      onChange={(e) => updateField(field.key, e.target.value)}
                      placeholder={field.label}
                      data-testid={`input-enrich-${field.key}`}
                    />
                  )}

                  {field.type === "number" && (
                    <Input
                      id={`enrich-${field.key}`}
                      type="number"
                      value={formData[field.key] || ""}
                      onChange={(e) => updateField(field.key, e.target.value ? Number(e.target.value) : "")}
                      placeholder="0"
                      data-testid={`input-enrich-${field.key}`}
                    />
                  )}

                  {field.type === "boolean" && (
                    <div className="flex items-center gap-2 pt-1">
                      <Switch
                        id={`enrich-${field.key}`}
                        checked={!!formData[field.key]}
                        onCheckedChange={(v) => updateField(field.key, v)}
                        data-testid={`input-enrich-${field.key}`}
                      />
                      <Label htmlFor={`enrich-${field.key}`} className="text-xs text-muted-foreground">
                        {formData[field.key] ? "Sim" : "Não"}
                      </Label>
                    </div>
                  )}

                  {field.type === "textarea" && (
                    <Textarea
                      id={`enrich-${field.key}`}
                      value={formData[field.key] || ""}
                      onChange={(e) => updateField(field.key, e.target.value)}
                      placeholder={field.label}
                      className="resize-none text-sm"
                      rows={3}
                      data-testid={`input-enrich-${field.key}`}
                    />
                  )}

                  {field.type === "multiselect" && (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Select
                          value={tagInput[field.key] || ""}
                          onValueChange={(v) => setTagInput(prev => ({ ...prev, [field.key]: v }))}
                        >
                          <SelectTrigger className="flex-1" data-testid={`select-enrich-${field.key}`}>
                            <SelectValue placeholder="Selecione..." />
                          </SelectTrigger>
                          <SelectContent>
                            {field.options?.filter(opt => !(formData[field.key] || []).includes(opt)).map(opt => (
                              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => addTag(field.key)}
                          disabled={!tagInput[field.key]}
                          data-testid={`button-add-enrich-${field.key}`}
                        >
                          Adicionar
                        </Button>
                      </div>
                      {Array.isArray(formData[field.key]) && formData[field.key].length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {formData[field.key].map((tag: string) => (
                            <Badge key={tag} variant="secondary" className="text-xs gap-1" data-testid={`tag-enrich-${field.key}-${tag}`}>
                              {tag}
                              <button
                                type="button"
                                onClick={() => removeTag(field.key, tag)}
                                className="ml-0.5"
                                data-testid={`button-remove-tag-${field.key}-${tag}`}
                              >
                                <XIcon className="w-3 h-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-4">
              <Button
                onClick={handleSave}
                disabled={saving}
                data-testid="button-salvar-enriquecimento"
              >
                {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Salvando...</> : "Salvar Enriquecimento"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {activeSection === "documentos" && (
        <div className="space-y-4">
          {checklist.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                    Checklist de Due Diligence
                  </CardTitle>
                  <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full",
                    docPct === 100 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                    docPct >= 50 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  )} data-testid="checklist-progress-onboarding">
                    {marcadosObrig}/{totalObrig} obrigatórios
                  </span>
                </div>
                <div className="h-1.5 bg-muted rounded-full mt-2">
                  <div
                    className={cn("h-full rounded-full transition-all",
                      docPct === 100 ? "bg-green-500" : docPct >= 50 ? "bg-amber-500" : "bg-red-500"
                    )}
                    style={{ width: `${docPct}%` }}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ChecklistSection
                  title="Documentos obrigatórios"
                  items={obrigatorios}
                  savedChecks={savedChecks}
                  ativoId={ativo.id}
                  checkKey={checkKey}
                  camposEspecificos={camposEsp}
                  ativoType={ativo.type}
                  ativoTitle={ativo.title}
                />
                {opcionais.length > 0 && (
                  <ChecklistSection
                    title="Documentos complementares"
                    items={opcionais}
                    savedChecks={savedChecks}
                    ativoId={ativo.id}
                    checkKey={checkKey}
                    camposEspecificos={camposEsp}
                    ativoType={ativo.type}
                    ativoTitle={ativo.title}
                  />
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Upload className="w-4 h-4 text-muted-foreground" />
                Documentos Gerais
              </CardTitle>
              <p className="text-xs text-muted-foreground">Envie documentos adicionais para o Google Drive</p>
            </CardHeader>
            <CardContent>
              <DocumentsPanel
                tipo="ativo"
                entityId={ativo.id}
                ativoTipo={ativo.type}
                ativoTitulo={ativo.title}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function AtivoDetalhePage({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const { data: ativoData, isLoading, error } = useQuery({
    queryKey: ["/api/assets", id],
    queryFn: () => apiRequest("GET", `/api/assets/${id}`).then(r => {
      if (!r.ok) throw new Error("not found");
      return r.json();
    }),
  });

  const ativo = ativoData;

  const searchStr = useSearch();
  const tabParam = new URLSearchParams(searchStr).get("tab");
  const [abaAtiva, setAbaAtiva] = useState(tabParam || "info");
  const [anmSubTab, setAnmSubTab] = useState("processo");
  // Ligação mapa ↔ tabela SIGEF: parcela selecionada (clique) e sob hover na tabela
  const [sigefSelecionada, setSigefSelecionada] = useState<string | null>(null);
  const [sigefHover, setSigefHover] = useState<string | null>(null);
  const [carSelecionado, setCarSelecionado] = useState<string | null>(null);
  const [carHover, setCarHover] = useState<string | null>(null);

  const [enriquecendo, setEnriquecendo] = useState(false);
  const [enriquecendoCompleto, setEnriquecendoCompleto] = useState(false);

  type EnrichStepStatus = "pending" | "running" | "success" | "error";
  interface EnrichStep {
    id: string;
    label: string;
    status: EnrichStepStatus;
    error?: string;
  }
  const [enrichAllRunning, setEnrichAllRunning] = useState(false);
  const [enrichAllSteps, setEnrichAllSteps] = useState<EnrichStep[]>([]);
  const [enrichAllDone, setEnrichAllDone] = useState(false);

  // ── Exportação de PDF completo (todas as abas) ──
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const pdfContentRef = useRef<HTMLDivElement>(null);

  const waitForTabRender = async (tabId: string) => {
    // espera base para montar o conteúdo e disparar as queries da aba
    await new Promise(r => setTimeout(r, 700));
    // aguarda sumirem os spinners de carregamento dentro do conteúdo
    const start = Date.now();
    while (Date.now() - start < 9000) {
      const el = pdfContentRef.current;
      const spinners = el ? el.querySelectorAll(".animate-spin").length : 0;
      if (spinners === 0) break;
      await new Promise(r => setTimeout(r, 400));
    }
    // tempo extra para mapas (Leaflet) e gráficos renderizarem
    await new Promise(r => setTimeout(r, tabId === "geo" ? 2400 : 600));
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 150));
  };

  const exportarPdfCompleto = async () => {
    if (!ativo || exportingPdf) return;

    // 1ª opção: relatório gerado no servidor a partir dos dados (texto selecionável,
    // sem cortes). Se falhar, cai no método antigo de captura de tela.
    setExportingPdf(true);
    setExportProgress("Gerando relatório...");
    try {
      const resp = await fetch(`/api/assets/${ativo.id}/relatorio.pdf`, { credentials: "include" });
      if (resp.ok && resp.headers.get("content-type")?.includes("pdf")) {
        const blob = await resp.blob();
        const safeName = (ativo.title || "ativo").replace(/[^\w\-]+/g, "_").slice(0, 60);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Relatorio_${safeName}_${format(new Date(), "yyyy-MM-dd")}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        // O servidor sinaliza via header quando o parecer de IA não pôde ser
        // gerado nesta exportação: avisa na hora, em vez de o usuário só
        // descobrir lendo o PDF (o download acontece normalmente).
        if (resp.headers.get("x-parecer-ia") === "indisponivel") {
          toast({
            title: "PDF gerado sem o parecer de IA",
            description: "O parecer consolidado (IA) não pôde ser gerado nesta exportação — as demais seções saíram completas. Exporte novamente em instantes para tentar de novo.",
            variant: "destructive",
          });
        } else {
          toast({ title: "PDF gerado", description: "O relatório completo foi baixado." });
        }
        // a geração do relatório completa e persiste camadas de restrição no
        // servidor — recarrega o ativo para a aba Restrições refletir sem reconsulta
        queryClient.invalidateQueries({ queryKey: ["/api/assets", id] });
        setExportProgress("");
        setExportingPdf(false);
        return;
      }
      if (resp.status === 409) {
        const erro = await resp.json().catch(() => null);
        toast({
          title: "Relatório bloqueado por datas conflitantes",
          description: erro?.message || "A vigência do alvará diverge entre as seções. Corrija os dados antes de exportar.",
          variant: "destructive",
        });
        setExportProgress("");
        setExportingPdf(false);
        return;
      }
    } catch {
      // servidor indisponível — segue para o fallback de captura de tela
    }
    setExportProgress("");
    setExportingPdf(false);

    await exportarPdfCapturaTela();
  };

  // Método antigo (fallback): captura de tela aba por aba com html2canvas
  const exportarPdfCapturaTela = async () => {
    if (!ativo || exportingPdf) return;
    const abas = (ABAS_POR_TIPO[ativo.type] || [{ id: "info", label: "Informações" }]).filter(a => a.id !== "matches");
    if (abas.length === 0) return;
    const abaOriginal = abaAtiva;
    const anmSubOriginal = anmSubTab;
    setExportingPdf(true);
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: html2canvas } = await import("html2canvas");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const contentW = pageW - margin * 2;

      // ── Capa ──
      pdf.setFillColor(4, 47, 46);
      pdf.rect(0, 0, pageW, 55, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(20);
      pdf.text("Relatório de Ativo", margin, 26);
      pdf.setFontSize(12);
      pdf.setTextColor(200, 230, 220);
      pdf.text("Mavrion Connect", margin, 36);
      pdf.setTextColor(30, 30, 30);
      pdf.setFontSize(16);
      const titleLines = pdf.splitTextToSize(ativo.title || "Ativo", contentW);
      pdf.text(titleLines, margin, 74);
      let cy = 74 + titleLines.length * 7 + 6;
      pdf.setFontSize(10);
      pdf.setTextColor(90, 90, 90);
      [`Tipo: ${ativo.type}`, `Gerado em: ${format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`]
        .forEach(m => { pdf.text(m, margin, cy); cy += 6; });

      const topOffset = 16;
      const availFirst = pageH - topOffset - margin;
      const drawSectionHeader = (label: string) => {
        pdf.addPage();
        pdf.setFillColor(4, 47, 46);
        pdf.rect(0, 0, pageW, 12, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(11);
        pdf.text(label, margin, 8);
      };

      const falhas: string[] = [];
      const capturarSecao = async (label: string, tabId: string) => {
        try {
          await waitForTabRender(tabId);
          const el = pdfContentRef.current;
          if (!el) throw new Error("conteúdo indisponível");
          const canvas = await html2canvas(el, {
            scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false,
          });
          if (!canvas.width || !canvas.height) throw new Error("captura vazia");
          const imgH = (canvas.height * contentW) / canvas.width;
          drawSectionHeader(label);
          if (imgH <= availFirst) {
            pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", margin, topOffset, contentW, imgH);
          } else {
            // paginação vertical: fatia o canvas em páginas
            const pxPerMm = canvas.height / imgH;
            let sourceY = 0;
            let isFirst = true;
            while (sourceY < canvas.height - 1) {
              const availMm = isFirst ? availFirst : (pageH - margin * 2);
              const sliceHpx = Math.min(Math.floor(availMm * pxPerMm), canvas.height - sourceY);
              const slice = document.createElement("canvas");
              slice.width = canvas.width;
              slice.height = sliceHpx;
              const ctx = slice.getContext("2d");
              if (ctx) {
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, slice.width, slice.height);
                ctx.drawImage(canvas, 0, sourceY, canvas.width, sliceHpx, 0, 0, canvas.width, sliceHpx);
              }
              const sliceHmm = sliceHpx / pxPerMm;
              if (!isFirst) pdf.addPage();
              pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", margin, isFirst ? topOffset : margin, contentW, sliceHmm);
              sourceY += sliceHpx;
              isFirst = false;
            }
          }
        } catch {
          // uma seção com falha (ex.: mapa) não deve abortar o PDF inteiro
          falhas.push(label);
          drawSectionHeader(label);
          pdf.setTextColor(150, 60, 60);
          pdf.setFontSize(10);
          pdf.text("Não foi possível capturar esta seção automaticamente.", margin, topOffset + 8);
        }
      };

      for (const aba of abas) {
        setAbaAtiva(aba.id);
        const grupoAnm = ANM_TAB_GROUPS.find(g => g.id === aba.id);
        if (grupoAnm) {
          // Abas do enriquecimento ANM têm seções: captura cada uma como seção própria
          for (const sec of grupoAnm.sections) {
            const label = `${aba.label} — ${sec.label}`;
            setExportProgress(label);
            setAnmSubTab(sec.id);
            await capturarSecao(label, aba.id);
          }
          setAnmSubTab(anmSubOriginal);
        } else {
          setExportProgress(aba.label);
          await capturarSecao(aba.label, aba.id);
        }
      }

      const safeName = (ativo.title || "ativo").replace(/[^\w\-]+/g, "_").slice(0, 60);
      pdf.save(`Ativo_${safeName}_${format(new Date(), "yyyy-MM-dd")}.pdf`);
      toast({
        title: "PDF gerado",
        description: falhas.length > 0
          ? `Relatório baixado. Não foi possível capturar: ${falhas.join(", ")}.`
          : "O relatório completo foi baixado.",
      });
    } catch (e: any) {
      toast({ title: "Erro ao gerar PDF", description: e?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setAbaAtiva(abaOriginal);
      setAnmSubTab(anmSubOriginal);
      setExportProgress("");
      setExportingPdf(false);
    }
  };

  const autoAnalyzeTriggered = useRef(false);
  useEffect(() => {
    if (!ativo || ativo.type !== 'TERRA' || ativo.geoScore != null || autoAnalyzeTriggered.current) return;
    autoAnalyzeTriggered.current = true;
    apiRequest("POST", "/api/geo/auto-analyze", { assetId: ativo.id })
      .then(r => r.json())
      .then(data => {
        if (data.triggered) {
          setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/assets", id] }), 15000);
        }
      })
      .catch(() => {});
  }, [ativo, id, queryClient]);

  const ccirAbortRef = useRef<AbortController | null>(null);
  const [ccirState, setCcirState] = useState<{ loading: boolean; error: string | null; startedAt: number | null }>({ loading: false, error: null, startedAt: null });

  const handleStartCcir = useCallback(async (cpfCnpj?: string) => {
    if (ccirState.loading) return;
    if (!ativo || (ativo.type !== "TERRA" && ativo.type !== "AGRO")) return;
    if (ccirAbortRef.current) ccirAbortRef.current.abort();
    const abort = new AbortController();
    ccirAbortRef.current = abort;
    const startTime = Date.now();
    setCcirState({ loading: true, error: null, startedAt: startTime });
    try {
      const body = cpfCnpj ? { cpfCnpj } : {};
      const res = await fetch(`/api/enrichment/ccir/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
        signal: abort.signal,
      });
      const elapsed = Date.now() - startTime;
      const minDelay = 1500;
      if (elapsed < minDelay) await new Promise(r => setTimeout(r, minDelay - elapsed));
      if (abort.signal.aborted) return;
      if (!res.ok) {
        const ct = res.headers.get("content-type") || "";
        let msg: string;
        if (ct.includes("application/json")) {
          const err = await res.json().catch(() => ({ message: `Erro ${res.status}` }));
          msg = err.message;
        } else {
          msg = `Serviço CCIR indisponível (erro ${res.status}). Tente novamente em alguns minutos.`;
        }
        setCcirState({ loading: false, error: msg, startedAt: null });
        toast({ title: "Erro na consulta CCIR", description: msg, variant: "destructive" });
        return;
      }
      await res.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/assets", id] });
      setCcirState({ loading: false, error: null, startedAt: null });
      toast({ title: "Consulta CCIR concluída" });
    } catch (err: any) {
      if (err.name === "AbortError") {
        setCcirState({ loading: false, error: "Consulta cancelada.", startedAt: null });
        return;
      }
      const msg = err.message || "Erro inesperado";
      setCcirState({ loading: false, error: msg, startedAt: null });
      toast({ title: "Erro na consulta CCIR", description: msg, variant: "destructive" });
    }
  }, [id, ativo, ccirState.loading, toast, queryClient]);

  const handleCancelCcir = useCallback(() => {
    if (ccirAbortRef.current) {
      ccirAbortRef.current.abort();
      ccirAbortRef.current = null;
    }
    setCcirState({ loading: false, error: "Consulta cancelada.", startedAt: null });
  }, []);

  const runEnrichAll = useCallback(async () => {
    if (!ativo || enrichAllRunning) return;
    const isTerraAgro = ["TERRA", "AGRO"].includes(ativo.type);

    const initialSteps: EnrichStep[] = [];
    if (isTerraAgro) {
      initialSteps.push({ id: "sicar", label: "Geo & CAR", status: "pending" });
      initialSteps.push({ id: "embrapa_ambiental", label: "Embrapa + Ambiental", status: "pending" });
      initialSteps.push({ id: "ccir", label: "CCIR / INCRA", status: "pending" });
    }
    initialSteps.push({ id: "deepintel", label: "Deep Intelligence", status: "pending" });

    setEnrichAllSteps(initialSteps);
    setEnrichAllRunning(true);
    setEnrichAllDone(false);

    let pollTimer: ReturnType<typeof setInterval> | null = null;
    try {
      pollTimer = setInterval(async () => {
        try {
          const pollRes = await apiRequest("GET", `/api/assets/${ativo.id}`);
          if (!pollRes.ok) return;
          const data = await pollRes.json();
          const progress = data?.camposEspecificos?.enrichmentAllProgress;
          if (progress?.steps) {
            setEnrichAllSteps(prev => prev.map(s => {
              const server = progress.steps.find((ss: any) => ss.id === s.id);
              if (server) return { ...s, status: server.status, error: server.error };
              const idx = progress.steps.length;
              const myIdx = prev.findIndex(p => p.id === s.id);
              if (myIdx === idx) return { ...s, status: "running" };
              return s;
            }));
          }
        } catch {}
      }, 5000);

      const res = await apiRequest("POST", `/api/assets/${ativo.id}/enriquecer-tudo`, {});
      if (pollTimer) clearInterval(pollTimer);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Erro" }));
        throw new Error(err.message || "Erro no enriquecimento");
      }

      const result = await res.json();

      if (result.steps) {
        setEnrichAllSteps(result.steps.map((s: any) => ({
          id: s.id,
          label: s.label,
          status: s.status as EnrichStepStatus,
          error: s.error,
        })));
      }

      if (result.errorCount === 0) {
        toast({ title: "Enriquecimento completo finalizado com sucesso" });
      } else if (result.errorCount === result.totalSteps) {
        toast({ title: "Todas as etapas falharam", variant: "destructive" });
      } else {
        toast({ title: `Enriquecimento finalizado — ${result.errorCount} etapa(s) com erro`, variant: "default" });
      }
    } catch (err: any) {
      if (pollTimer) clearInterval(pollTimer);
      toast({ title: "Erro no enriquecimento", description: err.message, variant: "destructive" });
    } finally {
      if (pollTimer) clearInterval(pollTimer);
      setEnrichAllRunning(false);
      setEnrichAllDone(true);
      queryClient.invalidateQueries({ queryKey: ["/api/assets", id] });
    }
  }, [ativo, enrichAllRunning, id, queryClient, toast]);
  const [certidoesLoading, setCertidoesLoading] = useState(false);
  const [certidoesData, setCertidoesData] = useState<any>(null);
  const [cnpjaData, setCnpjaData] = useState<any>(null);
  const [cnpjaLoading, setCnpjaLoading] = useState(false);
  const [sicorData, setSicorData] = useState<any>(null);
  const [sicorLoading, setSicorLoading] = useState(false);
  const [sicorFetched, setSicorFetched] = useState(false);
  const [contextoLoading, setContextoLoading] = useState(false);

  const salvarEnrichment = async (key: string, value: any) => {
    if (!ativo) return;
    // Envia só o delta — o servidor faz merge atômico. Espalhar o objeto
    // inteiro (cópia possivelmente desatualizada) apagava dados salvos por
    // consultas paralelas de outras sub-abas.
    await apiRequest("PATCH", `/api/assets/${ativo.id}`, {
      camposEspecificos: { [key]: value, [`${key}UpdatedAt`]: new Date().toISOString() },
    });
    queryClient.invalidateQueries({ queryKey: ["/api/assets", id] });
  };

  useEffect(() => {
    if (!ativo) return;
    const campos = (ativo.camposEspecificos ?? {});
    if (campos.cnpjaData && !cnpjaData) setCnpjaData(campos.cnpjaData);
    if (campos.certidoesData && !certidoesData) setCertidoesData(campos.certidoesData);
    if (campos.sicorData && !sicorData && !sicorFetched) {
      setSicorData(campos.sicorData);
      setSicorFetched(true);
    }
  }, [ativo]);

  useEffect(() => {
    setSicorData(null);
    setSicorFetched(false);
    setSicorLoading(false);
    setCnpjaData(null);
    setCertidoesData(null);
  }, [id]);

  useEffect(() => {
    if (!ativo) return;
    const campos = (ativo.camposEspecificos ?? {});
    const codigoIbge = campos.codigoIbge;
    if (!codigoIbge || sicorData || sicorFetched) return;
    setSicorFetched(true);
    setSicorLoading(true);
    apiRequest("GET", `/api/mavrion/sicor/${codigoIbge}`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setSicorData(data);
          salvarEnrichment("sicorData", data);
        }
      })
      .catch(() => {})
      .finally(() => setSicorLoading(false));
  }, [ativo, sicorData, sicorFetched]);

  const enriquecerMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/assets/${id}/enriquecer-embrapa`, {}).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets", id] });
      toast({ title: "✅ Dados Embrapa carregados!", description: "Análise agronômica atualizada." });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao buscar dados Embrapa", description: err.message, variant: "destructive" });
    },
    onSettled: () => setEnriquecendo(false),
  });

  const [sicarConsulting, setSicarConsulting] = useState(false);
  const consultarSicar = async () => {
    if (!ativo) return;
    setSicarConsulting(true);
    try {
      const res = await fetch(`/api/assets/${ativo.id}/enriquecer-sicar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/assets", id] });
        toast({ title: "Dados SICAR atualizados!", description: `${data.sicar?.municipio || ""} / ${data.sicar?.uf || ""} — ${data.sicar?.condicao || ""}` });
      } else {
        toast({ title: data.message || "Erro ao consultar SICAR", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro de conexão ao consultar SICAR", variant: "destructive" });
    }
    setSicarConsulting(false);
  };

  const [geoAnalyzing, setGeoAnalyzing] = useState(false);
  const runGeoAnalysis = async () => {
    if (!ativo) return;
    setGeoAnalyzing(true);
    try {
      const geomRes = await apiRequest("GET", `/api/assets/${ativo.id}/geometry`);
      if (!geomRes.ok) throw new Error("Falha ao buscar geometria");
      const geomData = await geomRes.json();
      if (!geomData.geometry) {
        toast({ title: "Sem geometria", description: "Este ativo não possui polígono geográfico para análise. Importe pela prospecção de Fazendas primeiro.", variant: "destructive" });
        setGeoAnalyzing(false);
        return;
      }
      const analysisRes = await apiRequest("POST", "/api/geo/analisar", { geometry: geomData.geometry, areaHa: ativo.areaHa || 0 });
      if (!analysisRes.ok) throw new Error("Falha na análise geográfica");
      const analysis = await analysisRes.json();
      const persistRes = await apiRequest("POST", "/api/geo/persist-analysis", { assetId: ativo.id, analysis });
      if (!persistRes.ok) throw new Error("Falha ao salvar análise");
      queryClient.invalidateQueries({ queryKey: ["/api/assets", id] });
      toast({ title: "Análise geográfica atualizada!" });
    } catch (err: any) {
      toast({ title: "Erro na análise geo", description: err.message, variant: "destructive" });
    }
    setGeoAnalyzing(false);
  };

  const handleDelete = async () => {
    await apiRequest("DELETE", `/api/assets/${id}`);
    queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
    toast({ title: "Ativo excluído" });
    navigate("/ativos");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !ativo) {
    return (
      <div className="p-6 text-center space-y-3 pt-20">
        <AlertCircle className="w-10 h-10 text-destructive mx-auto" />
        <p className="font-medium">Ativo não encontrado</p>
        <Button variant="outline" onClick={() => navigate("/ativos")}>
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Voltar
        </Button>
      </div>
    );
  }

  const tipo = TIPO_CONFIG[ativo.type] || TIPO_CONFIG.TERRA;
  const TipoIcon = tipo.icon;
  const docsStatus = ativo.docsStatus ? DOCS_STATUS[ativo.docsStatus] : null;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4 md:space-y-6">
      {/* Back + actions */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => navigate("/ativos")} className="gap-1.5">
          <ArrowLeft className="w-4 h-4" /> Portfólio de Ativos
        </Button>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="default" size="sm"
            disabled={enrichAllRunning}
            onClick={runEnrichAll}
            data-testid="button-atualizar-tudo"
            className="gap-1.5"
          >
            {enrichAllRunning
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Atualizando...</>
              : <><RefreshCw className="w-4 h-4" /> Atualizar Tudo</>}
          </Button>

          <Button
            variant="outline" size="sm"
            disabled={exportingPdf || enrichAllRunning}
            onClick={exportarPdfCompleto}
            data-testid="button-exportar-pdf"
            className="gap-1.5"
          >
            {exportingPdf
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Gerando{exportProgress ? ` (${exportProgress})` : ""}...</>
              : <><FileDown className="w-4 h-4" /> Exportar PDF</>}
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => setEditOpen(true)}
            data-testid="button-editar-ativo"
          >
            <Pencil className="w-4 h-4 mr-1.5" /> Editar
          </Button>
          <Button
            variant="outline" size="sm"
            className="text-destructive border-destructive/30 hover:bg-destructive/5"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="w-4 h-4 mr-1.5" /> Excluir
          </Button>
        </div>
      </div>

      {/* Hero header */}
      <Card className="overflow-hidden">
        <div className="h-1.5 w-full bg-gradient-to-r from-primary to-primary/50" />
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 bg-muted", tipo.color)}>
              <TipoIcon className="w-7 h-7" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <h1 className="text-xl md:text-2xl font-bold leading-tight">{ativo.title}</h1>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <Badge variant="outline" className={cn("border-0 font-medium", tipo.badge)}>
                      {tipo.label}
                    </Badge>
                    {docsStatus && (
                      <span className={cn("flex items-center gap-1 text-xs font-medium", docsStatus.color)}>
                        <docsStatus.icon className="w-3.5 h-3.5" />
                        {docsStatus.label}
                      </span>
                    )}
                  </div>
                </div>
                {ativo.priceAsking && (
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">Preço pedido</p>
                    <p className="text-xl font-bold text-emerald-600">
                      {ativo.priceAsking >= 1_000_000
                        ? `R$ ${(ativo.priceAsking / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`
                        : `R$ ${(ativo.priceAsking / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}k`}
                    </p>
                  </div>
                )}
              </div>

              {ativo.description && (
                <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{ativo.description}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {enrichAllSteps.length > 0 && (
        <Card data-testid="card-enrich-all-progress">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold flex items-center gap-2">
                <RefreshCw className={cn("w-4 h-4", enrichAllRunning && "animate-spin")} />
                Enriquecimento Completo
              </p>
              {enrichAllDone && !enrichAllRunning && (
                <Button variant="ghost" size="sm" onClick={() => { setEnrichAllSteps([]); setEnrichAllDone(false); }} className="h-6 px-2">
                  <XIcon className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
            <div className="space-y-1.5">
              {enrichAllSteps.map((step) => (
                <div key={step.id} className="flex items-center gap-2.5 text-sm" data-testid={`enrich-step-${step.id}`}>
                  {step.status === "pending" && <Clock className="w-4 h-4 text-muted-foreground" />}
                  {step.status === "running" && <Loader2 className="w-4 h-4 text-primary animate-spin" />}
                  {step.status === "success" && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                  {step.status === "error" && <AlertCircle className="w-4 h-4 text-red-500" />}
                  <span className={cn(
                    step.status === "running" && "font-medium text-primary",
                    step.status === "success" && "text-green-700",
                    step.status === "error" && "text-red-600",
                    step.status === "pending" && "text-muted-foreground",
                  )}>
                    {step.label}
                  </span>
                  {step.error && step.status === "error" && (
                    <span className="text-xs text-red-400 ml-1">— {step.error}</span>
                  )}
                  {step.error && step.status === "success" && (
                    <span className="text-xs text-yellow-600 ml-1">({step.error})</span>
                  )}
                </div>
              ))}
            </div>
            {enrichAllRunning && (
              <Progress
                value={Math.round((enrichAllSteps.filter(s => s.status === "success" || s.status === "error").length / enrichAllSteps.length) * 100)}
                className="h-1.5"
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={abaAtiva} onValueChange={setAbaAtiva}>
        <div className="overflow-x-auto pb-0.5">
          <TabsList className="w-max min-w-full">
            {(ABAS_POR_TIPO[ativo.type] || [{ id: "info", label: "Informações" }]).map(aba => (
              <TabsTrigger key={aba.id} value={aba.id} data-testid={`tab-${aba.id}`}>
                {aba.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {ccirState.loading && abaAtiva !== "ccir" && ativo && (ativo.type === "TERRA" || ativo.type === "AGRO") && (
          <div className="mt-3 flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40 px-4 py-2.5" data-testid="banner-ccir-progress">
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Consulta CCIR em andamento...</p>
              <p className="text-xs text-blue-500 dark:text-blue-400">Dados do INCRA sendo consultados em segundo plano</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-blue-600 hover:text-blue-800 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900 h-7 px-2 text-xs"
              onClick={handleCancelCcir}
              data-testid="button-cancel-ccir-banner"
            >
              <XIcon className="w-3.5 h-3.5 mr-1" /> Cancelar
            </Button>
          </div>
        )}

        {/* Wrapper capturado na exportação de PDF */}
        <div ref={pdfContentRef}>
        {/* ── Info Tab ── */}
        <TabsContent value="info" className="space-y-4 mt-4">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Localização */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-muted-foreground" /> Localização
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <InfoRowAlways label="Estado" value={ativo.estado} testId="text-info-estado" />
                <InfoRowAlways label="Município" value={ativo.municipio} testId="text-info-municipio" />
                <InfoRow label="Região / Localização" value={ativo.location} />
                {ativo.type === "TERRA" && (
                  <InfoRowAlways label="Código CAR" value={ativo.carCodImovel} testId="text-info-car" />
                )}
                {ativo.type === "TERRA" && (
                  <InfoRowAlways label="Matrícula" value={ativo.matricula} testId="text-info-matricula" />
                )}
              </CardContent>
            </Card>

            {/* Dimensões */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Ruler className="w-4 h-4 text-muted-foreground" /> Dimensões & Valor
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <InfoRowAlways
                  label="Área Total"
                  value={ativo.areaHa ? `${Number(ativo.areaHa).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha` : null}
                  testId="text-info-area"
                />
                <InfoRowAlways
                  label="Área Útil"
                  value={ativo.areaUtil ? `${Number(ativo.areaUtil).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha` : null}
                  testId="text-info-area-util"
                />
                <InfoRowAlways
                  label="Preço pedido"
                  value={ativo.priceAsking
                    ? `R$ ${Number(ativo.priceAsking).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                    : null}
                  testId="text-info-preco"
                />
                {ativo.areaHa && ativo.priceAsking && (
                  <InfoRowAlways
                    label="Preço por hectare"
                    value={`R$ ${(ativo.priceAsking / ativo.areaHa).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}/ha`}
                    testId="text-info-preco-ha"
                  />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Resumo rápido para TERRA */}
          {ativo.type === "TERRA" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TreePine className="w-4 h-4 text-muted-foreground" /> Resumo do Imóvel
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg bg-muted/50 text-center">
                    <p className="text-xs text-muted-foreground">Área</p>
                    <p className="text-lg font-bold" data-testid="text-resumo-area">
                      {ativo.areaHa ? `${Number(ativo.areaHa).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ha` : "—"}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 text-center">
                    <p className="text-xs text-muted-foreground">Score Geo</p>
                    <p className="text-lg font-bold" data-testid="text-resumo-score">
                      {ativo.geoScore != null ? `${ativo.geoScore}/100` : "—"}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 text-center">
                    <p className="text-xs text-muted-foreground">Altitude</p>
                    <p className="text-lg font-bold" data-testid="text-resumo-alt">
                      {ativo.geoAltMed != null ? `${Math.round(ativo.geoAltMed)}m` : "—"}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 text-center">
                    <p className="text-xs text-muted-foreground">Valor</p>
                    <p className="text-lg font-bold" data-testid="text-resumo-valor">
                      {ativo.priceAsking
                        ? ativo.priceAsking >= 1_000_000
                          ? `R$ ${(ativo.priceAsking / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`
                          : `R$ ${(ativo.priceAsking / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}k`
                        : "—"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tags */}
          {ativo.tags && (ativo.tags as string[]).length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Tag className="w-4 h-4 text-muted-foreground" /> Tags
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {(ativo.tags as string[]).map((t: string, i: number) => (
                    <Badge key={i} variant="secondary" className="text-xs" data-testid={`badge-tag-${i}`}>{t}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Empresa vinculada */}
          {ativo.linkedCompanyId && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" /> Empresa vinculada (Cedente / Proprietário)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Link
                  href={`/empresas/${ativo.linkedCompanyId}`}
                  className="flex items-center gap-2 text-primary hover:underline text-sm font-medium"
                >
                  <Building2 className="w-4 h-4" />
                  {ativo.linkedCompany?.tradeName || ativo.linkedCompany?.legalName || `Empresa #${ativo.linkedCompanyId}`}
                  <Link2 className="w-3.5 h-3.5 opacity-50" />
                </Link>
                {ativo.linkedCompany?.cnpj && (
                  <p className="text-xs text-muted-foreground mt-1 font-mono">CNPJ: {ativo.linkedCompany.cnpj}</p>
                )}
              </CardContent>
            </Card>
          )}

          {(ativo.camposEspecificos?.origemAtivo === "oferta_recebida" ||
            ativo.camposEspecificos?.origemAtivo === "indicacao") && (
            <Card className="border-amber-200 dark:border-amber-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-amber-600" />
                  {ativo.camposEspecificos?.origemAtivo === "oferta_recebida" ? "Ofertante — proprietário do ativo" : "Indicação"}
                  <Badge variant="outline" className="text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700 ml-auto">
                    Oferta recebida
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="Nome" value={ativo.camposEspecificos?.ofertanteNome} />
                <InfoRow label="Telefone" value={ativo.camposEspecificos?.ofertanteTelefone} />
                <InfoRow label="E-mail" value={ativo.camposEspecificos?.ofertanteEmail} />
                <InfoRow label="Observações" value={ativo.camposEspecificos?.ofertanteObservacoes} />
              </CardContent>
            </Card>
          )}

          {/* Fotos do Ativo — removido por enquanto
          <AssetPhotosSection ativo={ativo} assetId={Number(id)} />
          */}

          {/* Observações */}
          {ativo.observacoes && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-muted-foreground" /> Observações internas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{ativo.observacoes}</p>
              </CardContent>
            </Card>
          )}

          <div className="text-xs text-muted-foreground">
            Cadastrado em {ativo.createdAt ? format(new Date(ativo.createdAt), "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : "—"}
          </div>
        </TabsContent>





        <TabsContent value="embrapa" className="mt-4 space-y-4">

            {(() => {
              const embrapa = ativo.camposEspecificos?.embrapa;
              const embrapaUpdatedAt = ativo.camposEspecificos?.embrapaUpdatedAt;

              if (!embrapa) return (
                <Card>
                  <CardContent className="p-6 text-center space-y-3">
                    <Leaf className="w-10 h-10 mx-auto text-muted-foreground opacity-30" />
                    <p className="text-sm text-muted-foreground" data-testid="text-embrapa-vazio">
                      Ativo ainda não foi enriquecido com dados Embrapa
                    </p>
                    <Button
                      size="sm"
                      disabled={enriquecendo || enriquecerMutation.isPending}
                      onClick={() => { setEnriquecendo(true); enriquecerMutation.mutate(); }}
                      data-testid="button-enriquecer-embrapa"
                    >
                      {(enriquecendo || enriquecerMutation.isPending)
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enriquecendo...</>
                        : <><RefreshCw className="w-3.5 h-3.5" /> Enriquecer agora</>}
                    </Button>
                  </CardContent>
                </Card>
              );

              return (
                <>
                <Card>
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">Análise Agronômica — dados Embrapa</p>
                      {embrapaUpdatedAt && (
                        <Badge className="bg-green-100 text-green-700 border-green-200 text-xs" data-testid="badge-embrapa-status">
                          Enriquecido em {new Date(embrapaUpdatedAt).toLocaleDateString("pt-BR")}
                        </Badge>
                      )}
                    </div>
                    <Button
                      size="sm" variant="outline" className="gap-1.5 shrink-0"
                      disabled={enriquecendo || enriquecerMutation.isPending}
                      onClick={() => { setEnriquecendo(true); enriquecerMutation.mutate(); }}
                      data-testid="button-enriquecer-embrapa"
                    >
                      {(enriquecendo || enriquecerMutation.isPending)
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Atualizando...</>
                        : <><RefreshCw className="w-3.5 h-3.5" /> Atualizar</>}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 border-emerald-300 text-emerald-700"
                      disabled={enriquecendoCompleto}
                      onClick={async () => {
                        setEnriquecendoCompleto(true);
                        try {
                          await apiRequest("POST", `/api/assets/${id}/enriquecer-completo`, {});
                          queryClient.invalidateQueries({ queryKey: ["/api/assets", id] });
                          toast({ title: "✅ Enriquecimento completo!", description: "IBAMA, MapBiomas e NDVI HD atualizados" });
                        } catch {
                          toast({ title: "Erro no enriquecimento", variant: "destructive" });
                        }
                        setEnriquecendoCompleto(false);
                      }}
                      data-testid="button-enriquecer-completo"
                    >
                      {enriquecendoCompleto
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enriquecendo...</>
                        : <><Zap className="w-3.5 h-3.5" /> Enriquecimento completo</>}
                    </Button>
                  </CardContent>
                </Card>

                {embrapa.scoreAgro != null && (
                  <Card>
                    <CardContent className="p-6 text-center">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Score Agrícola</p>
                      <p className={cn(
                        "text-5xl font-bold",
                        embrapa.scoreAgro >= 70 ? "text-green-600" :
                        embrapa.scoreAgro >= 40 ? "text-yellow-600" : "text-red-600"
                      )} data-testid="text-score-agro">{embrapa.scoreAgro}</p>
                      <p className={cn(
                        "text-sm font-medium mt-1",
                        embrapa.scoreAgro >= 70 ? "text-green-600" :
                        embrapa.scoreAgro >= 40 ? "text-yellow-600" : "text-red-600"
                      )}>
                        {embrapa.scoreAgro >= 70 ? "Boa aptidão agrícola" :
                         embrapa.scoreAgro >= 40 ? "Aptidão moderada" : "Aptidão limitada"}
                      </p>
                    </CardContent>
                  </Card>
                )}

                <div className="grid md:grid-cols-2 gap-4">

                  {embrapa.zoneamento && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Leaf className="w-4 h-4 text-green-600" />
                          Zoneamento Agrícola
                          {embrapa.zoneamento.fonte === "cache" && (
                            <Badge variant="outline" className="text-[10px] ml-auto">Cache</Badge>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {embrapa.zoneamento.culturas?.length > 0 ? (
                          embrapa.zoneamento.culturas.slice(0, 6).map((c: any, i: number) => (
                            <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                              <span className="text-sm font-medium capitalize">{c.nome}</span>
                              <div className="flex items-center gap-2">
                                {c.epocaPlantio && (
                                  <span className="text-xs text-muted-foreground">{c.epocaPlantio}</span>
                                )}
                                <Badge variant="outline" className={
                                  c.risco === "baixo" || c.risco === "20%"
                                    ? "text-xs bg-green-50 text-green-700 border-green-200"
                                    : c.risco === "medio" || c.risco === "30%"
                                    ? "text-xs bg-amber-50 text-amber-700 border-amber-200"
                                    : "text-xs bg-red-50 text-red-700 border-red-200"
                                }>
                                  Risco {c.risco || "—"}
                                </Badge>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Informe o código IBGE do município para consultar o zoneamento.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Card de Análise de Solo removido temporariamente — API SoilGrids/ISRIC indisponível. Reimplementar futuramente com fonte alternativa. */}

                  {embrapa.ndvi && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Leaf className="w-4 h-4 text-emerald-600" />
                          Índice de Vegetação (NDVI)
                          {embrapa.ndvi.fonte === "cache" && (
                            <Badge variant="outline" className="text-[10px] ml-auto">Cache</Badge>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-2xl font-bold text-emerald-600">
                            {embrapa.ndvi.ndvi.toFixed(2)}
                          </span>
                          <Badge className={
                            embrapa.ndvi.ndvi >= 0.6
                              ? "bg-green-100 text-green-700 border-green-200"
                              : embrapa.ndvi.ndvi >= 0.3
                              ? "bg-amber-100 text-amber-700 border-amber-200"
                              : "bg-red-100 text-red-700 border-red-200"
                          }>
                            {embrapa.ndvi.ndvi >= 0.6 ? "Saudável" :
                             embrapa.ndvi.ndvi >= 0.3 ? "Moderado" : "Crítico"}
                          </Badge>
                        </div>
                        <Progress
                          value={embrapa.ndvi.ndvi * 100}
                          className={cn("h-2", embrapa.ndvi.ndvi * 100 < 30 ? "[&>div]:bg-red-500" : embrapa.ndvi.ndvi * 100 <= 60 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-green-500")}
                        />
                        <p className="text-xs text-muted-foreground">{embrapa.ndvi.classificacao}</p>
                        {embrapa.ndvi.fonte && <p className="text-[10px] text-muted-foreground text-right">Fonte: {embrapa.ndvi.fonte}</p>}
                      </CardContent>
                    </Card>
                  )}

                  {embrapa.clima && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Droplets className="w-4 h-4 text-blue-500" />
                          Dados Climáticos
                          {embrapa.clima.fonte && (
                            <Badge variant="outline" className="text-[10px] ml-auto" data-testid="badge-clima-fonte">{embrapa.clima.fonte}</Badge>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {embrapa.clima.precipitacaoAnual ? (
                          <div className="flex items-center justify-between p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20" data-testid="row-precip-anual">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Droplets className="w-3.5 h-3.5" /> Precipitação anual
                            </span>
                            <span className="text-sm font-bold text-blue-700">
                              {Number(embrapa.clima.precipitacaoAnual).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mm/ano
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between p-2 rounded-lg bg-muted/40" data-testid="row-precip-indisponivel">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Droplets className="w-3.5 h-3.5" /> Precipitação anual
                            </span>
                            <span className="text-xs text-muted-foreground">
                              sem série histórica disponível
                            </span>
                          </div>
                        )}
                        {embrapa.clima.temperaturaMedia > 0 && (
                          <div className="flex items-center justify-between p-2 rounded-lg bg-orange-50 dark:bg-orange-900/20" data-testid="row-temp-media">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Thermometer className="w-3.5 h-3.5" /> Temperatura média
                            </span>
                            <span className="text-sm font-bold text-orange-700">
                              {embrapa.clima.temperaturaMedia}°C
                            </span>
                          </div>
                        )}
                        {embrapa.clima.precipitacaoMensal && (
                          <div data-testid="chart-precip-mensal">
                            <p className="text-[11px] text-muted-foreground mb-1.5">Precipitação mensal (mm)</p>
                            <div className="flex items-end gap-[3px] h-16">
                              {(embrapa.clima.precipitacaoMensal as number[]).map((v: number, i: number) => {
                                const max = Math.max(...(embrapa.clima.precipitacaoMensal as number[]), 1);
                                const pct = Math.max(2, (v / max) * 100);
                                const isWet = v > 150;
                                const isDry = v < 60;
                                return (
                                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                                    <div
                                      className={`w-full rounded-t-sm transition-all ${isWet ? 'bg-blue-500' : isDry ? 'bg-amber-400' : 'bg-blue-300'}`}
                                      style={{ height: `${pct}%` }}
                                      title={`${['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][i]}: ${v.toLocaleString('pt-BR')} mm`}
                                    />
                                    <span className="text-[8px] text-muted-foreground leading-none">
                                      {['J','F','M','A','M','J','J','A','S','O','N','D'][i]}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="flex items-center gap-3 mt-1.5 text-[9px] text-muted-foreground">
                              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Chuvoso (&gt;150mm)</span>
                              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-300 inline-block" /> Normal</span>
                              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Seco (&lt;60mm)</span>
                            </div>
                          </div>
                        )}
                        {(embrapa.clima.mesesSecos?.length > 0 || embrapa.clima.mesesChuvosos?.length > 0) && (
                          <div className="grid grid-cols-2 gap-2 text-xs" data-testid="info-meses-seco-chuvoso">
                            {embrapa.clima.mesesSecos?.length > 0 && (
                              <div className="p-2 rounded bg-amber-50 dark:bg-amber-900/20">
                                <p className="text-[10px] text-muted-foreground mb-0.5">Meses secos</p>
                                <p className="font-medium text-amber-700">{(embrapa.clima.mesesSecos as string[]).join(', ')}</p>
                              </div>
                            )}
                            {embrapa.clima.mesesChuvosos?.length > 0 && (
                              <div className="p-2 rounded bg-blue-50 dark:bg-blue-900/20">
                                <p className="text-[10px] text-muted-foreground mb-0.5">Meses chuvosos</p>
                                <p className="font-medium text-blue-700">{(embrapa.clima.mesesChuvosos as string[]).join(', ')}</p>
                              </div>
                            )}
                          </div>
                        )}
                        {embrapa.clima.indiceSeca && !embrapa.clima.precipitacaoAnual && (
                          <p className="text-xs text-muted-foreground">{embrapa.clima.indiceSeca}</p>
                        )}
                      </CardContent>
                    </Card>
                  )}

                </div>
                </>
              );
            })()}

            {ativo.camposEspecificos?.enriquecimentoCompleto?.ndviHD && (() => {
              const ndviHD = ativo.camposEspecificos!.enriquecimentoCompleto.ndviHD;
              return (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Leaf className="w-4 h-4 text-emerald-600" />
                      NDVI Alta Resolução (Sentinel-2)
                      <Badge variant="outline" className="text-[10px] ml-auto bg-blue-50 text-blue-700 border-blue-200">10m</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-bold text-emerald-600">{ndviHD.ndvi.toFixed(3)}</span>
                      <Badge className={ndviHD.ndvi >= 0.6 ? "bg-green-100 text-green-700" : ndviHD.ndvi >= 0.3 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}>
                        {ndviHD.ndvi >= 0.6 ? "Saudável" : ndviHD.ndvi >= 0.3 ? "Moderado" : "Crítico"}
                      </Badge>
                    </div>
                    <Progress value={ndviHD.ndvi * 100} className={cn("h-2", ndviHD.ndvi < 0.3 ? "[&>div]:bg-red-500" : ndviHD.ndvi <= 0.6 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-green-500")} />
                    <div className="grid grid-cols-3 gap-2">
                      <div className="p-2 rounded bg-muted/50 text-center">
                        <p className="text-[10px] text-muted-foreground">Mín</p>
                        <p className="text-sm font-bold text-red-600">{ndviHD.ndviMin?.toFixed(3)}</p>
                      </div>
                      <div className="p-2 rounded bg-muted/50 text-center">
                        <p className="text-[10px] text-muted-foreground">Médio</p>
                        <p className="text-sm font-bold text-emerald-600">{ndviHD.ndvi.toFixed(3)}</p>
                      </div>
                      <div className="p-2 rounded bg-muted/50 text-center">
                        <p className="text-[10px] text-muted-foreground">Máx</p>
                        <p className="text-sm font-bold text-green-600">{ndviHD.ndviMax?.toFixed(3)}</p>
                      </div>
                    </div>
                    {ndviHD.variabilidade && <p className="text-xs text-muted-foreground">{ndviHD.variabilidade}</p>}
                    <p className="text-[10px] text-muted-foreground">Resolução: {ndviHD.resolucao} • {ndviHD.dataImagem}</p>
                  </CardContent>
                </Card>
              );
            })()}

            {ativo.camposEspecificos?.enriquecimentoCompleto?.mapbiomas && (() => {
              const mb = ativo.camposEspecificos!.enriquecimentoCompleto.mapbiomas;
              return (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TreePine className="w-4 h-4 text-green-600" />
                      Uso da Terra — MapBiomas
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200">
                      <p className="text-xs text-muted-foreground">Uso atual (2023)</p>
                      <p className="font-bold text-sm text-green-800 dark:text-green-300">{mb.usoAtual}</p>
                      {mb.bioma && <p className="text-xs text-muted-foreground mt-0.5">Bioma: {mb.bioma}</p>}
                    </div>
                    {mb.alertasDesmatamento > 0 && (
                      <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-300 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                        <div>
                          <p className="text-sm font-bold text-red-700">{mb.alertasDesmatamento} alerta(s) de desmatamento</p>
                          {mb.areaDesmatadaHa > 0 && (
                            <p className="text-xs text-red-600">{mb.areaDesmatadaHa.toLocaleString("pt-BR")} ha afetados</p>
                          )}
                        </div>
                      </div>
                    )}
                    {mb.alertasDesmatamento === 0 && (
                      <p className="text-xs text-green-600 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Sem alertas de desmatamento
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            {ativo.camposEspecificos?.enriquecimentoCompleto && (() => {
              const enc = ativo.camposEspecificos!.enriquecimentoCompleto;
              const temEmbargo = enc.ibamaProprietario?.temEmbargo || enc.ibamaGeo?.temEmbargo;
              if (!enc.ibamaProprietario && !enc.ibamaGeo) return null;
              return (
                <Card className={temEmbargo ? "border-red-300" : "border-green-200"}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlertCircle className={cn("w-4 h-4", temEmbargo ? "text-red-600" : "text-green-600")} />
                      Situação IBAMA
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {temEmbargo ? (
                      <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-300">
                        <p className="font-bold text-red-700 text-sm">⚠ Embargo(s) IBAMA detectado(s)</p>
                        <p className="text-xs text-red-600 mt-1">
                          {enc.ibamaProprietario?.totalEmbargos || 0} embargo(s) no CPF/CNPJ do proprietário
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-green-600 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" /> Sem embargos IBAMA identificados
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-2">
                      Consultado em: {new Date(enc.enriquecidoEm).toLocaleDateString("pt-BR")}
                    </p>
                  </CardContent>
                </Card>
              );
            })()}

            {!ativo.camposEspecificos?.latitude && (
              <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-900/10">
                <CardContent className="p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-800 dark:text-amber-300 space-y-1">
                    <p className="font-medium">Para análise completa, adicione as coordenadas do ativo.</p>
                    <p>Edite o ativo e preencha os campos Latitude, Longitude e Código IBGE do município
                    para obter dados de solo, clima e vegetação via Embrapa.</p>
                  </div>
                </CardContent>
              </Card>
            )}

          </TabsContent>

        {/* ── CCIR Tab ── */}
        <TabsContent value="ccir" className="mt-4 space-y-4">
          <CCIRTab assetId={Number(id)} camposEspecificos={ativo.camposEspecificos} ccirState={ccirState} onStartCcir={handleStartCcir} onCancelCcir={handleCancelCcir} />
        </TabsContent>

        {/* ── Ambiental Tab ── */}
        <TabsContent value="ambiental" className="mt-4 space-y-4">
          <AmbientalTab assetId={Number(id)} camposEspecificos={ativo.camposEspecificos} />
        </TabsContent>

        {/* ── Due Diligence Fundiária Tab ── */}
        <TabsContent value="duediligence" className="mt-4 space-y-4">
          <DueDiligenceFundiaria
            assetId={Number(id)}
            codigoIncra={ativo.camposEspecificos?.ccirCodigoIncra || ativo.camposEspecificos?.codigoIncra || ativo.camposEspecificos?.enrichment?.codigoIncra}
            cpfCnpj={ativo.camposEspecificos?.cnpj || (ativo.attributesJson as any)?.cpfCnpj}
            lat={ativo.camposEspecificos?.latitude}
            lon={ativo.camposEspecificos?.longitude}
            areaIncraHa={ativo.areaHa ? Number(ativo.areaHa) : undefined}
            areaCarHa={(ativo.attributesJson as any)?.carArea ? Number((ativo.attributesJson as any).carArea) : undefined}
            existingData={ativo.camposEspecificos?.dueDiligenceFundiaria}
          />
        </TabsContent>

        {/* ── Geo Tab ── */}
        <TabsContent value="geo" className="mt-4 space-y-4">
            {(() => {
              const campos = (ativo.camposEspecificos ?? {});
              const hasGeoData = ativo.geoAltMed != null || ativo.geoAltMin != null || ativo.geoAltMax != null ||
                ativo.geoDeclivityMed != null || ativo.geoTemRio != null || ativo.geoTemLago != null ||
                ativo.geoDistAguaM != null || ativo.geoTemEnergia != null || ativo.geoDistEnergiaM != null ||
                ativo.geoScore != null;

              const carCode = ativo.carCodImovel || campos.codigoCar || null;

              const carDaysLeft = campos.validadeCar
                ? Math.ceil((new Date(campos.validadeCar).getTime() - Date.now()) / 86400000)
                : null;

              return (
                <>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Coordenadas</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="p-2 rounded bg-muted/50 text-center">
                        <p className="text-xs text-muted-foreground">Latitude</p>
                        <p className="text-sm font-bold" data-testid="text-geo-lat">{campos.latitude || "\u2014"}</p>
                      </div>
                      <div className="p-2 rounded bg-muted/50 text-center">
                        <p className="text-xs text-muted-foreground">Longitude</p>
                        <p className="text-sm font-bold" data-testid="text-geo-lng">{campos.longitude || "\u2014"}</p>
                      </div>
                      <div className="p-2 rounded bg-muted/50 text-center">
                        <p className="text-xs text-muted-foreground">Código IBGE</p>
                        <p className="text-sm font-bold" data-testid="text-geo-ibge">{campos.codigoIbge || "\u2014"}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <AssetPolygonMap
                  assetId={ativo.id}
                  highlightCodigo={sigefHover ?? sigefSelecionada}
                  onParcelaClick={(codigo) => setSigefSelecionada(codigo)}
                  highlightCarCodigo={carHover ?? carSelecionado}
                  onCarClick={(codigo) => setCarSelecionado(codigo)}
                />

                {isTipoMinerario(ativo.type) && (
                  <div className="space-y-4" data-testid="section-base-fundiaria">
                    <div>
                      <h3 className="text-sm font-semibold">Base Fundiária</h3>
                      <p className="text-[11px] text-muted-foreground">
                        Quem ocupa e detém a superfície sobre o polígono do processo — parcelas certificadas (SIGEF), imóveis declarados (CAR) e consolidação CCIR por imóvel.
                      </p>
                    </div>
                    <SigefParcelasCard
                      ativoId={ativo.id}
                      savedData={campos.sigefParcelas}
                      selecionada={sigefSelecionada}
                      onSelect={setSigefSelecionada}
                      onHover={setSigefHover}
                    />
                    <CarImoveisCard
                      ativoId={ativo.id}
                      savedData={campos.carImoveis}
                      selecionado={carSelecionado}
                      onSelect={setCarSelecionado}
                      onHover={setCarHover}
                    />
                    <CcirMinaCard
                      ativoId={ativo.id}
                      savedData={campos.ccirImoveis}
                      temInsumos={Boolean(
                        (campos.sigefParcelas?.parcelas || []).some((p: any) => p.relacao === "sobreposta") ||
                        (campos.carImoveis?.imoveis || []).some((i: any) => i.relacao === "sobreposto")
                      )}
                    />
                  </div>
                )}

                {hasGeoData ? (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Dados Geográficos</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {ativo.geoScore != null && (
                        <div className="text-center mb-4">
                          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Score Geográfico</p>
                          <p className="text-4xl font-bold text-primary" data-testid="text-geo-score">{ativo.geoScore}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        {ativo.geoAltMed != null && (
                          <div className="p-2 rounded bg-muted/50 text-center">
                            <p className="text-xs text-muted-foreground">Altitude média (m)</p>
                            <p className="text-sm font-bold" data-testid="text-geo-alt-med">{ativo.geoAltMed}</p>
                          </div>
                        )}
                        {(ativo.geoAltMin != null || ativo.geoAltMax != null) && (
                          <div className="p-2 rounded bg-muted/50 text-center">
                            <p className="text-xs text-muted-foreground">Altitude mín/máx</p>
                            <p className="text-sm font-bold" data-testid="text-geo-alt-range">{ativo.geoAltMin ?? "\u2014"} / {ativo.geoAltMax ?? "\u2014"}</p>
                          </div>
                        )}
                        {ativo.geoDeclivityMed != null && (
                          <div className="p-2 rounded bg-muted/50 text-center">
                            <p className="text-xs text-muted-foreground">Declividade média (%)</p>
                            <p className="text-sm font-bold" data-testid="text-geo-decliv">{ativo.geoDeclivityMed}</p>
                          </div>
                        )}
                        {ativo.geoDistAguaM != null && (
                          <div className="p-2 rounded bg-muted/50 text-center">
                            <p className="text-xs text-muted-foreground">Distância da água (m)</p>
                            <p className="text-sm font-bold" data-testid="text-geo-dist-agua">{ativo.geoDistAguaM}</p>
                          </div>
                        )}
                        {ativo.geoDistEnergiaM != null && (
                          <div className="p-2 rounded bg-muted/50 text-center">
                            <p className="text-xs text-muted-foreground">Distância da energia (m)</p>
                            <p className="text-sm font-bold" data-testid="text-geo-dist-energia">{ativo.geoDistEnergiaM}</p>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {ativo.geoTemRio != null && (
                          <Badge className={ativo.geoTemRio ? "bg-green-100 text-green-700 border-green-200" : "bg-gray-100 text-gray-500 border-gray-200"} data-testid="badge-geo-rio">
                            {ativo.geoTemRio ? "Tem rio" : "Rio não detectado"}
                          </Badge>
                        )}
                        {ativo.geoTemLago != null && (
                          <Badge className={ativo.geoTemLago ? "bg-green-100 text-green-700 border-green-200" : "bg-gray-100 text-gray-500 border-gray-200"} data-testid="badge-geo-lago">
                            {ativo.geoTemLago ? "Tem lago" : "Lago não detectado"}
                          </Badge>
                        )}
                        {ativo.geoTemEnergia != null && (
                          <Badge className={ativo.geoTemEnergia ? "bg-green-100 text-green-700 border-green-200" : "bg-gray-100 text-gray-500 border-gray-200"} data-testid="badge-geo-energia">
                            {ativo.geoTemEnergia ? "Energia disponível" : "Energia não detectada"}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t">
                        {ativo.geoAnalyzedAt && (
                          <p className="text-[10px] text-muted-foreground" data-testid="text-geo-analyzed">
                            Análise realizada em {new Date(ativo.geoAnalyzedAt).toLocaleDateString("pt-BR")}
                          </p>
                        )}
                        <Button size="sm" className="gap-1.5 ml-auto" disabled={geoAnalyzing} onClick={runGeoAnalysis} data-testid="button-atualizar-geo">
                          {geoAnalyzing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analisando...</> : <><RefreshCw className="w-3.5 h-3.5" /> Atualizar análise</>}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="p-6 text-center space-y-3">
                      <MapPin className="w-10 h-10 mx-auto text-muted-foreground opacity-30" />
                      <p className="text-sm text-muted-foreground" data-testid="text-geo-vazio">Dados geográficos ainda não analisados</p>
                      <Button size="sm" variant="outline" className="gap-1.5" disabled={geoAnalyzing} onClick={runGeoAnalysis} data-testid="button-analisar-geo">
                        {geoAnalyzing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analisando...</> : <><RefreshCw className="w-3.5 h-3.5" /> Analisar agora</>}
                      </Button>
                    </CardContent>
                  </Card>
                )}


                </>
              );
            })()}
          </TabsContent>

        <TabsContent value="anm" className="mt-4">
          <AnmEnrichmentTabs ativo={ativo} assetId={id!} salvarEnrichment={salvarEnrichment} group="anm" subTab={anmSubTab} onSubTabChange={setAnmSubTab} />
        </TabsContent>

        <TabsContent value="titular-financas" className="mt-4">
          <AnmEnrichmentTabs ativo={ativo} assetId={id!} salvarEnrichment={salvarEnrichment} group="titular-financas" subTab={anmSubTab} onSubTabChange={setAnmSubTab} />
        </TabsContent>

        <TabsContent value="territorio" className="mt-4">
          <AnmEnrichmentTabs ativo={ativo} assetId={id!} salvarEnrichment={salvarEnrichment} group="territorio" subTab={anmSubTab} onSubTabChange={setAnmSubTab} />
        </TabsContent>

        {isTipoMinerario(ativo.type) && (
          <TabsContent value="documentos" className="mt-4">
            <DocumentsPanel
              tipo="ativo"
              entityId={ativo.id}
              ativoTipo={ativo.type}
              ativoTitulo={ativo.title}
            />
          </TabsContent>
        )}

        <TabsContent value="empresa" className="mt-4 space-y-4">
            {(() => {
              const campos = (ativo.camposEspecificos ?? {});
              const cnpjRaw = campos.cnpj ? campos.cnpj.replace(/\D/g, "") : null;
              const attrs = (ativo.attributesJson || {}) as any;
              const titularAnm = attrs.anmNome || null;

              const consultarCnpja = async () => {
                if (!cnpjRaw) return;
                setCnpjaLoading(true);
                try {
                  const res = await apiRequest("GET", `/api/cnpj/${cnpjRaw}`);
                  const data = await res.json();
                  setCnpjaData(data);
                  salvarEnrichment("cnpjaData", data);
                } catch { setCnpjaData(null); }
                setCnpjaLoading(false);
              };

              const salvarCnpj = async (cnpjDigitado: string) => {
                const clean = cnpjDigitado.replace(/\D/g, "");
                if (clean.length < 11) return;
                await apiRequest("PATCH", `/api/assets/${ativo.id}`, {
                  camposEspecificos: { cnpj: clean },
                });
                queryClient.invalidateQueries({ queryKey: ["/api/assets", id] });
                toast({ title: "CNPJ salvo!" });
              };

              const multiploNum = campos.multiplo ? parseFloat(String(campos.multiplo)) : NaN;
              const margemEbitda = campos.faturamentoAnual > 0 && campos.ebitda > 0
                ? (campos.ebitda / campos.faturamentoAnual * 100).toFixed(1) : null;
              const valuationImplicito = campos.ebitda > 0 && !isNaN(multiploNum) && multiploNum > 0
                ? campos.ebitda * multiploNum : null;

              return (
                <>
                {(cnpjRaw || !isTipoMinerario(ativo.type)) && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">CNPJ</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {cnpjRaw ? (
                      <>
                        <p className="text-sm font-mono font-bold" data-testid="text-cnpj">{campos.cnpj}</p>
                        <Button size="sm" variant="outline" className="gap-1.5"
                          disabled={cnpjaLoading}
                          onClick={consultarCnpja}
                          data-testid="button-consultar-cnpja"
                        >
                          {cnpjaLoading
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Consultando...</>
                            : <><Search className="w-3.5 h-3.5" /> {cnpjaData ? "Atualizar CNPJA" : "Consultar CNPJA"}</>}
                        </Button>
                      </>
                    ) : !isTipoMinerario(ativo.type) ? (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">CNPJ não informado{titularAnm ? ` — Titular ANM: ${titularAnm}` : ""}</p>
                        <div className="flex gap-2">
                          <Input
                            placeholder="Digite o CNPJ..."
                            className="max-w-[220px] font-mono text-sm"
                            data-testid="input-cnpj-empresa"
                            onKeyDown={(e: any) => {
                              if (e.key === "Enter") salvarCnpj(e.target.value);
                            }}
                          />
                          <Button size="sm" variant="default" className="gap-1.5"
                            onClick={(e: any) => {
                              const input = e.target.closest(".space-y-2")?.querySelector("input");
                              if (input) salvarCnpj(input.value);
                            }}
                            data-testid="button-salvar-cnpj"
                          >
                            Salvar CNPJ
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {cnpjaData && (
                      <div className="space-y-3 mt-3">
                        {campos.cnpjaDataUpdatedAt && (
                          <p className="text-[10px] text-muted-foreground">Consultado em {new Date(campos.cnpjaDataUpdatedAt).toLocaleDateString("pt-BR")} às {new Date(campos.cnpjaDataUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                          {cnpjaData.legalName && (
                            <div className="p-2 rounded bg-muted/50">
                              <p className="text-xs text-muted-foreground">Razão Social</p>
                              <p className="text-sm font-medium" data-testid="text-cnpja-legal">{cnpjaData.legalName}</p>
                            </div>
                          )}
                          {cnpjaData.tradeName && (
                            <div className="p-2 rounded bg-muted/50">
                              <p className="text-xs text-muted-foreground">Nome Fantasia</p>
                              <p className="text-sm font-medium" data-testid="text-cnpja-trade">{cnpjaData.tradeName}</p>
                            </div>
                          )}
                          {cnpjaData.porte && (
                            <div className="p-2 rounded bg-muted/50">
                              <p className="text-xs text-muted-foreground">Porte</p>
                              <p className="text-sm font-medium" data-testid="text-cnpja-porte">{cnpjaData.porte}</p>
                            </div>
                          )}
                          {(cnpjaData.status || cnpjaData.situacao) && (
                            <div className="p-2 rounded bg-muted/50">
                              <p className="text-xs text-muted-foreground">Situação</p>
                              <p className="text-sm font-medium" data-testid="text-cnpja-status">{cnpjaData.status || cnpjaData.situacao}</p>
                            </div>
                          )}
                          {cnpjaData.cnaePrincipal && (
                            <div className="p-2 rounded bg-muted/50 col-span-2">
                              <p className="text-xs text-muted-foreground">CNAE Principal</p>
                              <p className="text-sm font-medium" data-testid="text-cnpja-cnae">{typeof cnpjaData.cnaePrincipal === "object" ? `${cnpjaData.cnaePrincipal.codigo} - ${cnpjaData.cnaePrincipal.descricao}` : cnpjaData.cnaePrincipal}</p>
                            </div>
                          )}
                        </div>
                        {(cnpjaData.phones?.length > 0 || cnpjaData.emails?.length > 0) && (
                          <div className="flex flex-wrap gap-2">
                            {cnpjaData.phones?.map((p: any, i: number) => (
                              <a key={`p-${i}`} href={`tel:${typeof p === "string" ? p : p.number}`} className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded hover:bg-muted/80" data-testid={`chip-phone-${i}`}>
                                <Phone className="w-3 h-3" /> {typeof p === "string" ? p : p.number}
                              </a>
                            ))}
                            {cnpjaData.emails?.map((e: any, i: number) => (
                              <a key={`e-${i}`} href={`mailto:${typeof e === "string" ? e : e.address}`} className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded hover:bg-muted/80" data-testid={`chip-email-${i}`}>
                                <Mail className="w-3 h-3" /> {typeof e === "string" ? e : e.address}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
                )}

                {(campos.faturamentoAnual || campos.ebitda || campos.multiplo || campos.motivoVenda) && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Dados Financeiros</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-3">
                        {campos.faturamentoAnual != null && (
                          <div className="p-2 rounded bg-muted/50 text-center">
                            <p className="text-xs text-muted-foreground">Faturamento Anual</p>
                            <p className="text-sm font-bold" data-testid="text-faturamento">{formatBRL(campos.faturamentoAnual)}</p>
                          </div>
                        )}
                        {campos.ebitda != null && (
                          <div className="p-2 rounded bg-muted/50 text-center">
                            <p className="text-xs text-muted-foreground">EBITDA</p>
                            <p className="text-sm font-bold" data-testid="text-ebitda">{formatBRL(campos.ebitda)}</p>
                          </div>
                        )}
                        {campos.multiplo && (
                          <div className="p-2 rounded bg-muted/50 text-center">
                            <p className="text-xs text-muted-foreground">Múltiplo</p>
                            <p className="text-sm font-bold" data-testid="text-multiplo">{campos.multiplo}x EBITDA</p>
                          </div>
                        )}
                        {campos.motivoVenda && (
                          <div className="p-2 rounded bg-muted/50">
                            <p className="text-xs text-muted-foreground">Motivo da Venda</p>
                            <p className="text-sm" data-testid="text-motivo-venda">{campos.motivoVenda}</p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {(margemEbitda || valuationImplicito) && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Valuation</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {margemEbitda && (
                        <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                          <span className="text-sm text-muted-foreground">Margem EBITDA</span>
                          <span className="text-sm font-bold" data-testid="text-margem-ebitda">{margemEbitda}%</span>
                        </div>
                      )}
                      {valuationImplicito && (
                        <div className="flex items-center justify-between p-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                          <span className="text-sm text-muted-foreground">Valuation implícito</span>
                          <span className="text-sm font-bold text-green-700" data-testid="text-valuation">{formatBRL(valuationImplicito)}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      Due Diligence — Certidões
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {ativo.linkedCompanyId && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={certidoesLoading}
                        onClick={async () => {
                          setCertidoesLoading(true);
                          try {
                            const res = await fetch(`/api/companies/${ativo.linkedCompanyId}/certidoes`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              credentials: "include",
                              body: JSON.stringify({}),
                            });
                            const data = await res.json();
                            if (!res.ok) {
                              const msg = data?.message || `Erro ${res.status}`;
                              toast({ title: "Certidões indisponíveis", description: msg, variant: "destructive" });
                              setCertidoesLoading(false);
                              return;
                            }
                            setCertidoesData(data);
                            salvarEnrichment("certidoesData", data);
                            if (data.erros && data.erros.length > 0) {
                              const fontesComErro = data.erros.map((e: any) => e.fonte).join(", ");
                              toast({ title: `Consulta parcial: falha em ${fontesComErro}`, description: "Algumas fontes não puderam ser consultadas. Os dados disponíveis foram exibidos.", variant: "destructive" });
                            }
                          } catch (err: any) {
                            const msg = err?.message || "Erro ao consultar certidões";
                            toast({ title: "Erro ao consultar certidões", description: msg, variant: "destructive" });
                          }
                          setCertidoesLoading(false);
                        }}
                        data-testid="button-consultar-certidoes"
                      >
                        {certidoesLoading
                          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Consultando...</>
                          : <><Search className="w-3.5 h-3.5" /> {certidoesData ? "Atualizar certidões" : "Consultar certidões"}</>}
                      </Button>
                    )}

                    {!ativo.linkedCompanyId && (
                      <p className="text-xs text-muted-foreground">
                        Vincule uma empresa ao ativo para consultar certidões.
                      </p>
                    )}

                    {certidoesData && (
                      <div className="space-y-3">
                        {campos.certidoesDataUpdatedAt && (
                          <p className="text-[10px] text-muted-foreground">Consultado em {new Date(campos.certidoesDataUpdatedAt).toLocaleDateString("pt-BR")} às {new Date(campos.certidoesDataUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
                        )}
                        <div className={cn(
                          "p-3 rounded-lg border flex items-center gap-3",
                          certidoesData.pgfn?.temDebitoAtivo
                            ? "bg-red-50 border-red-300"
                            : certidoesData.pgfn?.temDebitoAtivo === false
                              ? "bg-green-50 border-green-200"
                              : "bg-muted/50"
                        )}>
                          {certidoesData.pgfn?.temDebitoAtivo
                            ? <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                            : certidoesData.pgfn?.temDebitoAtivo === false
                              ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                              : <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />}
                          <div>
                            <p className="text-sm font-medium">PGFN — Dívida Ativa Federal</p>
                            <p className="text-xs text-muted-foreground">{certidoesData.pgfn?.situacao}</p>
                          </div>
                        </div>

                        <div className={cn(
                          "p-3 rounded-lg border",
                          certidoesData.cnj?.totalProcessos > 5
                            ? "bg-amber-50 border-amber-300"
                            : "bg-green-50 border-green-200"
                        )}>
                          <div className="flex items-center gap-2 mb-1">
                            <Briefcase className="w-4 h-4 text-muted-foreground" />
                            <p className="text-sm font-medium">CNJ — Processos Judiciais</p>
                            <Badge variant="outline" className="ml-auto text-xs">
                              {certidoesData.cnj?.totalProcessos} processo(s)
                            </Badge>
                          </div>
                          {certidoesData.cnj?.processos?.slice(0, 3).map((p: any, i: number) => (
                            <div key={i} className="text-xs text-muted-foreground border-t mt-1 pt-1">
                              <span className="font-mono">{p.numero}</span> — {p.classe} ({p.tribunal})
                            </div>
                          ))}
                        </div>

                        <div className={cn(
                          "p-3 rounded-lg border flex items-center gap-3",
                          certidoesData.ceis?.sancionado
                            ? "bg-red-50 border-red-300"
                            : "bg-green-50 border-green-200"
                        )}>
                          {certidoesData.ceis?.sancionado
                            ? <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                            : <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />}
                          <div>
                            <p className="text-sm font-medium">TCU CEIS — Sanções</p>
                            <p className="text-xs text-muted-foreground">
                              {certidoesData.ceis?.sancionado ? "Empresa sancionada" : "Sem sanções registradas"}
                            </p>
                          </div>
                        </div>

                        <p className="text-[10px] text-muted-foreground text-right">
                          Consultado em: {new Date(certidoesData.pgfn?.consultadoEm || Date.now()).toLocaleString("pt-BR")}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {ativo.linkedCompanyId && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/empresas/${ativo.linkedCompanyId}`)} data-testid="button-ver-empresa-crm">
                    <Building2 className="w-3.5 h-3.5" /> Ver cadastro da empresa
                  </Button>
                )}
                </>
              );
            })()}
          </TabsContent>

        <TabsContent value="enriquecimento" className="mt-4 space-y-4">
          <EnrichmentTab ativo={ativo} assetId={id!} />
        </TabsContent>

        <TabsContent value="ia" className="mt-4 space-y-4">
          <AssetIaTab ativo={ativo} assetId={id!} />
        </TabsContent>
        </div>
      </Tabs>

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir ativo?</AlertDialogTitle>
            <AlertDialogDescription>
              "{ativo.title}" será removido permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Sim, excluir ativo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AtivoFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={ativo}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/assets", id] });
        }}
      />
    </div>
  );
}

function DeepIntelSection({ deepIntel }: { deepIntel: any }) {
  if (!deepIntel) return null;

  const severityColor = (s: string) => {
    if (s === "alta") return "text-red-600 bg-red-50 border-red-200";
    if (s === "media") return "text-yellow-600 bg-yellow-50 border-yellow-200";
    return "text-green-600 bg-green-50 border-green-200";
  };

  const confiancaBadge = (c: string) => {
    if (c === "alta") return "bg-green-100 text-green-700";
    if (c === "media") return "bg-yellow-100 text-yellow-700";
    return "bg-gray-100 text-gray-600";
  };

  return (
    <div className="space-y-4" data-testid="deep-intel-results">
      <div className="flex items-center gap-3 mb-2">
        {/* (Score de confiança removido: material de busca web é T3/T4 —
            pista de trabalho, nunca conclusão pontuada.) */}
        <span className="text-xs text-muted-foreground">
          Analisado em {new Date(deepIntel.analyzedAt).toLocaleString("pt-BR")}
        </span>
      </div>

      {deepIntel.resumoInvestigacao && (
        <div className="p-4 rounded-lg border bg-violet-50 dark:bg-violet-950/30 border-violet-200" data-testid="text-deep-intel-resumo">
          <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
            <Search className="h-4 w-4 text-violet-600" />
            Resumo da Investigação
          </h4>
          <p className="text-sm leading-relaxed">{deepIntel.resumoInvestigacao}</p>
        </div>
      )}

      {deepIntel.proprietarios?.length > 0 && (
        <div className="p-4 rounded-lg border bg-blue-50 dark:bg-blue-950/30 border-blue-200">
          <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-blue-600" />
            Proprietários / Pessoas Ligadas ({deepIntel.proprietarios.length})
          </h4>
          <div className="space-y-2">
            {deepIntel.proprietarios.map((p: any, i: number) => (
              <div key={i} className="flex items-start justify-between p-2 rounded bg-white dark:bg-gray-900 border text-sm">
                <div>
                  <span className="font-medium">{p.nome}</span>
                  {p.cpfCnpj && <span className="text-muted-foreground ml-2">({p.cpfCnpj})</span>}
                  <div className="text-xs text-muted-foreground mt-0.5">{p.papel} · Fonte: {p.fonte}</div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${confiancaBadge(p.confianca)}`}>{p.confianca}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {deepIntel.contatos?.length > 0 && (
        <div className="p-4 rounded-lg border bg-green-50 dark:bg-green-950/30 border-green-200">
          <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <Phone className="h-4 w-4 text-green-600" />
            Contatos Encontrados ({deepIntel.contatos.length})
          </h4>
          <div className="space-y-2">
            {deepIntel.contatos.map((c: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-2 rounded bg-white dark:bg-gray-900 border text-sm">
                <div className="flex items-center gap-2">
                  {c.tipo === "telefone" || c.tipo === "whatsapp" ? <Phone className="h-3.5 w-3.5 text-green-500" /> : <Mail className="h-3.5 w-3.5 text-blue-500" />}
                  <div>
                    <span className="font-medium">{c.valor}</span>
                    {c.pessoa && <span className="text-muted-foreground"> — {c.pessoa}</span>}
                    {c.aviso && <p className="text-[11px] text-amber-700 dark:text-amber-400">{c.aviso}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{c.fonte}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${confiancaBadge(c.confianca)}`}>{c.confianca}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {deepIntel.processos?.length > 0 && (
        <div className="p-4 rounded-lg border bg-orange-50 dark:bg-orange-950/30 border-orange-200">
          <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <FileText className="h-4 w-4 text-orange-600" />
            Processos ({deepIntel.processos.length})
          </h4>
          <div className="space-y-2">
            {deepIntel.processos.map((p: any, i: number) => (
              <div key={i} className="p-2 rounded bg-white dark:bg-gray-900 border text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium capitalize">{p.tipo}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${p.status === "ativo" || p.status === "em andamento" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>{p.status}</span>
                </div>
                {p.numero && <div className="text-xs text-muted-foreground">Nº {p.numero}</div>}
                <p className="text-xs mt-1">{p.descricao}</p>
                <span className="text-xs text-muted-foreground">Fonte: {p.fonte}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {deepIntel.restricoes?.length > 0 && (
        <div className="p-4 rounded-lg border bg-red-50 dark:bg-red-950/30 border-red-200">
          <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <Shield className="h-4 w-4 text-red-600" />
            Restrições e Impedimentos ({deepIntel.restricoes.length})
          </h4>
          <div className="space-y-2">
            {deepIntel.restricoes.map((r: any, i: number) => (
              <div key={i} className={`p-2 rounded border text-sm ${severityColor(r.severidade)}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium capitalize">{r.tipo}</span>
                  <span className="text-xs font-medium uppercase">{r.severidade}</span>
                </div>
                <p className="text-xs mt-1">{r.descricao}</p>
                <span className="text-xs opacity-70">Fonte: {r.fonte}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {deepIntel.historicoPropriedade?.length > 0 && (
        <div className="p-4 rounded-lg border">
          <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-gray-600" />
            Histórico da Propriedade
          </h4>
          <div className="space-y-2">
            {deepIntel.historicoPropriedade.map((h: any, i: number) => (
              <div key={i} className="flex items-start gap-3 p-2 rounded bg-muted/30 text-sm">
                <div className="w-2 h-2 rounded-full bg-gray-400 mt-1.5 flex-shrink-0" />
                <div>
                  <div className="font-medium">{h.evento} {h.data && <span className="text-muted-foreground font-normal">({h.data})</span>}</div>
                  <p className="text-xs text-muted-foreground">{h.detalhes}</p>
                  <span className="text-xs text-muted-foreground">Fonte: {h.fonte}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {deepIntel.fontesPesquisadas?.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">
            {deepIntel.fontesPesquisadas.length} fontes pesquisadas
          </summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {deepIntel.fontesPesquisadas.map((f: string, i: number) => (
              <li key={i}>
                {f.startsWith("http") ? <a href={f} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline break-all">{f}</a> : f}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-xs text-muted-foreground pt-2 border-t">GPT-4o (completo) com pesquisa web · {new Date(deepIntel.analyzedAt).toLocaleDateString("pt-BR")}</p>
    </div>
  );
}

function AssetIaTab({ ativo, assetId }: { ativo: any; assetId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deepIntel, setDeepIntel] = useState<any>(ativo.camposEspecificos?.iaDeepIntel || null);
  const [deepIntelLoading, setDeepIntelLoading] = useState(false);

  const runDeepIntel = async () => {
    setDeepIntelLoading(true);
    try {
      const res = await apiRequest("POST", `/api/ai/deep-intel/${ativo.id}`);
      const data = await res.json();
      if (data.success && data.data) {
        setDeepIntel(data.data);
        queryClient.invalidateQueries({ queryKey: ["/api/assets", assetId] });
        toast({ title: "Investigação completa", description: "Dados de inteligência salvos com sucesso" });
      } else {
        toast({ title: "Erro", description: data.message || "Erro na investigação", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
    setDeepIntelLoading(false);
  };

  return (
    <>
      <Card className="border-violet-300 bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-950/30 dark:to-indigo-950/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-5 w-5 text-violet-700" />
            Inteligência Completa do Ativo (GPT-4o)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {ativo.type === "MINA" || ativo.type === "MINERACAO" || ativo.type === "MINERIO" || ativo.type === "JAZIDA" || ativo.anmProcesso
              ? "Investigação profunda usando GPT-4o completo com pesquisa web. Cruza dados ANM (processo, titular, substância, fase, eventos), dados geoespaciais e ambientais para identificar: titular dos direitos minerários, sócios, CNPJ, contatos, processos e multas ANM."
              : "Investigação profunda usando GPT-4o completo com pesquisa web. Cruza TODOS os dados enriquecidos (CAF, SICAR, Embrapa, MapBiomas, IBAMA, NDVI, SICOR) para identificar: proprietários reais, contatos, processos judiciais e restrições."}
          </p>
          <Button
            onClick={runDeepIntel}
            disabled={deepIntelLoading}
            className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
            data-testid="button-ia-deep-intel"
          >
            {deepIntelLoading
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Investigando com IA (pode levar 60-120s)...</>
              : <><Search className="mr-2 h-4 w-4" /> {deepIntel ? "Reinvestigar com IA" : "Investigar com IA"}</>}
          </Button>
          {deepIntel && <DeepIntelSection deepIntel={deepIntel} />}
        </CardContent>
      </Card>

    </>
  );
}

