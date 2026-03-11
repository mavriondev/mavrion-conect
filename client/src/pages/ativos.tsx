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
  Pickaxe, Briefcase, Home, Wheat, Factory, Mountain, Download, AlertTriangle,
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


const ESTADOS_BR = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
  "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

const DOCS_STATUS_OPTIONS = [
  { value: "completo", label: "Documentação completa" },
  { value: "parcial", label: "Documentação parcial" },
  { value: "pendente", label: "Documentação pendente" },
];

const STATUS_ATIVO_OPTIONS = [
  { value: "rascunho",      label: "Rascunho" },
  { value: "em_validacao",  label: "Em validação" },
  { value: "ativo",         label: "Ativo" },
  { value: "em_negociacao", label: "Em negociação" },
  { value: "fechado",       label: "Fechado" },
  { value: "arquivado",     label: "Arquivado" },
];

const STATUS_BADGE_CONFIG: Record<string, { label: string; class: string }> = {
  rascunho:      { label: "Rascunho",      class: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" },
  em_validacao:  { label: "Em validação",  class: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  ativo:         { label: "Ativo",         class: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  em_negociacao: { label: "Em negociação", class: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  fechado:       { label: "Fechado",       class: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  arquivado:     { label: "Arquivado",     class: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" },
};

const ORIGEM_ATIVO_OPTIONS = [
  { value: "prospeccao_interna", label: "Prospecção interna (ANM, SICAR, CNPJA)" },
  { value: "oferta_recebida",    label: "Oferta recebida (proprietário entrou em contato)" },
  { value: "indicacao",          label: "Indicação de parceiro" },
  { value: "portal_publico",     label: "Portal público" },
];

const ORIGEM_BADGE_CONFIG: Record<string, { label: string; class: string }> = {
  oferta_recebida:     { label: "Oferta recebida", class: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  indicacao:           { label: "Indicação",        class: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  prospeccao_interna:  { label: "Prospecção",       class: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" },
  portal_publico:      { label: "Portal público",   class: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
};

const CAMPOS_ESPECIFICOS: Record<string, Array<{ key: string; label: string; placeholder: string; type?: string }>> = {
  MINA: [
    { key: "processoAnm",     label: "Nº Processo ANM",      placeholder: "ex: 800.123/2020" },
    { key: "substancia",      label: "Substância principal", placeholder: "ex: Ferro, Ouro, Calcário" },
    { key: "faseAnm",         label: "Fase do processo",     placeholder: "ex: Concessão de Lavra" },
    { key: "situacaoAnm",     label: "Situação jurídica",    placeholder: "ex: Ativo, Suspenso" },
    { key: "validadeAnm",     label: "Validade da licença",  placeholder: "ex: 2027-12-31", type: "date" },
    { key: "ultimoEventoAnm", label: "Último evento ANM",    placeholder: "ex: Relatório anual enviado" },
  ],
  TERRA: [
    { key: "codigoCar",          label: "Código CAR",           placeholder: "ex: MT-5107800-ABC123" },
    { key: "validadeCar",        label: "Validade do CAR",      placeholder: "ex: 2026-06-30", type: "date" },
    { key: "ccir",               label: "CCIR",                 placeholder: "Nº do CCIR" },
    { key: "itrEmDia",           label: "ITR em dia?",          placeholder: "Sim / Não / Pendente" },
    { key: "aptidaoAgricola",    label: "Aptidão agrícola",     placeholder: "ex: Soja, Milho, Pecuária" },
    { key: "certificacaoSigef",  label: "Certificação SIGEF",   placeholder: "ex: Certificado, Pendente" },
  ],
  AGRO: [
    { key: "codigoCar",             label: "Código CAR",           placeholder: "ex: MT-5107800-ABC123" },
    { key: "culturas",              label: "Culturas produzidas",  placeholder: "ex: Soja, Milho, Algodão" },
    { key: "capacidadeArmazenagem", label: "Armazenagem (ton)",    placeholder: "ex: 5000" },
    { key: "possuiSilos",           label: "Possui silos?",        placeholder: "Sim / Não" },
  ],
  FII_CRI: [
    { key: "registroCvm", label: "Registro CVM",    placeholder: "ex: FII 123.456/2020" },
    { key: "gestora",     label: "Gestora",          placeholder: "ex: XP Gestão" },
    { key: "dy12m",       label: "DY 12 meses (%)", placeholder: "ex: 8.5", type: "number" },
    { key: "pvp",         label: "P/VP",             placeholder: "ex: 0.95", type: "number" },
  ],
  DESENVOLVIMENTO: [
    { key: "alvara",         label: "Nº Alvará",           placeholder: "ex: 2024/1234" },
    { key: "validadeAlvara", label: "Validade Alvará",      placeholder: "ex: 2026-12-31", type: "date" },
    { key: "vgv",            label: "VGV estimado (R$)",    placeholder: "ex: 15000000", type: "number" },
    { key: "estagioObra",    label: "Estágio da obra",      placeholder: "ex: Terreno, 30%" },
  ],
  NEGOCIO: [
    { key: "cnpj",             label: "CNPJ da empresa",       placeholder: "ex: 00.000.000/0001-00" },
    { key: "faturamentoAnual", label: "Faturamento anual (R$)", placeholder: "ex: 5000000", type: "number" },
    { key: "ebitda",           label: "EBITDA (R$)",           placeholder: "ex: 800000", type: "number" },
    { key: "multiplo",         label: "Múltiplo pedido (x)",   placeholder: "ex: 6x EBITDA" },
    { key: "motivoVenda",      label: "Motivo da venda",       placeholder: "ex: Sucessão, Expansão" },
  ],
};

function verificarUrgenciaDocumental(ativo: any): { urgente: boolean; diasRestantes: number | null; campo: string } {
  const campos = (ativo.camposEspecificos as any) || {};
  const datas = [
    { key: "validadeCar",    label: "CAR" },
    { key: "validadeAnm",    label: "ANM" },
    { key: "validadeAlvara", label: "Alvará" },
  ];
  for (const { key, label } of datas) {
    if (campos[key]) {
      const dias = Math.floor((new Date(campos[key]).getTime() - Date.now()) / 86400000);
      if (dias <= 90) return { urgente: true, diasRestantes: dias, campo: label };
    }
  }
  return { urgente: false, diasRestantes: null, campo: "" };
}

function verificarExclusividade(ativo: any): { ativa: boolean; diasRestantes: number; empresa: string } {
  const campos = (ativo.camposEspecificos as any) || {};
  if (!campos.exclusividadeAte) return { ativa: false, diasRestantes: 0, empresa: "" };
  const dias = Math.floor((new Date(campos.exclusividadeAte).getTime() - Date.now()) / 86400000);
  return {
    ativa: dias >= 0,
    diasRestantes: dias,
    empresa: campos.exclusividadeEmpresa || "",
  };
}

// ── Create/Edit Form ────────────────────────────────────────────────────────
const EMPTY_FORM = {
  title: "", type: "TERRA", description: "", location: "", municipio: "",
  estado: "", priceAsking: "", areaHa: "", areaUtil: "", matricula: "",
  docsStatus: "", observacoes: "", linkedCompanyId: "",
  latitude: "", longitude: "", codigoIbge: "",
  statusAtivo: "ativo",
  origemAtivo: "prospeccao_interna",
  ofertanteNome: "",
  ofertanteTelefone: "",
  ofertanteEmail: "",
  ofertanteObservacoes: "",
  exclusividadeAte: "",
  exclusividadeEmpresa: "",
  camposEspecificos: {} as Record<string, string>,
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
          statusAtivo: initial.statusAtivo || "ativo",
          origemAtivo: (initial.camposEspecificos as any)?.origemAtivo || "prospeccao_interna",
          ofertanteNome: (initial.camposEspecificos as any)?.ofertanteNome || "",
          ofertanteTelefone: (initial.camposEspecificos as any)?.ofertanteTelefone || "",
          ofertanteEmail: (initial.camposEspecificos as any)?.ofertanteEmail || "",
          ofertanteObservacoes: (initial.camposEspecificos as any)?.ofertanteObservacoes || "",
          exclusividadeAte: (initial.camposEspecificos as any)?.exclusividadeAte || "",
          exclusividadeEmpresa: (initial.camposEspecificos as any)?.exclusividadeEmpresa || "",
          latitude: (initial.camposEspecificos as any)?.latitude != null
            ? String((initial.camposEspecificos as any).latitude) : "",
          longitude: (initial.camposEspecificos as any)?.longitude != null
            ? String((initial.camposEspecificos as any).longitude) : "",
          codigoIbge: (initial.camposEspecificos as any)?.codigoIbge || "",
          camposEspecificos: (initial.camposEspecificos as any) || {},
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
        statusAtivo: form.statusAtivo || "ativo",
        camposEspecificos: {
          ...(form.camposEspecificos as any || {}),
          origemAtivo: form.origemAtivo || "prospeccao_interna",
          ...(form.origemAtivo === "oferta_recebida" || form.origemAtivo === "indicacao" ? {
            ofertanteNome: form.ofertanteNome || null,
            ofertanteTelefone: form.ofertanteTelefone || null,
            ofertanteEmail: form.ofertanteEmail || null,
            ofertanteObservacoes: form.ofertanteObservacoes || null,
          } : {}),
          exclusividadeAte: form.exclusividadeAte || null,
          exclusividadeEmpresa: form.exclusividadeEmpresa || null,
          latitude:   form.latitude   ? parseFloat(form.latitude)  : null,
          longitude:  form.longitude  ? parseFloat(form.longitude) : null,
          codigoIbge: form.codigoIbge || null,
        },
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

          {(form.type === "TERRA" || form.type === "AGRO") && (
            <div className="space-y-3 p-4 rounded-lg border border-dashed border-green-300 bg-green-50/30 dark:bg-green-900/10">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-green-700 dark:text-green-400 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  Coordenadas GPS — habilita análise Embrapa
                </Label>
                {form.latitude && form.longitude && (
                  <a
                    href={`https://maps.google.com/?q=${form.latitude},${form.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                    data-testid="link-ver-mapa"
                  >
                    <MapPin className="w-3 h-3" /> Ver no mapa
                  </a>
                )}
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Latitude</Label>
                  <Input
                    type="number"
                    step="0.000001"
                    value={form.latitude}
                    onChange={e => set("latitude", e.target.value)}
                    placeholder="ex: -12.5431"
                    data-testid="input-latitude"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Longitude</Label>
                  <Input
                    type="number"
                    step="0.000001"
                    value={form.longitude}
                    onChange={e => set("longitude", e.target.value)}
                    placeholder="ex: -55.7213"
                    data-testid="input-longitude"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Código IBGE do município</Label>
                  <Input
                    value={form.codigoIbge}
                    onChange={e => set("codigoIbge", e.target.value)}
                    placeholder="ex: 5107925"
                    maxLength={7}
                    data-testid="input-codigo-ibge"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                💡 Informe as coordenadas do centro da propriedade. O código IBGE tem 7 dígitos —
                consulte em{" "}
                <a
                  href="https://www.ibge.gov.br/explica/codigos-dos-municipios.php"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  ibge.gov.br
                </a>
              </p>
            </div>
          )}

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

          {/* Status do ativo */}
          <div className="space-y-2">
            <Label>Status do ativo</Label>
            <Select value={form.statusAtivo || "ativo"} onValueChange={v => set("statusAtivo", v)}>
              <SelectTrigger data-testid="select-status-ativo"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_ATIVO_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Origem do ativo */}
          <div className="space-y-2">
            <Label>Origem do ativo</Label>
            <Select value={form.origemAtivo || "prospeccao_interna"} onValueChange={v => set("origemAtivo", v)}>
              <SelectTrigger data-testid="select-origem-ativo"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ORIGEM_ATIVO_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dados do ofertante */}
          {(form.origemAtivo === "oferta_recebida" || form.origemAtivo === "indicacao") && (
            <div className="space-y-3 p-4 rounded-lg border bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {form.origemAtivo === "oferta_recebida" ? "Dados do ofertante" : "Dados de quem indicou"}
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Nome completo</Label>
                  <Input data-testid="input-ofertante-nome" value={form.ofertanteNome} onChange={e => set("ofertanteNome", e.target.value)} placeholder="ex: João da Silva" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Telefone / WhatsApp</Label>
                  <Input data-testid="input-ofertante-telefone" value={form.ofertanteTelefone} onChange={e => set("ofertanteTelefone", e.target.value)} placeholder="ex: (65) 99999-0000" />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">E-mail</Label>
                <Input data-testid="input-ofertante-email" type="email" value={form.ofertanteEmail} onChange={e => set("ofertanteEmail", e.target.value)} placeholder="ex: joao@fazenda.com" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Observações sobre o contato</Label>
                <Textarea data-testid="input-ofertante-obs" rows={2} value={form.ofertanteObservacoes} onChange={e => set("ofertanteObservacoes", e.target.value)} placeholder="ex: Quer vender urgente, documentação em ordem..." />
              </div>
            </div>
          )}

          {/* Exclusividade */}
          <div className="space-y-3 p-4 rounded-lg border bg-red-50/40 dark:bg-red-900/10 border-red-200 dark:border-red-900">
            <p className="text-sm font-medium text-red-800 dark:text-red-300 flex items-center gap-2">
              🔒 Exclusividade
            </p>
            <p className="text-xs text-red-700 dark:text-red-400">
              Se preenchido, este ativo fica bloqueado para novo matching até a data informada.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Exclusivo até</Label>
                <Input
                  type="date"
                  value={form.exclusividadeAte || ""}
                  onChange={e => set("exclusividadeAte", e.target.value)}
                  data-testid="input-exclusividade-ate"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Empresa com exclusividade</Label>
                <Input
                  value={form.exclusividadeEmpresa || ""}
                  onChange={e => set("exclusividadeEmpresa", e.target.value)}
                  placeholder="ex: Fundo XP Agro"
                  data-testid="input-exclusividade-empresa"
                />
              </div>
            </div>
          </div>

          {/* Campos específicos por tipo */}
          {CAMPOS_ESPECIFICOS[form.type] && (
            <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
              <p className="text-sm font-medium text-muted-foreground">
                Dados específicos — {TIPO_CONFIG[form.type]?.label}
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                {CAMPOS_ESPECIFICOS[form.type].map(campo => (
                  <div key={campo.key} className="space-y-2">
                    <Label className="text-xs">{campo.label}</Label>
                    <Input
                      data-testid={`input-campo-${campo.key}`}
                      type={campo.type || "text"}
                      value={(form.camposEspecificos as any)?.[campo.key] || ""}
                      onChange={e => setForm(f => ({
                        ...f,
                        camposEspecificos: { ...(f.camposEspecificos as any), [campo.key]: e.target.value },
                      }))}
                      placeholder={campo.placeholder}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

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
  const [, navigate] = useLocation();
  const tipo = TIPO_CONFIG[ativo.type] || TIPO_CONFIG.TERRA;
  const Icon = tipo.icon;

  return (
    <Card
      data-testid={`card-ativo-${ativo.id}`}
      className="hover:border-primary/30 hover:shadow-md transition-all group cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
      tabIndex={0}
      role="link"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a, [role='menuitem']")) return;
        navigate(`/ativos/${ativo.id}`);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(`/ativos/${ativo.id}`);
        }
      }}
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
                {ativo.type === "MINA" && (ativo.attributesJson as any)?.anmNome && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5" data-testid={`text-titular-${ativo.id}`}>{(ativo.attributesJson as any).anmNome}</p>
                )}
                <Badge variant="outline" className={cn("text-xs mt-1 border-0 font-medium", tipo.badge)}>
                  {tipo.label}
                </Badge>
                {ativo.statusAtivo && ativo.statusAtivo !== "ativo" && (
                  <Badge variant="outline" className={cn("text-xs mt-1 border-0 font-medium", STATUS_BADGE_CONFIG[ativo.statusAtivo]?.class)} data-testid={`badge-status-${ativo.id}`}>
                    {STATUS_BADGE_CONFIG[ativo.statusAtivo]?.label}
                  </Badge>
                )}
                {(() => {
                  const u = verificarUrgenciaDocumental(ativo);
                  if (!u.urgente) return null;
                  return (
                    <Badge variant="outline" className="text-xs mt-1 border-0 font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" data-testid={`badge-urgencia-${ativo.id}`}>
                      <AlertTriangle className="w-3 h-3 mr-1 inline" /> {u.campo} vence em {u.diasRestantes}d
                    </Badge>
                  );
                })()}
                {(() => {
                  const origem = (ativo.camposEspecificos as any)?.origemAtivo;
                  if (!origem || origem === "prospeccao_interna") return null;
                  const cfg = ORIGEM_BADGE_CONFIG[origem];
                  if (!cfg) return null;
                  return (
                    <Badge variant="outline" className={cn("text-xs mt-1 border-0 font-medium", cfg.class)} data-testid={`badge-origem-${ativo.id}`}>
                      {cfg.label}
                    </Badge>
                  );
                })()}
                {(() => {
                  const excl = verificarExclusividade(ativo);
                  if (!excl.ativa) return null;
                  return (
                    <Badge variant="outline" className="text-xs mt-1 border-0 font-medium bg-red-100 text-red-700" data-testid={`badge-exclusividade-${ativo.id}`}>
                      🔒 Exclusivo {excl.empresa ? `— ${excl.empresa}` : ""} por {excl.diasRestantes}d
                    </Badge>
                  );
                })()}
              </div>
              <div className="shrink-0" />
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
              const carCode = attrs?.carCodImovel || (ativo as any).carCodImovel;
              if (!carCode) return null;
              const geoScore = attrs?.geoScore ?? (ativo as any).geoScore;
              const geoTemRio = attrs?.geoTemRio ?? (ativo as any).geoTemRio;
              const geoTemEnergia = attrs?.geoTemEnergia ?? (ativo as any).geoTemEnergia;
              const carMunicipio = attrs?.carMunicipio || ativo.municipio;
              return (
                <div className="mt-2 rounded-lg border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10 p-2.5 space-y-1.5 overflow-hidden" data-testid={`car-info-${ativo.id}`}>
                  <Link
                    href="/geo-rural"
                    className="flex items-center gap-1.5 text-xs font-semibold text-green-600 hover:text-green-700"
                    data-testid={`badge-car-${ativo.id}`}
                  >
                    <TreePine className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate min-w-0">CAR: <span className="font-mono">{carCode}</span></span>
                  </Link>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {carMunicipio && <p><span className="font-medium">Município:</span> {carMunicipio}</p>}
                    {geoScore != null && <p><span className="font-medium">Score:</span> {geoScore}/100</p>}
                    {geoTemRio && <p><span className="font-medium">Água:</span> ✓ Rio/Córrego</p>}
                    {geoTemEnergia && <p><span className="font-medium">Energia:</span> ✓ Próxima</p>}
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

            {/* View detail button */}
            <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-border/50">
              <Button variant="secondary" size="sm" asChild data-testid={`button-ver-detalhes-${ativo.id}`}>
                <Link href={`/ativos/${ativo.id}`}>
                  <Eye className="w-3.5 h-3.5 mr-1.5" />
                  Ver detalhes
                </Link>
              </Button>
              <div className="flex gap-1">
                <Button
                  size="icon" variant="ghost"
                  onClick={onEdit}
                  data-testid={`button-edit-ativo-card-${ativo.id}`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="icon" variant="ghost"
                  onClick={onDelete}
                  data-testid={`button-delete-ativo-card-${ativo.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
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
