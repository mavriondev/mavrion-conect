import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, MapPin, DollarSign, Ruler, Building2, FileText,
  Pencil, Trash2, Loader2, CheckCircle2, AlertCircle, Clock,
  TreePine, Pickaxe, Briefcase, Home, Wheat, Factory, Link2,
  Tag, MessageSquare, Zap, Search, Leaf, Thermometer, Droplets,
  FlaskConical, RefreshCw, Upload, ExternalLink, Paperclip, X as XIcon,
  Filter, ChevronRight, Phone, Mail, Handshake, Camera, Image,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AtivoFormDialog } from "./ativos";
import { Map } from "lucide-react";

function AssetPolygonMap({ assetId }: { assetId: number }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapReady, setMapReady] = useState(false);
  const [noGeom, setNoGeom] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let mapInstance: any = null;
    (async () => {
      try {
        const res = await apiRequest("GET", `/api/matching/assets/${assetId}/geometry`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!data.geometry || cancelled) { setNoGeom(true); return; }

        const L = (await import("leaflet")).default;
        await import("leaflet/dist/leaflet.css");
        if (cancelled || !mapRef.current) return;

        mapInstance = L.map(mapRef.current, { zoomControl: true, attributionControl: false });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
        }).addTo(mapInstance);

        const geoLayer = L.geoJSON(data.geometry, {
          style: { color: "#16a34a", weight: 2, fillColor: "#22c55e", fillOpacity: 0.25 },
        }).addTo(mapInstance);

        setMapReady(true);
        setTimeout(() => {
          if (!cancelled && mapInstance) {
            mapInstance.invalidateSize();
            mapInstance.fitBounds(geoLayer.getBounds(), { padding: [30, 30] });
          }
        }, 200);
      } catch { if (!cancelled) setNoGeom(true); }
    })();
    return () => { cancelled = true; if (mapInstance) mapInstance.remove(); };
  }, [assetId]);

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
      </CardContent>
    </Card>
  );
}

const TIPO_CONFIG: Record<string, { label: string; icon: any; color: string; badge: string }> = {
  TERRA:           { label: "Terra / Fazenda",       icon: TreePine,  color: "text-green-600",  badge: "bg-green-100 text-green-800" },
  MINA:            { label: "Mineração",              icon: Pickaxe,   color: "text-orange-600", badge: "bg-orange-100 text-orange-800" },
  NEGOCIO:         { label: "Negócio / M&A",          icon: Briefcase, color: "text-blue-600",   badge: "bg-blue-100 text-blue-800" },
  FII_CRI:         { label: "FII / CRI / Imóvel",    icon: Home,      color: "text-purple-600", badge: "bg-purple-100 text-purple-800" },
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
    { id: "documentos", label: "Documentos" },
    { id: "matches",    label: "Matches" },
    { id: "geo",        label: "Geo & SICAR" },
    { id: "embrapa",    label: "Embrapa" },
    { id: "caf",        label: "CAF / PRONAF" },
    { id: "empresa",    label: "Empresa" },
  ],
  AGRO: [
    { id: "info",       label: "Informações" },
    { id: "documentos", label: "Documentos" },
    { id: "matches",    label: "Matches" },
    { id: "geo",        label: "Geo & SICAR" },
    { id: "embrapa",    label: "Embrapa" },
    { id: "caf",        label: "CAF / PRONAF" },
    { id: "empresa",    label: "Empresa" },
  ],
  MINA: [
    { id: "info",       label: "Informações" },
    { id: "documentos", label: "Documentos" },
    { id: "matches",    label: "Matches" },
    { id: "anm",        label: "ANM" },
    { id: "geo",        label: "Geo" },
    { id: "empresa",    label: "Empresa" },
  ],
  NEGOCIO: [
    { id: "info",       label: "Informações" },
    { id: "documentos", label: "Documentos" },
    { id: "matches",    label: "Matches" },
    { id: "empresa",    label: "Empresa" },
  ],
  FII_CRI: [
    { id: "info",       label: "Informações" },
    { id: "documentos", label: "Documentos" },
    { id: "matches",    label: "Matches" },
    { id: "cvm",        label: "CVM / ANBIMA" },
    { id: "empresa",    label: "Empresa" },
  ],
  DESENVOLVIMENTO: [
    { id: "info",       label: "Informações" },
    { id: "documentos", label: "Documentos" },
    { id: "matches",    label: "Matches" },
    { id: "geo",        label: "Geo" },
    { id: "empresa",    label: "Empresa" },
  ],
};

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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
                  {f.ULT_EVENTO && (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">Último Evento</p>
                      <p className="font-medium text-xs" data-testid={`text-anm-live-evento-${idx}`}>{f.ULT_EVENTO}</p>
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
  camposEspecificos: any;
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
      await apiRequest("PATCH", `/api/matching/assets/${ativoId}`, {
        camposEspecificos: {
          ...camposEspecificos,
          [checkKey]: newChecks,
        },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/matching/assets", String(ativoId)] });
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
      await apiRequest("PATCH", `/api/matching/assets/${assetId}`, { fotos: novasFotos });
      queryClient.invalidateQueries({ queryKey: ["/api/matching/assets", String(assetId)] });
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
      await apiRequest("PATCH", `/api/matching/assets/${assetId}`, { fotos: novasFotos });
      queryClient.invalidateQueries({ queryKey: ["/api/matching/assets", String(assetId)] });
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

export default function AtivoDetalhePage({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const { data: ativoData, isLoading, error } = useQuery({
    queryKey: ["/api/matching/assets", id],
    queryFn: () => apiRequest("GET", `/api/matching/assets/${id}`).then(r => {
      if (!r.ok) throw new Error("not found");
      return r.json();
    }),
  });

  const ativo = ativoData;
  const linkedDeals = (ativoData?.linkedDeals || []) as any[];
  const emNegociacao = ativoData?.emNegociacao || false;

  const { data: matchesInternos = [], isLoading: matchesLoading } = useQuery({
    queryKey: ["/api/matching/assets", id, "suggestions"],
    queryFn: () =>
      apiRequest("GET", `/api/matching/assets/${id}/suggestions`)
        .then(r => r.json()),
  });

  const [abaAtiva, setAbaAtiva] = useState("info");
  const [buscandoCompradores, setBuscandoCompradores] = useState(false);
  const [compradores, setCompradores] = useState<any[]>([]);
  const [totalEncontrados, setTotalEncontrados] = useState<number | null>(null);
  const [buscaRealizada, setBuscaRealizada] = useState(false);
  const [primaryCount, setPrimaryCount] = useState(0);
  const [secondaryCount, setSecondaryCount] = useState(0);
  const [showFiltros, setShowFiltros] = useState(false);
  const [filtroPorte, setFiltroPorte] = useState("auto");
  const [filtroEstado, setFiltroEstado] = useState("auto");
  const [ocultarCrm, setOcultarCrm] = useState(false);

  const [enriquecendo, setEnriquecendo] = useState(false);
  const [enriquecendoCompleto, setEnriquecendoCompleto] = useState(false);
  const [certidoesLoading, setCertidoesLoading] = useState(false);
  const [certidoesData, setCertidoesData] = useState<any>(null);
  const [cnpjaData, setCnpjaData] = useState<any>(null);
  const [cnpjaLoading, setCnpjaLoading] = useState(false);
  const [cvmCnpjInput, setCvmCnpjInput] = useState("");
  const [cvmData, setCvmData] = useState<any>(null);
  const [cvmLoading, setCvmLoading] = useState(false);
  const [cvmError, setCvmError] = useState(false);
  const [sicorData, setSicorData] = useState<any>(null);
  const [sicorLoading, setSicorLoading] = useState(false);
  const [sicorFetched, setSicorFetched] = useState(false);
  const [cafProdutores, setCafProdutores] = useState<any[]>([]);
  const [cafLoading, setCafLoading] = useState(false);
  const [cafSearched, setCafSearched] = useState(false);
  const [cafLeadCreating, setCafLeadCreating] = useState<number | null>(null);

  const salvarEnrichment = async (key: string, value: any) => {
    if (!ativo) return;
    const campos = (ativo.camposEspecificos || {}) as any;
    await apiRequest("PATCH", `/api/matching/assets/${ativo.id}`, {
      camposEspecificos: { ...campos, [key]: value, [`${key}UpdatedAt`]: new Date().toISOString() },
    });
    queryClient.invalidateQueries({ queryKey: ["/api/matching/assets", id] });
  };

  useEffect(() => {
    if (!ativo) return;
    const campos = (ativo.camposEspecificos || {}) as any;
    if (campos.cnpjaData && !cnpjaData) setCnpjaData(campos.cnpjaData);
    if (campos.certidoesData && !certidoesData) setCertidoesData(campos.certidoesData);
    if (campos.cvmData && !cvmData) setCvmData(campos.cvmData);
    if (campos.sicorData && !sicorData && !sicorFetched) {
      setSicorData(campos.sicorData);
      setSicorFetched(true);
    }
    if (campos.cafProdutores?.length && cafProdutores.length === 0 && !cafSearched) {
      setCafProdutores(campos.cafProdutores);
      setCafSearched(true);
    }
  }, [ativo]);

  useEffect(() => {
    setSicorData(null);
    setSicorFetched(false);
    setSicorLoading(false);
    setCafProdutores([]);
    setCafSearched(false);
    setCafLoading(false);
    setCnpjaData(null);
    setCertidoesData(null);
    setCvmData(null);
  }, [id]);

  useEffect(() => {
    if (!ativo) return;
    const campos = (ativo.camposEspecificos || {}) as any;
    const codigoIbge = campos.codigoIbge;
    if (!codigoIbge || sicorData || sicorFetched) return;
    setSicorFetched(true);
    setSicorLoading(true);
    apiRequest("GET", `/api/norion/sicor/${codigoIbge}`)
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

  useEffect(() => {
    if (!ativo || !ativo.estado || cafSearched) return;
    setCafSearched(true);
    setCafLoading(true);
    const params = new URLSearchParams({ uf: ativo.estado, pageSize: "10" });
    if (ativo.municipio) params.set("busca", ativo.municipio);
    apiRequest("GET", `/api/caf-extrator/registros?${params}`)
      .then(async (res) => {
        if (res.ok) {
          const json = await res.json();
          const items = Array.isArray(json) ? json : json.data || [];
          setCafProdutores(items);
          if (items.length > 0) salvarEnrichment("cafProdutores", items);
        }
      })
      .catch(() => {})
      .finally(() => setCafLoading(false));
  }, [ativo, cafSearched]);

  const enriquecerMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/matching/assets/${id}/enriquecer-embrapa`, {}).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/matching/assets", id] });
      toast({ title: "✅ Dados Embrapa carregados!", description: "Análise agronômica atualizada." });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao buscar dados Embrapa", description: err.message, variant: "destructive" });
    },
    onSettled: () => setEnriquecendo(false),
  });

  const [geoAnalyzing, setGeoAnalyzing] = useState(false);
  const runGeoAnalysis = async () => {
    if (!ativo) return;
    setGeoAnalyzing(true);
    try {
      const geomRes = await apiRequest("GET", `/api/matching/assets/${ativo.id}/geometry`);
      if (!geomRes.ok) throw new Error("Falha ao buscar geometria");
      const geomData = await geomRes.json();
      if (!geomData.geometry) {
        toast({ title: "Sem geometria", description: "Este ativo não possui polígono geográfico para análise. Importe pelo Geo Rural primeiro.", variant: "destructive" });
        setGeoAnalyzing(false);
        return;
      }
      const analysisRes = await apiRequest("POST", "/api/geo/analisar", { geometry: geomData.geometry, areaHa: ativo.areaHa || 0 });
      if (!analysisRes.ok) throw new Error("Falha na análise geográfica");
      const analysis = await analysisRes.json();
      const persistRes = await apiRequest("POST", "/api/geo/persist-analysis", { assetId: ativo.id, analysis });
      if (!persistRes.ok) throw new Error("Falha ao salvar análise");
      queryClient.invalidateQueries({ queryKey: ["/api/matching/assets", id] });
      toast({ title: "Análise geográfica atualizada!" });
    } catch (err: any) {
      toast({ title: "Erro na análise geo", description: err.message, variant: "destructive" });
    }
    setGeoAnalyzing(false);
  };

  const handleDelete = async () => {
    await apiRequest("DELETE", `/api/matching/assets/${id}`);
    queryClient.invalidateQueries({ queryKey: ["/api/matching/assets"] });
    toast({ title: "Ativo excluído" });
    navigate("/ativos");
  };

  const buscarCompradores = async () => {
    if (!ativo) return;
    setBuscandoCompradores(true);
    try {
      const params = new URLSearchParams({ tipo: ativo.type });
      if (ativo.estado) params.set("estado", ativo.estado);
      if (ativo.priceAsking) params.set("preco", String(ativo.priceAsking));
      if (ativo.type === "MINA") {
        const campos = (ativo.camposEspecificos as any) || {};
        const attrs  = (ativo.attributesJson as any) || {};
        const sub = campos.substancia || attrs.anmSubstancia || campos.anmSubstancia;
        if (sub) params.set("substancia", sub);
      }
      if (filtroPorte  !== "auto") params.set("porteOverride",  filtroPorte);
      if (filtroEstado !== "auto") params.set("estadoOverride", filtroEstado);
      if (ocultarCrm)              params.set("ocultarCrm",     "true");
      const res = await apiRequest("GET", `/api/prospeccao/reversa?${params.toString()}`);
      const data = await res.json();
      setCompradores(data.results || []);
      setTotalEncontrados(data.count ?? null);
      setPrimaryCount(data.primaryCount ?? 0);
      setSecondaryCount(data.secondaryCount ?? 0);
      setBuscaRealizada(true);
    } catch {
      toast({ title: "Erro ao buscar compradores", variant: "destructive" });
    } finally {
      setBuscandoCompradores(false);
    }
  };

  const importarComprador = async (comprador: any) => {
    const cnpj = (comprador.taxId || "").replace(/\D/g, "");
    if (!cnpj || cnpj.length < 11) {
      toast({ title: "CNPJ inválido", description: "Não foi possível importar — CNPJ ausente ou inválido.", variant: "destructive" });
      return;
    }
    try {
      const res = await apiRequest("POST", `/api/matching/assets/${id}/importar-comprador`, {
        cnpj,
        tradeName: comprador.tradeName || undefined,
        legalName: comprador.legalName || undefined,
      });
      const data = await res.json();
      const nome = comprador.tradeName || comprador.legalName || "Empresa";
      setCompradores(prev => prev.map(c => c.taxId === comprador.taxId ? { ...c, alreadySaved: true } : c));
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/matching"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      toast({
        title: "Comprador importado com sucesso",
        description: (
          <div className="flex flex-col gap-1.5">
            <span>{nome} — Empresa, Lead e Deal criados no CRM</span>
            <a
              href="/crm?pipeline=ASSET"
              className="text-emerald-600 dark:text-emerald-400 underline text-sm font-medium"
              onClick={(e) => { e.preventDefault(); navigate("/crm?pipeline=ASSET"); }}
              data-testid="link-ver-crm"
            >
              Ver no CRM →
            </a>
          </div>
        ),
      });
    } catch {
      toast({ title: "Erro ao importar comprador", variant: "destructive" });
    }
  };

  const iniciarNegociacao = async (match: any) => {
    try {
      const stagesRes = await apiRequest("GET", "/api/crm/stages");
      const stages = await stagesRes.json();
      const assetStages = (stages as any[]).filter((s: any) => s.pipelineType === "ASSET").sort((a: any, b: any) => a.order - b.order);
      if (!assetStages.length) {
        toast({ title: "Nenhum estágio no pipeline ASSET", variant: "destructive" });
        return;
      }
      await apiRequest("POST", "/api/crm/deals", {
        title: `${match.investorName || "Investidor"} — ${ativo.title}`,
        pipelineType: "ASSET",
        stageId: assetStages[0].id,
        assetId: ativo.id,
        companyId: match.companyId || undefined,
        source: "matching",
        amountEstimate: ativo.priceAsking || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/matching/assets", id] });
      toast({ title: "Negociação iniciada", description: "Deal criado no pipeline ASSET" });
      navigate("/crm?pipeline=ASSET");
    } catch {
      toast({ title: "Erro ao iniciar negociação", variant: "destructive" });
    }
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
        <div className="flex gap-2">
          <Button
            variant="outline" size="sm"
            onClick={async () => {
              try {
                const res = await apiRequest("GET", `/api/matching/assets/${id}/showcase-check`);
                const check = await res.json();
                if (check.warnings?.length > 0) {
                  toast({
                    title: check.ready ? "Vitrine gerada com avisos" : "Dados insuficientes",
                    description: check.warnings.join(", "),
                    variant: check.ready ? "default" : "destructive",
                  });
                }
                const url = `${window.location.origin}/vitrine/${id}`;
                await navigator.clipboard.writeText(url);
                toast({ title: "Link copiado!", description: url });
              } catch { toast({ title: "Erro ao gerar link", variant: "destructive" }); }
            }}
            data-testid="button-gerar-vitrine"
          >
            <ExternalLink className="w-4 h-4 mr-1.5" /> Vitrine
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
                    {emNegociacao && (
                      <Badge className="bg-blue-600 text-white text-xs gap-1 animate-pulse" data-testid="badge-em-negociacao">
                        <Zap className="w-3 h-3" />
                        Em negociação
                      </Badge>
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

      {/* Tabs */}
      <Tabs value={abaAtiva} onValueChange={setAbaAtiva}>
        <div className="overflow-x-auto pb-0.5">
          <TabsList className="w-max min-w-full">
            {(ABAS_POR_TIPO[ativo.type] || ABAS_POR_TIPO["NEGOCIO"]).map(aba => (
              <TabsTrigger key={aba.id} value={aba.id} data-testid={`tab-${aba.id}`}>
                {aba.label}
                {aba.id === "matches" && (linkedDeals.length + matchesInternos.length) > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">{linkedDeals.length + matchesInternos.length}</Badge>
                )}
                {aba.id === "embrapa" && (ativo.camposEspecificos as any)?.embrapa && (
                  <span className="w-2 h-2 rounded-full bg-green-500 inline-block ml-1" />
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

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

          {((ativo.camposEspecificos as any)?.origemAtivo === "oferta_recebida" ||
            (ativo.camposEspecificos as any)?.origemAtivo === "indicacao") && (
            <Card className="border-amber-200 dark:border-amber-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-amber-600" />
                  {(ativo.camposEspecificos as any)?.origemAtivo === "oferta_recebida" ? "Ofertante — proprietário do ativo" : "Indicação"}
                  <Badge variant="outline" className="text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700 ml-auto">
                    Oferta recebida
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="Nome" value={(ativo.camposEspecificos as any)?.ofertanteNome} />
                <InfoRow label="Telefone" value={(ativo.camposEspecificos as any)?.ofertanteTelefone} />
                <InfoRow label="E-mail" value={(ativo.camposEspecificos as any)?.ofertanteEmail} />
                <InfoRow label="Observações" value={(ativo.camposEspecificos as any)?.ofertanteObservacoes} />
              </CardContent>
            </Card>
          )}

          {/* Fotos do Ativo */}
          <AssetPhotosSection ativo={ativo} assetId={Number(id)} />

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

        {/* ── Documentação Tab ── */}
        <TabsContent value="documentos" className="mt-4 space-y-4">

          {/* Status geral */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" /> Status da Documentação
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {docsStatus ? (
                  <>
                    <docsStatus.icon className={cn("w-5 h-5", docsStatus.color)} />
                    <span className={cn("font-medium text-sm", docsStatus.color)}>{docsStatus.label}</span>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">Status não informado</span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Checklist por tipo */}
          {(() => {
            const CHECKLIST: Record<string, Array<{ item: string; obrigatorio: boolean }>> = {
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
              FII_CRI: [
                { item: "Regulamento do fundo atualizado", obrigatorio: true },
                { item: "Registro CVM", obrigatorio: true },
                { item: "Último relatório gerencial", obrigatorio: true },
                { item: "Demonstrações financeiras auditadas", obrigatorio: true },
                { item: "Escritura de emissão (CRI)", obrigatorio: false },
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

            const checklist = CHECKLIST[ativo.type] || [];
            if (checklist.length === 0) return null;

            const camposEsp = (ativo.camposEspecificos as any) || {};
            const checkKey = `checklist_${ativo.type}`;
            const savedChecks: Record<string, boolean> = camposEsp[checkKey] || {};

            const obrigatorios = checklist.filter(c => c.obrigatorio);
            const opcionais = checklist.filter(c => !c.obrigatorio);
            const totalObrig = obrigatorios.length;
            const marcadosObrig = obrigatorios.filter(c => savedChecks[c.item]).length;
            const pct = totalObrig > 0 ? Math.round((marcadosObrig / totalObrig) * 100) : 0;

            return (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                      Checklist de Due Diligence
                    </CardTitle>
                    <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full",
                      pct === 100 ? "bg-green-100 text-green-700" :
                      pct >= 50 ? "bg-amber-100 text-amber-700" :
                      "bg-red-100 text-red-700"
                    )} data-testid="checklist-progress">
                      {marcadosObrig}/{totalObrig} obrigatórios
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full mt-2">
                    <div
                      className={cn("h-full rounded-full transition-all",
                        pct === 100 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500"
                      )}
                      style={{ width: `${pct}%` }}
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
            );
          })()}
        </TabsContent>

        {/* ── Matches Tab (Negociações + Prospecção Reversa) ── */}
        <TabsContent value="matches" className="mt-4 space-y-6">

          {/* Negociações abertas */}
          {linkedDeals.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Negociações abertas
                </h3>
                <Badge variant="secondary" className="text-xs">{linkedDeals.length}</Badge>
              </div>
              {linkedDeals.map((deal: any) => (
                <Card key={deal.id} className="border-blue-200 dark:border-blue-800">
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium text-sm">{deal.title}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {deal.stageName && (
                          <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                            {deal.stageName}
                          </Badge>
                        )}
                        {deal.amountEstimate && (
                          <span className="text-xs text-muted-foreground">
                            {formatBRL(Number(deal.amountEstimate))}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {deal.pipelineType === "INVESTOR" ? "Pipeline Investidor" : "Pipeline Ativo"}
                        </span>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="h-7 text-xs shrink-0"
                      onClick={() => navigate("/crm")}>
                      Ver no CRM
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Investidores compatíveis — matching engine */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Investidores compatíveis
              </h3>
              {matchesInternos.length > 0 && (
                <Badge variant="secondary" className="text-xs">{matchesInternos.length}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Gerados automaticamente pelo engine de matching com perfis cadastrados no sistema.
            </p>

            {matchesLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
              </div>
            )}

            {!matchesLoading && matchesInternos.length === 0 && (
              <Card>
                <CardContent className="p-6 text-center space-y-2">
                  <Zap className="w-8 h-8 mx-auto text-muted-foreground opacity-30" />
                  <p className="text-sm text-muted-foreground">Nenhum investidor compatível ainda.</p>
                </CardContent>
              </Card>
            )}

            {(matchesInternos as any[]).map((match: any) => (
              <Card key={match.id} className={cn(
                "border transition-colors",
                match.status === "accepted" ? "border-green-200 dark:border-green-800" :
                match.status === "dismissed" ? "border-muted opacity-60" :
                "hover:border-primary/30"
              )}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm">
                          {match.investorName || (match as any).reasonsJson?.compradorNome || (match.investorProfileId ? `Investidor #${match.investorProfileId}` : "Comprador Estratégico")}
                        </p>
                        {match.investorCnpj && (
                          <span className="text-xs font-mono text-muted-foreground">{match.investorCnpj}</span>
                        )}
                        {(match as any).tipo === "estrategico" && (
                          <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                            Estratégico
                          </Badge>
                        )}
                        {match.status === "accepted" && (
                          <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200">
                            Em negociação
                          </Badge>
                        )}
                        {match.status === "dismissed" && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">Descartado</Badge>
                        )}
                      </div>

                      {match.score != null && (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 bg-muted rounded-full overflow-hidden">
                            <div className={cn("h-full rounded-full",
                              match.score >= 70 ? "bg-green-500" :
                              match.score >= 40 ? "bg-amber-500" : "bg-red-400"
                            )} style={{ width: `${Math.min(match.score, 100)}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground">Score {match.score}</span>
                        </div>
                      )}

                      {Array.isArray(match.reasonsJson) && match.reasonsJson.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {(match.reasonsJson as string[]).slice(0, 3).map((r: string, i: number) => (
                            <span key={i} className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                              {r}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5 shrink-0">
                      {match.status === "new" && (
                        <Button size="sm" className="h-7 text-xs gap-1"
                          onClick={() => iniciarNegociacao(match)}>
                          <Handshake className="w-3 h-3" /> Iniciar negociação
                        </Button>
                      )}
                      {match.companyId && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs"
                          onClick={() => navigate(`/empresas/${match.companyId}`)}>
                          Ver empresa
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Prospecção reversa */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Prospecção reversa
              </h3>
              <Badge variant="outline" className="text-[10px]">CNPJA externo</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Empresas externas com perfil compatível. Ao importar, são vinculadas a este ativo.
            </p>
            <Card>
            <CardContent className="space-y-4 pt-4">
              <div className="space-y-2">
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                  onClick={() => setShowFiltros(f => !f)}
                  data-testid="button-toggle-filtros"
                >
                  <Filter className="w-3.5 h-3.5" />
                  Ajustar filtros
                  <ChevronRight className={cn("w-3 h-3 transition-transform", showFiltros && "rotate-90")} />
                </button>

                {showFiltros && (
                  <div className="flex flex-wrap gap-2 p-3 rounded-lg bg-muted/30 border">
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground font-medium uppercase">Porte mínimo</p>
                      <Select value={filtroPorte} onValueChange={setFiltroPorte}>
                        <SelectTrigger className="h-7 text-xs w-36" data-testid="select-porte">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Automático</SelectItem>
                          <SelectItem value="all">Todos os portes</SelectItem>
                          <SelectItem value="medio">Médio ou maior</SelectItem>
                          <SelectItem value="grande">Apenas grande</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground font-medium uppercase">Estado</p>
                      <Select value={filtroEstado} onValueChange={setFiltroEstado}>
                        <SelectTrigger className="h-7 text-xs w-40" data-testid="select-estado">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Automático</SelectItem>
                          <SelectItem value="all">Todo o Brasil</SelectItem>
                          {["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG",
                            "MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR",
                            "RS","SC","SE","SP","TO"].map(uf => (
                            <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1 flex flex-col justify-end">
                      <label className="flex items-center gap-2 cursor-pointer h-7">
                        <input
                          type="checkbox"
                          checked={ocultarCrm}
                          onChange={e => setOcultarCrm(e.target.checked)}
                          className="rounded border-muted-foreground/30 w-3.5 h-3.5"
                          data-testid="checkbox-ocultar-crm"
                        />
                        <span className="text-xs">Ocultar já no CRM</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {!buscaRealizada ? (
                <div className="text-center py-8 space-y-3">
                  <p className="text-sm text-muted-foreground">Nenhuma busca realizada ainda.</p>
                  <Button
                    onClick={buscarCompradores}
                    disabled={buscandoCompradores}
                    className="gap-2"
                    data-testid="button-buscar-compradores"
                  >
                    {buscandoCompradores
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Buscando...</>
                      : <><Search className="w-4 h-4" /> Buscar compradores compatíveis</>}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="space-y-0.5">
                      <p className="text-xs text-muted-foreground" data-testid="text-compradores-count">
                        {compradores.length} empresa{compradores.length !== 1 ? "s" : ""} encontrada{compradores.length !== 1 ? "s" : ""}
                      </p>
                      {(primaryCount > 0 || secondaryCount > 0) && (
                        <div className="flex gap-3 text-[11px]">
                          {primaryCount > 0 && (
                            <span className="flex items-center gap-1 text-green-700">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                              {primaryCount} compradores diretos
                            </span>
                          )}
                          {secondaryCount > 0 && (
                            <span className="flex items-center gap-1 text-blue-700">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                              {secondaryCount} fundos e tradings
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="outline" size="sm"
                      onClick={buscarCompradores}
                      disabled={buscandoCompradores}
                      className="h-7 text-xs gap-1"
                      data-testid="button-refazer-busca"
                    >
                      {buscandoCompradores ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Refazer
                    </Button>
                  </div>

                  {compradores.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      Nenhuma empresa encontrada. Tente ajustar os filtros.
                    </p>
                  ) : (
                    compradores.map(c => (
                      <div
                        key={c.taxId}
                        className="flex items-start justify-between gap-3 p-3 rounded-lg border hover:border-primary/30 transition-colors"
                        data-testid={`card-comprador-${c.taxId}`}
                      >
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-sm truncate">{c.tradeName || c.legalName}</p>
                            {c.alreadySaved && (
                              <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                                No CRM
                              </Badge>
                            )}
                            {c.camada === 1 && (
                              <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200">
                                Comprador direto
                              </Badge>
                            )}
                            {c.camada === 2 && (
                              <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                                Fundo / trading
                              </Badge>
                            )}
                            {c.camada === 3 && (
                              <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                                Relacionado
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground font-mono">{c.taxId}</p>
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                            {c.cnaePrincipal && <span className="truncate max-w-[200px]">{c.cnaePrincipal}</span>}
                            {(c.city || c.state) && (
                              <span className="flex items-center gap-1">
                                <MapPin className="w-3 h-3" />
                                {[c.city, c.state].filter(Boolean).join("/")}
                              </span>
                            )}
                            {c.porte && <span>{c.porte}</span>}
                          </div>
                        </div>
                        <div className="shrink-0">
                          {!c.alreadySaved ? (
                            <Button
                              size="sm" variant="outline" className="h-7 text-xs"
                              onClick={() => importarComprador(c)}
                              data-testid={`button-importar-${c.taxId}`}
                            >
                              Importar
                            </Button>
                          ) : (
                            <Button
                              size="sm" variant="ghost" className="h-7 text-xs text-primary"
                              onClick={() => navigate("/empresas")}
                              data-testid={`button-ver-crm-${c.taxId}`}
                            >
                              Ver no CRM
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          </div>
        </TabsContent>

        <TabsContent value="embrapa" className="mt-4 space-y-4">

            {(() => {
              const embrapa = (ativo.camposEspecificos as any)?.embrapa;
              const embrapaUpdatedAt = (ativo.camposEspecificos as any)?.embrapaUpdatedAt;

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
                          await apiRequest("POST", `/api/matching/assets/${id}/enriquecer-completo`, {});
                          queryClient.invalidateQueries({ queryKey: ["/api/matching/assets", id] });
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

                  {embrapa.solo && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <FlaskConical className="w-4 h-4 text-amber-600" />
                          Classificação do Solo
                          {embrapa.solo.fonte === "cache" && (
                            <Badge variant="outline" className="text-[10px] ml-auto">Cache</Badge>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                          <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
                            {embrapa.solo.classificacao}
                          </p>
                          {embrapa.solo.aptidao && (
                            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                              Aptidão: {embrapa.solo.aptidao}
                            </p>
                          )}
                          {embrapa.solo.textura && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Textura: {embrapa.solo.textura}
                            </p>
                          )}
                        </div>
                        {(embrapa.solo.ph != null || embrapa.solo.argila != null || embrapa.solo.carbonoOrganico != null) && (
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            {embrapa.solo.ph != null && (
                              <div className="p-2 rounded bg-muted/50 text-center">
                                <p className="text-xs text-muted-foreground">pH</p>
                                <p className="text-sm font-bold" data-testid="text-solo-ph">{embrapa.solo.ph}</p>
                              </div>
                            )}
                            {embrapa.solo.argila != null && (
                              <div className="p-2 rounded bg-muted/50 text-center">
                                <p className="text-xs text-muted-foreground">Argila</p>
                                <p className="text-sm font-bold" data-testid="text-solo-argila">{embrapa.solo.argila}%</p>
                              </div>
                            )}
                            {embrapa.solo.carbonoOrganico != null && (
                              <div className="p-2 rounded bg-muted/50 text-center">
                                <p className="text-xs text-muted-foreground">C. Orgânico</p>
                                <p className="text-sm font-bold" data-testid="text-solo-soc">{embrapa.solo.carbonoOrganico} g/kg</p>
                              </div>
                            )}
                            {embrapa.solo.areia != null && (
                              <div className="p-2 rounded bg-muted/50 text-center">
                                <p className="text-xs text-muted-foreground">Areia</p>
                                <p className="text-sm font-bold" data-testid="text-solo-areia">{embrapa.solo.areia}%</p>
                              </div>
                            )}
                          </div>
                        )}
                        {embrapa.solo.fonte && (
                          <p className="text-[10px] text-muted-foreground text-right mt-1">Fonte: {embrapa.solo.fonte}</p>
                        )}
                      </CardContent>
                    </Card>
                  )}

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
                          {embrapa.clima.fonte === "cache" && (
                            <Badge variant="outline" className="text-[10px] ml-auto">Cache</Badge>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {embrapa.clima.precipitacaoMedia > 0 && (
                          <div className="flex items-center justify-between p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Droplets className="w-3.5 h-3.5" /> Precipitação
                            </span>
                            <span className="text-sm font-bold text-blue-700">
                              {embrapa.clima.precipitacaoMedia} mm
                            </span>
                          </div>
                        )}
                        {embrapa.clima.temperaturaMedia > 0 && (
                          <div className="flex items-center justify-between p-2 rounded-lg bg-orange-50 dark:bg-orange-900/20">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Thermometer className="w-3.5 h-3.5" /> Temperatura média
                            </span>
                            <span className="text-sm font-bold text-orange-700">
                              {embrapa.clima.temperaturaMedia}°C
                            </span>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">{embrapa.clima.indiceSeca}</p>
                      </CardContent>
                    </Card>
                  )}

                </div>
                </>
              );
            })()}

            {(ativo.camposEspecificos as any)?.enriquecimentoCompleto?.ndviHD && (() => {
              const ndviHD = (ativo.camposEspecificos as any).enriquecimentoCompleto.ndviHD;
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

            {(ativo.camposEspecificos as any)?.enriquecimentoCompleto?.mapbiomas && (() => {
              const mb = (ativo.camposEspecificos as any).enriquecimentoCompleto.mapbiomas;
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

            {(ativo.camposEspecificos as any)?.enriquecimentoCompleto && (() => {
              const enc = (ativo.camposEspecificos as any).enriquecimentoCompleto;
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

            {!(ativo.camposEspecificos as any)?.latitude && (
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

        {/* ── Placeholder tabs (only rendered if present in ABAS_POR_TIPO for this type) ── */}
        {(ABAS_POR_TIPO[ativo.type] || ABAS_POR_TIPO["NEGOCIO"]).some(a => a.id === "geo") && (
          <TabsContent value="geo" className="mt-4 space-y-4">
            {(() => {
              const campos = (ativo.camposEspecificos || {}) as any;
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

                <AssetPolygonMap assetId={ativo.id} />

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
                            {ativo.geoTemRio ? "Tem rio" : "Sem rio"}
                          </Badge>
                        )}
                        {ativo.geoTemLago != null && (
                          <Badge className={ativo.geoTemLago ? "bg-green-100 text-green-700 border-green-200" : "bg-gray-100 text-gray-500 border-gray-200"} data-testid="badge-geo-lago">
                            {ativo.geoTemLago ? "Tem lago" : "Sem lago"}
                          </Badge>
                        )}
                        {ativo.geoTemEnergia != null && (
                          <Badge className={ativo.geoTemEnergia ? "bg-green-100 text-green-700 border-green-200" : "bg-gray-100 text-gray-500 border-gray-200"} data-testid="badge-geo-energia">
                            {ativo.geoTemEnergia ? "Energia disponível" : "Sem energia"}
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

                {carCode && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">SICAR</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {carDaysLeft != null && !isNaN(carDaysLeft) && carDaysLeft < 90 && carDaysLeft >= 0 && (
                        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 flex items-center gap-2" data-testid="banner-car-vence">
                          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                          <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">CAR vence em {carDaysLeft} dias</p>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-xs text-muted-foreground">Código CAR</p>
                          <p className="text-sm font-mono font-bold" data-testid="text-codigo-car">{carCode}</p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => window.open("https://www.car.gov.br/publico/imoveis/index", "_blank")} data-testid="button-validar-sicar">
                          Validar no SICAR
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
                </>
              );
            })()}
          </TabsContent>
        )}

        {(ABAS_POR_TIPO[ativo.type] || ABAS_POR_TIPO["NEGOCIO"]).some(a => a.id === "caf") && (
          <TabsContent value="caf" className="mt-4 space-y-4">
            {(() => {
              const campos = (ativo.camposEspecificos || {}) as any;
              const codigoIbge = campos.codigoIbge;
              const estado = ativo.estado;



              const criarLeadCaf = async (produtor: any, idx: number) => {
                setCafLeadCreating(idx);
                try {
                  await apiRequest("POST", "/api/sdr/leads", {
                    source: "caf_ativo",
                    notes: `Produtor CAF — próximo ao ativo ${ativo.title}. Nome: ${produtor.nomeTitular || produtor.nome || "N/A"}, Município: ${produtor.municipio || "N/A"}`
                  });
                  toast({ title: "Lead criado na fila SDR" });
                } catch {
                  toast({ title: "Erro ao criar lead", variant: "destructive" });
                }
                setCafLeadCreating(null);
              };

              return (
                <>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Crédito Rural na Região (SICOR/BCB)</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {!codigoIbge ? (
                      <p className="text-sm text-muted-foreground" data-testid="text-sicor-sem-ibge">
                        Informe o código IBGE do município nas Informações do ativo para ver dados de crédito rural da região
                      </p>
                    ) : (
                      <>
                        {sicorLoading && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="text-sicor-loading">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando dados SICOR...
                          </div>
                        )}
                        {!sicorLoading && !sicorData && (
                          <p className="text-sm text-muted-foreground" data-testid="text-sicor-sem-dados">
                            Nenhum dado SICOR encontrado para este município.
                          </p>
                        )}
                        {sicorData && (
                          <div className="grid grid-cols-2 gap-3">
                            {sicorData.totalContratos != null && (
                              <div className="p-3 rounded bg-muted/50 text-center">
                                <p className="text-xs text-muted-foreground">Contratos PRONAF</p>
                                <p className="text-lg font-bold" data-testid="text-sicor-contratos">
                                  {Number(sicorData.totalContratos).toLocaleString("pt-BR")}
                                </p>
                              </div>
                            )}
                            {sicorData.volumeTotal != null && (
                              <div className="p-3 rounded bg-muted/50 text-center">
                                <p className="text-xs text-muted-foreground">Volume Financiado</p>
                                <p className="text-lg font-bold" data-testid="text-sicor-volume">
                                  {formatBRL(sicorData.volumeTotal)}
                                </p>
                              </div>
                            )}
                            {sicorData.culturas?.length > 0 && (
                              <div className="p-3 rounded bg-muted/50 col-span-2">
                                <p className="text-xs text-muted-foreground mb-2">Principais culturas financiadas</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {sicorData.culturas.map((c: any, i: number) => (
                                    <Badge key={i} variant="outline" className="text-xs capitalize" data-testid={`badge-sicor-cultura-${i}`}>
                                      {typeof c === "string" ? c : c.nome || c.cultura}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Produtores CAF Próximos</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {!estado ? (
                      <p className="text-sm text-muted-foreground" data-testid="text-caf-sem-estado">
                        Preencha o estado do ativo para ver produtores rurais próximos
                      </p>
                    ) : (
                      <>
                        {cafLoading && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="text-caf-loading">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando produtores CAF...
                          </div>
                        )}
                        {!cafLoading && cafProdutores.length === 0 && cafSearched && (
                          <p className="text-sm text-muted-foreground" data-testid="text-caf-vazio">
                            Nenhum produtor CAF encontrado para esta região. Os dados são populados automaticamente ao importar ativos do Geo Rural.
                          </p>
                        )}
                        {cafProdutores.length > 0 && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b text-xs text-muted-foreground">
                                  <th className="text-left py-2 px-2 font-medium">Nome</th>
                                  <th className="text-left py-2 px-2 font-medium">Município</th>
                                  <th className="text-right py-2 px-2 font-medium">Área (ha)</th>
                                  <th className="text-left py-2 px-2 font-medium">Grupo PRONAF</th>
                                  <th className="text-right py-2 px-2 font-medium">Ações</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cafProdutores.map((p: any, i: number) => (
                                  <tr key={i} className="border-b last:border-0 hover:bg-muted/30" data-testid={`row-caf-produtor-${i}`}>
                                    <td className="py-2 px-2">{p.nomeTitular || p.nome || "\u2014"}</td>
                                    <td className="py-2 px-2">{p.municipio || "\u2014"}</td>
                                    <td className="py-2 px-2 text-right">{p.areaHa != null ? Number(p.areaHa).toLocaleString("pt-BR") : "\u2014"}</td>
                                    <td className="py-2 px-2">{p.enquadramentoPronaf || p.grupo || "\u2014"}</td>
                                    <td className="py-2 px-2 text-right">
                                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"
                                        disabled={cafLeadCreating === i}
                                        onClick={() => criarLeadCaf(p, i)}
                                        data-testid={`button-criar-lead-caf-${i}`}
                                      >
                                        {cafLeadCreating === i
                                          ? <Loader2 className="w-3 h-3 animate-spin" />
                                          : <Zap className="w-3 h-3" />}
                                        Criar Lead
                                      </Button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
                </>
              );
            })()}
          </TabsContent>
        )}

        {(ABAS_POR_TIPO[ativo.type] || ABAS_POR_TIPO["NEGOCIO"]).some(a => a.id === "anm") && (
          <TabsContent value="anm" className="mt-4 space-y-4">
            {(() => {
              const campos = (ativo.camposEspecificos || {}) as any;
              const attrs = (ativo.attributesJson || {}) as any;
              const processoAnm = campos.processoAnm || attrs.anmProcesso || ativo.anmProcesso;
              const substancia = campos.substancia || attrs.anmSubstancia;
              const faseAnm = campos.faseAnm || attrs.anmFase;
              const situacaoAnm = campos.situacaoAnm;
              const validadeAnm = campos.validadeAnm;
              const ultimoEventoAnm = campos.ultimoEventoAnm || attrs.anmUltEvento;

              const diasRestantesRaw = validadeAnm
                ? Math.floor((new Date(validadeAnm).getTime() - Date.now()) / 86400000)
                : null;
              const diasRestantes = diasRestantesRaw !== null && !isNaN(diasRestantesRaw) ? diasRestantesRaw : null;

              const gridItems = [
                { label: "Nº Processo", value: processoAnm },
                { label: "Substância", value: substancia },
                { label: "Fase", value: faseAnm },
                { label: "Situação", value: situacaoAnm },
                { label: "Validade", value: validadeAnm ? new Date(validadeAnm).toLocaleDateString("pt-BR") : null },
                { label: "Último evento", value: ultimoEventoAnm },
              ].filter(item => item.value);

              return (
                <>
                  {diasRestantes !== null && diasRestantes < 0 && (
                    <Card className="border-red-400 bg-red-100 dark:bg-red-900/30 dark:border-red-700">
                      <CardContent className="p-3 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
                        <p className="text-sm font-bold text-red-800 dark:text-red-300" data-testid="text-anm-alerta-validade">
                          Licença ANM expirada há {Math.abs(diasRestantes)} dias
                        </p>
                      </CardContent>
                    </Card>
                  )}

                  {diasRestantes !== null && diasRestantes >= 0 && diasRestantes <= 90 && (
                    <Card className="border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800">
                      <CardContent className="p-3 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                        <p className="text-sm font-medium text-red-700 dark:text-red-400" data-testid="text-anm-alerta-validade">
                          Licença ANM vence em {diasRestantes} dias
                        </p>
                      </CardContent>
                    </Card>
                  )}

                  {gridItems.length > 0 && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm">Dados do Processo ANM</CardTitle>
                      </CardHeader>
                      <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3">
                        {gridItems.map(item => (
                          <div key={item.label}>
                            <p className="text-xs text-muted-foreground">{item.label}</p>
                            <p className="text-sm font-medium mt-0.5" data-testid={`text-anm-${item.label.toLowerCase().replace(/[^a-z]/g, "-")}`}>
                              {item.value}
                            </p>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {!gridItems.length && (
                    <Card>
                      <CardContent className="flex items-center justify-center py-10">
                        <p className="text-sm text-muted-foreground">Nenhum dado ANM salvo neste ativo.</p>
                      </CardContent>
                    </Card>
                  )}
                </>
              );
            })()}

            <AnmLiveQuery
              processoAnm={(ativo.camposEspecificos as any)?.processoAnm || (ativo.attributesJson as any)?.anmProcesso || ativo.anmProcesso}
              savedData={(ativo.camposEspecificos as any)?.anmLiveData}
              onSave={(data) => salvarEnrichment("anmLiveData", data)}
            />
          </TabsContent>
        )}

        {(ABAS_POR_TIPO[ativo.type] || ABAS_POR_TIPO["NEGOCIO"]).some(a => a.id === "empresa") && (
          <TabsContent value="empresa" className="mt-4 space-y-4">
            {(() => {
              const campos = (ativo.camposEspecificos || {}) as any;
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
                await apiRequest("PATCH", `/api/matching/assets/${ativo.id}`, {
                  camposEspecificos: { ...campos, cnpj: clean },
                });
                queryClient.invalidateQueries({ queryKey: ["/api/matching/assets", id] });
                toast({ title: "CNPJ salvo!" });
              };

              const multiploNum = campos.multiplo ? parseFloat(String(campos.multiplo)) : NaN;
              const margemEbitda = campos.faturamentoAnual > 0 && campos.ebitda > 0
                ? (campos.ebitda / campos.faturamentoAnual * 100).toFixed(1) : null;
              const valuationImplicito = campos.ebitda > 0 && !isNaN(multiploNum) && multiploNum > 0
                ? campos.ebitda * multiploNum : null;

              return (
                <>
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
                    ) : (
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
                    )}
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
                            const res = await apiRequest("POST", `/api/companies/${ativo.linkedCompanyId}/certidoes`, {});
                            const data = await res.json();
                            setCertidoesData(data);
                            salvarEnrichment("certidoesData", data);
                          } catch {
                            toast({ title: "Erro ao consultar certidões", variant: "destructive" });
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
                        Vincule esta empresa ao CRM para consultar certidões.
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
                            : "bg-green-50 border-green-200"
                        )}>
                          {certidoesData.pgfn?.temDebitoAtivo
                            ? <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                            : <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />}
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
                    <Building2 className="w-3.5 h-3.5" /> Ver empresa no CRM
                  </Button>
                )}
                </>
              );
            })()}
          </TabsContent>
        )}

        {(ABAS_POR_TIPO[ativo.type] || ABAS_POR_TIPO["NEGOCIO"]).some(a => a.id === "cvm") && (
          <TabsContent value="cvm" className="mt-4 space-y-4">
            {(() => {
              const campos = (ativo.camposEspecificos || {}) as any;
              const hasIndicadores = campos.registroCvm || campos.gestora || campos.dy12m != null || campos.pvp != null;

              const consultarCvm = async () => {
                const raw = (cvmCnpjInput || campos.cnpj || "").replace(/\D/g, "");
                if (!raw) return;
                setCvmLoading(true);
                setCvmError(false);
                setCvmData(null);
                try {
                  const res = await apiRequest("GET", `/api/norion/fundo/${raw}`);
                  if (!res.ok) throw new Error();
                  const data = await res.json();
                  setCvmData(data);
                  salvarEnrichment("cvmData", data);
                } catch {
                  setCvmError(true);
                }
                setCvmLoading(false);
              };

              return (
                <>
                {hasIndicadores && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Indicadores</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-3">
                        {campos.registroCvm && (
                          <div className="p-2 rounded bg-muted/50">
                            <p className="text-xs text-muted-foreground">Registro CVM</p>
                            <p className="text-sm font-bold" data-testid="text-registro-cvm">{campos.registroCvm}</p>
                          </div>
                        )}
                        {campos.gestora && (
                          <div className="p-2 rounded bg-muted/50">
                            <p className="text-xs text-muted-foreground">Gestora</p>
                            <p className="text-sm font-bold" data-testid="text-gestora">{campos.gestora}</p>
                          </div>
                        )}
                        {campos.dy12m != null && (
                          <div className="p-2 rounded bg-muted/50">
                            <p className="text-xs text-muted-foreground">DY 12 meses</p>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-bold" data-testid="text-dy12m">{campos.dy12m}%</p>
                              <Badge className={
                                campos.dy12m > 9 ? "bg-green-100 text-green-700 border-green-200 text-xs" :
                                campos.dy12m >= 6 ? "bg-amber-100 text-amber-700 border-amber-200 text-xs" :
                                "bg-gray-100 text-gray-500 border-gray-200 text-xs"
                              }>
                                {campos.dy12m > 9 ? "Alto" : campos.dy12m >= 6 ? "Médio" : "Baixo"}
                              </Badge>
                            </div>
                          </div>
                        )}
                        {campos.pvp != null && (
                          <div className="p-2 rounded bg-muted/50">
                            <p className="text-xs text-muted-foreground">P/VP</p>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-bold" data-testid="text-pvp">{campos.pvp}</p>
                              <Badge className={
                                campos.pvp < 0.9 ? "bg-green-100 text-green-700 border-green-200 text-xs" :
                                campos.pvp <= 1.1 ? "bg-gray-100 text-gray-500 border-gray-200 text-xs" :
                                "bg-red-100 text-red-700 border-red-200 text-xs"
                              }>
                                {campos.pvp < 0.9 ? "Desconto" : campos.pvp <= 1.1 ? "Par" : "Prêmio"}
                              </Badge>
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Consulta CVM</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex gap-2">
                      <Input
                        placeholder="CNPJ do fundo"
                        value={cvmCnpjInput || campos.cnpj || ""}
                        onChange={(e) => setCvmCnpjInput(e.target.value)}
                        className="max-w-xs font-mono text-sm"
                        data-testid="input-cvm-cnpj"
                      />
                      <Button size="sm" variant="outline" className="gap-1.5 shrink-0"
                        disabled={cvmLoading}
                        onClick={consultarCvm}
                        data-testid="button-consultar-cvm"
                      >
                        {cvmLoading
                          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Consultando...</>
                          : <><Search className="w-3.5 h-3.5" /> Consultar CVM</>}
                      </Button>
                    </div>

                    {cvmError && (
                      <p className="text-sm text-red-600" data-testid="text-cvm-erro">Fundo não encontrado na CVM</p>
                    )}

                    {cvmData && (
                      <Card className="mt-3">
                        <CardContent className="p-4 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            {cvmData.nome && (
                              <div className="p-2 rounded bg-muted/50 col-span-2">
                                <p className="text-xs text-muted-foreground">Nome</p>
                                <p className="text-sm font-bold" data-testid="text-cvm-nome">{cvmData.nome}</p>
                              </div>
                            )}
                            {cvmData.tipo && (
                              <div className="p-2 rounded bg-muted/50">
                                <p className="text-xs text-muted-foreground">Tipo</p>
                                <p className="text-sm font-medium" data-testid="text-cvm-tipo">{cvmData.tipo}</p>
                              </div>
                            )}
                            {(cvmData.situacao || cvmData.situação) && (
                              <div className="p-2 rounded bg-muted/50">
                                <p className="text-xs text-muted-foreground">Situação</p>
                                <p className="text-sm font-medium" data-testid="text-cvm-situacao">{cvmData.situacao || cvmData.situação}</p>
                              </div>
                            )}
                            {cvmData.administrador && (
                              <div className="p-2 rounded bg-muted/50 col-span-2">
                                <p className="text-xs text-muted-foreground">Administrador</p>
                                <p className="text-sm font-medium" data-testid="text-cvm-admin">{cvmData.administrador}</p>
                              </div>
                            )}
                          </div>
                          {(cvmData.patrimonioLiquido != null || cvmData.cotistas != null) && (
                            <div className="grid grid-cols-2 gap-3 mt-2">
                              {cvmData.patrimonioLiquido != null && (
                                <div className="p-2 rounded bg-muted/50 text-center">
                                  <p className="text-xs text-muted-foreground">Patrimônio Líquido</p>
                                  <p className="text-sm font-bold" data-testid="text-cvm-pl">{formatBRL(cvmData.patrimonioLiquido)}</p>
                                </div>
                              )}
                              {cvmData.cotistas != null && (
                                <div className="p-2 rounded bg-muted/50 text-center">
                                  <p className="text-xs text-muted-foreground">Cotistas</p>
                                  <p className="text-sm font-bold" data-testid="text-cvm-cotistas">{Number(cvmData.cotistas).toLocaleString("pt-BR")}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </CardContent>
                </Card>
                </>
              );
            })()}
          </TabsContent>
        )}

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
          queryClient.invalidateQueries({ queryKey: ["/api/matching/assets", id] });
        }}
      />
    </div>
  );
}
