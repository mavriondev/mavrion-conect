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
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Building2, MapPin, Briefcase, Phone, Mail, Search, Loader2, Filter, X, Download, Trash2, ExternalLink, Package } from "lucide-react";
import { Link } from "wouter";

interface CompanyCatalog {
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
  ownedAssets: { count: number; types: string[] } | null;
}

const PORTES = [
  { id: "Microempresa", label: "ME" },
  { id: "Empresa de Pequeno Porte", label: "EPP" },
  { id: "Demais", label: "Demais" },
];

const ESTADOS = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
  "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];


export default function EmpresasPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const cfg = { title: "Empresas Importadas", subtitle: "Todas as empresas cadastradas no sistema." };

  const [search, setSearch] = useState("");
  const [filterPortes, setFilterPortes] = useState<string[]>([]);
  const [filterStates, setFilterStates] = useState<string[]>([]);
  const [filterCity, setFilterCity] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);

  const { data: companies, isLoading, isError } = useQuery<CompanyCatalog[]>({
    queryKey: ["/api/companies/catalogo"],
  });


  const deleteMutation = useMutation({
    mutationFn: (companyId: number) => apiRequest("DELETE", `/api/companies/${companyId}`),
    onSuccess: () => {
      toast({ title: "Empresa excluída com sucesso" });
      queryClient.invalidateQueries({ queryKey: ["/api/companies/catalogo"] });
      setDeleteTarget(null);
    },
    onError: () => toast({ title: "Erro ao excluir empresa", variant: "destructive" }),
  });

  const batchDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => apiRequest("POST", "/api/companies/batch-delete", { ids }),
    onSuccess: (_data, ids) => {
      toast({ title: `${ids.length} empresa(s) excluída(s)` });
      queryClient.invalidateQueries({ queryKey: ["/api/companies/catalogo"] });
      setSelectedIds(new Set());
      setShowBatchDeleteConfirm(false);
    },
    onError: () => toast({ title: "Erro ao excluir empresas", variant: "destructive" }),
  });

  const togglePorte = (p: string) =>
    setFilterPortes(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  const toggleState = (s: string) =>
    setFilterStates(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filtered.map(c => c.id)));
  };

  const clearFilters = () => {
    setSearch("");
    setFilterPortes([]);
    setFilterStates([]);
    setFilterCity("");
  };

  const modeFiltered = companies || [];

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
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4 md:space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="text-page-title">{cfg.title}</h1>
          <p className="text-muted-foreground text-xs mt-0.5">{cfg.subtitle}</p>
        </div>
        {companies && (
          <div className="flex gap-4 text-sm flex-wrap items-center">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Building2 className="w-4 h-4" />
              <strong data-testid="text-total-count">{modeFiltered.length}</strong> total
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

      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border rounded-lg px-4 py-2.5 flex items-center justify-between gap-3 shadow-sm" data-testid="batch-action-bar">
          <div className="flex items-center gap-3">
            <Checkbox
              checked={selectedIds.size === filtered.length && filtered.length > 0}
              onCheckedChange={(checked) => checked ? selectAll() : setSelectedIds(new Set())}
              data-testid="checkbox-select-all"
            />
            <span className="text-sm font-medium" data-testid="text-selected-count">
              {selectedIds.size} selecionada{selectedIds.size !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="destructive"
              size="sm"
              className="gap-1.5"
              onClick={() => setShowBatchDeleteConfirm(true)}
              data-testid="button-batch-delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Excluir selecionadas
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
              data-testid="button-clear-selection"
            >
              Limpar seleção
            </Button>
          </div>
        </div>
      )}

      {isError && (
        <Card data-testid="empresas-error">
          <CardContent className="pt-12 pb-12 text-center space-y-3">
            <Building2 className="w-10 h-10 mx-auto text-red-400" />
            <p className="font-medium">Erro ao carregar empresas</p>
            <p className="text-sm text-muted-foreground">Não foi possível buscar os dados. Tente recarregar a página.</p>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>Recarregar</Button>
          </CardContent>
        </Card>
      )}

      {!isError && isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isError && !isLoading && (!companies || companies.length === 0) && (
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

      {!isLoading && companies && companies.length > 0 && modeFiltered.length === 0 && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center text-muted-foreground text-sm">
            Nenhuma empresa encontrada.
          </CardContent>
        </Card>
      )}

      {!isLoading && modeFiltered.length > 0 && filtered.length === 0 && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center text-muted-foreground text-sm">
            Nenhuma empresa corresponde aos filtros aplicados.
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {filtered.map(company => (
          <div key={company.id} className="flex items-stretch gap-0">
            <div
              className="flex items-center px-2 shrink-0"
              onClick={e => { e.stopPropagation(); e.preventDefault(); }}
            >
              <Checkbox
                checked={selectedIds.has(company.id)}
                onCheckedChange={() => toggleSelect(company.id)}
                data-testid={`checkbox-select-${company.id}`}
              />
            </div>
            <Link
              href={`/empresas/${company.id}`}
              className="block flex-1 min-w-0"
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

                        {company.ownedAssets && (
                          <Badge variant="secondary" className="text-xs py-0 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" data-testid={`badge-proprietaria-${company.id}`}>
                            <Package className="w-3 h-3 mr-1" />
                            Proprietária ({company.ownedAssets.count} {company.ownedAssets.count === 1 ? "ativo" : "ativos"})
                          </Badge>
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
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => window.open(`/empresas/${company.id}`, '_blank', 'noopener,noreferrer')}
                        data-testid={`button-newtab-${company.id}`}
                        title="Abrir em nova aba"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setDeleteTarget({ id: company.id, name: company.legalName })}
                        data-testid={`button-delete-${company.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        ))}
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-center text-muted-foreground pt-2">
          {filtered.length} empresa{filtered.length !== 1 ? "s" : ""} exibida{filtered.length !== 1 ? "s" : ""}
          {modeFiltered.length > 0 && filtered.length < modeFiltered.length ? ` de ${modeFiltered.length}` : ""}
        </p>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent data-testid="dialog-confirm-delete">
          <DialogHeader>
            <DialogTitle>Excluir empresa</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir <strong>{deleteTarget?.name}</strong>? Todos os dados associados (leads, contatos, deals) serão removidos permanentemente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} data-testid="button-cancel-delete">
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBatchDeleteConfirm} onOpenChange={setShowBatchDeleteConfirm}>
        <DialogContent data-testid="dialog-confirm-batch-delete">
          <DialogHeader>
            <DialogTitle>Excluir {selectedIds.size} empresa{selectedIds.size !== 1 ? "s" : ""}</DialogTitle>
            <DialogDescription>
              Esta ação é irreversível. Todos os dados associados (leads, contatos, deals) das {selectedIds.size} empresa{selectedIds.size !== 1 ? "s" : ""} selecionada{selectedIds.size !== 1 ? "s" : ""} serão removidos permanentemente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBatchDeleteConfirm(false)} data-testid="button-cancel-batch-delete">
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => batchDeleteMutation.mutate(Array.from(selectedIds))}
              disabled={batchDeleteMutation.isPending}
              data-testid="button-confirm-batch-delete"
            >
              {batchDeleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
              Excluir {selectedIds.size} empresa{selectedIds.size !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
