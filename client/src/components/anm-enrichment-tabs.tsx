import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, AlertCircle, Clock, Building2, DollarSign, Shield, Pickaxe, ExternalLink, MapPin, ChevronRight, Minus, FileText, Users, AlertTriangle, CheckCircle2, Ban, Download, Mountain, Layers, Search, Brain, Sparkles, Receipt, Newspaper, FlaskConical, Waves, TrainFront, Anchor, Zap, Truck, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { validateNupDv } from "@shared/nup";
import { JazidaEvidenciasPanel } from "@/components/jazida-evidencias-panel";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from "recharts";

// Grupos de seções do enriquecimento ANM. Cada grupo vira uma aba principal
// no detalhe do ativo minerário (MINA/JAZIDA); os ids das seções (leaf ids)
// são os mesmos de sempre para não quebrar navegação programática e testids.
export interface AnmTabGroup {
  id: string; // id da aba principal no detalhe do ativo
  label: string;
  sections: Array<{ id: string; label: string }>;
}

export const ANM_TAB_GROUPS: AnmTabGroup[] = [
  {
    id: "anm",
    label: "ANM",
    sections: [
      { id: "processo", label: "Processo" },
      { id: "historico", label: "Histórico" },
      { id: "scm", label: "SCM" },
      { id: "sei", label: "SEI" },
      { id: "dou", label: "DOU" },
    ],
  },
  {
    id: "titular-financas",
    label: "Titular & Finanças",
    sections: [
      { id: "titular", label: "Titular" },
      { id: "cfem", label: "CFEM" },
      { id: "tah", label: "TAH" },
    ],
  },
  {
    id: "territorio",
    label: "Território",
    sections: [
      { id: "evidencias", label: "Evidências" },
      { id: "geologia", label: "Geologia" },
      { id: "restricoes", label: "Restrições" },
      { id: "logistica", label: "Logística" },
    ],
  },
];

// Lista achatada das 10 seções (compatibilidade com usos antigos)
export const ANM_SUB_TABS = ANM_TAB_GROUPS.flatMap(g => g.sections);

const SECTION_ICONS: Record<string, typeof FileText> = {
  evidencias: Layers,
  processo: FileText,
  historico: Clock,
  titular: Building2,
  scm: Search,
  sei: ScrollText,
  cfem: DollarSign,
  dou: Newspaper,
  geologia: Mountain,
  restricoes: Shield,
  logistica: Truck,
  tah: Receipt,
};
interface AnmEnrichmentTabsProps {
  ativo: any;
  assetId: string;
  salvarEnrichment: (key: string, data: any) => void;
  /** id do grupo (ANM_TAB_GROUPS) cujas seções esta instância exibe; sem ele, exibe as 10 */
  group?: string;
  subTab?: string;
  onSubTabChange?: (tab: string) => void;
}

export function AnmEnrichmentTabs({ ativo, assetId, salvarEnrichment, group, subTab, onSubTabChange }: AnmEnrichmentTabsProps) {
  const grupo = ANM_TAB_GROUPS.find(g => g.id === group);
  const sections = grupo ? grupo.sections : ANM_SUB_TABS;
  const [internalSubTab, setInternalSubTab] = useState(sections[0]?.id ?? "processo");
  const requested = subTab ?? internalSubTab;
  // se a sub-aba controlada não pertence a este grupo, mantém a última visitada aqui
  const activeSubTab = sections.some(s => s.id === requested)
    ? requested
    : (sections.some(s => s.id === internalSubTab) ? internalSubTab : sections[0]?.id ?? "processo");
  const setActiveSubTab = (v: string) => {
    setInternalSubTab(v);
    onSubTabChange?.(v);
  };
  const campos = (ativo?.camposEspecificos ?? {}) as any;
  const attrs = (ativo?.attributesJson || {}) as any;
  const processoAnm = campos?.processoAnm || attrs?.anmProcesso || ativo?.anmProcesso;
  const substancia = campos?.substancia || attrs?.anmSubstancia || "";
  const lat = campos?.latitude != null ? campos.latitude : null;
  const lon = campos?.longitude != null ? campos.longitude : null;

  return (
    <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
      <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
        {sections.map(s => {
          const Icon = SECTION_ICONS[s.id] ?? FileText;
          return (
            <TabsTrigger key={s.id} value={s.id} className="text-xs gap-1" data-testid={`tab-anm-${s.id}`}>
              <Icon className="w-3.5 h-3.5" /> {s.label}
            </TabsTrigger>
          );
        })}
      </TabsList>

      <TabsContent value="processo" className="mt-3 space-y-4">
        <ProcessoSubTab ativo={ativo} campos={campos} attrs={attrs} processoAnm={processoAnm} salvarEnrichment={salvarEnrichment} />
      </TabsContent>

      <TabsContent value="historico" className="mt-3 space-y-4">
        <HistoricoSubTab processoAnm={processoAnm} savedData={campos.anmHistorico} salvarEnrichment={salvarEnrichment} />
      </TabsContent>

      <TabsContent value="titular" className="mt-3 space-y-4">
        <TitularSubTab processoAnm={processoAnm} assetId={assetId} savedData={campos.anmTitular} savedCertidoes={campos.anmCertidoesTitular} salvarEnrichment={salvarEnrichment} />
      </TabsContent>

      <TabsContent value="scm" className="mt-3 space-y-4">
        <ScmSubTab processoAnm={processoAnm} assetId={assetId} />
      </TabsContent>

      <TabsContent value="sei" className="mt-3 space-y-4">
        <SeiSubTab processoAnm={processoAnm} />
      </TabsContent>

      <TabsContent value="cfem" className="mt-3 space-y-4">
        <CfemSubTab
          processoAnm={processoAnm}
          titularCnpj={campos.anmTitular?.titular?.cnpj || null}
          savedData={campos.anmCfem}
          salvarEnrichment={salvarEnrichment}
        />
      </TabsContent>

      <TabsContent value="dou" className="mt-3 space-y-4">
        <DouSubTab
          processoAnm={processoAnm}
          titularNome={campos.anmTitular?.titular?.nome || campos.titularAnm || attrs.anmTitular || null}
          municipio={ativo?.municipio || null}
          uf={ativo?.estado || null}
          savedData={campos.anmDou}
          savedMunicipal={campos.anmDouMunicipal}
          salvarEnrichment={salvarEnrichment}
        />
      </TabsContent>

      <TabsContent value="evidencias" className="mt-3 space-y-4">
        <JazidaEvidenciasPanel assetId={assetId} lat={lat} lon={lon} />
      </TabsContent>

      <TabsContent value="geologia" className="mt-3 space-y-4">
        <GeologiaSubTab lat={lat} lon={lon} savedData={campos.anmGeologia} savedRecursos={campos.anmRecursos} savedSondagem={campos.anmSondagem} savedGeoquimica={campos.anmGeoquimica} salvarEnrichment={salvarEnrichment} />
      </TabsContent>

      <TabsContent value="restricoes" className="mt-3 space-y-4">
        <RestricoesSubTab
          lat={lat} lon={lon}
          savedData={campos.anmFunai} savedTerras={campos.anmFunaiTerras} savedRestricoes={campos.anmRestricoes}
          savedBarragens={campos.anmBarragens}
          titularCnpj={campos.anmTitular?.titular?.cnpj || null}
          titularNome={campos.anmTitular?.titular?.nome || campos.titularAnm || attrs.anmTitular || null}
          salvarEnrichment={salvarEnrichment}
        />
      </TabsContent>

      <TabsContent value="logistica" className="mt-3 space-y-4">
        <LogisticaSubTab lat={lat} lon={lon} savedData={campos.anmLogistica} salvarEnrichment={salvarEnrichment} />
      </TabsContent>

      <TabsContent value="tah" className="mt-3 space-y-4">
        <TahSubTab processoAnm={processoAnm} savedData={campos.anmTah} salvarEnrichment={salvarEnrichment} />
      </TabsContent>
    </Tabs>
  );
}

function ProcessoSubTab({ ativo, campos, attrs, processoAnm, salvarEnrichment }: any) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(campos.anmLiveData || null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Fallback campo a campo com o cache do SCM (mesma fonte da aba SCM) — a
  // tabela nunca fica vazia quando o dado existe em outra seção
  const scmParts = (processoAnm || "").replace(/\./g, "").split("/");
  const { data: scmCache } = useQuery<any>({
    queryKey: ["/api/scm/processo", scmParts[0], scmParts[1]],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/scm/processo/${scmParts[0]}/${scmParts[1]}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!processoAnm && scmParts.length === 2 && !!scmParts[1],
    staleTime: 1000 * 60 * 30,
    retry: false,
  });

  const liveFeature = result?.features?.[0] || null;
  const scmFonte = scmCache?.consultadoEm ? `SCM (cache de ${new Date(scmCache.consultadoEm).toLocaleDateString("pt-BR")})` : "SCM (cache)";

  const pick = (...srcs: Array<[any, string | null]>): { value: any; fonte: string | null } | null => {
    for (const [v, fonte] of srcs) {
      if (v !== null && v !== undefined && v !== "") return { value: v, fonte };
    }
    return null;
  };

  const faseAnm = pick([campos.faseAnm || attrs.anmFase, null], [liveFeature?.FASE, "SIGMINE"], [scmCache?.fase, scmFonte]);
  const situacaoAnm = pick([campos.situacaoAnm, null], [scmCache?.statusAtivo === true ? "Ativo" : scmCache?.statusAtivo === false ? "Inativo" : null, scmFonte]);
  const validadeAnm = campos.validadeAnm;
  const ultimoEventoAnm = pick([campos.ultimoEventoAnm || attrs.anmUltEvento, null], [liveFeature?.ULT_EVENTO, "SIGMINE"]);
  const substancia = pick([campos.substancia || attrs.anmSubstancia, null], [liveFeature?.SUBS, "SIGMINE"]);
  const titular = pick([liveFeature?.NOME, "SIGMINE"], [scmCache?.titularNome, scmFonte]);

  const diasRestantesRaw = validadeAnm
    ? Math.floor((new Date(validadeAnm).getTime() - Date.now()) / 86400000)
    : null;
  const diasRestantes = diasRestantesRaw !== null && !isNaN(diasRestantesRaw) ? diasRestantesRaw : null;

  const gridItems = [
    { label: "Nº Processo", value: processoAnm },
    { label: "Substância", value: substancia?.value, fonte: substancia?.fonte },
    { label: "Fase", value: faseAnm?.value, fonte: faseAnm?.fonte },
    { label: "Situação", value: situacaoAnm?.value, fonte: situacaoAnm?.fonte },
    { label: "Área", value: ativo.areaHa ? `${Number(ativo.areaHa).toLocaleString("pt-BR")} ha` : (scmCache?.areaHa ? `${Number(scmCache.areaHa).toLocaleString("pt-BR")} ha` : null), fonte: ativo.areaHa ? null : (scmCache?.areaHa ? scmFonte : null) },
    { label: "UF", value: ativo.estado || scmCache?.uf, fonte: ativo.estado ? null : (scmCache?.uf ? scmFonte : null) },
    { label: "Validade", value: validadeAnm ? new Date(validadeAnm).toLocaleDateString("pt-BR") : null },
    { label: "Titular", value: titular?.value, fonte: titular?.fonte },
    { label: "Último evento", value: ultimoEventoAnm?.value, fonte: ultimoEventoAnm?.fonte },
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
            {gridItems.map((item: any) => (
              <div key={item.label}>
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="text-sm font-medium mt-0.5" data-testid={`text-anm-${item.label.toLowerCase().replace(/[^a-z]/g, "-")}`}>
                  {item.value}
                  {item.fonte && <span className="ml-1 text-[9px] text-muted-foreground font-normal">[{item.fonte}]</span>}
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

function TitularSubTab({ processoAnm, assetId, savedData, savedCertidoes, salvarEnrichment }: { processoAnm: string | null; assetId: string; savedData?: any; savedCertidoes?: any; salvarEnrichment: (key: string, data: any) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [resolveSteps, setResolveSteps] = useState<string[]>([]);
  const [resolveResult, setResolveResult] = useState<any>(null);
  const [manualCnpj, setManualCnpj] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);

  const [cnpjManualInput, setCnpjManualInput] = useState("");

  const openCompanyMutation = useMutation({
    mutationFn: async ({ titularNome, cnpjManual, uf, substancia, fase, processo }: {
      titularNome: string; cnpjManual?: string; uf?: string; substancia?: string; fase?: string; processo?: string;
    }) => {
      setResolveResult(null);
      setShowManualInput(false);
      setResolveSteps(["Iniciando resolução inteligente de CNPJ..."]);

      const res = await apiRequest("POST", "/api/anm/smart-resolve-cnpj", {
        titularNome, cnpjManual: cnpjManual || undefined, uf, substancia, fase, processo, assetId,
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
        queryClient.invalidateQueries({ queryKey: ["/api/companies/catalogo"] });
        queryClient.invalidateQueries({ queryKey: ["/api/assets", assetId] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/companies/catalogo"] });
      queryClient.invalidateQueries({ queryKey: ["/api/assets", assetId] });
      setShowManualInput(false);
      setManualCnpj("");
      window.open(`/empresas/${result.companyId}`, "_blank");
    },
    onError: () => {
      toast({ title: "Erro ao vincular CNPJ", variant: "destructive" });
    },
  });

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["/api/anm/titular", processoAnm, assetId],
    queryFn: async () => {
      if (!processoAnm) return null;
      const res = await apiRequest("GET", `/api/anm/titular/${encodeURIComponent(processoAnm)}${assetId ? `?assetId=${assetId}` : ""}`);
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
                      {data.titular.cnpjFonte && (
                        <Badge
                          variant={data.titular.cnpjFonte === "TAH" ? "default" : "secondary"}
                          className="text-[10px]"
                          data-testid="badge-cnpj-fonte"
                        >
                          {data.titular.cnpjFonte === "TAH" ? "Dados Abertos" : data.titular.cnpjFonte === "SCM" ? "SCM" : "Geoportal"}
                        </Badge>
                      )}
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
                <div className="flex items-end gap-2 flex-wrap">
                  <div className="flex-1 min-w-[180px]">
                    <label className="text-[10px] text-muted-foreground mb-1 block">CNPJ (opcional — digite se souber)</label>
                    <input
                      type="text"
                      placeholder="00.000.000/0000-00"
                      value={cnpjManualInput}
                      onChange={(e) => setCnpjManualInput(e.target.value)}
                      className="w-full px-2 py-1.5 text-xs border rounded-md bg-background font-mono"
                      data-testid="input-cnpj-manual-titular"
                    />
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => openCompanyMutation.mutate({
                      titularNome: data.titular.nome,
                      cnpjManual: cnpjManualInput.replace(/\D/g, "").length === 14 ? cnpjManualInput : undefined,
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
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Resolução inteligente: busca empresa na Receita Federal pelo nome do titular usando IA. Ou informe o CNPJ manualmente no campo acima.
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

                {!openCompanyMutation.isPending && resolveSteps.length > 0 && resolveResult && (() => {
                  const formatCnpj = (cnpj: string) => cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
                  const methodLabel = (m: string) => {
                    if (m === "manual") return "CNPJ Manual";
                    if (m === "tah_dados_abertos") return "Dados Abertos ANM";
                    if (m === "cnpja_name_search_unique") return "Receita Federal";
                    if (m === "cnpja_ai_disambiguation") return "Receita Federal / IA";
                    if (m === "cnpja_exact_name_match") return "Match Exato";
                    if (m === "cnpja_name_search_broad") return "Busca Ampliada";
                    return m || "IA";
                  };

                  return (
                    <div className="rounded-lg border p-3 space-y-2" data-testid="resolve-result">
                      {resolveResult.resolvedCnpj ? (
                        <>
                          <div className="flex items-center gap-2 text-xs font-medium">
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                            <span>CNPJ resolvido: {formatCnpj(resolveResult.resolvedCnpj)}</span>
                            <Badge variant="outline" className="text-[10px]">{methodLabel(resolveResult.resolvedMethod)}</Badge>
                          </div>
                        </>
                      ) : resolveResult.pessoaFisica ? (
                        <div className="flex items-center gap-2 text-xs font-medium">
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                          <span>Titular identificado como Pessoa Física</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-xs font-medium">
                          <AlertCircle className="w-4 h-4 text-orange-500" />
                          <span>CNPJ não encontrado automaticamente</span>
                        </div>
                      )}
                      <div className="space-y-1">
                        {resolveResult.steps?.map((step: string, i: number) => (
                          <div key={i} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                            <ChevronRight className="w-3 h-3 mt-0.5 shrink-0" />
                            <span>{step}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

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

      {!isLoading && data?.titular?.cnpj && (
        <CertidoesTitularCard cnpj={data.titular.cnpj} assetId={assetId} savedData={savedCertidoes} salvarEnrichment={salvarEnrichment} />
      )}

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

function CertidoesTitularCard({ cnpj, assetId, savedData, salvarEnrichment }: { cnpj: string; assetId?: string; savedData?: any; salvarEnrichment: (key: string, data: any) => void }) {
  const [data, setData] = useState<any>(savedData || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const consultar = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest("GET", `/api/dossie/certidoes-titular?cnpj=${cnpj}${assetId ? `&assetId=${assetId}` : ""}${data ? "&refresh=1" : ""}`);
      if (!res.ok) throw new Error();
      const result = await res.json();
      setData(result);
      if (result?.disponivel !== false) {
        salvarEnrichment("anmCertidoesTitular", result);
        toast({ title: "Certidões do titular consultadas!" });
      }
    } catch {
      setError("Não foi possível consultar as certidões agora");
    } finally {
      setLoading(false);
    }
  };

  const erros: any[] = Array.isArray(data?.erros) ? data.erros : [];
  const fonteIndisponivel = (nome: string) => erros.some((e) => String(e?.fonte || "").toLowerCase().includes(nome));

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="w-4 h-4" />
          Certidões do Titular
        </CardTitle>
        <Button variant="outline" size="sm" onClick={consultar} disabled={loading} className="gap-1.5 h-7" data-testid="button-consultar-certidoes-titular">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          <span className="text-xs">{data ? "Atualizar" : "Consultar"}</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {!data && !loading && !error && (
          <p className="text-xs text-muted-foreground">Consulta gratuita de dívida ativa (PGFN), processos judiciais (DataJud/CNJ) e sanções (CEIS) para o CNPJ do titular.</p>
        )}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {data?.disponivel === false && (
          <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{data.message || "Certidões indisponíveis no momento"}</span>
          </div>
        )}
        {data?.disponivel && (
          <>
            <div className="border rounded-lg p-3 flex items-center justify-between gap-2 flex-wrap" data-testid="certidao-pgfn">
              <p className="text-sm font-medium">Dívida ativa — PGFN</p>
              {data.pgfn ? (
                data.pgfn.temDebitoAtivo
                  ? <Badge className="text-[10px] bg-red-600 text-white">
                      Possui dívida ativa
                      {typeof data.pgfn.valorConsolidado === "number" ? ` (R$ ${data.pgfn.valorConsolidado.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${data.pgfn.referencia ? ` — ref. ${String(data.pgfn.referencia).replace(/^(\d{4})_trimestre_0?(\d+)$/, "$1 T$2")}` : ""})` : ""}
                    </Badge>
                  : data.pgfn.temDebitoAtivo === false
                    ? <Badge className="text-[10px] bg-green-600 text-white">
                        Sem débitos inscritos
                        {data.pgfn.referencia ? ` (ref. ${String(data.pgfn.referencia).replace(/^(\d{4})_trimestre_0?(\d+)$/, "$1 T$2")})` : ""}
                      </Badge>
                    : <Badge variant="outline" className="text-[10px]">{data.pgfn.baseImportada === false ? "Aguardando importação da base PGFN" : (data.pgfn.situacao || "Indeterminado")}</Badge>
              ) : <Badge variant="outline" className="text-[10px] text-muted-foreground">{fonteIndisponivel("pgfn") ? "Fonte indisponível" : "Não consultado"}</Badge>}
              {data.pgfn?.situacao && (data.pgfn.temDebitoAtivo !== null || data.pgfn.baseImportada === false) && <p className="text-[10px] text-muted-foreground w-full">{data.pgfn.situacao}</p>}
            </div>
            <div className="border rounded-lg p-3 flex items-start justify-between gap-2 flex-wrap" data-testid="certidao-cnj">
              <p className="text-sm font-medium">Processos judiciais — DataJud/CNJ</p>
              {data.cnj ? (
                (data.cnj.totalProcessos ?? 0) > 0
                  ? <Badge className="text-[10px] bg-amber-500 text-white">{data.cnj.totalProcessos} processo(s)</Badge>
                  : <Badge className="text-[10px] bg-green-600 text-white">Nenhum processo encontrado</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  {fonteIndisponivel("cnj") ? "API pública não suporta busca por CNPJ" : "Não consultado"}
                </Badge>
              )}
              {data.cnj?.processos?.length > 0 && (
                <div className="w-full mt-1 space-y-1 max-h-[150px] overflow-y-auto">
                  {data.cnj.processos.slice(0, 8).map((p: any, i: number) => (
                    <p key={i} className="text-[11px] text-muted-foreground">• {p.numero || p.numeroProcesso || "processo"}{p.classe ? ` — ${p.classe}` : ""}{p.tribunal ? ` (${p.tribunal})` : ""}</p>
                  ))}
                </div>
              )}
              {fonteIndisponivel("cnj") && (
                <p className="text-[10px] text-muted-foreground w-full mt-1 italic">
                  A API pública do CNJ DataJud não indexa partes (CPF/CNPJ) por razões de LGPD. Consulte a API credenciada para buscar processos por CNPJ do titular.
                </p>
              )}
            </div>
            <div className="border rounded-lg p-3 flex items-center justify-between gap-2 flex-wrap" data-testid="certidao-ceis">
              <p className="text-sm font-medium">Sanções — CEIS</p>
              {data.ceis ? (
                fonteIndisponivel("ceis")
                  ? <Badge variant="outline" className="text-[10px] text-muted-foreground">Fonte indisponível</Badge>
                  : data.ceis.sancionado
                    ? <Badge className="text-[10px] bg-red-600 text-white">Sancionado ({data.ceis.sancoes?.length || 0})</Badge>
                    : <Badge className="text-[10px] bg-green-600 text-white">Nenhuma sanção vigente</Badge>
              ) : <Badge variant="outline" className="text-[10px] text-muted-foreground">{fonteIndisponivel("ceis") ? "Fonte indisponível" : "Não consultado"}</Badge>}
            </div>
            {erros.length > 0 && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">Fontes indisponíveis nesta consulta: {erros.map((e) => e?.fonte || String(e)).join(", ")} — resultado não é conclusivo para essas fontes.</p>
            )}
            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t">
              <span>Fontes: PGFN · DataJud/CNJ · Portal da Transparência (CEIS)</span>
              <span>Consultado: {data.consultadoEm ? new Date(data.consultadoEm).toLocaleString("pt-BR") : "N/I"}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function GeologiaSubTab({ lat, lon, savedData, savedRecursos, savedSondagem, savedGeoquimica, salvarEnrichment }: { lat: number | null; lon: number | null; savedData?: any; savedRecursos?: any; savedSondagem?: any; savedGeoquimica?: any; salvarEnrichment: (key: string, data: any) => void }) {
  const [raioKm, setRaioKm] = useState(50);
  const [forceRefresh, setForceRefresh] = useState(false);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["/api/anm-enrichment/cprm/geologia", lat, lon],
    queryFn: async () => {
      if (lat == null || lon == null) return null;
      const res = await apiRequest("GET", `/api/anm-enrichment/cprm/geologia?lat=${lat}&lon=${lon}${forceRefresh ? "&refresh=1" : ""}`);
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
    queryKey: ["/api/anm-enrichment/cprm/recursos", lat, lon, raioKm],
    queryFn: async () => {
      if (lat == null || lon == null) return null;
      const res = await apiRequest("GET", `/api/anm-enrichment/cprm/recursos?lat=${lat}&lon=${lon}&raio=${raioKm}`);
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

  const [raioSond, setRaioSond] = useState(25);
  const { data: sondagem, isLoading: sondLoading, refetch: refetchSond, isFetching: sondFetching } = useQuery({
    queryKey: ["/api/anm-enrichment/cprm/sondagem", lat, lon, raioSond],
    queryFn: async () => {
      if (lat == null || lon == null) return null;
      const res = await apiRequest("GET", `/api/anm-enrichment/cprm/sondagem?lat=${lat}&lon=${lon}&raio=${raioSond}`);
      if (!res.ok) throw new Error();
      const result = await res.json();
      if (result?.disponivel !== false) salvarEnrichment("anmSondagem", result);
      return result;
    },
    enabled: lat != null && lon != null,
    staleTime: 1000 * 60 * 60,
    retry: 1,
    placeholderData: savedSondagem || undefined,
  });

  const { data: geoquimica, isLoading: geoqLoading, refetch: refetchGeoq, isFetching: geoqFetching } = useQuery({
    queryKey: ["/api/anm-enrichment/cprm/geoquimica", lat, lon, raioSond],
    queryFn: async () => {
      if (lat == null || lon == null) return null;
      const res = await apiRequest("GET", `/api/anm-enrichment/cprm/geoquimica?lat=${lat}&lon=${lon}&raio=${raioSond}`);
      if (!res.ok) throw new Error();
      const result = await res.json();
      if (result?.disponivel !== false) salvarEnrichment("anmGeoquimica", result);
      return result;
    },
    enabled: lat != null && lon != null,
    staleTime: 1000 * 60 * 60,
    retry: 1,
    placeholderData: savedGeoquimica || undefined,
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
            <ConsultaAntigaBadge consultadoEm={data?.consultadoEm} testId="badge-geologia-consulta-antiga" />
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => { setForceRefresh(true); setTimeout(() => refetch().finally(() => setForceRefresh(false)), 0); }} disabled={isFetching} className="gap-1.5 h-7" data-testid="button-refresh-geologia">
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
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Pickaxe className="w-4 h-4" />
            Ocorrências Minerais Próximas
            <ConsultaAntigaBadge consultadoEm={recursos?.consultadoEm} testId="badge-recursos-consulta-antiga" />
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Raio:</span>
            <select
              value={raioKm}
              onChange={(e) => setRaioKm(Number(e.target.value))}
              className="text-xs border rounded-md px-1.5 py-1 bg-background"
              data-testid="select-raio-recursos"
            >
              <option value={10}>10 km</option>
              <option value={25}>25 km</option>
              <option value={50}>50 km</option>
              <option value={100}>100 km</option>
            </select>
          </div>
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

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Waves className="w-4 h-4" />
            Furos de Sondagem CPRM
            <ConsultaAntigaBadge consultadoEm={sondagem?.consultadoEm} testId="badge-sondagem-consulta-antiga" />
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Raio:</span>
            <select
              value={raioSond}
              onChange={(e) => setRaioSond(Number(e.target.value))}
              className="text-xs border rounded-md px-1.5 py-1 bg-background"
              data-testid="select-raio-sondagem"
            >
              <option value={10}>10 km</option>
              <option value={25}>25 km</option>
              <option value={50}>50 km</option>
            </select>
            <Button variant="ghost" size="sm" onClick={() => refetchSond()} disabled={sondFetching} className="gap-1.5 h-7" data-testid="button-refresh-sondagem">
              {sondFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Atualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {(sondLoading || (sondFetching && !sondagem)) && (
            <div className="flex items-center justify-center py-6 gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Buscando sondagens históricas (pode demorar)...</span>
            </div>
          )}

          {sondagem?.disponivel === false && (
            <div className="flex flex-col items-center py-6 gap-2 text-center">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
              <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">{sondagem.message || "Serviço de sondagens indisponível"}</p>
              <p className="text-[10px] text-muted-foreground">O serviço do GeoSGB é instável — tente atualizar em alguns minutos.</p>
            </div>
          )}

          {!sondLoading && sondagem?.disponivel && sondagem?.data?.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground mb-2">{sondagem.total} furo(s) em {sondagem.raio_km} km — indício de interesse exploratório prévio na região</p>
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                {sondagem.data.slice(0, 30).map((s: any, idx: number) => (
                  <div key={idx} className="p-2.5 border rounded-lg text-xs" data-testid={`sondagem-${idx}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Waves className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <span className="font-medium truncate">{s.furo || "Furo"}</span>
                        {s.url_rigeo && (
                          <a href={s.url_rigeo} target="_blank" rel="noopener noreferrer" className="text-blue-600 shrink-0" data-testid={`link-sondagem-${idx}`}>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {s.profundidade_m != null && <span className="text-muted-foreground">{s.profundidade_m} m</span>}
                        {s.distancia_km != null && <Badge variant="secondary" className="text-[10px]">{s.distancia_km} km</Badge>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-1 text-muted-foreground">
                      {s.projeto && <span>{s.projeto}</span>}
                      {s.unidade_estratigrafica && <span>• {s.unidade_estratigrafica}</span>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t">
                <span>Fonte: {sondagem.fonte}</span>
                <span>Consultado: {sondagem.consultadoEm ? new Date(sondagem.consultadoEm).toLocaleString("pt-BR") : "N/I"}</span>
              </div>
            </div>
          )}

          {!sondLoading && sondagem?.disponivel && (!sondagem?.data || sondagem.data.length === 0) && (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum furo de sondagem da CPRM registrado no raio consultado.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <FlaskConical className="w-4 h-4" />
            Geoquímica CPRM
            <ConsultaAntigaBadge consultadoEm={geoquimica?.consultadoEm} testId="badge-geoquimica-consulta-antiga" />
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetchGeoq()} disabled={geoqFetching} className="gap-1.5 h-7" data-testid="button-refresh-geoquimica">
            {geoqFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Atualizar
          </Button>
        </CardHeader>
        <CardContent>
          {(geoqLoading || (geoqFetching && !geoquimica)) && (
            <div className="flex items-center justify-center py-6 gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Buscando amostras geoquímicas...</span>
            </div>
          )}

          {geoquimica?.disponivel === false && (
            <div className="flex flex-col items-center py-6 gap-2 text-center">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
              <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">{geoquimica.message || "Serviço de geoquímica indisponível"}</p>
            </div>
          )}

          {!geoqLoading && geoquimica?.disponivel && geoquimica?.total > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{geoquimica.total} amostra(s) em {geoquimica.raio_km} km</p>
              {geoquimica.porClasse && Object.keys(geoquimica.porClasse).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(geoquimica.porClasse).map(([classe, qtd]: [string, any]) => (
                    <Badge key={classe} variant="outline" className="text-[10px]" data-testid={`geoq-classe-${classe}`}>{classe}: {qtd}</Badge>
                  ))}
                </div>
              )}
              <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
                {(geoquimica.data || []).slice(0, 20).map((g: any, idx: number) => (
                  <div key={idx} className="p-2 border rounded-lg text-xs flex items-center justify-between gap-2" data-testid={`geoquimica-${idx}`}>
                    <div className="min-w-0">
                      <span className="font-medium">{g.classe || g.tipo_amostragem || "Amostra"}</span>
                      <span className="text-muted-foreground"> {g.material ? `— ${g.material}` : ""}{g.projeto ? ` (${g.projeto})` : ""}</span>
                    </div>
                    {g.distancia_km != null && <Badge variant="secondary" className="text-[10px] shrink-0">{g.distancia_km} km</Badge>}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t">
                <span>Fonte: {geoquimica.fonte}</span>
                <span>Consultado: {geoquimica.consultadoEm ? new Date(geoquimica.consultadoEm).toLocaleString("pt-BR") : "N/I"}</span>
              </div>
            </div>
          )}

          {!geoqLoading && geoquimica?.disponivel && (!geoquimica?.total || geoquimica.total === 0) && (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhuma amostra geoquímica da CPRM no raio consultado.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

const CAMADAS_RESTRICAO: { key: string; label: string }[] = [
  { key: "unidadesConservacao", label: "Unidades de Conservação" },
  { key: "embargos", label: "Embargos Ambientais" },
  { key: "cavernas", label: "Cavernas (CANIE/CECAV)" },
  { key: "quilombolas", label: "Territórios Quilombolas" },
  { key: "assentamentos", label: "Assentamentos" },
];

function LogisticaSubTab({ lat, lon, savedData, salvarEnrichment }: { lat: number | null; lon: number | null; savedData?: any; salvarEnrichment: (key: string, data: any) => void }) {
  const [forceRefresh, setForceRefresh] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["/api/anm-enrichment/logistica", lat, lon],
    queryFn: async () => {
      if (lat == null || lon == null) return null;
      const res = await apiRequest("GET", `/api/anm-enrichment/logistica?lat=${lat}&lon=${lon}${forceRefresh ? "&refresh=1" : ""}`);
      if (!res.ok) throw new Error();
      const result = await res.json();
      if (result?.disponivel !== false) salvarEnrichment("anmLogistica", result);
      return result;
    },
    enabled: lat != null && lon != null,
    staleTime: 1000 * 60 * 60,
    retry: 1,
    placeholderData: savedData || undefined,
  });

  if (lat == null || lon == null) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
          <MapPin className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Coordenadas não disponíveis — cadastre latitude e longitude do ativo.</p>
        </CardContent>
      </Card>
    );
  }

  const itens = [
    { key: "rodovia", label: "Rodovia federal mais próxima", icon: Truck, item: data?.rodovia, fonte: data?.fontes?.rodovia, detalhes: (it: any) => [it.situacao, it.administracao, it.trecho].filter(Boolean).join(" · ") },
    { key: "ferrovia", label: "Ferrovia mais próxima", icon: TrainFront, item: data?.ferrovia, fonte: data?.fontes?.ferrovia, detalhes: (it: any) => [it.situacao, it.bitola ? `bitola ${it.bitola}` : null, [it.municipio, it.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ") },
    { key: "hidrovia", label: "Hidrovia mais próxima", icon: Waves, item: data?.hidrovia, fonte: data?.fontes?.hidrovia, detalhes: (it: any) => [it.rio && it.rio !== it.nome ? it.rio : null, it.classificacao, it.jurisdicao, it.extensaoKm ? `${Number(it.extensaoKm).toLocaleString("pt-BR")} km navegáveis` : null].filter(Boolean).join(" · ") },
    { key: "porto", label: "Porto mais próximo", icon: Anchor, item: data?.porto, fonte: data?.fontes?.porto, detalhes: (it: any) => [it.tipo, it.situacao, [it.cidade, it.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ") },
    { key: "linhaTransmissao", label: "Linha de transmissão mais próxima", icon: Zap, item: data?.linhaTransmissao, fonte: data?.fontes?.linhaTransmissao, detalhes: (it: any) => [it.tensaoKv ? `${it.tensaoKv} kV` : null, it.concessionaria, it.anoOperacao ? `operação desde ${it.anoOperacao}` : null].filter(Boolean).join(" · ") },
  ];

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Truck className="w-4 h-4" />
          Logística — Infraestrutura Próxima
        </CardTitle>
        <Button variant="ghost" size="sm" disabled={isFetching} className="gap-1.5 h-7" data-testid="button-refresh-logistica"
          onClick={() => { setForceRefresh(true); setTimeout(() => { refetch(); setForceRefresh(false); }, 0); }}>
          {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Atualizar
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && (
          <div className="flex items-center justify-center py-8 gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Consultando rodovias, hidrovias, ferrovias, portos e linhas de transmissão...</span>
          </div>
        )}
        {data?.disponivel === false && (
          <div className="flex flex-col items-center py-6 gap-2 text-center">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Não foi possível consultar a infraestrutura logística agora</p>
          </div>
        )}
        {data?.disponivel && itens.map(({ key, label, icon: Icon, item, fonte, detalhes }) => (
          <div key={key} className="border rounded-lg p-3 flex items-start gap-3" data-testid={`logistica-${key}`}>
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">{label}</p>
              {!item || item.consultado === false ? (
                <p className="text-sm font-medium mt-0.5 text-amber-700 dark:text-amber-400">Fonte indisponível — tente atualizar</p>
              ) : !item.encontrado ? (
                <p className="text-sm font-medium mt-0.5">Nenhuma encontrada em até {item.raioBuscaKm} km</p>
              ) : (
                <>
                  <p className="text-sm font-medium mt-0.5">{item.nome}</p>
                  {detalhes(item) && <p className="text-xs text-muted-foreground mt-0.5">{detalhes(item)}</p>}
                </>
              )}
              {fonte && <p className="text-[10px] text-muted-foreground/70 mt-1">Fonte: {fonte}</p>}
            </div>
            {item?.encontrado && (
              <Badge variant="outline" className="shrink-0 text-xs font-semibold">
                {Number(item.distanciaKm).toLocaleString("pt-BR")} km
              </Badge>
            )}
          </div>
        ))}
        {data?.consultadoEm && (
          <p className="text-[10px] text-muted-foreground text-right">Consultado em {new Date(data.consultadoEm).toLocaleString("pt-BR")}</p>
        )}
      </CardContent>
    </Card>
  );
}

// Limiar (dias) a partir do qual uma consulta persistida é considerada antiga
const CONSULTA_ANTIGA_DIAS = 90;

/** Dias decorridos desde um timestamp ISO; null se ausente/inválido */
function diasDesdeConsulta(consultadoEm?: string | null): number | null {
  if (!consultadoEm) return null;
  const t = new Date(consultadoEm).getTime();
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

/** Badge "consulta antiga" quando a consulta persistida passou do limiar */
function ConsultaAntigaBadge({ consultadoEm, testId }: { consultadoEm?: string | null; testId: string }) {
  const dias = diasDesdeConsulta(consultadoEm);
  if (dias === null || dias <= CONSULTA_ANTIGA_DIAS) return null;
  return (
    <Badge
      variant="outline"
      className="text-[10px] gap-1 border-amber-400 text-amber-700 dark:text-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30"
      title={`Consulta feita há ${dias} dias — clique em Atualizar para reconsultar as fontes`}
      data-testid={testId}
    >
      <Clock className="w-3 h-3" />
      Consulta antiga ({dias} dias)
    </Badge>
  );
}

function RestricoesSubTab({ lat, lon, savedData, savedTerras, savedRestricoes, savedBarragens, titularCnpj, titularNome, salvarEnrichment }: { lat: number | null; lon: number | null; savedData?: any; savedTerras?: any; savedRestricoes?: any; savedBarragens?: any; titularCnpj?: string | null; titularNome?: string | null; salvarEnrichment: (key: string, data: any) => void }) {
  // inicializa com o raio da consulta persistida (ex.: salva pela geração do
  // PDF), para exibir o dado salvo sem disparar reconsulta por desencontro de raio
  const savedRaio = [10, 25, 50].includes(savedRestricoes?.raio_km) ? savedRestricoes.raio_km : 25;
  const [raioRestricoes, setRaioRestricoes] = useState<number>(savedRaio);
  // só a troca explícita do seletor (ou o botão Atualizar) dispara nova consulta
  const [raioAlterado, setRaioAlterado] = useState(false);
  const [refreshRestricoes, setRefreshRestricoes] = useState(false);
  // se o dado persistido chegar depois da montagem (refetch do ativo), realinha
  // o seletor enquanto o usuário ainda não mexeu nele
  useEffect(() => {
    if (!raioAlterado && [10, 25, 50].includes(savedRestricoes?.raio_km)) {
      setRaioRestricoes(savedRestricoes.raio_km);
    }
  }, [savedRestricoes?.raio_km, raioAlterado]);
  const [raioBarragens, setRaioBarragens] = useState(50);

  const { data: barragens, isLoading: barragensLoading, refetch: refetchBarragens, isFetching: barragensFetching } = useQuery({
    queryKey: ["/api/sigbm/barragens", lat, lon, raioBarragens, titularCnpj, titularNome],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (lat != null && lon != null) {
        params.set("lat", String(lat));
        params.set("lon", String(lon));
        params.set("raio", String(raioBarragens));
      }
      if (titularCnpj) params.set("cnpj", titularCnpj);
      if (titularNome) params.set("nome", titularNome);
      const res = await apiRequest("GET", `/api/sigbm/barragens?${params.toString()}`);
      if (!res.ok) throw new Error();
      const result = await res.json();
      if (result?.disponivel !== false) salvarEnrichment("anmBarragens", result);
      return result;
    },
    enabled: (lat != null && lon != null) || !!titularCnpj || !!(titularNome && titularNome.length >= 5),
    staleTime: 1000 * 60 * 60,
    retry: 1,
    placeholderData: savedBarragens || undefined,
  });

  const { data: restricoes, isLoading: loadingRestricoes, refetch: refetchRestricoes, isFetching: fetchingRestricoes } = useQuery({
    queryKey: ["/api/anm-enrichment/restricoes/cruzamento", lat, lon, raioRestricoes],
    queryFn: async () => {
      if (lat == null || lon == null) return null;
      const res = await apiRequest("GET", `/api/anm-enrichment/restricoes/cruzamento?lat=${lat}&lon=${lon}&raio=${raioRestricoes}${refreshRestricoes ? "&refresh=1" : ""}`);
      if (!res.ok) throw new Error();
      const result = await res.json();
      if (result?.disponivel !== false) salvarEnrichment("anmRestricoes", result);
      return result;
    },
    // dados persistidos (ex.: pela geração do PDF) são exibidos direto;
    // só reconsulta automaticamente se não houver dado salvo ou se o usuário
    // trocou explicitamente o raio no seletor
    enabled: lat != null && lon != null && (!savedRestricoes?.camadas || (raioAlterado && savedRestricoes.raio_km !== raioRestricoes)),
    staleTime: 1000 * 60 * 60,
    retry: 1,
    placeholderData: savedRestricoes || undefined,
  });

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
    // exibe o dado persistido sem reconsultar; botão "Atualizar" força nova consulta
    enabled: lat != null && lon != null && !savedData,
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
    // exibe o dado persistido sem reconsultar
    enabled: lat != null && lon != null && !savedTerras,
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

  const sem = restricoes?.disponivel !== false ? restricoes?.semaforo : null;
  const semCfg = sem === "vermelho"
    ? { cor: "bg-red-500", txt: "Restrição crítica: sobreposição direta detectada", cls: "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800 text-red-800 dark:text-red-300" }
    : sem === "amarelo"
    ? { cor: "bg-amber-500", txt: "Atenção: ocorrências próximas ou fontes não consultadas", cls: "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300" }
    : sem === "verde"
    ? { cor: "bg-green-500", txt: "Sem restrições identificadas no raio analisado", cls: "bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-800 text-green-800 dark:text-green-300" }
    : null;

  return (
    <>
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Restrições Ambientais e Fundiárias
            <ConsultaAntigaBadge consultadoEm={restricoes?.consultadoEm} testId="badge-restricoes-consulta-antiga" />
          </CardTitle>
          <div className="flex items-center gap-2">
            <select
              value={raioRestricoes}
              onChange={(e) => { setRaioAlterado(true); setRaioRestricoes(Number(e.target.value)); }}
              className="h-7 text-xs border rounded-md px-1.5 bg-background"
              data-testid="select-raio-restricoes"
            >
              {[10, 25, 50].map((r) => <option key={r} value={r}>{r} km</option>)}
            </select>
            <Button variant="ghost" size="sm" disabled={fetchingRestricoes} className="gap-1.5 h-7" data-testid="button-refresh-cruzamento"
              onClick={() => { setRefreshRestricoes(true); setTimeout(() => { refetchRestricoes(); setRefreshRestricoes(false); }, 0); }}>
              {fetchingRestricoes ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Atualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingRestricoes && (
            <div className="flex items-center justify-center py-8 gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Cruzando restrições ambientais e fundiárias...</span>
            </div>
          )}
          {restricoes?.disponivel === false && (
            <div className="flex flex-col items-center py-6 gap-2 text-center">
              <AlertTriangle className="w-8 h-8 text-amber-500" />
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Não foi possível cruzar as restrições agora</p>
            </div>
          )}
          {semCfg && (
            <div className={cn("flex items-center gap-3 p-3 border rounded-lg", semCfg.cls)} data-testid="semaforo-restricoes">
              <span className={cn("w-3.5 h-3.5 rounded-full shrink-0", semCfg.cor)} />
              <p className="text-sm font-semibold">{semCfg.txt}</p>
              <span className="text-[10px] ml-auto opacity-70" data-testid="text-restricoes-consulta">
                raio {restricoes?.raio_km} km
                {restricoes?.consultadoEm && ` — consulta de ${new Date(restricoes.consultadoEm).toLocaleDateString("pt-BR")}`}
              </span>
            </div>
          )}
          {restricoes?.camadas && CAMADAS_RESTRICAO.map(({ key, label }) => {
            const c = restricoes.camadas[key];
            if (!c) return null;
            const status = !c.consultado ? "nc" : c.sobreposicao === true ? "sobre" : c.total > 0 ? "prox" : "ok";
            return (
              <div key={key} className="border rounded-lg p-3" data-testid={`camada-${key}`}>
                <div className="flex items-center justify-between flex-wrap gap-1.5">
                  <p className="text-sm font-medium">{label}</p>
                  {status === "nc" && <Badge variant="outline" className="text-[10px] text-muted-foreground">Não consultado</Badge>}
                  {status === "sobre" && <Badge className="text-[10px] bg-red-600 text-white">Sobreposição direta</Badge>}
                  {status === "prox" && <Badge className="text-[10px] bg-amber-500 text-white">{c.total} no raio</Badge>}
                  {status === "ok" && <Badge className="text-[10px] bg-green-600 text-white">Sem ocorrências</Badge>}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{c.fonte}</p>
                {status === "nc" && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Fonte indisponível no momento — não significa ausência de restrição.</p>
                )}
                {c.sobreposicoes?.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {c.sobreposicoes.map((s: any, i: number) => (
                      <p key={i} className="text-xs font-medium text-red-700 dark:text-red-400">• {s.nome}{s.categoria ? ` — ${s.categoria}` : ""}{s.status ? ` (${s.status})` : ""}</p>
                    ))}
                  </div>
                )}
                {c.ocorrencias?.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-[180px] overflow-y-auto">
                    {c.ocorrencias.slice(0, 15).map((o: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs gap-2">
                        <span className="truncate">{o.nome}{o.categoria ? ` (${o.categoria})` : ""}{o.relevancia ? ` — relevância ${o.relevancia}` : ""}</span>
                        {o.distancia_km != null && <span className="text-muted-foreground shrink-0">~{o.distancia_km} km</span>}
                      </div>
                    ))}
                    {c.ocorrencias.length > 15 && <p className="text-[10px] text-muted-foreground">+ {c.ocorrencias.length - 15} outras ocorrências</p>}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Terras Indígenas (FUNAI)
            <ConsultaAntigaBadge consultadoEm={data?.consultadoEm} testId="badge-funai-consulta-antiga" />
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

      {terrasProximas?.disponivel !== false && (terrasProximas?.data?.length > 0 || (diasDesdeConsulta(terrasProximas?.consultadoEm) ?? 0) > CONSULTA_ANTIGA_DIAS) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Terras Indígenas Próximas (raio {terrasProximas.raio_km || 50}km)
              <Badge variant="secondary" className="text-[10px]">{terrasProximas.total}</Badge>
              <ConsultaAntigaBadge consultadoEm={terrasProximas?.consultadoEm} testId="badge-funai-terras-consulta-antiga" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(!terrasProximas.data || terrasProximas.data.length === 0) && (
              <p className="text-xs text-muted-foreground">Nenhuma terra indígena encontrada no raio na última consulta.</p>
            )}
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {(terrasProximas.data || []).map((t: any, idx: number) => (
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

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Waves className="w-4 h-4" />
            Barragens de Mineração (SIGBM)
            <ConsultaAntigaBadge consultadoEm={barragens?.consultadoEm} testId="badge-barragens-consulta-antiga" />
          </CardTitle>
          <div className="flex items-center gap-2">
            <select
              value={raioBarragens}
              onChange={(e) => setRaioBarragens(Number(e.target.value))}
              className="h-7 text-xs border rounded-md px-1.5 bg-background"
              data-testid="select-raio-barragens"
            >
              {[25, 50, 100].map((r) => <option key={r} value={r}>{r} km</option>)}
            </select>
            <Button variant="ghost" size="sm" onClick={() => refetchBarragens()} disabled={barragensFetching} className="gap-1.5 h-7" data-testid="button-refresh-barragens">
              {barragensFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Atualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {barragensLoading && (
            <div className="flex items-center justify-center py-6 gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Consultando barragens de mineração...</span>
            </div>
          )}

          {barragens?.disponivel === false && (
            <div className="flex flex-col items-center py-6 gap-2 text-center">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
              <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">{barragens.message || "Base SIGBM indisponível no momento"}</p>
            </div>
          )}

          {!barragensLoading && barragens?.disponivel && (
            <>
              {(barragens.doTitular || []).length > 0 && (
                <div>
                  <p className="text-xs font-medium mb-1.5">Barragens do titular ({barragens.doTitular.length})</p>
                  <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
                    {barragens.doTitular.slice(0, 15).map((b: any, idx: number) => (
                      <BarragemItem key={idx} b={b} testid={`barragem-titular-${idx}`} />
                    ))}
                  </div>
                </div>
              )}
              {(barragens.doTitular || []).length === 0 && (titularCnpj || titularNome) && (
                <p className="text-xs text-muted-foreground">Nenhuma barragem de mineração registrada para o titular no SIGBM.</p>
              )}
              {(barragens.proximas || []).length > 0 && (
                <div>
                  <p className="text-xs font-medium mb-1.5">Barragens num raio de {barragens.raioKm} km ({barragens.proximas.length})</p>
                  <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
                    {barragens.proximas.map((b: any, idx: number) => (
                      <BarragemItem key={idx} b={b} testid={`barragem-proxima-${idx}`} />
                    ))}
                  </div>
                </div>
              )}
              {(barragens.proximas || []).length === 0 && lat != null && (
                <p className="text-xs text-muted-foreground">Nenhuma barragem de mineração num raio de {barragens.raioKm} km do ativo.</p>
              )}
              <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t">
                <span>Fonte: {barragens.fonte} ({barragens.totalBase} barragens na base)</span>
                <span>Consultado: {barragens.consultadoEm ? new Date(barragens.consultadoEm).toLocaleString("pt-BR") : "N/I"}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function BarragemItem({ b, testid }: { b: any; testid: string }) {
  const riscoAlto = /alt[ao]/i.test(b.categoriaRisco || "");
  const dpaAlto = /alt[ao]/i.test(b.danoPotencial || "");
  const emergencia = b.nivelEmergencia && !/sem emerg/i.test(b.nivelEmergencia) && !/n[íi]vel 0/i.test(b.nivelEmergencia);
  return (
    <div className="p-2.5 border rounded-lg text-xs" data-testid={testid}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{b.nome || "Barragem"}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {b.distanciaKm != null && <span className="text-muted-foreground">{b.distanciaKm} km</span>}
          {b.uf && <Badge variant="secondary" className="text-[10px]">{b.uf}</Badge>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {b.categoriaRisco && <Badge className={cn("text-[10px]", riscoAlto ? "bg-red-600 text-white" : "bg-muted text-foreground")}>Risco: {b.categoriaRisco}</Badge>}
        {b.danoPotencial && <Badge className={cn("text-[10px]", dpaAlto ? "bg-orange-600 text-white" : "bg-muted text-foreground")}>DPA: {b.danoPotencial}</Badge>}
        {emergencia && <Badge className="text-[10px] bg-red-600 text-white">Emergência: {b.nivelEmergencia}</Badge>}
      </div>
      <div className="flex flex-wrap gap-2 mt-1 text-muted-foreground">
        {b.empreendedor && <span className="truncate">{b.empreendedor}</span>}
        {b.municipio && <span>• {b.municipio}</span>}
        {b.minerioPrincipal && <span>• {b.minerioPrincipal}</span>}
        {b.situacaoOperacional && <span>• {b.situacaoOperacional}</span>}
      </div>
    </div>
  );
}

function CfemSubTab({ processoAnm, titularCnpj, savedData, salvarEnrichment }: { processoAnm: string | null; titularCnpj?: string | null; savedData?: any; salvarEnrichment: (key: string, data: any) => void }) {
  const cnpjDigits = (titularCnpj || "").replace(/\D/g, "");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["/api/cfem/dossie", processoAnm, cnpjDigits],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (processoAnm) params.set("processo", processoAnm);
      if (cnpjDigits.length === 14) params.set("cnpj", cnpjDigits);
      const res = await apiRequest("GET", `/api/cfem/dossie?${params.toString()}`);
      if (!res.ok) throw new Error();
      const result = await res.json();
      if (result?.disponivel !== false) salvarEnrichment("anmCfem", result);
      return result;
    },
    enabled: !!processoAnm || cnpjDigits.length === 14,
    staleTime: 1000 * 60 * 30,
    retry: 1,
    placeholderData: savedData || undefined,
  });

  if (!processoAnm && cnpjDigits.length !== 14) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <p className="text-sm text-muted-foreground">Nenhum processo ANM nem CNPJ do titular disponível para consultar o CFEM.</p>
        </CardContent>
      </Card>
    );
  }

  const fmtBRL = (v: any) => v != null ? `R$ ${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}` : "—";

  return (
    <>
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <DollarSign className="w-4 h-4" />
            CFEM — Produção Real do Processo
            <ConsultaAntigaBadge consultadoEm={data?.consultadoEm} testId="badge-cfem-consulta-antiga" />
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5 h-7" data-testid="button-refresh-cfem">
            {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Atualizar
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && (
            <div className="flex items-center justify-center py-8 gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Consultando arrecadação CFEM...</span>
            </div>
          )}

          {data?.disponivel === false && (
            <div className="flex flex-col items-center py-6 gap-2 text-center">
              <AlertTriangle className="w-8 h-8 text-amber-500" />
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">{data.message || "CFEM indisponível"}</p>
            </div>
          )}

          {!isLoading && data?.disponivel && data?.processo && (
            <>
              <div className={cn(
                "flex items-center gap-3 p-3 border rounded-lg",
                data.processo.jaProduziu
                  ? "bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-800"
                  : "bg-muted/40"
              )} data-testid="cfem-status-producao">
                {data.processo.jaProduziu
                  ? <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                  : <Minus className="w-5 h-5 text-muted-foreground shrink-0" />}
                <div>
                  <p className={cn("text-sm font-bold", data.processo.jaProduziu ? "text-green-800 dark:text-green-300" : "")}>
                    {data.processo.jaProduziu
                      ? `Este processo JÁ PRODUZIU — ${fmtBRL(data.processo.totalRecolhido)} recolhidos em CFEM`
                      : "Este processo nunca recolheu CFEM (sem produção comercializada registrada)"}
                  </p>
                  {data.baseAnos?.de && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">Base importada: {data.baseAnos.de}–{data.baseAnos.ate}</p>
                  )}
                </div>
              </div>

              {data.processo.porAno?.length > 0 && (
                <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
                  {data.processo.porAno.map((a: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between p-2 border rounded-lg text-xs" data-testid={`cfem-ano-${a.ano}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant="outline" className="text-[10px] shrink-0">{a.ano}</Badge>
                        <span className="text-muted-foreground truncate">{(a.substancias || []).join(", ")}</span>
                      </div>
                      <span className="font-medium shrink-0 ml-2">{fmtBRL(a.valorTotal)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {!isLoading && data?.disponivel && data?.titular && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              CFEM do Titular
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-3 bg-muted/30 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Já recolheu?</p>
                <p className={cn("text-sm font-bold", data.titular.jaRecolheu ? "text-green-600" : "text-muted-foreground")} data-testid="text-cfem-titular-recolheu">
                  {data.titular.jaRecolheu ? "Sim" : "Não"}
                </p>
              </div>
              <div className="text-center p-3 bg-muted/30 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Total recolhido</p>
                <p className="text-sm font-bold" data-testid="text-cfem-titular-total">{fmtBRL(data.titular.totalRecolhido)}</p>
              </div>
              <div className="text-center p-3 bg-muted/30 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Processos</p>
                <p className="text-sm font-bold" data-testid="text-cfem-titular-processos">{data.titular.processosDistintos ?? 0}</p>
              </div>
            </div>
            {data.titular.substancias?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {data.titular.substancias.slice(0, 8).map((s: any, i: number) => (
                  <Badge key={i} variant="outline" className="text-[10px]">{s.substancia}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!isLoading && data?.disponivel && data?.municipio && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Contexto CFEM do Município{data.municipio.municipio ? ` — ${data.municipio.municipio}/${data.municipio.uf}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-3 bg-muted/30 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Ranking Brasil</p>
                <p className="text-sm font-bold" data-testid="text-cfem-rank-br">
                  {data.municipio.rankBrasil ? `${data.municipio.rankBrasil}º` : "—"}
                </p>
                {data.municipio.totalMunicipiosComCfem && <p className="text-[10px] text-muted-foreground">de {data.municipio.totalMunicipiosComCfem}</p>}
              </div>
              <div className="text-center p-3 bg-muted/30 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Ranking na UF</p>
                <p className="text-sm font-bold" data-testid="text-cfem-rank-uf">{data.municipio.rankUf ? `${data.municipio.rankUf}º` : "—"}</p>
              </div>
              <div className="text-center p-3 bg-muted/30 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Arrecadação {data.municipio.anoReferencia}</p>
                <p className="text-sm font-bold" data-testid="text-cfem-mun-valor">{fmtBRL(data.municipio.valorAnoReferencia)}</p>
              </div>
            </div>
            {data.municipio.topSubstancias?.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Principais substâncias do município:</p>
                <div className="space-y-1">
                  {data.municipio.topSubstancias.map((s: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span>{s.substancia}</span>
                      <span className="text-muted-foreground">{fmtBRL(s.valorTotal)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!isLoading && data?.disponivel && (
        <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
          <span>Fonte: {data.fonte}</span>
          <span>Consultado: {data.consultadoEm ? new Date(data.consultadoEm).toLocaleString("pt-BR") : "N/I"}</span>
        </div>
      )}
    </>
  );
}

const DOU_CATEGORIA_CORES: Record<string, string> = {
  portaria_lavra: "bg-emerald-600 text-white",
  alvara_pesquisa: "bg-blue-600 text-white",
  disponibilidade: "bg-violet-600 text-white",
  penalidade: "bg-red-600 text-white",
  caducidade: "bg-orange-600 text-white",
};

const QD_CATEGORIA_CORES: Record<string, string> = {
  licenca: "bg-emerald-600 text-white",
  embargo: "bg-red-600 text-white",
  multa: "bg-orange-600 text-white",
  decreto: "bg-blue-600 text-white",
};
function DouSubTab({ processoAnm, titularNome, municipio, uf, savedData, savedMunicipal, salvarEnrichment }: { processoAnm: string | null; titularNome?: string | null; municipio?: string | null; uf?: string | null; savedData?: any; savedMunicipal?: any; salvarEnrichment: (key: string, data: any) => void }) {
  const [forceRefresh, setForceRefresh] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["/api/dou/publicacoes", processoAnm, titularNome],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (processoAnm) params.set("processo", processoAnm);
      if (titularNome) params.set("titular", titularNome);
      if (forceRefresh) params.set("refresh", "1");
      const res = await apiRequest("GET", `/api/dou/publicacoes?${params.toString()}`);
      if (!res.ok) throw new Error();
      const result = await res.json();
      if (result?.disponivel !== false) salvarEnrichment("anmDou", result);
      return result;
    },
    enabled: !!processoAnm || !!titularNome,
    staleTime: 1000 * 60 * 60,
    retry: 1,
    placeholderData: savedData || undefined,
  });

  const [forceRefreshQd, setForceRefreshQd] = useState(false);
  const { data: qd, isLoading: qdLoading, refetch: qdRefetch, isFetching: qdFetching } = useQuery({
    queryKey: ["/api/dou/municipal", processoAnm, titularNome, municipio, uf],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (processoAnm) params.set("processo", processoAnm);
      if (titularNome) params.set("titular", titularNome);
      params.set("municipio", municipio || "");
      if (uf) params.set("uf", uf);
      if (forceRefreshQd) params.set("refresh", "1");
      const res = await apiRequest("GET", `/api/dou/municipal?${params.toString()}`);
      if (!res.ok) throw new Error();
      const result = await res.json();
      if (result?.disponivel !== false) salvarEnrichment("anmDouMunicipal", result);
      return result;
    },
    enabled: (!!processoAnm || !!titularNome) && !!municipio,
    staleTime: 1000 * 60 * 60,
    retry: 1,
    placeholderData: savedMunicipal || undefined,
  });

  if (!processoAnm && !titularNome) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <p className="text-sm text-muted-foreground">Nenhum processo ANM nem titular disponível para buscar no DOU.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Newspaper className="w-4 h-4" />
          Publicações no Diário Oficial da União
          <ConsultaAntigaBadge consultadoEm={data?.consultadoEm} testId="badge-dou-consulta-antiga" />
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => { setForceRefresh(true); setTimeout(() => refetch().finally(() => setForceRefresh(false)), 0); }} disabled={isFetching} className="gap-1.5 h-7" data-testid="button-refresh-dou">
          {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Atualizar
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && (
          <div className="flex items-center justify-center py-8 gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Buscando na Imprensa Nacional (pode demorar)...</span>
          </div>
        )}

        {data?.disponivel === false && (
          <div className="flex flex-col items-center py-6 gap-2 text-center">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">{data.message || "Busca no DOU indisponível no momento"}</p>
          </div>
        )}

        {!isLoading && data?.disponivel && data?.publicacoes?.length > 0 && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="text-[10px]">{data.total} publicação(ões)</Badge>
              {data.termosBuscados?.map((t: string, i: number) => (
                <Badge key={i} variant="outline" className="text-[10px] font-mono">{t}</Badge>
              ))}
            </div>
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-muted" />
              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {data.publicacoes.map((p: any, idx: number) => (
                  <div key={idx} className="relative flex gap-3 pl-1" data-testid={`dou-pub-${idx}`}>
                    <div className="z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
                      <Newspaper className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0 pb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {p.data && <p className="text-[10px] text-muted-foreground font-medium">{p.data}</p>}
                        {p.secao && <Badge variant="outline" className="text-[10px]">{p.secao}</Badge>}
                        {p.categoria && p.categoria !== "outro" && (
                          <Badge className={cn("text-[10px]", DOU_CATEGORIA_CORES[p.categoria] || "bg-muted text-foreground")}>
                            {p.categoria.replace(/_/g, " ")}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs font-medium mt-0.5">{p.tipoAto || p.titulo}</p>
                      {p.trecho && <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5 line-clamp-3">{p.trecho}</p>}
                      {p.url && (
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 inline-flex items-center gap-1 mt-1" data-testid={`link-dou-${idx}`}>
                          Ver publicação <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {!isLoading && data?.disponivel && (!data?.publicacoes || data.publicacoes.length === 0) && (
          <p className="text-sm text-muted-foreground text-center py-6">Nenhuma publicação encontrada no DOU para este processo/titular.</p>
        )}

        {data?.disponivel && (
          <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t flex-wrap gap-1">
            <span>Fonte: {data.fonte || "Imprensa Nacional (in.gov.br)"}</span>
            <div className="flex items-center gap-2">
              {data.urlBusca && (
                <a href={data.urlBusca} target="_blank" rel="noopener noreferrer" className="text-blue-600 inline-flex items-center gap-1">
                  Busca completa <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <span>Consultado: {data.consultadoEm ? new Date(data.consultadoEm).toLocaleString("pt-BR") : "N/I"}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>

    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Newspaper className="w-4 h-4" />
          Diários Oficiais Municipais (Querido Diário)
          <ConsultaAntigaBadge consultadoEm={qd?.consultadoEm} testId="badge-dou-municipal-consulta-antiga" />
        </CardTitle>
        {municipio && (
          <Button variant="ghost" size="sm" onClick={() => { setForceRefreshQd(true); setTimeout(() => qdRefetch().finally(() => setForceRefreshQd(false)), 0); }} disabled={qdFetching} className="gap-1.5 h-7" data-testid="button-refresh-dou-municipal">
            {qdFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Atualizar
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!municipio && (
          <p className="text-sm text-muted-foreground text-center py-6">Ativo sem município definido — preencha o município do ativo para buscar atos municipais.</p>
        )}

        {municipio && qdLoading && (
          <div className="flex items-center justify-center py-8 gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Buscando nos diários municipais...</span>
          </div>
        )}

        {municipio && qd?.disponivel === false && (
          <div className="flex flex-col items-center py-6 gap-2 text-center">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400" data-testid="text-qd-indisponivel">{qd.message || "Busca no Querido Diário indisponível no momento"}</p>
          </div>
        )}

        {municipio && !qdLoading && qd?.disponivel && qd?.cobertura === false && (
          <div className="flex flex-col items-center py-6 gap-2 text-center" data-testid="text-qd-sem-cobertura">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">{qd.message}</p>
            <a href="https://queridodiario.ok.org.br/municipios-cobertos" target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 inline-flex items-center gap-1">
              Ver municípios cobertos <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {municipio && !qdLoading && qd?.disponivel && qd?.cobertura && qd?.publicacoes?.length > 0 && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="text-[10px]">{qd.total} edição(ões) com menção</Badge>
              <Badge variant="outline" className="text-[10px]">{qd.municipio}/{qd.uf}</Badge>
              {qd.termosBuscados?.map((t: string, i: number) => (
                <Badge key={i} variant="outline" className="text-[10px] font-mono">{t}</Badge>
              ))}
            </div>
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-muted" />
              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {qd.publicacoes.map((p: any, idx: number) => (
                  <div key={idx} className="relative flex gap-3 pl-1" data-testid={`qd-pub-${idx}`}>
                    <div className="z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
                      <Newspaper className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0 pb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {p.data && <p className="text-[10px] text-muted-foreground font-medium">{new Date(p.data + "T12:00:00").toLocaleDateString("pt-BR")}</p>}
                        <Badge variant="outline" className="text-[10px]">{p.municipio}/{p.uf}</Badge>
                        {p.edicao && <Badge variant="outline" className="text-[10px]">Edição {p.edicao}{p.edicaoExtra ? " (extra)" : ""}</Badge>}
                        {p.categoria && p.categoria !== "outro" && (
                          <Badge className={cn("text-[10px]", QD_CATEGORIA_CORES[p.categoria] || "bg-muted text-foreground")} data-testid={`badge-qd-categoria-${idx}`}>
                            {QD_CATEGORIA_LABELS[p.categoria] || p.categoria}
                          </Badge>
                        )}
                      </div>
                      {p.trechos?.map((t: string, i: number) => (
                        <p key={i} className="text-[11px] text-muted-foreground leading-relaxed mt-0.5 line-clamp-3">…{t}…</p>
                      ))}
                      {p.url && (
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 inline-flex items-center gap-1 mt-1" data-testid={`link-qd-${idx}`}>
                          Ver diário <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {municipio && !qdLoading && qd?.disponivel && qd?.cobertura && (!qd?.publicacoes || qd.publicacoes.length === 0) && (
          <p className="text-sm text-muted-foreground text-center py-6" data-testid="text-qd-vazio">
            Nenhuma menção ao processo/titular nos diários oficiais de {qd.municipio}/{qd.uf}.
          </p>
        )}

        {qd?.disponivel && (
          <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t flex-wrap gap-1">
            <span>Fonte: {qd.fonte || "Querido Diário — Open Knowledge Brasil"}</span>
            <div className="flex items-center gap-2">
              {qd.urlBusca && (
                <a href={qd.urlBusca} target="_blank" rel="noopener noreferrer" className="text-blue-600 inline-flex items-center gap-1">
                  Busca completa <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <span>Consultado: {qd.consultadoEm ? new Date(qd.consultadoEm).toLocaleString("pt-BR") : "N/I"}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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

function TahSubTab({ processoAnm, savedData, salvarEnrichment }: { processoAnm: string | null; savedData?: any; salvarEnrichment: (key: string, data: any) => void }) {
  // aceita o formato novo ({ registros, ambiguo }) e o legado (array)
  const extractRows = (d: any): any[] => Array.isArray(d) ? d : Array.isArray(d?.registros) ? d.registros : d ? [d] : [];
  const [data, setData] = useState<any[]>(extractRows(savedData));
  const [ambiguo, setAmbiguo] = useState<boolean>(savedData?.ambiguo === true);
  const [aviso, setAviso] = useState<string | null>(savedData?.aviso || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const consultar = async () => {
    if (!processoAnm) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tah/processo/${encodeURIComponent(processoAnm)}`, { credentials: "include" });
      if (res.status === 404) {
        setError("Nenhum registro de TAH encontrado para este processo nos Dados Abertos da ANM.");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Erro ${res.status}`);
      }
      const result = await res.json();
      const rows = extractRows(result);
      setData(rows);
      setAmbiguo(result?.ambiguo === true);
      setAviso(result?.aviso || null);
      // persiste o objeto completo (com flag de ambiguidade) para relatório/IA
      salvarEnrichment("anmTah", Array.isArray(result) ? { registros: rows, ambiguo: false } : result);
      toast({ title: `TAH: ${rows.length} registro(s) encontrado(s)` });
    } catch (err: any) {
      setError(err.message || "Erro na consulta");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (data.length === 0 && processoAnm && !loading) {
      consultar();
    }
  }, [processoAnm]);

  if (!processoAnm) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground text-center">Processo ANM não identificado</p>
        </CardContent>
      </Card>
    );
  }

  const formatCurrency = (val: number | null | undefined) => {
    if (val === null || val === undefined) return "—";
    return `R$ ${val.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatArea = (val: number | null | undefined) => {
    if (val === null || val === undefined) return "—";
    return `${val.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`;
  };

  const formatCpfCnpj = (doc: string | null | undefined) => {
    if (!doc) return "—";
    if (doc.length === 14) return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    if (doc.length === 11) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    return doc;
  };

  const totalCobrado = data.reduce((sum, r) => sum + (r.valorCobrado ?? r.valor_cobrado ?? 0), 0);
  const totalPago = data.reduce((sum, r) => sum + (r.valorPago ?? r.valor_pago ?? 0), 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Receipt className="w-4 h-4 text-amber-500" />
            TAH — Taxa Anual por Hectare
          </CardTitle>
          <Button variant="outline" size="sm" onClick={consultar} disabled={loading} data-testid="button-tah-consultar">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span className="ml-1 text-xs">{data.length > 0 ? "Atualizar" : "Consultar"}</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && data.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-sm gap-2">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Consultando dados abertos ANM...
            </div>
            <p className="text-[10px]">Pode levar alguns segundos se estiver buscando online.</p>
          </div>
        )}

        {error && data.length === 0 && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {ambiguo && data.length > 0 && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs" data-testid="text-tah-aviso-ambiguo">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{aviso || "Vínculo ambíguo: consulta feita só pelo número-base — os registros podem pertencer a processos de outros anos."}</span>
          </div>
        )}

        {data.length > 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted/40 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-emerald-700" data-testid="text-tah-total-cobrado">
                  {formatCurrency(totalCobrado)}
                </p>
                <p className="text-[10px] text-muted-foreground">Total Cobrado ({data.length} ano{data.length > 1 ? "s" : ""})</p>
              </div>
              <div className="bg-muted/40 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-green-700" data-testid="text-tah-total-pago">
                  {formatCurrency(totalPago)}
                </p>
                <p className="text-[10px] text-muted-foreground">Total Pago</p>
              </div>
            </div>

            {totalCobrado > 0 && (
              <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-muted/30">
                {totalPago >= totalCobrado ? (
                  <><CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" /><span className="text-green-700 font-medium">TAH paga integralmente</span></>
                ) : totalPago > 0 ? (
                  <><AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" /><span className="text-amber-700 font-medium">TAH parcialmente paga ({((totalPago / totalCobrado) * 100).toFixed(0)}%)</span></>
                ) : (
                  <><AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" /><span className="text-red-700 font-medium">TAH não paga</span></>
                )}
              </div>
            )}

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Ano</th>
                    <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Titular</th>
                    <th className="text-right px-2 py-1.5 font-medium text-muted-foreground">Cobrado</th>
                    <th className="text-right px-2 py-1.5 font-medium text-muted-foreground">Pago</th>
                    <th className="text-center px-2 py-1.5 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row: any, idx: number) => {
                    const cobrado = row.valorCobrado ?? row.valor_cobrado ?? 0;
                    const pago = row.valorPago ?? row.valor_pago ?? 0;
                    const isPaid = cobrado > 0 && pago >= cobrado;
                    const isPartial = pago > 0 && pago < cobrado;
                    return (
                      <tr key={idx} className="border-b last:border-0 hover:bg-muted/20" data-testid={`row-tah-${idx}`}>
                        <td className="px-2 py-1.5 font-mono font-medium">{row.anoBase ?? row.ano_base ?? "—"}</td>
                        <td className="px-2 py-1.5 truncate max-w-[120px]" title={row.nomeTitular ?? row.nome_titular ?? ""}>
                          {row.nomeTitular ?? row.nome_titular ?? "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatCurrency(cobrado)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatCurrency(pago)}</td>
                        <td className="px-2 py-1.5 text-center">
                          {isPaid ? (
                            <Badge variant="outline" className="text-[9px] bg-green-50 text-green-700 border-green-200">Paga</Badge>
                          ) : isPartial ? (
                            <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-700 border-amber-200">Parcial</Badge>
                          ) : cobrado > 0 ? (
                            <Badge variant="outline" className="text-[9px] bg-red-50 text-red-700 border-red-200">Pendente</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {data[0] && (
              <div className="space-y-1.5 pt-1">
                {(data[0].cnpjCpf || data[0].cnpj_cpf) && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">CPF/CNPJ (último)</span>
                    <span className="font-mono font-medium" data-testid="text-tah-cnpj">{formatCpfCnpj(data[0].cnpjCpf || data[0].cnpj_cpf)}</span>
                  </div>
                )}
                {data[0].fase && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Fase</span>
                    <Badge variant="outline" className="text-[10px]">{data[0].fase}</Badge>
                  </div>
                )}
                {data[0].uf && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">UF</span>
                    <span className="font-medium">{data[0].uf}</span>
                  </div>
                )}
                {(data[0].areaHa || data[0].area_ha) && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Área</span>
                    <span className="font-medium" data-testid="text-tah-area">{formatArea(data[0].areaHa || data[0].area_ha)}</span>
                  </div>
                )}
              </div>
            )}

            <p className="text-[10px] text-muted-foreground">
              Fonte: Dados Abertos ANM — Taxa Anual por Hectare
              {data[0] && (data[0].importadoEm || data[0].importado_em) && (
                <> · Importado em {new Date(data[0].importadoEm || data[0].importado_em).toLocaleDateString("pt-BR")}</>
              )}
            </p>
          </div>
        )}

        {data.length === 0 && !loading && !error && (
          <div className="text-center py-6">
            <Receipt className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Clique em Consultar para buscar dados da TAH</p>
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
      queryClient.invalidateQueries({ queryKey: ["/api/assets", assetId] });
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

  // Rebusca o cache e zera todo o estado sempre que o processo do ativo muda —
  // evita exibir dados do processo de outro ativo ao navegar sem remontagem.
  useEffect(() => {
    let cancelled = false;
    setCached(null);
    setSessionId(null);
    setCaptchaUrl(null);
    setCaptchaBlobUrl(null);
    setCaptchaInput("");
    setError(null);
    setEnrichSteps([]);

    if (!processoAnm) { setLoadingCache(false); return; }
    const parts = processoAnm.replace(/\./g, "").split("/");
    if (parts.length !== 2) { setLoadingCache(false); return; }

    setLoadingCache(true);
    (async () => {
      try {
        const res = await apiRequest("GET", `/api/scm/processo/${parts[0]}/${parts[1]}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (!cancelled) setCached(data);
        }
      } catch {}
      if (!cancelled) setLoadingCache(false);
    })();

    return () => { cancelled = true; };
  }, [processoAnm]);

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
        const mensagens: Record<string, string> = {
          captcha_invalido: "Captcha incorreto. Clique em 'Tentar novamente' para uma nova consulta.",
          sessao_expirada: "Sessão expirada. Clique em 'Tentar novamente' para uma nova consulta.",
          captcha_rapido: "Código digitado muito rápido. Clique em 'Tentar novamente' e aguarde alguns segundos antes de enviar.",
          captcha_curto: "Digite os 4 caracteres da imagem.",
          scm_indisponivel: data.message || "SCM temporariamente indisponível. Tente novamente em alguns minutos.",
          dados_nao_encontrados: data.message || "O SCM não retornou os dados deste processo. Nada foi salvo.",
          processo_nao_encontrado: data.message || "Processo não encontrado no SCM.",
          processo_divergente: data.message || "A resposta do SCM não corresponde a este processo. Nada foi salvo.",
          scm_erro: data.message || "O SCM retornou um erro na consulta.",
        };
        setError(mensagens[data.error] || data.message || "Erro desconhecido");
        // Cada envio consome o captcha/sessão no SCM — sempre exigir nova consulta
        setSessionId(null);
        setCaptchaUrl(null);
        setCaptchaBlobUrl(null);
        return;
      }

      setCached({ ...data.data, hasDocument: data.hasDocument, titular: { nome: data.data?.titularNome, cnpj: data.data?.titularCnpj, cpf: data.data?.titularCpf, tipoPessoa: data.data?.tipoPessoa, cadastroEmpresa: data.data?.cadastroEmpresa } });
      setSessionId(null);
      setCaptchaUrl(null);
      setCaptchaBlobUrl(null);

      // O servidor persistiu o titular (fonte SCM) no ativo — recarrega o ativo
      // e a resolução de titular para o dado derivado aparecer sem trocar de aba.
      queryClient.invalidateQueries({ queryKey: ["/api/assets", assetId] });
      queryClient.invalidateQueries({ queryKey: ["/api/anm/titular", processoAnm] });

      toast({ title: "Documento SCM consultado!", description: "Dados do processo disponíveis para referência e download." });
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

  const downloadDocumento = () => {
    if (!processoAnm) return;
    const parts = processoAnm.replace(/\./g, "").split("/");
    if (parts.length !== 2) return;
    window.open(`/api/scm/documento/${parts[0]}/${parts[1]}`, "_blank");
  };

  const hasCachedData = cached?.titularNome || cached?.titular?.nome || cached?.hasDocument || cached?.consultadoEm || cached?.processo || cached?.areaHa || cached?.fase;

  const captchaPanel = (
    <>
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
    </>
  );

  if (hasCachedData) {
    const nome = cached.titular?.nome || cached.titularNome;
    const cnpj = cached.titular?.cnpj || cached.titularCnpj;
    const cpf = cached.titular?.cpf || cached.titularCpf;
    const tipo = cached.titular?.tipoPessoa || cached.tipoPessoa;
    const formatCnpj = (c: string) => {
      if (!c || c.length !== 14) return c;
      return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
    };

    return (
      <div className="space-y-4">
        <Card className="border-blue-300 dark:border-blue-800">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600" />
                Documento SCM (Referência)
              </CardTitle>
              <Badge variant="outline" className="text-xs border-blue-500 text-blue-700 dark:text-blue-400" data-testid="badge-scm-consultado">
                Consultado via SCM
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <InfoItem label="Nome / Razão Social" value={nome} />
              {cnpj && <InfoItem label="CNPJ (SCM)" value={formatCnpj(cnpj)} />}
              {cpf && <InfoItem label="CPF (SCM)" value={cpf} />}
              {tipo && <InfoItem label="Tipo" value={tipo === "PF" ? "Pessoa Física" : "Pessoa Jurídica"} />}
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

            <p className="text-[10px] text-muted-foreground italic">
              Dados apenas para referência — para abrir empresa, use a aba Titular.
            </p>
          </CardContent>
        </Card>

        <div className="flex gap-2">
          {(cached.hasDocument || cached.rawHtml) && (
            <Button variant="default" size="sm" onClick={downloadDocumento} data-testid="button-scm-download">
              <Download className="w-3.5 h-3.5 mr-1" />
              Baixar Documento SCM
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={iniciarCaptcha} disabled={initiating} data-testid="button-scm-reconsultar">
            {initiating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
            Re-consultar SCM
          </Button>
        </div>

        {captchaPanel}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Search className="w-4 h-4" />
            Consulta SCM (Documento do Processo)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            O SCM (Sistema de Controle de Mineração) da ANM contém dados oficiais do processo.
            A consulta requer resolução de captcha pelo operador. Após consultar, o documento fica disponível para download.
          </p>

          {!sessionId && !captchaUrl && (
            <Button onClick={iniciarCaptcha} disabled={initiating} size="sm" data-testid="button-scm-iniciar">
              {initiating ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> Acessando SCM...</>
              ) : (
                <><Search className="w-3.5 h-3.5 mr-1" /> Consultar Documento SCM</>
              )}
            </Button>
          )}

          {captchaPanel}
        </CardContent>
      </Card>
    </div>
  );
}

function SeiSubTab({ processoAnm }: { processoAnm: string }) {
  const [cached, setCached] = useState<any>(null);
  const [loadingCache, setLoadingCache] = useState(true);
  const [nupInput, setNupInput] = useState("");
  const [nupTouched, setNupTouched] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [captchaUrl, setCaptchaUrl] = useState<string | null>(null);
  const [captchaBlobUrl, setCaptchaBlobUrl] = useState<string | null>(null);
  const [captchaInput, setCaptchaInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [initiating, setInitiating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidatosAmbiguos, setCandidatosAmbiguos] = useState<string[]>([]);
  const [nupConfirmadoAviso, setNupConfirmadoAviso] = useState<string | null>(null);
  const { toast } = useToast();

  const nupDigits = nupInput.replace(/\D/g, "");
  const nupValido = nupDigits.length >= 15 && nupDigits.length <= 21;
  // Aviso (não bloqueio) de DV que não confere — aparece ANTES de gastar um captcha
  const dvCheck = validateNupDv(nupDigits);
  const avisoDv = dvCheck && !dvCheck.valido
    ? `O dígito verificador deste NUP não confere (pelo padrão federal seria -${dvCheck.dvEsperado}). Pode haver erro de digitação — dá para consultar mesmo assim: a busca encontra o processo pelo sequencial/ano.`
    : null;

  // Rebusca o cache e zera todo o estado sempre que o processo do ativo muda —
  // evita exibir dados do processo de outro ativo ao navegar sem remontagem.
  useEffect(() => {
    let cancelled = false;
    setCached(null);
    setSessionId(null);
    setCaptchaUrl(null);
    setCaptchaBlobUrl(null);
    setCaptchaInput("");
    setError(null);
    setCandidatosAmbiguos([]);
    setNupConfirmadoAviso(null);
    setNupInput("");
    setNupTouched(false);
    setLoadingCache(true);

    (async () => {
      let nupConhecido: string | null = null;

      // NUP pré-preenchido a partir da consulta SCM anterior, quando houver
      if (processoAnm) {
        const parts = processoAnm.replace(/\./g, "").split("/");
        if (parts.length === 2) {
          try {
            const res = await apiRequest("GET", `/api/scm/processo/${parts[0]}/${parts[1]}`);
            if (res.ok) {
              const scm = await res.json();
              if (scm?.nup) nupConhecido = String(scm.nup);
            }
          } catch {}
        }
      }
      if (cancelled) return;
      if (nupConhecido) setNupInput(nupConhecido);

      // Cache SEI compartilhado: por NUP (se conhecido) e/ou pelo processo ANM
      if (nupConhecido || processoAnm) {
        try {
          const params = new URLSearchParams();
          if (nupConhecido) params.set("nup", nupConhecido);
          if (processoAnm) params.set("processo", processoAnm);
          const res = await apiRequest("GET", `/api/sei/consulta?${params.toString()}`);
          if (!cancelled && res.ok) {
            const data = await res.json();
            if (!cancelled && data) {
              setCached(data);
              if (data.nupFormatado && !nupConhecido) setNupInput(String(data.nupFormatado));
            }
          }
        } catch {}
      }
      if (!cancelled) setLoadingCache(false);
    })();

    return () => { cancelled = true; };
  }, [processoAnm]);

  const iniciarCaptcha = async () => {
    if (!nupValido) {
      setError("Informe o NUP completo (ex.: 48054.832070/2024-14).");
      return;
    }
    setInitiating(true);
    setError(null);
    setCandidatosAmbiguos([]);
    try {
      const res = await apiRequest("POST", "/api/sei/captcha/iniciar", {
        nup: nupInput.trim(),
        ...(processoAnm ? { processo: processoAnm } : {}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Erro ao acessar o SEI");
      }
      const data = await res.json();
      setSessionId(data.sessionId);
      setCaptchaUrl(data.captchaImageUrl);
      setCaptchaInput("");
      if (data.nup) setNupInput(String(data.nup));

      try {
        const imgRes = await apiRequest("GET", data.captchaImageUrl);
        if (imgRes.ok) {
          const blob = await imgRes.blob();
          setCaptchaBlobUrl(URL.createObjectURL(blob));
        }
      } catch {}
    } catch (err: any) {
      setError(err.message || "Erro ao acessar o SEI");
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
      const res = await apiRequest("POST", "/api/sei/captcha/resolver", {
        sessionId,
        captcha: captchaInput,
      });
      const data = await res.json();

      if (!data.success) {
        const mensagens: Record<string, string> = {
          captcha_invalido: "Código de confirmação incorreto. Clique em 'Tentar novamente' para gerar nova imagem.",
          sessao_expirada: "Sessão expirada. Clique em 'Tentar novamente' para uma nova consulta.",
          captcha_curto: "Digite o código completo da imagem (4 a 6 caracteres).",
          sei_timeout: data.message || "O SEI da ANM não respondeu. Tente novamente em alguns minutos.",
          sei_indisponivel: data.message || "SEI temporariamente indisponível. Tente novamente em alguns minutos.",
          sei_estrutura_mudou: data.message || "O SEI devolveu uma resposta inesperada.",
          sei_sem_resultados: data.message || "O processo não aparece na pesquisa pública do SEI — pode não ter sido digitalizado ou estar com acesso restrito. Nada foi salvo.",
          sei_resultado_ambiguo: data.message || "Mais de um processo no SEI tem o mesmo sequencial/ano. Repita a consulta informando o NUP exato. Nada foi salvo.",
          sei_resultado_incompativel: data.message || "O SEI devolveu resultados, mas nenhum corresponde ao NUP — a estrutura pode ter mudado; a resposta foi registrada para diagnóstico. Nada foi salvo.",
          dados_nao_encontrados: data.message || "O SEI não retornou documentos nem andamentos. Nada foi salvo.",
        };
        setError(mensagens[data.error] || data.message || "Erro desconhecido");
        setCandidatosAmbiguos(
          data.error === "sei_resultado_ambiguo" && Array.isArray(data.candidatos) ? data.candidatos : []
        );
        // Cada envio consome o captcha/sessão no SEI — sempre exigir nova consulta
        setSessionId(null);
        setCaptchaUrl(null);
        setCaptchaBlobUrl(null);
        return;
      }

      setCached(data.data);
      setCandidatosAmbiguos([]);
      // NUP confirmado pelo SEI pode divergir do informado (prefixo/DV de
      // unidade antiga) — mostrar a divergência e adotar o NUP confirmado.
      if (data.data?.nupDivergente && data.data?.nupInformado && data.data?.nupFormatado) {
        setNupConfirmadoAviso(
          `O SEI confirmou este processo pelo NUP ${data.data.nupFormatado} — diferente do informado (${data.data.nupInformado}). O resultado foi salvo pelo NUP confirmado.`
        );
      } else {
        setNupConfirmadoAviso(null);
      }
      if (data.data?.nupFormatado) setNupInput(String(data.data.nupFormatado));
      setSessionId(null);
      setCaptchaUrl(null);
      setCaptchaBlobUrl(null);
      toast({ title: "Consulta SEI concluída!", description: "Documentos e andamentos do processo ficam salvos para todos os usuários." });
    } catch (err: any) {
      setError("Erro ao processar. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingCache) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm text-muted-foreground">Verificando dados SEI...</span>
        </CardContent>
      </Card>
    );
  }

  const documentos: any[] = Array.isArray(cached?.documentos) ? cached.documentos : [];
  const andamentos: any[] = Array.isArray(cached?.andamentos) ? cached.andamentos : [];
  const interessados: any[] = Array.isArray(cached?.interessados) ? cached.interessados : [];
  const hasCachedData = documentos.length > 0 || andamentos.length > 0;

  const nupField = (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex-1 min-w-[220px]">
        <p className="text-[10px] text-muted-foreground mb-1">NUP (Número Único de Protocolo)</p>
        <input
          type="text"
          value={nupInput}
          onChange={e => { setNupInput(e.target.value); setNupTouched(true); }}
          placeholder="48054.832070/2024-14"
          className="w-full h-9 text-sm font-mono border rounded px-2 bg-background"
          data-testid="input-sei-nup"
        />
        {avisoDv && (
          <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1 flex items-start gap-1" data-testid="text-sei-aviso-dv">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
            <span>{avisoDv}</span>
          </p>
        )}
      </div>
      <Button
        onClick={iniciarCaptcha}
        disabled={initiating || !nupValido || !!sessionId}
        size="sm"
        className="mt-4"
        data-testid={hasCachedData ? "button-sei-reconsultar" : "button-sei-iniciar"}
      >
        {initiating ? (
          <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> Acessando SEI...</>
        ) : hasCachedData ? (
          <><RefreshCw className="w-3.5 h-3.5 mr-1" /> Re-consultar SEI</>
        ) : (
          <><Search className="w-3.5 h-3.5 mr-1" /> Consultar SEI</>
        )}
      </Button>
    </div>
  );

  const captchaPanel = (
    <>
      {captchaUrl && sessionId && (
        <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
          <p className="text-xs font-medium">Digite o código de confirmação da imagem abaixo:</p>
          <div className="flex items-center gap-3">
            <div className="border rounded overflow-hidden bg-white">
              <img
                src={captchaBlobUrl || captchaUrl || ""}
                alt="Captcha SEI"
                className="h-10"
                data-testid="img-sei-captcha"
              />
            </div>
            <input
              type="text"
              maxLength={6}
              value={captchaInput}
              onChange={e => setCaptchaInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && captchaInput.length >= 4) resolverCaptcha(); }}
              placeholder="Código"
              className="w-28 h-10 text-center text-lg font-mono border rounded px-2 bg-background"
              autoFocus
              data-testid="input-sei-captcha"
            />
            <Button
              onClick={resolverCaptcha}
              disabled={submitting || captchaInput.length < 4}
              size="sm"
              data-testid="button-sei-resolver"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Enviar"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">Sessão expira em 5 minutos</p>
        </div>
      )}

      {error && (
        <div className="p-2 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <p className="text-xs text-red-700 dark:text-red-400">{error}</p>
            <Button variant="ghost" size="sm" className="ml-auto text-xs h-6" onClick={iniciarCaptcha} data-testid="button-sei-tentar-novamente">
              Tentar novamente
            </Button>
          </div>
          {candidatosAmbiguos.length > 0 && (
            <div className="pl-6 space-y-1">
              <p className="text-[10px] text-muted-foreground">
                Clique em um dos NUPs abaixo para preenchê-lo e inicie nova consulta (novo captcha):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {candidatosAmbiguos.map((c, i) => (
                  <Button
                    key={c}
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs font-mono"
                    onClick={() => { setNupInput(c); setNupTouched(true); }}
                    data-testid={`button-sei-candidato-${i}`}
                  >
                    {c}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );

  if (hasCachedData) {
    return (
      <div className="space-y-4">
        <Card className="border-teal-300 dark:border-teal-800">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <ScrollText className="w-4 h-4 text-teal-600" />
                Processo no SEI (ANM)
              </CardTitle>
              <Badge variant="outline" className="text-xs border-teal-500 text-teal-700 dark:text-teal-400" data-testid="badge-sei-consultado">
                Consultado no SEI
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {nupConfirmadoAviso && (
              <div className="flex items-start gap-2 p-2 rounded bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800" data-testid="text-sei-nup-confirmado">
                <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0 mt-px" />
                <p className="text-xs text-teal-800 dark:text-teal-300">{nupConfirmadoAviso}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <InfoItem label="NUP" value={cached.nupFormatado} />
              <InfoItem label="Tipo" value={cached.tipoProcedimento} />
              <InfoItem label="Data de Geração" value={cached.dataGeracao} />
              <InfoItem label="Interessados" value={interessados.length ? interessados.join("; ") : null} />
            </div>

            {documentos.length > 0 && (
              <div className="border-t pt-3">
                <p className="text-xs font-medium mb-2">Documentos ({documentos.length})</p>
                <div className="max-h-64 overflow-y-auto border rounded">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted">
                      <tr className="text-left">
                        <th className="p-1.5 font-medium">Documento</th>
                        <th className="p-1.5 font-medium">Tipo</th>
                        <th className="p-1.5 font-medium">Data</th>
                        <th className="p-1.5 font-medium">Unidade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documentos.map((d: any, i: number) => (
                        <tr key={i} className="border-t" data-testid={`row-sei-documento-${i}`}>
                          <td className="p-1.5 font-mono">
                            {d.linkPublico ? (
                              <a href={d.linkPublico} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1">
                                {d.numero}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              d.numero
                            )}
                          </td>
                          <td className="p-1.5">{d.tipo || "—"}</td>
                          <td className="p-1.5 whitespace-nowrap">{d.data || d.dataInclusao || "—"}</td>
                          <td className="p-1.5">{d.unidade || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {andamentos.length > 0 && (
              <div className="border-t pt-3">
                <p className="text-xs font-medium mb-2">Andamentos ({andamentos.length})</p>
                <div className="max-h-64 overflow-y-auto space-y-1.5">
                  {andamentos.map((a: any, i: number) => (
                    <div key={i} className="flex gap-2 text-xs p-1.5 rounded bg-muted/40" data-testid={`row-sei-andamento-${i}`}>
                      <span className="text-muted-foreground whitespace-nowrap shrink-0">{a.dataHoraTexto || "—"}</span>
                      {a.unidade && (
                        <span className="font-medium shrink-0" title={a.unidadeNome || undefined}>{a.unidade}</span>
                      )}
                      <span className="text-muted-foreground">{a.descricao}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground italic">
              A maioria dos documentos é de acesso restrito no SEI — os links públicos, quando existirem, abrem no site da ANM.
            </p>

            {cached.consultadoEm && (
              <p className="text-[10px] text-muted-foreground pt-2 border-t" data-testid="text-sei-consultado-em">
                Última consulta: {new Date(cached.consultadoEm).toLocaleString("pt-BR")} — dado salvo para todos os usuários
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 space-y-3">
            {nupField}
            {captchaPanel}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ScrollText className="w-4 h-4" />
            Consulta SEI (Documentos e Andamentos)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            O SEI da ANM guarda a lista de documentos e os andamentos do processo administrativo, indexados pelo NUP.
            A consulta requer digitar um código de confirmação (captcha); o resultado fica salvo para todos os usuários.
            {!nupInput && " O NUP é preenchido automaticamente quando o processo já foi consultado via SCM."}
          </p>

          {nupField}
          {captchaPanel}
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

const QD_CATEGORIA_LABELS: Record<string, string> = {
  licenca: "Licença",
  embargo: "Embargo",
  multa: "Multa/Penalidade",
  decreto: "Decreto",
};
