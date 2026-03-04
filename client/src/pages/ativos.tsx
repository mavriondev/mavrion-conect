import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Search, MapPin, DollarSign, Ruler, Building2, Eye, Pencil,
  Trash2, Loader2, Filter, X, FileText, Layers, ChevronRight, TreePine,
  Pickaxe, Briefcase, Home, Wheat, Factory, Mountain, Download,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────
const TIPO_CONFIG: Record<string, { label: string; icon: any; color: string; badge: string }> = {
  TERRA:        { label: "Terra / Fazenda",       icon: TreePine,  color: "text-green-600",  badge: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  MINA:         { label: "Mineração",              icon: Pickaxe,   color: "text-orange-600", badge: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
  NEGOCIO:      { label: "Negócio / M&A",          icon: Briefcase, color: "text-blue-600",   badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  FII_CRI:      { label: "FII / CRI / Imóvel",    icon: Home,      color: "text-purple-600", badge: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" },
  DESENVOLVIMENTO: { label: "Desenvolvimento Imob.", icon: Factory, color: "text-pink-600",   badge: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300" },
  AGRO:         { label: "Agronegócio",            icon: Wheat,     color: "text-yellow-600", badge: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" },
};

const TIPOS_LIST = [
  { value: "all", label: "Todos os tipos" },
  ...Object.entries(TIPO_CONFIG).map(([value, cfg]) => ({ value, label: cfg.label })),
];

const ESTADOS_BR = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
  "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

const DOCS_STATUS_OPTIONS = [
  { value: "completo", label: "Documentação completa" },
  { value: "parcial", label: "Documentação parcial" },
  { value: "pendente", label: "Documentação pendente" },
];

// ── Create/Edit Form ────────────────────────────────────────────────────────
const EMPTY_FORM = {
  title: "", type: "TERRA", description: "", location: "", municipio: "",
  estado: "", priceAsking: "", areaHa: "", areaUtil: "", matricula: "",
  docsStatus: "", observacoes: "", linkedCompanyId: "",
};

export function AtivoFormDialog({
  open, onOpenChange, initial, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  initial?: any; onSaved: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!initial?.id;
  const [form, setForm] = useState(() =>
    initial
      ? {
          title: initial.title || "",
          type: initial.type || "TERRA",
          description: initial.description || "",
          location: initial.location || "",
          municipio: initial.municipio || "",
          estado: initial.estado || "",
          priceAsking: initial.priceAsking != null ? String(initial.priceAsking) : "",
          areaHa: initial.areaHa != null ? String(initial.areaHa) : "",
          areaUtil: initial.areaUtil != null ? String(initial.areaUtil) : "",
          matricula: initial.matricula || "",
          docsStatus: initial.docsStatus || "",
          observacoes: initial.observacoes || "",
          linkedCompanyId: initial.linkedCompanyId != null ? String(initial.linkedCompanyId) : "",
        }
      : { ...EMPTY_FORM }
  );

  const { data: companies = [] } = useQuery({
    queryKey: ["/api/crm/companies"],
    queryFn: () => apiRequest("GET", "/api/crm/companies").then(r => r.json()),
  });

  const importCompanyData = useCallback((companyId: string) => {
    if (!companyId || companyId === "none") return;
    const company = (companies as any[]).find(c => String(c.id) === companyId);
    if (!company) return;
    const addr = company.address || {};
    const uf = addr.uf || addr.estado || company.uf || "";
    const municipio = addr.municipio || addr.cidade || company.municipio || "";
    const locationStr = [municipio, uf].filter(Boolean).join("/");
    setForm(f => ({
      ...f,
      estado: uf || f.estado,
      municipio: municipio || f.municipio,
      location: locationStr || f.location,
      title: f.title || (company.tradeName || company.legalName
        ? `Ativo — ${company.tradeName || company.legalName}`
        : f.title),
    }));
    toast({
      title: "Dados importados",
      description: `Localização preenchida com dados de ${company.tradeName || company.legalName}`,
    });
  }, [companies, toast]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { toast({ title: "Título é obrigatório", variant: "destructive" }); return; }
    try {
      const payload: any = {
        title: form.title,
        type: form.type,
        description: form.description || null,
        location: form.location || null,
        municipio: form.municipio || null,
        estado: form.estado || null,
        priceAsking: form.priceAsking ? parseFloat(form.priceAsking) : null,
        areaHa: form.areaHa ? parseFloat(form.areaHa) : null,
        areaUtil: form.areaUtil ? parseFloat(form.areaUtil) : null,
        matricula: form.matricula || null,
        docsStatus: form.docsStatus || null,
        observacoes: form.observacoes || null,
        linkedCompanyId: (form.linkedCompanyId && form.linkedCompanyId !== "none")
          ? parseInt(form.linkedCompanyId) : null,
      };
      if (isEdit) {
        await apiRequest("PATCH", `/api/matching/assets/${initial.id}`, payload);
        toast({ title: "Ativo atualizado!" });
      } else {
        await apiRequest("POST", "/api/matching/assets", payload);
        toast({ title: "Ativo cadastrado!" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/matching/assets"] });
      onSaved();
      onOpenChange(false);
    } catch {
      toast({ title: "Erro ao salvar ativo", variant: "destructive" });
    }
  };

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Ativo" : "Cadastrar Novo Ativo"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-5 pt-2">
          {/* Tipo + Título */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tipo de ativo *</Label>
              <Select value={form.type} onValueChange={v => set("type", v)}>
                <SelectTrigger data-testid="select-tipo-ativo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TIPO_CONFIG).map(([k, cfg]) => (
                    <SelectItem key={k} value={k}>{cfg.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Título *</Label>
              <Input
                data-testid="input-titulo-ativo"
                value={form.title}
                onChange={e => set("title", e.target.value)}
                placeholder="ex: Fazenda Serra Verde — 500ha"
                required
              />
            </div>
          </div>

          {/* Localização */}
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-2 sm:col-span-1">
              <Label>Estado (UF)</Label>
              <Select value={form.estado || "none"} onValueChange={v => set("estado", v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="UF" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Selecionar...</SelectItem>
                  {ESTADOS_BR.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Município</Label>
              <Input value={form.municipio} onChange={e => set("municipio", e.target.value)} placeholder="ex: Sorriso" />
            </div>
            <div className="space-y-2">
              <Label>Localização / Região</Label>
              <Input value={form.location} onChange={e => set("location", e.target.value)} placeholder="ex: Norte de Mato Grosso" />
            </div>
          </div>

          {/* Áreas */}
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Área Total (ha)</Label>
              <Input type="number" step="0.01" value={form.areaHa} onChange={e => set("areaHa", e.target.value)} placeholder="1000" />
            </div>
            <div className="space-y-2">
              <Label>Área Útil (ha)</Label>
              <Input type="number" step="0.01" value={form.areaUtil} onChange={e => set("areaUtil", e.target.value)} placeholder="850" />
            </div>
            <div className="space-y-2">
              <Label>Preço Pedido (R$)</Label>
              <Input type="number" step="0.01" value={form.priceAsking} onChange={e => set("priceAsking", e.target.value)} placeholder="5000000" />
            </div>
          </div>

          {/* Matrícula + Docs */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Matrícula do Imóvel</Label>
              <Input value={form.matricula} onChange={e => set("matricula", e.target.value)} placeholder="ex: 12.345 — CRI de Sorriso/MT" />
            </div>
            <div className="space-y-2">
              <Label>Status da Documentação</Label>
              <Select value={form.docsStatus || "none"} onValueChange={v => set("docsStatus", v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Não informado</SelectItem>
                  {DOCS_STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Empresa vinculada */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Empresa vinculada (cedente/proprietário)</Label>
              {form.linkedCompanyId && form.linkedCompanyId !== "none" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs gap-1 text-primary border-primary/30"
                  onClick={() => importCompanyData(form.linkedCompanyId)}
                  data-testid="button-importar-empresa"
                >
                  <Building2 className="w-3 h-3" /> Importar localização
                </Button>
              )}
            </div>
            <Select
              value={form.linkedCompanyId || "none"}
              onValueChange={v => {
                set("linkedCompanyId", v === "none" ? "" : v);
                if (v && v !== "none" && !isEdit) {
                  setTimeout(() => importCompanyData(v), 50);
                }
              }}
            >
              <SelectTrigger data-testid="select-empresa-ativo">
                <SelectValue placeholder="Selecionar empresa (opcional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhuma</SelectItem>
                {(companies as any[]).map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.tradeName || c.legalName}
                    {c.cnpj ? ` — ${c.cnpj}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Ao selecionar uma empresa, os dados de localização serão preenchidos automaticamente.
            </p>
          </div>

          {/* Descrição */}
          <div className="space-y-2">
            <Label>Descrição</Label>
            <Textarea
              rows={2}
              value={form.description}
              onChange={e => set("description", e.target.value)}
              placeholder="Breve descrição do ativo..."
            />
          </div>

          {/* Observações */}
          <div className="space-y-2">
            <Label>Observações internas</Label>
            <Textarea
              rows={3}
              value={form.observacoes}
              onChange={e => set("observacoes", e.target.value)}
              placeholder="Notas internas, pendências, histórico de negociação..."
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" data-testid="button-salvar-ativo">
              {isEdit ? "Salvar alterações" : "Cadastrar ativo"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Asset Card ──────────────────────────────────────────────────────────────
function AtivoCard({ ativo, onEdit, onDelete }: { ativo: any; onEdit: () => void; onDelete: () => void }) {
  const tipo = TIPO_CONFIG[ativo.type] || TIPO_CONFIG.TERRA;
  const Icon = tipo.icon;

  return (
    <Card
      data-testid={`card-ativo-${ativo.id}`}
      className="hover:border-primary/30 hover:shadow-md transition-all group"
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-muted", tipo.color)}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold text-sm leading-tight truncate">{ativo.title}</h3>
                <Badge variant="outline" className={cn("text-xs mt-1 border-0 font-medium", tipo.badge)}>
                  {tipo.label}
                </Badge>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <Button
                  size="icon" variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-primary"
                  onClick={onEdit}
                  data-testid={`button-edit-ativo-${ativo.id}`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="icon" variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={onDelete}
                  data-testid={`button-delete-ativo-${ativo.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Location */}
            {(ativo.municipio || ativo.estado || ativo.location) && (
              <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="truncate">
                  {[ativo.municipio, ativo.estado].filter(Boolean).join("/") || ativo.location}
                </span>
              </div>
            )}

            {/* Metrics row */}
            <div className="flex flex-wrap gap-3 mt-2.5">
              {ativo.priceAsking && (
                <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full">
                  <DollarSign className="w-3 h-3" />
                  {ativo.priceAsking >= 1_000_000
                    ? `R$ ${(ativo.priceAsking / 1_000_000).toFixed(1)}M`
                    : `R$ ${(ativo.priceAsking / 1_000).toFixed(0)}k`}
                </span>
              )}
              {ativo.areaHa && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Ruler className="w-3 h-3" /> {Number(ativo.areaHa).toLocaleString("pt-BR")} ha
                </span>
              )}
              {ativo.matricula && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <FileText className="w-3 h-3" /> {ativo.matricula}
                </span>
              )}
            </div>

            {ativo.anmProcesso && (() => {
              const attrs = ativo.attributesJson as Record<string, any> | null;
              return (
                <div className="mt-2 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-900/10 p-2.5 space-y-1.5" data-testid={`anm-info-${ativo.id}`}>
                  <Link
                    href="/anm"
                    className="flex items-center gap-1.5 text-xs font-semibold text-orange-600 hover:text-orange-700"
                    data-testid={`badge-anm-${ativo.id}`}
                  >
                    <Mountain className="w-3.5 h-3.5 shrink-0" />
                    ANM: <span className="font-mono">{ativo.anmProcesso}</span>
                  </Link>
                  {attrs && (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      {attrs.anmFase && <p><span className="font-medium">Fase:</span> {attrs.anmFase}</p>}
                      {attrs.anmSubstancia && <p><span className="font-medium">Substância:</span> {attrs.anmSubstancia}</p>}
                      {attrs.anmNome && <p className="col-span-2 truncate"><span className="font-medium">Titular:</span> {attrs.anmNome}</p>}
                      {attrs.anmUltEvento && <p className="col-span-2 truncate"><span className="font-medium">Últ. Evento:</span> {attrs.anmUltEvento}</p>}
                    </div>
                  )}
                </div>
              );
            })()}

            {!ativo.anmProcesso && (() => {
              const attrs = ativo.attributesJson as Record<string, any> | null;
              if (!attrs?.carCodImovel) return null;
              return (
                <div className="mt-2 rounded-lg border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10 p-2.5 space-y-1.5" data-testid={`car-info-${ativo.id}`}>
                  <Link
                    href="/geo-rural"
                    className="flex items-center gap-1.5 text-xs font-semibold text-green-600 hover:text-green-700"
                    data-testid={`badge-car-${ativo.id}`}
                  >
                    <TreePine className="w-3.5 h-3.5 shrink-0" />
                    CAR: <span className="font-mono">{attrs.carCodImovel}</span>
                  </Link>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {attrs.carMunicipio && <p><span className="font-medium">Município:</span> {attrs.carMunicipio}</p>}
                    {attrs.geoScore != null && <p><span className="font-medium">Score:</span> {attrs.geoScore}/100</p>}
                    {attrs.geoTemRio && <p><span className="font-medium">Água:</span> ✓ Rio/Córrego</p>}
                    {attrs.geoTemEnergia && <p><span className="font-medium">Energia:</span> ✓ Próxima</p>}
                  </div>
                </div>
              );
            })()}

            {/* Company + Docs status */}
            <div className="flex items-center justify-between mt-2.5">
              {ativo.linkedCompany ? (
                <Link href={`/empresas/${ativo.linkedCompanyId}`}
                  className="flex items-center gap-1 text-xs text-primary hover:underline truncate max-w-[60%]">
                  <Building2 className="w-3 h-3 shrink-0" />
                  {ativo.linkedCompany.tradeName || ativo.linkedCompany.legalName}
                </Link>
              ) : <span />}
              {ativo.docsStatus && (
                <Badge variant="outline" className={cn(
                  "text-[10px] border-0",
                  ativo.docsStatus === "completo" ? "bg-green-100 text-green-700" :
                  ativo.docsStatus === "parcial" ? "bg-amber-100 text-amber-700" :
                  "bg-red-100 text-red-700"
                )}>
                  {DOCS_STATUS_OPTIONS.find(d => d.value === ativo.docsStatus)?.label || ativo.docsStatus}
                </Badge>
              )}
            </div>

            {/* View detail link */}
            <Link
              href={`/ativos/${ativo.id}`}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors mt-2"
            >
              Ver detalhes <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────
export default function AtivosPage({ filterType }: { filterType?: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ["/api/matching/assets"],
    queryFn: () => apiRequest("GET", "/api/matching/assets").then(r => r.json()),
  });

  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState(filterType || "all");

  useEffect(() => {
    setTipoFilter(filterType || "all");
  }, [filterType]);
  const [estadoFilter, setEstadoFilter] = useState("all");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [areaMin, setAreaMin] = useState("");
  const [areaMax, setAreaMax] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAtivo, setEditingAtivo] = useState<any>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    let list = assets as any[];
    if (tipoFilter && tipoFilter !== "all") {
      list = list.filter(a => a.type === tipoFilter);
    }
    if (estadoFilter && estadoFilter !== "all") {
      list = list.filter(a => a.estado === estadoFilter);
    }
    if (priceMin) list = list.filter(a => (a.priceAsking || 0) >= Number(priceMin));
    if (priceMax) list = list.filter(a => (a.priceAsking || 0) <= Number(priceMax));
    if (areaMin) list = list.filter(a => (a.areaHa || 0) >= Number(areaMin));
    if (areaMax) list = list.filter(a => (a.areaHa || 0) <= Number(areaMax));
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(a =>
        a.title?.toLowerCase().includes(s) ||
        a.municipio?.toLowerCase().includes(s) ||
        a.location?.toLowerCase().includes(s) ||
        a.matricula?.toLowerCase().includes(s) ||
        a.observacoes?.toLowerCase().includes(s) ||
        a.anmProcesso?.toLowerCase().includes(s)
      );
    }
    return list;
  }, [assets, tipoFilter, estadoFilter, search, priceMin, priceMax, areaMin, areaMax]);

  const handleDelete = async () => {
    if (!deletingId) return;
    await apiRequest("DELETE", `/api/matching/assets/${deletingId}`);
    queryClient.invalidateQueries({ queryKey: ["/api/matching/assets"] });
    setDeletingId(null);
    toast({ title: "Ativo excluído" });
  };

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: (assets as any[]).length };
    for (const a of assets as any[]) {
      counts[a.type] = (counts[a.type] || 0) + 1;
    }
    return counts;
  }, [assets]);

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Portfólio de Ativos</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Gerencie terras, minas, negócios e outros ativos do portfólio
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-export-ativos">
                <Download className="w-4 h-4 mr-1.5" /> Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => window.open("/api/export/assets?format=xlsx", "_blank")} data-testid="export-ativos-xlsx">
                Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open("/api/export/assets?format=csv", "_blank")} data-testid="export-ativos-csv">
                CSV (.csv)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => { setEditingAtivo(null); setCreateOpen(true); }} data-testid="button-novo-ativo">
            <Plus className="w-4 h-4 mr-1.5" /> Cadastrar Ativo
          </Button>
        </div>
      </div>

      {/* Type filter chips */}
      <div className="flex gap-2 flex-wrap">
        {TIPOS_LIST.map(t => {
          const cfg = t.value !== "all" ? TIPO_CONFIG[t.value] : null;
          const Icon = cfg?.icon;
          const active = tipoFilter === t.value;
          return (
            <button
              key={t.value}
              onClick={() => setTipoFilter(t.value)}
              data-testid={`filter-tipo-${t.value}`}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                active
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-background border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
            >
              {Icon && <Icon className="w-3.5 h-3.5" />}
              {t.label}
              {typeCounts[t.value] != null && (
                <span className={cn("ml-0.5 opacity-70", active && "opacity-90")}>
                  ({typeCounts[t.value] || 0})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por título, município, matrícula..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-busca-ativos"
          />
        </div>
        <Button
          variant="outline" size="sm"
          onClick={() => setShowFilters(f => !f)}
          className={cn("gap-2", showFilters && "border-primary text-primary")}
        >
          <Filter className="w-4 h-4" />
          Filtros
          {(estadoFilter !== "all" || priceMin || priceMax || areaMin || areaMax) && (
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
              {[estadoFilter !== "all", priceMin, priceMax, areaMin, areaMax].filter(Boolean).length}
            </Badge>
          )}
        </Button>
      </div>

      {showFilters && (
        <Card className="border-dashed">
          <CardContent className="pt-4 pb-4 space-y-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1.5 min-w-[140px]">
                <Label className="text-xs">Estado (UF)</Label>
                <Select value={estadoFilter} onValueChange={setEstadoFilter}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os estados</SelectItem>
                    {ESTADOS_BR.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1.5">
                <Label className="text-xs">Preço Mín. (R$)</Label>
                <Input
                  type="number"
                  placeholder="ex: 1000000"
                  value={priceMin}
                  onChange={e => setPriceMin(e.target.value)}
                  className="h-8 text-sm w-36"
                  data-testid="filter-price-min"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Preço Máx. (R$)</Label>
                <Input
                  type="number"
                  placeholder="ex: 50000000"
                  value={priceMax}
                  onChange={e => setPriceMax(e.target.value)}
                  className="h-8 text-sm w-36"
                  data-testid="filter-price-max"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Área Mín. (ha)</Label>
                <Input
                  type="number"
                  placeholder="ex: 100"
                  value={areaMin}
                  onChange={e => setAreaMin(e.target.value)}
                  className="h-8 text-sm w-28"
                  data-testid="filter-area-min"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Área Máx. (ha)</Label>
                <Input
                  type="number"
                  placeholder="ex: 5000"
                  value={areaMax}
                  onChange={e => setAreaMax(e.target.value)}
                  className="h-8 text-sm w-28"
                  data-testid="filter-area-max"
                />
              </div>
              <Button
                variant="ghost" size="sm"
                onClick={() => { setEstadoFilter("all"); setPriceMin(""); setPriceMax(""); setAreaMin(""); setAreaMax(""); }}
                className="text-muted-foreground"
              >
                <X className="w-3.5 h-3.5 mr-1" /> Limpar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
          <Layers className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
          <h3 className="font-semibold text-lg mb-1">
            {search || tipoFilter !== "all" || estadoFilter !== "all"
              ? "Nenhum ativo encontrado"
              : "Nenhum ativo cadastrado"}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {search || tipoFilter !== "all" || estadoFilter !== "all"
              ? "Tente ajustar os filtros de busca."
              : "Comece cadastrando o primeiro ativo do portfólio."}
          </p>
          {tipoFilter === "all" && !search && estadoFilter === "all" && (
            <Button onClick={() => { setEditingAtivo(null); setCreateOpen(true); }}>
              <Plus className="w-4 h-4 mr-1.5" /> Cadastrar Primeiro Ativo
            </Button>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {filtered.length} ativo{filtered.length !== 1 ? "s" : ""} encontrado{filtered.length !== 1 ? "s" : ""}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((ativo: any) => (
              <AtivoCard
                key={ativo.id}
                ativo={ativo}
                onEdit={() => { setEditingAtivo(ativo); setCreateOpen(true); }}
                onDelete={() => setDeletingId(ativo.id)}
              />
            ))}
          </div>
        </>
      )}

      {/* Create/Edit Dialog */}
      <AtivoFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initial={editingAtivo}
        onSaved={() => setEditingAtivo(null)}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingId} onOpenChange={o => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir ativo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O ativo será removido permanentemente do sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Sim, excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
