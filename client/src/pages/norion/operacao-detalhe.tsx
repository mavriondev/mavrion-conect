import { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import {
  DollarSign, Search, Building2, CheckCircle2, Clock, Send, FileSearch,
  BadgeDollarSign, ArrowRight, ArrowLeft, Loader2,
  AlertTriangle, FileText,
  Upload, ExternalLink, Check, XCircle, ChevronDown, ChevronUp,
  User, Home, Wallet, ClipboardList, Handshake, Star,
  Shield, Landmark, FileDown, Leaf, Tractor,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";

const STAGES = [
  { key: "identificado", label: "Identificado", icon: Search, color: "bg-slate-100 dark:bg-slate-800 border-slate-300" },
  { key: "diagnostico", label: "Diagnóstico", icon: FileSearch, color: "bg-blue-50 dark:bg-blue-950 border-blue-300" },
  { key: "enviado_fundos", label: "Enviado aos Fundos", icon: Send, color: "bg-indigo-50 dark:bg-indigo-950 border-indigo-300" },
  { key: "em_analise", label: "Em Análise", icon: Clock, color: "bg-amber-50 dark:bg-amber-950 border-amber-300" },
  { key: "aprovado", label: "Aprovado", icon: CheckCircle2, color: "bg-green-50 dark:bg-green-950 border-green-300" },
  { key: "comissao_gerada", label: "Comissão Gerada", icon: BadgeDollarSign, color: "bg-emerald-50 dark:bg-emerald-950 border-emerald-300" },
];

function formatBRL(value: number | null | undefined) {
  if (value == null) return "R$ 0";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 }).format(value);
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("pt-BR");
}

const STAGE_BADGE_COLORS: Record<string, string> = {
  identificado: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  diagnostico: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  enviado_fundos: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
  em_analise: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  aprovado: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  comissao_gerada: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
};

const CATEGORIA_CONFIG: Record<string, { label: string; icon: any }> = {
  pessoal: { label: "Dados Pessoais", icon: User },
  imovel: { label: "Imóvel (Garantia)", icon: Home },
  renda: { label: "Comprovação de Renda", icon: Wallet },
  briefing: { label: "Briefing", icon: ClipboardList },
};

const STATUS_STYLES: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; className?: string }> = {
  pendente: { label: "Pendente", variant: "secondary" },
  enviado: { label: "Enviado", variant: "outline", className: "border-blue-400 text-blue-600" },
  aprovado: { label: "Aprovado", variant: "default", className: "bg-green-600" },
  rejeitado: { label: "Rejeitado", variant: "destructive" },
};

function DocumentChecklist({ operationId }: { operationId: number }) {
  const { toast } = useToast();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/norion/operations", operationId, "documents"],
    queryFn: async () => {
      const res = await fetch(`/api/norion/operations/${operationId}/documents`);
      if (!res.ok) throw new Error("Erro ao carregar documentos");
      return res.json();
    },
    enabled: !!operationId,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/norion/operations/${operationId}/documents/generate`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/norion/operations", operationId, "documents"] }),
  });

  const updateDocMutation = useMutation({
    mutationFn: async ({ docId, data: d }: { docId: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/norion/documents/${docId}`, d);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/norion/operations", operationId, "documents"] }),
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ docId, file }: { docId: number; file: File }) => {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.readAsDataURL(file);
      });
      const res = await apiRequest("POST", `/api/norion/documents/${docId}/upload`, {
        fileBase64: base64, fileName: file.name, mimeType: file.type || "application/octet-stream",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/operations", operationId, "documents"] });
      toast({ title: "Arquivo enviado ao Google Drive" });
    },
    onError: (err: any) => toast({ title: "Erro no upload", description: err.message, variant: "destructive" }),
  });

  const docs = data?.documents || [];
  const progress = data?.progress;

  if (isLoading) return <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  if (docs.length === 0) {
    return (
      <div className="text-center py-4 space-y-2">
        <p className="text-sm text-muted-foreground">Nenhum checklist gerado.</p>
        <Button size="sm" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} data-testid="button-n-generate-checklist">
          {generateMutation.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <ClipboardList className="w-4 h-4 mr-1.5" />}
          Gerar Checklist
        </Button>
      </div>
    );
  }

  const grouped = docs.reduce((acc: Record<string, any[]>, d: any) => {
    acc[d.categoria] = acc[d.categoria] || [];
    acc[d.categoria].push(d);
    return acc;
  }, {});

  const progressPercent = progress ? Math.round((progress.concluidos / progress.total) * 100) : 0;

  const handleFileUpload = (docId: number) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        if (file.size > 10 * 1024 * 1024) {
          toast({ title: "Arquivo muito grande", description: "Máximo 10MB", variant: "destructive" });
          return;
        }
        uploadMutation.mutate({ docId, file });
      }
    };
    input.click();
  };

  return (
    <div className="space-y-3" data-testid="n-document-checklist">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{progress?.concluidos || 0} de {progress?.total || 0} concluídos</span>
          <span className="text-xs font-medium">{progressPercent}%</span>
        </div>
        <Progress value={progressPercent} className="h-2" />
        {progress && progress.obrigatoriosConcluidos < progress.obrigatorios && (
          <p className="text-xs text-amber-600">{progress.obrigatorios - progress.obrigatoriosConcluidos} obrigatório(s) pendente(s)</p>
        )}
      </div>
      {["pessoal", "imovel", "renda", "briefing"].map(cat => {
        const items = grouped[cat] || [];
        if (items.length === 0) return null;
        const config = CATEGORIA_CONFIG[cat];
        const Icon = config.icon;
        const catDone = items.filter((d: any) => d.status === "aprovado" || d.status === "enviado").length;
        const isCollapsed = collapsed[cat];
        return (
          <div key={cat} className="border rounded-lg overflow-hidden" data-testid={`n-checklist-category-${cat}`}>
            <button
              className="w-full flex items-center justify-between p-2.5 bg-muted/30 hover:bg-muted/50 transition-colors"
              onClick={() => setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }))}
            >
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">{config.label}</span>
                <Badge variant="outline" className="text-xs">{catDone}/{items.length}</Badge>
              </div>
              {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
            {!isCollapsed && (
              <div className="divide-y">
                {items.map((doc: any) => {
                  const st = STATUS_STYLES[doc.status] || STATUS_STYLES.pendente;
                  return (
                    <div key={doc.id} className="p-2.5 space-y-1.5" data-testid={`n-doc-item-${doc.id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm">{doc.nome}</span>
                            {doc.obrigatorio && <span className="text-[10px] text-red-500 font-medium">*</span>}
                          </div>
                          {doc.nomeArquivo && <p className="text-xs text-muted-foreground truncate mt-0.5">{doc.nomeArquivo}</p>}
                        </div>
                        <Badge variant={st.variant} className={cn("text-[10px] shrink-0", st.className)}>{st.label}</Badge>
                      </div>
                      <div className="flex items-center gap-1 flex-wrap">
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleFileUpload(doc.id)} disabled={uploadMutation.isPending}>
                          {uploadMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
                          Upload
                        </Button>
                        {doc.driveFileUrl && (
                          <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                            <a href={doc.driveFileUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3 h-3 mr-1" /> Drive</a>
                          </Button>
                        )}
                        {doc.status !== "aprovado" && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs text-green-600" onClick={() => updateDocMutation.mutate({ docId: doc.id, data: { status: "aprovado" } })}>
                            <Check className="w-3 h-3 mr-1" /> Aprovar
                          </Button>
                        )}
                        {doc.status !== "rejeitado" && doc.status !== "pendente" && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500" onClick={() => updateDocMutation.mutate({ docId: doc.id, data: { status: "rejeitado" } })}>
                            <XCircle className="w-3 h-3 mr-1" /> Rejeitar
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EnviosFundosSection({ operationId }: { operationId: number }) {
  const { toast } = useToast();

  const { data: envios = [], isLoading: enviosLoading } = useQuery<any[]>({
    queryKey: ["/api/norion/operations", operationId, "envios"],
    queryFn: async () => {
      const res = await fetch(`/api/norion/operations/${operationId}/envios`);
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
    enabled: !!operationId,
  });

  const { data: matching = [], isLoading: matchingLoading } = useQuery<any[]>({
    queryKey: ["/api/norion/operations", operationId, "matching-fundos"],
    queryFn: async () => {
      const res = await fetch(`/api/norion/operations/${operationId}/matching-fundos`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!operationId,
  });

  const enviarMutation = useMutation({
    mutationFn: async (fundoParceiroId: number) => {
      const res = await apiRequest("POST", `/api/norion/operations/${operationId}/envios`, { fundoParceiroId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/operations", operationId, "envios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/operations"] });
      toast({ title: "Enviado para o fundo" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const updateEnvioMutation = useMutation({
    mutationFn: async ({ envioId, data }: { envioId: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/norion/envios/${envioId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/operations", operationId, "envios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/operations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/dashboard"] });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const enviadosFundoIds = envios.map((e: any) => e.fundoParceiroId);
  const sugestoes = matching.filter((m: any) => !enviadosFundoIds.includes(m.fundo.id));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Handshake className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">Envio para Fundos</span>
      </div>

      {envios.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">Envios Ativos</p>
          {envios.map((envio: any) => (
            <div key={envio.id} className="border rounded-lg p-2.5 space-y-2" data-testid={`n-envio-${envio.id}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{envio.fundoParceiro?.nome || "Fundo"}</span>
                <Badge variant="outline" className={cn("text-xs",
                  envio.status === "aprovado" ? "border-green-400 text-green-600" :
                  envio.status === "recusado" ? "border-red-400 text-red-600" :
                  envio.status === "em_analise" ? "border-amber-400 text-amber-600" :
                  "border-blue-400 text-blue-600"
                )}>
                  {envio.status === "enviado" ? "Enviado" : envio.status === "em_analise" ? "Em Análise" : envio.status === "aprovado" ? "Aprovado" : envio.status === "recusado" ? "Recusado" : envio.status}
                </Badge>
              </div>
              {envio.status !== "aprovado" && envio.status !== "recusado" && (
                <div className="flex gap-1.5">
                  <Select
                    value=""
                    onValueChange={(val) => {
                      if (val === "em_analise") updateEnvioMutation.mutate({ envioId: envio.id, data: { status: "em_analise" } });
                      else if (val === "aprovado") updateEnvioMutation.mutate({ envioId: envio.id, data: { status: "aprovado" } });
                      else if (val === "recusado") updateEnvioMutation.mutate({ envioId: envio.id, data: { status: "recusado" } });
                    }}
                  >
                    <SelectTrigger className="h-7 text-xs w-auto">
                      <SelectValue placeholder="Atualizar status..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="em_analise">Em Análise</SelectItem>
                      <SelectItem value="aprovado">Aprovado</SelectItem>
                      <SelectItem value="recusado">Recusado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {envio.status === "aprovado" && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Valor Aprovado</Label>
                    <Input
                      type="number" className="h-7 text-xs" placeholder="R$ 0"
                      defaultValue={envio.valorAprovado || ""}
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v)) updateEnvioMutation.mutate({ envioId: envio.id, data: { valorAprovado: v, status: "aprovado" } });
                      }}
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Taxa Juros %</Label>
                    <Input
                      type="number" className="h-7 text-xs" placeholder="0"
                      defaultValue={envio.taxaJuros || ""}
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v)) updateEnvioMutation.mutate({ envioId: envio.id, data: { taxaJuros: v } });
                      }}
                    />
                  </div>
                </div>
              )}
              {envio.status === "recusado" && (
                <Input
                  className="h-7 text-xs" placeholder="Motivo da recusa..."
                  defaultValue={envio.motivoRecusa || ""}
                  onBlur={(e) => {
                    if (e.target.value) updateEnvioMutation.mutate({ envioId: envio.id, data: { motivoRecusa: e.target.value } });
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {sugestoes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">Fundos Sugeridos</p>
          {sugestoes.slice(0, 5).map((m: any) => (
            <div key={m.fundo.id} className="flex items-center justify-between border rounded-lg p-2" data-testid={`n-matching-${m.fundo.id}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{m.fundo.nome}</span>
                  <Badge variant="outline" className={cn("text-[10px] shrink-0",
                    m.score >= 80 ? "border-green-400 text-green-600 bg-green-50" :
                    m.score >= 50 ? "border-amber-400 text-amber-600 bg-amber-50" :
                    "border-slate-300 text-slate-500"
                  )}>
                    <Star className="w-2.5 h-2.5 mr-0.5" />
                    {m.score}%
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground truncate">{m.reasons?.join(" · ")}</p>
              </div>
              <Button
                variant="outline" size="sm" className="h-7 text-xs shrink-0 ml-2"
                onClick={() => enviarMutation.mutate(m.fundo.id)}
                disabled={enviarMutation.isPending}
                data-testid={`button-enviar-fundo-${m.fundo.id}`}
              >
                <Send className="w-3 h-3 mr-1" /> Enviar
              </Button>
            </div>
          ))}
        </div>
      )}

      {!enviosLoading && !matchingLoading && envios.length === 0 && sugestoes.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">Cadastre fundos parceiros para ver sugestões</p>
      )}
    </div>
  );
}

const DEFESA_FIELDS = {
  briefing: [
    { key: "historiaEmpresa", label: "História da Empresa", type: "textarea" },
    { key: "segmentoMercado", label: "Segmento de Mercado", type: "text" },
    { key: "site", label: "Site", type: "text" },
    { key: "redesSociais", label: "Redes Sociais", type: "text" },
    { key: "estadosMatrizFiliais", label: "Estados (Matriz e Filiais)", type: "text" },
    { key: "socios", label: "Sócios (nomes separados por vírgula)", type: "text" },
    { key: "administracao", label: "Administração", type: "text" },
    { key: "principaisClientes", label: "Principais Clientes", type: "textarea" },
    { key: "formaRecebimento", label: "Forma de Recebimento (boleto/cartão/etc)", type: "text" },
    { key: "prazoRecebimentoDias", label: "Prazo de Recebimento (dias)", type: "number" },
  ],
  financeiro: [
    { key: "faturamentoAnual", label: "Faturamento Anual (R$)", type: "number" },
    { key: "margemLucroLiquida", label: "Margem de Lucro Líquida (%)", type: "number" },
    { key: "valorCreditoNecessario", label: "Valor do Crédito Necessário (R$)", type: "number" },
    { key: "finalidadeCredito", label: "Finalidade do Crédito", type: "textarea" },
    { key: "socioDecisor", label: "Sócio Decisor", type: "text" },
    { key: "expectativaTaxaJuros", label: "Expectativa de Taxa de Juros (%)", type: "number" },
    { key: "expectativaPrazo", label: "Expectativa de Prazo", type: "text" },
  ],
  garantias: [
    { key: "garantiasPrincipais", label: "Garantias Principais (descrição detalhada)", type: "textarea" },
    { key: "imoveisUrbanosRurais", label: "Imóveis Urbanos / Rurais", type: "textarea" },
    { key: "imoveisQuitados", label: "Imóveis Quitados?", type: "boolean" },
    { key: "patrimonioTotalEmpresa", label: "Patrimônio Total da Empresa (R$)", type: "number" },
    { key: "patrimonioTotalSocios", label: "Patrimônio Total dos Sócios (R$)", type: "number" },
  ],
  relacionamento: [
    { key: "instituicoesFinanceiras", label: "Instituições Financeiras", type: "textarea" },
    { key: "endividamentoAberto", label: "Possui Endividamento em Aberto?", type: "boolean" },
    { key: "endividamentoValor", label: "Valor do Endividamento (R$)", type: "number" },
    { key: "restricoesCnpjCpf", label: "Restrições no CNPJ/CPF?", type: "boolean" },
    { key: "restricoesDetalhes", label: "Detalhes das Restrições", type: "textarea" },
  ],
};

const ALL_DEFESA_KEYS = Object.values(DEFESA_FIELDS).flat().map(f => f.key);

function DefesaCreditoSection({ operationId, diagnostico, company, onSave }: {
  operationId: number;
  diagnostico: any;
  company: any;
  onSave: (defesaData: Record<string, any>) => void;
}) {
  const { toast } = useToast();
  const defesa = diagnostico?.defesaCredito || {};

  const [formData, setFormData] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = { ...defesa };
    if (!initial.segmentoMercado && company?.cnaePrincipal) {
      initial.segmentoMercado = company.cnaePrincipal;
    }
    if (!initial.site && company?.website) {
      initial.site = company.website;
    }
    const enrichment = company?.enrichmentData as any;
    if (!initial.socios && enrichment?.socios?.length > 0) {
      const sociosContato = enrichment?.sociosContato || {};
      initial.socios = enrichment.socios.map((s: any, idx: number) => {
        const key = s.name ? s.name.trim().toLowerCase().replace(/\s+/g, "_") : `socio_${idx}`;
        const contato = sociosContato[key];
        const parts = [s.name];
        if (s.role) parts.push(`(${s.role})`);
        if (contato?.cpf) parts.push(`CPF: ${contato.cpf}`);
        if (contato?.telefone) parts.push(`Tel: ${contato.telefone}`);
        return parts.join(" ");
      }).join("; ");
    }
    return initial;
  });

  const [activeTab, setActiveTab] = useState("briefing");

  const handleChange = useCallback((key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  }, []);

  const filledCount = useMemo(() => {
    return ALL_DEFESA_KEYS.filter(k => {
      const v = formData[k];
      if (v === undefined || v === null || v === "") return false;
      if (typeof v === "string" && v.trim() === "") return false;
      return true;
    }).length;
  }, [formData]);

  const progressPercent = Math.round((filledCount / ALL_DEFESA_KEYS.length) * 100);

  const handleSave = () => {
    onSave({ defesaCredito: formData });
  };

  const renderField = (field: { key: string; label: string; type: string }) => {
    if (field.type === "boolean") {
      return (
        <div key={field.key} className="flex items-center gap-2" data-testid={`defesa-field-${field.key}`}>
          <Checkbox
            checked={formData[field.key] === true}
            onCheckedChange={(checked) => handleChange(field.key, checked === true)}
          />
          <Label className="text-sm cursor-pointer">{field.label}</Label>
        </div>
      );
    }
    if (field.type === "textarea") {
      return (
        <div key={field.key} data-testid={`defesa-field-${field.key}`}>
          <Label className="text-xs text-muted-foreground">{field.label}</Label>
          <Textarea
            className="text-sm mt-1"
            value={formData[field.key] || ""}
            onChange={(e) => handleChange(field.key, e.target.value)}
          />
        </div>
      );
    }
    return (
      <div key={field.key} data-testid={`defesa-field-${field.key}`}>
        <Label className="text-xs text-muted-foreground">{field.label}</Label>
        <Input
          type={field.type}
          className="text-sm mt-1"
          value={formData[field.key] ?? ""}
          onChange={(e) => handleChange(field.key, field.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
        />
      </div>
    );
  };

  const hasCaf = !!(company?.enrichmentData as any)?.caf?.numeroCAF;
  const cafData = (company?.enrichmentData as any)?.caf || {};

  const pronafQueryUrl = cafData.grupo
    ? `/api/norion/pronaf/linhas?grupo=${encodeURIComponent(cafData.grupo)}${cafData.rendaBrutaAnual ? `&renda=${cafData.rendaBrutaAnual}` : ""}`
    : "/api/norion/pronaf/linhas";

  const { data: pronafLinhas = [] } = useQuery<any[]>({
    queryKey: ["/api/norion/pronaf/linhas", cafData.grupo, cafData.rendaBrutaAnual],
    queryFn: async () => {
      const res = await fetch(pronafQueryUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Erro ao buscar linhas PRONAF");
      return res.json();
    },
    enabled: hasCaf && !!cafData.grupo,
  });

  const pronafSelecionadas = formData.pronafLinhasSelecionadas || [];

  function togglePronafLinha(linhaId: number) {
    const current = [...pronafSelecionadas];
    const idx = current.indexOf(linhaId);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(linhaId);
    handleChange("pronafLinhasSelecionadas", current);
  }

  const baseTabConfig = [
    { key: "briefing", label: "Briefing", icon: ClipboardList },
    { key: "financeiro", label: "Financeiro", icon: DollarSign },
    { key: "garantias", label: "Garantias", icon: Shield },
    { key: "relacionamento", label: "Relacionamento", icon: Landmark },
  ];

  const tabConfig = hasCaf
    ? [...baseTabConfig, { key: "pronaf", label: "PRONAF", icon: Tractor }]
    : baseTabConfig;

  const gridCols = hasCaf ? "grid-cols-5" : "grid-cols-4";

  return (
    <div className="space-y-3" data-testid="defesa-credito-section">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">Defesa do Crédito</span>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{filledCount} de {ALL_DEFESA_KEYS.length} campos preenchidos</span>
          <span className="text-xs font-medium">{progressPercent}%</span>
        </div>
        <Progress value={progressPercent} className="h-2" data-testid="defesa-progress-bar" />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className={`w-full grid ${gridCols}`}>
          {tabConfig.map(t => (
            <TabsTrigger key={t.key} value={t.key} className="text-xs gap-1" data-testid={`tab-defesa-${t.key}`}>
              <t.icon className="w-3 h-3" />
              <span className="hidden sm:inline">{t.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {baseTabConfig.map(t => (
          <TabsContent key={t.key} value={t.key} className="space-y-3 mt-3">
            {DEFESA_FIELDS[t.key as keyof typeof DEFESA_FIELDS].map(renderField)}
          </TabsContent>
        ))}

        {hasCaf && (
          <TabsContent value="pronaf" className="space-y-3 mt-3" data-testid="tab-pronaf-content">
            <div className="bg-green-50/50 border border-green-100 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Leaf className="w-4 h-4 text-green-600" />
                <span className="text-sm font-medium">Dados do CAF</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div><p className="text-xs text-muted-foreground">Grupo</p><p className="font-medium">{cafData.grupo || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Área</p><p className="font-medium">{cafData.areaHa ? `${cafData.areaHa} ha` : "—"}</p></div>
                <div>
                  <p className="text-xs text-muted-foreground">Renda Bruta</p>
                  <p className="font-medium">{cafData.rendaBrutaAnual ? `R$ ${Number(cafData.rendaBrutaAnual).toLocaleString("pt-BR")}` : "—"}</p>
                </div>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">Linhas PRONAF Elegíveis (Plano Safra 2024/2025)</p>
              {pronafLinhas.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Nenhuma linha encontrada para o grupo {cafData.grupo}.</p>
              ) : (
                <div className="space-y-1.5">
                  {pronafLinhas.map((l: any) => (
                    <div
                      key={l.id}
                      className={cn(
                        "border rounded-lg p-2.5 cursor-pointer transition-colors",
                        pronafSelecionadas.includes(l.id) ? "border-green-400 bg-green-50" : "hover:bg-muted/30"
                      )}
                      onClick={() => togglePronafLinha(l.id)}
                      data-testid={`pronaf-linha-${l.id}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Checkbox checked={pronafSelecionadas.includes(l.id)} className="pointer-events-none" />
                          <span className="text-sm font-medium">{l.nome}</span>
                        </div>
                        <Badge variant="outline" className="text-xs">{l.modalidade}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-1.5 text-xs text-muted-foreground ml-6">
                        <span>Taxa: <strong className="text-foreground">{l.taxa}% a.a.</strong></span>
                        <span>Limite: <strong className="text-foreground">R$ {Number(l.limite).toLocaleString("pt-BR")}</strong></span>
                        <span>Prazo: <strong className="text-foreground">{l.prazoMaximo}</strong></span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {pronafSelecionadas.length > 0 && (
                <p className="text-xs text-green-700 mt-2">{pronafSelecionadas.length} linha(s) selecionada(s) para o dossiê</p>
              )}
            </div>
          </TabsContent>
        )}
      </Tabs>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={handleSave} data-testid="button-defesa-salvar">
          <Check className="w-3.5 h-3.5 mr-1" />
          Salvar Defesa
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => toast({ title: "Em breve", description: "Geração de PDF do dossiê será implementada em breve." })}
          data-testid="button-defesa-gerar-pdf"
        >
          <FileDown className="w-3.5 h-3.5 mr-1" />
          Gerar PDF do Dossiê
        </Button>
      </div>
    </div>
  );
}

function PortalAccessSection({ operationId, companyTaxId, companyName }: { operationId: number; companyTaxId?: string; companyName?: string }) {
  const { toast } = useToast();
  const [portalLink, setPortalLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [taxIdInput, setTaxIdInput] = useState(companyTaxId || "");

  const { data: accessData } = useQuery({
    queryKey: ["/api/norion/operations", operationId, "acesso-cliente"],
    queryFn: async () => {
      const res = await fetch(`/api/norion/operations/${operationId}/acesso-cliente`, { credentials: "include" });
      return res.json();
    },
  });

  useEffect(() => {
    if (accessData?.exists) {
      setPortalLink(window.location.origin + accessData.portalUrl);
    }
  }, [accessData]);

  const gerarAcesso = async () => {
    if (!taxIdInput) {
      toast({ title: "Informe o CPF/CNPJ do cliente", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/norion/operations/${operationId}/gerar-acesso-cliente`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ taxId: taxIdInput, name: companyName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      const link = window.location.origin + data.portalUrl;
      setPortalLink(link);
      queryClient.invalidateQueries({ queryKey: ["/api/norion/operations", operationId, "acesso-cliente"] });
      toast({ title: "Link do portal gerado!" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const copyLink = () => {
    if (portalLink) {
      navigator.clipboard.writeText(portalLink);
      toast({ title: "Link copiado!" });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <ExternalLink className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">Portal do Cliente</span>
      </div>
      {portalLink ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input value={portalLink} readOnly className="text-xs font-mono" data-testid="input-portal-link" />
            <Button variant="outline" size="sm" onClick={copyLink} data-testid="button-copy-portal-link">
              <Check className="w-3.5 h-3.5" />
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setPortalLink(null); }} data-testid="button-regenerate-portal">
            Regenerar link
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Input
            placeholder="CPF/CNPJ do cliente"
            value={taxIdInput}
            onChange={(e) => setTaxIdInput(e.target.value)}
            className="text-sm"
            data-testid="input-portal-taxid-admin"
          />
          <Button size="sm" onClick={gerarAcesso} disabled={loading} data-testid="button-gerar-portal">
            {loading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5 mr-1.5" />}
            Gerar Link do Portal
          </Button>
        </div>
      )}
    </div>
  );
}

function FormularioClienteSection({ operationId }: { operationId: number }) {
  const { toast } = useToast();
  const [observacao, setObservacao] = useState("");
  const [showRevisao, setShowRevisao] = useState(false);

  const { data: formularios = [] } = useQuery({
    queryKey: ["/api/norion/formularios-pendentes"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/norion/formularios-pendentes");
      return res.json();
    },
  });

  const formulario = (formularios as any[]).find((f: any) => f.operationId === operationId);

  const aprovarMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/norion/formulario/${formulario.id}/aprovar`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Formulário aprovado!" });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/formularios-pendentes"] });
    },
  });

  const revisarMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/norion/formulario/${formulario.id}/revisar`, { observacao });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Revisão solicitada" });
      setShowRevisao(false);
      setObservacao("");
      queryClient.invalidateQueries({ queryKey: ["/api/norion/formularios-pendentes"] });
    },
  });

  if (!formulario) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Formulário do Cliente</span>
        </div>
        <p className="text-xs text-muted-foreground">Nenhum formulário enviado pelo cliente ainda.</p>
      </div>
    );
  }

  const STATUS_MAP: Record<string, { label: string; color: string }> = {
    rascunho: { label: "Rascunho", color: "bg-slate-100 text-slate-600" },
    enviado: { label: "Enviado", color: "bg-blue-100 text-blue-700" },
    em_revisao: { label: "Em Revisão", color: "bg-amber-100 text-amber-700" },
    aprovado: { label: "Aprovado", color: "bg-green-100 text-green-700" },
  };
  const st = STATUS_MAP[formulario.status] || STATUS_MAP.rascunho;

  const fields = [
    { label: "Nome", value: formulario.nomeCompleto },
    { label: "CPF", value: formulario.cpf },
    { label: "E-mail", value: formulario.email },
    { label: "Celular", value: formulario.celular },
    { label: "Cidade/UF", value: formulario.cidade && formulario.uf ? `${formulario.cidade}/${formulario.uf}` : null },
    { label: "Profissão", value: formulario.profissao },
    { label: "Renda Mensal", value: formulario.rendaMensal ? `R$ ${Number(formulario.rendaMensal).toLocaleString("pt-BR")}` : null },
    { label: "Valor Solicitado", value: formulario.valorSolicitado ? `R$ ${Number(formulario.valorSolicitado).toLocaleString("pt-BR")}` : null },
    { label: "Finalidade", value: formulario.finalidadeCredito },
    { label: "Prazo", value: formulario.prazoDesejado },
    { label: "Garantia", value: formulario.tipoGarantia },
  ];

  return (
    <div className="space-y-3" data-testid="formulario-cliente-section">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Formulário do Cliente</span>
        </div>
        <Badge className={cn("text-xs", st.color)}>{st.label}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        {fields.filter(f => f.value).map((f) => (
          <div key={f.label}>
            <p className="text-muted-foreground">{f.label}</p>
            <p className="font-medium">{f.value}</p>
          </div>
        ))}
      </div>

      {formulario.documentos && formulario.documentos.length > 0 && (
        <div className="text-xs">
          <p className="text-muted-foreground mb-1">Documentos ({formulario.documentos.length})</p>
          <div className="space-y-1">
            {formulario.documentos.map((doc: any) => (
              <div key={doc.id} className="flex items-center justify-between p-1.5 rounded border">
                <span className="truncate">{doc.nomeDocumento || doc.tipoDocumento}</span>
                <div className="flex items-center gap-1">
                  <Badge variant={doc.status === "aprovado" ? "default" : doc.status === "rejeitado" ? "destructive" : "secondary"} className="text-[9px] h-4">{doc.status}</Badge>
                  {doc.driveFileUrl && (
                    <a href={doc.driveFileUrl} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-700">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {formulario.status === "enviado" && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" className="text-xs bg-green-600 hover:bg-green-700 text-white" onClick={() => aprovarMutation.mutate()} disabled={aprovarMutation.isPending} data-testid="button-aprovar-formulario">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Aprovar
          </Button>
          <Button size="sm" variant="outline" className="text-xs text-amber-600 border-amber-300" onClick={() => setShowRevisao(!showRevisao)} data-testid="button-pedir-revisao">
            <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Pedir Revisão
          </Button>
        </div>
      )}

      {showRevisao && (
        <div className="space-y-2 p-3 border rounded-lg bg-amber-50 dark:bg-amber-950/20">
          <Label className="text-xs">Motivo da revisão</Label>
          <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Descreva o que precisa ser corrigido..." rows={2} className="text-xs" data-testid="input-observacao-revisao" />
          <Button size="sm" className="text-xs" onClick={() => revisarMutation.mutate()} disabled={!observacao.trim() || revisarMutation.isPending} data-testid="button-enviar-revisao">
            Enviar Solicitação de Revisão
          </Button>
        </div>
      )}

      {formulario.observacaoRevisao && formulario.status === "em_revisao" && (
        <div className="p-2 bg-amber-50 dark:bg-amber-950/20 rounded border border-amber-200 text-xs">
          <p className="font-medium text-amber-700">Revisão solicitada:</p>
          <p className="text-amber-600 mt-0.5">{formulario.observacaoRevisao}</p>
        </div>
      )}
    </div>
  );
}

export default function OperacaoDetalhePage({ id }: { id: string }) {
  const { toast } = useToast();
  const operationId = parseInt(id);

  const { data: operations = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/norion/operations"] });

  const op = operations.find((o: any) => o.id === operationId);

  const currentStageIdx = STAGES.findIndex(s => s.key === op?.stage);

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch(`/api/norion/operations/${operationId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data), credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Erro" }));
        const error: any = new Error(err.message);
        error.pendingDocs = err.pendingDocs;
        throw error;
      }
      return res.json();
    },
    onMutate: async (data: any) => {
      const prev = queryClient.getQueryData<any[]>(["/api/norion/operations"]);
      queryClient.setQueryData(["/api/norion/operations"], (old: any[] | undefined) =>
        old?.map((o: any) => o.id === operationId ? { ...o, ...data } : o)
      );
      await queryClient.cancelQueries({ queryKey: ["/api/norion/operations"] });
      return { prev };
    },
    onError: (err: any, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(["/api/norion/operations"], context.prev);
      const description = err.pendingDocs ? `Documentos pendentes: ${err.pendingDocs.join(", ")}` : err.message;
      toast({ title: "Documentos obrigatórios pendentes", description, variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/operations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/dashboard"] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!op) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <Link href="/norion-app/operacoes">
          <Button variant="ghost" size="sm" data-testid="button-voltar-operacoes">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Voltar
          </Button>
        </Link>
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">Operação não encontrada</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const diag = op.diagnostico || {};

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/norion-app/operacoes">
          <Button variant="ghost" size="icon" data-testid="button-voltar-operacoes">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate" data-testid="text-operacao-detalhe-title">
            {op.company?.legalName || "Operação"}
          </h1>
          <p className="text-sm text-muted-foreground">Detalhe da operação de crédito</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs">{STAGES.find(s => s.key === op.stage)?.label}</Badge>
            {op.comissaoRecebida && <Badge className="bg-green-600 text-white text-xs">Comissão Recebida</Badge>}
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-muted-foreground text-xs">Valor Solicitado</p><p className="font-medium">{formatBRL(diag.valorSolicitado)}</p></div>
            <div><p className="text-muted-foreground text-xs">Finalidade</p><p className="font-medium">{diag.finalidade || "—"}</p></div>
            <div><p className="text-muted-foreground text-xs">Prazo</p><p className="font-medium">{diag.prazo || "—"}</p></div>
            <div><p className="text-muted-foreground text-xs">Faturamento</p><p className="font-medium">{diag.faturamento || "—"}</p></div>
            <div><p className="text-muted-foreground text-xs">Dívida Bancária</p><p className="font-medium">{diag.possuiDivida === true ? "Sim" : diag.possuiDivida === false ? "Não" : "—"}</p></div>
            <div><p className="text-muted-foreground text-xs">Garantias</p><p className="font-medium">{(diag.garantias || []).join(", ") || "—"}</p></div>
          </div>
          {op.observacoesInternas && (
            <div><p className="text-muted-foreground text-xs mb-1">Observações</p><p className="text-sm bg-muted/30 rounded p-2">{op.observacoesInternas}</p></div>
          )}
          <Separator />
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-muted-foreground text-xs">Valor Aprovado</p><p className="font-medium">{formatBRL(op.valorAprovado)}</p></div>
            <div><p className="text-muted-foreground text-xs">% Comissão</p><p className="font-medium">{op.percentualComissao || 0}%</p></div>
            <div><p className="text-muted-foreground text-xs">Valor Comissão</p><p className="font-medium">{formatBRL(op.valorComissao)}</p></div>
            <div><p className="text-muted-foreground text-xs">Criado em</p><p className="font-medium">{formatDate(op.createdAt)}</p></div>
          </div>
          <Separator />
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Valor Aprovado (R$)</Label>
            <Input type="number" placeholder="0" defaultValue={op.valorAprovado || ""} data-testid="input-n-valor-aprovado"
              onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v !== op.valorAprovado) updateMutation.mutate({ valorAprovado: v }); }} />
            <Label className="text-xs text-muted-foreground">% Comissão</Label>
            <Input type="number" placeholder="0" defaultValue={op.percentualComissao || ""} data-testid="input-n-percentual-comissao"
              onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v !== op.percentualComissao) updateMutation.mutate({ percentualComissao: v, valorAprovado: op.valorAprovado }); }} />
          </div>
          <Separator />
          <div>
            <div className="flex items-center gap-2 mb-3">
              <ClipboardList className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Checklist Documental</span>
            </div>
            <DocumentChecklist operationId={op.id} />
          </div>
          <Separator />
          <EnviosFundosSection operationId={op.id} />
          <Separator />
          <DefesaCreditoSection
            operationId={op.id}
            diagnostico={diag}
            company={op.company}
            onSave={(defesaData) => {
              updateMutation.mutate({ diagnostico: { ...diag, ...defesaData } });
            }}
          />
          <Separator />
          <PortalAccessSection operationId={op.id} companyTaxId={op.company?.cnpj} companyName={op.company?.legalName} />
          <Separator />
          <FormularioClienteSection operationId={op.id} />
          <Separator />
          <div className="flex flex-col gap-2 pt-2">
            {currentStageIdx < STAGES.length - 1 && (
              <Button onClick={() => updateMutation.mutate({ stage: STAGES[currentStageIdx + 1].key })} disabled={updateMutation.isPending} data-testid="button-n-next-stage">
                <ArrowRight className="w-4 h-4 mr-1.5" />
                Mover para: {STAGES[currentStageIdx + 1]?.label}
              </Button>
            )}
            {["aprovado", "comissao_gerada"].includes(op.stage) && !op.comissaoRecebida && (
              <Button variant="outline" className="text-green-600 border-green-300" onClick={() => updateMutation.mutate({ comissaoRecebida: true })} disabled={updateMutation.isPending} data-testid="button-n-mark-commission">
                <CheckCircle2 className="w-4 h-4 mr-1.5" />
                Marcar Comissão Recebida
              </Button>
            )}
          </div>
          <div className="pt-2">
            <Label className="text-xs text-muted-foreground">Mover para etapa específica</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {STAGES.map((s) => (
                <Button key={s.key} variant={op.stage === s.key ? "default" : "outline"} size="sm" className="text-xs h-7"
                  disabled={op.stage === s.key || updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ stage: s.key })} data-testid={`button-n-stage-${s.key}`}
                >{s.label}</Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
