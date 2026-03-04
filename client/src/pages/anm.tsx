import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search, MapPin, Download, Loader2, Filter, X, Layers, Mountain,
  ChevronLeft, ChevronRight, Map as MapIcon, Check, ExternalLink,
  ChevronDown, ChevronUp, Briefcase, AlertTriangle, Clock, Ban,
  HandCoins, Zap,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useStages } from "@/hooks/use-crm";
import { cn } from "@/lib/utils";

const ESTADOS_BR = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
  "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

const FASES_ANM = [
  { value: "REQUERIMENTO DE PESQUISA", label: "Requerimento de Pesquisa" },
  { value: "AUTORIZAÇÃO DE PESQUISA", label: "Autorização de Pesquisa" },
  { value: "REQUERIMENTO DE LAVRA", label: "Requerimento de Lavra" },
  { value: "CONCESSÃO DE LAVRA", label: "Concessão de Lavra" },
  { value: "LICENCIAMENTO", label: "Licenciamento" },
  { value: "LAVRA GARIMPEIRA", label: "Lavra Garimpeira" },
  { value: "REGISTRO DE EXTRAÇÃO", label: "Registro de Extração" },
  { value: "DIREITO DE REQUERER A LAVRA", label: "Direito de Requerer a Lavra" },
  { value: "APTO PARA DISPONIBILIDADE", label: "Apto para Disponibilidade" },
  { value: "DISPONIBILIDADE", label: "Disponibilidade" },
];

const USOS_ANM = [
  { value: "Industrial", label: "Industrial" },
  { value: "Ourivesaria", label: "Ourivesaria" },
  { value: "Demais substâncias", label: "Demais substâncias" },
];

const OPPORTUNITY_SHORTCUTS = [
  {
    id: "disponibilidade",
    label: "Áreas em Disponibilidade",
    desc: "Áreas abertas para novos requerimentos",
    icon: HandCoins,
    color: "text-emerald-600",
    bg: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800",
    filters: { fase: "DISPONIBILIDADE" },
  },
  {
    id: "apto-disponibilidade",
    label: "Aptas p/ Disponibilidade",
    desc: "Prestes a ficar disponíveis",
    icon: Clock,
    color: "text-amber-600",
    bg: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800",
    filters: { fase: "APTO PARA DISPONIBILIDADE" },
  },
  {
    id: "indeferimento",
    label: "Indeferimentos",
    desc: "Processos indeferidos recentemente",
    icon: Ban,
    color: "text-red-600",
    bg: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800",
    filters: { ultEvento: "INDEFERIMENTO" },
  },
  {
    id: "caducidade",
    label: "Caducidade",
    desc: "Direitos perdidos por prazo",
    icon: AlertTriangle,
    color: "text-orange-600",
    bg: "bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800",
    filters: { ultEvento: "CADUCIDADE" },
  },
  {
    id: "desistencia",
    label: "Desistência",
    desc: "Titular desistiu do processo",
    icon: X,
    color: "text-purple-600",
    bg: "bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800",
    filters: { ultEvento: "DESISTÊNCIA" },
  },
];

const PAGE_SIZE = 20;

interface ANMProcesso {
  PROCESSO: string;
  NOME: string;
  FASE: string;
  SUBS: string;
  AREA_HA: number;
  UF: string;
  ULT_EVENTO: string;
  USO: string;
  ANO: number;
  DSProcesso?: string;
  [key: string]: any;
}

function LeafletMap({
  geometries,
  selectedProcesso,
  onSelectProcesso,
  processDetails,
}: {
  geometries: Record<string, any>;
  selectedProcesso: string | null;
  onSelectProcesso: (p: string) => void;
  processDetails: Record<string, any>;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const layersRef = useRef<Record<string, any>>({});
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const LRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (cancelled) return;
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });
      LRef.current = L;
      setLeafletLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || mapInstanceRef.current) return;
    const L = LRef.current;
    const map = L.map(mapRef.current, {
      center: [-14.235, -51.925],
      zoom: 4,
      zoomControl: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);
    mapInstanceRef.current = map;
    setTimeout(() => map.invalidateSize(), 300);
    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [leafletLoaded]);

  useEffect(() => {
    if (!mapInstanceRef.current || !LRef.current) return;
    const L = LRef.current;
    const map = mapInstanceRef.current;
    map.invalidateSize();

    Object.keys(layersRef.current).forEach(key => {
      if (!geometries[key]) {
        map.removeLayer(layersRef.current[key]);
        delete layersRef.current[key];
      }
    });

    const bounds: any[] = [];
    Object.entries(geometries).forEach(([processo, geojson]) => {
      if (!geojson) return;
      const isSelected = processo === selectedProcesso;
      if (layersRef.current[processo]) {
        layersRef.current[processo].setStyle({
          color: isSelected ? "#ef4444" : "#3b82f6",
          weight: isSelected ? 3 : 2,
          fillOpacity: isSelected ? 0.35 : 0.15,
        });
      } else {
        try {
          const detail = processDetails[processo] || {};
          const popupHtml = `
            <div style="min-width:240px;font-family:system-ui,sans-serif;font-size:12px;">
              <div style="font-weight:700;font-size:14px;color:#1e40af;margin-bottom:6px;border-bottom:2px solid #3b82f6;padding-bottom:4px;">
                ${processo}
              </div>
              ${detail.NOME ? `<div style="margin-bottom:4px;"><span style="font-weight:600;color:#64748b;">Titular:</span> ${detail.NOME}</div>` : ""}
              ${detail.FASE ? `<div style="margin-bottom:4px;"><span style="font-weight:600;color:#64748b;">Fase:</span> <span style="background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:4px;font-size:11px;">${detail.FASE}</span></div>` : ""}
              ${detail.SUBS ? `<div style="margin-bottom:4px;"><span style="font-weight:600;color:#64748b;">Substância:</span> ${detail.SUBS}</div>` : ""}
              ${detail.USO ? `<div style="margin-bottom:4px;"><span style="font-weight:600;color:#64748b;">Uso:</span> ${detail.USO}</div>` : ""}
              ${detail.AREA_HA ? `<div style="margin-bottom:4px;"><span style="font-weight:600;color:#64748b;">Área:</span> ${Number(detail.AREA_HA).toLocaleString("pt-BR")} ha</div>` : ""}
              ${detail.UF ? `<div style="margin-bottom:4px;"><span style="font-weight:600;color:#64748b;">UF:</span> ${detail.UF}</div>` : ""}
              ${detail.ANO ? `<div style="margin-bottom:4px;"><span style="font-weight:600;color:#64748b;">Ano:</span> ${detail.ANO}</div>` : ""}
              ${detail.ULT_EVENTO ? `<div style="margin-bottom:4px;"><span style="font-weight:600;color:#64748b;">Últ. Evento:</span> <span style="background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:4px;font-size:11px;">${detail.ULT_EVENTO}</span></div>` : ""}
            </div>
          `;
          const layer = L.geoJSON(geojson, {
            style: {
              color: isSelected ? "#ef4444" : "#3b82f6",
              weight: isSelected ? 3 : 2,
              fillOpacity: isSelected ? 0.35 : 0.15,
              fillColor: isSelected ? "#ef4444" : "#3b82f6",
            },
          });
          layer.on("click", (e: any) => {
            onSelectProcesso(processo);
            layer.openPopup(e.latlng);
          });
          layer.bindTooltip(processo, { sticky: true });
          layer.bindPopup(popupHtml, { maxWidth: 320, className: "anm-popup" });
          layer.addTo(map);
          layersRef.current[processo] = layer;
        } catch (e) {
          console.error("Failed to add GeoJSON for", processo, e);
        }
      }
      if (layersRef.current[processo]) {
        try {
          const b = layersRef.current[processo].getBounds();
          if (b.isValid()) bounds.push(b);
        } catch {}
      }
    });

    if (selectedProcesso && layersRef.current[selectedProcesso]) {
      try {
        const b = layersRef.current[selectedProcesso].getBounds();
        if (b.isValid()) map.fitBounds(b, { padding: [30, 30], maxZoom: 14 });
      } catch {}
    } else if (bounds.length > 0) {
      const combined = bounds.reduce((acc, b) => acc.extend(b), L.latLngBounds(bounds[0]));
      if (combined.isValid()) map.fitBounds(combined, { padding: [30, 30], maxZoom: 10 });
    }
  }, [geometries, selectedProcesso, onSelectProcesso]);

  useEffect(() => {
    if (mapInstanceRef.current) {
      setTimeout(() => mapInstanceRef.current?.invalidateSize(), 100);
    }
  });

  return (
    <div
      ref={mapRef}
      data-testid="map-anm"
      className="w-full h-full min-h-[300px] rounded-md"
      style={{ zIndex: 0 }}
    />
  );
}

function CreateDealDialog({
  open,
  onOpenChange,
  processo,
  importedAssetId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  processo: ANMProcesso | null;
  importedAssetId?: number;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { data: stages = [] } = useStages();
  const [selectedStageId, setSelectedStageId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const assetStages = useMemo(() => {
    return (stages as any[]).filter((s: any) => s.pipelineType === "ASSET").sort((a: any, b: any) => a.order - b.order);
  }, [stages]);

  useEffect(() => {
    if (open && assetStages.length > 0 && !selectedStageId) {
      setSelectedStageId(String(assetStages[0].id));
    }
  }, [open, assetStages, selectedStageId]);

  const handleCreate = async () => {
    if (!processo || !selectedStageId) return;
    setSaving(true);
    try {
      let assetId = importedAssetId;
      if (!assetId) {
        const importRes = await apiRequest("POST", "/api/anm/import-asset", {
          processo: processo.PROCESSO,
          nome: processo.NOME,
          fase: processo.FASE,
          substancia: processo.SUBS,
          areaHa: processo.AREA_HA,
          uf: processo.UF,
          ultEvento: processo.ULT_EVENTO,
          uso: processo.USO,
          ano: processo.ANO,
        });
        const importData = await importRes.json();
        assetId = importData.id || importData.assetId;
      }

      const dealPayload = {
        pipelineType: "ASSET",
        stageId: Number(selectedStageId),
        title: `Oportunidade: ${processo.SUBS || "Mineração"} - ${processo.PROCESSO}`,
        description: [
          `Processo ANM: ${processo.PROCESSO}`,
          `Titular anterior: ${processo.NOME || "N/A"}`,
          `Fase: ${processo.FASE || "N/A"}`,
          `Substância: ${processo.SUBS || "N/A"}`,
          `Área: ${processo.AREA_HA ? Number(processo.AREA_HA).toLocaleString("pt-BR") + " ha" : "N/A"}`,
          `UF: ${processo.UF || "N/A"}`,
          `Uso: ${processo.USO || "N/A"}`,
          `Último Evento: ${processo.ULT_EVENTO || "N/A"}`,
        ].join("\n"),
        source: "ANM Portal",
        labels: ["ANM", "Oportunidade"],
        priority: "high",
        assetId: assetId || undefined,
      };

      await apiRequest("POST", "/api/crm/deals", dealPayload);

      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/matching/assets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/anm/imported"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/dashboard"] });

      toast({ title: "Deal criado com sucesso!", description: "Ativo importado e deal adicionado ao pipeline ASSET." });
      onOpenChange(false);
      setSelectedStageId("");
      navigate("/crm");
    } catch (err: any) {
      toast({ title: "Erro ao criar deal", description: err?.message || "Tente novamente", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!processo) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Briefcase className="w-5 h-5" />
            Criar Deal — Oportunidade ANM
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-lg border p-3 bg-muted/30 space-y-1.5">
            <div className="flex items-center gap-2">
              <Mountain className="w-4 h-4 text-orange-500" />
              <span className="font-mono text-sm font-medium">{processo.PROCESSO}</span>
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p><span className="font-medium">Titular:</span> {processo.NOME || "N/A"}</p>
              <p><span className="font-medium">Substância:</span> {processo.SUBS || "N/A"}</p>
              <p><span className="font-medium">Fase:</span> {processo.FASE || "N/A"}</p>
              <p><span className="font-medium">Área:</span> {processo.AREA_HA ? `${Number(processo.AREA_HA).toLocaleString("pt-BR")} ha` : "N/A"} — <span className="font-medium">UF:</span> {processo.UF || "N/A"}</p>
              <p><span className="font-medium">Últ. Evento:</span> {processo.ULT_EVENTO || "N/A"}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Pipeline: ASSET</Label>
            <p className="text-xs text-muted-foreground">O deal será criado no pipeline de Ativos</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Estágio inicial</Label>
            <Select value={selectedStageId} onValueChange={setSelectedStageId}>
              <SelectTrigger data-testid="select-deal-stage">
                <SelectValue placeholder="Selecione o estágio" />
              </SelectTrigger>
              <SelectContent>
                {assetStages.map((s: any) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border p-3 bg-blue-50/50 dark:bg-blue-900/10 space-y-1">
            <p className="text-xs font-medium text-blue-700 dark:text-blue-400 flex items-center gap-1">
              <Zap className="w-3.5 h-3.5" /> O que será feito:
            </p>
            <ul className="text-xs text-muted-foreground space-y-0.5 ml-5 list-disc">
              {!importedAssetId && <li>Importar processo como ativo (tipo MINA)</li>}
              {importedAssetId && <li>Vincular ativo já importado (ID #{importedAssetId})</li>}
              <li>Criar deal no pipeline ASSET</li>
              <li>Título: "Oportunidade: {processo.SUBS} - {processo.PROCESSO}"</li>
              <li>Prioridade: Alta</li>
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={saving || !selectedStageId} data-testid="button-confirm-create-deal">
            {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Briefcase className="w-4 h-4 mr-1.5" />}
            Criar Deal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ANMPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [uf, setUf] = useState("");
  const [substancia, setSubstancia] = useState("");
  const [fase, setFase] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [processo, setProcesso] = useState("");
  const [uso, setUso] = useState("");
  const [ano, setAno] = useState("");
  const [ultEvento, setUltEvento] = useState("");
  const [searched, setSearched] = useState(false);
  const [selectedProcesso, setSelectedProcesso] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [geometries, setGeometries] = useState<Record<string, any>>({});
  const [loadingGeometries, setLoadingGeometries] = useState<Set<string>>(new Set());
  const [mapOpen, setMapOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dealDialogOpen, setDealDialogOpen] = useState(false);
  const [dealProcesso, setDealProcesso] = useState<ANMProcesso | null>(null);

  const searchParams = useMemo(() => {
    const params = new URLSearchParams();
    if (uf) params.set("uf", uf);
    if (substancia) params.set("substancia", substancia);
    if (fase) params.set("fase", fase);
    if (empresa) params.set("empresa", empresa);
    if (processo) params.set("processo", processo);
    if (uso) params.set("uso", uso);
    if (ano) params.set("ano", ano);
    if (ultEvento) params.set("ultEvento", ultEvento);
    return params.toString();
  }, [uf, substancia, fase, empresa, processo, uso, ano, ultEvento]);

  const [activeSearch, setActiveSearch] = useState("");

  const { data: resultData, isLoading, isFetching } = useQuery<{ features: ANMProcesso[]; total: number }>({
    queryKey: ["/api/anm/processos", activeSearch],
    queryFn: async () => {
      if (!activeSearch) return { features: [], total: 0 };
      const res = await fetch(`/api/anm/processos?${activeSearch}`, { credentials: "include" });
      if (!res.ok) throw new Error("Erro ao buscar processos ANM");
      return res.json();
    },
    enabled: searched && !!activeSearch,
  });

  const { data: importedMap = {} } = useQuery<Record<string, number>>({
    queryKey: ["/api/anm/imported"],
    queryFn: async () => {
      const res = await fetch("/api/anm/imported", { credentials: "include" });
      if (!res.ok) return {};
      return res.json();
    },
  });

  const results = resultData?.features || [];
  const totalResults = resultData?.total || results.length;

  const pagedResults = useMemo(() => {
    return results.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  }, [results, page]);

  const processDetailsMap = useMemo(() => {
    const map: Record<string, any> = {};
    results.forEach((proc: any) => {
      if (proc.PROCESSO) map[proc.PROCESSO] = proc;
    });
    return map;
  }, [results]);

  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));

  const hasFilters = uf || substancia || fase || empresa || processo || uso || ano || ultEvento;
  const hasAdvancedFilters = uso || ano || ultEvento;
  const activeFilterCount = [uf, substancia, fase, empresa, processo, uso, ano, ultEvento].filter(Boolean).length;

  const applyFiltersAndSearch = useCallback((filters: Record<string, string>) => {
    setUf(filters.uf || "");
    setSubstancia(filters.substancia || "");
    setFase(filters.fase || "");
    setEmpresa(filters.empresa || "");
    setProcesso(filters.processo || "");
    setUso(filters.uso || "");
    setAno(filters.ano || "");
    setUltEvento(filters.ultEvento || "");
    if (filters.ultEvento) setShowAdvanced(true);
    setPage(0);
    setSelectedProcesso(null);
    setGeometries({});

    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    const ps = params.toString();
    setSearched(true);
    setActiveSearch(ps);
  }, []);

  const handleSearch = useCallback(() => {
    if (!hasFilters) {
      toast({ title: "Preencha ao menos um filtro", variant: "destructive" });
      return;
    }
    setSearched(true);
    setActiveSearch(searchParams);
    setPage(0);
    setSelectedProcesso(null);
    setGeometries({});
  }, [searchParams, hasFilters, toast]);

  const handleClear = useCallback(() => {
    setUf(""); setSubstancia(""); setFase(""); setEmpresa(""); setProcesso("");
    setUso(""); setAno(""); setUltEvento("");
    setSearched(false); setActiveSearch(""); setPage(0);
    setSelectedProcesso(null); setGeometries({}); setMapOpen(false);
  }, []);

  const fetchGeometry = useCallback(async (processoNum: string) => {
    if (geometries[processoNum] || loadingGeometries.has(processoNum)) return;
    setLoadingGeometries(prev => new Set(prev).add(processoNum));
    try {
      const res = await fetch(`/api/anm/geometria/${encodeURIComponent(processoNum)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Erro ao buscar geometria");
      const data = await res.json();
      setGeometries(prev => ({ ...prev, [processoNum]: data }));
    } catch {
      toast({ title: `Geometria não encontrada para ${processoNum}`, variant: "destructive" });
    } finally {
      setLoadingGeometries(prev => { const next = new Set(prev); next.delete(processoNum); return next; });
    }
  }, [geometries, loadingGeometries, toast]);

  const handleRowClick = useCallback((proc: ANMProcesso) => {
    const num = proc.PROCESSO;
    setSelectedProcesso(prev => prev === num ? null : num);
    fetchGeometry(num);
    setMapOpen(true);
  }, [fetchGeometry]);

  const handleLoadAllGeometries = useCallback(() => {
    pagedResults.forEach(proc => fetchGeometry(proc.PROCESSO));
    setMapOpen(true);
  }, [pagedResults, fetchGeometry]);

  const importMutation = useMutation({
    mutationFn: async (proc: ANMProcesso) => {
      const res = await apiRequest("POST", "/api/anm/import-asset", {
        processo: proc.PROCESSO, nome: proc.NOME, fase: proc.FASE,
        substancia: proc.SUBS, areaHa: proc.AREA_HA, uf: proc.UF,
        ultEvento: proc.ULT_EVENTO, uso: proc.USO, ano: proc.ANO,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Processo importado como ativo!" });
      queryClient.invalidateQueries({ queryKey: ["/api/matching/assets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/anm/imported"] });
    },
    onError: (err: any) => {
      const msg = err?.message || "";
      toast({ title: msg.includes("já foi importado") ? "Este processo ANM já foi importado." : "Erro ao importar processo", variant: "destructive" });
    },
  });

  const handleOpenDealDialog = useCallback((proc: ANMProcesso) => {
    setDealProcesso(proc);
    setDealDialogOpen(true);
  }, []);

  const geoCount = Object.keys(geometries).length;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 data-testid="text-page-title" className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
            <Mountain className="w-6 h-6 text-muted-foreground" />
            Portal ANM
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Consulte processos minerários e identifique oportunidades de aquisição
          </p>
        </div>
        {geoCount > 0 && (
          <Button onClick={() => setMapOpen(true)} variant="outline" data-testid="button-open-map">
            <MapIcon className="w-4 h-4 mr-1.5" />
            Ver Mapa
            <Badge variant="secondary" className="ml-1.5">{geoCount}</Badge>
          </Button>
        )}
      </div>

      {!searched && (
        <div>
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5 text-muted-foreground">
            <Zap className="w-4 h-4" /> Busca Rápida — Oportunidades
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            {OPPORTUNITY_SHORTCUTS.map(shortcut => {
              const Icon = shortcut.icon;
              return (
                <button
                  key={shortcut.id}
                  type="button"
                  onClick={() => applyFiltersAndSearch(shortcut.filters)}
                  className={cn(
                    "flex items-start gap-2.5 p-3 rounded-lg border text-left transition-all hover:shadow-md hover:scale-[1.02] active:scale-[0.98]",
                    shortcut.bg
                  )}
                  data-testid={`shortcut-${shortcut.id}`}
                >
                  <Icon className={cn("w-5 h-5 mt-0.5 shrink-0", shortcut.color)} />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold leading-tight">{shortcut.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{shortcut.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filtros de Busca
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="text-xs">{activeFilterCount} ativo(s)</Badge>
            )}
          </CardTitle>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={handleClear} data-testid="button-clear-filters">
              <X className="w-4 h-4 mr-1" /> Limpar
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">UF</Label>
              <Select value={uf || "all"} onValueChange={v => setUf(v === "all" ? "" : v)}>
                <SelectTrigger data-testid="select-uf-anm"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {ESTADOS_BR.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Substância</Label>
              <Input data-testid="input-substancia-anm" value={substancia} onChange={e => setSubstancia(e.target.value)} placeholder="ex: OURO, FERRO" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Fase</Label>
              <Select value={fase || "all"} onValueChange={v => setFase(v === "all" ? "" : v)}>
                <SelectTrigger data-testid="select-fase-anm"><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {FASES_ANM.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Empresa / Titular</Label>
              <Input data-testid="input-empresa-anm" value={empresa} onChange={e => setEmpresa(e.target.value)} placeholder="Nome da empresa" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Nº Processo</Label>
              <Input data-testid="input-processo-anm" value={processo} onChange={e => setProcesso(e.target.value)} placeholder="ex: 830.001/2020" />
            </div>
          </div>

          <div>
            <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="button-toggle-advanced">
              {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Filtros avançados
              {hasAdvancedFilters && <Badge variant="secondary" className="text-[10px] ml-1">{[uso, ano, ultEvento].filter(Boolean).length}</Badge>}
            </button>
            {showAdvanced && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 pt-3 border-t">
                <div className="space-y-1.5">
                  <Label className="text-xs">Uso</Label>
                  <Select value={uso || "all"} onValueChange={v => setUso(v === "all" ? "" : v)}>
                    <SelectTrigger data-testid="select-uso-anm"><SelectValue placeholder="Todos" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {USOS_ANM.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Ano do Processo</Label>
                  <Input data-testid="input-ano-anm" value={ano} onChange={e => setAno(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="ex: 2023" maxLength={4} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Último Evento (texto)</Label>
                  <Input data-testid="input-ultevento-anm" value={ultEvento} onChange={e => setUltEvento(e.target.value)} placeholder="ex: INDEFERIMENTO, MULTA, DÉBITO" />
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <Button onClick={handleSearch} disabled={isLoading || isFetching} data-testid="button-search-anm">
              {(isLoading || isFetching) ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Search className="w-4 h-4 mr-1.5" />}
              Buscar
            </Button>
          </div>
        </CardContent>
      </Card>

      {searched && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
            <CardTitle className="text-base">
              Resultados
              {results.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {results.length} {totalResults > results.length ? `de ${totalResults}` : ""}
                </Badge>
              )}
            </CardTitle>
            {results.length > 0 && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleLoadAllGeometries} data-testid="button-load-geometries">
                  <Layers className="w-4 h-4 mr-1" />
                  <span className="hidden sm:inline">Carregar polígonos</span>
                  <span className="sm:hidden">Polígonos</span>
                </Button>
                {geoCount > 0 && (
                  <Button size="sm" onClick={() => setMapOpen(true)} data-testid="button-show-map">
                    <MapIcon className="w-4 h-4 mr-1" /> Mapa
                    <Badge variant="secondary" className="ml-1.5 bg-white/20 text-white">{geoCount}</Badge>
                  </Button>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : results.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Mountain className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Nenhum processo encontrado.</p>
                <p className="text-xs mt-1">Ajuste os filtros e tente novamente.</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="whitespace-nowrap">Processo</TableHead>
                        <TableHead className="whitespace-nowrap">Titular</TableHead>
                        <TableHead className="whitespace-nowrap">Fase</TableHead>
                        <TableHead className="whitespace-nowrap">Substância</TableHead>
                        <TableHead className="whitespace-nowrap">Uso</TableHead>
                        <TableHead className="whitespace-nowrap text-right">Área (ha)</TableHead>
                        <TableHead className="whitespace-nowrap">UF</TableHead>
                        <TableHead className="whitespace-nowrap">Ano</TableHead>
                        <TableHead className="whitespace-nowrap">Últ. Evento</TableHead>
                        <TableHead className="whitespace-nowrap text-center">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedResults.map((proc, idx) => {
                        const isImported = !!importedMap[proc.PROCESSO];
                        const importedAssetId = importedMap[proc.PROCESSO];
                        return (
                          <TableRow
                            key={proc.PROCESSO || idx}
                            data-testid={`row-processo-${proc.PROCESSO}`}
                            className={cn(
                              "cursor-pointer transition-colors",
                              selectedProcesso === proc.PROCESSO && "bg-primary/5",
                              isImported && "bg-green-50/50 dark:bg-green-900/10"
                            )}
                            onClick={() => handleRowClick(proc)}
                          >
                            <TableCell className="font-mono text-xs whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                {loadingGeometries.has(proc.PROCESSO) && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                                {geometries[proc.PROCESSO] && <MapPin className="w-3 h-3 text-blue-500" />}
                                {isImported && <Check className="w-3 h-3 text-green-600" />}
                                {proc.PROCESSO}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs max-w-[200px] truncate" title={proc.NOME}>{proc.NOME}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px] whitespace-nowrap">{proc.FASE}</Badge>
                            </TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{proc.SUBS}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{proc.USO || "-"}</TableCell>
                            <TableCell className="text-xs text-right whitespace-nowrap">
                              {proc.AREA_HA != null ? Number(proc.AREA_HA).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "-"}
                            </TableCell>
                            <TableCell className="text-xs">{proc.UF}</TableCell>
                            <TableCell className="text-xs">{proc.ANO || "-"}</TableCell>
                            <TableCell className="text-xs max-w-[180px] truncate" title={proc.ULT_EVENTO}>{proc.ULT_EVENTO || "-"}</TableCell>
                            <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                              <TooltipProvider>
                                <div className="flex items-center justify-center gap-0.5">
                                  {isImported ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Link href={`/ativos/${importedAssetId}`}>
                                          <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" data-testid={`button-view-asset-${proc.PROCESSO}`}>
                                            <ExternalLink className="w-3.5 h-3.5" />
                                          </Button>
                                        </Link>
                                      </TooltipTrigger>
                                      <TooltipContent>Ver ativo vinculado</TooltipContent>
                                    </Tooltip>
                                  ) : (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={importMutation.isPending} onClick={() => importMutation.mutate(proc)} data-testid={`button-import-${proc.PROCESSO}`}>
                                          <Download className="w-3.5 h-3.5" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Importar como Ativo</TooltipContent>
                                    </Tooltip>
                                  )}
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600" onClick={() => handleOpenDealDialog(proc)} data-testid={`button-deal-${proc.PROCESSO}`}>
                                        <Briefcase className="w-3.5 h-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Criar Deal no CRM</TooltipContent>
                                  </Tooltip>
                                </div>
                              </TooltipProvider>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between gap-2 p-3 border-t">
                    <span className="text-xs text-muted-foreground">Página {page + 1} de {totalPages}</span>
                    <div className="flex gap-1">
                      <Button variant="outline" size="icon" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="button-prev-page">
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <Button variant="outline" size="icon" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} data-testid="button-next-page">
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {!searched && (
        <Card>
          <CardContent className="p-8 text-center">
            <Mountain className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-30" />
            <h3 className="font-semibold text-lg mb-1">Consulte o Geoportal ANM</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Use os atalhos de oportunidade acima ou os filtros para buscar processos minerários.
              Importe como ativo e crie deals diretamente no pipeline.
            </p>
          </CardContent>
        </Card>
      )}

      <Sheet open={mapOpen} onOpenChange={setMapOpen}>
        <SheetContent side="right" className="w-full sm:w-[600px] md:w-[700px] lg:w-[800px] sm:max-w-none p-0 flex flex-col [&>button]:z-[1000]">
          <SheetHeader className="px-4 pt-4 pb-2 shrink-0">
            <SheetTitle className="flex items-center gap-2 text-base">
              <MapPin className="w-4 h-4" />
              Mapa de Processos
              {geoCount > 0 && <Badge variant="secondary">{geoCount} polígono(s)</Badge>}
            </SheetTitle>
            {selectedProcesso && (
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">
                  Selecionado: <span className="font-mono font-medium">{selectedProcesso}</span>
                </p>
                {importedMap[selectedProcesso] && (
                  <Link href={`/ativos/${importedMap[selectedProcesso]}`}>
                    <Badge variant="outline" className="text-[10px] text-green-600 border-green-300 cursor-pointer hover:bg-green-50">
                      <ExternalLink className="w-3 h-3 mr-1" /> Ver ativo
                    </Badge>
                  </Link>
                )}
              </div>
            )}
          </SheetHeader>
          <div className="flex-1 min-h-0 px-2 pb-2">
            <div className="h-full rounded-md overflow-hidden" style={{ minHeight: "calc(100vh - 100px)" }}>
              {mapOpen && (
                <LeafletMap geometries={geometries} selectedProcesso={selectedProcesso} onSelectProcesso={setSelectedProcesso} processDetails={processDetailsMap} />
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <CreateDealDialog
        open={dealDialogOpen}
        onOpenChange={setDealDialogOpen}
        processo={dealProcesso}
        importedAssetId={dealProcesso ? importedMap[dealProcesso.PROCESSO] : undefined}
      />
    </div>
  );
}
