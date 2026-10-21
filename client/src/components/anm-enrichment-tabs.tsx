import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, RefreshCw, AlertCircle, Clock, Building2,
  DollarSign, Shield, Pickaxe, ExternalLink, MapPin,
  ChevronRight, TrendingUp, TrendingDown, Minus,
  FileText, Users, AlertTriangle, CheckCircle2, Ban,
  Mountain, Layers, Search, Brain, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface AnmEnrichmentTabsProps {
  ativo: any;
  assetId: string;
  salvarEnrichment: (key: string, data: any) => void;
}

export function AnmEnrichmentTabs({ ativo, assetId, salvarEnrichment }: AnmEnrichmentTabsProps) {
  const [activeSubTab, setActiveSubTab] = useState("processo");
  const campos = (ativo.camposEspecificos ?? {}) as any;
  const attrs = (ativo.attributesJson || {}) as any;
  const processoAnm = campos.processoAnm || attrs.anmProcesso || ativo.anmProcesso;
  const substancia = campos.substancia || attrs.anmSubstancia || "";
  const lat = campos.latitude != null ? campos.latitude : null;
  const lon = campos.longitude != null ? campos.longitude : null;

  return (
    <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
      <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
        <TabsTrigger value="processo" className="text-xs gap-1" data-testid="tab-anm-processo">
          <FileText className="w-3.5 h-3.5" /> Processo
        </TabsTrigger>
        <TabsTrigger value="historico" className="text-xs gap-1" data-testid="tab-anm-historico">
          <Clock className="w-3.5 h-3.5" /> Histórico
        </TabsTrigger>
        <TabsTrigger value="titular" className="text-xs gap-1" data-testid="tab-anm-titular">
          <Building2 className="w-3.5 h-3.5" /> Titular
        </TabsTrigger>
        <TabsTrigger value="scm" className="text-xs gap-1" data-testid="tab-anm-scm">
          <Search className="w-3.5 h-3.5" /> SCM
        </TabsTrigger>
        <TabsTrigger value="geologia" className="text-xs gap-1" data-testid="tab-anm-geologia">
          <Mountain className="w-3.5 h-3.5" /> Geologia
        </TabsTrigger>
        <TabsTrigger value="restricoes" className="text-xs gap-1" data-testid="tab-anm-restricoes">
          <Shield className="w-3.5 h-3.5" /> Restrições
        </TabsTrigger>
        <TabsTrigger value="cotacao" className="text-xs gap-1" data-testid="tab-anm-cotacao">
          <DollarSign className="w-3.5 h-3.5" /> Cotação
        </TabsTrigger>
      </TabsList>

      <TabsContent value="processo" className="mt-3 space-y-4">
        <ProcessoSubTab ativo={ativo} campos={campos} attrs={attrs} processoAnm={processoAnm} salvarEnrichment={salvarEnrichment} />
      </TabsContent>

      <TabsContent value="historico" className="mt-3 space-y-4">
        <HistoricoSubTab processoAnm={processoAnm} savedData={campos.anmHistorico} salvarEnrichment={salvarEnrichment} />
      </TabsContent>

      <TabsContent value="titular" className="mt-3 space-y-4">
        <TitularSubTab processoAnm={processoAnm} assetId={assetId} savedData={campos.anmTitular} salvarEnrichment={salvarEnrichment} />
      </TabsContent>

      <TabsContent value="scm" className="mt-3 space-y-4">
        <ScmSubTab processoAnm={processoAnm} assetId={assetId} />
      </TabsContent>

      <TabsContent value="geologia" className="mt-3 space-y-4">
        <GeologiaSubTab lat={lat} lon={lon} savedData={campos.anmGeologia} savedRecursos={campos.anmRecursos} salvarEnrichment={salvarEnrichment} />
      </TabsContent>

      <TabsContent value="restricoes" className="mt-3 space-y-4">
        <RestricoesSubTab lat={lat} lon={lon} savedData={campos.anmFunai} savedTerras={campos.anmFunaiTerras} salvarEnrichment={salvarEnrichment} />
      </TabsContent>

      <TabsContent value="cotacao" className="mt-3 space-y-4">
        <CotacaoSubTab substancia={substancia} savedData={campos.anmCotacao} salvarEnrichment={salvarEnrichment} />
      </TabsContent>
    </Tabs>
  );
}

function ProcessoSubTab({ ativo, campos, attrs, processoAnm, salvarEnrichment }: any) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(campos.anmLiveData || null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const faseAnm = campos.faseAnm || attrs.anmFase;
  const situacaoAnm = campos.situacaoAnm;
  const validadeAnm = campos.validadeAnm;
  const ultimoEventoAnm = campos.ultimoEventoAnm || attrs.anmUltEvento;
  const substancia = campos.substancia || attrs.anmSubstancia;

  const diasRestantesRaw = validadeAnm
    ? Math.floor((new Date(validadeAnm).getTime() - Date.now()) / 86400000)
    : null;
  const diasRestantes = diasRestantesRaw !== null && !isNaN(diasRestantesRaw) ? diasRestantesRaw : null;

  const gridItems = [
    { label: "Nº Processo", value: processoAnm },
    { label: "Substância", value: substancia },
    { label: "Fase", value: faseAnm },
    { label: "Situação", value: situacaoAnm },
    { label: "Área", value: ativo.areaHa ? `${Number(ativo.areaHa).toLocaleString("pt-BR")} ha` : null },
    { label: "UF", value: ativo.estado },
    { label: "Validade", value: validadeAnm ? new Date(validadeAnm).toLocaleDateString("pt-BR") : null },
    { label: "Último evento", value: ultimoEventoAnm },
  ].filter(item => item.value);

  const consultar = async () => {
    if (!processoAnm) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest("GET", `/api/anm/processos?processo=${encodeURIComponent(processoAnm)}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setResult(data);
      if (salvarEnrichment && data) salvarEnrichment("anmLiveData", data);
      toast({ title: "Dados ANM atualizados!" });
    } catch {
      setError("Não foi possível consultar o ANM agora");
    } finally {
      setLoading(false);
    }
  };

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
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
          <CardContent className="p-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400" data-testid="text-anm-alerta-validade">
              Licença ANM vence em {diasRestantes} dias
            </p>
          </CardContent>
        </Card>
      )}

      {gridItems.length > 0 && (
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Dados do Processo ANM</CardTitle>
            <Button variant="ghost" size="sm" onClick={consultar} disabled={loading || !processoAnm} className="gap-1.5 h-7" data-testid="button-refresh-processo">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Atualizar
            </Button>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
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

      {!gridItems.length && !processoAnm && (
        <Card>
          <CardContent className="flex items-center justify-center py-10">
            <p className="text-sm text-muted-foreground">Nenhum nº de processo ANM vinculado a este ativo.</p>
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && result.features?.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Consulta ao Vivo — ANM</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {result.features.map((f: any, idx: number) => (
              <div key={idx} className="p-3 border rounded-lg grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {f.PROCESSO && <div><p className="text-xs text-muted-foreground">Processo</p><p className="font-medium">{f.PROCESSO}</p></div>}
                {f.NOME && <div><p className="text-xs text-muted-foreground">Titular</p><p className="font-medium truncate">{f.NOME}</p></div>}
                {f.FASE && <div><p className="text-xs text-muted-foreground">Fase</p><Badge variant="outline" className="text-xs">{f.FASE}</Badge></div>}
                {f.SUBS && <div><p className="text-xs text-muted-foreground">Substância</p><p className="font-medium">{f.SUBS}</p></div>}
                {f.AREA_HA && <div><p className="text-xs text-muted-foreground">Área</p><p className="font-medium">{Number(f.AREA_HA).toLocaleString("pt-BR")} ha</p></div>}
                {f.UF && <div><p className="text-xs text-muted-foreground">UF</p><p className="font-medium">{f.UF}</p></div>}
                {f.ULT_EVENTO && <div className="col-span-2"><p className="text-xs text-muted-foreground">Último Evento</p><p className="font-medium text-xs">{f.ULT_EVENTO}</p></div>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function HistoricoSubTab({ processoAnm, savedData, salvarEnrichment }: { processoAnm: string | null; savedData?: any; salvarEnrichment: (key: string, data: any) => void }) {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["/api/anm/historico", processoAnm],
    queryFn: async () => {
      if (!processoAnm) return null;
      const res = await apiRequest("GET", `/api/anm/historico/${encodeURIComponent(processoAnm)}`);
      if (!res.ok) throw new Error();
      const result = await res.json();
      if (result?.eventos?.length > 0) salvarEnrichment("anmHistorico", result);
      return result;
    },
    enabled: !!processoAnm,
    staleTime: 1000 * 60 * 30,
    placeholderData: savedData || undefined,
  });

  const eventoIcons: Record<string, any> = {
    requerimento: FileText,
    autorizacao: CheckCircle2,
    concessao: CheckCircle2,
    licenciamento: Shield,
    indeferimento: Ban,
    caducidade: AlertTriangle,
    desistencia: Ban,
    cessao: Users,
    penalidade: AlertCircle,
    embargo: AlertCircle,
    recurso: FileText,
    prazo: Clock,
    relatorio: FileText,
    fiscalizacao: Search,
    parecer: FileText,
    notificacao: AlertCircle,
    outro: ChevronRight,
  };

  const eventoColors: Record<string, string> = {
    requerimento: "text-blue-600 bg-blue-50",
    autorizacao: "text-green-600 bg-green-50",
    concessao: "text-emerald-600 bg-emerald-50",
    licenciamento: "text-violet-600 bg-violet-50",
    indeferimento: "text-red-600 bg-red-50",
    caducidade: "text-orange-600 bg-orange-50",
    desistencia: "text-gray-600 bg-gray-50",
    cessao: "text-amber-600 bg-amber-50",
    penalidade: "text-red-600 bg-red-50",
    embargo: "text-red-600 bg-red-50",
    recurso: "text-blue-600 bg-blue-50",
    prazo: "text-amber-600 bg-amber-50",
    relatorio: "text-slate-600 bg-slate-50",
    fiscalizacao: "text-orange-600 bg-orange-50",
    parecer: "text-indigo-600 bg-indigo-50",
    notificacao: "text-yellow-600 bg-yellow-50",
    outro: "text-gray-500 bg-gray-50",
  };

  if (!processoAnm) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <p className="text-sm text-muted-foreground">Nenhum processo ANM vinculado.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="w-4 h-4" />
          Histórico de Eventos
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5 h-7" data-testid="button-refresh-historico">
          {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Atualizar
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex items-center justify-center py-8 gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Carregando histórico...</span>
          </div>
        )}

        {!isLoading && data?.eventos?.length > 0 && (
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-muted" />
            <div className="space-y-3">
              {data.eventos.map((ev: any, idx: number) => {
                const Icon = eventoIcons[ev.tipo] || ChevronRight;
                const colorClass = eventoColors[ev.tipo] || "text-gray-500 bg-gray-50";
                return (
                  <div key={idx} className="relative flex gap-3 pl-1" data-testid={`evento-${idx}`}>
                    <div className={cn("z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0", colorClass)}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0 pb-2">
                      {ev.data && (
                        <p className="text-[10px] text-muted-foreground font-medium mb-0.5">{ev.data}</p>
                      )}
                      <p className="text-xs leading-relaxed">{ev.descricao}</p>
                      <Badge variant="outline" className="text-[10px] mt-1 capitalize">{ev.tipo}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!isLoading && (!data?.eventos || data.eventos.length === 0) && (
          <p className="text-sm text-muted-foreground text-center py-6">Nenhum evento encontrado para este processo.</p>
        )}

        {data?.totalEventos > 0 && (
          <p className="text-xs text-muted-foreground mt-3 text-right">{data.totalEventos} evento(s) encontrado(s)</p>
        )}
      </CardContent>
    </Card>
  );
}

function TitularSubTab({ processoAnm, assetId, savedData, salvarEnrichment }: { processoAnm: string | null; assetId: string; savedData?: any; salvarEnrichment: (key: string, data: any) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [resolveSteps, setResolveSteps] = useState<string[]>([]);
  const [resolveResult, setResolveResult] = useState<any>(null);
  const [manualCnpj, setManualCnpj] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);

  const openCompanyMutation = useMutation({
    mutationFn: async ({ titularNome, cnpjExtraido, uf, substancia, fase, processo, manualCnpjOverride }: {
      titularNome: string; cnpjExtraido?: string; uf?: string; substancia?: string; fase?: string; processo?: string; manualCnpjOverride?: string;
    }) => {
      if (manualCnpjOverride) {
        const res = await apiRequest("POST", "/api/companies/find-or-create-by-cnpj", {
          cnpj: manualCnpjOverride, legalName: titularNome, assetId,
        });
        if (!res.ok) throw new Error();
        return { ...(await res.json()), steps: ["CNPJ inserido manualmente"], resolvedMethod: "manual" };
      }

      setResolveResult(null);
      setShowManualInput(false);
      setResolveSteps(["Iniciando resolução inteligente de CNPJ..."]);

      const res = await apiRequest("POST", "/api/anm/smart-resolve-cnpj", {
        titularNome, cnpjExtraido, uf, substancia, fase, processo, assetId,
      });
      if (!res.ok) throw new Error();
      const result = await res.json();
      setResolveSteps(result.steps || []);
      return result;
    },
    onSuccess: (result: any) => {
      setResolveResult(result);
      if (result.companyId) {
        const msg = result.pessoaFisica
          ? "Cadastro de pessoa física criado!"
          : result.existed
            ? "Empresa encontrada no sistema!"
            : result.resolvedCnpj
              ? "Empresa criada e enriquecida com sucesso!"
              : "Empresa criada — CNPJ não encontrado automaticamente";
        toast({ title: msg });
        queryClient.invalidateQueries({ queryKey: ["/api/companies/with-leads"] });
        queryClient.invalidateQueries({ queryKey: ["/api/matching/assets", assetId] });
        window.open(`/empresas/${result.companyId}`, "_blank");

        if (!result.resolvedCnpj && !result.pessoaFisica) {
          setShowManualInput(true);
        }
      }
    },
    onError: () => {
      toast({ title: "Erro na resolução inteligente de CNPJ", variant: "destructive" });
      setResolveSteps([]);
    },
  });

  const manualCnpjMutation = useMutation({
    mutationFn: async ({ cnpj, legalName }: { cnpj: string; legalName: string }) => {
      const res = await apiRequest("POST", "/api/companies/find-or-create-by-cnpj", {
        cnpj, legalName, assetId,
      });
      if (!res.ok) throw new Error();
      return res.json();
    },
    onSuccess: (result: { companyId: number; existed: boolean }) => {
      toast({ title: "CNPJ vinculado com sucesso!" });
      queryClient.invalidateQueries({ queryKey: ["/api/companies/with-leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/matching/assets", assetId] });
      setShowManualInput(false);
      setManualCnpj("");
      window.open(`/empresas/${result.companyId}`, "_blank");
    },
    onError: () => {
      toast({ title: "Erro ao vincular CNPJ", variant: "destructive" });
    },
  });

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["/api/anm/titular", processoAnm],
    queryFn: async () => {
      if (!processoAnm) return null;
      const res = await apiRequest("GET", `/api/anm/titular/${encodeURIComponent(processoAnm)}`);
      if (!res.ok) throw new Error();
      const result = await res.json();
      if (result?.titular) salvarEnrichment("anmTitular", result);
      return result;
    },
    enabled: !!processoAnm,
    staleTime: 1000 * 60 * 30,
    placeholderData: savedData || undefined,
  });

  const [cnpjaLoading, setCnpjaLoading] = useState(false);
  const [cnpjaData, setCnpjaData] = useState<any>(null);

  const consultarCnpja = async (cnpj: string) => {
    const clean = cnpj.replace(/\D/g, "");
    if (clean.length !== 14 && clean.length !== 11) return;
    setCnpjaLoading(true);
    try {
      const res = await apiRequest("GET", `/api/cnpj/${clean}`);
      const d = await res.json();
      setCnpjaData(d);
      toast({ title: "CNPJ consultado com sucesso!" });
    } catch {
      toast({ title: "Erro ao consultar CNPJ", variant: "destructive" });
    }
    setCnpjaLoading(false);
  };

  if (!processoAnm) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <p className="text-sm text-muted-foreground">Nenhum processo ANM vinculado.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            Titular do Processo
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5 h-7" data-testid="button-refresh-titular">
            {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Atualizar
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div className="flex items-center justify-center py-8 gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Consultando titular...</span>
            </div>
          )}

          {!isLoading && data?.titular && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Nome / Razão Social</p>
                  <p className="text-sm font-semibold mt-0.5" data-testid="text-titular-nome">{data.titular.nome}</p>
                </div>
                {data.titular.cnpj && (
                  <div>
                    <p className="text-xs text-muted-foreground">CNPJ</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-sm font-mono font-medium" data-testid="text-titular-cnpj">
                        {data.titular.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px] gap-1"
                        onClick={() => consultarCnpja(data.titular.cnpj)}
                        disabled={cnpjaLoading}
                        data-testid="button-enriquecer-cnpj-titular"
                      >
                        {cnpjaLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                        Enriquecer
                      </Button>
                    </div>
                  </div>
                )}
                {data.titular.fase && (
                  <div>
                    <p className="text-xs text-muted-foreground">Fase</p>
                    <Badge variant="outline" className="text-xs mt-0.5">{data.titular.fase}</Badge>
                  </div>
                )}
                {data.titular.substancia && (
                  <div>
                    <p className="text-xs text-muted-foreground">Substância</p>
                    <p className="text-sm font-medium mt-0.5">{data.titular.substancia}</p>
                  </div>
                )}
              </div>

              <div className="pt-2 border-t space-y-3">
                <Button
                  variant="default"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => openCompanyMutation.mutate({
                    titularNome: data.titular.nome,
                    cnpjExtraido: data.titular.cnpj || undefined,
                    uf: data.outrosProcessos?.[0]?.UF || undefined,
                    substancia: data.titular.substancia || undefined,
                    fase: data.titular.fase || undefined,
                    processo: data.processo || undefined,
                  })}
                  disabled={openCompanyMutation.isPending}
                  data-testid="button-abrir-empresa-titular"
                >
                  {openCompanyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {openCompanyMutation.isPending ? "Resolvendo CNPJ..." : "Abrir Página da Empresa"}
                </Button>
                <p className="text-[10px] text-muted-foreground">
                  Resolução inteligente: prioriza CNPJ do SCM (oficial), com fallback via regex, Receita Federal e IA.
                </p>

                {openCompanyMutation.isPending && resolveSteps.length > 0 && (
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5" data-testid="resolve-progress">
                    {resolveSteps.map((step, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        {i === resolveSteps.length - 1 ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 mt-0.5 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                        )}
                        <span className="text-muted-foreground">{step}</span>
                      </div>
                    ))}
                  </div>
                )}

                {!openCompanyMutation.isPending && resolveSteps.length > 0 && resolveResult && (
                  <div className="rounded-lg border p-3 space-y-2" data-testid="resolve-result">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      {resolveResult.resolvedCnpj ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                          <span>CNPJ resolvido: {resolveResult.resolvedCnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}</span>
                          <Badge variant={resolveResult.resolvedMethod === "scm_oficial" ? "default" : "outline"} className={`text-[10px] ${resolveResult.resolvedMethod === "scm_oficial" ? "bg-green-600 hover:bg-green-700" : ""}`}>{resolveResult.resolvedMethod === "scm_oficial" ? "SCM" : resolveResult.resolvedMethod}</Badge>
                        </>
                      ) : resolveResult.pessoaFisica ? (
                        <>
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                          <span>Titular identificado como Pessoa Física</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-4 h-4 text-orange-500" />
                          <span>CNPJ não encontrado automaticamente</span>
                        </>
                      )}
                    </div>
                    <div className="space-y-1">
                      {resolveResult.steps?.map((step: string, i: number) => (
                        <div key={i} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                          <ChevronRight className="w-3 h-3 mt-0.5 shrink-0" />
                          <span>{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {showManualInput && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/30 dark:bg-amber-950/20 p-3 space-y-2" data-testid="manual-cnpj-section">
                    <p className="text-xs font-medium flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                      Inserir CNPJ manualmente
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="00.000.000/0000-00"
                        value={manualCnpj}
                        onChange={(e) => setManualCnpj(e.target.value)}
                        className="flex-1 px-2 py-1.5 text-xs border rounded-md bg-background"
                        data-testid="input-manual-cnpj"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        disabled={manualCnpj.replace(/\D/g, "").length !== 14 || manualCnpjMutation.isPending}
                        onClick={() => manualCnpjMutation.mutate({ cnpj: manualCnpj, legalName: data.titular.nome })}
                        data-testid="button-submit-manual-cnpj"
                      >
                        {manualCnpjMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                        Vincular
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {cnpjaData && (
                <Card className="border-blue-200 bg-blue-50/30 dark:bg-blue-950/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-blue-600" />
                      Dados CNPJA
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    {cnpjaData.razao_social && <div className="col-span-2"><span className="text-muted-foreground">Razão Social:</span> <span className="font-medium">{cnpjaData.razao_social}</span></div>}
                    {cnpjaData.nome_fantasia && <div className="col-span-2"><span className="text-muted-foreground">Nome Fantasia:</span> <span className="font-medium">{cnpjaData.nome_fantasia}</span></div>}
                    {cnpjaData.porte && <div><span className="text-muted-foreground">Porte:</span> <span className="font-medium">{cnpjaData.porte}</span></div>}
                    {cnpjaData.capital_social && <div><span className="text-muted-foreground">Capital Social:</span> <span className="font-medium">R$ {Number(cnpjaData.capital_social).toLocaleString("pt-BR")}</span></div>}
                    {cnpjaData.situacao && <div><span className="text-muted-foreground">Situação:</span> <Badge variant={cnpjaData.situacao === "ATIVA" ? "default" : "destructive"} className="text-[10px]">{cnpjaData.situacao}</Badge></div>}
                    {cnpjaData.socios?.length > 0 && (
                      <div className="col-span-2 mt-2">
                        <p className="text-muted-foreground mb-1 font-medium">Sócios:</p>
                        <div className="space-y-1">
                          {cnpjaData.socios.map((s: any, i: number) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <Users className="w-3 h-3 text-muted-foreground shrink-0" />
                              <span className="font-medium">{s.nome || s.name}</span>
                              {(s.qualificacao || s.role) && <span className="text-muted-foreground">— {s.qualificacao || s.role}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {!isLoading && data?.outrosProcessos?.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Outros Processos do Titular
              <Badge variant="secondary" className="text-[10px]">{data.totalOutrosProcessos}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {data.outrosProcessos.map((op: any, idx: number) => (
                <div key={idx} className="p-2.5 border rounded-lg flex items-center justify-between text-xs" data-testid={`outro-processo-${idx}`}>
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="font-mono font-medium text-blue-600 shrink-0">{op.PROCESSO}</span>
                    <Badge variant="outline" className="text-[10px] shrink-0">{op.FASE}</Badge>
                    <span className="truncate text-muted-foreground">{op.SUBS}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="text-muted-foreground">{op.AREA_HA ? `${Number(op.AREA_HA).toLocaleString("pt-BR")} ha` : ""}</span>
                    <Badge variant="secondary" className="text-[10px]">{op.UF}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function GeologiaSubTab({ lat, lon, savedData, savedRecursos, salvarEnrichment }: { lat: number | null; lon: number | null; savedData?: any; savedRecursos?: any; salvarEnrichment: (key: string, data: any) => void }) {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["/api/anm-enrichment/cprm/geologia", lat, lon],
    queryFn: async () => {
      if (lat == null || lon == null) return null;
      const res = await apiRequest("GET", `/api/anm-enrichment/cprm/geologia?lat=${lat}&lon=${lon}`);
      if (!res.ok) throw new Error();
      const result = await res.json();
      if (result?.disponivel !== false) salvarEnrichment("anmGeologia", result);
      return result;
    },
    enabled: lat != null && lon != null,
    staleTime: 1000 * 60 * 60,
    retry: 1,
    placeholderData: savedData || undefined,
  });

  const { data: recursos, isLoading: recursosLoading } = useQuery({
    queryKey: ["/api/anm-enrichment/cprm/recursos", lat, lon],
    queryFn: async () => {
      if (lat == null || lon == null) return null;
      const res = await apiRequest("GET", `/api/anm-enrichment/cprm/recursos?lat=${lat}&lon=${lon}&raio=50`);
      if (!res.ok) throw new Error();
      const result = await res.json();
      if (result?.disponivel !== false) salvarEnrichment("anmRecursos", result);
      return result;
    },
    enabled: lat != null && lon != null,
    staleTime: 1000 * 60 * 60,
    retry: 1,
    placeholderData: savedRecursos || undefined,
  });

  if (lat == null || lon == null) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
          <MapPin className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Coordenadas não disponíveis para este ativo.</p>
          <p className="text-xs text-muted-foreground">Adicione latitude/longitude nos campos específicos para consultar a geologia.</p>
        </CardContent>
      </Card>
    );
  }

  const geologiaIndisponivel = data && data.disponivel === false;
  const recursosIndisponivel = recursos && recursos.disponivel === false;

  return (
    <>
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Mountain className="w-4 h-4" />
            Geologia da Área (CPRM/SGB)
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5 h-7" data-testid="button-refresh-geologia">
            {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Atualizar
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div className="flex items-center justify-center py-8 gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Consultando dados geológicos...</span>
            </div>
          )}

          {geologiaIndisponivel && (
            <div className="flex flex-col items-center py-6 gap-2 text-center">
              <AlertTriangle className="w-8 h-8 text-amber-500" />
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Serviço CPRM indisponível</p>
              <p className="text-xs text-muted-foreground">O módulo de geologia está sendo configurado. Os dados estarão disponíveis em breve.</p>
            </div>
          )}

          {!isLoading && data?.disponivel && data?.data?.length > 0 && (
            <div className="space-y-4">
              {data.data.map((geo: any, idx: number) => (
                <div key={idx} className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {geo.sigla && <div><p className="text-xs text-muted-foreground">Sigla</p><p className="text-sm font-medium">{geo.sigla}</p></div>}
                  {geo.nome && <div><p className="text-xs text-muted-foreground">Unidade</p><p className="text-sm font-medium">{geo.nome}</p></div>}
                  {geo.hierarquia && <div><p className="text-xs text-muted-foreground">Hierarquia</p><Badge variant="outline" className="text-xs">{geo.hierarquia}</Badge></div>}
                  {geo.era_min && <div><p className="text-xs text-muted-foreground">Era Geológica</p><p className="text-sm font-medium">{geo.era_min}{geo.era_max && geo.era_max !== geo.era_min ? ` — ${geo.era_max}` : ""}</p></div>}
                  {geo.sistema_min && <div><p className="text-xs text-muted-foreground">Período</p><p className="text-sm font-medium">{geo.sistema_min}{geo.sistema_max && geo.sistema_max !== geo.sistema_min ? ` — ${geo.sistema_max}` : ""}</p></div>}
                  {geo.litotipos && <div className="col-span-2"><p className="text-xs text-muted-foreground">Litotipos</p><p className="text-sm font-medium">{geo.litotipos}</p></div>}
                  {geo.legenda && <div className="col-span-2"><p className="text-xs text-muted-foreground">Descrição</p><p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{geo.legenda}</p></div>}
                  {geo.ambiente_tectonico && <div className="col-span-2"><p className="text-xs text-muted-foreground">Ambiente Tectônico</p><p className="text-sm font-medium">{geo.ambiente_tectonico}</p></div>}
                </div>
              ))}
            </div>
          )}

          {!isLoading && data?.disponivel && (!data?.data || data.data.length === 0) && (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhuma informação geológica disponível para esta localização.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Pickaxe className="w-4 h-4" />
            Ocorrências Minerais Próximas (raio 50km)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recursosLoading && (
            <div className="flex items-center justify-center py-6 gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Buscando ocorrências...</span>
            </div>
          )}

          {recursosIndisponivel && (
            <div className="flex flex-col items-center py-6 gap-2 text-center">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
              <p className="text-xs text-muted-foreground">Módulo de recursos minerais em configuração.</p>
            </div>
          )}

          {!recursosLoading && recursos?.disponivel !== false && recursos?.data?.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground mb-2">{recursos.total} ocorrência(s) encontrada(s)</p>
              <div className="space-y-1.5 max-h-[350px] overflow-y-auto">
                {recursos.data.slice(0, 30).map((r: any, idx: number) => (
                  <div key={idx} className="p-2.5 border rounded-lg text-xs" data-testid={`recurso-${idx}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <Pickaxe className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                        <span className="font-medium truncate">{r.nome_ocorrencia}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {r.distancia_km && <span className="text-muted-foreground">{r.distancia_km} km</span>}
                        <Badge variant="secondary" className="text-[10px]">{r.uf}</Badge>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-1 text-muted-foreground">
                      {r.substancias && <span>{r.substancias}</span>}
                      {r.importancia && <Badge variant="outline" className="text-[10px]">{r.importancia}</Badge>}
                      {r.status_economico && <span>• {r.status_economico}</span>}
                      {r.municipio && <span>• {r.municipio}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!recursosLoading && recursos?.disponivel !== false && (!recursos?.data || recursos.data.length === 0) && (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhuma ocorrência mineral registrada próxima.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function RestricoesSubTab({ lat, lon, savedData, savedTerras, salvarEnrichment }: { lat: number | null; lon: number | null; savedData?: any; savedTerras?: any; salvarEnrichment: (key: string, data: any) => void }) {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["/api/anm-enrichment/funai/sobreposicao", lat, lon],
    queryFn: async () => {
      if (lat == null || lon == null) return null;
      const res = await apiRequest("GET", `/api/anm-enrichment/funai/sobreposicao?lat=${lat}&lon=${lon}`);
      if (!res.ok) throw new Error();
      const result = await res.json();
      if (result?.disponivel !== false) salvarEnrichment("anmFunai", result);
      return result;
    },
    enabled: lat != null && lon != null,
    staleTime: 1000 * 60 * 60,
    retry: 1,
    placeholderData: savedData || undefined,
  });

  const { data: terrasProximas } = useQuery({
    queryKey: ["/api/anm-enrichment/funai/terras/raio", lat, lon],
    queryFn: async () => {
      if (lat == null || lon == null) return null;
      const res = await apiRequest("GET", `/api/anm-enrichment/funai/terras/raio?lat=${lat}&lon=${lon}&raio=50`);
      if (!res.ok) throw new Error();
      const result = await res.json();
      if (result?.disponivel !== false) salvarEnrichment("anmFunaiTerras", result);
      return result;
    },
    enabled: lat != null && lon != null,
    staleTime: 1000 * 60 * 60,
    retry: 1,
    placeholderData: savedTerras || undefined,
  });

  if (lat == null || lon == null) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
          <MapPin className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Coordenadas não disponíveis.</p>
        </CardContent>
      </Card>
    );
  }

  const indisponivel = data && data.disponivel === false;
  const sobrepoe = data?.disponivel !== false && data?.dentro_ti === true;
  const limpo = data?.disponivel !== false && data?.dentro_ti === false && data !== null;

  return (
    <>
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Terras Indígenas (FUNAI)
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5 h-7" data-testid="button-refresh-restricoes">
            {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Atualizar
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div className="flex items-center justify-center py-8 gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Verificando sobreposição...</span>
            </div>
          )}

          {indisponivel && (
            <div className="flex flex-col items-center py-6 gap-2 text-center">
              <AlertTriangle className="w-8 h-8 text-amber-500" />
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Serviço FUNAI indisponível</p>
              <p className="text-xs text-muted-foreground">O módulo de terras indígenas está sendo configurado. Os dados estarão disponíveis em breve.</p>
            </div>
          )}

          {sobrepoe && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-lg">
                <AlertCircle className="w-6 h-6 text-red-600 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-red-800 dark:text-red-300" data-testid="text-funai-alerta">
                    Sobreposição com Terra Indígena detectada ({data.total} TI{data.total > 1 ? "s" : ""})
                  </p>
                  <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                    Isso pode inviabilizar ou dificultar significativamente o processo minerário.
                  </p>
                </div>
              </div>
              {data.terras?.length > 0 && data.terras.map((ti: any, idx: number) => (
                <div key={idx} className="grid grid-cols-2 gap-3 text-sm p-3 border rounded-lg">
                  {ti.nome_ti && <div><p className="text-xs text-muted-foreground">Nome da TI</p><p className="font-medium">{ti.nome_ti}</p></div>}
                  {ti.etnia && <div><p className="text-xs text-muted-foreground">Etnia</p><p className="font-medium">{ti.etnia}</p></div>}
                  {ti.fase_ti && <div><p className="text-xs text-muted-foreground">Fase</p><Badge variant="outline" className="text-xs">{ti.fase_ti}</Badge></div>}
                  {ti.superficie_ha && <div><p className="text-xs text-muted-foreground">Superfície</p><p className="font-medium">{Number(ti.superficie_ha).toLocaleString("pt-BR")} ha</p></div>}
                  {ti.municipio && <div><p className="text-xs text-muted-foreground">Município</p><p className="font-medium">{ti.municipio} - {ti.uf}</p></div>}
                  {ti.modalidade && <div><p className="text-xs text-muted-foreground">Modalidade</p><p className="font-medium">{ti.modalidade}</p></div>}
                </div>
              ))}
            </div>
          )}

          {limpo && (
            <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-950/30 border border-green-300 dark:border-green-800 rounded-lg">
              <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0" />
              <div>
                <p className="text-sm font-bold text-green-800 dark:text-green-300" data-testid="text-funai-limpo">
                  Sem sobreposição com Terras Indígenas
                </p>
                <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                  O ponto analisado não está dentro de nenhuma terra indígena cadastrada.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {terrasProximas?.disponivel !== false && (terrasProximas?.data?.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Terras Indígenas Próximas (raio {terrasProximas.raio_km || 50}km)
              <Badge variant="secondary" className="text-[10px]">{terrasProximas.total}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {terrasProximas.data.map((t: any, idx: number) => (
                <div key={idx} className="p-2.5 border rounded-lg text-xs" data-testid={`terra-proxima-${idx}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{t.nome_ti}</span>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">{t.fase_ti}</Badge>
                      {t.distancia_km && <span className="text-muted-foreground">{t.distancia_km} km</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3 mt-1 text-muted-foreground">
                    {t.etnia && <span>Etnia: {t.etnia}</span>}
                    {t.municipio && <span>{t.municipio} - {t.uf}</span>}
                    {t.superficie_ha && <span>{Number(t.superficie_ha).toLocaleString("pt-BR")} ha</span>}
                    {t.modalidade && <span>{t.modalidade}</span>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function CotacaoSubTab({ substancia, savedData, salvarEnrichment }: { substancia: string; savedData?: any; salvarEnrichment: (key: string, data: any) => void }) {
  const cleanSubstancia = substancia?.split(",")[0]?.trim() || substancia;

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["/api/anm/cotacao", cleanSubstancia],
    queryFn: async () => {
      if (!cleanSubstancia) return null;
      const res = await apiRequest("GET", `/api/anm/cotacao/${encodeURIComponent(cleanSubstancia)}`);
      if (!res.ok) throw new Error();
      const result = await res.json();
      if (result?.disponivel) salvarEnrichment("anmCotacao", result);
      return result;
    },
    enabled: !!cleanSubstancia,
    staleTime: 1000 * 60 * 60,
    placeholderData: savedData || undefined,
  });

  if (!cleanSubstancia) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <p className="text-sm text-muted-foreground">Nenhuma substância mineral definida para este ativo.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <DollarSign className="w-4 h-4" />
          Cotação — {cleanSubstancia}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5 h-7" data-testid="button-refresh-cotacao">
          {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Atualizar
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex items-center justify-center py-8 gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Consultando cotação...</span>
          </div>
        )}

        {!isLoading && data?.disponivel === false && (
          <div className="text-center py-6 space-y-2">
            <DollarSign className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">{data.message}</p>
          </div>
        )}

        {!isLoading && data?.disponivel && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-muted/30 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Preço (USD)</p>
                <p className="text-xl font-bold text-green-600" data-testid="text-cotacao-usd">
                  ${typeof data.preco_usd === 'number' ? data.preco_usd.toLocaleString("en-US", { maximumFractionDigits: 2 }) : data.preco_usd}
                </p>
                <p className="text-[10px] text-muted-foreground">/{data.unidade}</p>
              </div>
              <div className="text-center p-3 bg-muted/30 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Preço (BRL)</p>
                <p className="text-xl font-bold text-blue-600" data-testid="text-cotacao-brl">
                  R$ {typeof data.preco_brl === 'number' ? data.preco_brl.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : data.preco_brl}
                </p>
                <p className="text-[10px] text-muted-foreground">/{data.unidade}</p>
              </div>
              <div className="text-center p-3 bg-muted/30 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Câmbio</p>
                <p className="text-xl font-bold" data-testid="text-cambio">
                  {data.usd_brl?.toFixed(2)}
                </p>
                <p className="text-[10px] text-muted-foreground">USD/BRL</p>
              </div>
            </div>

            {data.historico?.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Histórico 30 dias (USD/{data.unidade})</p>
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.historico}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis
                        dataKey="data"
                        tick={{ fontSize: 9 }}
                        tickFormatter={(v: string) => {
                          const d = new Date(v);
                          return `${d.getDate()}/${d.getMonth() + 1}`;
                        }}
                        interval={4}
                      />
                      <YAxis
                        tick={{ fontSize: 9 }}
                        domain={["auto", "auto"]}
                        tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v.toFixed(0)}
                      />
                      <Tooltip
                        formatter={(value: number) => [`$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`, "USD"]}
                        labelFormatter={(label: string) => new Date(label).toLocaleDateString("pt-BR")}
                        contentStyle={{ fontSize: 11 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="preco_usd"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t">
              <span>Fonte: {data.fonte}</span>
              <span>Atualizado: {data.consultadoEm ? new Date(data.consultadoEm).toLocaleString("pt-BR") : "N/I"}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function MiningAnalysisButton({ assetId, campos }: { assetId: string; campos: any }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(campos?.iaMiningAnalysis || null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const analisar = async () => {
    setLoading(true);
    try {
      const res = await apiRequest("POST", `/api/ai/mining-analysis/${assetId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Erro na análise");
      }
      const data = await res.json();
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/matching/assets", assetId] });
      toast({ title: "Análise minerária concluída!" });
    } catch (err: any) {
      toast({ title: err.message || "Erro na análise IA", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-orange-200 dark:border-orange-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Pickaxe className="w-4 h-4 text-orange-600" />
          Análise IA — Due Diligence Minerária
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Gera um parecer automático de due diligence minerária usando os dados do processo ANM, titular, cotação e dados geológicos disponíveis.
        </p>
        <Button
          onClick={analisar}
          disabled={loading}
          variant="outline"
          className="gap-1.5"
          data-testid="button-mining-analysis"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
          {loading ? "Analisando..." : result ? "Refazer Análise Minerária" : "Gerar Análise Minerária"}
        </Button>

        {result && (
          <div className="space-y-3 mt-3">
            {result.score !== null && (
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold",
                  result.score >= 70 ? "bg-green-100 text-green-700" :
                  result.score >= 40 ? "bg-amber-100 text-amber-700" :
                  "bg-red-100 text-red-700"
                )} data-testid="text-mining-score">
                  {result.score}
                </div>
                <div>
                  <p className="text-sm font-medium">Score de Atratividade</p>
                  <p className="text-xs text-muted-foreground">
                    {result.score >= 70 ? "Alto potencial" : result.score >= 40 ? "Potencial moderado" : "Potencial baixo"}
                  </p>
                </div>
              </div>
            )}

            <div className="prose prose-sm dark:prose-invert max-w-none">
              <div className="text-sm whitespace-pre-wrap leading-relaxed" data-testid="text-mining-analysis">
                {result.analise}
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t">
              <span>Modelo: {result.modelo}</span>
              <span>Gerado: {result.geradoEm ? new Date(result.geradoEm).toLocaleString("pt-BR") : "N/I"}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScmSubTab({ processoAnm, assetId }: { processoAnm: string; assetId: string }) {
  const [cached, setCached] = useState<any>(null);
  const [loadingCache, setLoadingCache] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [captchaUrl, setCaptchaUrl] = useState<string | null>(null);
  const [captchaBlobUrl, setCaptchaBlobUrl] = useState<string | null>(null);
  const [captchaInput, setCaptchaInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [initiating, setInitiating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrichSteps, setEnrichSteps] = useState<string[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const fetchCache = async () => {
    if (!processoAnm) { setLoadingCache(false); return; }
    try {
      const parts = processoAnm.replace(/\./g, "").split("/");
      if (parts.length !== 2) { setLoadingCache(false); return; }
      const res = await apiRequest("GET", `/api/scm/processo/${parts[0]}/${parts[1]}`);
      if (res.ok) {
        const data = await res.json();
        setCached(data);
      }
    } catch {}
    setLoadingCache(false);
  };

  useState(() => { fetchCache(); });

  const iniciarCaptcha = async () => {
    if (!processoAnm) return;
    setInitiating(true);
    setError(null);
    setEnrichSteps([]);
    try {
      const res = await apiRequest("POST", "/api/scm/captcha/iniciar", { processo: processoAnm });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Erro ao iniciar sessão");
      }
      const data = await res.json();
      setSessionId(data.sessionId);
      setCaptchaUrl(data.captchaImageUrl);
      setCaptchaInput("");

      try {
        const imgRes = await apiRequest("GET", data.captchaImageUrl);
        if (imgRes.ok) {
          const blob = await imgRes.blob();
          setCaptchaBlobUrl(URL.createObjectURL(blob));
        }
      } catch {}
    } catch (err: any) {
      setError(err.message || "Erro ao acessar o SCM");
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setInitiating(false);
    }
  };

  const resolverCaptcha = async () => {
    if (!sessionId || !captchaInput) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/scm/captcha/resolver", {
        sessionId,
        captcha: captchaInput,
        assetId,
      });
      const data = await res.json();

      if (!data.success) {
        if (data.error === "captcha_invalido") {
          setError("Captcha incorreto. Clique em 'Tentar novamente' para uma nova consulta.");
          setSessionId(null);
          setCaptchaUrl(null);
          setCaptchaBlobUrl(null);
        } else if (data.error === "sessao_expirada") {
          setError("Sessão expirada. Clique em 'Tentar novamente' para uma nova consulta.");
          setSessionId(null);
          setCaptchaUrl(null);
          setCaptchaBlobUrl(null);
        } else if (data.error === "captcha_rapido") {
          setError("Código digitado muito rápido. Clique em 'Tentar novamente' e aguarde alguns segundos antes de enviar.");
          setSessionId(null);
          setCaptchaUrl(null);
          setCaptchaBlobUrl(null);
        } else if (data.error === "scm_indisponivel") {
          setError("SCM temporariamente indisponível. Tente novamente em alguns minutos.");
          setSessionId(null);
          setCaptchaUrl(null);
          setCaptchaBlobUrl(null);
        } else {
          setError(data.message || "Erro desconhecido");
        }
        return;
      }

      setCached({ ...data.data, titular: { nome: data.data?.titularNome, cnpj: data.data?.titularCnpj, cpf: data.data?.titularCpf, tipoPessoa: data.data?.tipoPessoa, cadastroEmpresa: data.data?.cadastroEmpresa } });
      setSessionId(null);
      setCaptchaUrl(null);
      setCaptchaBlobUrl(null);
      if (data.enrichmentSteps?.length) setEnrichSteps(data.enrichmentSteps);

      queryClient.invalidateQueries({ queryKey: ["/api/matching/assets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });

      toast({ title: "SCM consultado com sucesso!", description: data.data?.titularCnpj ? `CNPJ: ${data.data.titularCnpj}` : "Dados extraídos" });
    } catch (err: any) {
      setError("Erro ao processar. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!processoAnm) {
    return (
      <Card>
        <CardContent className="p-4 text-center text-muted-foreground text-sm">
          Nenhum processo ANM vinculado a este ativo.
        </CardContent>
      </Card>
    );
  }

  if (loadingCache) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm text-muted-foreground">Verificando dados SCM...</span>
        </CardContent>
      </Card>
    );
  }

  if (cached?.titular?.cnpj || cached?.titularCnpj) {
    const cnpj = cached.titular?.cnpj || cached.titularCnpj;
    const nome = cached.titular?.nome || cached.titularNome;
    const tipo = cached.titular?.tipoPessoa || cached.tipoPessoa;
    const formatCnpj = (c: string) => {
      if (!c || c.length !== 14) return c;
      return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
    };

    return (
      <div className="space-y-4">
        <Card className="border-green-300 dark:border-green-800">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Titular Oficial (SCM/ANM)
              </CardTitle>
              <Badge variant="outline" className="text-xs border-green-500 text-green-700 dark:text-green-400" data-testid="badge-scm-consultado">
                Consultado via SCM
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <InfoItem label="Nome / Razão Social" value={nome} />
              <InfoItem label={tipo === "PF" ? "CPF" : "CNPJ"} value={tipo === "PF" ? (cached.titular?.cpf || cached.titularCpf) : formatCnpj(cnpj)} highlight />
              <InfoItem label="Tipo" value={tipo === "PF" ? "Pessoa Física" : "Pessoa Jurídica"} />
              <InfoItem label="Cadastro Empresa" value={cached.titular?.cadastroEmpresa || cached.cadastroEmpresa} />
            </div>

            {(cached.fase || cached.uf || cached.areaHa) && (
              <>
                <div className="border-t pt-3 mt-2" />
                <div className="grid grid-cols-2 gap-3">
                  <InfoItem label="Fase" value={cached.fase} />
                  <InfoItem label="UF" value={cached.uf} />
                  <InfoItem label="Área" value={cached.areaHa ? `${Number(cached.areaHa).toLocaleString("pt-BR")} ha` : null} />
                  <InfoItem label="NUP" value={cached.nup} />
                  <InfoItem label="Tipo Requerimento" value={cached.tipoRequerimento} />
                  <InfoItem label="Distrito" value={cached.distrito} />
                  <InfoItem label="Unidade Protocolizadora" value={cached.unidadeProtocolizadora} />
                  <InfoItem label="Data Protocolo" value={cached.dataProtocolo} />
                  <InfoItem label="Data Prioridade" value={cached.dataPrioridade} />
                  <InfoItem label="Status" value={cached.statusAtivo === false ? "Inativo" : "Ativo"} />
                </div>
              </>
            )}

            {cached.consultadoEm && (
              <p className="text-[10px] text-muted-foreground pt-2 border-t">
                Consultado em: {new Date(cached.consultadoEm).toLocaleString("pt-BR")}
              </p>
            )}
          </CardContent>
        </Card>

        {enrichSteps.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-500" /> Enriquecimento Automático
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {enrichSteps.map((step, i) => (
                  <li key={i} className="text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                    {step}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Button variant="outline" size="sm" onClick={iniciarCaptcha} disabled={initiating} data-testid="button-scm-reconsultar">
          {initiating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
          Re-consultar SCM
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Search className="w-4 h-4" />
            Consulta SCM (CNPJ Oficial do Titular)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            O SCM (Sistema de Controle de Mineração) da ANM contém o CNPJ oficial do titular do processo.
            A consulta requer resolução de captcha pelo operador.
          </p>

          {!sessionId && !captchaUrl && (
            <Button onClick={iniciarCaptcha} disabled={initiating} size="sm" data-testid="button-scm-iniciar">
              {initiating ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> Acessando SCM...</>
              ) : (
                <><Search className="w-3.5 h-3.5 mr-1" /> Buscar CNPJ do Titular (SCM)</>
              )}
            </Button>
          )}

          {captchaUrl && sessionId && (
            <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
              <p className="text-xs font-medium">Digite os 4 caracteres da imagem abaixo:</p>
              <div className="flex items-center gap-3">
                <div className="border rounded overflow-hidden bg-white">
                  <img
                    src={captchaBlobUrl || captchaUrl || ""}
                    alt="Captcha SCM"
                    className="h-10"
                    data-testid="img-scm-captcha"
                  />
                </div>
                <input
                  type="text"
                  maxLength={4}
                  value={captchaInput}
                  onChange={e => setCaptchaInput(e.target.value.toUpperCase())}
                  onKeyDown={e => { if (e.key === "Enter" && captchaInput.length === 4) resolverCaptcha(); }}
                  placeholder="ABCD"
                  className="w-24 h-10 text-center text-lg font-mono border rounded px-2 uppercase bg-background"
                  autoFocus
                  data-testid="input-scm-captcha"
                />
                <Button
                  onClick={resolverCaptcha}
                  disabled={submitting || captchaInput.length < 4}
                  size="sm"
                  data-testid="button-scm-resolver"
                >
                  {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Enviar"}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">Sessão expira em 2 minutos</p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-2 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
              <p className="text-xs text-red-700 dark:text-red-400">{error}</p>
              <Button variant="ghost" size="sm" className="ml-auto text-xs h-6" onClick={iniciarCaptcha} data-testid="button-scm-tentar-novamente">
                Tentar novamente
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoItem({ label, value, highlight }: { label: string; value: any; highlight?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("text-xs", highlight && "font-bold text-green-700 dark:text-green-400")} data-testid={`text-scm-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        {value}
      </p>
    </div>
  );
}
