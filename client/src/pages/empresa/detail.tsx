import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Building2, MapPin, Briefcase, Phone, Mail, Users, Loader2, UserPlus,
  ExternalLink, FileText, Globe, Calendar, ArrowLeft, Hash, AlertCircle,
  Network, Download, Eye, Sparkles, Search, Code, Tag, Share2, CheckCircle2,
  Clock, Plus, Trash2, Save, BookOpen, TriangleAlert, Target, Layers,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Link } from "wouter";

import RelationshipGraph from "./relationships-graph";
import EnrichmentPanel from "./enrichment-panel";
import ContactVerification from "./contact-verification";
import type { CompanyWithLead, Socio, SocioCompany, RelationshipData } from "./relationships-graph";

const LEAD_STATUS_LABELS: Record<string, string> = {
  new: "Novo", queued: "Na fila", in_progress: "Em progresso",
  contacted: "Contactado", qualified: "Qualificado", disqualified: "Descartado",
};

const LEAD_STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  queued: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  in_progress: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  contacted: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  qualified: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  disqualified: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

export default function EmpresaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [creatingLead, setCreatingLead] = useState(false);
  const [confirmExpand, setConfirmExpand] = useState(false);
  const [expandLoading, setExpandLoading] = useState(false);
  const [expandedCompanies, setExpandedCompanies] = useState<Record<string, SocioCompany[]>>({});
  const [clickedExtCompany, setClickedExtCompany] = useState<SocioCompany | null>(null);
  const [importingExt, setImportingExt] = useState(false);
  const [enrichmentResult, setEnrichmentResult] = useState<any>(null);
  const [enrichProgress, setEnrichProgress] = useState(0);
  const [enrichStep, setEnrichStep] = useState("");
  const enrichTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [researchNotes, setResearchNotes] = useState<{ id: string; fieldName: string; content: string }[]>([]);
  const [savingNotes, setSavingNotes] = useState(false);
  const [confirmDeleteNoteId, setConfirmDeleteNoteId] = useState<string | null>(null);
  const [verifiedContacts, setVerifiedContacts] = useState<{
    phone?: string; email?: string; whatsapp?: string;
    contactName?: string; contactRole?: string; notes?: string;
    verifiedAt?: string; verifiedBy?: string;
  }>({});
  const [savingVerified, setSavingVerified] = useState(false);
  const [perfilComprador, setPerfilComprador] = useState<{
    buyerType: string;
    cnaeInteresse: string;
    regioesInteresse: string;
    prazoDecisao: string;
    capacidadeAquisicao: string;
    dealsAnteriores: boolean;
    observacoes: string;
  }>({
    buyerType: "nao_definido",
    cnaeInteresse: "",
    regioesInteresse: "",
    prazoDecisao: "",
    capacidadeAquisicao: "",
    dealsAnteriores: false,
    observacoes: "",
  });
  const [savingPerfil, setSavingPerfil] = useState(false);
  const [cnpjaLoading, setCnpjaLoading] = useState(false);
  const [sicorData, setSicorData] = useState<any>(null);
  const [sicorLoading, setSicorLoading] = useState(false);

  const { data, isLoading, error } = useQuery<RelationshipData>({
    queryKey: [`/api/companies/${id}/relationships`],
    enabled: !!id,
  });

  const company = data?.company;
  const socios = data?.socios || [];

  const { data: todosAtivos = [] } = useQuery<any[]>({
    queryKey: ["/api/matching/assets"],
    queryFn: () => apiRequest("GET", "/api/matching/assets").then(r => r.json()),
  });

  const ativosVinculados = (todosAtivos as any[]).filter(
    (a: any) => a.linkedCompanyId === Number(id)
  );

  const companyDeals: any[] = (data as any)?.deals || [];

  const sociosWithTaxId = socios.filter(s => s.taxId);
  const creditCost = sociosWithTaxId.length;
  const alreadyExpanded = Object.keys(expandedCompanies).length > 0;

  const createLeadMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${id}/lead`),
    onSuccess: () => {
      toast({ title: "Lead criado com sucesso!" });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${id}/relationships`] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies/with-leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/queue"] });
    },
    onError: (err: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${id}/relationships`] });
      toast({ title: err?.message === "409" ? "Esta empresa já possui um lead" : "Erro ao criar lead", variant: "destructive" });
    },
    onSettled: () => setCreatingLead(false),
  });

  const enrichMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${id}/enrich`),
    onSuccess: (data: any) => {
      setEnrichmentResult(data.enrichment);
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${id}/relationships`] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies/with-leads"] });
      toast({ title: "Enriquecimento concluído!", description: "Dados coletados via busca web e scraping do site." });
    },
    onError: (err: any) => {
      toast({ title: "Erro no enriquecimento", description: err?.message || "Tente novamente.", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (data?.company) {
      const notes = (data.company as any).researchNotes;
      if (Array.isArray(notes) && notes.length > 0) {
        setResearchNotes(notes);
      }
      const vc = (data.company as any).verifiedContacts;
      if (vc && typeof vc === "object" && Object.keys(vc).length > 0) {
        setVerifiedContacts(vc);
      } else {
        setVerifiedContacts({});
      }
      const perfil = (data.company as any).enrichmentData?.perfilComprador;
      if (perfil && typeof perfil === "object") {
        setPerfilComprador(prev => ({ ...prev, ...perfil }));
      }
    }
  }, [data]);

  const saveNotesMutation = useMutation({
    mutationFn: (notes: { id: string; fieldName: string; content: string }[]) =>
      apiRequest("PATCH", `/api/companies/${id}/research-notes`, { notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${id}/relationships`] });
      toast({ title: "Notas salvas!" });
    },
    onError: () => toast({ title: "Erro ao salvar notas", variant: "destructive" }),
    onSettled: () => setSavingNotes(false),
  });

  const saveVerifiedMutation = useMutation({
    mutationFn: (vc: typeof verifiedContacts) =>
      apiRequest("PATCH", `/api/companies/${id}/verified-contacts`, vc),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${id}/relationships`] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/queue"] });
      toast({ title: "Dados verificados salvos!" });
    },
    onError: () => toast({ title: "Erro ao salvar contatos verificados", variant: "destructive" }),
    onSettled: () => setSavingVerified(false),
  });

  const savePerfilMutation = useMutation({
    mutationFn: (perfil: typeof perfilComprador) =>
      apiRequest("PATCH", `/api/companies/${id}`, {
        enrichmentData: {
          ...((company as any)?.enrichmentData || {}),
          perfilComprador: perfil,
          buyerType: perfil.buyerType,
          cnaeInteresse: perfil.cnaeInteresse
            ? perfil.cnaeInteresse.split(",").map((s: string) => s.trim()).filter(Boolean)
            : [],
          regioesInteresse: perfil.regioesInteresse
            ? perfil.regioesInteresse.split(",").map((s: string) => s.trim()).filter(Boolean)
            : [],
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${id}/relationships`] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies/with-leads"] });
      toast({ title: "Perfil de comprador salvo!", description: "Esta empresa agora aparece no matching reverso." });
    },
    onError: () => toast({ title: "Erro ao salvar perfil", variant: "destructive" }),
    onSettled: () => setSavingPerfil(false),
  });

  const handleSaveVerified = () => {
    setSavingVerified(true);
    saveVerifiedMutation.mutate(verifiedContacts);
  };

  const hasVerifiedData = !!(verifiedContacts.phone || verifiedContacts.email || verifiedContacts.whatsapp || verifiedContacts.contactName);

  const addNote = () => {
    const newNote = { id: Date.now().toString(), fieldName: "", content: "" };
    setResearchNotes(prev => [...prev, newNote]);
  };

  const updateNote = (noteId: string, field: "fieldName" | "content", value: string) => {
    setResearchNotes(prev => prev.map(n => n.id === noteId ? { ...n, [field]: value } : n));
  };

  const removeNote = (noteId: string) => {
    setResearchNotes(prev => prev.filter(n => n.id !== noteId));
    setConfirmDeleteNoteId(null);
  };

  const handleSaveNotes = () => {
    setSavingNotes(true);
    saveNotesMutation.mutate(researchNotes);
  };

  useEffect(() => {
    if (enrichMutation.isPending) {
      setEnrichProgress(0);
      const steps = [
        { pct: 8,  label: "Iniciando busca..." },
        { pct: 20, label: "Pesquisando no DuckDuckGo..." },
        { pct: 38, label: "Analisando resultados..." },
        { pct: 52, label: "Identificando site oficial..." },
        { pct: 65, label: "Acessando site da empresa..." },
        { pct: 78, label: "Extraindo contatos e redes sociais..." },
        { pct: 88, label: "Analisando SEO e tecnologias..." },
        { pct: 94, label: "Consolidando dados..." },
      ];
      let i = 0;
      enrichTimerRef.current = setInterval(() => {
        if (i < steps.length) {
          setEnrichProgress(steps[i].pct);
          setEnrichStep(steps[i].label);
          i++;
        }
      }, 8000);
    } else {
      if (enrichTimerRef.current) clearInterval(enrichTimerRef.current);
      if (enrichMutation.isSuccess) {
        setEnrichProgress(100);
        setEnrichStep("Concluído!");
      } else {
        setEnrichProgress(0);
        setEnrichStep("");
      }
    }
    return () => { if (enrichTimerRef.current) clearInterval(enrichTimerRef.current); };
  }, [enrichMutation.isPending, enrichMutation.isError, enrichMutation.isSuccess]);

  const expandNetwork = async () => {
    if (sociosWithTaxId.length === 0) {
      toast({
        title: "Sem CPFs para expandir",
        description: "Nenhum sócio com CPF disponível. A cnpja.com pode não ter retornado os dados de CPF para esta empresa.",
      });
      return;
    }
    setExpandLoading(true);
    const result: Record<string, SocioCompany[]> = {};
    for (const s of sociosWithTaxId) {
      try {
        const res = await fetch(`/api/socios/${s.taxId}/companies`);
        if (res.ok) {
          const data = await res.json();
          result[s.taxId!] = data.companies || [];
        } else {
          result[s.taxId!] = [];
        }
      } catch {
        result[s.taxId!] = [];
      }
    }
    setExpandedCompanies(result);
    setExpandLoading(false);
    const total = Object.values(result).reduce((a, b) => a + b.length, 0);
    if (total === 0) {
      toast({
        title: "Nenhuma empresa adicional encontrada",
        description: "Os sócios não aparecem em outras empresas no cadastro da Receita Federal, ou os CPFs não foram retornados pela API cnpja.com.",
      });
    } else {
      toast({
        title: "Rede expandida",
        description: `${total} empresa${total !== 1 ? "s" : ""} encontrada${total !== 1 ? "s" : ""} no quadro societário dos sócios.`,
      });
    }
  };

  const importExtCompany = async () => {
    if (!clickedExtCompany) return;
    setImportingExt(true);
    try {
      await apiRequest("POST", `/api/cnpj/${clickedExtCompany.taxId}/import`);
      toast({ title: `${clickedExtCompany.legalName} importada com sucesso!` });
      queryClient.invalidateQueries({ queryKey: ["/api/companies/with-leads"] });
      setClickedExtCompany(null);
    } catch (e: any) {
      if (e?.message?.includes("já possui") || e?.status === 409) {
        toast({ title: "Empresa já importada anteriormente." });
      } else {
        toast({ title: "Erro ao importar empresa", variant: "destructive" });
      }
    } finally {
      setImportingExt(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !company) {
    return (
      <div className="p-4 md:p-8 max-w-2xl mx-auto text-center space-y-4 pt-16 md:pt-20">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto" />
        <p className="text-lg font-medium">Empresa não encontrada</p>
        <Button variant="outline" onClick={() => navigate("/empresas")} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Voltar para Empresas
        </Button>
      </div>
    );
  }

  const addr = [
    company.address?.street, company.address?.number, company.address?.district,
    company.address?.city, company.address?.state, company.address?.zip,
  ].filter(Boolean).join(", ");

  const isIndividual = company.notes?.toLowerCase().includes("individual") ||
    company.notes?.toLowerCase().includes("empresário");

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4 md:space-y-6">
      <div className="flex items-start gap-3 md:gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/empresas")} className="gap-1.5 mt-1 shrink-0"
          data-testid="button-voltar">
          <ArrowLeft className="w-4 h-4" /> Empresas
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{company.legalName}</h1>
              {company.tradeName && <p className="text-muted-foreground mt-0.5">{company.tradeName}</p>}
              {company.cnpj && <p className="text-sm font-mono text-muted-foreground mt-0.5" data-testid="text-cnpj">{company.cnpj}</p>}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {company.porte && <Badge variant="outline">{company.porte}</Badge>}
              {company.lead ? (
                <>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${LEAD_STATUS_COLORS[company.lead.status] || LEAD_STATUS_COLORS.new}`}>
                    Lead: {LEAD_STATUS_LABELS[company.lead.status] || company.lead.status}
                  </span>
                  <Link href="/sdr">
                    <Button size="sm" variant="outline" className="gap-1.5" data-testid="button-ver-sdr">
                      <ExternalLink className="w-3.5 h-3.5" /> Ver na SDR
                    </Button>
                  </Link>
                </>
              ) : (
                <Button size="sm" onClick={() => { setCreatingLead(true); createLeadMutation.mutate(); }}
                  disabled={creatingLead} className="gap-1.5" data-testid="button-criar-lead">
                  {creatingLead ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                  Criar Lead
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="detalhes">
        <div className="overflow-x-auto pb-0.5 -mx-0.5 px-0.5">
          <TabsList className="h-10 w-max min-w-full flex-nowrap">
            <TabsTrigger value="detalhes" data-testid="tab-detalhes">Detalhes</TabsTrigger>
            <TabsTrigger value="socios" data-testid="tab-socios">
              Sócios {socios.length > 0 ? `(${socios.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="grafico" data-testid="tab-grafico">Gráfico</TabsTrigger>
            <TabsTrigger value="enriquecimento" data-testid="tab-enriquecimento" className="gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Enriquecimento
            </TabsTrigger>
            <TabsTrigger value="pesquisa" data-testid="tab-pesquisa" className="gap-1.5">
              <BookOpen className="w-3.5 h-3.5" />
              Pesquisa {hasVerifiedData ? " \u2713" : ""} {researchNotes.length > 0 ? `(${researchNotes.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="ativos" data-testid="tab-ativos">
              Ativos {ativosVinculados.length > 0 ? `(${ativosVinculados.length})` : ""}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="detalhes" className="mt-4">
          <div className="space-y-4">

          {(company.cnaePrincipal || company.cnaeSecundarios?.length > 0) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-muted-foreground" /> Atividade Econômica (CNAE)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col md:flex-row gap-4">
                  {company.cnaePrincipal && (
                    <div className="md:w-72 shrink-0">
                      <p className="text-xs text-muted-foreground mb-1.5">Principal</p>
                      <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/15 h-full">
                        <Briefcase className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                        <p className="text-sm font-medium leading-snug">{company.cnaePrincipal}</p>
                      </div>
                    </div>
                  )}
                  {company.cnaeSecundarios?.length > 0 && (
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground mb-1.5">Secundários <span className="text-muted-foreground/60">({company.cnaeSecundarios.length})</span></p>
                      <div className="flex flex-wrap gap-1">
                        {company.cnaeSecundarios.map((c, i) => (
                          <Badge key={i} variant="outline" className="text-xs font-normal whitespace-normal h-auto text-left py-0.5 px-2">{c}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" /> Identificação
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <dl className="divide-y divide-border/60">
                  {company.cnpj && (
                    <div className="flex items-center justify-between py-2.5 gap-4">
                      <dt className="text-xs text-muted-foreground shrink-0">CNPJ</dt>
                      <dd className="font-mono font-semibold text-sm text-right">{company.cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")}</dd>
                    </div>
                  )}
                  {company.porte && (
                    <div className="flex items-center justify-between py-2.5 gap-4">
                      <dt className="text-xs text-muted-foreground shrink-0">Porte</dt>
                      <dd className="text-sm font-medium text-right">{company.porte}</dd>
                    </div>
                  )}
                  {company.notes && (
                    <div className="py-2.5">
                      <dt className="text-xs text-muted-foreground mb-1">Situação / Natureza</dt>
                      <dd className="text-xs text-muted-foreground leading-relaxed">{company.notes}</dd>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 py-2.5 text-xs text-muted-foreground">
                    <Calendar className="w-3.5 h-3.5 shrink-0" />
                    Importada em {new Date(company.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Phone className="w-4 h-4 text-muted-foreground" /> Contato
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {company.phones.length === 0 && company.emails.length === 0 && !company.website ? (
                  <p className="text-muted-foreground text-sm py-2">Sem dados de contato cadastrados.</p>
                ) : (
                  <dl className="divide-y divide-border/60">
                    {company.phones.map((p, i) => (
                      <div key={i} className="flex items-center gap-3 py-2.5">
                        <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <a href={`tel:${p.replace(/\D/g, "")}`} className="text-sm hover:text-primary transition-colors" data-testid={`text-phone-${i}`}>{p}</a>
                      </div>
                    ))}
                    {company.emails.map((e, i) => (
                      <div key={i} className="flex items-center gap-3 py-2.5">
                        <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <a href={`mailto:${e}`} className="text-sm text-primary hover:underline underline-offset-2 break-all" data-testid={`text-email-${i}`}>{e}</a>
                      </div>
                    ))}
                    {company.website && (
                      <div className="flex items-start gap-3 py-2.5">
                        <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                        <a href={company.website} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline underline-offset-2 break-all">{company.website}</a>
                      </div>
                    )}
                  </dl>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-muted-foreground" /> Endereço
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {addr ? (
                  <div className="py-1 space-y-1">
                    <p className="text-sm leading-relaxed" data-testid="text-address">{addr}</p>
                    {company.address?.country?.name && (
                      <p className="text-xs text-muted-foreground">{company.address.country.name}</p>
                    )}
                    {company.address?.zip && (
                      <p className="text-xs text-muted-foreground font-mono">CEP {company.address.zip}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm py-2">Sem endereço cadastrado.</p>
                )}
              </CardContent>
            </Card>

            {company.lead && (
              <Card className="border-primary/20 bg-primary/[0.02]">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Hash className="w-4 h-4 text-primary" /> Lead Vinculado
                    </CardTitle>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${LEAD_STATUS_COLORS[company.lead.status] || LEAD_STATUS_COLORS.new}`}>
                      {LEAD_STATUS_LABELS[company.lead.status] || company.lead.status}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <dl className="divide-y divide-border/60">
                    <div className="flex items-center justify-between py-2.5">
                      <dt className="text-xs text-muted-foreground">Score de qualificação</dt>
                      <dd className="flex items-center gap-2">
                        <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${company.lead.score || 0}%` }} />
                        </div>
                        <span className="text-sm font-bold">{company.lead.score ?? 0}</span>
                      </dd>
                    </div>
                    {company.lead.source && (
                      <div className="flex items-center justify-between py-2.5">
                        <dt className="text-xs text-muted-foreground">Fonte</dt>
                        <dd className="text-sm">{company.lead.source}</dd>
                      </div>
                    )}
                    <div className="flex items-center justify-between py-2.5">
                      <dt className="text-xs text-muted-foreground">ID do Lead</dt>
                      <dd className="font-mono text-xs text-muted-foreground">#{company.lead.id}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            )}

            {/* ── PERFIL DE COMPRADOR ESTRATÉGICO ── */}
            <Card className={perfilComprador.buyerType === "estrategico" || perfilComprador.buyerType === "financeiro"
              ? "border-primary/30 dark:border-primary/40"
              : ""}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="w-4 h-4 text-muted-foreground" />
                  Perfil de Comprador / Investidor
                  {(perfilComprador.buyerType === "estrategico" || perfilComprador.buyerType === "financeiro") && (
                    <Badge variant="outline" className={
                      perfilComprador.buyerType === "estrategico"
                        ? "text-xs bg-blue-50 text-blue-700 border-blue-200 ml-auto"
                        : "text-xs bg-green-50 text-green-700 border-green-200 ml-auto"
                    } data-testid="badge-buyer-type">
                      {perfilComprador.buyerType === "estrategico" ? "Comprador estratégico" : "Investidor financeiro"}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Marque esta empresa como compradora para que ela apareça automaticamente
                  no matching reverso de ativos compatíveis.
                </p>

                <div className="space-y-1.5">
                  <Label className="text-xs">Tipo de comprador</Label>
                  <Select
                    value={perfilComprador.buyerType}
                    onValueChange={v => setPerfilComprador(p => ({ ...p, buyerType: v }))}
                  >
                    <SelectTrigger className="h-8 text-sm" data-testid="select-buyer-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nao_definido">Não definido</SelectItem>
                      <SelectItem value="financeiro">Investidor financeiro (fundo, family office, banco)</SelectItem>
                      <SelectItem value="estrategico">Comprador estratégico (empresa operacional)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {(perfilComprador.buyerType === "estrategico" || perfilComprador.buyerType === "financeiro") && (
                  <div className="space-y-4 pt-1">
                    <div className="grid sm:grid-cols-2 gap-4">
                      {perfilComprador.buyerType === "estrategico" && (
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label className="text-xs">CNAEs de interesse (separar por vírgula)</Label>
                          <Input
                            className="h-8 text-sm"
                            placeholder="ex: 0710-1, 0890-0, 0111-3"
                            value={perfilComprador.cnaeInteresse}
                            onChange={e => setPerfilComprador(p => ({ ...p, cnaeInteresse: e.target.value }))}
                            data-testid="input-cnae-interesse"
                          />
                          <p className="text-[10px] text-muted-foreground">
                            Use os códigos CNAE dos setores que esta empresa quer adquirir.
                            Ex: 0710 = mineração de ferro, 0111 = cultivo de soja.
                          </p>
                        </div>
                      )}

                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-xs">Regiões / Estados de interesse (separar por vírgula)</Label>
                        <Input
                          className="h-8 text-sm"
                          placeholder="ex: MT, PA, GO ou deixe vazio para qualquer região"
                          value={perfilComprador.regioesInteresse}
                          onChange={e => setPerfilComprador(p => ({ ...p, regioesInteresse: e.target.value }))}
                          data-testid="input-regioes-interesse"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">Prazo de decisão</Label>
                        <Select
                          value={perfilComprador.prazoDecisao || ""}
                          onValueChange={v => setPerfilComprador(p => ({ ...p, prazoDecisao: v }))}
                        >
                          <SelectTrigger className="h-8 text-sm" data-testid="select-prazo-decisao">
                            <SelectValue placeholder="Selecionar..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="imediato">Imediato (até 30 dias)</SelectItem>
                            <SelectItem value="3_meses">Até 3 meses</SelectItem>
                            <SelectItem value="6_meses">Até 6 meses</SelectItem>
                            <SelectItem value="12_meses">Até 12 meses</SelectItem>
                            <SelectItem value="sem_pressa">Sem prazo definido</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">Capacidade de aquisição (R$)</Label>
                        <Input
                          className="h-8 text-sm"
                          type="number"
                          placeholder="ex: 50000000"
                          value={perfilComprador.capacidadeAquisicao}
                          onChange={e => setPerfilComprador(p => ({ ...p, capacidadeAquisicao: e.target.value }))}
                          data-testid="input-capacidade-aquisicao"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Switch
                        checked={perfilComprador.dealsAnteriores}
                        onCheckedChange={v => setPerfilComprador(p => ({ ...p, dealsAnteriores: v }))}
                        data-testid="switch-deals-anteriores"
                      />
                      <Label className="text-sm cursor-pointer">
                        Já realizou aquisições anteriores neste setor
                      </Label>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Observações sobre o interesse</Label>
                      <Textarea
                        className="text-sm min-h-[60px]"
                        placeholder="ex: Busca fazendas acima de 500ha em MT, prefere CAR regularizado..."
                        value={perfilComprador.observacoes}
                        onChange={e => setPerfilComprador(p => ({ ...p, observacoes: e.target.value }))}
                        data-testid="textarea-observacoes-comprador"
                      />
                    </div>
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={savingPerfil || savePerfilMutation.isPending}
                    onClick={() => {
                      setSavingPerfil(true);
                      savePerfilMutation.mutate(perfilComprador);
                    }}
                    data-testid="button-salvar-perfil"
                  >
                    {(savingPerfil || savePerfilMutation.isPending)
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Salvando...</>
                      : <><Save className="w-3.5 h-3.5" /> Salvar perfil</>
                    }
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
          </div>
        </TabsContent>

        <TabsContent value="socios" className="mt-4">
          {socios.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center space-y-3">
                <Users className="w-10 h-10 mx-auto text-muted-foreground/30" />
                <p className="font-medium text-muted-foreground">Sem sócios registrados</p>
                {isIndividual ? (
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    Esta empresa é um <strong>Empresário Individual</strong> ou <strong>MEI</strong>. O proprietário é a própria pessoa física, sem quadro societário formal.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhum sócio encontrado para esta empresa na Receita Federal.</p>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {socios.map((s, i) => (
                <Card key={i} data-testid={`card-socio-${i}`}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-semibold">{s.name}</p>
                        {s.role && <p className="text-sm text-muted-foreground">{s.role}</p>}
                        <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
                          {s.since && <span>Desde: {s.since}</span>}
                          {s.taxId && <span className="font-mono">CPF/ID: {s.taxId}</span>}
                        </div>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-xs">Sócio</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
              <p className="text-xs text-muted-foreground text-center pt-1">
                Dados da Receita Federal via cnpja.com (cache 30 dias)
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="grafico" className="mt-4 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-base font-semibold">Gráfico de Relacionamentos</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Empresa ao centro → sócios → outras empresas dos sócios (anel externo, clicável).
              </p>
            </div>
            {socios.length > 0 && (
              <div className="flex items-center gap-2">
                {alreadyExpanded && (
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                    Rede expandida
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant={alreadyExpanded ? "outline" : "default"}
                  onClick={() => setConfirmExpand(true)}
                  disabled={expandLoading || creditCost === 0}
                  className="gap-1.5"
                  data-testid="button-expandir-rede"
                >
                  {expandLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Network className="w-3.5 h-3.5" />
                  )}
                  {alreadyExpanded ? "Atualizar rede" : "Expandir rede"}
                  {creditCost > 0 && !expandLoading && (
                    <span className="ml-0.5 text-xs opacity-70">({creditCost} crédito{creditCost !== 1 ? "s" : ""})</span>
                  )}
                </Button>
              </div>
            )}
          </div>

          <RelationshipGraph
            company={company}
            socios={socios}
            expandedCompanies={expandedCompanies}
            onCompanyClick={setClickedExtCompany}
          />

          {alreadyExpanded && (
            <p className="text-xs text-center text-muted-foreground">
              Nós amarelos = outras empresas dos sócios · Clique para importar como lead · Cache cnpja.com 30 dias
            </p>
          )}
        </TabsContent>

        <TabsContent value="enriquecimento" className="mt-4 space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Building2 className="w-4 h-4" /> Consulta CNPJA
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                {company?.enrichedAt ? (
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400" data-testid="badge-enriched-at">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Enriquecido em {new Date(company.enrichedAt).toLocaleDateString("pt-BR")}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400" data-testid="badge-never-enriched">
                    <AlertCircle className="w-3 h-3 mr-1" />
                    Nunca enriquecido
                  </Badge>
                )}
              </div>
              {company?.cnpj && (
                <Button size="sm" variant="outline" className="gap-1.5"
                  disabled={cnpjaLoading}
                  data-testid="button-atualizar-cnpja"
                  onClick={async () => {
                    setCnpjaLoading(true);
                    try {
                      const cnpjClean = company.cnpj!.replace(/\D/g, "");
                      const res = await apiRequest("GET", `/api/cnpj/${cnpjClean}`);
                      if (!res.ok) throw new Error("Falha ao consultar CNPJA");
                      const cnpjaData = await res.json();
                      const patchBody: any = {};
                      if (cnpjaData.razaoSocial || cnpjaData.company?.name) patchBody.legalName = cnpjaData.razaoSocial || cnpjaData.company?.name;
                      if (cnpjaData.nomeFantasia || cnpjaData.alias) patchBody.tradeName = cnpjaData.nomeFantasia || cnpjaData.alias;
                      if (cnpjaData.porte || cnpjaData.company?.size?.text) patchBody.porte = cnpjaData.porte || cnpjaData.company?.size?.text;
                      if (cnpjaData.telefones || cnpjaData.phones) patchBody.phones = cnpjaData.telefones || cnpjaData.phones;
                      if (cnpjaData.emails || cnpjaData.emails) patchBody.emails = cnpjaData.emails;
                      if (cnpjaData.endereco || cnpjaData.address) patchBody.address = cnpjaData.endereco || cnpjaData.address;
                      if (cnpjaData.cnaePrincipal || cnpjaData.mainActivity) patchBody.cnaePrincipal = cnpjaData.cnaePrincipal?.codigo || cnpjaData.mainActivity?.id || cnpjaData.cnaePrincipal;
                      patchBody.enrichedAt = new Date().toISOString();
                      await apiRequest("PATCH", `/api/crm/companies/${id}`, patchBody);
                      queryClient.invalidateQueries({ queryKey: [`/api/companies/${id}/relationships`] });
                      toast({ title: "Dados atualizados via CNPJA" });
                    } catch {
                      toast({ title: "Erro ao consultar CNPJA", variant: "destructive" });
                    }
                    setCnpjaLoading(false);
                  }}
                >
                  {cnpjaLoading
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Consultando...</>
                    : <><Download className="w-3.5 h-3.5" /> Atualizar dados via CNPJA</>}
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Briefcase className="w-4 h-4" /> Histórico de Negociações
              </CardTitle>
            </CardHeader>
            <CardContent>
              {companyDeals.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-sem-deals">Nenhuma negociação registrada</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="text-left py-2 px-2 font-medium">Título</th>
                        <th className="text-left py-2 px-2 font-medium">Pipeline</th>
                        <th className="text-left py-2 px-2 font-medium">Estágio</th>
                        <th className="text-right py-2 px-2 font-medium">Valor</th>
                        <th className="text-right py-2 px-2 font-medium">Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {companyDeals.map((d: any) => (
                        <tr key={d.id} className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                          onClick={() => navigate("/crm")} data-testid={`row-deal-${d.id}`}>
                          <td className="py-2 px-2 font-medium">{d.title || "\u2014"}</td>
                          <td className="py-2 px-2">{d.pipelineType || "\u2014"}</td>
                          <td className="py-2 px-2">{d.stageName || d.stageId || "\u2014"}</td>
                          <td className="py-2 px-2 text-right">
                            {d.value ? Number(d.value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "\u2014"}
                          </td>
                          <td className="py-2 px-2 text-right">
                            {d.createdAt ? new Date(d.createdAt).toLocaleDateString("pt-BR") : "\u2014"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {company?.cnaePrincipal && String(company.cnaePrincipal).startsWith("01") && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Crédito Rural (SICOR)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!sicorData ? (
                  <Button size="sm" variant="outline" className="gap-1.5"
                    disabled={sicorLoading}
                    data-testid="button-consultar-sicor-empresa"
                    onClick={async () => {
                      const addr = company?.address as any;
                      const codigoIbge = addr?.codigoIbge || addr?.ibge || "";
                      if (!codigoIbge) {
                        toast({ title: "Código IBGE não disponível no endereço da empresa", variant: "destructive" });
                        return;
                      }
                      setSicorLoading(true);
                      try {
                        const res = await apiRequest("GET", `/api/norion/sicor/${codigoIbge}`);
                        if (res.ok) setSicorData(await res.json());
                        else toast({ title: "Erro ao consultar SICOR", variant: "destructive" });
                      } catch {
                        toast({ title: "Erro ao consultar SICOR", variant: "destructive" });
                      }
                      setSicorLoading(false);
                    }}
                  >
                    {sicorLoading
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Consultando...</>
                      : <><Search className="w-3.5 h-3.5" /> Consultar crédito rural (SICOR)</>}
                  </Button>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {sicorData.totalContratos != null && (
                      <div className="p-3 rounded bg-muted/50 text-center">
                        <p className="text-xs text-muted-foreground">Contratos PRONAF</p>
                        <p className="text-lg font-bold" data-testid="text-sicor-contratos-empresa">
                          {Number(sicorData.totalContratos).toLocaleString("pt-BR")}
                        </p>
                      </div>
                    )}
                    {sicorData.volumeTotal != null && (
                      <div className="p-3 rounded bg-muted/50 text-center">
                        <p className="text-xs text-muted-foreground">Volume Financiado</p>
                        <p className="text-lg font-bold" data-testid="text-sicor-volume-empresa">
                          {Number(sicorData.volumeTotal).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </p>
                      </div>
                    )}
                    {sicorData.culturas?.length > 0 && (
                      <div className="p-3 rounded bg-muted/50 col-span-2">
                        <p className="text-xs text-muted-foreground mb-2">Principais culturas financiadas</p>
                        <div className="flex flex-wrap gap-1.5">
                          {sicorData.culturas.map((c: any, i: number) => (
                            <Badge key={i} variant="outline" className="text-xs capitalize" data-testid={`badge-sicor-cultura-empresa-${i}`}>
                              {typeof c === "string" ? c : c.nome || c.cultura}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <EnrichmentPanel
            company={company}
            enrichmentResult={enrichmentResult}
            enrichMutation={enrichMutation}
            enrichProgress={enrichProgress}
            enrichStep={enrichStep}
          />
        </TabsContent>

        <TabsContent value="pesquisa" className="mt-4">
          <ContactVerification
            verifiedContacts={verifiedContacts}
            setVerifiedContacts={setVerifiedContacts}
            hasVerifiedData={hasVerifiedData}
            savingVerified={savingVerified}
            handleSaveVerified={handleSaveVerified}
            saveVerifiedMutation={saveVerifiedMutation}
            researchNotes={researchNotes}
            addNote={addNote}
            updateNote={updateNote}
            handleSaveNotes={handleSaveNotes}
            savingNotes={savingNotes}
            saveNotesMutation={saveNotesMutation}
            confirmDeleteNoteId={confirmDeleteNoteId}
            setConfirmDeleteNoteId={setConfirmDeleteNoteId}
            removeNote={removeNote}
          />
        </TabsContent>

        <TabsContent value="ativos" className="mt-4 space-y-3">
          {ativosVinculados.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center space-y-2">
                <Layers className="w-10 h-10 mx-auto text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">Nenhum ativo vinculado a esta empresa.</p>
                <p className="text-xs text-muted-foreground">
                  Para vincular, edite um ativo no Portfólio e selecione esta empresa como proprietária.
                </p>
              </CardContent>
            </Card>
          ) : (
            ativosVinculados.map((ativo: any) => {
              const TIPO_BADGE: Record<string, string> = {
                TERRA: "bg-green-100 text-green-800",
                MINA: "bg-orange-100 text-orange-800",
                NEGOCIO: "bg-blue-100 text-blue-800",
                FII_CRI: "bg-purple-100 text-purple-800",
                DESENVOLVIMENTO: "bg-pink-100 text-pink-800",
                AGRO: "bg-yellow-100 text-yellow-800",
              };
              const TIPO_LABEL: Record<string, string> = {
                TERRA: "Terra / Fazenda", MINA: "Mineração", NEGOCIO: "Negócio M&A",
                FII_CRI: "FII / CRI", DESENVOLVIMENTO: "Desenvolvimento", AGRO: "Agronegócio",
              };
              return (
                <Card key={ativo.id} className="hover:border-primary/30 transition-colors cursor-pointer"
                  onClick={() => navigate(`/ativos/${ativo.id}`)} data-testid={`card-ativo-${ativo.id}`}>
                  <CardContent className="p-4 flex items-start justify-between gap-3">
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{ativo.title}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={`text-xs border-0 font-medium ${TIPO_BADGE[ativo.type] || ""}`}>
                          {TIPO_LABEL[ativo.type] || ativo.type}
                        </Badge>
                        {ativo.estado && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="w-3 h-3" />{ativo.estado}
                          </span>
                        )}
                        {ativo.areaHa && (
                          <span className="text-xs text-muted-foreground">
                            {Number(ativo.areaHa).toLocaleString("pt-BR")} ha
                          </span>
                        )}
                        {ativo.priceAsking && (
                          <span className="text-xs font-medium text-emerald-700">
                            R$ {(ativo.priceAsking / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M
                          </span>
                        )}
                        {ativo.emNegociacao && (
                          <Badge className="text-xs bg-blue-600 text-white">Em negociação</Badge>
                        )}
                      </div>
                    </div>
                    <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmExpand} onOpenChange={o => !o && setConfirmExpand(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Expandir rede de relacionamentos?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso irá consultar <strong>{creditCost} CPF{creditCost !== 1 ? "s" : ""}</strong> de sócios na cnpja.com para encontrar outras empresas onde participam.
              <br /><br />
              Custo estimado: <strong>até {creditCost} crédito{creditCost !== 1 ? "s" : ""}</strong> (gratuito se já consultados nos últimos 30 dias pelo cache da API).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmExpand(false); expandNetwork(); }}>
              Expandir rede
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!clickedExtCompany} onOpenChange={o => !o && setClickedExtCompany(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{clickedExtCompany?.legalName}</AlertDialogTitle>
            <AlertDialogDescription>
              {clickedExtCompany?.tradeName && <span className="block">{clickedExtCompany.tradeName}</span>}
              CNPJ: <strong className="font-mono">{clickedExtCompany?.taxId}</strong>
              {clickedExtCompany?.role && <span className="block mt-1">Papel: {clickedExtCompany.role}</span>}
              <br />
              O que deseja fazer com esta empresa?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel>Fechar</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                if (clickedExtCompany) {
                  window.open(`/empresas`, "_self");
                }
                setClickedExtCompany(null);
              }}
              className="gap-1.5"
              data-testid="button-ver-ext-company"
            >
              <Eye className="w-4 h-4" /> Ver lista
            </Button>
            <Button
              onClick={importExtCompany}
              disabled={importingExt}
              className="gap-1.5"
              data-testid="button-importar-ext-company"
            >
              {importingExt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Importar como Lead
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}