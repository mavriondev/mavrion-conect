import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Leaf, Plus, Search, Upload, Download, ExternalLink, Trash2, Edit2, Save,
  Users, MapPin, BarChart3, AlertTriangle, CheckCircle, XCircle, FileText, Filter,
  Database, Loader2, TrendingUp, Play, Square, RefreshCw, Globe,
} from "lucide-react";
import type { NorionCafRegistro } from "@shared/schema";

const UF_LIST = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA",
  "PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

const GRUPO_OPTIONS = [
  { value: "A", label: "Grupo A (Reforma Agrária)" },
  { value: "A/C", label: "Grupo A/C (Pós-assentamento)" },
  { value: "B", label: "Grupo B (Microcrédito)" },
  { value: "V", label: "Grupo V (Renda Variável)" },
];

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ativo") return <Badge className="bg-green-100 text-green-700 border-green-300" data-testid="badge-status-ativo"><CheckCircle className="w-3 h-3 mr-1" />Ativo</Badge>;
  if (status === "vencido") return <Badge className="bg-red-100 text-red-700 border-red-300" data-testid="badge-status-vencido"><XCircle className="w-3 h-3 mr-1" />Vencido</Badge>;
  return <Badge variant="outline" data-testid="badge-status-pendente"><AlertTriangle className="w-3 h-3 mr-1" />Pendente</Badge>;
}

function CrawlerSection() {
  const { toast } = useToast();
  const [showCrawler, setShowCrawler] = useState(false);
  const [crawlerUf, setCrawlerUf] = useState("MG");
  const [crawlerAno, setCrawlerAno] = useState(2025);
  const [crawlerMes, setCrawlerMes] = useState(1);
  const [crawlerMaxRegistros, setCrawlerMaxRegistros] = useState(200);
  const [crawlerMunicipio, setCrawlerMunicipio] = useState("");
  const [crawlerCodIBGE, setCrawlerCodIBGE] = useState("");
  const [crawlerApenasProprietario, setCrawlerApenasProprietario] = useState(false);
  const [crawlerApenasAtivos, setCrawlerApenasAtivos] = useState(true);
  const [crawlerApenasComPronaf, setCrawlerApenasComPronaf] = useState(false);
  const [crawlerAreaMinHa, setCrawlerAreaMinHa] = useState(0);
  const [crawlerAreaMaxHa, setCrawlerAreaMaxHa] = useState(0);
  const [crawlerDelayMs, setCrawlerDelayMs] = useState(1100);
  const [crawlerModo, setCrawlerModo] = useState<'paginado' | 'sequencial'>('paginado');
  const [crawlerSeqInicio, setCrawlerSeqInicio] = useState(1);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<any>(null);
  const [polling, setPolling] = useState(false);

  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const startPoll = (jobId: string) => {
    setPolling(true);
    pollInterval.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/caf-extrator/varredura/${jobId}`);
        const data = await res.json();
        setJobStatus(data);
        if (data.status === 'concluido' || data.status === 'erro' || data.status === 'pausado') {
          clearInterval(pollInterval.current!);
          setPolling(false);
          queryClient.invalidateQueries({ queryKey: ["/api/norion/caf"] });
          queryClient.invalidateQueries({ queryKey: ["/api/norion/caf/stats"] });
          toast({ title: data.status === 'concluido' ? "Varredura concluída" : data.status === 'erro' ? "Erro na varredura" : "Varredura pausada", description: `Encontrados: ${data.totalEncontrados}, Salvos: ${data.totalSalvos}, Erros: ${data.totalErros}` });
        }
      } catch { }
    }, 2000);
  };

  const startCrawler = async () => {
    try {
      const res = await apiRequest("POST", "/api/caf-extrator/varredura", {
        uf: crawlerUf,
        ano: crawlerAno,
        mes: crawlerMes,
        seqInicio: crawlerModo === 'sequencial' ? crawlerSeqInicio : 1,
        seqFim: crawlerModo === 'sequencial' ? crawlerSeqInicio + crawlerMaxRegistros - 1 : crawlerMaxRegistros,
        municipio: crawlerMunicipio || undefined,
        codIBGE: crawlerCodIBGE || undefined,
        apenasProprietario: crawlerApenasProprietario,
        apenasAtivos: crawlerApenasAtivos,
        apenasComPronaf: crawlerApenasComPronaf,
        areaMinHa: crawlerAreaMinHa || 0,
        areaMaxHa: crawlerAreaMaxHa || 0,
        delayMs: crawlerDelayMs || 1100,
        modo: crawlerModo,
      });
      const data = await res.json();
      setActiveJobId(data.jobId);
      setJobStatus(data.job);
      startPoll(data.jobId);
      toast({ title: "Varredura iniciada", description: `Job ${data.jobId} - ${crawlerUf} ${crawlerAno}/${crawlerMes}` });
    } catch (err: any) {
      toast({ title: "Erro ao iniciar", description: err.message, variant: "destructive" });
    }
  };

  const cancelCrawler = async () => {
    if (!activeJobId) return;
    try {
      await apiRequest("POST", `/api/caf-extrator/varredura/${activeJobId}/cancelar`);
      toast({ title: "Cancelamento solicitado" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const [testNufpaInput, setTestNufpaInput] = useState("");
  const testNufpa = async () => {
    try {
      const nufpa = testNufpaInput.trim();
      if (!nufpa) {
        toast({ title: "Informe um NUFPA", description: "Digite o número NUFPA completo para testar", variant: "destructive" });
        return;
      }
      const res = await fetch(`/api/caf-extrator/testar?nufpa=${encodeURIComponent(nufpa)}`);
      const data = await res.json();
      if (data.success) {
        toast({ title: "NUFPA encontrado!", description: `${data.data.nome} — ${data.data.situacao}` });
      } else {
        toast({ title: "NUFPA não encontrado", description: `${nufpa} — não existe ou portal indisponível.`, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Erro no teste", description: err.message, variant: "destructive" });
    }
  };

  const progress = jobStatus?.modo === 'sequencial'
    ? (jobStatus?.progresso || 0)
    : jobStatus?.paginaAtual && jobStatus?.totalPaginas
      ? (jobStatus.paginaAtual / Math.max(1, jobStatus.totalPaginas)) * 100
      : jobStatus?.progresso ? (jobStatus.progresso / Math.max(1, Math.ceil(crawlerMaxRegistros / 50))) * 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="w-4 h-4" /> Varredura CAF (Crawler v4)
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => setShowCrawler(!showCrawler)} data-testid="button-toggle-crawler">
            {showCrawler ? "Fechar" : "Abrir Painel"}
          </Button>
        </div>
      </CardHeader>
      {showCrawler && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">Modo</Label>
              <Select value={crawlerModo} onValueChange={(v) => setCrawlerModo(v as 'paginado' | 'sequencial')}>
                <SelectTrigger data-testid="crawler-modo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paginado">API Paginada</SelectItem>
                  <SelectItem value="sequencial">Sequencial (NUFPA)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">UF</Label>
              <Select value={crawlerUf} onValueChange={setCrawlerUf}>
                <SelectTrigger data-testid="crawler-uf">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UF_LIST.map(uf => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Máx. Registros</Label>
              <Input type="number" min={10} max={5000} value={crawlerMaxRegistros} onChange={e => setCrawlerMaxRegistros(Number(e.target.value))} data-testid="crawler-max-registros" />
              <p className="text-xs text-muted-foreground mt-1">Quantidade máxima de UFPAs</p>
            </div>
            {crawlerModo === 'sequencial' && (
              <div>
                <Label className="text-xs">Seq. Início</Label>
                <Input type="number" min={1} value={crawlerSeqInicio} onChange={e => setCrawlerSeqInicio(Number(e.target.value))} data-testid="crawler-seq-inicio" />
                <p className="text-xs text-muted-foreground mt-1">Número sequencial inicial</p>
              </div>
            )}
            {crawlerModo === 'paginado' && (
              <div>
                <Label className="text-xs">Cód. IBGE Município</Label>
                <Input placeholder="Ex: 3137601" value={crawlerCodIBGE} onChange={e => setCrawlerCodIBGE(e.target.value)} data-testid="crawler-cod-ibge" />
                <p className="text-xs text-muted-foreground mt-1">Código IBGE (opcional)</p>
              </div>
            )}
            <div>
              <Label className="text-xs">Município (nome)</Label>
              <Input placeholder="Ex: Uberlândia" value={crawlerMunicipio} onChange={e => setCrawlerMunicipio(e.target.value)} data-testid="crawler-municipio" />
              <p className="text-xs text-muted-foreground mt-1">Filtra pós-consulta pelo nome</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">Área Mín. (ha)</Label>
              <Input type="number" min={0} step={1} value={crawlerAreaMinHa || ''} onChange={e => setCrawlerAreaMinHa(Number(e.target.value) || 0)} placeholder="0" data-testid="crawler-area-min" />
              <p className="text-xs text-muted-foreground mt-1">Descarta abaixo deste valor</p>
            </div>
            <div>
              <Label className="text-xs">Área Máx. (ha)</Label>
              <Input type="number" min={0} step={1} value={crawlerAreaMaxHa || ''} onChange={e => setCrawlerAreaMaxHa(Number(e.target.value) || 0)} placeholder="Sem limite" data-testid="crawler-area-max" />
              <p className="text-xs text-muted-foreground mt-1">Descarta acima deste valor (0 = sem limite)</p>
            </div>
            <div>
              <Label className="text-xs">Delay (ms)</Label>
              <Input type="number" min={500} max={10000} step={100} value={crawlerDelayMs} onChange={e => setCrawlerDelayMs(Math.max(500, Number(e.target.value) || 1100))} data-testid="crawler-delay" />
              <p className="text-xs text-muted-foreground mt-1">Intervalo entre requisições (mín 500ms)</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950 p-2 rounded">
              {crawlerModo === 'paginado'
                ? 'Modo Paginado: consulta a API pública do CAF (caf.mda.gov.br). Use código IBGE para filtrar por município. Mais rápido e eficiente.'
                : 'Modo Sequencial: gera NUFPAs sequencialmente e tenta API JSON + fallback HTML scraping. Mais lento, mas extrai dados detalhados (área, PRONAF, etc.).'}
            </div>
            <div className="flex flex-wrap items-end gap-4 pb-1">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={crawlerApenasAtivos} onCheckedChange={(v) => setCrawlerApenasAtivos(!!v)} data-testid="crawler-apenas-ativos" />
                Apenas ativos
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={crawlerApenasProprietario} onCheckedChange={(v) => setCrawlerApenasProprietario(!!v)} data-testid="crawler-apenas-proprietario" />
                Apenas proprietários
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={crawlerApenasComPronaf} onCheckedChange={(v) => setCrawlerApenasComPronaf(!!v)} data-testid="crawler-apenas-pronaf" />
                Apenas PRONAF
              </label>
            </div>
          </div>

          <Separator />

          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="NUFPA para testar (ex: MG032025.01.000073912CAF)"
              value={testNufpaInput}
              onChange={e => setTestNufpaInput(e.target.value)}
              className="max-w-xs text-xs"
              data-testid="input-test-nufpa"
            />
            <Button onClick={testNufpa} variant="outline" size="sm" disabled={polling} data-testid="button-testar-nufpa">
              <Search className="w-4 h-4 mr-1" /> Testar
            </Button>
            <Button onClick={startCrawler} disabled={polling} data-testid="button-iniciar-varredura">
              <Play className="w-4 h-4 mr-1" /> Iniciar Varredura
            </Button>
            {polling && (
              <Button onClick={cancelCrawler} variant="destructive" size="sm" data-testid="button-cancelar-varredura">
                <Square className="w-4 h-4 mr-1" /> Cancelar
              </Button>
            )}
          </div>

          {jobStatus && (
            <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  {polling && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span className="font-medium">
                    {jobStatus.status === 'rodando' ? 'Varrendo...' : jobStatus.status === 'concluido' ? 'Concluído' : jobStatus.status === 'pausado' ? 'Pausado' : jobStatus.status === 'erro' ? 'Erro' : 'Pendente'}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  Página {jobStatus.paginaAtual || jobStatus.progresso || 0}{jobStatus.totalPaginas ? ` de ~${jobStatus.totalPaginas}` : ''}
                </span>
              </div>
              <Progress value={Math.min(progress, 100)} className="h-2" />
              <div className="grid grid-cols-4 gap-2 text-xs text-center">
                <div>
                  <div className="font-bold text-lg" data-testid="crawler-stat-varridos">{jobStatus.totalVaridos || 0}</div>
                  <div className="text-muted-foreground">Varridos</div>
                </div>
                <div>
                  <div className="font-bold text-lg text-green-600" data-testid="crawler-stat-encontrados">{jobStatus.totalEncontrados || 0}</div>
                  <div className="text-muted-foreground">Encontrados</div>
                </div>
                <div>
                  <div className="font-bold text-lg text-blue-600" data-testid="crawler-stat-salvos">{jobStatus.totalSalvos || 0}</div>
                  <div className="text-muted-foreground">Salvos</div>
                </div>
                <div>
                  <div className="font-bold text-lg text-red-500" data-testid="crawler-stat-erros">{jobStatus.totalErros || 0}</div>
                  <div className="text-muted-foreground">Não encontrados</div>
                </div>
              </div>
              {jobStatus.mensagemErro && (
                <div className="text-xs text-red-500 mt-1">{jobStatus.mensagemErro}</div>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function NorionCafPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterGrupo, setFilterGrupo] = useState<string>("");
  const [filterUf, setFilterUf] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterAreaMin, setFilterAreaMin] = useState<string>("");
  const [filterAreaMax, setFilterAreaMax] = useState<string>("");
  const [selectedCaf, setSelectedCaf] = useState<NorionCafRegistro | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const queryParams = new URLSearchParams();
  if (filterGrupo) queryParams.set("grupo", filterGrupo);
  if (filterUf) queryParams.set("uf", filterUf);
  if (filterStatus) queryParams.set("status", filterStatus);
  if (filterAreaMin.trim()) queryParams.set("areaMin", filterAreaMin.trim());
  if (filterAreaMax.trim()) queryParams.set("areaMax", filterAreaMax.trim());
  if (search.trim()) queryParams.set("search", search.trim());
  const qs = queryParams.toString();

  const { data: registros = [], isLoading } = useQuery<NorionCafRegistro[]>({
    queryKey: ["/api/norion/caf", qs],
    queryFn: () => fetch(`/api/norion/caf${qs ? `?${qs}` : ""}`).then(r => r.json()),
  });

  const { data: stats } = useQuery<any>({
    queryKey: ["/api/norion/caf/stats"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/norion/caf/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/caf"] });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/caf/stats"] });
      toast({ title: "Registro excluído" });
      setSelectedCaf(null);
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-100 rounded-lg">
            <Leaf className="w-6 h-6 text-green-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="title-caf">CAF - Agricultura Familiar</h1>
            <p className="text-sm text-muted-foreground">Cadastro Nacional da Agricultura Familiar e PRONAF</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.open("https://caf.mda.gov.br/", "_blank")} data-testid="button-portal-caf">
            <ExternalLink className="w-4 h-4 mr-1" /> Portal CAF
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.open("https://dap.mda.gov.br/", "_blank")} data-testid="button-portal-dap">
            <FileText className="w-4 h-4 mr-1" /> Portal DAP
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowImportDialog(true)} data-testid="button-importar-csv">
            <Upload className="w-4 h-4 mr-1" /> Importar CSV
          </Button>
          <Button onClick={() => setShowCreateDialog(true)} data-testid="button-novo-caf">
            <Plus className="w-4 h-4 mr-1" /> Novo Registro
          </Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground">Total Registros</div>
              <div className="text-2xl font-bold" data-testid="stat-total">{stats.total || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground">CAF Ativos</div>
              <div className="text-2xl font-bold text-green-600" data-testid="stat-ativos">{stats.ativos || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground">Vencidos</div>
              <div className="text-2xl font-bold text-red-500" data-testid="stat-vencidos">{stats.vencidos || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground">Área Total (ha)</div>
              <div className="text-2xl font-bold" data-testid="stat-area">{(stats.totalArea || 0).toLocaleString("pt-BR")}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground">Renda Bruta Total</div>
              <div className="text-xl font-bold" data-testid="stat-renda">{formatCurrency(stats.totalRenda || 0)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {stats && Object.keys(stats.porGrupo || {}).length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Por Grupo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {Object.entries(stats.porGrupo).map(([g, count]: any) => (
                  <Badge key={g} variant="outline" className="text-sm py-1 px-3">
                    Grupo {g}: <span className="font-bold ml-1">{count}</span>
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Por UF (Top 5)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {Object.entries(stats.porUf).sort((a: any, b: any) => b[1] - a[1]).slice(0, 5).map(([uf, count]: any) => (
                  <Badge key={uf} variant="outline" className="text-sm py-1 px-3">
                    {uf}: <span className="font-bold ml-1">{count}</span>
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <CrawlerSection />

      <SicorConsultaSection />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4" /> Registros CAF
              <Badge variant="outline">{registros.length}</Badge>
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.open("/api/norion/caf/exportar-csv", "_blank");
              }}
              disabled={registros.length === 0}
              data-testid="button-exportar-caf-csv"
            >
              <Download className="w-4 h-4 mr-1" /> Baixar CSV
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, CPF, CAF ou município..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-caf"
              />
            </div>
            <Select value={filterGrupo} onValueChange={(v) => setFilterGrupo(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[140px]" data-testid="filter-grupo">
                <Filter className="w-3 h-3 mr-1" /><SelectValue placeholder="Grupo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {GRUPO_OPTIONS.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterUf} onValueChange={(v) => setFilterUf(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[100px]" data-testid="filter-uf">
                <MapPin className="w-3 h-3 mr-1" /><SelectValue placeholder="UF" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {UF_LIST.map(uf => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[120px]" data-testid="filter-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="ativo">Ativo</SelectItem>
                <SelectItem value="vencido">Vencido</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                placeholder="ha mín"
                className="w-[90px]"
                value={filterAreaMin}
                onChange={(e) => setFilterAreaMin(e.target.value)}
                data-testid="filter-area-min"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <Input
                type="number"
                placeholder="ha máx"
                className="w-[90px]"
                value={filterAreaMax}
                onChange={(e) => setFilterAreaMax(e.target.value)}
                data-testid="filter-area-max"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Titular</TableHead>
                <TableHead>CPF</TableHead>
                <TableHead>Nº CAF/DAP</TableHead>
                <TableHead>Grupo</TableHead>
                <TableHead>Município/UF</TableHead>
                <TableHead>Área (ha)</TableHead>
                <TableHead>Renda Bruta</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Validade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : registros.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  Nenhum registro encontrado. Clique em "Novo Registro" ou "Importar CSV" para começar.
                </TableCell></TableRow>
              ) : registros.map((r) => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedCaf(r)} data-testid={`row-caf-${r.id}`}>
                  <TableCell className="font-medium" data-testid={`text-nome-${r.id}`}>{r.nomeTitular}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.cpfTitular || "—"}</TableCell>
                  <TableCell className="text-sm">{r.numeroCAF || r.numeroDAPAntigo || "—"}</TableCell>
                  <TableCell>
                    {r.grupo ? <Badge variant="outline" className="text-xs">{r.grupo}</Badge> : "—"}
                  </TableCell>
                  <TableCell className="text-sm">{[r.municipio, r.uf].filter(Boolean).join("/") || "—"}</TableCell>
                  <TableCell className="text-sm">{r.areaHa ? `${r.areaHa.toLocaleString("pt-BR")} ha` : "—"}</TableCell>
                  <TableCell className="text-sm">{r.rendaBrutaAnual ? formatCurrency(r.rendaBrutaAnual) : "—"}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-sm">{r.validade || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={!!selectedCaf} onOpenChange={(o) => { if (!o) setSelectedCaf(null); }}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {selectedCaf && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Leaf className="w-5 h-5 text-green-600" />
                  {selectedCaf.nomeTitular}
                </SheetTitle>
                <SheetDescription>Registro CAF #{selectedCaf.id}</SheetDescription>
              </SheetHeader>
              <CafDetailPanel
                registro={selectedCaf}
                onClose={() => setSelectedCaf(null)}
                onDelete={() => deleteMutation.mutate(selectedCaf.id)}
              />
            </>
          )}
        </SheetContent>
      </Sheet>

      <CreateCafDialog open={showCreateDialog} onClose={() => setShowCreateDialog(false)} />
      <ImportCsvDialog open={showImportDialog} onClose={() => setShowImportDialog(false)} />
    </div>
  );
}

function CafDetailPanel({ registro, onClose, onDelete }: { registro: NorionCafRegistro; onClose: () => void; onDelete: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    nomeTitular: registro.nomeTitular || "",
    cpfTitular: registro.cpfTitular || "",
    numeroUFPA: (registro as any).numeroUFPA || "",
    numeroCAF: registro.numeroCAF || "",
    numeroDAPAntigo: registro.numeroDAPAntigo || "",
    grupo: registro.grupo || "",
    enquadramentoPronaf: (registro as any).enquadramentoPronaf || "",
    validade: registro.validade || "",
    dataInscricao: (registro as any).dataInscricao || "",
    ultimaAtualizacao: (registro as any).ultimaAtualizacao || "",
    municipio: registro.municipio || "",
    uf: registro.uf || "",
    areaHa: registro.areaHa ? String(registro.areaHa) : "",
    totalEstabelecimentoHa: (registro as any).totalEstabelecimentoHa ? String((registro as any).totalEstabelecimentoHa) : "",
    totalEstabelecimentoM3: (registro as any).totalEstabelecimentoM3 ? String((registro as any).totalEstabelecimentoM3) : "",
    numImoveis: (registro as any).numImoveis ? String((registro as any).numImoveis) : "1",
    condicaoPosse: (registro as any).condicaoPosse || "",
    atividadePrincipal: (registro as any).atividadePrincipal || "",
    caracterizacaoUfpa: (registro as any).caracterizacaoUfpa || "",
    atividadesProdutivas: registro.atividadesProdutivas || "",
    rendaBrutaAnual: registro.rendaBrutaAnual ? String(registro.rendaBrutaAnual) : "",
    entidadeNome: (registro as any).entidadeNome || "",
    entidadeCnpj: (registro as any).entidadeCnpj || "",
    cadastrador: (registro as any).cadastrador || "",
    observacoes: registro.observacoes || "",
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/norion/caf/${registro.id}`, data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/caf"] });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/caf/stats"] });
      toast({ title: "Registro atualizado" });
      setEditing(false);
      if (data && data.id) {
        Object.assign(registro, data);
      }
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const { data: pronafLinhas } = useQuery<any[]>({
    queryKey: ["/api/norion/pronaf/linhas", registro.grupo, registro.rendaBrutaAnual],
    queryFn: () => {
      const params = new URLSearchParams();
      if (registro.grupo) params.set("grupo", registro.grupo);
      if (registro.rendaBrutaAnual) params.set("renda", String(registro.rendaBrutaAnual));
      return fetch(`/api/norion/pronaf/linhas?${params}`).then(r => r.json());
    },
    enabled: !!registro.grupo,
  });

  const { data: sicorData } = useQuery<any>({
    queryKey: ["/api/norion/sicor", registro.codigoMunicipio],
    queryFn: () => fetch(`/api/norion/sicor/${registro.codigoMunicipio}`).then(r => r.json()),
    enabled: !!registro.codigoMunicipio,
  });

  const consultaDapMutation = useMutation({
    mutationFn: async () => {
      const cpf = (registro.cpfTitular || "").replace(/\D/g, "");
      if (!cpf || cpf.length !== 11) throw new Error("CPF inválido para consulta");
      const res = await fetch(`/api/norion/caf/consulta-dap/${cpf}`);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.encontrado) {
        toast({ title: "DAP encontrada", description: data.mensagem });
      } else {
        toast({ title: "Consulta realizada", description: data.mensagem });
        if (data.dapPortalUrl) window.open(data.dapPortalUrl, "_blank");
      }
    },
    onError: (err: any) => toast({ title: "Erro na consulta", description: err.message, variant: "destructive" }),
  });

  function handleSave() {
    const payload: any = { ...form };
    if (payload.areaHa) payload.areaHa = parseFloat(payload.areaHa); else payload.areaHa = null;
    if (payload.rendaBrutaAnual) payload.rendaBrutaAnual = parseFloat(payload.rendaBrutaAnual); else payload.rendaBrutaAnual = null;
    if (payload.totalEstabelecimentoHa) payload.totalEstabelecimentoHa = parseFloat(payload.totalEstabelecimentoHa); else delete payload.totalEstabelecimentoHa;
    if (payload.totalEstabelecimentoM3) payload.totalEstabelecimentoM3 = parseFloat(payload.totalEstabelecimentoM3); else delete payload.totalEstabelecimentoM3;
    if (payload.numImoveis) payload.numImoveis = parseInt(payload.numImoveis); else delete payload.numImoveis;
    Object.keys(payload).forEach(k => { if (payload[k] === "") delete payload[k]; });
    saveMutation.mutate(payload);
  }

  const r: any = registro;
  const composicao: any[] = Array.isArray(r.composicaoFamiliar) ? r.composicaoFamiliar : [];

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between">
        <StatusBadge status={registro.status} />
        <div className="flex items-center gap-2">
          {registro.cpfTitular && (
            <Button variant="outline" size="sm" onClick={() => consultaDapMutation.mutate()} disabled={consultaDapMutation.isPending} data-testid="button-consultar-dap">
              <Search className="w-3 h-3 mr-1" /> Consultar DAP
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setEditing(!editing)} data-testid="button-editar-registro">
            <Edit2 className="w-3 h-3 mr-1" /> {editing ? "Cancelar" : "Editar"}
          </Button>
          <Button variant="destructive" size="sm" onClick={onDelete} data-testid="button-excluir-registro">
            <Trash2 className="w-3 h-3 mr-1" /> Excluir
          </Button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-3 border rounded-lg p-4 bg-green-50/30">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Nome Titular</Label>
              <Input value={form.nomeTitular} onChange={(e) => setForm(p => ({ ...p, nomeTitular: e.target.value }))} data-testid="edit-nome" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CPF</Label>
              <Input value={form.cpfTitular} onChange={(e) => setForm(p => ({ ...p, cpfTitular: e.target.value }))} data-testid="edit-cpf" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Nº UFPA</Label>
              <Input value={form.numeroUFPA} onChange={(e) => setForm(p => ({ ...p, numeroUFPA: e.target.value }))} data-testid="edit-ufpa" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nº CAF</Label>
              <Input value={form.numeroCAF} onChange={(e) => setForm(p => ({ ...p, numeroCAF: e.target.value }))} data-testid="edit-caf" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nº DAP (antigo)</Label>
              <Input value={form.numeroDAPAntigo} onChange={(e) => setForm(p => ({ ...p, numeroDAPAntigo: e.target.value }))} data-testid="edit-dap" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Grupo</Label>
              <Select value={form.grupo} onValueChange={(v) => setForm(p => ({ ...p, grupo: v }))}>
                <SelectTrigger data-testid="edit-grupo"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{GRUPO_OPTIONS.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Enquadramento PRONAF</Label>
              <Input value={form.enquadramentoPronaf} onChange={(e) => setForm(p => ({ ...p, enquadramentoPronaf: e.target.value }))} data-testid="edit-enquadramento" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data Inscrição</Label>
              <Input type="date" value={form.dataInscricao} onChange={(e) => setForm(p => ({ ...p, dataInscricao: e.target.value }))} data-testid="edit-data-inscricao" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Validade</Label>
              <Input type="date" value={form.validade} onChange={(e) => setForm(p => ({ ...p, validade: e.target.value }))} data-testid="edit-validade" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Município</Label>
              <Input value={form.municipio} onChange={(e) => setForm(p => ({ ...p, municipio: e.target.value }))} data-testid="edit-municipio" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">UF</Label>
              <Select value={form.uf} onValueChange={(v) => setForm(p => ({ ...p, uf: v }))}>
                <SelectTrigger data-testid="edit-uf"><SelectValue placeholder="UF" /></SelectTrigger>
                <SelectContent>{UF_LIST.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Área Imóvel Principal (ha)</Label>
              <Input type="number" value={form.areaHa} onChange={(e) => setForm(p => ({ ...p, areaHa: e.target.value }))} data-testid="edit-area" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Total Estabelecimento (ha)</Label>
              <Input type="number" value={form.totalEstabelecimentoHa} onChange={(e) => setForm(p => ({ ...p, totalEstabelecimentoHa: e.target.value }))} data-testid="edit-total-ha" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Total Estabelecimento (m³)</Label>
              <Input type="number" value={form.totalEstabelecimentoM3} onChange={(e) => setForm(p => ({ ...p, totalEstabelecimentoM3: e.target.value }))} data-testid="edit-total-m3" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nº Imóveis</Label>
              <Input type="number" value={form.numImoveis} onChange={(e) => setForm(p => ({ ...p, numImoveis: e.target.value }))} data-testid="edit-num-imoveis" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Condição de Posse</Label>
              <Select value={form.condicaoPosse} onValueChange={(v) => setForm(p => ({ ...p, condicaoPosse: v }))}>
                <SelectTrigger data-testid="edit-condicao-posse"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{CONDICAO_POSSE_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Renda Bruta Anual (R$)</Label>
              <Input type="number" value={form.rendaBrutaAnual} onChange={(e) => setForm(p => ({ ...p, rendaBrutaAnual: e.target.value }))} data-testid="edit-renda" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Atividade Principal</Label>
              <Input value={form.atividadePrincipal} onChange={(e) => setForm(p => ({ ...p, atividadePrincipal: e.target.value }))} data-testid="edit-atividade-principal" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Atividades Produtivas</Label>
              <Textarea value={form.atividadesProdutivas} onChange={(e) => setForm(p => ({ ...p, atividadesProdutivas: e.target.value }))} rows={2} data-testid="edit-atividades" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Caracterização da UFPA</Label>
              <Input value={form.caracterizacaoUfpa} onChange={(e) => setForm(p => ({ ...p, caracterizacaoUfpa: e.target.value }))} data-testid="edit-caracterizacao" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Entidade Responsável</Label>
              <Input value={form.entidadeNome} onChange={(e) => setForm(p => ({ ...p, entidadeNome: e.target.value }))} data-testid="edit-entidade" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CNPJ Entidade</Label>
              <Input value={form.entidadeCnpj} onChange={(e) => setForm(p => ({ ...p, entidadeCnpj: e.target.value }))} data-testid="edit-entidade-cnpj" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cadastrador</Label>
              <Input value={form.cadastrador} onChange={(e) => setForm(p => ({ ...p, cadastrador: e.target.value }))} data-testid="edit-cadastrador" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Observações</Label>
            <Textarea value={form.observacoes} onChange={(e) => setForm(p => ({ ...p, observacoes: e.target.value }))} rows={2} data-testid="edit-observacoes" />
          </div>
          <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-salvar-edicao">
            <Save className="w-4 h-4 mr-1" /> Salvar Alterações
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Informações da UFPA</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">CPF:</span> <span data-testid="detail-cpf">{registro.cpfTitular || "—"}</span></div>
              <div><span className="text-muted-foreground">Grupo:</span> <span data-testid="detail-grupo">{registro.grupo || "—"}</span></div>
              {r.numeroUFPA && <div className="col-span-2"><span className="text-muted-foreground">Nº UFPA:</span> <span className="font-mono text-xs" data-testid="detail-ufpa">{r.numeroUFPA}</span></div>}
              <div><span className="text-muted-foreground">Nº CAF:</span> <span data-testid="detail-caf">{registro.numeroCAF || "—"}</span></div>
              <div><span className="text-muted-foreground">Nº DAP:</span> <span data-testid="detail-dap">{registro.numeroDAPAntigo || "—"}</span></div>
              {r.enquadramentoPronaf && <div><span className="text-muted-foreground">Enquadramento:</span> {r.enquadramentoPronaf}</div>}
              <div><span className="text-muted-foreground">Validade:</span> <span data-testid="detail-validade">{registro.validade || "—"}</span></div>
              {r.dataInscricao && <div><span className="text-muted-foreground">Inscrição:</span> {r.dataInscricao}</div>}
              {r.ultimaAtualizacao && <div><span className="text-muted-foreground">Última Atualização:</span> {r.ultimaAtualizacao}</div>}
            </div>
          </div>

          <Separator />
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Propriedade</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">Município:</span> <span data-testid="detail-municipio">{[registro.municipio, registro.uf].filter(Boolean).join("/") || "—"}</span></div>
              <div><span className="text-muted-foreground">Área Imóvel:</span> <span data-testid="detail-area">{registro.areaHa ? `${registro.areaHa.toLocaleString("pt-BR")} ha` : "—"}</span></div>
              {r.totalEstabelecimentoHa && <div><span className="text-muted-foreground">Total Estab.:</span> {r.totalEstabelecimentoHa.toLocaleString("pt-BR")} ha</div>}
              {r.totalEstabelecimentoM3 && <div><span className="text-muted-foreground">Total Estab. (m³):</span> {r.totalEstabelecimentoM3.toLocaleString("pt-BR")}</div>}
              {r.numImoveis && <div><span className="text-muted-foreground">Nº Imóveis:</span> {r.numImoveis}</div>}
              {r.condicaoPosse && <div><span className="text-muted-foreground">Posse:</span> {r.condicaoPosse}</div>}
              <div><span className="text-muted-foreground">Renda Bruta:</span> <span data-testid="detail-renda">{registro.rendaBrutaAnual ? formatCurrency(registro.rendaBrutaAnual) : "—"}</span></div>
            </div>
            {r.atividadePrincipal && (
              <div className="text-sm"><span className="text-muted-foreground">Atividade Principal:</span> {r.atividadePrincipal}</div>
            )}
            {registro.atividadesProdutivas && (
              <div className="text-sm"><span className="text-muted-foreground">Atividades:</span> <span data-testid="detail-atividades">{registro.atividadesProdutivas}</span></div>
            )}
            {r.caracterizacaoUfpa && (
              <div className="text-sm"><span className="text-muted-foreground">Caracterização:</span> {r.caracterizacaoUfpa}</div>
            )}
          </div>

          {composicao.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Composição Familiar <Badge variant="outline" className="text-[10px] ml-1">{composicao.length}</Badge></h4>
                <div className="space-y-1.5">
                  {composicao.map((m: any, i: number) => (
                    <div key={i} className="border rounded px-2.5 py-1.5 text-xs flex items-center justify-between" data-testid={`familiar-view-${i}`}>
                      <div>
                        <span className="font-medium">{m.nome}</span>
                        {m.cpf && <span className="text-muted-foreground ml-2">{m.cpf}</span>}
                      </div>
                      <div className="text-muted-foreground text-right">
                        {m.parentesco && <span>{m.parentesco}</span>}
                        {m.dataInclusao && <span className="ml-2">{m.dataInclusao}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {(r.entidadeNome || r.cadastrador) && (
            <>
              <Separator />
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Entidade Responsável</h4>
                <div className="text-sm space-y-1">
                  {r.entidadeNome && <div><span className="text-muted-foreground">Entidade:</span> {r.entidadeNome}</div>}
                  {r.entidadeCnpj && <div><span className="text-muted-foreground">CNPJ:</span> {r.entidadeCnpj}</div>}
                  {r.cadastrador && <div><span className="text-muted-foreground">Cadastrador:</span> {r.cadastrador}</div>}
                </div>
              </div>
            </>
          )}

          {registro.observacoes && (
            <div className="text-sm"><span className="text-muted-foreground">Observações:</span> <p className="mt-1">{registro.observacoes}</p></div>
          )}
        </div>
      )}

      {pronafLinhas && pronafLinhas.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4 text-green-600" /> Linhas PRONAF Elegíveis
              <Badge variant="outline" className="text-xs">{pronafLinhas.length}</Badge>
            </h3>
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {pronafLinhas.map((l: any) => (
                <div key={l.id} className="border rounded-md p-2.5 text-xs hover:bg-green-50/50" data-testid={`pronaf-linha-${l.id}`}>
                  <div className="font-medium">{l.nome}</div>
                  <div className="flex items-center gap-3 mt-1 text-muted-foreground">
                    <span>Taxa: {l.taxa}% a.a.</span>
                    <span>Limite: {formatCurrency(l.limite)}</span>
                    <span>Prazo: {l.prazoMaximo}</span>
                  </div>
                  <div className="mt-0.5 text-muted-foreground">
                    Grupos: {l.gruposElegiveis?.join(", ")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {sicorData && (
        <>
          <Separator />
          <div className="space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-blue-600" /> Crédito Rural na Região
            </h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="border rounded p-2">
                <div className="text-xs text-muted-foreground">Contratos PRONAF</div>
                <div className="font-bold">{sicorData.totalContratos?.toLocaleString("pt-BR") || 0}</div>
              </div>
              <div className="border rounded p-2">
                <div className="text-xs text-muted-foreground">Volume</div>
                <div className="font-bold">{formatCurrency(sicorData.totalValor || 0)}</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const CONDICAO_POSSE_OPTIONS = [
  "Proprietário", "Arrendatário", "Parceiro", "Meeiro", "Comodatário",
  "Posseiro", "Assentado", "Concessionário", "Quilombola", "Indígena", "Outro",
];

function CreateCafDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const emptyForm = {
    nomeTitular: "", cpfTitular: "", numeroUFPA: "", numeroCAF: "", numeroDAPAntigo: "",
    grupo: "", enquadramentoPronaf: "", validade: "", dataInscricao: "", ultimaAtualizacao: "",
    municipio: "", uf: "", areaHa: "", totalEstabelecimentoHa: "", totalEstabelecimentoM3: "",
    numImoveis: "1", condicaoPosse: "", atividadePrincipal: "", caracterizacaoUfpa: "",
    atividadesProdutivas: "", rendaBrutaAnual: "",
    entidadeNome: "", entidadeCnpj: "", cadastrador: "", observacoes: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [familiarRows, setFamiliarRows] = useState<{ nome: string; cpf: string; parentesco: string; dataInclusao: string }[]>([]);
  const [tab, setTab] = useState<"info" | "propriedade" | "familia" | "entidade">("info");

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/norion/caf", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/caf"] });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/caf/stats"] });
      toast({ title: "Registro CAF criado" });
      onClose();
      setForm(emptyForm);
      setFamiliarRows([]);
      setTab("info");
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  function handleSubmit() {
    if (!form.nomeTitular.trim()) {
      toast({ title: "Preencha o nome do titular", variant: "destructive" });
      return;
    }
    const payload: any = { ...form };
    if (payload.areaHa) payload.areaHa = parseFloat(payload.areaHa); else delete payload.areaHa;
    if (payload.rendaBrutaAnual) payload.rendaBrutaAnual = parseFloat(payload.rendaBrutaAnual); else delete payload.rendaBrutaAnual;
    if (payload.totalEstabelecimentoHa) payload.totalEstabelecimentoHa = parseFloat(payload.totalEstabelecimentoHa); else delete payload.totalEstabelecimentoHa;
    if (payload.totalEstabelecimentoM3) payload.totalEstabelecimentoM3 = parseFloat(payload.totalEstabelecimentoM3); else delete payload.totalEstabelecimentoM3;
    if (payload.numImoveis) payload.numImoveis = parseInt(payload.numImoveis); else delete payload.numImoveis;
    payload.composicaoFamiliar = familiarRows.filter(r => r.nome.trim());
    Object.keys(payload).forEach(k => { if (payload[k] === "") delete payload[k]; });
    createMutation.mutate(payload);
  }

  const F = (field: string) => (e: any) => setForm(p => ({ ...p, [field]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Leaf className="w-5 h-5 text-green-600" /> Novo Registro CAF — Extrato UFPA</DialogTitle>
          <DialogDescription>Cadastre os dados do extrato público da Unidade Familiar de Produção Agrária.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 border-b mt-2 mb-3">
          {[
            { id: "info" as const, label: "Informações" },
            { id: "propriedade" as const, label: "Propriedade" },
            { id: "familia" as const, label: "Composição Familiar" },
            { id: "entidade" as const, label: "Entidade" },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${tab === t.id ? "border-green-600 text-green-700" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              data-testid={`tab-${t.id}`}
            >{t.label}</button>
          ))}
        </div>

        {tab === "info" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Nome Titular (Declarante) *</Label>
              <Input value={form.nomeTitular} onChange={F("nomeTitular")} placeholder="Nome completo" data-testid="create-nome" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CPF</Label>
              <Input value={form.cpfTitular} onChange={F("cpfTitular")} placeholder="000.000.000-00" data-testid="create-cpf" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Nº UFPA</Label>
              <Input value={form.numeroUFPA} onChange={F("numeroUFPA")} placeholder="RS032025.01.002731822CAF" data-testid="create-ufpa" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nº CAF</Label>
              <Input value={form.numeroCAF} onChange={F("numeroCAF")} data-testid="create-caf" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nº DAP (antigo)</Label>
              <Input value={form.numeroDAPAntigo} onChange={F("numeroDAPAntigo")} data-testid="create-dap" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Grupo PRONAF</Label>
              <Select value={form.grupo} onValueChange={(v) => setForm(p => ({ ...p, grupo: v }))}>
                <SelectTrigger data-testid="create-grupo"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {GRUPO_OPTIONS.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Enquadramento PRONAF</Label>
              <Input value={form.enquadramentoPronaf} onChange={F("enquadramentoPronaf")} placeholder="Ex: PRONAF V" data-testid="create-enquadramento" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data de Inscrição</Label>
              <Input type="date" value={form.dataInscricao} onChange={F("dataInscricao")} data-testid="create-data-inscricao" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data de Validade</Label>
              <Input type="date" value={form.validade} onChange={F("validade")} data-testid="create-validade" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Última Atualização</Label>
              <Input type="date" value={form.ultimaAtualizacao} onChange={F("ultimaAtualizacao")} data-testid="create-ultima-atualizacao" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Situação</Label>
              <Badge variant={form.validade && new Date(form.validade) > new Date() ? "default" : "destructive"} className="mt-1">
                {form.validade && new Date(form.validade) > new Date() ? "ATIVA" : form.validade ? "INATIVA" : "—"}
              </Badge>
            </div>
          </div>
        )}

        {tab === "propriedade" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Município</Label>
              <Input value={form.municipio} onChange={F("municipio")} placeholder="Ex: Lagoa Vermelha" data-testid="create-municipio" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">UF</Label>
              <Select value={form.uf} onValueChange={(v) => setForm(p => ({ ...p, uf: v }))}>
                <SelectTrigger data-testid="create-uf"><SelectValue placeholder="UF" /></SelectTrigger>
                <SelectContent>{UF_LIST.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Área do Imóvel Principal (ha)</Label>
              <Input type="number" step="0.01" value={form.areaHa} onChange={F("areaHa")} data-testid="create-area" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Total Estabelecimento (ha)</Label>
              <Input type="number" step="0.01" value={form.totalEstabelecimentoHa} onChange={F("totalEstabelecimentoHa")} data-testid="create-total-ha" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Total Estabelecimento (m³)</Label>
              <Input type="number" step="0.01" value={form.totalEstabelecimentoM3} onChange={F("totalEstabelecimentoM3")} data-testid="create-total-m3" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nº de Imóveis Explorados</Label>
              <Input type="number" value={form.numImoveis} onChange={F("numImoveis")} data-testid="create-num-imoveis" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Condição de Posse</Label>
              <Select value={form.condicaoPosse} onValueChange={(v) => setForm(p => ({ ...p, condicaoPosse: v }))}>
                <SelectTrigger data-testid="create-condicao-posse"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {CONDICAO_POSSE_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Renda Bruta Anual (R$)</Label>
              <Input type="number" value={form.rendaBrutaAnual} onChange={F("rendaBrutaAnual")} data-testid="create-renda" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Atividade Principal</Label>
              <Input value={form.atividadePrincipal} onChange={F("atividadePrincipal")} placeholder="Agricultura, Pecuária e Outras atividades" data-testid="create-atividade-principal" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Atividades Produtivas</Label>
              <Textarea value={form.atividadesProdutivas} onChange={F("atividadesProdutivas")} rows={2} placeholder="Soja, Milho, Gado, etc." data-testid="create-atividades" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Caracterização da UFPA</Label>
              <Input value={form.caracterizacaoUfpa} onChange={F("caracterizacaoUfpa")} placeholder="Ex: Nenhuma das opções" data-testid="create-caracterizacao" />
            </div>
          </div>
        )}

        {tab === "familia" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Membros da Unidade Familiar de Produção Agrária conforme extrato.</p>
            {familiarRows.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_140px_160px_120px_32px] gap-2 items-end">
                <div className="space-y-1">
                  <Label className="text-[10px]">Nome</Label>
                  <Input className="h-8 text-xs" value={row.nome} onChange={(e) => {
                    const upd = [...familiarRows]; upd[i].nome = e.target.value; setFamiliarRows(upd);
                  }} data-testid={`familiar-nome-${i}`} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">CPF</Label>
                  <Input className="h-8 text-xs" value={row.cpf} onChange={(e) => {
                    const upd = [...familiarRows]; upd[i].cpf = e.target.value; setFamiliarRows(upd);
                  }} data-testid={`familiar-cpf-${i}`} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Parentesco</Label>
                  <Input className="h-8 text-xs" value={row.parentesco} onChange={(e) => {
                    const upd = [...familiarRows]; upd[i].parentesco = e.target.value; setFamiliarRows(upd);
                  }} placeholder="Declarante, Cônjuge..." data-testid={`familiar-parentesco-${i}`} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Data Inclusão</Label>
                  <Input type="date" className="h-8 text-xs" value={row.dataInclusao} onChange={(e) => {
                    const upd = [...familiarRows]; upd[i].dataInclusao = e.target.value; setFamiliarRows(upd);
                  }} data-testid={`familiar-data-${i}`} />
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setFamiliarRows(familiarRows.filter((_, idx) => idx !== i))} data-testid={`familiar-remover-${i}`}>
                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setFamiliarRows([...familiarRows, { nome: "", cpf: "", parentesco: "", dataInclusao: "" }])} data-testid="button-add-familiar">
              <Plus className="w-3.5 h-3.5 mr-1" /> Adicionar Membro
            </Button>
          </div>
        )}

        {tab === "entidade" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Entidade Responsável pela Inscrição</Label>
              <Input value={form.entidadeNome} onChange={F("entidadeNome")} placeholder="Ex: ASSOC RIOGR DE EMPR DE ASSIST TEC..." data-testid="create-entidade-nome" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CNPJ da Entidade</Label>
              <Input value={form.entidadeCnpj} onChange={F("entidadeCnpj")} placeholder="00.000.000/0000-00" data-testid="create-entidade-cnpj" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cadastrador</Label>
              <Input value={form.cadastrador} onChange={F("cadastrador")} placeholder="Nome do cadastrador" data-testid="create-cadastrador" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Observações</Label>
              <Textarea value={form.observacoes} onChange={F("observacoes")} rows={2} data-testid="create-observacoes" />
            </div>
          </div>
        )}

        <DialogFooter className="mt-3">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending} data-testid="button-criar-caf">
            <Plus className="w-4 h-4 mr-1" /> Criar Registro
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportCsvDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvData, setCsvData] = useState<any[]>([]);
  const [fileName, setFileName] = useState("");

  const importMutation = useMutation({
    mutationFn: async (registros: any[]) => {
      const res = await apiRequest("POST", "/api/norion/caf/importar-csv", { registros });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/caf"] });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/caf/stats"] });
      toast({ title: `${data.importados} registros importados` });
      onClose();
      setCsvData([]);
      setFileName("");
    },
    onError: (err: any) => toast({ title: "Erro na importação", description: err.message, variant: "destructive" }),
  });

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").filter(l => l.trim());
      if (lines.length < 2) { toast({ title: "Arquivo vazio ou inválido", variant: "destructive" }); return; }
      const headers = lines[0].split(";").map(h => h.trim().replace(/"/g, ""));
      const rows = lines.slice(1).map(line => {
        const cols = line.split(";").map(c => c.trim().replace(/"/g, ""));
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = cols[i] || ""; });
        return obj;
      });
      setCsvData(rows);
    };
    reader.readAsText(file, "utf-8");
  }

  const headerMap: Record<string, string> = {
    "NOME": "nomeTitular", "nome": "nomeTitular", "Nome": "nomeTitular", "nome_titular": "nomeTitular",
    "CPF": "cpfTitular", "cpf": "cpfTitular", "cpf_titular": "cpfTitular",
    "CAF": "numeroCAF", "caf": "numeroCAF", "numero_caf": "numeroCAF", "NUMERO_CAF": "numeroCAF",
    "DAP": "numeroDAPAntigo", "dap": "numeroDAPAntigo", "numero_dap": "numeroDAPAntigo",
    "GRUPO": "grupo", "grupo": "grupo",
    "VALIDADE": "validade", "validade": "validade",
    "MUNICIPIO": "municipio", "municipio": "municipio", "Municipio": "municipio",
    "UF": "uf", "uf": "uf",
    "AREA": "areaHa", "area": "areaHa", "area_ha": "areaHa",
    "ATIVIDADES": "atividadesProdutivas", "atividades": "atividadesProdutivas",
    "RENDA": "rendaBrutaAnual", "renda": "rendaBrutaAnual", "renda_bruta": "rendaBrutaAnual",
  };

  function mapRow(row: Record<string, string>): Record<string, string> {
    const mapped: Record<string, string> = {};
    Object.entries(row).forEach(([key, val]) => {
      const mappedKey = headerMap[key] || key;
      mapped[mappedKey] = val;
    });
    return mapped;
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setCsvData([]); setFileName(""); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="w-5 h-5 text-green-600" /> Importar CSV</DialogTitle>
          <DialogDescription>
            Importe registros CAF/DAP em lote a partir de um arquivo CSV (separador ponto-e-vírgula).
            Colunas aceitas: NOME, CPF, CAF, DAP, GRUPO, VALIDADE, MUNICIPIO, UF, AREA, ATIVIDADES, RENDA.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} data-testid="button-selecionar-csv">
              <Upload className="w-4 h-4 mr-1" /> Selecionar Arquivo
            </Button>
            <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileSelect} />
            {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
          </div>
          {csvData.length > 0 && (
            <>
              <div className="text-sm font-medium">{csvData.length} registros encontrados</div>
              <div className="max-h-[300px] overflow-auto border rounded">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      {Object.keys(csvData[0]).slice(0, 6).map(k => <TableHead key={k} className="text-xs">{k}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {csvData.slice(0, 10).map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{i + 1}</TableCell>
                        {Object.values(row).slice(0, 6).map((v: any, j) => (
                          <TableCell key={j} className="text-xs">{v}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                    {csvData.length > 10 && (
                      <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground">... e mais {csvData.length - 10} registros</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); setCsvData([]); setFileName(""); }}>Cancelar</Button>
          <Button
            onClick={() => importMutation.mutate(csvData.map(mapRow))}
            disabled={csvData.length === 0 || importMutation.isPending}
            data-testid="button-confirmar-import"
          >
            <Download className="w-4 h-4 mr-1" /> Importar {csvData.length} Registros
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SicorConsultaSection() {
  const { toast } = useToast();
  const [uf, setUf] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [ano, setAno] = useState("2024");
  const [tipo, setTipo] = useState("custeio");
  const [consultaAtiva, setConsultaAtiva] = useState(false);

  const queryParams = new URLSearchParams();
  if (uf) queryParams.set("uf", uf);
  if (municipio.trim()) queryParams.set("municipio", municipio.trim());
  if (ano) queryParams.set("ano", ano);
  queryParams.set("tipo", tipo);
  queryParams.set("top", "100");
  const queryPath = `/api/norion/sicor/consulta?${queryParams.toString()}`;

  const { data: resultado, isLoading, isError, refetch } = useQuery<any>({
    queryKey: ["/api/norion/sicor/consulta", uf, municipio, ano, tipo],
    queryFn: async () => {
      const res = await fetch(queryPath, { credentials: "include" });
      if (!res.ok) throw new Error("Falha na consulta SICOR");
      return res.json();
    },
    enabled: consultaAtiva && uf.length === 2,
    retry: 1,
    staleTime: 60 * 60 * 1000,
  });

  function handleConsultar() {
    if (!uf) {
      toast({ title: "Selecione um estado (UF)", variant: "destructive" });
      return;
    }
    setConsultaAtiva(true);
    refetch();
  }

  const anoOptions = [];
  for (let y = 2024; y >= 2013; y--) anoOptions.push(String(y));

  return (
    <Card data-testid="sicor-consulta-section">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="w-4 h-4 text-blue-600" /> Consulta SICOR/BCB — Crédito Rural PRONAF
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Dados oficiais do Sistema de Operações do Crédito Rural (SICOR) do Banco Central do Brasil.
          Filtre por estado, município, ano e tipo de operação para ver contratos PRONAF.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Estado (UF) *</Label>
            <Select value={uf} onValueChange={setUf}>
              <SelectTrigger className="w-[100px]" data-testid="sicor-filter-uf">
                <SelectValue placeholder="UF" />
              </SelectTrigger>
              <SelectContent>
                {UF_LIST.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Município</Label>
            <Input
              className="w-[180px]"
              placeholder="Ex: Uberaba"
              value={municipio}
              onChange={(e) => setMunicipio(e.target.value)}
              data-testid="sicor-filter-municipio"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Ano</Label>
            <Select value={ano} onValueChange={setAno}>
              <SelectTrigger className="w-[100px]" data-testid="sicor-filter-ano">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {anoOptions.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tipo</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger className="w-[140px]" data-testid="sicor-filter-tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custeio">Custeio</SelectItem>
                <SelectItem value="investimento">Investimento</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleConsultar} disabled={isLoading} data-testid="button-consultar-sicor">
            {isLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
            Consultar
          </Button>
        </div>

        {isError && (
          <div className="border border-red-200 bg-red-50 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2" data-testid="sicor-error">
            <AlertTriangle className="w-4 h-4" />
            A API do Banco Central pode estar instável. Tente novamente em alguns segundos.
          </div>
        )}

        {isLoading && (
          <div className="space-y-3" data-testid="sicor-loading">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[0,1,2,3].map(i => (
                <div key={i} className="border rounded-lg p-3 animate-pulse">
                  <div className="h-3 w-20 bg-muted rounded mb-2" />
                  <div className="h-6 w-24 bg-muted rounded" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[0,1].map(i => (
                <div key={i} className="space-y-2">
                  <div className="h-4 w-32 bg-muted rounded animate-pulse" />
                  {[0,1,2].map(j => (
                    <div key={j} className="h-8 bg-muted rounded animate-pulse" />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {resultado && !isLoading && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="border rounded-lg p-3">
                <div className="text-xs text-muted-foreground">Total Contratos</div>
                <div className="text-xl font-bold" data-testid="sicor-total-registros">
                  {(resultado.totalContratos || resultado.totalRegistros).toLocaleString("pt-BR")}
                </div>
                <div className="text-[10px] text-muted-foreground">{resultado.totalRegistros} registros</div>
              </div>
              <div className="border rounded-lg p-3">
                <div className="text-xs text-muted-foreground">Volume Total</div>
                <div className="text-xl font-bold text-green-600" data-testid="sicor-total-valor">{formatCurrency(resultado.totalValor)}</div>
              </div>
              <div className="border rounded-lg p-3">
                <div className="text-xs text-muted-foreground">Área Total</div>
                <div className="text-xl font-bold">{resultado.totalArea.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} ha</div>
              </div>
              <div className="border rounded-lg p-3">
                <div className="text-xs text-muted-foreground">Tipo</div>
                <div className="text-xl font-bold">{resultado.tipo}</div>
              </div>
            </div>

            {resultado.topMunicipios?.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-blue-500" /> Top Municípios
                  </h4>
                  <div className="space-y-1.5">
                    {resultado.topMunicipios.map((m: any, i: number) => (
                      <div key={m.nome} className="flex items-center justify-between border rounded px-2.5 py-1.5 text-xs" data-testid={`sicor-municipio-${i}`}>
                        <span className="font-medium">{i + 1}. {m.nome}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">{(m.contratos || m.count).toLocaleString("pt-BR")} contr.</span>
                          <span className="font-semibold text-green-600">{formatCurrency(m.valor)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-amber-500" /> Top Produtos
                  </h4>
                  <div className="space-y-1.5">
                    {resultado.topProdutos?.map((p: any, i: number) => (
                      <div key={p.nome} className="flex items-center justify-between border rounded px-2.5 py-1.5 text-xs" data-testid={`sicor-produto-${i}`}>
                        <span className="font-medium truncate max-w-[180px]">{i + 1}. {p.nome}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">{(p.contratos || p.count).toLocaleString("pt-BR")} contr.</span>
                          <span className="font-semibold text-green-600">{formatCurrency(p.valor)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {resultado.registros?.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Detalhamento dos Contratos
                  <Badge variant="outline" className="text-xs">{resultado.registros.length}</Badge>
                </h4>
                <div className="max-h-[400px] overflow-auto border rounded">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">{resultado.nivelConsulta === "municipio" ? "Município" : "UF"}</TableHead>
                        <TableHead className="text-xs">Produto</TableHead>
                        <TableHead className="text-xs">Atividade</TableHead>
                        <TableHead className="text-xs">Mês/Ano</TableHead>
                        <TableHead className="text-xs text-right">Contratos</TableHead>
                        <TableHead className="text-xs text-right">Valor (R$)</TableHead>
                        <TableHead className="text-xs text-right">Área (ha)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resultado.registros.map((r: any, i: number) => (
                        <TableRow key={i} data-testid={`sicor-row-${i}`}>
                          <TableCell className="text-xs">{r.municipio}</TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate">{r.produto}</TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="outline" className="text-[10px]">{r.atividade}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">{r.mesEmissao}/{r.anoEmissao}</TableCell>
                          <TableCell className="text-xs text-right">{(r.qtdContratos || 1).toLocaleString("pt-BR")}</TableCell>
                          <TableCell className="text-xs text-right font-medium">{formatCurrency(r.valor)}</TableCell>
                          <TableCell className="text-xs text-right">{r.area > 0 ? r.area.toLocaleString("pt-BR") : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        )}

        {!consultaAtiva && !resultado && (
          <div className="text-center py-8 text-sm text-muted-foreground border rounded-lg bg-slate-50/50">
            <Database className="w-8 h-8 mx-auto mb-2 text-blue-300" />
            <p>Selecione os filtros e clique em "Consultar" para buscar dados de crédito rural PRONAF</p>
            <p className="text-xs mt-1">Fonte: SICOR — Sistema de Operações do Crédito Rural — Banco Central do Brasil</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}