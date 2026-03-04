import { useState, useMemo } from "react";
import { useDeals, useStages, useCreateDeal, useUpdateDeal, useCompanies } from "@/hooks/use-crm";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, DollarSign, Building2, Search, X, Download } from "lucide-react";
import { DropResult } from "@hello-pangea/dnd";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import KanbanBoard from "./kanban-board";
import DealDetailPanel from "./deal-panel";

export const PRIORITY_CONFIG: Record<string, { label: string; color: string; border: string }> = {
  low:    { label: "Baixa",   color: "bg-slate-400",   border: "border-l-slate-400" },
  medium: { label: "Média",   color: "bg-blue-500",    border: "border-l-blue-500" },
  high:   { label: "Alta",    color: "bg-amber-500",   border: "border-l-amber-500" },
  urgent: { label: "Urgente", color: "bg-red-500",     border: "border-l-red-500" },
};

export const LABEL_COLORS = [
  "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
];

export default function CRMBoard() {
  const [pipelineType, setPipelineType] = useState<"INVESTOR" | "ASSET">("INVESTOR");
  const { data: deals, isLoading } = useDeals(pipelineType);
  const { data: allStages, refetch: refetchStages } = useStages();
  const { data: companies } = useCompanies();
  const { data: allAssets = [] } = useQuery<any[]>({
    queryKey: ["/api/matching/assets"],
    queryFn: async () => { const r = await fetch("/api/matching/assets", { credentials: "include" }); return r.ok ? r.json() : []; },
  });
  const assetsById = useMemo(() => {
    const map: Record<number, any> = {};
    (allAssets as any[]).forEach(a => { map[a.id] = a; });
    return map;
  }, [allAssets]);
  const { mutate: updateDeal } = useUpdateDeal();
  const { mutate: createDeal, isPending: isCreating } = useCreateDeal();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newDeal, setNewDeal] = useState({ title: "", amountEstimate: "", companyId: "" });
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDealId, setSelectedDealId] = useState<number | null>(null);
  const [confirmDeleteStageId, setConfirmDeleteStageId] = useState<number | null>(null);

  const [dealSearch, setDealSearch] = useState("");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterLabel, setFilterLabel] = useState("");

  const filteredCompanies = useMemo(() => {
    if (!companies) return [];
    const term = searchTerm.toLowerCase();
    return companies.filter(c =>
      c.legalName.toLowerCase().includes(term) ||
      (c.tradeName && c.tradeName.toLowerCase().includes(term)) ||
      (c.cnpj && c.cnpj.includes(term))
    ).slice(0, 10);
  }, [companies, searchTerm]);

  const filteredDeals = useMemo(() => {
    if (!deals) return [];
    return deals.filter(d => {
      if (dealSearch.trim()) {
        const q = dealSearch.toLowerCase();
        const titleMatch = d.title?.toLowerCase().includes(q);
        const companyMatch = (companies || []).find(c => c.id === d.companyId);
        const nameMatch = companyMatch
          ? (companyMatch.tradeName || companyMatch.legalName || "").toLowerCase().includes(q)
          : false;
        if (!titleMatch && !nameMatch) return false;
      }
      if (filterPriority !== "all" && (d.priority || "medium") !== filterPriority) return false;
      if (filterLabel.trim()) {
        const labels = (d.labels as string[] | null) || [];
        if (!labels.some(l => l.toLowerCase().includes(filterLabel.toLowerCase()))) return false;
      }
      return true;
    });
  }, [deals, dealSearch, filterPriority, filterLabel, companies]);

  const hasActiveFilters = dealSearch || filterPriority !== "all" || filterLabel.trim();

  const stages = allStages?.filter(s => s.pipelineType === pipelineType)
    .sort((a, b) => a.order - b.order) || [];

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const dealId = parseInt(result.draggableId);
    const newStageId = parseInt(result.destination.droppableId);
    updateDeal({ id: dealId, stageId: newStageId });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stages[0]) return;
    createDeal({
      title: newDeal.title,
      amountEstimate: newDeal.amountEstimate ? parseFloat(newDeal.amountEstimate) : undefined,
      stageId: stages[0].id,
      pipelineType,
      companyId: (newDeal.companyId && newDeal.companyId !== "none") ? parseInt(newDeal.companyId) : undefined,
    } as any, {
      onSuccess: () => {
        setIsCreateOpen(false);
        setNewDeal({ title: "", amountEstimate: "", companyId: "" });
        setSearchTerm("");
      }
    });
  };

  const deleteStage = async (stageId: number) => {
    try {
      await apiRequest("DELETE", `/api/crm/stages/${stageId}`);
      setConfirmDeleteStageId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/stages"] });
      toast({ title: "Coluna removida" });
    } catch (err: any) {
      setConfirmDeleteStageId(null);
      const msg = await err?.response?.json?.().then((d: any) => d.message).catch(() => "Erro ao remover coluna");
      toast({ title: msg || "Remova todos os deals antes de excluir a coluna", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen p-3 md:p-4 lg:p-6 gap-3 md:gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 shrink-0">
        <div>
          <h1 className="text-lg md:text-xl font-bold">CRM</h1>
          <p className="text-xs md:text-sm text-muted-foreground">Pipeline de deals</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <Tabs value={pipelineType} onValueChange={v => setPipelineType(v as any)}>
            <TabsList>
              <TabsTrigger value="INVESTOR" data-testid="tab-investor">
                <DollarSign className="w-3.5 h-3.5 mr-1.5" /> Investidor
              </TabsTrigger>
              <TabsTrigger value="ASSET" data-testid="tab-asset">
                <Building2 className="w-3.5 h-3.5 mr-1.5" /> Ativo
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              placeholder="Buscar deal..."
              value={dealSearch}
              onChange={e => setDealSearch(e.target.value)}
              className="pl-8 h-8 text-sm w-36 border border-input rounded-md bg-background px-3 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
              data-testid="input-deal-search"
            />
          </div>
          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger className="h-8 text-sm w-32" data-testid="select-filter-priority">
              <SelectValue placeholder="Prioridade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Prioridade</SelectItem>
              <SelectItem value="low">Baixa</SelectItem>
              <SelectItem value="medium">Média</SelectItem>
              <SelectItem value="high">Alta</SelectItem>
              <SelectItem value="urgent">Urgente</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative">
            <input
              placeholder="Label..."
              value={filterLabel}
              onChange={e => setFilterLabel(e.target.value)}
              className="h-8 text-sm w-24 border border-input rounded-md bg-background px-3 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
              data-testid="input-filter-label"
            />
          </div>
          {hasActiveFilters && (
            <button
              onClick={() => { setDealSearch(""); setFilterPriority("all"); setFilterLabel(""); }}
              className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 border rounded-md hover:border-primary/50 transition-colors"
              data-testid="button-clear-deal-filters"
            >
              <X className="w-3.5 h-3.5" /> Limpar
            </button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-export-deals">
                <Download className="w-4 h-4 mr-1.5" /> Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => window.open(`/api/export/deals?format=xlsx&pipelineType=${pipelineType}`, "_blank")} data-testid="export-deals-xlsx">
                Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(`/api/export/deals?format=csv&pipelineType=${pipelineType}`, "_blank")} data-testid="export-deals-csv">
                CSV (.csv)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-create-deal">
                <Plus className="w-4 h-4 mr-1.5" /> Novo Deal
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Novo Deal — {pipelineType === "INVESTOR" ? "Investidor" : "Ativo"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Título do Deal *</Label>
                  <Input
                    required
                    data-testid="input-deal-title"
                    value={newDeal.title}
                    onChange={e => setNewDeal({ ...newDeal, title: e.target.value })}
                    placeholder="ex: Fundo Alpha — Fazenda MT"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Valor Estimado (R$)</Label>
                  <Input
                    data-testid="input-deal-amount"
                    type="number"
                    value={newDeal.amountEstimate}
                    onChange={e => setNewDeal({ ...newDeal, amountEstimate: e.target.value })}
                    placeholder="5000000"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Empresa Relacionada</Label>
                  <Select
                    value={newDeal.companyId}
                    onValueChange={v => setNewDeal({ ...newDeal, companyId: v })}
                  >
                    <SelectTrigger data-testid="select-deal-company">
                      <SelectValue placeholder="Selecione uma empresa (opcional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <div className="flex items-center px-2 pb-2">
                        <Search className="w-4 h-4 mr-2 text-muted-foreground" />
                        <Input
                          placeholder="Buscar empresa..."
                          className="h-8"
                          value={searchTerm}
                          onChange={e => setSearchTerm(e.target.value)}
                        />
                      </div>
                      <SelectItem value="none">Nenhuma</SelectItem>
                      {filteredCompanies.map(c => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.tradeName || c.legalName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" className="w-full" disabled={isCreating} data-testid="button-save-deal">
                  Criar Deal
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <KanbanBoard
        stages={stages}
        filteredDeals={filteredDeals}
        companies={companies || []}
        assetsById={assetsById}
        pipelineType={pipelineType}
        onDealClick={setSelectedDealId}
        onDragEnd={onDragEnd}
        onDeleteStage={id => setConfirmDeleteStageId(id)}
        onStageCreated={() => refetchStages()}
      />

      <DealDetailPanel
        dealId={selectedDealId}
        open={!!selectedDealId}
        onClose={() => setSelectedDealId(null)}
        assetsById={assetsById}
      />

      <AlertDialog open={confirmDeleteStageId !== null} onOpenChange={o => !o && setConfirmDeleteStageId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir coluna?</AlertDialogTitle>
            <AlertDialogDescription>
              A coluna vazia será removida permanentemente do pipeline.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDeleteStageId && deleteStage(confirmDeleteStageId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
