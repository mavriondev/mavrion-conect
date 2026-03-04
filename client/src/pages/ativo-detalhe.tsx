import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  Tag, MessageSquare, Zap,
} from "lucide-react";
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

export default function AtivoDetalhePage({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const { data: ativo, isLoading, error } = useQuery({
    queryKey: ["/api/matching/assets", id],
    queryFn: () => apiRequest("GET", `/api/matching/assets/${id}`).then(r => {
      if (!r.ok) throw new Error("not found");
      return r.json();
    }),
  });

  const { data: deals = [] } = useQuery({
    queryKey: ["/api/crm/deals"],
    queryFn: () => apiRequest("GET", "/api/crm/deals").then(r => r.json()),
  });

  const relatedDeals = (deals as any[]).filter(d =>
    d.title?.toLowerCase().includes(ativo?.title?.toLowerCase()?.slice(0, 10)) ||
    d.companyId === ativo?.linkedCompanyId
  );

  const handleDelete = async () => {
    await apiRequest("DELETE", `/api/matching/assets/${id}`);
    queryClient.invalidateQueries({ queryKey: ["/api/matching/assets"] });
    toast({ title: "Ativo excluído" });
    navigate("/ativos");
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
            {relatedDeals.length > 0 && (
              <TabsTrigger value="deals">Deals ({relatedDeals.length})</TabsTrigger>
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
        <TabsContent value="docs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" /> Status da Documentação
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
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
              <InfoRow label="Matrícula" value={ativo.matricula} />

              {/* Documentos JSON */}
              {ativo.documentosJson && Object.keys(ativo.documentosJson).length > 0 && (
                <div className="space-y-2 pt-2 border-t">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Documentos cadastrados</p>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(ativo.documentosJson).map(([key, val]: [string, any]) => (
                      val && (
                        <div key={key} className="flex items-center gap-1.5 text-xs">
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                          <span className="capitalize">{key.replace(/_/g, " ")}</span>
                        </div>
                      )
                    ))}
                  </div>
                </div>
              )}
              {(!ativo.documentosJson || Object.keys(ativo.documentosJson).length === 0) && !ativo.matricula && (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Nenhum documento cadastrado. Edite o ativo para adicionar informações de documentação.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Deals Tab ── */}
        {relatedDeals.length > 0 && (
          <TabsContent value="deals" className="mt-4 space-y-3">
            {relatedDeals.map((deal: any) => (
              <Card key={deal.id}>
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Zap className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{deal.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-xs">
                          {deal.pipelineType === "INVESTOR" ? "Pipeline Investidor" : "Pipeline Ativo"}
                        </Badge>
                        {deal.amountEstimate && (
                          <span className="text-xs text-muted-foreground">
                            R$ {Number(deal.amountEstimate).toLocaleString("pt-BR")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate("/crm")}>
                    Ver no CRM
                  </Button>
                </CardContent>
              </Card>
            ))}
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
