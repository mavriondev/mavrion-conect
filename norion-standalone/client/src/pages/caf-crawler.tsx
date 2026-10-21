import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, Globe, Play, Square, Search, Loader2,
} from "lucide-react";

const UF_LIST = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA",
  "PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

export default function CafCrawlerPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

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
  const [crawlerModo, setCrawlerModo] = useState<"paginado" | "sequencial">("paginado");
  const [crawlerSeqInicio, setCrawlerSeqInicio] = useState(1);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<any>(null);
  const [polling, setPolling] = useState(false);

  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, []);

  const startPoll = (jobId: string) => {
    setPolling(true);
    pollInterval.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/caf-extrator/varredura/${jobId}`);
        const data = await res.json();
        setJobStatus(data);
        if (data.status === "concluido" || data.status === "erro" || data.status === "pausado") {
          clearInterval(pollInterval.current!);
          setPolling(false);
          queryClient.invalidateQueries({ queryKey: ["/api/caf-extrator/registros"] });
          toast({
            title: data.status === "concluido" ? "Varredura concluída" : data.status === "erro" ? "Erro na varredura" : "Varredura pausada",
            description: `Encontrados: ${data.totalEncontrados}, Salvos: ${data.totalSalvos}, Erros: ${data.totalErros}`,
          });
        }
      } catch {}
    }, 2000);
  };

  const startCrawler = async () => {
    try {
      const res = await apiRequest("POST", "/api/caf-extrator/varredura", {
        uf: crawlerUf,
        ano: crawlerAno,
        mes: crawlerMes,
        seqInicio: crawlerModo === "sequencial" ? crawlerSeqInicio : 1,
        seqFim: crawlerModo === "sequencial" ? crawlerSeqInicio + crawlerMaxRegistros - 1 : crawlerMaxRegistros,
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
        toast({ title: "Informe um NUFPA", variant: "destructive" });
        return;
      }
      const res = await fetch(`/api/caf-extrator/testar?nufpa=${encodeURIComponent(nufpa)}`);
      const data = await res.json();
      if (data.success) {
        toast({ title: "NUFPA encontrado!", description: `${data.data.nome} — ${data.data.situacao}` });
      } else {
        toast({ title: "NUFPA não encontrado", description: `${nufpa}`, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Erro no teste", description: err.message, variant: "destructive" });
    }
  };

  const progress = jobStatus?.modo === "sequencial"
    ? (jobStatus?.progresso || 0)
    : jobStatus?.paginaAtual && jobStatus?.totalPaginas
      ? (jobStatus.paginaAtual / Math.max(1, jobStatus.totalPaginas)) * 100
      : jobStatus?.progresso ? (jobStatus.progresso / Math.max(1, Math.ceil(crawlerMaxRegistros / 50))) * 100 : 0;

  return (
    <div className="p-6 space-y-6 max-w-[1200px] mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/caf")} data-testid="button-voltar-caf">
          <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
        </Button>
        <div className="p-2 bg-blue-100 rounded-lg">
          <Globe className="w-6 h-6 text-blue-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold" data-testid="title-caf-crawler">Crawler CAF</h1>
          <p className="text-sm text-muted-foreground">Varredura automatizada do portal CAF (caf.mda.gov.br)</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Configuração da Varredura</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">Modo</Label>
              <Select value={crawlerModo} onValueChange={(v) => setCrawlerModo(v as "paginado" | "sequencial")}>
                <SelectTrigger data-testid="crawler-modo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paginado">API Paginada</SelectItem>
                  <SelectItem value="sequencial">Sequencial (NUFPA)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">UF</Label>
              <Select value={crawlerUf} onValueChange={setCrawlerUf}>
                <SelectTrigger data-testid="crawler-uf"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UF_LIST.map(uf => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Máx. Registros</Label>
              <Input type="number" min={10} max={5000} value={crawlerMaxRegistros} onChange={e => setCrawlerMaxRegistros(Number(e.target.value))} data-testid="crawler-max-registros" />
            </div>
            {crawlerModo === "sequencial" && (
              <div>
                <Label className="text-xs">Seq. Início</Label>
                <Input type="number" min={1} value={crawlerSeqInicio} onChange={e => setCrawlerSeqInicio(Number(e.target.value))} data-testid="crawler-seq-inicio" />
              </div>
            )}
            {crawlerModo === "paginado" && (
              <div>
                <Label className="text-xs">Cód. IBGE Município</Label>
                <Input placeholder="Ex: 3137601" value={crawlerCodIBGE} onChange={e => setCrawlerCodIBGE(e.target.value)} data-testid="crawler-cod-ibge" />
              </div>
            )}
            <div>
              <Label className="text-xs">Município (nome)</Label>
              <Input placeholder="Ex: Uberlândia" value={crawlerMunicipio} onChange={e => setCrawlerMunicipio(e.target.value)} data-testid="crawler-municipio" />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">Área Mín. (ha)</Label>
              <Input type="number" min={0} step={1} value={crawlerAreaMinHa || ""} onChange={e => setCrawlerAreaMinHa(Number(e.target.value) || 0)} placeholder="0" data-testid="crawler-area-min" />
            </div>
            <div>
              <Label className="text-xs">Área Máx. (ha)</Label>
              <Input type="number" min={0} step={1} value={crawlerAreaMaxHa || ""} onChange={e => setCrawlerAreaMaxHa(Number(e.target.value) || 0)} placeholder="Sem limite" data-testid="crawler-area-max" />
            </div>
            <div>
              <Label className="text-xs">Delay (ms)</Label>
              <Input type="number" min={500} max={10000} step={100} value={crawlerDelayMs} onChange={e => setCrawlerDelayMs(Math.max(500, Number(e.target.value) || 1100))} data-testid="crawler-delay" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950 p-2 rounded">
              {crawlerModo === "paginado"
                ? "Modo Paginado: consulta a API pública do CAF (caf.mda.gov.br). Use código IBGE para filtrar por município."
                : "Modo Sequencial: gera NUFPAs sequencialmente e tenta API JSON + fallback HTML scraping."}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Testar NUFPA Individual</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="NUFPA para testar (ex: MG032025.01.000073912CAF)"
              value={testNufpaInput}
              onChange={e => setTestNufpaInput(e.target.value)}
              className="max-w-md text-xs"
              data-testid="input-test-nufpa"
            />
            <Button onClick={testNufpa} variant="outline" size="sm" disabled={polling} data-testid="button-testar-nufpa">
              <Search className="w-4 h-4 mr-1" /> Testar
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
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
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                {polling && <Loader2 className="w-4 h-4 animate-spin" />}
                <span className="font-medium">
                  {jobStatus.status === "rodando" ? "Varrendo..." : jobStatus.status === "concluido" ? "Concluído" : jobStatus.status === "pausado" ? "Pausado" : jobStatus.status === "erro" ? "Erro" : "Pendente"}
                </span>
              </span>
              <span className="text-muted-foreground">
                Página {jobStatus.paginaAtual || jobStatus.progresso || 0}{jobStatus.totalPaginas ? ` de ~${jobStatus.totalPaginas}` : ""}
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
