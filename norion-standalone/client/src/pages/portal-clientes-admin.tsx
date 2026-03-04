import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  ClipboardList, Users, Search, CheckCircle2, AlertTriangle,
  ExternalLink, ChevronDown, ChevronUp, FileText, User,
  MapPin, Briefcase, DollarSign, Home, Copy, Link as LinkIcon,
  UserPlus, Loader2, Send, Clock, Phone, Mail, Building2,
  Target, ArrowRight, Percent, Zap,
} from "lucide-react";

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  rascunho: { label: "Rascunho", color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  enviado: { label: "Enviado", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  em_revisao: { label: "Em Revisão", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  aprovado: { label: "Aprovado", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
};

export default function PortalClientesAdminPage() {
  const [activeTab, setActiveTab] = useState<"enviar" | "formularios">("enviar");

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto" data-testid="page-portal-clientes-admin">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
          <Users className="w-5 h-5 text-amber-500" />
        </div>
        <div>
          <h1 className="text-xl font-bold" data-testid="text-portal-admin-title">Portal do Cliente</h1>
          <p className="text-sm text-muted-foreground">Gerencie acessos e formulários dos clientes</p>
        </div>
      </div>

      <div className="flex gap-1 border-b">
        <button
          onClick={() => setActiveTab("enviar")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
            activeTab === "enviar"
              ? "border-amber-500 text-amber-600"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
          data-testid="tab-enviar-acesso"
        >
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4" />
            Enviar Acesso
          </div>
        </button>
        <button
          onClick={() => setActiveTab("formularios")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
            activeTab === "formularios"
              ? "border-amber-500 text-amber-600"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
          data-testid="tab-formularios"
        >
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4" />
            Formulários
          </div>
        </button>
      </div>

      {activeTab === "enviar" ? <EnviarAcessoTab /> : <FormulariosTab />}
    </div>
  );
}

function EnviarAcessoTab() {
  const { toast } = useToast();
  const [taxId, setTaxId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [generatedTaxId, setGeneratedTaxId] = useState<string | null>(null);

  const { data: clientes = [], isLoading: loadingClientes } = useQuery({
    queryKey: ["/api/norion/clientes-portal"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/norion/clientes-portal");
      return res.json();
    },
  });

  const gerarMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/norion/gerar-acesso-avulso", {
        taxId, name, email, phone,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      const link = `${window.location.origin}${data.portalUrl}`;
      setGeneratedLink(link);
      setGeneratedTaxId(data.loginTaxId);
      toast({ title: "Acesso gerado com sucesso!" });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/clientes-portal"] });
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const formatTaxId = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 11) {
      return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, (_, a, b, c, d) =>
        d ? `${a}.${b}.${c}-${d}` : c ? `${a}.${b}.${c}` : b ? `${a}.${b}` : a
      );
    }
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})/, (_, a, b, c, d, e) =>
      e ? `${a}.${b}.${c}/${d}-${e}` : d ? `${a}.${b}.${c}/${d}` : c ? `${a}.${b}.${c}` : b ? `${a}.${b}` : a
    );
  };

  const copyLink = () => {
    if (generatedLink) {
      navigator.clipboard.writeText(generatedLink);
      toast({ title: "Link copiado!" });
    }
  };

  const copyInstructions = () => {
    const text = `Olá${name ? ` ${name}` : ""}! Seu acesso ao Portal Norion Capital foi gerado.\n\nAcesse: ${generatedLink}\nSeu CPF/CNPJ para login: ${generatedTaxId}\n\nPreencha o formulário com seus dados para dar andamento à sua operação de crédito.`;
    navigator.clipboard.writeText(text);
    toast({ title: "Mensagem copiada!" });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <UserPlus className="w-5 h-5 text-amber-500" />
            <h2 className="text-base font-semibold">Gerar Acesso para Cliente</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Cadastre o CPF ou CNPJ do cliente para gerar o acesso ao portal. O cliente poderá fazer login usando apenas o CPF/CNPJ informado.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm">CPF ou CNPJ *</Label>
              <Input
                placeholder="000.000.000-00"
                value={taxId}
                onChange={(e) => setTaxId(formatTaxId(e.target.value))}
                maxLength={18}
                data-testid="input-gerar-taxid"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Nome do cliente</Label>
              <Input
                placeholder="Nome completo"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="input-gerar-nome"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">E-mail</Label>
              <Input
                type="email"
                placeholder="cliente@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-gerar-email"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Telefone</Label>
              <Input
                placeholder="(00) 00000-0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                data-testid="input-gerar-phone"
              />
            </div>
          </div>

          <Button
            onClick={() => gerarMutation.mutate()}
            disabled={!taxId.replace(/\D/g, "").length || gerarMutation.isPending}
            className="w-full sm:w-auto"
            data-testid="button-gerar-acesso"
          >
            {gerarMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <UserPlus className="w-4 h-4 mr-2" />
            )}
            Gerar Acesso
          </Button>

          {generatedLink && (
            <div className="space-y-3 p-4 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <span className="text-sm font-medium text-green-700 dark:text-green-400">Acesso gerado com sucesso!</span>
              </div>

              <div className="space-y-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Link do portal:</p>
                  <div className="flex items-center gap-2">
                    <Input value={generatedLink} readOnly className="text-xs font-mono flex-1" data-testid="input-generated-link" />
                    <Button variant="outline" size="sm" onClick={copyLink} data-testid="button-copy-generated-link">
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">CPF/CNPJ para login:</p>
                  <p className="text-sm font-mono font-medium" data-testid="text-generated-taxid">{generatedTaxId}</p>
                </div>
              </div>

              <Button variant="outline" size="sm" onClick={copyInstructions} className="text-xs" data-testid="button-copy-instructions">
                <Copy className="w-3.5 h-3.5 mr-1.5" />
                Copiar mensagem para enviar ao cliente
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Clientes Cadastrados ({(clientes as any[]).length})</h3>
        </div>

        {loadingClientes ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (clientes as any[]).length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Users className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Nenhum cliente cadastrado ainda</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {(clientes as any[]).map((c: any) => (
              <Card key={c.id} className="overflow-hidden" data-testid={`card-cliente-${c.id}`}>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate" data-testid={`text-nome-cliente-${c.id}`}>
                        {c.name || "Sem nome"}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{c.taxId}</span>
                        {c.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="w-3 h-3" /> {c.email}
                          </span>
                        )}
                        {c.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" /> {c.phone}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {c.tokenExpiresAt && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(c.tokenExpiresAt) > new Date() ? "Ativo" : "Expirado"}
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FormulariosTab() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("todos");

  const { data: formularios = [], isLoading } = useQuery({
    queryKey: ["/api/norion/formularios-pendentes"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/norion/formularios-pendentes");
      return res.json();
    },
  });

  const filtered = (formularios as any[]).filter((f: any) => {
    if (statusFilter !== "todos" && f.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const match =
        f.nomeCompleto?.toLowerCase().includes(q) ||
        f.cpf?.includes(q) ||
        f.email?.toLowerCase().includes(q) ||
        f.clientUser?.name?.toLowerCase().includes(q) ||
        f.clientUser?.taxId?.includes(q);
      if (!match) return false;
    }
    return true;
  });

  const counts = {
    todos: (formularios as any[]).length,
    enviado: (formularios as any[]).filter((f: any) => f.status === "enviado").length,
    em_revisao: (formularios as any[]).filter((f: any) => f.status === "em_revisao").length,
    aprovado: (formularios as any[]).filter((f: any) => f.status === "aprovado").length,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, CPF, e-mail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-formularios"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {[
            { key: "todos", label: "Todos" },
            { key: "enviado", label: "Enviados" },
            { key: "em_revisao", label: "Em Revisão" },
            { key: "aprovado", label: "Aprovados" },
          ].map((s) => (
            <Button
              key={s.key}
              variant={statusFilter === s.key ? "default" : "outline"}
              size="sm"
              className={cn("text-xs", statusFilter === s.key && "bg-amber-500 hover:bg-amber-600 text-white")}
              onClick={() => setStatusFilter(s.key)}
              data-testid={`button-filter-${s.key}`}
            >
              {s.label} ({counts[s.key as keyof typeof counts] || 0})
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ClipboardList className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Nenhum formulário encontrado</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filtered.map((f: any) => (
            <FormularioCard key={f.id} formulario={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function FormularioCard({ formulario }: { formulario: any }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [showRevisao, setShowRevisao] = useState(false);
  const [observacao, setObservacao] = useState("");
  const [operationResult, setOperationResult] = useState<any>(null);
  const st = STATUS_MAP[formulario.status] || STATUS_MAP.rascunho;

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

  const criarOperacaoMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/norion/formulario/${formulario.id}/criar-operacao`);
      return res.json();
    },
    onSuccess: (data: any) => {
      setOperationResult(data);
      toast({ title: "Operação criada com sucesso!", description: `${data.matching?.length || 0} fundo(s) compatível(is) encontrado(s)` });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/formularios-pendentes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/operations"] });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao criar operação", description: err.message, variant: "destructive" });
    },
  });

  const enviarFundoMutation = useMutation({
    mutationFn: async ({ operationId, fundoParceiroId }: { operationId: number; fundoParceiroId: number }) => {
      const res = await apiRequest("POST", `/api/norion/operations/${operationId}/envios`, { fundoParceiroId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Enviado ao fundo com sucesso!" });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/operations"] });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao enviar", description: err.message, variant: "destructive" });
    },
  });

  const sections = [
    {
      icon: User, title: "Dados Pessoais",
      fields: [
        { label: "Nome", value: formulario.nomeCompleto },
        { label: "CPF", value: formulario.cpf },
        { label: "RG", value: formulario.rg },
        { label: "Data Nascimento", value: formulario.dataNascimento },
        { label: "Estado Civil", value: formulario.estadoCivil },
        { label: "Naturalidade", value: formulario.naturalidade },
        { label: "Nome da Mãe", value: formulario.nomeMae },
        { label: "E-mail", value: formulario.email },
        { label: "Telefone", value: formulario.telefone },
        { label: "Celular", value: formulario.celular },
      ],
    },
    {
      icon: MapPin, title: "Endereço",
      fields: [
        { label: "CEP", value: formulario.cep },
        { label: "Logradouro", value: formulario.logradouro },
        { label: "Número", value: formulario.numero },
        { label: "Complemento", value: formulario.complemento },
        { label: "Bairro", value: formulario.bairro },
        { label: "Cidade", value: formulario.cidade },
        { label: "UF", value: formulario.uf },
      ],
    },
    {
      icon: Briefcase, title: "Profissional",
      fields: [
        { label: "Profissão", value: formulario.profissao },
        { label: "Empresa", value: formulario.empresaTrabalho },
        { label: "CNPJ Empresa", value: formulario.cnpjEmpresa },
        { label: "Renda Mensal", value: formulario.rendaMensal ? `R$ ${Number(formulario.rendaMensal).toLocaleString("pt-BR")}` : null },
        { label: "Tempo de Emprego", value: formulario.tempoEmprego },
        { label: "Outras Rendas", value: formulario.outrasRendas ? `R$ ${Number(formulario.outrasRendas).toLocaleString("pt-BR")}` : null },
      ],
    },
    {
      icon: DollarSign, title: "Crédito",
      fields: [
        { label: "Valor Solicitado", value: formulario.valorSolicitado ? `R$ ${Number(formulario.valorSolicitado).toLocaleString("pt-BR")}` : null },
        { label: "Finalidade", value: formulario.finalidadeCredito },
        { label: "Prazo Desejado", value: formulario.prazoDesejado },
        { label: "Tipo Garantia", value: formulario.tipoGarantia },
        { label: "Descrição Garantia", value: formulario.descricaoGarantia },
        { label: "Valor Garantia", value: formulario.valorGarantia ? `R$ ${Number(formulario.valorGarantia).toLocaleString("pt-BR")}` : null },
      ],
    },
    {
      icon: Home, title: "Patrimônio",
      fields: [
        { label: "Possui Imóvel", value: formulario.possuiImovel ? "Sim" : formulario.possuiImovel === false ? "Não" : null },
        { label: "Valor Imóvel", value: formulario.valorImovel ? `R$ ${Number(formulario.valorImovel).toLocaleString("pt-BR")}` : null },
        { label: "Possui Veículo", value: formulario.possuiVeiculo ? "Sim" : formulario.possuiVeiculo === false ? "Não" : null },
        { label: "Valor Veículo", value: formulario.valorVeiculo ? `R$ ${Number(formulario.valorVeiculo).toLocaleString("pt-BR")}` : null },
        { label: "Outros Patrimônios", value: formulario.outrosPatrimonios },
      ],
    },
  ];

  return (
    <Card className="overflow-hidden" data-testid={`card-formulario-${formulario.id}`}>
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid={`button-expand-formulario-${formulario.id}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
            <User className="w-4 h-4 text-amber-600" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-sm truncate" data-testid={`text-nome-formulario-${formulario.id}`}>
              {formulario.nomeCompleto || formulario.clientUser?.name || "Cliente sem nome"}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {formulario.cpf || formulario.clientUser?.taxId} · {formulario.email || ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge className={cn("text-xs", st.color)} data-testid={`badge-status-formulario-${formulario.id}`}>{st.label}</Badge>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <CardContent className="pt-0 pb-4 space-y-4">
          <Separator />

          {formulario.observacaoRevisao && formulario.status === "em_revisao" && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Revisão solicitada:</p>
              <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">{formulario.observacaoRevisao}</p>
            </div>
          )}

          <div className="space-y-4">
            {sections.map((section) => {
              const filledFields = section.fields.filter((f) => f.value);
              if (filledFields.length === 0) return null;
              const SectionIcon = section.icon;
              return (
                <div key={section.title}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <SectionIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{section.title}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                    {filledFields.map((f) => (
                      <div key={f.label}>
                        <p className="text-[10px] text-muted-foreground">{f.label}</p>
                        <p className="text-xs font-medium">{f.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {formulario.documentos && formulario.documentos.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Documentos ({formulario.documentos.length})</span>
              </div>
              <div className="space-y-1">
                {formulario.documentos.map((doc: any) => (
                  <div key={doc.id} className="flex items-center justify-between gap-2 p-2 rounded border text-xs">
                    <span className="truncate">{doc.nomeDocumento || doc.tipoDocumento}</span>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={doc.status === "aprovado" ? "default" : doc.status === "rejeitado" ? "destructive" : "secondary"} className="text-[9px] h-4">{doc.status}</Badge>
                      {doc.driveFileUrl && (
                        <a href={doc.driveFileUrl} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-700" data-testid={`link-doc-${doc.id}`}>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(formulario.status === "enviado" || formulario.status === "em_revisao") && (
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="text-xs bg-green-600 hover:bg-green-700 text-white"
                onClick={() => aprovarMutation.mutate()}
                disabled={aprovarMutation.isPending}
                data-testid={`button-aprovar-${formulario.id}`}
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Aprovar
              </Button>
              {formulario.status !== "em_revisao" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs text-amber-600 border-amber-300"
                  onClick={() => setShowRevisao(!showRevisao)}
                  data-testid={`button-revisao-${formulario.id}`}
                >
                  <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Pedir Revisão
                </Button>
              )}
            </div>
          )}

          {formulario.status === "aprovado" && !formulario.operationId && !operationResult && (
            <div className="pt-1">
              <Button
                size="sm"
                className="text-xs bg-amber-600 hover:bg-amber-700 text-white"
                onClick={() => criarOperacaoMutation.mutate()}
                disabled={criarOperacaoMutation.isPending}
                data-testid={`button-criar-operacao-${formulario.id}`}
              >
                {criarOperacaoMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5 mr-1" />
                )}
                Criar Operação e Buscar Fundos
              </Button>
            </div>
          )}

          {formulario.status === "aprovado" && formulario.operationId && !operationResult && (
            <div className="p-3 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <span className="text-xs font-medium text-green-700 dark:text-green-400">
                  Operação #{formulario.operationId} vinculada
                </span>
                <a href={`/operacoes`} className="text-xs text-blue-500 hover:underline flex items-center gap-1 ml-auto" data-testid={`link-operacao-${formulario.id}`}>
                  Ver na tabela <ArrowRight className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}

          {operationResult && (
            <div className="space-y-3 p-4 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800" data-testid={`result-operacao-${formulario.id}`}>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <span className="text-sm font-medium text-green-700 dark:text-green-400">
                  Operação #{operationResult.operation?.id} criada
                </span>
                <a href={`/operacoes`} className="text-xs text-blue-500 hover:underline flex items-center gap-1 ml-auto" data-testid={`link-ver-operacao-${formulario.id}`}>
                  Ver na tabela <ArrowRight className="w-3 h-3" />
                </a>
              </div>

              {operationResult.matching && operationResult.matching.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Target className="w-3.5 h-3.5 text-amber-600" />
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
                      Fundos Compatíveis ({operationResult.matching.length})
                    </span>
                  </div>
                  <div className="space-y-2">
                    {operationResult.matching.map((m: any) => (
                      <div key={m.fundo.id} className="flex items-center justify-between gap-2 p-2.5 rounded border bg-white dark:bg-slate-900 text-xs" data-testid={`match-fundo-${m.fundo.id}`}>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium truncate">{m.fundo.nome}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{m.reasons.join(" · ")}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge className={cn(
                            "text-[10px] font-bold",
                            m.score >= 70 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                            m.score >= 40 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                            "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          )}>
                            <Percent className="w-2.5 h-2.5 mr-0.5" />{m.score}
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-[10px] h-6 px-2"
                            onClick={() => enviarFundoMutation.mutate({ operationId: operationResult.operation.id, fundoParceiroId: m.fundo.id })}
                            disabled={enviarFundoMutation.isPending}
                            data-testid={`button-enviar-fundo-${m.fundo.id}`}
                          >
                            <Send className="w-3 h-3 mr-1" /> Enviar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(!operationResult.matching || operationResult.matching.length === 0) && (
                <p className="text-xs text-muted-foreground">Nenhum fundo compatível encontrado. Cadastre fundos parceiros para habilitar o matching.</p>
              )}
            </div>
          )}

          {showRevisao && (
            <div className="space-y-2 p-3 border rounded-lg bg-amber-50 dark:bg-amber-950/20">
              <Label className="text-xs">Motivo da revisão</Label>
              <Textarea
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Descreva o que precisa ser corrigido..."
                rows={2}
                className="text-xs"
                data-testid={`input-observacao-${formulario.id}`}
              />
              <Button
                size="sm"
                className="text-xs"
                onClick={() => revisarMutation.mutate()}
                disabled={!observacao.trim() || revisarMutation.isPending}
                data-testid={`button-enviar-revisao-${formulario.id}`}
              >
                Enviar Solicitação de Revisão
              </Button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
