import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ClipboardCheck, Building2, Search, Filter, X, ExternalLink,
  Loader2, ChevronRight, User, Settings2, Briefcase, Clock, Target,
} from "lucide-react";

interface OnboardingEntry {
  id: number;
  companyId: number;
  companyName: string;
  cnpj: string | null;
  buyerType: string | null;
  origem: string;
  createdAt: string;
  progress: number;
  profile: any;
  companyPorte: string | null;
  companyCnae: string | null;
  companyCity: string | null;
  companyState: string | null;
}

const ORIGEM_LABELS: Record<string, string> = {
  match_reverso: "Match Reverso",
  cnpja: "Pesquisa CNPJ",
  manual: "Manual",
};

const ORIGEM_COLORS: Record<string, string> = {
  match_reverso: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  cnpja: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  manual: "bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-400",
};

const BUYER_TYPES = [
  { value: "estrategico", label: "Estrategico" },
  { value: "financeiro", label: "Financeiro" },
  { value: "institucional", label: "Institucional" },
  { value: "family_office", label: "Family Office" },
  { value: "fundo", label: "Fundo" },
];

const SETORES = [
  { value: "agro", label: "Agro" },
  { value: "mineracao", label: "Mineracao" },
  { value: "imobiliario", label: "Imobiliario" },
  { value: "industrial", label: "Industrial" },
  { value: "energia", label: "Energia" },
];

const FONTES_CAPITAL = [
  { value: "proprio", label: "Proprio" },
  { value: "financiado", label: "Financiado" },
  { value: "fundo", label: "Fundo" },
  { value: "misto", label: "Misto" },
];

const ESTRUTURAS = [
  { value: "SPE", label: "SPE" },
  { value: "holding", label: "Holding" },
  { value: "direta", label: "Direta" },
  { value: "consorcio", label: "Consorcio" },
];

const PERFIS_RISCO = [
  { value: "conservador", label: "Conservador" },
  { value: "moderado", label: "Moderado" },
  { value: "agressivo", label: "Agressivo" },
];

const ASSET_TYPE_OPTIONS = [
  "Fazenda", "Terreno", "Imovel Comercial", "Imovel Residencial",
  "Mineracao", "Industria", "Energia", "Credito", "Participacao Societaria",
];

function progressColor(p: number) {
  if (p >= 80) return "bg-emerald-500";
  if (p >= 50) return "bg-amber-500";
  return "bg-red-400";
}

export default function OnboardingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterOrigem, setFilterOrigem] = useState("all");
  const [filterBuyerType, setFilterBuyerType] = useState("all");
  const [filterProgress, setFilterProgress] = useState("all");
  const [selectedEntry, setSelectedEntry] = useState<OnboardingEntry | null>(null);
  const searchParams = useSearch();
  const empresaParam = new URLSearchParams(searchParams).get("empresa");

  const { data: entries, isLoading } = useQuery<OnboardingEntry[]>({
    queryKey: ["/api/crm/onboarding"],
  });

  useEffect(() => {
    if (empresaParam && entries?.length && !selectedEntry) {
      const target = entries.find(e => String(e.companyId) === empresaParam);
      if (target) setSelectedEntry(target);
    }
  }, [empresaParam, entries]);

  const filtered = (entries || []).filter(e => {
    if (search.trim()) {
      const q = search.toLowerCase();
      if (
        !e.companyName.toLowerCase().includes(q) &&
        !(e.cnpj?.includes(q))
      ) return false;
    }
    if (filterOrigem !== "all" && e.origem !== filterOrigem) return false;
    if (filterBuyerType !== "all" && e.buyerType !== filterBuyerType) return false;
    if (filterProgress === "low" && e.progress >= 50) return false;
    if (filterProgress === "mid" && (e.progress < 50 || e.progress >= 80)) return false;
    if (filterProgress === "high" && e.progress < 80) return false;
    return true;
  });

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-onboarding-title">
            <ClipboardCheck className="w-6 h-6" />
            Onboarding de Investidores
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Qualifique empresas importadas como potenciais compradores/investidores
          </p>
        </div>
        {entries && (
          <Badge variant="secondary" data-testid="text-onboarding-count">
            {entries.length} investidor{entries.length !== 1 ? "es" : ""}
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou CNPJ..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-onboarding-search"
            />
          </div>
          <Select value={filterOrigem} onValueChange={setFilterOrigem}>
            <SelectTrigger className="w-40" data-testid="select-filter-origem">
              <SelectValue placeholder="Origem" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas origens</SelectItem>
              <SelectItem value="match_reverso">Match Reverso</SelectItem>
              <SelectItem value="cnpja">Pesquisa CNPJ</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterBuyerType} onValueChange={setFilterBuyerType}>
            <SelectTrigger className="w-40" data-testid="select-filter-buyer-type">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos tipos</SelectItem>
              {BUYER_TYPES.map(bt => (
                <SelectItem key={bt.value} value={bt.value}>{bt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterProgress} onValueChange={setFilterProgress}>
            <SelectTrigger className="w-40" data-testid="select-filter-progress">
              <SelectValue placeholder="Progresso" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo progresso</SelectItem>
              <SelectItem value="low">Baixo (&lt;50%)</SelectItem>
              <SelectItem value="mid">Medio (50-79%)</SelectItem>
              <SelectItem value="high">Alto (80%+)</SelectItem>
            </SelectContent>
          </Select>
          {(search || filterOrigem !== "all" || filterBuyerType !== "all" || filterProgress !== "all") && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => { setSearch(""); setFilterOrigem("all"); setFilterBuyerType("all"); setFilterProgress("all"); }}
              data-testid="button-clear-onboarding-filters"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card>
          <CardContent className="pt-12 pb-12 text-center space-y-3">
            <ClipboardCheck className="w-10 h-10 mx-auto text-muted-foreground/30" />
            <p className="font-medium text-muted-foreground">
              {entries?.length === 0
                ? "Nenhum investidor em onboarding"
                : "Nenhum resultado para os filtros aplicados"}
            </p>
            <p className="text-sm text-muted-foreground">
              Importe empresas via <Link href="/matching" className="underline text-primary">Matching</Link> ou <Link href="/prospeccao" className="underline text-primary">Prospeccao</Link>.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && filtered.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Progresso</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(entry => (
                  <TableRow
                    key={entry.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedEntry(entry)}
                    data-testid={`row-onboarding-${entry.companyId}`}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="truncate max-w-[200px]">{entry.companyName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {entry.cnpj || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs" data-testid={`badge-buyer-type-${entry.companyId}`}>
                        {BUYER_TYPES.find(b => b.value === entry.buyerType)?.label || entry.buyerType || "-"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-xs ${ORIGEM_COLORS[entry.origem] || ORIGEM_COLORS.manual}`} data-testid={`badge-origem-${entry.companyId}`}>
                        {ORIGEM_LABELS[entry.origem] || entry.origem}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <Progress value={entry.progress} className="h-2 flex-1" />
                        <span className="text-xs font-medium text-muted-foreground w-10 text-right" data-testid={`text-progress-${entry.companyId}`}>
                          {entry.progress}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {entry.createdAt ? new Date(entry.createdAt).toLocaleDateString("pt-BR") : "-"}
                    </TableCell>
                    <TableCell>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {selectedEntry && (
        <OnboardingDetailDialog
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onUpdated={(updatedEntry) => {
            queryClient.invalidateQueries({ queryKey: ["/api/crm/onboarding"] });
            setSelectedEntry(updatedEntry);
          }}
        />
      )}
    </div>
  );
}

function OnboardingDetailDialog({
  entry,
  onClose,
  onUpdated,
}: {
  entry: OnboardingEntry;
  onClose: () => void;
  onUpdated: (e: OnboardingEntry) => void;
}) {
  const { toast } = useToast();
  const p = entry.profile || {};
  const prefs = (p.preferencesJson as any) || {};

  const [form, setForm] = useState({
    buyerType: p.buyerType || "",
    setorPrioritario: prefs.setorPrioritario || "",
    experienciaSetor: prefs.experienciaSetor || "",
    fonteCapital: prefs.fonteCapital || "",
    assetTypes: Array.isArray(p.assetTypes) ? p.assetTypes : [],
    regionsOfInterest: Array.isArray(p.regionsOfInterest) ? p.regionsOfInterest : [],
    ticketMin: p.ticketMin ?? "",
    ticketMax: p.ticketMax ?? "",
    capacidadeAquisicao: p.capacidadeAquisicao ?? "",
    estruturaSocietaria: prefs.estruturaSocietaria || "",
    aceitaPermuta: prefs.aceitaPermuta ?? false,
    perfilRisco: prefs.perfilRisco || "",
    restricoesAmbientais: prefs.restricoesAmbientais ?? false,
    dealsAnteriores: p.dealsAnteriores ?? false,
    volumeOperacoesAnual: prefs.volumeOperacoesAnual || "",
    cnaeInteresse: Array.isArray(p.cnaeInteresse) ? p.cnaeInteresse.join(", ") : "",
    prazoDecisao: p.prazoDecisao || "",
    observacoes: prefs.observacoes || "",
  });

  const [regionInput, setRegionInput] = useState("");

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/crm/onboarding/${entry.companyId}`, data);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Onboarding atualizado!" });
      onUpdated({
        ...entry,
        progress: data.progress,
        buyerType: form.buyerType,
        profile: data.profile,
      });
    },
    onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
  });

  const handleSave = () => {
    const payload: any = {
      buyerType: form.buyerType || undefined,
      setorPrioritario: form.setorPrioritario || undefined,
      experienciaSetor: form.experienciaSetor ? Number(form.experienciaSetor) : undefined,
      fonteCapital: form.fonteCapital || undefined,
      assetTypes: form.assetTypes.length > 0 ? form.assetTypes : undefined,
      regionsOfInterest: form.regionsOfInterest.length > 0 ? form.regionsOfInterest : undefined,
      ticketMin: form.ticketMin !== "" ? Number(form.ticketMin) : undefined,
      ticketMax: form.ticketMax !== "" ? Number(form.ticketMax) : undefined,
      capacidadeAquisicao: form.capacidadeAquisicao !== "" ? Number(form.capacidadeAquisicao) : undefined,
      estruturaSocietaria: form.estruturaSocietaria || undefined,
      aceitaPermuta: form.aceitaPermuta,
      perfilRisco: form.perfilRisco || undefined,
      restricoesAmbientais: form.restricoesAmbientais,
      dealsAnteriores: form.dealsAnteriores,
      volumeOperacoesAnual: form.volumeOperacoesAnual ? Number(form.volumeOperacoesAnual) : undefined,
      cnaeInteresse: form.cnaeInteresse ? form.cnaeInteresse.split(",").map((s: string) => s.trim()).filter(Boolean) : undefined,
      prazoDecisao: form.prazoDecisao || undefined,
      observacoes: form.observacoes || undefined,
    };
    updateMutation.mutate(payload);
  };

  const toggleAssetType = (t: string) => {
    setForm(prev => ({
      ...prev,
      assetTypes: prev.assetTypes.includes(t)
        ? prev.assetTypes.filter((x: string) => x !== t)
        : [...prev.assetTypes, t],
    }));
  };

  const addRegion = () => {
    const r = regionInput.trim();
    if (r && !form.regionsOfInterest.includes(r)) {
      setForm(prev => ({ ...prev, regionsOfInterest: [...prev.regionsOfInterest, r] }));
    }
    setRegionInput("");
  };

  const removeRegion = (r: string) => {
    setForm(prev => ({ ...prev, regionsOfInterest: prev.regionsOfInterest.filter((x: string) => x !== r) }));
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5" />
            Qualificacao — {entry.companyName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 flex-1">
            <Progress value={entry.progress} className="h-3 flex-1" />
            <span className="text-sm font-semibold" data-testid="text-detail-progress">{entry.progress}%</span>
          </div>
          <Link href={`/empresas/${entry.companyId}`}>
            <Button variant="outline" size="sm" className="gap-1.5" data-testid="button-ver-empresa">
              <ExternalLink className="w-3.5 h-3.5" />
              Ver Empresa
            </Button>
          </Link>
        </div>

        <Tabs defaultValue="perfil" className="w-full">
          <TabsList className="w-full justify-start flex-wrap gap-1">
            <TabsTrigger value="perfil" className="gap-1" data-testid="tab-perfil">
              <User className="w-3.5 h-3.5" /> Perfil
            </TabsTrigger>
            <TabsTrigger value="preferencias" className="gap-1" data-testid="tab-preferencias">
              <Target className="w-3.5 h-3.5" /> Preferencias
            </TabsTrigger>
            <TabsTrigger value="operacional" className="gap-1" data-testid="tab-operacional">
              <Settings2 className="w-3.5 h-3.5" /> Operacional
            </TabsTrigger>
            <TabsTrigger value="historico" className="gap-1" data-testid="tab-historico">
              <Briefcase className="w-3.5 h-3.5" /> Historico
            </TabsTrigger>
            <TabsTrigger value="decisao" className="gap-1" data-testid="tab-decisao">
              <Clock className="w-3.5 h-3.5" /> Decisao
            </TabsTrigger>
          </TabsList>

          <TabsContent value="perfil" className="space-y-4 pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo de Comprador</Label>
                <Select value={form.buyerType} onValueChange={v => setForm(f => ({ ...f, buyerType: v }))}>
                  <SelectTrigger data-testid="select-buyer-type">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {BUYER_TYPES.map(bt => (
                      <SelectItem key={bt.value} value={bt.value}>{bt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Setor Prioritario</Label>
                <Select value={form.setorPrioritario} onValueChange={v => setForm(f => ({ ...f, setorPrioritario: v }))}>
                  <SelectTrigger data-testid="select-setor-prioritario">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {SETORES.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Experiencia no Setor (anos)</Label>
                <Input
                  type="number"
                  value={form.experienciaSetor}
                  onChange={e => setForm(f => ({ ...f, experienciaSetor: e.target.value }))}
                  placeholder="Ex: 10"
                  data-testid="input-experiencia-setor"
                />
              </div>
              <div className="space-y-2">
                <Label>Fonte de Capital</Label>
                <Select value={form.fonteCapital} onValueChange={v => setForm(f => ({ ...f, fonteCapital: v }))}>
                  <SelectTrigger data-testid="select-fonte-capital">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {FONTES_CAPITAL.map(fc => (
                      <SelectItem key={fc.value} value={fc.value}>{fc.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="preferencias" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Tipos de Ativo de Interesse</Label>
              <div className="flex flex-wrap gap-2">
                {ASSET_TYPE_OPTIONS.map(at => (
                  <Badge
                    key={at}
                    variant={form.assetTypes.includes(at) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleAssetType(at)}
                    data-testid={`badge-asset-type-${at}`}
                  >
                    {at}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Regioes de Interesse</Label>
              <div className="flex gap-2">
                <Input
                  value={regionInput}
                  onChange={e => setRegionInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addRegion(); } }}
                  placeholder="Ex: Norte do MT"
                  data-testid="input-region"
                />
                <Button type="button" variant="outline" onClick={addRegion} data-testid="button-add-region">
                  Adicionar
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {form.regionsOfInterest.map((r: string) => (
                  <Badge key={r} variant="secondary" className="gap-1">
                    {r}
                    <button onClick={() => removeRegion(r)} className="ml-0.5" data-testid={`button-remove-region-${r}`}>
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Ticket Minimo (R$)</Label>
                <Input
                  type="number"
                  value={form.ticketMin}
                  onChange={e => setForm(f => ({ ...f, ticketMin: e.target.value }))}
                  placeholder="500000"
                  data-testid="input-ticket-min"
                />
              </div>
              <div className="space-y-2">
                <Label>Ticket Maximo (R$)</Label>
                <Input
                  type="number"
                  value={form.ticketMax}
                  onChange={e => setForm(f => ({ ...f, ticketMax: e.target.value }))}
                  placeholder="50000000"
                  data-testid="input-ticket-max"
                />
              </div>
              <div className="space-y-2">
                <Label>Capacidade Aquisicao (R$)</Label>
                <Input
                  type="number"
                  value={form.capacidadeAquisicao}
                  onChange={e => setForm(f => ({ ...f, capacidadeAquisicao: e.target.value }))}
                  placeholder="100000000"
                  data-testid="input-capacidade-aquisicao"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="operacional" className="space-y-4 pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Estrutura Societaria</Label>
                <Select value={form.estruturaSocietaria} onValueChange={v => setForm(f => ({ ...f, estruturaSocietaria: v }))}>
                  <SelectTrigger data-testid="select-estrutura-societaria">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ESTRUTURAS.map(e => (
                      <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Perfil de Risco</Label>
                <Select value={form.perfilRisco} onValueChange={v => setForm(f => ({ ...f, perfilRisco: v }))}>
                  <SelectTrigger data-testid="select-perfil-risco">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {PERFIS_RISCO.map(pr => (
                      <SelectItem key={pr.value} value={pr.value}>{pr.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <Label>Aceita Permuta</Label>
                <Switch
                  checked={form.aceitaPermuta}
                  onCheckedChange={v => setForm(f => ({ ...f, aceitaPermuta: v }))}
                  data-testid="switch-aceita-permuta"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label>Restricoes Ambientais</Label>
                <Switch
                  checked={form.restricoesAmbientais}
                  onCheckedChange={v => setForm(f => ({ ...f, restricoesAmbientais: v }))}
                  data-testid="switch-restricoes-ambientais"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="historico" className="space-y-4 pt-4">
            <div className="flex items-center justify-between gap-3">
              <Label>Possui Deals Anteriores</Label>
              <Switch
                checked={form.dealsAnteriores}
                onCheckedChange={v => setForm(f => ({ ...f, dealsAnteriores: v }))}
                data-testid="switch-deals-anteriores"
              />
            </div>
            <div className="space-y-2">
              <Label>Volume de Operacoes Anual (R$)</Label>
              <Input
                type="number"
                value={form.volumeOperacoesAnual}
                onChange={e => setForm(f => ({ ...f, volumeOperacoesAnual: e.target.value }))}
                placeholder="Ex: 50000000"
                data-testid="input-volume-operacoes"
              />
            </div>
            <div className="space-y-2">
              <Label>CNAEs de Interesse (separados por virgula)</Label>
              <Input
                value={form.cnaeInteresse}
                onChange={e => setForm(f => ({ ...f, cnaeInteresse: e.target.value }))}
                placeholder="Ex: 01.11-3, 07.10-3"
                data-testid="input-cnae-interesse"
              />
            </div>
          </TabsContent>

          <TabsContent value="decisao" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Prazo de Decisao</Label>
              <Select value={form.prazoDecisao} onValueChange={v => setForm(f => ({ ...f, prazoDecisao: v }))}>
                <SelectTrigger data-testid="select-prazo-decisao">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="imediato">Imediato</SelectItem>
                  <SelectItem value="30dias">30 dias</SelectItem>
                  <SelectItem value="60dias">60 dias</SelectItem>
                  <SelectItem value="90dias">90 dias</SelectItem>
                  <SelectItem value="6meses">6 meses</SelectItem>
                  <SelectItem value="1ano">1 ano</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Observacoes</Label>
              <Textarea
                value={form.observacoes}
                onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))}
                placeholder="Notas sobre o investidor..."
                rows={4}
                data-testid="textarea-observacoes"
              />
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-onboarding">
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            data-testid="button-save-onboarding"
          >
            {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
