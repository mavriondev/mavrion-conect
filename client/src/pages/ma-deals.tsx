import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Search, Loader2, Building2, MapPin, Briefcase, Filter, X,
  TrendingUp, Target, ArrowRight, Sparkles, Globe, Factory,
  Wheat, Milk, Zap, Truck, ShoppingCart, Cpu, Heart, Pickaxe,
  ChevronDown, ChevronRight, Download, Check, Phone, Mail,
  DollarSign, Calendar, Users, Star, PlayCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ESTADOS = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
  "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

const PORTE_OPTIONS = [
  { id: "1", label: "MEI" },
  { id: "3", label: "ME (Micro)" },
  { id: "5", label: "EPP (Pequena)" },
  { id: "9", label: "Demais (Médias/Grandes)" },
];

const MA_SECTORS = [
  {
    id: "laticinios",
    label: "Laticínios",
    icon: Milk,
    color: "from-blue-500 to-blue-700",
    bgLight: "bg-blue-50 border-blue-200 text-blue-700",
    description: "Indústria de laticínios: leite, queijo, manteiga, iogurte",
    cnaes: [1051100, 1052000, 1053800],
    cnaeLabels: ["Preparação do leite", "Fabricação de laticínios", "Fabricação de sorvetes"],
    size: "9",
    equityMin: "1000000",
  },
  {
    id: "agro",
    label: "Agronegócio",
    icon: Wheat,
    color: "from-green-500 to-green-700",
    bgLight: "bg-green-50 border-green-200 text-green-700",
    description: "Grandes propriedades rurais, produção agrícola, pecuária",
    cnaes: [151201, 151202, 155501, 156901, 115600, 113000],
    cnaeLabels: ["Bovinos corte/leite", "Suínos", "Aves", "Soja", "Cana"],
    size: "9",
    equityMin: "5000000",
  },
  {
    id: "mineracao",
    label: "Mineração",
    icon: Pickaxe,
    color: "from-amber-500 to-amber-700",
    bgLight: "bg-amber-50 border-amber-200 text-amber-700",
    description: "Extração mineral: ouro, ferro, calcário, granito",
    cnaes: [710301, 723303, 812200, 810002, 891600],
    cnaeLabels: ["Ferro", "Ouro", "Calcário", "Granito", "Fertilizantes"],
    size: "9",
    equityMin: "2000000",
  },
  {
    id: "alimentos",
    label: "Alimentos & Bebidas",
    icon: ShoppingCart,
    color: "from-orange-500 to-orange-700",
    bgLight: "bg-orange-50 border-orange-200 text-orange-700",
    description: "Fabricação de alimentos processados, frigoríficos, bebidas",
    cnaes: [1011201, 1012101, 1061901, 1064300, 1094500],
    cnaeLabels: ["Abate bovinos", "Abate aves", "Arroz", "Trigo", "Rações"],
    size: "9",
    equityMin: "1000000",
  },
  {
    id: "energia",
    label: "Energia & Utilities",
    icon: Zap,
    color: "from-yellow-500 to-yellow-700",
    bgLight: "bg-yellow-50 border-yellow-200 text-yellow-700",
    description: "Geração, transmissão e distribuição de energia elétrica",
    cnaes: [3511501, 3512300, 3513100, 3514000],
    cnaeLabels: ["Geração hidrelétrica", "Geração térmica", "Geração eólica", "Geração solar"],
    size: "9",
    equityMin: "10000000",
  },
  {
    id: "logistica",
    label: "Logística & Transporte",
    icon: Truck,
    color: "from-indigo-500 to-indigo-700",
    bgLight: "bg-indigo-50 border-indigo-200 text-indigo-700",
    description: "Transportadoras, armazéns, operadores logísticos",
    cnaes: [4930202, 4911600, 4912403, 5211701, 5212500],
    cnaeLabels: ["Transporte rodoviário", "Ferroviário", "Metroviário", "Armazéns", "Carga/descarga"],
    size: "9",
    equityMin: "2000000",
  },
  {
    id: "tecnologia",
    label: "Tecnologia",
    icon: Cpu,
    color: "from-purple-500 to-purple-700",
    bgLight: "bg-purple-50 border-purple-200 text-purple-700",
    description: "Software, SaaS, fintechs, consultorias de TI",
    cnaes: [6201501, 6202300, 6203100, 6204000, 6311900],
    cnaeLabels: ["Desenv. software", "Consultoria TI", "Suporte técnico", "Processamento dados", "Portais"],
    size: "5,9",
    equityMin: "500000",
  },
  {
    id: "saude",
    label: "Saúde",
    icon: Heart,
    color: "from-red-500 to-red-700",
    bgLight: "bg-red-50 border-red-200 text-red-700",
    description: "Hospitais, clínicas, laboratórios, farmácias",
    cnaes: [8610101, 8630503, 8640202, 4771701, 2121101],
    cnaeLabels: ["Hospitais", "Clínicas", "Laboratórios", "Farmácias", "Medicamentos"],
    size: "9",
    equityMin: "2000000",
  },
  {
    id: "imobiliario",
    label: "Imobiliário",
    icon: Building2,
    color: "from-teal-500 to-teal-700",
    bgLight: "bg-teal-50 border-teal-200 text-teal-700",
    description: "Incorporadoras, construtoras, administradoras de imóveis",
    cnaes: [4110700, 4120400, 6810201, 6810202, 6821801],
    cnaeLabels: ["Incorporação", "Construção", "Compra/venda", "Aluguel", "Administração"],
    size: "9",
    equityMin: "5000000",
  },
];

interface SearchResult {
  taxId: string;
  legalName: string;
  tradeName: string | null;
  status: string | null;
  statusId: number | null;
  porte: string | null;
  cnaePrincipal: string | null;
  cnaeCode: number | null;
  city: string | null;
  state: string | null;
  founded: string | null;
  alreadySaved: boolean;
  alreadyAsset?: boolean;
}

interface SearchState {
  sectorId: string;
  cnaes: string;
  states: string[];
  equityMin: string;
  equityMax: string;
  size: string;
  hasPhone: boolean;
  hasEmail: boolean;
  headOnly: boolean;
}

const defaultSearch: SearchState = {
  sectorId: "",
  cnaes: "",
  states: [],
  equityMin: "",
  equityMax: "",
  size: "",
  hasPhone: true,
  hasEmail: false,
  headOnly: true,
};

function formatCnpj(taxId: string) {
  const c = taxId.replace(/\D/g, "").padStart(14, "0");
  return `${c.slice(0,2)}.${c.slice(2,5)}.${c.slice(5,8)}/${c.slice(8,12)}-${c.slice(12)}`;
}

function formatEquity(v: string) {
  const n = Number(v);
  if (!n) return "";
  if (n >= 1e9) return `R$ ${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `R$ ${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `R$ ${(n / 1e3).toFixed(0)}K`;
  return `R$ ${n.toLocaleString("pt-BR")}`;
}

export function MADealsContent() {
  return <MADealsInner embedded />;
}

export default function MADealsPage() {
  return <MADealsInner embedded={false} />;
}

function MADealsInner({ embedded = false }: { embedded?: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const [search, setSearch] = useState<SearchState>(defaultSearch);
  const [activeSearch, setActiveSearch] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [resultCount, setResultCount] = useState(0);
  const [selectedSector, setSelectedSector] = useState<typeof MA_SECTORS[0] | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const [dealDialog, setDealDialog] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<SearchResult | null>(null);
  const [dealTitle, setDealTitle] = useState("");
  const [dealAmount, setDealAmount] = useState("");
  const [dealDescription, setDealDescription] = useState("");
  const [dealStage, setDealStage] = useState("");
  const [importing, setImporting] = useState(false);
  const [savingTaxId, setSavingTaxId] = useState<string | null>(null);

  const { data: stages = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/stages"],
  });
  const investorStages = useMemo(() => (stages as any[]).filter((s: any) => s.pipelineType === "INVESTOR"), [stages]);

  const { data: existingDeals = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/deals"],
  });

  const applySector = (sector: typeof MA_SECTORS[0]) => {
    setSelectedSector(sector);
    setSearch({
      ...defaultSearch,
      sectorId: sector.id,
      cnaes: sector.cnaes.join(","),
      size: sector.size || "9",
      equityMin: sector.equityMin || "",
      hasPhone: true,
      headOnly: true,
    });
    setShowFilters(true);
  };

  const executeSearch = async () => {
    setIsSearching(true);
    try {
      const params = new URLSearchParams();
      if (search.cnaes) params.set("cnae", search.cnaes);
      if (search.states.length > 0) params.set("state", search.states.join(","));
      if (search.equityMin) params.set("equity_min", search.equityMin);
      if (search.equityMax) params.set("equity_max", search.equityMax);
      if (search.size) params.set("size", search.size);
      if (search.hasPhone) params.set("has_phone", "true");
      if (search.hasEmail) params.set("has_email", "true");
      if (search.headOnly) params.set("head", "true");
      params.set("status", "2");
      params.set("limit", "50");

      const queryStr = params.toString();
      setActiveSearch(queryStr);

      const res = await apiRequest("GET", `/api/prospeccao/search?${queryStr}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || "Erro na busca");
      }
      const data = await res.json() as any;
      setResults(data.results || []);
      setResultCount(data.count || 0);

      toast({
        title: `${data.results?.length || 0} empresas encontradas`,
        description: `Total disponível: ${data.count?.toLocaleString("pt-BR") || 0}`,
      });
    } catch (err: any) {
      toast({ title: "Erro na busca", description: err.message, variant: "destructive" });
    } finally {
      setIsSearching(false);
    }
  };

  const openDealDialog = (company: SearchResult) => {
    setSelectedCompany(company);
    const sectorLabel = selectedSector?.label || "M&A";
    setDealTitle(`M&A: ${company.tradeName || company.legalName} (${sectorLabel})`);
    setDealAmount("");
    setDealDescription(
      `Alvo de aquisição M&A — Setor: ${sectorLabel}\n` +
      `CNPJ: ${formatCnpj(company.taxId)}\n` +
      `Atividade: ${company.cnaePrincipal || "N/D"}\n` +
      `Localização: ${company.city || ""}/${company.state || ""}\n` +
      `Porte: ${company.porte || "N/D"}\n` +
      `Fundação: ${company.founded || "N/D"}`
    );
    if (investorStages.length > 0) setDealStage(String(investorStages[0].id));
    setDealDialog(true);
  };

  const createDeal = async () => {
    if (!selectedCompany || !dealTitle || !dealStage) return;
    setImporting(true);
    try {
      const importRes = await apiRequest("POST", `/api/cnpj/${selectedCompany.taxId}/import`);
      let companyId: number | undefined;

      if (importRes.ok) {
        const importData = await importRes.json() as any;
        companyId = importData.company?.id;
      } else if (importRes.status === 409) {
        const existingData = await importRes.json().catch(() => ({})) as any;
        companyId = existingData.company?.id || existingData.companyId;
      } else {
        const errData = await importRes.json().catch(() => ({})) as any;
        throw new Error(errData.message || "Falha ao importar empresa");
      }

      if (!companyId) {
        throw new Error("Não foi possível obter o ID da empresa importada");
      }

      const dealRes = await apiRequest("POST", "/api/crm/deals", {
        title: dealTitle,
        pipelineType: "INVESTOR",
        stageId: Number(dealStage),
        amountEstimate: dealAmount ? Number(dealAmount) : null,
        description: dealDescription,
        priority: "high",
        labels: ["M&A", selectedSector?.label || "Aquisição"],
        companyId,
      });

      if (!dealRes.ok) {
        const errData = await dealRes.json().catch(() => ({})) as any;
        throw new Error(errData.message || "Falha ao criar deal");
      }

      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });

      toast({ title: "Deal M&A criado!", description: "Empresa importada e deal iniciado no pipeline." });
      setDealDialog(false);

      setResults(prev => prev.map(r =>
        r.taxId === selectedCompany.taxId ? { ...r, alreadySaved: true } : r
      ));
    } catch (err: any) {
      toast({ title: "Erro ao criar deal", description: err.message || "Erro desconhecido", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const saveAsLead = async (company: SearchResult) => {
    setSavingTaxId(company.taxId);
    try {
      const importRes = await apiRequest("POST", `/api/cnpj/${company.taxId}/import`);
      let companyId: number | undefined;
      if (importRes.ok) {
        const d = await importRes.json() as any;
        companyId = d.company?.id;
      } else if (importRes.status === 409) {
        const d = await importRes.json().catch(() => ({})) as any;
        companyId = d.company?.id || d.companyId;
      } else {
        const d = await importRes.json().catch(() => ({})) as any;
        throw new Error(d.message || "Falha ao importar empresa");
      }
      if (!companyId) throw new Error("Não foi possível obter o ID da empresa");

      const leadRes = await apiRequest("POST", `/api/companies/${companyId}/lead`, { source: "ma_radar" });
      if (!leadRes.ok && leadRes.status !== 409) {
        const d = await leadRes.json().catch(() => ({})) as any;
        throw new Error(d.message || "Falha ao criar lead");
      }

      queryClient.invalidateQueries({ queryKey: ["/api/sdr/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Empresa salva!", description: "Lead criado na fila SDR com origem M&A Radar." });
      setResults(prev => prev.map(r =>
        r.taxId === company.taxId ? { ...r, alreadySaved: true } : r
      ));
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally {
      setSavingTaxId(null);
    }
  };

  const cadastrarComoAtivo = async (empresa: SearchResult) => {
    const cnpj = (empresa.taxId || "").replace(/\D/g, "");
    try {
      await apiRequest("POST", `/api/cnpj/${cnpj}/import-as-asset`, {});
      setResults((prev: SearchResult[]) =>
        prev.map(e => e.taxId === empresa.taxId ? { ...e, alreadyAsset: true } : e)
      );
      toast({
        title: "Ativo criado",
        description: `${empresa.tradeName || empresa.legalName} cadastrado como ativo NEGOCIO`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/matching/assets"] });
    } catch {
      toast({ title: "Erro ao criar ativo", variant: "destructive" });
    }
  };

  const clearSearch = () => {
    setSearch(defaultSearch);
    setResults([]);
    setResultCount(0);
    setActiveSearch(null);
    setSelectedSector(null);
    setShowFilters(false);
  };

  return (
    <div className={cn(embedded ? "space-y-6" : "p-4 md:p-6 max-w-[1600px] mx-auto space-y-6")}>
      {!embedded && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-page-title">
              <Briefcase className="w-6 h-6 text-primary" />
              M&A — Fusões & Aquisições
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Encontre empresas-alvo por setor, porte e localização usando dados oficiais da Receita Federal (CNPJA)
            </p>
          </div>
          {results.length > 0 && (
            <Button variant="outline" size="sm" onClick={clearSearch} data-testid="button-limpar-busca">
              <X className="w-4 h-4 mr-1.5" /> Limpar Busca
            </Button>
          )}
        </div>
      )}
      {embedded && results.length > 0 && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={clearSearch} data-testid="button-limpar-busca">
            <X className="w-4 h-4 mr-1.5" /> Limpar Busca
          </Button>
        </div>
      )}

      {!activeSearch && (
        <>
          <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-lg bg-primary/10">
                  <Target className="w-8 h-8 text-primary" />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-semibold mb-1" data-testid="text-como-funciona">Como funciona</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">1</div>
                      <div>
                        <p className="font-medium text-sm">Escolha o Setor</p>
                        <p className="text-xs text-muted-foreground">Selecione o segmento de mercado desejado</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">2</div>
                      <div>
                        <p className="font-medium text-sm">Filtre & Busque</p>
                        <p className="text-xs text-muted-foreground">Refine por porte, capital social, estado e mais</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">3</div>
                      <div>
                        <p className="font-medium text-sm">Inicie a Tratativa</p>
                        <p className="text-xs text-muted-foreground">Com um clique, importe a empresa e crie o deal no CRM</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2" data-testid="text-setores-titulo">
              <Sparkles className="w-5 h-5 text-primary" />
              Selecione o Setor de Interesse
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {MA_SECTORS.map(sector => {
                const Icon = sector.icon;
                return (
                  <button
                    key={sector.id}
                    onClick={() => applySector(sector)}
                    className={cn(
                      "flex items-start gap-3 p-4 rounded-xl border text-left transition-all",
                      "hover:shadow-md hover:border-primary/40",
                      sector.bgLight,
                    )}
                    data-testid={`sector-${sector.id}`}
                  >
                    <div className={cn("p-2.5 rounded-lg bg-gradient-to-br text-white shrink-0", sector.color)}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{sector.label}</p>
                      <p className="text-xs opacity-80 mt-0.5">{sector.description}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {sector.cnaeLabels.slice(0, 3).map(l => (
                          <Badge key={l} variant="outline" className="text-[10px] px-1.5 py-0">
                            {l}
                          </Badge>
                        ))}
                        {sector.cnaeLabels.length > 3 && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            +{sector.cnaeLabels.length - 3}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {showFilters && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Filter className="w-4 h-4" />
                Filtros de Busca
                {selectedSector && (
                  <Badge className={cn("ml-2", selectedSector.bgLight)}>
                    {selectedSector.label}
                  </Badge>
                )}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setShowFilters(false)} data-testid="button-fechar-filtros">
                <X className="w-4 h-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">CNAEs (códigos separados por vírgula)</Label>
                <Input
                  value={search.cnaes}
                  onChange={e => setSearch(s => ({ ...s, cnaes: e.target.value }))}
                  placeholder="Ex: 1051100,1052000"
                  className="font-mono text-xs"
                  data-testid="input-cnaes"
                />
                {selectedSector && (
                  <p className="text-[10px] text-muted-foreground">
                    Pré-preenchido: {selectedSector.cnaeLabels.join(", ")}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Estados (UF)</Label>
                <Select
                  value={search.states.length === 1 ? search.states[0] : "all"}
                  onValueChange={v => setSearch(s => ({ ...s, states: v === "all" ? [] : [v] }))}
                >
                  <SelectTrigger data-testid="select-estado">
                    <SelectValue placeholder="Todos os estados" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os estados</SelectItem>
                    {ESTADOS.map(e => (
                      <SelectItem key={e} value={e}>{e}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Porte da Empresa</Label>
                <Select
                  value={search.size || "all"}
                  onValueChange={v => setSearch(s => ({ ...s, size: v === "all" ? "" : v }))}
                >
                  <SelectTrigger data-testid="select-porte">
                    <SelectValue placeholder="Selecione o porte" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os portes</SelectItem>
                    {PORTE_OPTIONS.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Capital Social Mínimo (R$)</Label>
                <Input
                  type="number"
                  value={search.equityMin}
                  onChange={e => setSearch(s => ({ ...s, equityMin: e.target.value }))}
                  placeholder="Ex: 1000000"
                  data-testid="input-capital-min"
                />
                {search.equityMin && (
                  <p className="text-[10px] text-muted-foreground">{formatEquity(search.equityMin)}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Capital Social Máximo (R$)</Label>
                <Input
                  type="number"
                  value={search.equityMax}
                  onChange={e => setSearch(s => ({ ...s, equityMax: e.target.value }))}
                  placeholder="Ex: 50000000"
                  data-testid="input-capital-max"
                />
                {search.equityMax && (
                  <p className="text-[10px] text-muted-foreground">{formatEquity(search.equityMax)}</p>
                )}
              </div>

              <div className="flex items-end gap-4 col-span-1 sm:col-span-2 lg:col-span-3">
                <label className="flex items-center gap-2 cursor-pointer" data-testid="checkbox-telefone">
                  <input
                    type="checkbox"
                    checked={search.hasPhone}
                    onChange={e => setSearch(s => ({ ...s, hasPhone: e.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-xs flex items-center gap-1"><Phone className="w-3 h-3" /> Com telefone</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer" data-testid="checkbox-email">
                  <input
                    type="checkbox"
                    checked={search.hasEmail}
                    onChange={e => setSearch(s => ({ ...s, hasEmail: e.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-xs flex items-center gap-1"><Mail className="w-3 h-3" /> Com email</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer" data-testid="checkbox-matriz">
                  <input
                    type="checkbox"
                    checked={search.headOnly}
                    onChange={e => setSearch(s => ({ ...s, headOnly: e.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-xs flex items-center gap-1"><Building2 className="w-3 h-3" /> Apenas matriz</span>
                </label>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                onClick={executeSearch}
                disabled={isSearching || !search.cnaes}
                className="min-w-[160px]"
                data-testid="button-buscar-empresas"
              >
                {isSearching ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <Search className="w-4 h-4 mr-1.5" />
                )}
                {isSearching ? "Buscando..." : "Buscar Empresas"}
              </Button>
              <Button variant="outline" onClick={clearSearch} data-testid="button-limpar-filtros">
                <X className="w-4 h-4 mr-1.5" /> Limpar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!showFilters && !activeSearch && (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <Globe className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-semibold text-lg mb-1" data-testid="text-busca-custom">Busca Customizada</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Não encontrou seu setor? Configure uma busca manual com CNAEs específicos
            </p>
            <Button variant="outline" onClick={() => setShowFilters(true)} data-testid="button-busca-custom">
              <Filter className="w-4 h-4 mr-1.5" /> Abrir Filtros Avançados
            </Button>
          </CardContent>
        </Card>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2" data-testid="text-resultados-titulo">
              <TrendingUp className="w-5 h-5 text-primary" />
              Resultados
              <Badge variant="secondary">{results.length} de {resultCount.toLocaleString("pt-BR")}</Badge>
            </h2>
            {selectedSector && (
              <Badge className={cn(selectedSector.bgLight)}>
                {selectedSector.label}
              </Badge>
            )}
          </div>

          <div className="rounded-lg border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">#</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead>Atividade</TableHead>
                  <TableHead>Localização</TableHead>
                  <TableHead>Porte</TableHead>
                  <TableHead>Fundação</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r, i) => (
                  <TableRow key={r.taxId} data-testid={`row-empresa-${i}`}>
                    <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                    <TableCell>
                      <div className="min-w-[200px]">
                        <p className="font-medium text-sm truncate" data-testid={`text-empresa-nome-${i}`}>
                          {r.tradeName || r.legalName}
                        </p>
                        {r.tradeName && (
                          <p className="text-xs text-muted-foreground truncate">{r.legalName}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs" data-testid={`text-cnpj-${i}`}>{formatCnpj(r.taxId)}</span>
                    </TableCell>
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <p className="text-xs max-w-[200px] truncate">{r.cnaePrincipal || "N/D"}</p>
                          </TooltipTrigger>
                          <TooltipContent><p className="max-w-[300px]">{r.cnaePrincipal}</p></TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-xs">
                        <MapPin className="w-3 h-3 text-muted-foreground" />
                        <span>{r.city || "?"}/{r.state || "?"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{r.porte || "N/D"}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {r.founded ? new Date(r.founded).toLocaleDateString("pt-BR", { year: "numeric", month: "short" }) : "N/D"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.alreadySaved ? (
                        <Badge className="bg-green-100 text-green-700 border-green-200" data-testid={`badge-no-crm-${i}`}>
                          <Check className="w-3 h-3 mr-1" /> Já no CRM
                        </Badge>
                      ) : (
                        <div className="flex items-center gap-1.5 justify-end">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => saveAsLead(r)}
                                  disabled={savingTaxId === r.taxId}
                                  data-testid={`button-salvar-empresa-${i}`}
                                >
                                  {savingTaxId === r.taxId ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Users className="w-3.5 h-3.5" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Salvar empresa como lead SDR</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => openDealDialog(r)}
                            data-testid={`button-iniciar-tratativa-${i}`}
                          >
                            <PlayCircle className="w-3.5 h-3.5 mr-1" /> Iniciar Tratativa
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs gap-1 text-emerald-600"
                            onClick={() => cadastrarComoAtivo(r)}
                            disabled={r.alreadyAsset}
                            data-testid={`button-cadastrar-ativo-${i}`}
                          >
                            <Building2 className="w-3 h-3" />
                            {r.alreadyAsset ? "Já é ativo" : "Cadastrar ativo"}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {resultCount > results.length && (
            <p className="text-xs text-muted-foreground text-center">
              Mostrando {results.length} de {resultCount.toLocaleString("pt-BR")} empresas encontradas.
              Refine os filtros para resultados mais relevantes.
            </p>
          )}
        </div>
      )}

      {isSearching && (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      <Dialog open={dealDialog} onOpenChange={setDealDialog}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-primary" />
              Iniciar Tratativa M&A
            </DialogTitle>
            <DialogDescription>
              Importa a empresa para o CRM e cria um deal no pipeline de Investidores
            </DialogDescription>
          </DialogHeader>

          {selectedCompany && (
            <div className="space-y-4 py-2">
              <div className="bg-muted/40 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{selectedCompany.tradeName || selectedCompany.legalName}</p>
                  {selectedSector && (
                    <Badge className={cn("text-xs", selectedSector.bgLight)}>
                      {selectedSector.label}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground font-mono">{formatCnpj(selectedCompany.taxId)}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {selectedCompany.city}/{selectedCompany.state}</span>
                  <span className="flex items-center gap-1"><Building2 className="w-3 h-3" /> {selectedCompany.porte}</span>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Título do Deal</Label>
                  <Input
                    value={dealTitle}
                    onChange={e => setDealTitle(e.target.value)}
                    data-testid="input-deal-titulo"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Etapa do Pipeline</Label>
                    <Select value={dealStage} onValueChange={setDealStage}>
                      <SelectTrigger data-testid="select-deal-etapa">
                        <SelectValue placeholder="Selecionar..." />
                      </SelectTrigger>
                      <SelectContent>
                        {investorStages.map((s: any) => (
                          <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Valor Estimado (R$)</Label>
                    <Input
                      type="number"
                      value={dealAmount}
                      onChange={e => setDealAmount(e.target.value)}
                      placeholder="Ex: 200000000"
                      data-testid="input-deal-valor"
                    />
                    {dealAmount && (
                      <p className="text-[10px] text-muted-foreground">{formatEquity(dealAmount)}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Descrição / Notas</Label>
                  <Textarea
                    value={dealDescription}
                    onChange={e => setDealDescription(e.target.value)}
                    rows={4}
                    className="text-xs"
                    data-testid="textarea-deal-descricao"
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDealDialog(false)}>Cancelar</Button>
            <Button
              onClick={createDeal}
              disabled={importing || !dealTitle || !dealStage}
              data-testid="button-confirmar-deal"
            >
              {importing ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4 mr-1.5" />
              )}
              {importing ? "Criando..." : "Criar Deal M&A"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
