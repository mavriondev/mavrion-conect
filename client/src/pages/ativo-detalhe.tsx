import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, MapPin, DollarSign, Ruler, Building2, FileText,
  Pencil, Trash2, Loader2, CheckCircle2, AlertCircle, Clock,
  TreePine, Pickaxe, Briefcase, Home, Wheat, Factory, Link2,
  Tag, MessageSquare, Zap, Search, Leaf, Thermometer, Droplets,
  FlaskConical, RefreshCw,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AtivoFormDialog } from "./ativos";

const TIPO_CONFIG: Record<string, { label: string; icon: any; color: string; badge: string }> = {
  TERRA:           { label: "Terra / Fazenda",       icon: TreePine,  color: "text-green-600",  badge: "bg-green-100 text-green-800" },
  MINA:            { label: "Mineração",              icon: Pickaxe,   color: "text-orange-600", badge: "bg-orange-100 text-orange-800" },
  NEGOCIO:         { label: "Negócio / M&A",          icon: Briefcase, color: "text-blue-600",   badge: "bg-blue-100 text-blue-800" },
  FII_CRI:         { label: "FII / CRI / Imóvel",    icon: Home,      color: "text-purple-600", badge: "bg-purple-100 text-purple-800" },
  DESENVOLVIMENTO: { label: "Desenvolvimento Imob.", icon: Factory,   color: "text-pink-600",   badge: "bg-pink-100 text-pink-800" },
  AGRO:            { label: "Agronegócio",            icon: Wheat,     color: "text-yellow-600", badge: "bg-yellow-100 text-yellow-800" },
};

const DOCS_STATUS: Record<string, { label: string; icon: any; color: string }> = {
  completo: { label: "Documentação completa", icon: CheckCircle2, color: "text-green-600" },
  parcial:  { label: "Documentação parcial",  icon: AlertCircle,  color: "text-amber-600" },
  pendente: { label: "Documentação pendente", icon: Clock,        color: "text-red-500" },
};

function InfoRow({ label, value, className }: { label: string; value?: string | null; className?: string }) {
  if (!value) return null;
  return (
    <div className={cn("space-y-0.5", className)}>
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function ChecklistSection({ title, items, savedChecks, ativoId, checkKey, camposEspecificos }: {
  title: string;
  items: Array<{ item: string; obrigatorio: boolean }>;
  savedChecks: Record<string, boolean>;
  ativoId: number;
  checkKey: string;
  camposEspecificos: any;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [localChecks, setLocalChecks] = useState<Record<string, boolean>>(savedChecks);

  const toggleItem = async (item: string) => {
    const newChecks = { ...localChecks, [item]: !localChecks[item] };
    setLocalChecks(newChecks);
    try {
      await apiRequest("PATCH", `/api/matching/assets/${ativoId}`, {
        camposEspecificos: {
          ...camposEspecificos,
          [checkKey]: newChecks,
        },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/matching/assets", String(ativoId)] });
    } catch {
      toast({ title: "Erro ao salvar checklist", variant: "destructive" });
      setLocalChecks(localChecks);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
      {items.map(({ item }) => (
        <div
          key={item}
          className="flex items-center gap-3 p-2.5 rounded-lg border hover:border-primary/30 cursor-pointer transition-colors"
          onClick={() => toggleItem(item)}
          data-testid={`checklist-item-${item.slice(0, 20).replace(/\s/g, '-')}`}
        >
          <div className={cn(
            "w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
            localChecks[item]
              ? "bg-green-500 border-green-500"
              : "border-muted-foreground/40"
          )}>
            {localChecks[item] && <CheckCircle2 className="w-3 h-3 text-white" />}
          </div>
          <span className={cn(
            "text-sm flex-1",
            localChecks[item] ? "line-through text-muted-foreground" : ""
          )}>
            {item}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function AtivoDetalhePage({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const { data: ativoData, isLoading, error } = useQuery({
    queryKey: ["/api/matching/assets", id],
    queryFn: () => apiRequest("GET", `/api/matching/assets/${id}`).then(r => {
      if (!r.ok) throw new Error("not found");
      return r.json();
    }),
  });

  const ativo = ativoData;
  const linkedDeals = (ativoData?.linkedDeals || []) as any[];
  const emNegociacao = ativoData?.emNegociacao || false;

  const [buscandoCompradores, setBuscandoCompradores] = useState(false);
  const [compradores, setCompradores] = useState<any[]>([]);
  const [totalEncontrados, setTotalEncontrados] = useState<number | null>(null);
  const [buscaRealizada, setBuscaRealizada] = useState(false);

  const [enriquecendo, setEnriquecendo] = useState(false);

  const enriquecerMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/matching/assets/${id}/enriquecer-embrapa`, {}).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/matching/assets", id] });
      toast({ title: "✅ Dados Embrapa carregados!", description: "Análise agronômica atualizada." });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao buscar dados Embrapa", description: err.message, variant: "destructive" });
    },
    onSettled: () => setEnriquecendo(false),
  });

  const handleDelete = async () => {
    await apiRequest("DELETE", `/api/matching/assets/${id}`);
    queryClient.invalidateQueries({ queryKey: ["/api/matching/assets"] });
    toast({ title: "Ativo excluído" });
    navigate("/ativos");
  };

  const buscarCompradores = async () => {
    if (!ativo) return;
    setBuscandoCompradores(true);
    try {
      const params = new URLSearchParams({ tipo: ativo.type });
      if (ativo.estado) params.set("estado", ativo.estado);
      const campos = (ativo.camposEspecificos as any) || {};
      if (ativo.type === "MINA" && campos.substancia) params.set("substancia", campos.substancia);
      const res = await apiRequest("GET", `/api/prospeccao/reversa?${params.toString()}`);
      const data = await res.json();
      setCompradores(data.results || []);
      setTotalEncontrados(data.count ?? null);
      setBuscaRealizada(true);
    } catch {
      toast({ title: "Erro ao buscar compradores", variant: "destructive" });
    } finally {
      setBuscandoCompradores(false);
    }
  };

  const importarComprador = async (comprador: any) => {
    try {
      await apiRequest("POST", "/api/prospeccao/import", { cnpjs: [comprador.taxId] });
      toast({ title: "Empresa importada", description: `${comprador.tradeName || comprador.legalName} adicionada ao CRM` });
      setCompradores(prev => prev.map(c => c.taxId === comprador.taxId ? { ...c, alreadySaved: true } : c));
    } catch {
      toast({ title: "Erro ao importar empresa", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !ativo) {
    return (
      <div className="p-6 text-center space-y-3 pt-20">
        <AlertCircle className="w-10 h-10 text-destructive mx-auto" />
        <p className="font-medium">Ativo não encontrado</p>
        <Button variant="outline" onClick={() => navigate("/ativos")}>
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Voltar
        </Button>
      </div>
    );
  }

  const tipo = TIPO_CONFIG[ativo.type] || TIPO_CONFIG.TERRA;
  const TipoIcon = tipo.icon;
  const docsStatus = ativo.docsStatus ? DOCS_STATUS[ativo.docsStatus] : null;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4 md:space-y-6">
      {/* Back + actions */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => navigate("/ativos")} className="gap-1.5">
          <ArrowLeft className="w-4 h-4" /> Portfólio de Ativos
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline" size="sm"
            onClick={() => setEditOpen(true)}
            data-testid="button-editar-ativo"
          >
            <Pencil className="w-4 h-4 mr-1.5" /> Editar
          </Button>
          <Button
            variant="outline" size="sm"
            className="text-destructive border-destructive/30 hover:bg-destructive/5"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="w-4 h-4 mr-1.5" /> Excluir
          </Button>
        </div>
      </div>

      {/* Hero header */}
      <Card className="overflow-hidden">
        <div className="h-1.5 w-full bg-gradient-to-r from-primary to-primary/50" />
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 bg-muted", tipo.color)}>
              <TipoIcon className="w-7 h-7" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <h1 className="text-xl md:text-2xl font-bold leading-tight">{ativo.title}</h1>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <Badge variant="outline" className={cn("border-0 font-medium", tipo.badge)}>
                      {tipo.label}
                    </Badge>
                    {docsStatus && (
                      <span className={cn("flex items-center gap-1 text-xs font-medium", docsStatus.color)}>
                        <docsStatus.icon className="w-3.5 h-3.5" />
                        {docsStatus.label}
                      </span>
                    )}
                    {emNegociacao && (
                      <Badge className="bg-blue-600 text-white text-xs gap-1 animate-pulse" data-testid="badge-em-negociacao">
                        <Zap className="w-3 h-3" />
                        Em negociação
                      </Badge>
                    )}
                  </div>
                </div>
                {ativo.priceAsking && (
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">Preço pedido</p>
                    <p className="text-xl font-bold text-emerald-600">
                      {ativo.priceAsking >= 1_000_000
                        ? `R$ ${(ativo.priceAsking / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`
                        : `R$ ${(ativo.priceAsking / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}k`}
                    </p>
                  </div>
                )}
              </div>

              {ativo.description && (
                <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{ativo.description}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="info">
        <div className="overflow-x-auto pb-0.5">
          <TabsList className="w-max min-w-full">
            <TabsTrigger value="info">Informações</TabsTrigger>
            <TabsTrigger value="docs">Documentação</TabsTrigger>
            {linkedDeals.length > 0 && (
              <TabsTrigger value="negociacoes" data-testid="tab-negociacoes">
                Negociações ({linkedDeals.length})
              </TabsTrigger>
            )}
            <TabsTrigger value="compradores" data-testid="tab-compradores">Compradores</TabsTrigger>
            {(ativo.type === "TERRA" || ativo.type === "AGRO") && (
              <TabsTrigger value="agro" className="gap-1.5" data-testid="tab-agro">
                <Leaf className="w-3.5 h-3.5" /> Análise Agro
                {(ativo.camposEspecificos as any)?.embrapa && (
                  <span className="w-2 h-2 rounded-full bg-green-500 inline-block ml-0.5" />
                )}
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        {/* ── Info Tab ── */}
        <TabsContent value="info" className="space-y-4 mt-4">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Localização */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-muted-foreground" /> Localização
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="Estado" value={ativo.estado} />
                <InfoRow label="Município" value={ativo.municipio} />
                <InfoRow label="Região / Localização" value={ativo.location} />
              </CardContent>
            </Card>

            {/* Dimensões */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Ruler className="w-4 h-4 text-muted-foreground" /> Dimensões & Valor
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <InfoRow
                  label="Área Total"
                  value={ativo.areaHa ? `${Number(ativo.areaHa).toLocaleString("pt-BR")} ha` : undefined}
                />
                <InfoRow
                  label="Área Útil"
                  value={ativo.areaUtil ? `${Number(ativo.areaUtil).toLocaleString("pt-BR")} ha` : undefined}
                />
                <InfoRow
                  label="Preço pedido"
                  value={ativo.priceAsking
                    ? `R$ ${Number(ativo.priceAsking).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                    : undefined}
                />
                {ativo.areaHa && ativo.priceAsking && (
                  <InfoRow
                    label="Preço por hectare"
                    value={`R$ ${(ativo.priceAsking / ativo.areaHa).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}/ha`}
                  />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Empresa vinculada */}
          {ativo.linkedCompanyId && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" /> Empresa vinculada (Cedente / Proprietário)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Link
                  href={`/empresas/${ativo.linkedCompanyId}`}
                  className="flex items-center gap-2 text-primary hover:underline text-sm font-medium"
                >
                  <Building2 className="w-4 h-4" />
                  {ativo.linkedCompany?.tradeName || ativo.linkedCompany?.legalName || `Empresa #${ativo.linkedCompanyId}`}
                  <Link2 className="w-3.5 h-3.5 opacity-50" />
                </Link>
                {ativo.linkedCompany?.cnpj && (
                  <p className="text-xs text-muted-foreground mt-1 font-mono">CNPJ: {ativo.linkedCompany.cnpj}</p>
                )}
              </CardContent>
            </Card>
          )}

          {((ativo.camposEspecificos as any)?.origemAtivo === "oferta_recebida" ||
            (ativo.camposEspecificos as any)?.origemAtivo === "indicacao") && (
            <Card className="border-amber-200 dark:border-amber-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-amber-600" />
                  {(ativo.camposEspecificos as any)?.origemAtivo === "oferta_recebida" ? "Ofertante — proprietário do ativo" : "Indicação"}
                  <Badge variant="outline" className="text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700 ml-auto">
                    Oferta recebida
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="Nome" value={(ativo.camposEspecificos as any)?.ofertanteNome} />
                <InfoRow label="Telefone" value={(ativo.camposEspecificos as any)?.ofertanteTelefone} />
                <InfoRow label="E-mail" value={(ativo.camposEspecificos as any)?.ofertanteEmail} />
                <InfoRow label="Observações" value={(ativo.camposEspecificos as any)?.ofertanteObservacoes} />
              </CardContent>
            </Card>
          )}

          {/* Observações */}
          {ativo.observacoes && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-muted-foreground" /> Observações internas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{ativo.observacoes}</p>
              </CardContent>
            </Card>
          )}

          <div className="text-xs text-muted-foreground">
            Cadastrado em {ativo.createdAt ? format(new Date(ativo.createdAt), "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : "—"}
          </div>
        </TabsContent>

        {/* ── Documentação Tab ── */}
        <TabsContent value="docs" className="mt-4 space-y-4">

          {/* Status geral */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" /> Status da Documentação
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {docsStatus ? (
                  <>
                    <docsStatus.icon className={cn("w-5 h-5", docsStatus.color)} />
                    <span className={cn("font-medium text-sm", docsStatus.color)}>{docsStatus.label}</span>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">Status não informado</span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Checklist por tipo */}
          {(() => {
            const CHECKLIST: Record<string, Array<{ item: string; obrigatorio: boolean }>> = {
              TERRA: [
                { item: "Matrícula atualizada do imóvel (30 dias)", obrigatorio: true },
                { item: "CAR — Cadastro Ambiental Rural", obrigatorio: true },
                { item: "CCIR — Certificado de Cadastro de Imóvel Rural", obrigatorio: true },
                { item: "ITR — Imposto Territorial Rural (últimos 5 anos)", obrigatorio: true },
                { item: "Georreferenciamento / SIGEF", obrigatorio: false },
                { item: "Certidão negativa de débitos municipais", obrigatorio: false },
                { item: "Laudo de avaliação", obrigatorio: false },
                { item: "Planta do imóvel", obrigatorio: false },
              ],
              MINA: [
                { item: "Processo ANM — Portaria de lavra ou concessão", obrigatorio: true },
                { item: "Licença Ambiental (LP, LI ou LO)", obrigatorio: true },
                { item: "Relatório Anual de Lavra (RAL)", obrigatorio: true },
                { item: "Plano de Aproveitamento Econômico (PAE)", obrigatorio: false },
                { item: "Laudo de reserva geológica", obrigatorio: false },
                { item: "Certidão de regularidade ANM", obrigatorio: false },
                { item: "Matrícula do terreno", obrigatorio: false },
              ],
              NEGOCIO: [
                { item: "Contrato Social e últimas alterações", obrigatorio: true },
                { item: "Balanços dos últimos 3 anos", obrigatorio: true },
                { item: "DRE — Demonstrativo de Resultado", obrigatorio: true },
                { item: "Certidão negativa de débitos federais", obrigatorio: true },
                { item: "Certidão negativa trabalhista", obrigatorio: true },
                { item: "Relação de contratos vigentes", obrigatorio: false },
                { item: "Relação de ativos imobilizados", obrigatorio: false },
                { item: "NDA / Acordo de Confidencialidade", obrigatorio: false },
              ],
              AGRO: [
                { item: "CAR — Cadastro Ambiental Rural", obrigatorio: true },
                { item: "CCIR do imóvel", obrigatorio: true },
                { item: "Contrato de arrendamento (se houver)", obrigatorio: false },
                { item: "Laudos de solo e produtividade", obrigatorio: false },
                { item: "Certificações (Orgânico, Rainforest etc.)", obrigatorio: false },
              ],
              FII_CRI: [
                { item: "Regulamento do fundo atualizado", obrigatorio: true },
                { item: "Registro CVM", obrigatorio: true },
                { item: "Último relatório gerencial", obrigatorio: true },
                { item: "Demonstrações financeiras auditadas", obrigatorio: true },
                { item: "Escritura de emissão (CRI)", obrigatorio: false },
              ],
              DESENVOLVIMENTO: [
                { item: "Matrícula do terreno", obrigatorio: true },
                { item: "Alvará de construção", obrigatorio: true },
                { item: "Licença ambiental", obrigatorio: true },
                { item: "Projeto arquitetônico aprovado", obrigatorio: false },
                { item: "Memorial de incorporação", obrigatorio: false },
                { item: "Estudo de viabilidade (VGV)", obrigatorio: false },
              ],
            };

            const checklist = CHECKLIST[ativo.type] || [];
            if (checklist.length === 0) return null;

            const camposEsp = (ativo.camposEspecificos as any) || {};
            const checkKey = `checklist_${ativo.type}`;
            const savedChecks: Record<string, boolean> = camposEsp[checkKey] || {};

            const obrigatorios = checklist.filter(c => c.obrigatorio);
            const opcionais = checklist.filter(c => !c.obrigatorio);
            const totalObrig = obrigatorios.length;
            const marcadosObrig = obrigatorios.filter(c => savedChecks[c.item]).length;
            const pct = totalObrig > 0 ? Math.round((marcadosObrig / totalObrig) * 100) : 0;

            return (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                      Checklist de Due Diligence
                    </CardTitle>
                    <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full",
                      pct === 100 ? "bg-green-100 text-green-700" :
                      pct >= 50 ? "bg-amber-100 text-amber-700" :
                      "bg-red-100 text-red-700"
                    )} data-testid="checklist-progress">
                      {marcadosObrig}/{totalObrig} obrigatórios
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full mt-2">
                    <div
                      className={cn("h-full rounded-full transition-all",
                        pct === 100 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500"
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ChecklistSection
                    title="Documentos obrigatórios"
                    items={obrigatorios}
                    savedChecks={savedChecks}
                    ativoId={ativo.id}
                    checkKey={checkKey}
                    camposEspecificos={camposEsp}
                  />
                  {opcionais.length > 0 && (
                    <ChecklistSection
                      title="Documentos complementares"
                      items={opcionais}
                      savedChecks={savedChecks}
                      ativoId={ativo.id}
                      checkKey={checkKey}
                      camposEspecificos={camposEsp}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })()}
        </TabsContent>

        {/* ── Negociações Tab ── */}
        <TabsContent value="negociacoes" className="mt-4 space-y-3">
          {linkedDeals.map((deal: any) => (
            <Card key={deal.id} className="border-blue-200 dark:border-blue-800">
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium text-sm">{deal.title}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {deal.stageName && (
                      <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                        {deal.stageName}
                      </Badge>
                    )}
                    {deal.amountEstimate && (
                      <span className="text-xs text-muted-foreground">
                        R$ {Number(deal.amountEstimate).toLocaleString("pt-BR", { minimumFractionDigits: 0 })}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground capitalize">
                      {deal.pipelineType === "INVESTOR" ? "Pipeline Investidor" : "Pipeline Ativo"}
                    </span>
                  </div>
                </div>
                <Button
                  size="sm" variant="outline" className="h-7 text-xs shrink-0 gap-1"
                  onClick={() => navigate("/crm")}
                  data-testid={`button-ver-deal-${deal.id}`}
                >
                  Ver no CRM
                </Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ── Compradores Tab (Prospecção Reversa) ── */}
        <TabsContent value="compradores" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Search className="w-4 h-4 text-muted-foreground" />
                Prospecção Reversa
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Empresas compradoras compatíveis com este ativo via CNPJA
                {ativo.estado ? ` em ${ativo.estado}` : ""}.
              </p>
            </CardHeader>
            <CardContent>
              {!buscaRealizada ? (
                <div className="text-center py-8 space-y-3">
                  <p className="text-sm text-muted-foreground">Nenhuma busca realizada ainda.</p>
                  <Button onClick={buscarCompradores} disabled={buscandoCompradores} className="gap-2" data-testid="button-buscar-compradores">
                    {buscandoCompradores
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Buscando...</>
                      : <><Search className="w-4 h-4" /> Buscar compradores compatíveis</>}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground" data-testid="text-compradores-count">
                      {totalEncontrados !== null
                        ? `${totalEncontrados.toLocaleString("pt-BR")} encontradas — exibindo ${compradores.length}`
                        : `${compradores.length} encontradas`}
                    </p>
                    <Button variant="outline" size="sm" onClick={buscarCompradores} disabled={buscandoCompradores} className="h-7 text-xs gap-1" data-testid="button-refazer-busca">
                      {buscandoCompradores ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Refazer
                    </Button>
                  </div>
                  {compradores.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">Nenhuma empresa encontrada.</p>
                  ) : (
                    compradores.map(c => (
                      <div key={c.taxId} className="flex items-start justify-between gap-3 p-3 rounded-lg border hover:border-primary/30 transition-colors" data-testid={`card-comprador-${c.taxId}`}>
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-sm truncate">{c.tradeName || c.legalName}</p>
                            {c.alreadySaved && (
                              <Badge variant="outline" className="text-xs bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-700">No CRM</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground font-mono">{c.taxId}</p>
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                            {c.cnaePrincipal && <span>{c.cnaePrincipal}</span>}
                            {(c.city || c.state) && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{[c.city, c.state].filter(Boolean).join("/")}</span>}
                            {c.porte && <span>{c.porte}</span>}
                          </div>
                        </div>
                        <div className="shrink-0">
                          {!c.alreadySaved ? (
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => importarComprador(c)} data-testid={`button-importar-${c.taxId}`}>
                              Importar
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-primary" onClick={() => navigate("/empresas")} data-testid={`button-ver-crm-${c.taxId}`}>
                              Ver no CRM
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {(ativo.type === "TERRA" || ativo.type === "AGRO") && (
          <TabsContent value="agro" className="mt-4 space-y-4">

            <Card>
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Análise Agronômica — dados Embrapa</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Zoneamento agrícola, solo, clima e vegetação com base em dados oficiais.
                  </p>
                  {(ativo.camposEspecificos as any)?.embrapa?.enriquecidoEm && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Última atualização:{" "}
                      {new Date((ativo.camposEspecificos as any).embrapa.enriquecidoEm)
                        .toLocaleDateString("pt-BR")}
                    </p>
                  )}
                </div>
                <Button
                  size="sm" variant="outline" className="gap-1.5 shrink-0"
                  disabled={enriquecendo || enriquecerMutation.isPending}
                  onClick={() => {
                    setEnriquecendo(true);
                    enriquecerMutation.mutate();
                  }}
                  data-testid="button-enriquecer-embrapa"
                >
                  {(enriquecendo || enriquecerMutation.isPending)
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando...</>
                    : <><RefreshCw className="w-3.5 h-3.5" /> Buscar dados Embrapa</>
                  }
                </Button>
              </CardContent>
            </Card>

            {(() => {
              const embrapa = (ativo.camposEspecificos as any)?.embrapa;
              if (!embrapa) return (
                <div className="text-center py-10 text-muted-foreground space-y-2">
                  <Leaf className="w-10 h-10 mx-auto opacity-20" />
                  <p className="text-sm">Nenhuma análise ainda.</p>
                  <p className="text-xs">Clique em "Buscar dados Embrapa" para analisar este ativo.</p>
                </div>
              );

              return (
                <div className="grid md:grid-cols-2 gap-4">

                  {embrapa.zoneamento && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Leaf className="w-4 h-4 text-green-600" />
                          Zoneamento Agrícola
                          {embrapa.zoneamento.fonte === "cache" && (
                            <Badge variant="outline" className="text-[10px] ml-auto">Cache</Badge>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {embrapa.zoneamento.culturas?.length > 0 ? (
                          embrapa.zoneamento.culturas.slice(0, 6).map((c: any, i: number) => (
                            <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                              <span className="text-sm font-medium capitalize">{c.nome}</span>
                              <div className="flex items-center gap-2">
                                {c.epocaPlantio && (
                                  <span className="text-xs text-muted-foreground">{c.epocaPlantio}</span>
                                )}
                                <Badge variant="outline" className={
                                  c.risco === "baixo" || c.risco === "20%"
                                    ? "text-xs bg-green-50 text-green-700 border-green-200"
                                    : c.risco === "medio" || c.risco === "30%"
                                    ? "text-xs bg-amber-50 text-amber-700 border-amber-200"
                                    : "text-xs bg-red-50 text-red-700 border-red-200"
                                }>
                                  Risco {c.risco || "—"}
                                </Badge>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Informe o código IBGE do município para consultar o zoneamento.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {embrapa.solo && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <FlaskConical className="w-4 h-4 text-amber-600" />
                          Classificação do Solo
                          {embrapa.solo.fonte === "cache" && (
                            <Badge variant="outline" className="text-[10px] ml-auto">Cache</Badge>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                          <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
                            {embrapa.solo.classificacao}
                          </p>
                          {embrapa.solo.aptidao && (
                            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                              Aptidão: {embrapa.solo.aptidao}
                            </p>
                          )}
                          {embrapa.solo.textura && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Textura: {embrapa.solo.textura}
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {embrapa.ndvi && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Leaf className="w-4 h-4 text-emerald-600" />
                          Índice de Vegetação (NDVI)
                          {embrapa.ndvi.fonte === "cache" && (
                            <Badge variant="outline" className="text-[10px] ml-auto">Cache</Badge>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-2xl font-bold text-emerald-600">
                            {embrapa.ndvi.ndvi.toFixed(2)}
                          </span>
                          <Badge className={
                            embrapa.ndvi.ndvi >= 0.6
                              ? "bg-green-100 text-green-700 border-green-200"
                              : embrapa.ndvi.ndvi >= 0.3
                              ? "bg-amber-100 text-amber-700 border-amber-200"
                              : "bg-red-100 text-red-700 border-red-200"
                          }>
                            {embrapa.ndvi.ndvi >= 0.6 ? "🌿 Saudável" :
                             embrapa.ndvi.ndvi >= 0.3 ? "⚠️ Moderado" : "🔴 Crítico"}
                          </Badge>
                        </div>
                        <Progress
                          value={embrapa.ndvi.ndvi * 100}
                          className="h-2"
                        />
                        <p className="text-xs text-muted-foreground">{embrapa.ndvi.classificacao}</p>
                      </CardContent>
                    </Card>
                  )}

                  {embrapa.clima && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Droplets className="w-4 h-4 text-blue-500" />
                          Dados Climáticos
                          {embrapa.clima.fonte === "cache" && (
                            <Badge variant="outline" className="text-[10px] ml-auto">Cache</Badge>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {embrapa.clima.precipitacaoMedia > 0 && (
                          <div className="flex items-center justify-between p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Droplets className="w-3.5 h-3.5" /> Precipitação
                            </span>
                            <span className="text-sm font-bold text-blue-700">
                              {embrapa.clima.precipitacaoMedia} mm
                            </span>
                          </div>
                        )}
                        {embrapa.clima.temperaturaMedia > 0 && (
                          <div className="flex items-center justify-between p-2 rounded-lg bg-orange-50 dark:bg-orange-900/20">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Thermometer className="w-3.5 h-3.5" /> Temperatura média
                            </span>
                            <span className="text-sm font-bold text-orange-700">
                              {embrapa.clima.temperaturaMedia}°C
                            </span>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">{embrapa.clima.indiceSeca}</p>
                      </CardContent>
                    </Card>
                  )}

                </div>
              );
            })()}

            {!(ativo.camposEspecificos as any)?.latitude && (
              <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-900/10">
                <CardContent className="p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-800 dark:text-amber-300 space-y-1">
                    <p className="font-medium">Para análise completa, adicione as coordenadas do ativo.</p>
                    <p>Edite o ativo e preencha os campos Latitude, Longitude e Código IBGE do município
                    para obter dados de solo, clima e vegetação via Embrapa.</p>
                  </div>
                </CardContent>
              </Card>
            )}

          </TabsContent>
        )}

      </Tabs>

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir ativo?</AlertDialogTitle>
            <AlertDialogDescription>
              "{ativo.title}" será removido permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Sim, excluir ativo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AtivoFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={ativo}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/matching/assets", id] });
        }}
      />
    </div>
  );
}
