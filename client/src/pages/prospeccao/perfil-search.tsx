import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  Loader2,
  AlertCircle,
  X,
  Building2,
  MapPin,
  DollarSign,
  Briefcase,
  Users,
  Phone,
  Mail,
  ExternalLink,
  XCircle,
  ChevronDown,
} from "lucide-react";
import { CnaePicker } from "./cnae-tree";

const ESTADOS = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
  "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

const FATURAMENTO_OPTIONS = [
  { key: "ate_81k", label: "Até R$ 81 mil" },
  { key: "81k_360k", label: "R$ 81 mil – R$ 360 mil" },
  { key: "360k_4m8", label: "R$ 360 mil – R$ 4,8 mi" },
  { key: "4m8_10m", label: "R$ 4,8 mi – R$ 10 mi" },
  { key: "10m_50m", label: "R$ 10 mi – R$ 50 mi" },
  { key: "50m_300m", label: "R$ 50 mi – R$ 300 mi" },
  { key: "acima_300m", label: "Acima de R$ 300 mi" },
];

const SEGMENTO_PRESETS = [
  {
    key: "fazendas",
    label: "Fazendas / Terras",
    cnaes: [115600, 151201, 151202, 111301, 111302, 113000, 141501, 141502, 119900, 6810201, 6810202],
    nomes: "",
  },
  {
    key: "agro",
    label: "Agronegócio Geral",
    cnaes: [115600, 111301, 111302, 113000, 131800, 141501, 141502, 151201, 151202, 155501, 161001, 163600, 210108],
    nomes: "",
  },
  {
    key: "mineracao",
    label: "Mineração",
    cnaes: [710301, 721401, 723303, 729403, 810002, 810007, 891600, 899903],
    nomes: "",
  },
  {
    key: "imobiliario",
    label: "Imobiliário",
    cnaes: [4110700, 4120400, 6810201, 6810202, 6630400],
    nomes: "",
  },
  {
    key: "holding",
    label: "Holdings / M&A",
    cnaes: [6420000, 6430200, 6462000, 6470101, 6499301],
    nomes: "",
  },
];

const NATUREZA_OPTIONS = [
  { id: 2062, label: "Soc. Empresária Limitada (LTDA)" },
  { id: 2035, label: "Soc. Anônima Fechada (S.A.)" },
  { id: 2038, label: "Soc. Anônima Aberta (S.A.)" },
  { id: 2135, label: "EIRELI" },
  { id: 2143, label: "Cooperativa" },
  { id: 2011, label: "Empresário Individual (MEI)" },
  { id: 4120, label: "Produtor Rural (CPF)" },
  { id: 6010, label: "Fundação Privada" },
];

const DS_FUNCIONARIOS_OPTIONS = [
  { key: "1_5", label: "1 a 5" },
  { key: "6_10", label: "6 a 10" },
  { key: "11_20", label: "11 a 20" },
  { key: "21_50", label: "21 a 50" },
  { key: "51_100", label: "51 a 100" },
  { key: "101_500", label: "101 a 500" },
  { key: "501_plus", label: "Acima de 500" },
];


function ToggleGroup({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`text-xs px-2.5 py-1 rounded border transition-colors ${
            value === opt.value
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border hover:border-primary/50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

interface SearchResult {
  taxId: string;
  legalName: string;
  tradeName: string | null;
  status: string | null;
  statusId: number | null;
  porte: string | null;
  cnaePrincipal: string | null;
  cnaeCode: string | null;
  city: string | null;
  state: string | null;
  founded: string | null;
  faturamento: string | null;
  faturamentoEstimado: boolean;
  funcionarios: string | null;
  phones: string[];
  emails: string[];
  alreadySaved: boolean;
  savedCompanyId: number | null;
  source: string;
}

export default function PerfilSearch() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const [faturamento, setFaturamento] = useState<string[]>([]);
  const [estados, setEstados] = useState<string[]>([]);
  const [cidades, setCidades] = useState<string[]>([]);
  const [cnaeIds, setCnaeIds] = useState<number[]>([]);
  const [cnaeSideIds, setCnaeSideIds] = useState<number[]>([]);
  const [quantidade, setQuantidade] = useState("50");

  const [nomes, setNomes] = useState("");
  const [natures, setNatures] = useState<number[]>([]);
  const [simples, setSimples] = useState<"" | "true" | "false">("");
  const [socioName, setSocioName] = useState("");

  const [dsFuncionarios, setDsFuncionarios] = useState<string[]>([]);

  const [availableCities, setAvailableCities] = useState<{ nome: string; uf: string }[]>([]);
  const [citySearch, setCitySearch] = useState("");
  const [loadingCities, setLoadingCities] = useState(false);
  const [showCityDropdown, setShowCityDropdown] = useState(false);

  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchSource, setSearchSource] = useState<string | null>(null);
  const [importingCnpj, setImportingCnpj] = useState<string | null>(null);
  const [importedMap, setImportedMap] = useState<Record<string, number>>({});
  const [disqualifyingCnpj, setDisqualifyingCnpj] = useState<string | null>(null);

  useEffect(() => {
    if (estados.length === 0) { setAvailableCities([]); return; }
    const controller = new AbortController();
    setLoadingCities(true);
    fetch(`/api/prospeccao/cidades?estados=${estados.join(",")}`, { signal: controller.signal })
      .then(res => res.ok ? res.json() : [])
      .then(data => { if (!controller.signal.aborted) setAvailableCities(data); })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setLoadingCities(false); });
    return () => controller.abort();
  }, [estados]);

  useEffect(() => {
    if (estados.length > 0 && cidades.length > 0) {
      const valid = cidades.filter(c => {
        const uf = c.split(" - ")[1];
        return !uf || estados.includes(uf);
      });
      if (valid.length !== cidades.length) setCidades(valid);
    }
  }, [estados]);

  const [activeSegmento, setActiveSegmento] = useState<string | null>(null);

  const applySegmento = (key: string) => {
    if (activeSegmento === key) {
      setActiveSegmento(null);
      setCnaeIds([]);
      setNomes("");
      return;
    }
    const preset = SEGMENTO_PRESETS.find(s => s.key === key);
    if (!preset) return;
    setActiveSegmento(key);
    setCnaeIds(preset.cnaes);
    if (preset.nomes) setNomes(preset.nomes);
    else setNomes("");
  };

  const toggleFaturamento = (key: string) =>
    setFaturamento(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  const toggleEstado = (uf: string) =>
    setEstados(prev => prev.includes(uf) ? prev.filter(u => u !== uf) : [...prev, uf]);
  const toggleNature = (id: number) =>
    setNatures(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const addCity = (nome: string, uf: string) => {
    const key = `${nome} - ${uf}`;
    if (!cidades.includes(key)) setCidades(prev => [...prev, key]);
    setCitySearch("");
    setShowCityDropdown(false);
  };
  const removeCity = (key: string) => setCidades(prev => prev.filter(c => c !== key));

  const filteredCities = availableCities
    .filter(c => !cidades.includes(`${c.nome} - ${c.uf}`) &&
      (citySearch.length === 0 || c.nome.toLowerCase().includes(citySearch.toLowerCase())))
    .slice(0, 20);

  const useDatastone = faturamento.length > 0 || dsFuncionarios.length > 0;
  const canSearch = estados.length > 0 || cidades.length > 0 || nomes.trim().length > 0 || cnaeIds.length > 0 || cnaeSideIds.length > 0 || faturamento.length > 0 || natures.length > 0 || simples || socioName || dsFuncionarios.length > 0;
  const effectiveMaxQtd = useDatastone ? Math.min(Number(quantidade), 20) : Number(quantidade);

  const activeFilterCount = [
    activeSegmento,
    faturamento.length > 0,
    estados.length > 0,
    cidades.length > 0,
    !activeSegmento && cnaeIds.length > 0,
    cnaeSideIds.length > 0,
    !activeSegmento && nomes,
    natures.length > 0,
    simples,
    socioName,
    dsFuncionarios.length > 0,
  ].filter(Boolean).length;

  const buildUnifiedBody = () => {
    const body: any = {};
    if (faturamento.length > 0) body.faturamento = faturamento;
    if (estados.length > 0) body.estados = estados;
    if (cidades.length > 0) body.cidades = cidades;
    if (cnaeIds.length > 0) body.cnaes = cnaeIds.map(String);
    if (cnaeSideIds.length > 0) body.cnaeSide = cnaeSideIds.map(String);
    if (nomes) body.nome = nomes;
    if (natures.length > 0) body.naturezas = natures;
    if (simples) body.simples = simples;
    if (dsFuncionarios.length > 0) body.funcionarios = dsFuncionarios;
    if (socioName) body.socioName = socioName;
    body.quantidade = effectiveMaxQtd;
    return body;
  };

  const runSearch = async () => {
    if (!canSearch) { toast({ title: "Selecione pelo menos um filtro", variant: "destructive" }); return; }
    if (useDatastone && estados.length === 0) { toast({ title: "Selecione pelo menos um estado quando usar filtros de faturamento/funcionários", variant: "destructive" }); return; }
    setLoading(true);
    setError(null);
    setResults(null);
    setResultCount(null);
    setSearchSource(null);
    setLoadingStep(useDatastone ? "Buscando empresas no Datastone..." : "Buscando empresas na Receita Federal...");
    try {
      const res = await apiRequest("POST", "/api/prospeccao/unified-search", buildUnifiedBody());
      const data = await res.json();
      if (useDatastone) setLoadingStep("Enriquecendo dados de contato via CNPJA...");
      if (data.results) {
        setResults(data.results);
        setResultCount(data.count);
        setSearchSource(data.source || (useDatastone ? "Datastone + CNPJA" : "CNPJA"));
      } else {
        setError(data.message || "Erro na busca");
      }
    } catch (err: any) {
      let msg = "Falha na busca";
      try { const b = JSON.parse(err?.message?.slice(err.message.indexOf("{")) || "{}"); if (b.message) msg = b.message; } catch {}
      if (err?.message && !msg.includes("Erro") && !msg.includes("Falha")) msg = err.message;
      setError(msg);
    }
    setLoading(false);
    setLoadingStep(null);
  };

  const importLead = async (cnpj: string) => {
    setImportingCnpj(cnpj);
    try {
      const res = await apiRequest("POST", `/api/cnpj/${cnpj}/import`);
      const data = await res.json();
      toast({ title: "Lead importado com sucesso!" });
      queryClient.invalidateQueries({ queryKey: ["/api/companies/catalogo"] });
      if (data?.companyId || data?.id) setImportedMap(prev => ({ ...prev, [cnpj]: data.companyId || data.id }));
      setResults(prev => prev ? prev.map(r => r.taxId === cnpj ? { ...r, alreadySaved: true } : r) : prev);
    } catch (err: any) {
      let msg = "Erro ao importar";
      try { const b = JSON.parse(err?.message?.slice(err.message.indexOf("{")) || "{}"); if (b.message) msg = b.message; } catch {}
      toast({ title: msg, variant: "destructive" });
    }
    setImportingCnpj(null);
  };

  const importAsAsset = async (empresa: SearchResult) => {
    const cnpj = empresa.taxId.replace(/\D/g, "");
    setImportingCnpj(cnpj);
    try {
      const res = await apiRequest("POST", `/api/cnpj/${cnpj}/import-as-asset`, {});
      const data = await res.json();
      toast({ title: "Ativo criado com sucesso", description: `${empresa.tradeName || empresa.legalName} cadastrado como ativo NEGOCIO` });
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      navigate(`/ativos/${data.asset.id}`);
    } catch { toast({ title: "Erro ao criar ativo", variant: "destructive" }); }
    setImportingCnpj(null);
  };

  const disqualify = async (cnpj: string) => {
    setDisqualifyingCnpj(cnpj);
    try {
      await apiRequest("POST", `/api/cnpj/${cnpj}/disqualify`);
      toast({ title: "Empresa desqualificada" });
      setResults(prev => prev ? prev.filter(r => r.taxId !== cnpj) : prev);
    } catch { toast({ title: "Erro ao desqualificar", variant: "destructive" }); }
    setDisqualifyingCnpj(null);
  };

  const clearAll = () => {
    setActiveSegmento(null);
    setFaturamento([]);
    setEstados([]);
    setCidades([]);
    setCnaeIds([]);
    setCnaeSideIds([]);
    setQuantidade("50");
    setNomes("");
    setNatures([]);
    setSimples("");
    setSocioName("");
    setDsFuncionarios([]);
    setResults(null);
    setResultCount(null);
    setError(null);
    setSearchSource(null);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4" data-testid="panel-perfil-search">

      <Card className="lg:col-span-1">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Filtros
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">{activeFilterCount} ativos</Badge>
              )}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={clearAll} data-testid="button-limpar-perfil">
              <X className="w-4 h-4 mr-1" /> Limpar
            </Button>
          </div>
          {useDatastone && (
            <Badge variant="outline" className="text-[10px] py-0.5 px-2 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800" data-testid="badge-engine-indicator">
              Motor: Datastone + CNPJA (faturamento/funcionários selecionados)
            </Badge>
          )}
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground">Qtd. máxima:</Label>
            <Select value={String(Math.min(Number(quantidade), useDatastone ? 20 : 100))} onValueChange={setQuantidade}>
              <SelectTrigger className="h-7 w-20 text-xs" data-testid="select-perfil-quantidade">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(useDatastone ? [5, 10, 15, 20] : [10, 25, 50, 100]).map(n => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {useDatastone && (
              <span className="text-[10px] text-amber-600 dark:text-amber-400">máx 20</span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5 overflow-y-auto max-h-[calc(100vh-280px)]">

          <div className="space-y-2">
            <Label>Segmento Rápido</Label>
            <div className="flex flex-wrap gap-1.5">
              {SEGMENTO_PRESETS.map(s => (
                <button
                  key={s.key}
                  onClick={() => applySegmento(s.key)}
                  data-testid={`toggle-segmento-${s.key}`}
                  className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                    activeSegmento === s.key
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Preenche CNAEs e palavras-chave automaticamente</p>
          </div>

          <div className="space-y-1.5">
            <Label>Nome / Razão Social</Label>
            <Input
              placeholder="Ex: Construtora, Agro..."
              value={nomes}
              onChange={e => { setNomes(e.target.value); setActiveSegmento(null); }}
              data-testid="input-perfil-nome"
            />
          </div>

          <CnaePicker
            label="CNAE Principal"
            selected={cnaeIds}
            onChange={setCnaeIds}
          />

          <div className={useDatastone ? "opacity-50" : ""}>
            <CnaePicker
              label="CNAE Secundário"
              selected={cnaeSideIds}
              onChange={setCnaeSideIds}
            />
            {useDatastone && <p className="text-[10px] text-amber-600 mt-0.5">Ignorado no Datastone</p>}
          </div>

          <div className="space-y-2">
            <Label>Estado (UF)</Label>
            <div className="flex flex-wrap gap-1.5">
              {ESTADOS.map(s => (
                <button
                  key={s}
                  onClick={() => toggleEstado(s)}
                  data-testid={`toggle-perfil-estado-${s}`}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                    estados.includes(s)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {estados.length > 0 && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />
                Cidade / Município
                {availableCities.length > 0 && (
                  <span className="text-xs text-muted-foreground font-normal">({availableCities.length} disponíveis)</span>
                )}
              </Label>
              {cidades.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1">
                  {cidades.map(city => (
                    <Badge key={city} variant="secondary" className="gap-1 cursor-pointer hover:bg-destructive/20 transition-colors" onClick={() => removeCity(city)} data-testid={`badge-perfil-city-${city}`}>
                      {city} <X className="w-3 h-3" />
                    </Badge>
                  ))}
                </div>
              )}
              <div className="relative">
                <Input
                  placeholder={loadingCities ? "Carregando cidades..." : "Clique ou digite para filtrar cidades..."}
                  value={citySearch}
                  onChange={e => { setCitySearch(e.target.value); setShowCityDropdown(true); }}
                  onFocus={() => setShowCityDropdown(true)}
                  onBlur={() => setTimeout(() => setShowCityDropdown(false), 200)}
                  disabled={loadingCities}
                  data-testid="input-perfil-cidade"
                />
                {loadingCities && <Loader2 className="w-3.5 h-3.5 animate-spin absolute right-2 top-2.5 text-muted-foreground" />}
                {showCityDropdown && filteredCities.length > 0 && (
                  <div className="absolute z-50 w-full bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto mt-1">
                    {filteredCities.map(c => (
                      <button
                        key={`${c.nome}-${c.uf}`}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => addCity(c.nome, c.uf)}
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                        data-testid={`perfil-city-${c.nome}`}
                      >
                        {c.nome} <span className="text-muted-foreground">({c.uf})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Opcional — sem cidade, busca todo o estado</p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Faturamento Estimado</Label>
            <p className="text-xs text-muted-foreground -mt-1">Ativa o motor Datastone (consome créditos, máx 20 resultados)</p>
            {FATURAMENTO_OPTIONS.map(f => (
              <div key={f.key} className="flex items-center gap-2">
                <Checkbox
                  id={`pf-fat-${f.key}`}
                  checked={faturamento.includes(f.key)}
                  onCheckedChange={() => toggleFaturamento(f.key)}
                  data-testid={`checkbox-perfil-fat-${f.key}`}
                />
                <Label htmlFor={`pf-fat-${f.key}`} className="font-normal text-sm cursor-pointer">{f.label}</Label>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label>Funcionários Estimados</Label>
            <p className="text-xs text-muted-foreground -mt-1">Ativa o motor Datastone (consome créditos, máx 20 resultados)</p>
            {DS_FUNCIONARIOS_OPTIONS.map(f => (
              <div key={f.key} className="flex items-center gap-2">
                <Checkbox
                  id={`pf-func-${f.key}`}
                  checked={dsFuncionarios.includes(f.key)}
                  onCheckedChange={() => setDsFuncionarios(prev => prev.includes(f.key) ? prev.filter(k => k !== f.key) : [...prev, f.key])}
                  data-testid={`checkbox-perfil-func-${f.key}`}
                />
                <Label htmlFor={`pf-func-${f.key}`} className="font-normal text-sm cursor-pointer">{f.label}</Label>
              </div>
            ))}
          </div>

          <div className={`space-y-1.5 ${useDatastone ? "opacity-50" : ""}`}>
            <Label>Sócio / Administrador</Label>
            <Input
              placeholder="Nome do sócio ou administrador"
              value={socioName}
              onChange={e => setSocioName(e.target.value)}
              data-testid="input-perfil-socio"
            />
            <p className="text-xs text-muted-foreground">Busca empresas onde essa pessoa é sócia</p>
            {useDatastone && <p className="text-[10px] text-amber-600">Disponível apenas no CNPJA</p>}
          </div>

          <div className="space-y-2">
            <Label>Natureza Jurídica</Label>
            <p className="text-xs text-muted-foreground -mt-1">Inclui "Produtor Rural" para agrônomos/produtores com CPF</p>
            {NATUREZA_OPTIONS.map(n => (
              <div key={n.id} className="flex items-center gap-2">
                <Checkbox
                  id={`pf-nat-${n.id}`}
                  checked={natures.includes(n.id)}
                  onCheckedChange={() => toggleNature(n.id)}
                  data-testid={`checkbox-perfil-nature-${n.id}`}
                />
                <Label htmlFor={`pf-nat-${n.id}`} className="font-normal text-sm cursor-pointer">{n.label}</Label>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label>Simples Nacional</Label>
            <ToggleGroup
              value={simples}
              onChange={v => setSimples(v as "" | "true" | "false")}
              options={[{ value: "", label: "Todos" }, { value: "true", label: "Optante" }, { value: "false", label: "Não optante" }]}
            />
          </div>


          <Button
            className="w-full"
            onClick={runSearch}
            disabled={loading || !canSearch}
            data-testid="button-buscar-perfil"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Search className="w-4 h-4 mr-2" />
            )}
            Buscar Empresas
          </Button>

          {useDatastone && (
            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 shrink-0" />
              Faturamento/funcionários ativam o Datastone (consome créditos, máx 20 resultados). Sem eles, usa Receita Federal (CNPJA) com estimativa de faturamento via IA.
            </p>
          )}

        </CardContent>
      </Card>

      <div className="space-y-4">
        {error && (
          <Card className="border-destructive">
            <CardContent className="pt-4">
              <p className="text-destructive text-sm flex items-center gap-1">
                <AlertCircle className="w-4 h-4" /> {error}
              </p>
            </CardContent>
          </Card>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <div className="text-center">
              <p className="text-sm font-medium" data-testid="text-loading-step">
                {loadingStep || "Buscando empresas..."}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {useDatastone
                  ? "Buscando no Datastone e enriquecendo via CNPJA — pode levar até 1 minuto"
                  : "Buscando na Receita Federal e estimando faturamento via IA"}
              </p>
            </div>
          </div>
        )}

        {!loading && resultCount !== null && results && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm">
                <span className="font-semibold">{resultCount}</span> empresas retornadas
                {results.filter(r => r.alreadySaved || r.savedCompanyId || importedMap[r.taxId]).length > 0 && (
                  <span className="text-muted-foreground ml-1">
                    ({results.filter(r => r.alreadySaved || r.savedCompanyId || importedMap[r.taxId]).length} já cadastradas)
                  </span>
                )}
              </span>
              <Badge variant="outline" className="text-[10px] py-0">{searchSource}</Badge>
            </div>

            {results.map(r => {
              const companyId = importedMap[r.taxId] || r.savedCompanyId;
              return (
                <Card key={r.taxId} data-testid={`card-perfil-result-${r.taxId}`} className={companyId ? "border-emerald-200 dark:border-emerald-800/50" : ""}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-sm">{r.tradeName || r.legalName}</p>
                          {r.tradeName && r.legalName && r.tradeName !== r.legalName && (
                            <p className="text-xs text-muted-foreground truncate max-w-[300px]">({r.legalName})</p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                          <span className="font-mono">{r.taxId.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}</span>
                          {(r.city || r.state) && (
                            <span className="flex items-center gap-0.5">
                              <MapPin className="w-3 h-3" />
                              {[r.city, r.state].filter(Boolean).join(" – ")}
                            </span>
                          )}
                          {r.cnaePrincipal && (
                            <span className="flex items-center gap-0.5 max-w-[250px] truncate">
                              <Briefcase className="w-3 h-3 shrink-0" />
                              {r.cnaePrincipal}
                            </span>
                          )}
                          {r.founded && <span>Fundada: {r.founded}</span>}
                          {r.porte && <Badge variant="outline" className="text-[10px] py-0">{r.porte}</Badge>}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs">
                          {r.faturamento && (
                            <Badge variant="secondary" className={`text-[10px] py-0 gap-1 ${r.faturamentoEstimado ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border-blue-200" : "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300"}`} data-testid={`badge-fat-${r.taxId}`}>
                              <DollarSign className="w-2.5 h-2.5" />
                              {r.faturamento}
                              {r.faturamentoEstimado && <span className="opacity-70 ml-0.5">(estimado)</span>}
                            </Badge>
                          )}
                          {r.funcionarios && (
                            <Badge variant="outline" className="text-[10px] py-0 gap-1">
                              <Users className="w-2.5 h-2.5" /> {r.funcionarios}
                            </Badge>
                          )}
                          {r.phones?.length > 0 && (
                            <span className="flex items-center gap-0.5 text-muted-foreground">
                              <Phone className="w-2.5 h-2.5" />
                              {r.phones.slice(0, 2).join(", ")}
                              {r.phones.length > 2 && ` +${r.phones.length - 2}`}
                            </span>
                          )}
                          {r.emails?.length > 0 && (
                            <span className="flex items-center gap-0.5 text-muted-foreground">
                              <Mail className="w-2.5 h-2.5" />
                              {r.emails[0]}
                              {r.emails.length > 1 && ` +${r.emails.length - 1}`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        {companyId ? (
                          <Button size="sm" variant="outline" className="h-8 text-emerald-600 border-emerald-300 hover:bg-emerald-50"
                            onClick={() => window.open(`/empresas/${companyId}`, '_blank', 'noopener,noreferrer')}
                            data-testid={`button-abrir-perfil-${r.taxId}`}>
                            <ExternalLink className="w-3.5 h-3.5 mr-1" /> Abrir
                          </Button>
                        ) : (
                          <>
                            <Button size="sm" variant="outline"
                              onClick={() => disqualify(r.taxId)}
                              disabled={disqualifyingCnpj === r.taxId}
                              className="text-destructive border-destructive/30 hover:bg-destructive/10 h-8 px-2"
                              data-testid={`button-desq-perfil-${r.taxId}`}>
                              {disqualifyingCnpj === r.taxId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                            </Button>
                            {importingCnpj === r.taxId ? (
                              <Button size="sm" variant="outline" disabled className="h-8">
                                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> Importando...
                              </Button>
                            ) : (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1" data-testid={`button-importar-perfil-${r.taxId}`}>
                                    Importar <ChevronDown className="w-3 h-3" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => importLead(r.taxId)} data-testid={`menu-comprador-perfil-${r.taxId}`}>
                                    <Users className="w-3.5 h-3.5 mr-2 text-blue-600" /> Como comprador / investidor
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => importAsAsset(r)} data-testid={`menu-ativo-perfil-${r.taxId}`}>
                                    <Building2 className="w-3.5 h-3.5 mr-2 text-emerald-600" /> Como ativo (empresa à venda)
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {!loading && !results && !error && (
          <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
            <Search className="w-12 h-12 mb-4 opacity-20" />
            <p className="font-medium">Defina os filtros e busque</p>
            <p className="text-sm mt-1">
              Selecione filtros de faturamento ou funcionários para usar o Datastone (máx 20, com créditos). Sem eles, a busca usa a Receita Federal (CNPJA) com estimativa de faturamento via IA.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
