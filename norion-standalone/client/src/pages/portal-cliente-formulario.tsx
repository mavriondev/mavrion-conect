import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2, Upload, Check, X, User, MapPin, Briefcase,
  CreditCard, Building2, FileText, LogOut, ChevronLeft,
  ChevronRight, AlertTriangle, CheckCircle2, Eye, Camera,
  ChevronDown, ChevronUp, Home, Wallet, ClipboardList,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "pessoal", label: "Dados Pessoais", icon: User },
  { key: "endereco", label: "Endereço", icon: MapPin },
  { key: "profissional", label: "Profissional", icon: Briefcase },
  { key: "credito", label: "Operação", icon: CreditCard },
  { key: "patrimonio", label: "Patrimônio", icon: Building2 },
  { key: "documentos", label: "Documentos", icon: FileText },
];

const FINALIDADES = [
  "Capital de Giro",
  "Compra de Imóvel",
  "Reforma / Construção",
  "Investimento em Equipamentos",
  "Expansão do Negócio",
  "Refinanciamento",
  "Aquisição de Empresa",
  "Outro",
];

const GARANTIAS = [
  "Imóvel Urbano",
  "Imóvel Rural",
  "Veículo",
  "Recebíveis",
  "Aplicações Financeiras",
  "Fiança / Aval",
  "Sem Garantia",
  "Outro",
];

const ESTADOS_CIVIS = [
  "Solteiro(a)",
  "Casado(a)",
  "Divorciado(a)",
  "Viúvo(a)",
  "União Estável",
];

const CATEGORY_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  pessoal: { label: "Documentos Pessoais", icon: User, color: "text-blue-500" },
  imovel: { label: "Imóvel / Garantia", icon: Home, color: "text-green-500" },
  renda: { label: "Renda e Financeiro", icon: Wallet, color: "text-amber-500" },
  briefing: { label: "Briefing da Operação", icon: ClipboardList, color: "text-purple-500" },
};

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pendente: { label: "Pendente", variant: "outline" },
  enviado: { label: "Enviado", variant: "secondary" },
  aprovado: { label: "Aprovado", variant: "default" },
  rejeitado: { label: "Rejeitado", variant: "destructive" },
};

function getPortalHeaders(): Record<string, string> {
  return {
    "x-portal-client-id": sessionStorage.getItem("portalClientId") || "",
    "x-portal-token": sessionStorage.getItem("portalToken") || "",
  };
}

async function portalFetch(url: string, options?: RequestInit) {
  const headers = { ...getPortalHeaders(), ...(options?.headers || {}) };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Erro na requisição" }));
    throw new Error(err.message);
  }
  return res.json();
}

function formatTaxId(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return digits
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 10) {
    return digits.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  }
  return digits.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

function formatCentavos(centavos: string): string {
  if (!centavos || centavos === "0") return "";
  const padded = centavos.padStart(3, "0");
  const intPart = padded.slice(0, -2).replace(/^0+/, "") || "0";
  const decPart = padded.slice(-2);
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${formatted},${decPart}`;
}

function centavosToNumber(centavos: string): number | null {
  if (!centavos) return null;
  const num = parseInt(centavos, 10);
  if (isNaN(num)) return null;
  return num / 100;
}

function numberToCentavos(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return "";
  return String(Math.round(value * 100));
}

function CurrencyInput({
  value,
  onChange,
  placeholder = "0,00",
  disabled = false,
  "data-testid": testId,
}: {
  value: number | null | undefined;
  onChange: (val: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  "data-testid"?: string;
}) {
  const [centavos, setCentavos] = useState(() => numberToCentavos(value));
  const lastExternalValue = useRef(value);

  useEffect(() => {
    if (value !== lastExternalValue.current) {
      lastExternalValue.current = value;
      setCentavos(numberToCentavos(value));
    }
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const allowed = ["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "Home", "End"];
    if (allowed.includes(e.key)) return;
    if (e.key >= "0" && e.key <= "9") return;
    e.preventDefault();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "");
    const trimmed = raw.replace(/^0+/, "") || "";
    setCentavos(trimmed);
    const num = centavosToNumber(trimmed);
    lastExternalValue.current = num;
    onChange(num);
  };

  return (
    <Input
      value={formatCentavos(centavos)}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      inputMode="numeric"
      data-testid={testId}
    />
  );
}

function formatCep(value: string): string {
  return value.replace(/\D/g, "").replace(/(\d{5})(\d{1,3})/, "$1-$2").slice(0, 9);
}

export default function PortalClienteFormulario() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [cepLoading, setCepLoading] = useState(false);
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cnpjData, setCnpjData] = useState<any>(null);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    pessoal: true, imovel: true, renda: true, briefing: true,
  });
  const [uploadingDocId, setUploadingDocId] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewDocId, setPreviewDocId] = useState<number | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const portalClientId = sessionStorage.getItem("portalClientId");
  const portalToken = sessionStorage.getItem("portalToken");
  const clientInfo = sessionStorage.getItem("portalClient");

  useEffect(() => {
    if (!portalClientId || !portalToken) {
      setLocation("/portal-cliente");
    }
  }, [portalClientId, portalToken, setLocation]);

  const clientName = clientInfo ? JSON.parse(clientInfo).name : "";

  const { data: formulario, isLoading } = useQuery({
    queryKey: ["/api/norion-portal/formulario"],
    queryFn: () => portalFetch("/api/norion-portal/formulario"),
    enabled: !!portalClientId,
  });

  const { data: documentos = [] } = useQuery({
    queryKey: ["/api/norion-portal/documentos"],
    queryFn: () => portalFetch("/api/norion-portal/documentos"),
    enabled: !!portalClientId,
  });

  useEffect(() => {
    if (formulario) {
      setFormData(formulario);
      if (formulario.currentStep) setCurrentStep(formulario.currentStep);
    }
  }, [formulario]);

  const saveMutation = useMutation({
    mutationFn: (data: any) => portalFetch("/api/norion-portal/formulario", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
    onSuccess: (data) => {
      qc.setQueryData(["/api/norion-portal/formulario"], data);
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    },
  });

  const finalizarMutation = useMutation({
    mutationFn: () => portalFetch("/api/norion-portal/formulario/finalizar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
    onSuccess: (data) => {
      qc.setQueryData(["/api/norion-portal/formulario"], data);
      toast({ title: "Formulário enviado com sucesso!", description: "Aguarde a análise da equipe Norion Capital." });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao finalizar", description: err.message, variant: "destructive" });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ docId, file }: { docId: number; file: File }) => {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
        reader.readAsDataURL(file);
      });
      return portalFetch(`/api/norion-portal/documentos/${docId}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: base64, fileName: file.name, mimeType: file.type }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/norion-portal/documentos"] });
      toast({ title: "Documento enviado!" });
      cancelPreview();
    },
    onError: (err: any) => {
      toast({ title: "Erro no upload", description: err.message, variant: "destructive" });
    },
  });

  const setField = useCallback((key: string, value: any) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }, []);

  const saveCurrentStep = useCallback(async (nextStep: number) => {
    const data = { ...formData, currentStep: nextStep };
    saveMutation.mutate(data);
  }, [formData, saveMutation]);

  const goNext = () => {
    if (currentStep < 6) {
      const next = currentStep + 1;
      saveCurrentStep(next);
      setCurrentStep(next);
    }
  };

  const goPrev = () => {
    if (currentStep > 1) {
      const prev = currentStep - 1;
      saveCurrentStep(prev);
      setCurrentStep(prev);
    }
  };

  const lookupCep = async () => {
    const cep = (formData.cep || "").replace(/\D/g, "");
    if (cep.length !== 8) return;
    setCepLoading(true);
    try {
      const data = await fetch(`/api/norion-portal/cep/${cep}`).then(r => r.json());
      if (data.logradouro) {
        setFormData(prev => ({
          ...prev,
          logradouro: data.logradouro || prev.logradouro,
          bairro: data.bairro || prev.bairro,
          cidade: data.localidade || prev.cidade,
          uf: data.uf || prev.uf,
        }));
      }
    } catch { }
    setCepLoading(false);
  };

  const lookupCnpj = async () => {
    const cnpj = (formData.cnpjEmpresa || "").replace(/\D/g, "");
    if (cnpj.length !== 14) return;
    setCnpjLoading(true);
    try {
      const data = await fetch(`/api/norion-portal/cnpj/${cnpj}`).then(r => r.json());
      setCnpjData(data);
      const updates: Record<string, any> = {};
      if (data.company?.name || data.alias) {
        updates.empresaTrabalho = data.company?.name || data.alias;
      }
      const addr = data.address;
      if (addr) {
        if (addr.zip && !formData.cep) updates.cep = addr.zip.replace(/\D/g, "");
        if (addr.street && !formData.logradouro) updates.logradouro = addr.street;
        if (addr.number && !formData.numero) updates.numero = addr.number;
        if (addr.details && !formData.complemento) updates.complemento = addr.details;
        if (addr.district && !formData.bairro) updates.bairro = addr.district;
        if (addr.city && !formData.cidade) updates.cidade = addr.city;
        if (addr.state && !formData.uf) updates.uf = addr.state;
      }
      if (Object.keys(updates).length > 0) {
        setFormData(prev => ({ ...prev, ...updates }));
        toast({ title: "Dados da empresa preenchidos", description: "Verifique os campos de endereço e empresa." });
      }
    } catch { }
    setCnpjLoading(false);
  };

  const handleFileSelect = (docId: number) => {
    setUploadingDocId(docId);
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadingDocId) return;
    if (file.type.startsWith("image/")) {
      setPreviewFile(file);
      setPreviewDocId(uploadingDocId);
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      uploadMutation.mutate({ docId: uploadingDocId, file });
    }
    e.target.value = "";
  };

  const confirmUpload = () => {
    if (previewFile && previewDocId) {
      uploadMutation.mutate({ docId: previewDocId, file: previewFile });
    }
  };

  const cancelPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewDocId(null);
    setPreviewFile(null);
    setUploadingDocId(null);
  };

  const handleLogout = () => {
    sessionStorage.removeItem("portalClientId");
    sessionStorage.removeItem("portalToken");
    sessionStorage.removeItem("portalClient");
    setLocation("/portal-cliente");
  };

  const isReadOnly = formData.status === "enviado" || formData.status === "aprovado";
  const isRevisao = formData.status === "em_revisao";

  if (!portalClientId || !portalToken) return null;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    );
  }

  const progressPercent = (currentStep / 6) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <header className="sticky top-0 z-40 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-amber-500" />
            <span className="font-bold text-sm text-slate-800 dark:text-white">Norion Capital</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation("/portal-cliente/dashboard")}
              className="text-xs"
              data-testid="link-nav-documentos"
            >
              <FileText className="w-3.5 h-3.5 mr-1" />
              Documentos
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-portal-logout">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
        {clientName && (
          <div className="max-w-lg mx-auto px-4 pb-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">Olá, <span className="font-medium text-slate-700 dark:text-slate-300">{clientName}</span></p>
          </div>
        )}
      </header>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-4 pb-24">
        {isRevisao && formData.observacaoRevisao && (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30" data-testid="banner-revisao">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Revisão Solicitada</p>
                <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">{formData.observacaoRevisao}</p>
                <p className="text-xs text-amber-600 dark:text-amber-500 mt-2">Corrija os itens indicados e envie novamente.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {isReadOnly && (
          <Card className="border-green-300 bg-green-50 dark:bg-green-950/30" data-testid="banner-readonly">
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-300">
                  {formData.status === "aprovado" ? "Formulário Aprovado" : "Formulário Enviado"}
                </p>
                <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                  {formData.status === "aprovado"
                    ? "Seu formulário foi aprovado pela equipe Norion Capital."
                    : "Seu formulário está em análise. Você será notificado sobre o resultado."}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-2" data-testid="wizard-stepper">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1">
            <span>Etapa {currentStep} de 6</span>
            <span>{Math.round(progressPercent)}%</span>
          </div>
          <Progress value={progressPercent} className="h-2" />
          <div className="flex gap-1">
            {STEPS.map((step, i) => {
              const StepIcon = step.icon;
              const isActive = i + 1 === currentStep;
              const isDone = i + 1 < currentStep;
              return (
                <button
                  key={step.key}
                  onClick={() => {
                    if (!isReadOnly) {
                      saveCurrentStep(i + 1);
                      setCurrentStep(i + 1);
                    }
                  }}
                  className={cn(
                    "flex-1 flex flex-col items-center gap-0.5 py-2 rounded-lg text-[10px] transition-all",
                    isActive && "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium",
                    isDone && "text-green-600 dark:text-green-400",
                    !isActive && !isDone && "text-slate-400 dark:text-slate-500",
                  )}
                  data-testid={`step-button-${step.key}`}
                >
                  {isDone ? <Check className="w-3.5 h-3.5" /> : <StepIcon className="w-3.5 h-3.5" />}
                  <span className="hidden sm:block">{step.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <Card className="shadow-sm">
          <CardContent className="p-5 space-y-4">
            <h2 className="font-semibold text-base flex items-center gap-2 text-slate-800 dark:text-white" data-testid="step-title">
              {(() => { const S = STEPS[currentStep - 1]; const I = S.icon; return <><I className="w-4.5 h-4.5 text-amber-500" /> {S.label}</>; })()}
            </h2>

            {currentStep === 1 && (
              <div className="space-y-3" data-testid="step-pessoal">
                <FieldGroup label="Nome Completo *">
                  <Input value={formData.nomeCompleto || ""} onChange={(e) => setField("nomeCompleto", e.target.value)} placeholder="Nome completo" disabled={isReadOnly} data-testid="input-nome" />
                </FieldGroup>
                <FieldGroup label="CPF *">
                  <Input value={formatTaxId(formData.cpf || "")} onChange={(e) => setField("cpf", e.target.value.replace(/\D/g, ""))} placeholder="000.000.000-00" maxLength={14} disabled={isReadOnly} data-testid="input-cpf" />
                </FieldGroup>
                <FieldGroup label="RG">
                  <Input value={formData.rg || ""} onChange={(e) => setField("rg", e.target.value)} placeholder="Número do RG" disabled={isReadOnly} data-testid="input-rg" />
                </FieldGroup>
                <FieldGroup label="Data de Nascimento">
                  <Input type="date" value={formData.dataNascimento || ""} onChange={(e) => setField("dataNascimento", e.target.value)} disabled={isReadOnly} data-testid="input-nascimento" />
                </FieldGroup>
                <FieldGroup label="Estado Civil">
                  <Select value={formData.estadoCivil || ""} onValueChange={(v) => setField("estadoCivil", v)} disabled={isReadOnly}>
                    <SelectTrigger data-testid="select-estado-civil"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {ESTADOS_CIVIS.map((ec) => <SelectItem key={ec} value={ec}>{ec}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FieldGroup>
                <FieldGroup label="Naturalidade">
                  <Input value={formData.naturalidade || ""} onChange={(e) => setField("naturalidade", e.target.value)} placeholder="Cidade/UF de nascimento" disabled={isReadOnly} data-testid="input-naturalidade" />
                </FieldGroup>
                <FieldGroup label="Nome da Mãe">
                  <Input value={formData.nomeMae || ""} onChange={(e) => setField("nomeMae", e.target.value)} placeholder="Nome completo da mãe" disabled={isReadOnly} data-testid="input-nome-mae" />
                </FieldGroup>
                <FieldGroup label="E-mail *">
                  <Input type="email" value={formData.email || ""} onChange={(e) => setField("email", e.target.value)} placeholder="email@exemplo.com" disabled={isReadOnly} data-testid="input-email" />
                </FieldGroup>
                <FieldGroup label="Telefone">
                  <Input value={formatPhone(formData.telefone || "")} onChange={(e) => setField("telefone", e.target.value.replace(/\D/g, ""))} placeholder="(00) 0000-0000" maxLength={15} disabled={isReadOnly} data-testid="input-telefone" />
                </FieldGroup>
                <FieldGroup label="Celular *">
                  <Input value={formatPhone(formData.celular || "")} onChange={(e) => setField("celular", e.target.value.replace(/\D/g, ""))} placeholder="(00) 00000-0000" maxLength={15} disabled={isReadOnly} data-testid="input-celular" />
                </FieldGroup>
              </div>
            )}

            {currentStep === 2 && (
              <div className="space-y-3" data-testid="step-endereco">
                <FieldGroup label="CEP *">
                  <div className="flex gap-2">
                    <Input value={formatCep(formData.cep || "")} onChange={(e) => setField("cep", e.target.value.replace(/\D/g, ""))} onBlur={lookupCep} placeholder="00000-000" maxLength={9} disabled={isReadOnly} data-testid="input-cep" />
                    {cepLoading && <Loader2 className="w-4 h-4 animate-spin self-center text-amber-500" />}
                  </div>
                </FieldGroup>
                <FieldGroup label="Logradouro *">
                  <Input value={formData.logradouro || ""} onChange={(e) => setField("logradouro", e.target.value)} placeholder="Rua, Avenida..." disabled={isReadOnly} data-testid="input-logradouro" />
                </FieldGroup>
                <div className="grid grid-cols-3 gap-3">
                  <FieldGroup label="Número *">
                    <Input value={formData.numero || ""} onChange={(e) => setField("numero", e.target.value)} placeholder="Nº" disabled={isReadOnly} data-testid="input-numero" />
                  </FieldGroup>
                  <div className="col-span-2">
                    <FieldGroup label="Complemento">
                      <Input value={formData.complemento || ""} onChange={(e) => setField("complemento", e.target.value)} placeholder="Apto, Bloco..." disabled={isReadOnly} data-testid="input-complemento" />
                    </FieldGroup>
                  </div>
                </div>
                <FieldGroup label="Bairro *">
                  <Input value={formData.bairro || ""} onChange={(e) => setField("bairro", e.target.value)} placeholder="Bairro" disabled={isReadOnly} data-testid="input-bairro" />
                </FieldGroup>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <FieldGroup label="Cidade *">
                      <Input value={formData.cidade || ""} onChange={(e) => setField("cidade", e.target.value)} placeholder="Cidade" disabled={isReadOnly} data-testid="input-cidade" />
                    </FieldGroup>
                  </div>
                  <FieldGroup label="UF *">
                    <Input value={formData.uf || ""} onChange={(e) => setField("uf", e.target.value.toUpperCase())} placeholder="UF" maxLength={2} disabled={isReadOnly} data-testid="input-uf" />
                  </FieldGroup>
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className="space-y-3" data-testid="step-profissional">
                <FieldGroup label="Profissão *">
                  <Input value={formData.profissao || ""} onChange={(e) => setField("profissao", e.target.value)} placeholder="Sua profissão" disabled={isReadOnly} data-testid="input-profissao" />
                </FieldGroup>
                <FieldGroup label="Empresa onde Trabalha">
                  <Input value={formData.empresaTrabalho || ""} onChange={(e) => setField("empresaTrabalho", e.target.value)} placeholder="Nome da empresa" disabled={isReadOnly} data-testid="input-empresa" />
                </FieldGroup>
                <FieldGroup label="CNPJ da Empresa">
                  <div className="flex gap-2">
                    <Input value={formatTaxId(formData.cnpjEmpresa || "")} onChange={(e) => setField("cnpjEmpresa", e.target.value.replace(/\D/g, ""))} onBlur={lookupCnpj} placeholder="00.000.000/0001-00" maxLength={18} disabled={isReadOnly} data-testid="input-cnpj-empresa" />
                    {cnpjLoading && <Loader2 className="w-4 h-4 animate-spin self-center text-amber-500" />}
                  </div>
                  {cnpjData && (
                    <div className="text-xs bg-green-50 dark:bg-green-950/30 p-2 rounded border border-green-200 mt-1" data-testid="cnpj-lookup-result">
                      <p className="font-medium">{cnpjData.company?.name || cnpjData.alias || "—"}</p>
                      {cnpjData.mainActivity && (
                        <p className="text-muted-foreground mt-0.5">CNAE: {cnpjData.mainActivity.id} — {cnpjData.mainActivity.text}</p>
                      )}
                      {cnpjData.status && (
                        <p className={cn("mt-0.5 font-medium", cnpjData.status.text === "Ativa" ? "text-green-600" : "text-amber-600")}>
                          Situação: {cnpjData.status.text}
                        </p>
                      )}
                    </div>
                  )}
                </FieldGroup>
                <FieldGroup label="Renda Mensal (R$) *">
                  <CurrencyInput value={formData.rendaMensal} onChange={(v) => setField("rendaMensal", v)} disabled={isReadOnly} data-testid="input-renda" />
                </FieldGroup>
                <FieldGroup label="Tempo de Emprego">
                  <Input value={formData.tempoEmprego || ""} onChange={(e) => setField("tempoEmprego", e.target.value)} placeholder="Ex: 2 anos e 6 meses" disabled={isReadOnly} data-testid="input-tempo-emprego" />
                </FieldGroup>
                <FieldGroup label="Outras Rendas">
                  <Textarea value={formData.outrasRendas || ""} onChange={(e) => setField("outrasRendas", e.target.value)} placeholder="Descreva outras fontes de renda, se houver" rows={2} disabled={isReadOnly} data-testid="input-outras-rendas" />
                </FieldGroup>
              </div>
            )}

            {currentStep === 4 && (
              <div className="space-y-3" data-testid="step-credito">
                <FieldGroup label="Valor Solicitado (R$) *">
                  <CurrencyInput value={formData.valorSolicitado} onChange={(v) => setField("valorSolicitado", v)} disabled={isReadOnly} data-testid="input-valor-solicitado" />
                </FieldGroup>
                <FieldGroup label="Finalidade do Crédito *">
                  <Select value={formData.finalidadeCredito || ""} onValueChange={(v) => setField("finalidadeCredito", v)} disabled={isReadOnly}>
                    <SelectTrigger data-testid="select-finalidade"><SelectValue placeholder="Selecione a finalidade" /></SelectTrigger>
                    <SelectContent>
                      {FINALIDADES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FieldGroup>
                <FieldGroup label="Prazo Desejado *">
                  <Input value={formData.prazoDesejado || ""} onChange={(e) => setField("prazoDesejado", e.target.value)} placeholder="Ex: 36 meses, 5 anos" disabled={isReadOnly} data-testid="input-prazo" />
                </FieldGroup>
                <FieldGroup label="Tipo de Garantia *">
                  <Select value={formData.tipoGarantia || ""} onValueChange={(v) => setField("tipoGarantia", v)} disabled={isReadOnly}>
                    <SelectTrigger data-testid="select-garantia"><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
                    <SelectContent>
                      {GARANTIAS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FieldGroup>
                <FieldGroup label="Descrição da Garantia">
                  <Textarea value={formData.descricaoGarantia || ""} onChange={(e) => setField("descricaoGarantia", e.target.value)} placeholder="Descreva a garantia oferecida" rows={2} disabled={isReadOnly} data-testid="input-desc-garantia" />
                </FieldGroup>
                <FieldGroup label="Valor Estimado da Garantia (R$)">
                  <CurrencyInput value={formData.valorGarantia} onChange={(v) => setField("valorGarantia", v)} disabled={isReadOnly} data-testid="input-valor-garantia" />
                </FieldGroup>
              </div>
            )}

            {currentStep === 5 && (
              <div className="space-y-4" data-testid="step-patrimonio">
                <div className="flex items-center justify-between p-3 rounded-lg border bg-slate-50 dark:bg-slate-800">
                  <div className="flex items-center gap-2">
                    <Home className="w-4 h-4 text-slate-500" />
                    <span className="text-sm font-medium">Possui Imóvel?</span>
                  </div>
                  <Switch checked={formData.possuiImovel || false} onCheckedChange={(v) => setField("possuiImovel", v)} disabled={isReadOnly} data-testid="switch-imovel" />
                </div>
                {formData.possuiImovel && (
                  <FieldGroup label="Valor Estimado do Imóvel (R$)">
                    <CurrencyInput value={formData.valorImovel} onChange={(v) => setField("valorImovel", v)} disabled={isReadOnly} data-testid="input-valor-imovel" />
                  </FieldGroup>
                )}
                <div className="flex items-center justify-between p-3 rounded-lg border bg-slate-50 dark:bg-slate-800">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-slate-500" />
                    <span className="text-sm font-medium">Possui Veículo?</span>
                  </div>
                  <Switch checked={formData.possuiVeiculo || false} onCheckedChange={(v) => setField("possuiVeiculo", v)} disabled={isReadOnly} data-testid="switch-veiculo" />
                </div>
                {formData.possuiVeiculo && (
                  <FieldGroup label="Valor Estimado do Veículo (R$)">
                    <CurrencyInput value={formData.valorVeiculo} onChange={(v) => setField("valorVeiculo", v)} disabled={isReadOnly} data-testid="input-valor-veiculo" />
                  </FieldGroup>
                )}
                <FieldGroup label="Outros Patrimônios">
                  <Textarea value={formData.outrosPatrimonios || ""} onChange={(e) => setField("outrosPatrimonios", e.target.value)} placeholder="Descreva outros bens, investimentos, etc." rows={3} disabled={isReadOnly} data-testid="input-outros-patrimonios" />
                </FieldGroup>
              </div>
            )}

            {currentStep === 6 && (
              <div className="space-y-3" data-testid="step-documentos">
                {documentos.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    <FileText className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Nenhum documento solicitado ainda.</p>
                    <p className="text-xs mt-1">Seu consultor irá configurar os documentos necessários.</p>
                  </div>
                ) : (
                  Object.entries(CATEGORY_CONFIG).map(([catKey, catConfig]) => {
                    const catDocs = documentos.filter((d: any) => d.categoria === catKey);
                    if (catDocs.length === 0) return null;
                    const CatIcon = catConfig.icon;
                    const isExpanded = expandedCategories[catKey];
                    return (
                      <Card key={catKey} className="overflow-hidden">
                        <CardContent className="p-0">
                          <button
                            onClick={() => setExpandedCategories(prev => ({ ...prev, [catKey]: !prev[catKey] }))}
                            className="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                            data-testid={`button-toggle-category-${catKey}`}
                          >
                            <div className="flex items-center gap-2">
                              <CatIcon className={cn("w-4 h-4", catConfig.color)} />
                              <span className="font-medium text-sm">{catConfig.label}</span>
                              <Badge variant="secondary" className="text-[10px] h-5">{catDocs.length}</Badge>
                            </div>
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                          </button>
                          {isExpanded && (
                            <div className="px-4 pb-4 space-y-2">
                              {catDocs.map((doc: any) => {
                                const statusConf = STATUS_CONFIG[doc.status] || STATUS_CONFIG.pendente;
                                const isUploading = uploadMutation.isPending && uploadingDocId === doc.id;
                                return (
                                  <div key={doc.id} className="flex items-center justify-between p-3 rounded-lg border bg-white dark:bg-slate-800" data-testid={`portal-doc-${doc.id}`}>
                                    <div className="flex-1 min-w-0 mr-3">
                                      <p className="text-sm font-medium truncate">{doc.nomeDocumento || doc.tipoDocumento}</p>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <Badge variant={statusConf.variant} className="text-[10px]">{statusConf.label}</Badge>
                                        {doc.obrigatorio && <span className="text-[10px] text-red-500">Obrigatório</span>}
                                      </div>
                                      {doc.status === "rejeitado" && doc.observacao && (
                                        <p className="text-[10px] text-red-500 mt-1">{doc.observacao}</p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      {doc.driveFileUrl && (
                                        <Button variant="ghost" size="sm" asChild>
                                          <a href={doc.driveFileUrl} target="_blank" rel="noreferrer" data-testid={`button-view-doc-${doc.id}`}>
                                            <Eye className="w-4 h-4" />
                                          </a>
                                        </Button>
                                      )}
                                      {(doc.status === "pendente" || doc.status === "rejeitado") && (
                                        <Button size="sm" variant="outline" onClick={() => handleFileSelect(doc.id)} disabled={isUploading} className="text-xs" data-testid={`button-upload-doc-${doc.id}`}>
                                          {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Upload className="w-3.5 h-3.5 mr-1" />Enviar</>}
                                        </Button>
                                      )}
                                      {doc.status === "aprovado" && <Check className="w-4 h-4 text-green-500" />}
                                      {doc.status === "enviado" && <Badge variant="secondary" className="text-[10px]">Enviado</Badge>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-3">
          {currentStep > 1 && (
            <Button variant="outline" onClick={goPrev} className="flex-1" disabled={saveMutation.isPending} data-testid="button-prev-step">
              <ChevronLeft className="w-4 h-4 mr-1" /> Anterior
            </Button>
          )}
          {currentStep < 6 && (
            <Button onClick={goNext} className="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-900" disabled={saveMutation.isPending} data-testid="button-next-step">
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Próximo <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}
          {currentStep === 6 && !isReadOnly && (
            <Button
              onClick={() => finalizarMutation.mutate()}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              disabled={finalizarMutation.isPending}
              data-testid="button-finalizar"
            >
              {finalizarMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
              Finalizar e Enviar
            </Button>
          )}
        </div>
      </main>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
        data-testid="input-file-upload"
      />

      {previewUrl && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl max-w-md w-full overflow-hidden">
            <div className="p-3 border-b flex items-center justify-between">
              <span className="text-sm font-medium">Confirmar Envio</span>
              <Button variant="ghost" size="sm" onClick={cancelPreview}><X className="w-4 h-4" /></Button>
            </div>
            <div className="p-4">
              <img src={previewUrl} alt="Preview" className="w-full rounded-lg max-h-[50vh] object-contain" data-testid="img-upload-preview" />
            </div>
            <div className="p-3 border-t flex gap-2">
              <Button variant="outline" onClick={cancelPreview} className="flex-1" data-testid="button-cancel-upload">
                <X className="w-4 h-4 mr-1" /> Cancelar
              </Button>
              <Button onClick={confirmUpload} disabled={uploadMutation.isPending} className="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-900" data-testid="button-confirm-upload">
                {uploadMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                Enviar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-600 dark:text-slate-400">{label}</Label>
      {children}
    </div>
  );
}
