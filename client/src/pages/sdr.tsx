import { useState, useEffect } from "react";
import { useLeads, useUpdateLead } from "@/hooks/use-sdr";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CheckCircle2, XCircle, Search, Building2,
  MapPin, Phone, Mail, Users, Loader2, Plus, AlertCircle,
  TrendingUp, ExternalLink, Globe, Landmark, Factory, UserCheck, X, Download, DollarSign
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useStages } from "@/hooks/use-crm";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertDealSchema } from "@shared/schema";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

type CnpjResult = {
  legalName: string;
  tradeName: string | null;
  cnpj: string;
  cnaePrincipal: string | null;
  cnaeSecundarios: string[];
  porte: string | null;
  status: string | null;
  natureza: string | null;
  simplesNacional: boolean;
  phones: string[];
  emails: string[];
  address: {
    street?: string;
    number?: string;
    district?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  socios: { name: string; role: string; since: string }[];
};

function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function SendToNorionButton({ lead }: { lead: any }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isSending, setIsSending] = useState(false);
  const profile = (lead.company as any)?.norionProfile;
  const isEligible = profile === "alto" || profile === "medio";

  if (!isEligible) return null;

  const handleConfirm = async () => {
    setIsSending(true);
    try {
      await apiRequest("POST", "/api/norion/operations", { companyId: lead.companyId });
      toast({ title: "Empresa enviada para Norion Capital" });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/operations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/dashboard"] });
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Erro", description: err?.message, variant: "destructive" });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className={cn(
          "h-8 px-2",
          profile === "alto"
            ? "text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20"
            : "text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
        )}
        onClick={() => setOpen(true)}
        data-testid={`button-norion-${lead.id}`}
      >
        <DollarSign className="w-4 h-4 mr-1" />
        Norion
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Enviar para Norion Capital</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Enviar <strong>{lead.company?.legalName || lead.company?.tradeName}</strong> para o pipeline Norion Capital?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-norion-cancel">Cancelar</Button>
            <Button onClick={handleConfirm} disabled={isSending} data-testid="button-norion-confirm">
              {isSending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PromoteToDealDialog({ lead }: { lead: any }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: stages } = useStages();
  const [pipeline, setPipeline] = useState<string>("INVESTOR");
  const [isPromoting, setIsPromoting] = useState(false);

  const vc = (lead.company as any)?.verifiedContacts || {};
  const hasVerified = !!(vc.phone || vc.email || vc.whatsapp || vc.contactName);

  const buildDescription = () => {
    let desc = `Promovido de Lead SDR. Score: ${lead.score}`;
    if (hasVerified) {
      desc += "\n\n--- Contato Verificado ---";
      if (vc.contactName) desc += `\nContato: ${vc.contactName}${vc.contactRole ? ` (${vc.contactRole})` : ""}`;
      if (vc.phone) desc += `\nTelefone: ${vc.phone}`;
      if (vc.email) desc += `\nEmail: ${vc.email}`;
      if (vc.whatsapp) desc += `\nWhatsApp: ${vc.whatsapp}`;
      if (vc.notes) desc += `\nObs: ${vc.notes}`;
    }
    return desc;
  };

  const form = useForm({
    resolver: zodResolver(insertDealSchema),
    defaultValues: {
      title: `Deal: ${lead.company?.legalName}`,
      pipelineType: "INVESTOR",
      stageId: 0,
      companyId: lead.companyId,
      amountEstimate: 0,
      probability: 50,
      source: lead.source || "SDR",
      description: buildDescription(),
    },
  });

  const filteredStages = stages?.filter(s => s.pipelineType === pipeline) || [];

  useEffect(() => {
    if (filteredStages.length > 0) {
      form.setValue("stageId", filteredStages[0].id);
    }
  }, [pipeline, stages]);

  const onSubmit = async (data: any) => {
    if (!data.stageId || data.stageId === 0) {
      toast({ title: "Selecione um estágio", variant: "destructive" });
      return;
    }
    setIsPromoting(true);
    try {
      const res = await apiRequest("POST", `/api/sdr/leads/${lead.id}/promote`, {
        title: data.title,
        pipelineType: data.pipelineType,
        stageId: data.stageId,
        amountEstimate: data.amountEstimate,
        probability: data.probability,
        source: data.source,
        description: data.description,
      });
      setOpen(false);
      toast({
        title: "Deal criado!",
        description: `"${data.title}" foi adicionado ao CRM e lead marcado como convertido.`,
      });
      queryClient.invalidateQueries({ queryKey: [api.sdr.queue.path] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      navigate("/crm");
    } catch (err: any) {
      toast({ title: "Erro ao promover lead", description: err?.message, variant: "destructive" });
    } finally {
      setIsPromoting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="bg-primary/5 hover:bg-primary/10 text-primary border-primary/20"
          data-testid={`button-promote-${lead.id}`}
        >
          <TrendingUp className="w-4 h-4 mr-1" />
          Promover a Deal
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Promover a Deal</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título do Deal</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-deal-title" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="pipelineType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pipeline</FormLabel>
                  <Select 
                    onValueChange={(val) => {
                      field.onChange(val);
                      setPipeline(val);
                      form.setValue("stageId", 0);
                    }} 
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-pipeline">
                        <SelectValue placeholder="Selecione o pipeline" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="INVESTOR">INVESTOR (Investidor)</SelectItem>
                      <SelectItem value="ASSET">ASSET (Ativo)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="stageId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estágio</FormLabel>
                  <Select 
                    onValueChange={(val) => field.onChange(Number(val))} 
                    value={field.value ? String(field.value) : undefined}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-stage">
                        <SelectValue placeholder="Selecione o estágio" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {filteredStages.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {hasVerified && (
              <div className="rounded-lg border border-green-200 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10 p-3 space-y-1" data-testid="promote-verified-info">
                <p className="text-xs font-semibold text-green-700 dark:text-green-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Contato Verificado
                </p>
                <div className="text-xs text-green-600 dark:text-green-400 space-y-0.5">
                  {vc.contactName && <p>{vc.contactName}{vc.contactRole ? ` — ${vc.contactRole}` : ""}</p>}
                  {vc.phone && <p>Tel: {vc.phone}</p>}
                  {vc.email && <p>Email: {vc.email}</p>}
                  {vc.whatsapp && <p>WhatsApp: {vc.whatsapp}</p>}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Estes dados serão incluídos na descrição do deal.</p>
              </div>
            )}
            {!hasVerified && (
              <div className="rounded-lg border border-yellow-200 dark:border-yellow-700 bg-yellow-50/50 dark:bg-yellow-900/10 p-3" data-testid="promote-no-verified">
                <p className="text-xs text-yellow-700 dark:text-yellow-400 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Contato não verificado — usando dados da Receita Federal
                </p>
              </div>
            )}
            <DialogFooter>
              <Button type="submit" disabled={isPromoting} data-testid="button-submit-deal">
                {isPromoting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Criar Deal
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function SdrQueue() {
  const queryClient = useQueryClient();
  const { data: leads, isLoading } = useLeads();
  const { mutate: updateLead, isPending } = useUpdateLead();
  const { toast } = useToast();

  const [cnpjInput, setCnpjInput] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [cnpjResult, setCnpjResult] = useState<CnpjResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [leadSearch, setLeadSearch] = useState("");
  const [leadStatus, setLeadStatus] = useState("all");
  const [leadMinScore, setLeadMinScore] = useState(0);
  const [leadUf, setLeadUf] = useState("all");
  const [leadPorte, setLeadPorte] = useState("all");
  const [leadVerified, setLeadVerified] = useState("all");

  const handleStatusChange = (id: number, status: string) => {
    updateLead({ id, status });
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      new: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
      queued: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
      in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
      contacted: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
      qualified: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      disqualified: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400",
      converted: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    };
    return colors[status] || colors.new;
  };

  const handleSearch = async () => {
    const clean = cnpjInput.replace(/\D/g, "");
    if (clean.length !== 14) {
      setSearchError("Digite um CNPJ válido com 14 dígitos.");
      return;
    }
    setIsSearching(true);
    setSearchError(null);
    setCnpjResult(null);
    try {
      const res = await fetch(`/api/cnpj/${clean}`);
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.message || "Erro ao consultar CNPJ.");
      } else {
        setCnpjResult(data);
      }
    } catch {
      setSearchError("Falha de conexão. Tente novamente.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleImport = async () => {
    if (!cnpjResult) return;
    setIsImporting(true);
    try {
      const res = await fetch(`/api/cnpj/${cnpjResult.cnpj}/import`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Erro ao importar", description: data.message, variant: "destructive" });
      } else {
        toast({ title: "Lead importado!", description: `${cnpjResult.legalName} adicionado à fila SDR.` });
        setCnpjResult(null);
        setCnpjInput("");
        queryClient.invalidateQueries({ queryKey: [api.sdr.queue.path] });
        queryClient.invalidateQueries({ queryKey: [api.stats.dashboard.path] });
      }
    } catch {
      toast({ title: "Erro", description: "Falha ao importar empresa.", variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">SDR — Fila de Leads</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Qualifique e gerencie seus leads via CNPJ.</p>
        </div>
      </div>

      {/* CNPJ Search Panel */}
      <Card className="border-primary/20 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="w-4 h-4 text-primary" />
            Buscar e Importar Empresa por CNPJ
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Input
              data-testid="input-cnpj"
              placeholder="00.000.000/0000-00"
              value={cnpjInput}
              onChange={(e) => {
                setCnpjInput(formatCnpj(e.target.value));
                setSearchError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="max-w-xs font-mono"
            />
            <Button
              onClick={handleSearch}
              disabled={isSearching}
              data-testid="button-search-cnpj"
            >
              {isSearching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              Consultar
            </Button>
          </div>

          {searchError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4" />
              {searchError}
            </div>
          )}

          {cnpjResult && (
            <div className="border rounded-xl p-5 bg-muted/20 space-y-4 animate-in fade-in-0 slide-in-from-top-2 duration-300">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Building2 className="w-5 h-5 text-primary" />
                    <h3 className="font-bold text-lg">{cnpjResult.legalName}</h3>
                  </div>
                  {cnpjResult.tradeName && (
                    <p className="text-sm text-muted-foreground ml-7">Nome fantasia: <span className="font-medium text-foreground">{cnpjResult.tradeName}</span></p>
                  )}
                  <div className="flex flex-wrap gap-2 mt-2 ml-7">
                    {cnpjResult.status && (
                      <Badge variant={cnpjResult.status === "Ativa" ? "default" : "secondary"} className="text-xs">
                        {cnpjResult.status}
                      </Badge>
                    )}
                    {cnpjResult.porte && (
                      <Badge variant="outline" className="text-xs">{cnpjResult.porte}</Badge>
                    )}
                    {cnpjResult.simplesNacional && (
                      <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400">
                        Simples Nacional
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs font-mono">{cnpjResult.cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")}</Badge>
                  </div>
                </div>
                <Button
                  onClick={handleImport}
                  disabled={isImporting}
                  className="shrink-0 shadow-lg shadow-primary/20"
                  data-testid="button-import-lead"
                >
                  {isImporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                  Importar como Lead
                </Button>
              </div>

              <Separator />

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                {cnpjResult.cnaePrincipal && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">CNAE Principal</p>
                    <p className="text-foreground">{cnpjResult.cnaePrincipal}</p>
                  </div>
                )}
                {cnpjResult.natureza && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Natureza Jurídica</p>
                    <p className="text-foreground">{cnpjResult.natureza}</p>
                  </div>
                )}
                {(cnpjResult.address.city || cnpjResult.address.state) && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Endereço</p>
                    <p className="flex items-center gap-1.5 text-foreground">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                      {[cnpjResult.address.street, cnpjResult.address.number, cnpjResult.address.district, cnpjResult.address.city, cnpjResult.address.state].filter(Boolean).join(", ")}
                    </p>
                  </div>
                )}
                {cnpjResult.phones.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Telefones</p>
                    <div className="space-y-0.5">
                      {cnpjResult.phones.map((p, i) => (
                        <p key={i} className="flex items-center gap-1.5 text-foreground">
                          <Phone className="w-3.5 h-3.5 text-muted-foreground" />{p}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                {cnpjResult.emails.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">E-mails</p>
                    <div className="space-y-0.5">
                      {cnpjResult.emails.map((e, i) => (
                        <p key={i} className="flex items-center gap-1.5 text-foreground">
                          <Mail className="w-3.5 h-3.5 text-muted-foreground" />{e}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                {cnpjResult.socios.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Quadro Societário</p>
                    <div className="space-y-0.5">
                      {cnpjResult.socios.map((s, i) => (
                        <p key={i} className="flex items-center gap-1.5 text-foreground">
                          <Users className="w-3.5 h-3.5 text-muted-foreground" />
                          {s.name} <span className="text-muted-foreground text-xs">— {s.role}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {cnpjResult.cnaeSecundarios.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">CNAEs Secundários</p>
                  <div className="flex flex-wrap gap-1.5">
                    {cnpjResult.cnaeSecundarios.slice(0, 6).map((c, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">{c}</Badge>
                    ))}
                    {cnpjResult.cnaeSecundarios.length > 6 && (
                      <Badge variant="secondary" className="text-xs">+{cnpjResult.cnaeSecundarios.length - 6}</Badge>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lead Queue */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-primary" />
            Fila de Leads ({leads?.length || 0})
          </h2>
          <div className="flex flex-wrap gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-export-leads">
                  <Download className="w-4 h-4 mr-1.5" /> Exportar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => window.open("/api/export/leads?format=xlsx", "_blank")} data-testid="export-leads-xlsx">
                  Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open("/api/export/leads?format=csv", "_blank")} data-testid="export-leads-csv">
                  CSV (.csv)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar empresa..."
                value={leadSearch}
                onChange={e => setLeadSearch(e.target.value)}
                className="pl-8 h-8 text-sm w-44"
                data-testid="input-lead-search"
              />
            </div>
            <Select value={leadStatus} onValueChange={setLeadStatus}>
              <SelectTrigger className="h-8 text-sm w-36" data-testid="select-lead-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="new">Novo</SelectItem>
                <SelectItem value="queued">Na fila</SelectItem>
                <SelectItem value="in_progress">Em progresso</SelectItem>
                <SelectItem value="contacted">Contactado</SelectItem>
                <SelectItem value="qualified">Qualificado</SelectItem>
                <SelectItem value="disqualified">Descartado</SelectItem>
                <SelectItem value="converted">Convertido</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(leadMinScore)} onValueChange={v => setLeadMinScore(Number(v))}>
              <SelectTrigger className="h-8 text-sm w-32" data-testid="select-lead-score">
                <SelectValue placeholder="Score mín." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Qualquer score</SelectItem>
                <SelectItem value="30">Score ≥ 30</SelectItem>
                <SelectItem value="50">Score ≥ 50</SelectItem>
                <SelectItem value="70">Score ≥ 70</SelectItem>
                <SelectItem value="90">Score ≥ 90</SelectItem>
              </SelectContent>
            </Select>
            <Select value={leadUf} onValueChange={setLeadUf}>
              <SelectTrigger className="h-8 text-sm w-28" data-testid="select-lead-uf">
                <SelectValue placeholder="UF" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos UFs</SelectItem>
                {["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].map(uf => (
                  <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={leadPorte} onValueChange={setLeadPorte}>
              <SelectTrigger className="h-8 text-sm w-28" data-testid="select-lead-porte">
                <SelectValue placeholder="Porte" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos portes</SelectItem>
                <SelectItem value="ME">ME</SelectItem>
                <SelectItem value="EPP">EPP</SelectItem>
                <SelectItem value="DEMAIS">Demais</SelectItem>
              </SelectContent>
            </Select>
            <Select value={leadVerified} onValueChange={setLeadVerified}>
              <SelectTrigger className="h-8 text-sm w-32" data-testid="select-lead-verified">
                <SelectValue placeholder="Verificação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="verified">Verificados</SelectItem>
                <SelectItem value="not_verified">Não verificados</SelectItem>
              </SelectContent>
            </Select>
            {(leadSearch || leadStatus !== "all" || leadMinScore > 0 || leadUf !== "all" || leadPorte !== "all" || leadVerified !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setLeadSearch(""); setLeadStatus("all"); setLeadMinScore(0); setLeadUf("all"); setLeadPorte("all"); setLeadVerified("all"); }}
                className="h-8 px-2 text-xs text-muted-foreground"
                data-testid="button-clear-lead-filters"
              >
                <X className="w-3.5 h-3.5 mr-1" /> Limpar
              </Button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="grid md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}
          </div>
        ) : leads?.length === 0 ? (
          <Card className="border-dashed border-2">
            <CardContent className="text-center py-12 text-muted-foreground space-y-2">
              <Search className="w-10 h-10 mx-auto opacity-20" />
              <p>Nenhum lead na fila ainda.</p>
              <p className="text-sm">Busque um CNPJ acima para importar sua primeira empresa.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {leads?.filter(lead => {
              if (leadSearch.trim()) {
                const q = leadSearch.toLowerCase();
                const name = (lead.company?.tradeName || lead.company?.legalName || "").toLowerCase();
                const cnae = (lead.company?.cnaePrincipal || "").toLowerCase();
                if (!name.includes(q) && !(lead.company?.cnpj || "").includes(q) && !cnae.includes(q)) return false;
              }
              if (leadStatus !== "all" && lead.status !== leadStatus) return false;
              if (leadMinScore > 0 && (lead.score || 0) < leadMinScore) return false;
              if (leadUf !== "all") {
                const addr = (lead.company?.address as any) || {};
                if (addr.state !== leadUf) return false;
              }
              if (leadPorte !== "all") {
                const p = (lead.company?.porte || "").toUpperCase();
                if (leadPorte === "DEMAIS" ? (p === "ME" || p === "EPP") : p !== leadPorte) return false;
              }
              if (leadVerified !== "all") {
                const vc = (lead.company as any)?.verifiedContacts || {};
                const hasV = !!(vc.phone || vc.email || vc.whatsapp || vc.contactName);
                if (leadVerified === "verified" && !hasV) return false;
                if (leadVerified === "not_verified" && hasV) return false;
              }
              return true;
            }).map((lead) => {
              const enrichment = (lead.company?.enrichmentData as any)?.merged || {};
              const vc = (lead.company as any)?.verifiedContacts || {};
              const hasVerified = !!(vc.phone || vc.email || vc.whatsapp || vc.contactName);
              const phones = Array.from(new Set([...(lead.company?.phones as string[] || []), ...(enrichment.phones || [])]));
              const emails = Array.from(new Set([...(lead.company?.emails as string[] || []), ...(enrichment.emails || [])]));
              const address = (lead.company?.address as any) || {};
              
              return (
                <Card key={lead.id} data-testid={`card-lead-${lead.id}`} className="hover-elevate overflow-visible">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start gap-4">
                      <div className="space-y-1">
                        <Link href={`/empresas/${lead.companyId}`} className="text-lg font-bold hover:text-primary transition-colors flex items-center gap-2" data-testid={`link-company-${lead.id}`}>
                            {lead.company?.tradeName || lead.company?.legalName}
                            <ExternalLink className="w-3 h-3 opacity-50" />
                          </Link>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={lead.score && lead.score > 70 ? "default" : "secondary"} className="text-[10px] h-4">
                            Score: {lead.score ?? 0}
                          </Badge>
                          <Badge className={`text-[10px] h-4 uppercase ${getStatusBadge(lead.status)}`}>
                            {lead.status}
                          </Badge>
                          {lead.company?.porte && (
                            <Badge variant="outline" className="text-[10px] h-4">{lead.company.porte}</Badge>
                          )}
                          {hasVerified ? (
                            <Badge variant="outline" className="text-[10px] h-4 bg-green-50 text-green-700 border-green-300 dark:bg-green-900/20 dark:text-green-400" data-testid={`badge-verified-${lead.id}`}>
                              <CheckCircle2 className="w-3 h-3 mr-0.5" /> Verificado
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] h-4 bg-yellow-50 text-yellow-700 border-yellow-300 dark:bg-yellow-900/20 dark:text-yellow-400" data-testid={`badge-not-verified-${lead.id}`}>
                              <AlertCircle className="w-3 h-3 mr-0.5" /> Não verificado
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        {lead.createdAt ? format(new Date(lead.createdAt), "dd/MM/yyyy") : "–"}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                      <div className="space-y-3">
                        {lead.company?.cnaePrincipal && (
                          <div className="space-y-1">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                              <Factory className="w-3 h-3" /> CNAE Principal
                            </p>
                            <p className="text-xs line-clamp-2 leading-relaxed">{lead.company.cnaePrincipal}</p>
                          </div>
                        )}
                        {(address.city || address.state) && (
                          <div className="space-y-1">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                              <MapPin className="w-3 h-3" /> Localização
                            </p>
                            <p className="text-xs">{address.city}, {address.state}</p>
                          </div>
                        )}
                      </div>
                      
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                            <Phone className="w-3 h-3" /> Contatos
                          </p>
                          <div className="space-y-1">
                            {hasVerified && (
                              <div className="mb-1.5 p-1.5 rounded bg-green-50/80 dark:bg-green-900/10 border border-green-200 dark:border-green-800 space-y-0.5" data-testid={`verified-contacts-${lead.id}`}>
                                {vc.contactName && (
                                  <p className="text-xs font-medium text-green-700 dark:text-green-400 flex items-center gap-1">
                                    <UserCheck className="w-3 h-3" /> {vc.contactName}{vc.contactRole ? ` (${vc.contactRole})` : ""}
                                  </p>
                                )}
                                {vc.phone && (
                                  <p className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1.5">
                                    <Phone className="w-3 h-3" /> {vc.phone}
                                  </p>
                                )}
                                {vc.email && (
                                  <p className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1.5 truncate">
                                    <Mail className="w-3 h-3" /> {vc.email}
                                  </p>
                                )}
                              </div>
                            )}
                            {phones.slice(0, 2).map((p, i) => (
                              <p key={i} className="text-xs flex items-center gap-1.5 text-muted-foreground">
                                <span className="w-1 h-1 rounded-full bg-primary/40" /> {p} {!hasVerified && i === 0 ? "" : ""}
                              </p>
                            ))}
                            {emails.slice(0, 1).map((e, i) => (
                              <p key={i} className="text-xs flex items-center gap-1.5 truncate text-muted-foreground">
                                <Mail className="w-3 h-3" /> {e}
                              </p>
                            ))}
                            {phones.length === 0 && emails.length === 0 && !hasVerified && (
                              <p className="text-xs text-muted-foreground italic">Sem contatos</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <Separator className="opacity-50" />

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid={`button-qualify-${lead.id}`}
                          className="h-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 px-2"
                          onClick={() => handleStatusChange(lead.id, "qualified")}
                          disabled={isPending || lead.status === "qualified"}
                        >
                          <CheckCircle2 className="w-4 h-4 mr-1" />
                          Qualificar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid={`button-reject-${lead.id}`}
                          className="h-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-900/20 px-2"
                          onClick={() => handleStatusChange(lead.id, "disqualified")}
                          disabled={isPending || lead.status === "disqualified"}
                        >
                          <XCircle className="w-4 h-4 mr-1" />
                          Rejeitar
                        </Button>
                        <SendToNorionButton lead={lead} />
                      </div>
                      {lead.status !== "converted" && <PromoteToDealDialog lead={lead} />}
                      {lead.status === "converted" && (
                        <Badge variant="outline" className="text-emerald-700 border-emerald-300 dark:text-emerald-400 dark:border-emerald-700" data-testid={`badge-converted-${lead.id}`}>
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Convertido em Deal
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
