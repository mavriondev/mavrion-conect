import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Building2, MapPin, Briefcase, Phone, Mail, Search,
  Loader2, UserPlus, Filter, X, Download,
} from "lucide-react";
import { Link } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────
interface CompanyWithLead {
  id: number;
  legalName: string;
  tradeName: string | null;
  cnpj: string | null;
  cnaePrincipal: string | null;
  cnaeSecundarios: string[];
  porte: string | null;
  phones: string[];
  emails: string[];
  address: { city?: string; state?: string };
  notes: string | null;
  createdAt: string;
  lead: { id: number; status: string; score: number; source: string | null } | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────
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
  disqualified: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const PORTES = [
  { id: "Microempresa", label: "ME" },
  { id: "Empresa de Pequeno Porte", label: "EPP" },
  { id: "Demais", label: "Demais" },
];

const ESTADOS = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
  "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

// ── Mode config ───────────────────────────────────────────────────────────────
const MODE_CONFIG = {
  all: { title: "Empresas Importadas", subtitle: "Todas as empresas importadas para o sistema.", leadFilter: "all" as const },
  leads: { title: "Leads Ativas", subtitle: "Empresas com leads ativos no pipeline.", leadFilter: "active" as const },
  desqualificadas: { title: "Leads Desqualificadas", subtitle: "Empresas marcadas como sem interesse — não aparecem na busca.", leadFilter: "disqualified" as const },
};

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function EmpresasPage({ mode = "all" }: { mode?: "all" | "leads" | "desqualificadas" }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const cfg = MODE_CONFIG[mode] || MODE_CONFIG.all;

  const [search, setSearch] = useState("");
  const [filterPortes, setFilterPortes] = useState<string[]>([]);
  const [filterStates, setFilterStates] = useState<string[]>([]);
  const [filterCity, setFilterCity] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [creatingLead, setCreatingLead] = useState<number | null>(null);

  const { data: companies, isLoading } = useQuery<CompanyWithLead[]>({
    queryKey: ["/api/companies/with-leads"],
  });

  const createLeadMutation = useMutation({
    mutationFn: (companyId: number) => apiRequest("POST", `/api/companies/${companyId}/lead`),
    onSuccess: () => {
      toast({ title: "Lead criado com sucesso!" });
      queryClient.invalidateQueries({ queryKey: ["/api/companies/with-leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/queue"] });
    },
    onError: () => toast({ title: "Erro ao criar lead", variant: "destructive" }),
    onSettled: () => setCreatingLead(null),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ leadId, status }: { leadId: number; status: string }) =>
      apiRequest("PATCH", `/api/sdr/leads/${leadId}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies/with-leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/queue"] });
    },
    onError: () => toast({ title: "Erro ao atualizar status", variant: "destructive" }),
  });

  const handleCreateLead = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    e.preventDefault();
    setCreatingLead(id);
    createLeadMutation.mutate(id);
  };

  const togglePorte = (p: string) =>
    setFilterPortes(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  const toggleState = (s: string) =>
    setFilterStates(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const clearFilters = () => {
    setSearch("");
    setFilterPortes([]);
    setFilterStates([]);
    setFilterCity("");
  };

  const modeFiltered = (companies || []).filter(c => {
    if (cfg.leadFilter === "active") return c.lead && c.lead.status !== "disqualified";
    if (cfg.leadFilter === "disqualified") return c.lead?.status === "disqualified";
    return true;
  });

  const filtered = modeFiltered.filter(c => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const match =
        c.legalName.toLowerCase().includes(q) ||
        (c.tradeName?.toLowerCase().includes(q) ?? false) ||
        (c.cnpj?.includes(q) ?? false) ||
        (c.cnaePrincipal?.toLowerCase().includes(q) ?? false) ||
        (c.address?.city?.toLowerCase().includes(q) ?? false);
      if (!match) return false;
    }
    if (filterPortes.length > 0 && !filterPortes.some(p => c.porte?.includes(p))) return false;
    if (filterStates.length > 0 && !filterStates.includes(c.address?.state || "")) return false;
    if (filterCity.trim()) {
      const q = filterCity.trim().toLowerCase();
      if (!(c.address?.city?.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  const activeFiltersCount = [
    filterPortes.length > 0,
    filterStates.length > 0,
    filterCity.trim().length > 0,
  ].filter(Boolean).length;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4 md:space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{cfg.title}</h1>
          <p className="text-muted-foreground text-sm mt-1">{cfg.subtitle}</p>
        </div>
        {companies && (
          <div className="flex gap-4 text-sm flex-wrap items-center">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Building2 className="w-4 h-4" />
              <strong>{modeFiltered.length}</strong> {mode === "all" ? "total" : "resultado(s)"}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-export-empresas">
                  <Download className="w-4 h-4 mr-2" /> Exportar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => window.open("/api/export/companies?format=xlsx", "_blank")} data-testid="export-empresas-xlsx">
                  Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open("/api/export/companies?format=csv", "_blank")} data-testid="export-empresas-csv">
                  CSV (.csv)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, CNPJ, cidade, CNAE..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-busca-empresas"
            />
          </div>
          <Button
            variant={showFilters ? "secondary" : "outline"}
            onClick={() => setShowFilters(f => !f)}
            className="gap-1.5"
            data-testid="button-toggle-filtros"
          >
            <Filter className="w-4 h-4" />
            Filtros
            {activeFiltersCount > 0 && (
              <Badge className="ml-0.5 text-xs py-0 h-4 min-w-4">{activeFiltersCount}</Badge>
            )}
          </Button>
          {(search || activeFiltersCount > 0) && (
            <Button variant="ghost" size="icon" onClick={clearFilters} data-testid="button-limpar-filtros">
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>

        {showFilters && (
          <Card className="border-dashed">
            <CardContent className="pt-4 pb-4 space-y-4">
              {/* Porte */}
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Porte</Label>
                <div className="flex gap-4 flex-wrap">
                  {PORTES.map(p => (
                    <div key={p.id} className="flex items-center gap-1.5">
                      <Checkbox
                        id={`porte-${p.id}`}
                        checked={filterPortes.includes(p.id)}
                        onCheckedChange={() => togglePorte(p.id)}
                        data-testid={`filter-porte-${p.id}`}
                      />
                      <Label htmlFor={`porte-${p.id}`} className="text-sm font-normal cursor-pointer">{p.label}</Label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Estado */}
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Estado (UF)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {ESTADOS.map(s => (
                    <button
                      key={s}
                      onClick={() => toggleState(s)}
                      data-testid={`filter-estado-${s}`}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                        filterStates.includes(s)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cidade */}
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Cidade</Label>
                <div className="relative max-w-xs">
                  <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Filtrar por cidade..."
                    value={filterCity}
                    onChange={e => setFilterCity(e.target.value)}
                    className="pl-8 h-8 text-sm"
                    data-testid="filter-cidade"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && (!companies || companies.length === 0) && (
        <Card>
          <CardContent className="pt-12 pb-12 text-center space-y-3">
            <Building2 className="w-10 h-10 mx-auto text-muted-foreground/30" />
            <p className="font-medium text-muted-foreground">Nenhuma empresa importada ainda</p>
            <p className="text-sm text-muted-foreground">
              Use a <Link href="/prospeccao" className="underline text-primary">Prospecção</Link> para buscar e importar empresas.
            </p>
          </CardContent>
        </Card>
      )}

      {/* No results for mode */}
      {!isLoading && companies && companies.length > 0 && modeFiltered.length === 0 && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center text-muted-foreground text-sm">
            {mode === "leads" && "Nenhuma empresa com lead ativo encontrada."}
            {mode === "desqualificadas" && "Nenhuma empresa desqualificada ainda. Use o botão 'Desqualificar' na busca para marcar empresas sem interesse."}
            {mode === "all" && "Nenhuma empresa encontrada."}
          </CardContent>
        </Card>
      )}

      {/* No filter results */}
      {!isLoading && modeFiltered.length > 0 && filtered.length === 0 && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center text-muted-foreground text-sm">
            Nenhuma empresa corresponde aos filtros aplicados.
          </CardContent>
        </Card>
      )}

      {/* Company list */}
      <div className="space-y-2">
        {filtered.map(company => (
          <Link
            key={company.id}
            href={`/empresas/${company.id}`}
            className="block"
            data-testid={`link-empresa-${company.id}`}
          >
            <Card
              className="cursor-pointer hover:shadow-md hover:border-primary/30 transition-all duration-150"
              data-testid={`card-empresa-${company.id}`}
            >
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{company.legalName}</p>
                      {company.tradeName && (
                        <span className="text-xs text-muted-foreground">({company.tradeName})</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-muted-foreground">
                      {company.cnpj && <span className="font-mono">{company.cnpj}</span>}
                      {company.porte && <Badge variant="outline" className="text-xs py-0">{company.porte}</Badge>}
                      {company.cnaePrincipal && (
                        <span className="flex items-center gap-1">
                          <Briefcase className="w-3 h-3" />
                          {company.cnaePrincipal.length > 40
                            ? company.cnaePrincipal.substring(0, 40) + "…"
                            : company.cnaePrincipal}
                        </span>
                      )}
                      {(company.address?.city || company.address?.state) && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {[company.address?.city, company.address?.state].filter(Boolean).join(" – ")}
                        </span>
                      )}
                      {company.phones.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Phone className="w-3 h-3" /> {company.phones[0]}
                        </span>
                      )}
                      {company.emails.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Mail className="w-3 h-3" /> {company.emails[0]}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2" onClick={e => { e.stopPropagation(); e.preventDefault(); }}>
                    {company.lead ? (
                      <Select
                        value={company.lead.status}
                        onValueChange={status => updateStatusMutation.mutate({ leadId: company.lead!.id, status })}
                      >
                        <SelectTrigger
                          className={`h-7 text-xs px-2.5 rounded-full border-0 font-medium w-auto gap-1 focus:ring-0 ${LEAD_STATUS_COLORS[company.lead.status] || LEAD_STATUS_COLORS.new}`}
                          data-testid={`select-status-${company.id}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(LEAD_STATUS_LABELS).map(([val, label]) => (
                            <SelectItem key={val} value={val} className="text-xs">{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        onClick={e => handleCreateLead(e, company.id)}
                        disabled={creatingLead === company.id}
                        data-testid={`button-criar-lead-${company.id}`}
                      >
                        {creatingLead === company.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <UserPlus className="w-3 h-3" />}
                        Criar Lead
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-center text-muted-foreground pt-2">
          {filtered.length} empresa{filtered.length !== 1 ? "s" : ""} exibida{filtered.length !== 1 ? "s" : ""}
          {modeFiltered.length > 0 && filtered.length < modeFiltered.length ? ` de ${modeFiltered.length}` : ""}
        </p>
      )}
    </div>
  );
}
