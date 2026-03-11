import { useState, useMemo } from "react";
import { useAssets, useInvestors, useSuggestions, useRunMatching } from "@/hooks/use-matching";
import { useStages } from "@/hooks/use-crm";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Zap, MapPin, Loader2, RefreshCw, Plus, Building2, User, CheckCircle2, XCircle, Search, Handshake, ExternalLink, Trash2, Pencil, Sparkles, ChevronDown, ChevronRight, DollarSign } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";

function AddAssetDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", type: "TERRA", location: "", priceAsking: "" });
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", api.matching.assets.create.path, data),
    onSuccess: () => {
      toast({ title: "Ativo cadastrado com sucesso" });
      setOpen(false);
      setForm({ title: "", type: "TERRA", location: "", priceAsking: "" });
      onSuccess();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-add-asset">
          <Plus className="w-4 h-4 mr-2" /> Adicionar Ativo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo Ativo</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Título</Label>
            <Input data-testid="input-asset-title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Fazenda 500ha - GO" />
          </div>
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
              <SelectTrigger data-testid="select-asset-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TERRA">Terra / Fazenda</SelectItem>
                <SelectItem value="MINA">Mineração</SelectItem>
                <SelectItem value="NEGOCIO">Negócio / M&A</SelectItem>
                <SelectItem value="FII_CRI">FII / CRI</SelectItem>
                <SelectItem value="DESENVOLVIMENTO">Desenvolvimento Imobiliário</SelectItem>
                <SelectItem value="AGRO">Agronegócio</SelectItem>
                <SelectItem value="ENERGIA">Energia Renovável</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Localização</Label>
            <Input data-testid="input-asset-location" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Goiás" />
          </div>
          <div className="space-y-2">
            <Label>Preço Pedido (R$)</Label>
            <Input data-testid="input-asset-price" type="number" value={form.priceAsking} onChange={e => setForm({ ...form, priceAsking: e.target.value })} placeholder="5000000" />
          </div>
          <Button
            className="w-full"
            data-testid="button-save-asset"
            disabled={mutation.isPending || !form.title}
            onClick={() => mutation.mutate({ title: form.title, type: form.type, location: form.location || null, priceAsking: form.priceAsking ? Number(form.priceAsking) : null })}
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Salvar Ativo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AiSuggestionBanner({ suggestion, onApply, onDismiss }: {
  suggestion: { assetTypes: string[]; ticketMin: number | null; ticketMax: number | null; regionsOfInterest: string[]; buyerType: string; reasoning: string };
  onApply: () => void;
  onDismiss: () => void;
}) {
  const typeLabels: Record<string, string> = { TERRA: "Terra", MINA: "Mineração", NEGOCIO: "M&A", FII_CRI: "FII/CRI", DESENVOLVIMENTO: "Desenv.", AGRO: "Agro", ENERGIA: "Energia" };
  const fmtBRL = (v: number | null) => v ? `R$ ${(v / 1e6).toFixed(1)}M` : "—";
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
        <Sparkles className="w-4 h-4" /> Sugestão da IA (revise antes de aceitar)
      </div>
      <p className="text-xs text-amber-700 dark:text-amber-400 italic">{suggestion.reasoning}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-amber-900 dark:text-amber-200">
        <span className="font-medium">Tipos:</span>
        <span>{suggestion.assetTypes.map(t => typeLabels[t] || t).join(", ") || "—"}</span>
        <span className="font-medium">Ticket:</span>
        <span>{fmtBRL(suggestion.ticketMin)} – {fmtBRL(suggestion.ticketMax)}</span>
        <span className="font-medium">Regiões:</span>
        <span>{suggestion.regionsOfInterest.join(", ") || "—"}</span>
        <span className="font-medium">Tipo comprador:</span>
        <span>{suggestion.buyerType === "financeiro" ? "Financeiro" : "Estratégico"}</span>
      </div>
      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="outline" className="text-xs h-7 border-amber-400" data-testid="button-apply-ai-suggestion" onClick={onApply}>
          <CheckCircle2 className="w-3 h-3 mr-1" /> Aplicar sugestão
        </Button>
        <Button size="sm" variant="ghost" className="text-xs h-7" data-testid="button-dismiss-ai-suggestion" onClick={onDismiss}>
          <XCircle className="w-3 h-3 mr-1" /> Ignorar
        </Button>
      </div>
    </div>
  );
}

function AddInvestorDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", companyId: "", types: "TERRA,MINA", ticketMin: "", ticketMax: "", regions: "", buyerType: "financeiro", cnaeInteresse: "", prazoDecisao: "" });
  const [aiSuggestion, setAiSuggestion] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: availableCompanies } = useQuery({
    queryKey: ["/api/matching/companies-available"],
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", api.matching.investors.create.path, data),
    onSuccess: () => {
      toast({ title: "Perfil de investidor cadastrado" });
      setOpen(false);
      setForm({ name: "", companyId: "", types: "TERRA,MINA", ticketMin: "", ticketMax: "", regions: "", buyerType: "financeiro", cnaeInteresse: "", prazoDecisao: "" });
      setAiSuggestion(null);
      queryClient.invalidateQueries({ queryKey: ["/api/matching/companies-available"] });
      onSuccess();
    },
    onError: () => {
      toast({ title: "Erro ao cadastrar investidor", variant: "destructive" });
    },
  });

  const aiRequestRef = { current: 0 };

  const fetchAiSuggestion = async (companyId: string) => {
    const requestId = ++aiRequestRef.current;
    setAiLoading(true);
    setAiSuggestion(null);
    try {
      const res = await apiRequest("POST", `/api/matching/suggest-profile/${companyId}`);
      const data = await res.json();
      if (requestId === aiRequestRef.current) {
        setAiSuggestion(data);
      }
    } catch {
      if (requestId === aiRequestRef.current) {
        toast({ title: "Não foi possível gerar sugestão", variant: "destructive" });
      }
    } finally {
      if (requestId === aiRequestRef.current) {
        setAiLoading(false);
      }
    }
  };

  const applyAiSuggestion = () => {
    if (!aiSuggestion) return;
    setForm(prev => ({
      ...prev,
      types: aiSuggestion.assetTypes.join(", "),
      ticketMin: aiSuggestion.ticketMin ? String(aiSuggestion.ticketMin) : "",
      ticketMax: aiSuggestion.ticketMax ? String(aiSuggestion.ticketMax) : "",
      regions: aiSuggestion.regionsOfInterest.join(", "),
      buyerType: aiSuggestion.buyerType || "financeiro",
    }));
    setAiSuggestion(null);
    toast({ title: "Sugestão aplicada — revise e ajuste os valores antes de salvar" });
  };

  const handleCompanySelect = (companyIdStr: string) => {
    if (companyIdStr === "none") {
      setForm({ ...form, companyId: "", name: form.name });
      setAiSuggestion(null);
      return;
    }
    const company = (availableCompanies as any[])?.find((c: any) => String(c.id) === companyIdStr);
    if (company) {
      setForm({
        ...form,
        companyId: companyIdStr,
        name: company.tradeName || company.legalName,
      });
      fetchAiSuggestion(companyIdStr);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setAiSuggestion(null); setAiLoading(false); } }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-add-investor">
          <Plus className="w-4 h-4 mr-2" /> Adicionar Investidor
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo Perfil de Investidor</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Vincular a empresa cadastrada (opcional)</Label>
            <Select value={form.companyId || "none"} onValueChange={handleCompanySelect}>
              <SelectTrigger data-testid="select-investor-company">
                <SelectValue placeholder="Selecionar empresa..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem vínculo (investidor avulso)</SelectItem>
                {(availableCompanies as any[])?.map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.tradeName || c.legalName} {c.cnpj ? `(${c.cnpj})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {aiLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Analisando empresa para sugerir perfil...
            </div>
          )}
          {aiSuggestion && !aiLoading && (
            <AiSuggestionBanner suggestion={aiSuggestion} onApply={applyAiSuggestion} onDismiss={() => setAiSuggestion(null)} />
          )}
          <div className="space-y-2">
            <Label>Nome / Fundo</Label>
            <Input data-testid="input-investor-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Fundo Capital Verde" />
          </div>
          <div className="space-y-2">
            <Label>Tipos de Ativo (separar por vírgula)</Label>
            <Input data-testid="input-investor-types" value={form.types} onChange={e => setForm({ ...form, types: e.target.value })} placeholder="TERRA, MINA, NEGOCIO, FII_CRI, AGRO" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Ticket Mínimo (R$)</Label>
              <Input data-testid="input-investor-ticketmin" type="number" value={form.ticketMin} onChange={e => setForm({ ...form, ticketMin: e.target.value })} placeholder="1000000" />
            </div>
            <div className="space-y-2">
              <Label>Ticket Máximo (R$)</Label>
              <Input data-testid="input-investor-ticketmax" type="number" value={form.ticketMax} onChange={e => setForm({ ...form, ticketMax: e.target.value })} placeholder="20000000" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Regiões de Interesse (separar por vírgula)</Label>
            <Input data-testid="input-investor-regions" value={form.regions} onChange={e => setForm({ ...form, regions: e.target.value })} placeholder="Mato Grosso, Minas Gerais" />
          </div>
          <div className="space-y-2">
            <Label>Tipo de comprador</Label>
            <Select value={form.buyerType || "financeiro"} onValueChange={v => setForm({ ...form, buyerType: v })}>
              <SelectTrigger data-testid="select-buyer-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="financeiro">Investidor financeiro (fundo, family office)</SelectItem>
                <SelectItem value="estrategico">Comprador estratégico (empresa operacional)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.buyerType === "estrategico" && (
            <div className="space-y-2">
              <Label>CNAEs de interesse (separar por vírgula)</Label>
              <Input data-testid="input-investor-cnae" value={form.cnaeInteresse || ""} onChange={e => setForm({ ...form, cnaeInteresse: e.target.value })} placeholder="ex: 0710-1, 0890-0" />
            </div>
          )}
          <div className="space-y-2">
            <Label>Prazo de decisão</Label>
            <Select value={form.prazoDecisao || ""} onValueChange={v => setForm({ ...form, prazoDecisao: v })}>
              <SelectTrigger data-testid="select-prazo-decisao"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="imediato">Imediato (até 30 dias)</SelectItem>
                <SelectItem value="3_meses">Até 3 meses</SelectItem>
                <SelectItem value="6_meses">Até 6 meses</SelectItem>
                <SelectItem value="12_meses">Até 12 meses</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            className="w-full"
            data-testid="button-save-investor"
            disabled={mutation.isPending || !form.name}
            onClick={() => mutation.mutate({
              name: form.name,
              companyId: form.companyId ? Number(form.companyId) : null,
              assetTypes: form.types.split(",").map(t => t.trim()).filter(Boolean),
              ticketMin: form.ticketMin ? Number(form.ticketMin) : null,
              ticketMax: form.ticketMax ? Number(form.ticketMax) : null,
              regionsOfInterest: form.regions.split(",").map(r => r.trim()).filter(Boolean),
              buyerType: form.buyerType || "financeiro",
              cnaeInteresse: form.cnaeInteresse ? form.cnaeInteresse.split(",").map(c => c.trim()).filter(Boolean) : [],
              prazoDecisao: form.prazoDecisao || null,
            })}
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Salvar Investidor
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditInvestorDialog({ investor, onSuccess }: { investor: any; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: investor.name || "",
    types: (investor.assetTypes as string[])?.join(", ") || "",
    ticketMin: investor.ticketMin ? String(investor.ticketMin) : "",
    ticketMax: investor.ticketMax ? String(investor.ticketMax) : "",
    regions: (investor.regionsOfInterest as string[])?.join(", ") || "",
    buyerType: investor.buyerType || "financeiro",
    cnaeInteresse: (investor.cnaeInteresse as string[])?.join(", ") || "",
    prazoDecisao: investor.prazoDecisao || "",
  });
  const [aiSuggestion, setAiSuggestion] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/matching/investors/${investor.id}`, data),
    onSuccess: () => {
      toast({ title: "Investidor atualizado com sucesso" });
      setOpen(false);
      setAiSuggestion(null);
      queryClient.invalidateQueries({ queryKey: [api.matching.investors.list.path] });
      onSuccess();
    },
    onError: () => {
      toast({ title: "Erro ao atualizar investidor", variant: "destructive" });
    },
  });

  const fetchAiSuggestion = async () => {
    if (!investor.companyId) return;
    setAiLoading(true);
    setAiSuggestion(null);
    try {
      const res = await apiRequest("POST", `/api/matching/suggest-profile/${investor.companyId}`);
      const data = await res.json();
      setAiSuggestion(data);
    } catch {
      toast({ title: "Não foi possível gerar sugestão", variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  };

  const applyAiSuggestion = () => {
    if (!aiSuggestion) return;
    setForm(prev => ({
      ...prev,
      types: aiSuggestion.assetTypes.join(", "),
      ticketMin: aiSuggestion.ticketMin ? String(aiSuggestion.ticketMin) : "",
      ticketMax: aiSuggestion.ticketMax ? String(aiSuggestion.ticketMax) : "",
      regions: aiSuggestion.regionsOfInterest.join(", "),
      buyerType: aiSuggestion.buyerType || "financeiro",
    }));
    setAiSuggestion(null);
    toast({ title: "Sugestão aplicada — revise e ajuste os valores antes de salvar" });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => {
      setOpen(v);
      if (v) {
        setForm({
          name: investor.name || "",
          types: (investor.assetTypes as string[])?.join(", ") || "",
          ticketMin: investor.ticketMin ? String(investor.ticketMin) : "",
          ticketMax: investor.ticketMax ? String(investor.ticketMax) : "",
          regions: (investor.regionsOfInterest as string[])?.join(", ") || "",
          buyerType: investor.buyerType || "financeiro",
          cnaeInteresse: (investor.cnaeInteresse as string[])?.join(", ") || "",
          prazoDecisao: investor.prazoDecisao || "",
        });
        setAiSuggestion(null);
      }
    }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" data-testid={`button-edit-investor-${investor.id}`}>
          <Pencil className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Investidor</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {investor.companyId && (
            <div className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                data-testid="button-edit-ai-suggest"
                disabled={aiLoading}
                onClick={fetchAiSuggestion}
              >
                {aiLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                Sugerir preenchimento com IA
              </Button>
              {aiSuggestion && !aiLoading && (
                <AiSuggestionBanner suggestion={aiSuggestion} onApply={applyAiSuggestion} onDismiss={() => setAiSuggestion(null)} />
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label>Nome / Fundo</Label>
            <Input data-testid="input-edit-investor-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Tipos de Ativo (separar por vírgula)</Label>
            <Input data-testid="input-edit-investor-types" value={form.types} onChange={e => setForm({ ...form, types: e.target.value })} placeholder="TERRA, MINA, NEGOCIO" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Ticket Mínimo (R$)</Label>
              <Input data-testid="input-edit-investor-ticketmin" type="number" value={form.ticketMin} onChange={e => setForm({ ...form, ticketMin: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Ticket Máximo (R$)</Label>
              <Input data-testid="input-edit-investor-ticketmax" type="number" value={form.ticketMax} onChange={e => setForm({ ...form, ticketMax: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Regiões de Interesse (separar por vírgula)</Label>
            <Input data-testid="input-edit-investor-regions" value={form.regions} onChange={e => setForm({ ...form, regions: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Tipo de comprador</Label>
            <Select value={form.buyerType || "financeiro"} onValueChange={v => setForm({ ...form, buyerType: v })}>
              <SelectTrigger data-testid="select-edit-buyer-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="financeiro">Investidor financeiro (fundo, family office)</SelectItem>
                <SelectItem value="estrategico">Comprador estratégico (empresa operacional)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.buyerType === "estrategico" && (
            <div className="space-y-2">
              <Label>CNAEs de interesse (separar por vírgula)</Label>
              <Input data-testid="input-edit-investor-cnae" value={form.cnaeInteresse} onChange={e => setForm({ ...form, cnaeInteresse: e.target.value })} />
            </div>
          )}
          <div className="space-y-2">
            <Label>Prazo de decisão</Label>
            <Select value={form.prazoDecisao || "none"} onValueChange={v => setForm({ ...form, prazoDecisao: v === "none" ? "" : v })}>
              <SelectTrigger data-testid="select-edit-prazo-decisao"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Não definido</SelectItem>
                <SelectItem value="imediato">Imediato (até 30 dias)</SelectItem>
                <SelectItem value="3_meses">Até 3 meses</SelectItem>
                <SelectItem value="6_meses">Até 6 meses</SelectItem>
                <SelectItem value="12_meses">Até 12 meses</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-edit-investor">Cancelar</Button>
          <Button
            data-testid="button-save-edit-investor"
            disabled={mutation.isPending || !form.name}
            onClick={() => mutation.mutate({
              name: form.name,
              assetTypes: form.types.split(",").map(t => t.trim()).filter(Boolean),
              ticketMin: form.ticketMin ? Number(form.ticketMin) : null,
              ticketMax: form.ticketMax ? Number(form.ticketMax) : null,
              regionsOfInterest: form.regions.split(",").map(r => r.trim()).filter(Boolean),
              buyerType: form.buyerType || "financeiro",
              cnaeInteresse: form.cnaeInteresse ? form.cnaeInteresse.split(",").map(c => c.trim()).filter(Boolean) : [],
              prazoDecisao: form.prazoDecisao || null,
            })}
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditAssetDialog({ asset, onSuccess }: { asset: any; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: asset.title || "", type: asset.type || "TERRA", location: asset.location || "", priceAsking: asset.priceAsking ? String(asset.priceAsking) : "" });
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/matching/assets/${asset.id}`, data),
    onSuccess: () => {
      toast({ title: "Ativo atualizado com sucesso" });
      setOpen(false);
      onSuccess();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => {
      setOpen(v);
      if (v) setForm({ title: asset.title || "", type: asset.type || "TERRA", location: asset.location || "", priceAsking: asset.priceAsking ? String(asset.priceAsking) : "" });
    }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" data-testid={`button-edit-asset-${asset.id}`}>
          <Pencil className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Ativo</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Título</Label>
            <Input data-testid="input-edit-asset-title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
              <SelectTrigger data-testid="select-edit-asset-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TERRA">Terra / Fazenda</SelectItem>
                <SelectItem value="MINA">Mineração</SelectItem>
                <SelectItem value="NEGOCIO">Negócio / M&A</SelectItem>
                <SelectItem value="FII_CRI">FII / CRI</SelectItem>
                <SelectItem value="DESENVOLVIMENTO">Desenvolvimento Imobiliário</SelectItem>
                <SelectItem value="AGRO">Agronegócio</SelectItem>
                <SelectItem value="ENERGIA">Energia Renovável</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Localização</Label>
            <Input data-testid="input-edit-asset-location" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Preço Pedido (R$)</Label>
            <Input data-testid="input-edit-asset-price" type="number" value={form.priceAsking} onChange={e => setForm({ ...form, priceAsking: e.target.value })} />
          </div>
          <Button
            className="w-full"
            data-testid="button-save-edit-asset"
            disabled={mutation.isPending || !form.title}
            onClick={() => mutation.mutate({ title: form.title, type: form.type, location: form.location || null, priceAsking: form.priceAsking ? Number(form.priceAsking) : null })}
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Salvar Alterações
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ScoreBar({ score }: { score: number }) {
  const colorClass = score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="space-y-1 w-full">
      <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <span>Match Score</span>
        <span>{score}%</span>
      </div>
      <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
        <div 
          className={`h-full ${colorClass} transition-all duration-500`} 
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

function ScoreCategoryBadge({ score }: { score: number }) {
  if (score >= 85) return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-[10px]" data-testid="badge-score-category">Excelente</Badge>;
  if (score >= 65) return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800 text-[10px]" data-testid="badge-score-category">Bom</Badge>;
  return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800 text-[10px]" data-testid="badge-score-category">Regular</Badge>;
}

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  new: { label: "Nova", variant: "outline" },
  accepted: { label: "Aceita", variant: "default" },
  rejected: { label: "Rejeitada", variant: "destructive" },
};

function CreateDealFromMatchDialog({ match, onDealCreated }: {
  match: any;
  onDealCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: stages } = useStages();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const investorStages = useMemo(() =>
    (stages || []).filter((s: any) => s.pipelineType === "INVESTOR"),
    [stages]
  );

  const defaultTitle = `Match: ${match.asset.title} ↔ ${match.investor.name}`;
  const [form, setForm] = useState({
    title: defaultTitle,
    stageId: "",
    value: match.asset.priceAsking ? String(match.asset.priceAsking) : "",
  });

  const createDeal = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/matching/suggestions/${match.id}/accept`, {
        title: form.title,
        stageId: Number(form.stageId),
        value: form.value ? Number(form.value) : null,
      });
    },
    onSuccess: () => {
      toast({ title: "Deal criado com sucesso", description: "O match foi aceito e um deal foi criado no pipeline Investidor." });
      queryClient.invalidateQueries({ queryKey: [api.matching.suggestions.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.crm.deals.list.path] });
      setOpen(false);
      onDealCreated();
    },
    onError: () => {
      toast({ title: "Erro ao criar deal", description: "Tente novamente.", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => {
      setOpen(v);
      if (v) setForm({ title: defaultTitle, stageId: investorStages[0]?.id?.toString() || "", value: match.asset.priceAsking ? String(match.asset.priceAsking) : "" });
    }}>
      <DialogTrigger asChild>
        <Button
          className="w-full h-8"
          size="sm"
          data-testid={`button-accept-match-${match.id}`}
          disabled={match.status === "accepted"}
        >
          {match.status === "accepted" ? (
            <><Handshake className="w-4 h-4 mr-1" /> Deal Criado</>
          ) : (
            <><CheckCircle2 className="w-4 h-4 mr-1" /> Aceitar & Criar Deal</>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Handshake className="w-5 h-5 text-primary" />
            Criar Deal a partir do Match
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="p-3 rounded-lg bg-muted/50 border text-sm space-y-1">
            <p><span className="font-medium">Ativo:</span> {match.asset.title} ({match.asset.type})</p>
            <p><span className="font-medium">Investidor:</span> {match.investor.name}</p>
            <p><span className="font-medium">Score:</span> {match.score}%</p>
          </div>
          <div className="space-y-2">
            <Label>Título do Deal</Label>
            <Input
              data-testid="input-deal-title"
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Etapa do Pipeline (Investidor)</Label>
            <Select value={form.stageId} onValueChange={v => setForm({ ...form, stageId: v })}>
              <SelectTrigger data-testid="select-deal-stage">
                <SelectValue placeholder="Selecionar etapa..." />
              </SelectTrigger>
              <SelectContent>
                {investorStages.map((s: any) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Valor Estimado (R$)</Label>
            <Input
              data-testid="input-deal-value"
              type="number"
              value={form.value}
              onChange={e => setForm({ ...form, value: e.target.value })}
              placeholder="5000000"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-deal">
            Cancelar
          </Button>
          <Button
            onClick={() => createDeal.mutate()}
            disabled={createDeal.isPending || !form.stageId || !form.title}
            data-testid="button-confirm-deal"
          >
            {createDeal.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Handshake className="w-4 h-4 mr-2" />}
            Criar Deal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MatchingPage() {
  const queryClient = useQueryClient();
  const { data: suggestions, isLoading: loadingSuggestions } = useSuggestions();
  const { data: assets } = useAssets();
  const { data: investors } = useInvestors();
  const { mutate: runMatching, isPending: isRunning } = useRunMatching();

  const [minScore, setMinScore] = useState(0);
  const [matchStatus, setMatchStatus] = useState("all");
  const [matchType, setMatchType] = useState("all");
  const [assetSearch, setAssetSearch] = useState("");
  const [investorSearch, setInvestorSearch] = useState("");

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: [api.matching.assets.list.path] });
    queryClient.invalidateQueries({ queryKey: [api.matching.investors.list.path] });
    queryClient.invalidateQueries({ queryKey: [api.matching.suggestions.list.path] });
  };

  const updateSuggestion = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/matching/suggestions/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.matching.suggestions.list.path] }),
  });

  const deleteSuggestion = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/matching/suggestions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.matching.suggestions.list.path] }),
  });

  const deleteAsset = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/matching/assets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.matching.assets.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.matching.suggestions.list.path] });
    },
  });

  const deleteInvestor = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/matching/investors/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.matching.investors.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.matching.suggestions.list.path] });
      toast({ title: "Investidor removido com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao remover investidor", variant: "destructive" });
    },
  });

  const { toast } = useToast();

  const [expandedAssets, setExpandedAssets] = useState<Set<number>>(new Set());

  const toggleAssetExpand = (assetId: number) => {
    setExpandedAssets(prev => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  const expandAll = () => {
    const allIds = new Set(groupedByAsset.map(g => g.asset.id));
    setExpandedAssets(allIds);
  };

  const collapseAll = () => setExpandedAssets(new Set());

  const filteredSuggestions = useMemo(() => {
    if (!suggestions) return [];
    return suggestions.filter(m => {
      if ((m.score || 0) < minScore) return false;
      if (matchStatus !== "all" && m.status !== matchStatus) return false;
      if (matchType !== "all" && m.asset.type !== matchType) return false;
      return true;
    });
  }, [suggestions, minScore, matchStatus, matchType]);

  const groupedByAsset = useMemo(() => {
    const groups: Record<number, { asset: any; matches: any[] }> = {};
    for (const m of filteredSuggestions) {
      if (!groups[m.asset.id]) {
        groups[m.asset.id] = { asset: m.asset, matches: [] };
      }
      groups[m.asset.id].matches.push(m);
    }
    const sorted = Object.values(groups).sort((a, b) => {
      const aMax = Math.max(...a.matches.map(m => m.score || 0));
      const bMax = Math.max(...b.matches.map(m => m.score || 0));
      return bMax - aMax;
    });
    for (const g of sorted) {
      g.matches.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
    }
    return sorted;
  }, [filteredSuggestions]);

  const filteredAssets = useMemo(() => {
    if (!assets) return [];
    if (!assetSearch.trim()) return assets;
    const q = assetSearch.toLowerCase();
    return assets.filter(a =>
      a.title?.toLowerCase().includes(q) ||
      a.location?.toLowerCase().includes(q) ||
      a.type?.toLowerCase().includes(q)
    );
  }, [assets, assetSearch]);

  const filteredInvestors = useMemo(() => {
    if (!investors) return [];
    if (!investorSearch.trim()) return investors;
    const q = investorSearch.toLowerCase();
    return investors.filter(i => i.name?.toLowerCase().includes(q));
  }, [investors, investorSearch]);

  const stats = useMemo(() => {
    if (!suggestions) return { total: 0, accepted: 0, rejected: 0, pending: 0, avgScore: 0 };
    const accepted = suggestions.filter(s => s.status === "accepted").length;
    const rejected = suggestions.filter(s => s.status === "rejected").length;
    const pending = suggestions.filter(s => s.status === "new").length;
    const avgScore = suggestions.length > 0 ? Math.round(suggestions.reduce((sum, s) => sum + (s.score || 0), 0) / suggestions.length) : 0;
    return { total: suggestions.length, accepted, rejected, pending, avgScore };
  }, [suggestions]);

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold" data-testid="text-page-title">Deal Matching</h1>
          <p className="text-muted-foreground mt-1 text-sm">Motor de sugestão entre ativos e investidores.</p>
        </div>
        <Button
          onClick={() => runMatching()}
          disabled={isRunning}
          className="shadow-lg shadow-primary/25 self-start sm:self-auto"
          data-testid="button-run-matching"
        >
          {isRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
          Executar Matching
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3">
          <p className="text-[10px] uppercase font-bold text-muted-foreground">Total Matches</p>
          <p className="text-2xl font-bold" data-testid="text-stat-total">{stats.total}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] uppercase font-bold text-muted-foreground">Pendentes</p>
          <p className="text-2xl font-bold text-amber-600" data-testid="text-stat-pending">{stats.pending}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] uppercase font-bold text-muted-foreground">Aceitas</p>
          <p className="text-2xl font-bold text-emerald-600" data-testid="text-stat-accepted">{stats.accepted}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] uppercase font-bold text-muted-foreground">Rejeitadas</p>
          <p className="text-2xl font-bold text-red-600" data-testid="text-stat-rejected">{stats.rejected}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] uppercase font-bold text-muted-foreground">Score Médio</p>
          <p className="text-2xl font-bold text-primary" data-testid="text-stat-avg">{stats.avgScore}%</p>
        </Card>
      </div>

      <Tabs defaultValue="suggestions" className="w-full">
        <div className="overflow-x-auto">
          <TabsList className="mb-6 w-max min-w-full">
            <TabsTrigger value="suggestions" data-testid="tab-suggestions">Sugestões ({suggestions?.length || 0})</TabsTrigger>
            <TabsTrigger value="assets" data-testid="tab-assets">Ativos ({assets?.length || 0})</TabsTrigger>
            <TabsTrigger value="investors" data-testid="tab-investors">Investidores ({investors?.length || 0})</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="suggestions" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={String(minScore)} onValueChange={v => setMinScore(Number(v))}>
              <SelectTrigger className="h-8 text-sm w-40" data-testid="select-min-score">
                <SelectValue placeholder="Score mínimo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Qualquer score</SelectItem>
                <SelectItem value="30">Score ≥ 30%</SelectItem>
                <SelectItem value="50">Score ≥ 50%</SelectItem>
                <SelectItem value="70">Score ≥ 70%</SelectItem>
                <SelectItem value="80">Score ≥ 80%</SelectItem>
                <SelectItem value="90">Score ≥ 90%</SelectItem>
              </SelectContent>
            </Select>
            <Select value={matchStatus} onValueChange={setMatchStatus}>
              <SelectTrigger className="h-8 text-sm w-36" data-testid="select-match-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos status</SelectItem>
                <SelectItem value="new">Novas</SelectItem>
                <SelectItem value="accepted">Aceitas</SelectItem>
                <SelectItem value="rejected">Rejeitadas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={matchType} onValueChange={setMatchType}>
              <SelectTrigger className="h-8 text-sm w-36" data-testid="select-match-type">
                <SelectValue placeholder="Tipo ativo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos tipos</SelectItem>
                <SelectItem value="TERRA">Terra / Fazenda</SelectItem>
                <SelectItem value="MINA">Mineração</SelectItem>
                <SelectItem value="NEGOCIO">Negócio M&A</SelectItem>
                <SelectItem value="FII_CRI">FII / CRI</SelectItem>
                <SelectItem value="AGRO">Agronegócio</SelectItem>
                <SelectItem value="ENERGIA">Energia</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-1 ml-auto">
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={expandAll} data-testid="button-expand-all">
                Expandir todos
              </Button>
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={collapseAll} data-testid="button-collapse-all">
                Recolher
              </Button>
            </div>
            {(minScore > 0 || matchStatus !== "all" || matchType !== "all") && (
              <span className="text-xs text-muted-foreground w-full">
                {filteredSuggestions.length} matches em {groupedByAsset.length} ativos (de {suggestions?.length || 0} total)
              </span>
            )}
          </div>
          {loadingSuggestions ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : suggestions?.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-xl">
              <RefreshCw className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium">Nenhum match encontrado ainda.</p>
              <p className="text-sm mt-1">Cadastre ativos e investidores e clique em "Executar Matching".</p>
            </div>
          ) : filteredSuggestions.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground border-2 border-dashed rounded-xl">
              <p>Nenhum match com os filtros selecionados.</p>
              <button onClick={() => { setMinScore(0); setMatchStatus("all"); setMatchType("all"); }} className="mt-2 text-xs text-primary underline" data-testid="button-clear-filters">Limpar filtros</button>
            </div>
          ) : (
            <div className="space-y-2">
              {groupedByAsset.map(({ asset, matches }) => {
                const isExpanded = expandedAssets.has(asset.id);
                const bestScore = Math.max(...matches.map(m => m.score || 0));
                const acceptedCount = matches.filter(m => m.status === "accepted").length;
                const pendingCount = matches.filter(m => m.status === "new").length;
                return (
                  <div key={asset.id} data-testid={`group-asset-${asset.id}`} className="border rounded-xl overflow-hidden bg-card">
                    <button
                      onClick={() => toggleAssetExpand(asset.id)}
                      className="w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors text-left"
                      data-testid={`button-toggle-asset-${asset.id}`}
                    >
                      <div className="shrink-0 text-muted-foreground">
                        {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-sm truncate">{asset.title}</h3>
                          <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-[10px] shrink-0">
                            {asset.type}
                          </Badge>
                          <a
                            href={`/ativos/${asset.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="opacity-40 hover:opacity-100 transition-opacity shrink-0"
                            title="Abrir ativo"
                            data-testid={`link-asset-detail-${asset.id}`}
                            onClick={e => e.stopPropagation()}
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                          {asset.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" />{asset.location}
                            </span>
                          )}
                          {asset.priceAsking && (
                            <span className="flex items-center gap-1 text-emerald-600 font-medium">
                              <DollarSign className="w-3 h-3" />R$ {(asset.priceAsking / 1e6).toFixed(1)}M
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <div className="flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-sm font-bold">{matches.length}</span>
                            <span className="text-xs text-muted-foreground">{matches.length === 1 ? "investidor" : "investidores"}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 justify-end">
                            <span className="text-[10px] text-muted-foreground">melhor:</span>
                            <span className={`text-xs font-bold ${bestScore >= 80 ? "text-emerald-600" : bestScore >= 50 ? "text-amber-600" : "text-red-500"}`}>
                              {bestScore}%
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          {acceptedCount > 0 && (
                            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-[10px]">
                              {acceptedCount} deal{acceptedCount > 1 ? "s" : ""}
                            </Badge>
                          )}
                          {pendingCount > 0 && (
                            <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 dark:text-amber-400">
                              {pendingCount} {pendingCount === 1 ? "novo" : "novos"}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t bg-muted/20">
                        <div className="divide-y">
                          {matches.map((match) => {
                            const statusInfo = STATUS_LABELS[match.status || "new"] || STATUS_LABELS.new;
                            return (
                              <div key={match.id} data-testid={`card-match-${match.id}`} className="p-4 hover:bg-muted/30 transition-colors">
                                <div className="flex items-start gap-4">
                                  <div className="w-16 shrink-0">
                                    <div className={`text-2xl font-bold text-center ${(match.score || 0) >= 80 ? "text-emerald-600" : (match.score || 0) >= 50 ? "text-amber-600" : "text-red-500"}`}>
                                      {match.score || 0}%
                                    </div>
                                    <ScoreCategoryBadge score={match.score || 0} />
                                  </div>

                                  <div className="flex-1 min-w-0 space-y-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-semibold text-sm flex items-center gap-1.5">
                                        <User className="w-3.5 h-3.5 text-muted-foreground" />
                                        {match.investor.name}
                                      </span>
                                      <Badge variant={statusInfo.variant} className="text-[10px]">
                                        {statusInfo.label}
                                      </Badge>
                                      {match.investor.buyerType && (
                                        <span className="text-[10px] text-muted-foreground">
                                          ({match.investor.buyerType === "financeiro" ? "Financeiro" : "Estratégico"})
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                                      <span className="flex items-center gap-1">
                                        <DollarSign className="w-3 h-3" />
                                        Ticket: {match.investor.ticketMin ? `R$ ${(match.investor.ticketMin / 1e6).toFixed(1)}M` : "0"} - {match.investor.ticketMax ? `${(match.investor.ticketMax / 1e6).toFixed(1)}M` : "∞"}
                                      </span>
                                      {match.investor.regionsOfInterest && (match.investor.regionsOfInterest as string[]).length > 0 && (
                                        <span className="flex items-center gap-1">
                                          <MapPin className="w-3 h-3" />
                                          {(match.investor.regionsOfInterest as string[]).join(", ")}
                                        </span>
                                      )}
                                    </div>

                                    {typeof match.reasonsJson === 'object' && match.reasonsJson !== null && (
                                      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                                        {Array.isArray((match.reasonsJson as any).reasons)
                                          ? (
                                            <>
                                              {((match.reasonsJson as any).reasons as string[]).map((reason: string, idx: number) => (
                                                <div key={`r-${idx}`} className="flex items-start gap-1.5 text-xs">
                                                  <CheckCircle2 className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />
                                                  <span className="text-foreground">{reason}</span>
                                                </div>
                                              ))}
                                              {((match.reasonsJson as any).penalties as string[] || []).map((penalty: string, idx: number) => (
                                                <div key={`p-${idx}`} className="flex items-start gap-1.5 text-xs">
                                                  <XCircle className="w-3 h-3 text-red-500 mt-0.5 shrink-0" />
                                                  <span className="text-red-600 dark:text-red-400">{penalty}</span>
                                                </div>
                                              ))}
                                            </>
                                          )
                                          : Object.entries(match.reasonsJson as Record<string, any>).map(([key, reason], idx) => (
                                            <div key={idx} className="flex items-start gap-1.5 text-xs">
                                              {reason?.valid !== false ? (
                                                <CheckCircle2 className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />
                                              ) : (
                                                <XCircle className="w-3 h-3 text-destructive mt-0.5 shrink-0" />
                                              )}
                                              <span className={reason?.valid !== false ? "text-foreground" : "text-muted-foreground line-through decoration-muted-foreground/50"}>
                                                {String(reason?.text || reason || key)}
                                              </span>
                                            </div>
                                          ))
                                        }
                                      </div>
                                    )}

                                    {match.status === "accepted" && (
                                      <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 w-fit">
                                        <Handshake className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                        <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Deal no pipeline</span>
                                        <Link href="/crm">
                                          <ExternalLink className="w-3 h-3 text-emerald-600 hover:text-emerald-800" data-testid={`link-crm-match-${match.id}`} />
                                        </Link>
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <CreateDealFromMatchDialog match={match} onDealCreated={invalidateAll} />
                                    {match.status === "rejected" ? (
                                      <Button variant="outline" size="sm" className="h-8 opacity-50" disabled data-testid={`button-reject-match-${match.id}`}>
                                        <XCircle className="w-3.5 h-3.5" />
                                      </Button>
                                    ) : (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8"
                                        data-testid={`button-reject-match-${match.id}`}
                                        onClick={() => updateSuggestion.mutate({ id: match.id, status: "rejected" })}
                                        disabled={match.status === "accepted"}
                                        title="Rejeitar"
                                      >
                                        <XCircle className="w-3.5 h-3.5" />
                                      </Button>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 px-2 text-muted-foreground hover:text-red-600"
                                      data-testid={`button-delete-match-${match.id}`}
                                      onClick={() => {
                                        if (confirm("Remover este matching permanentemente?")) {
                                          deleteSuggestion.mutate(match.id);
                                        }
                                      }}
                                      title="Excluir"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="assets">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5" /> Ativos Disponíveis</CardTitle>
                  <CardDescription>Imóveis, empresas e ativos em oferta.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Buscar ativo..."
                      value={assetSearch}
                      onChange={e => setAssetSearch(e.target.value)}
                      className="pl-8 h-8 text-sm w-40"
                      data-testid="input-asset-search"
                    />
                  </div>
                  <AddAssetDialog onSuccess={invalidateAll} />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {assets?.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">Nenhum ativo cadastrado.</p>
                ) : filteredAssets.map(asset => (
                  <div key={asset.id} data-testid={`card-asset-${asset.id}`} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors gap-3">
                    <div className="min-w-0 flex-1">
                      <h4 className="font-semibold">{asset.title}</h4>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground flex-wrap">
                        {asset.location && <span>{asset.location} •</span>}
                        <Badge variant="secondary" className="text-xs">{asset.type}</Badge>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-emerald-600">
                        {asset.priceAsking ? `R$ ${asset.priceAsking.toLocaleString("pt-BR")}` : 'A consultar'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <EditAssetDialog asset={asset} onSuccess={invalidateAll} />
                      <Button
                        variant="ghost"
                        size="icon"
                        data-testid={`button-delete-asset-${asset.id}`}
                        onClick={() => {
                          if (confirm("Remover este ativo permanentemente?")) {
                            deleteAsset.mutate(asset.id);
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="investors">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2"><User className="w-5 h-5" /> Perfis de Investidores</CardTitle>
                  <CardDescription>Compradores ativos e seus critérios de investimento.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Buscar investidor..."
                      value={investorSearch}
                      onChange={e => setInvestorSearch(e.target.value)}
                      className="pl-8 h-8 text-sm w-44"
                      data-testid="input-investor-search"
                    />
                  </div>
                  <AddInvestorDialog onSuccess={invalidateAll} />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {investors?.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">Nenhum investidor cadastrado.</p>
                ) : filteredInvestors.map(investor => (
                  <div key={investor.id} data-testid={`card-investor-${investor.id}`} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                    <div>
                      <h4 className="font-semibold">{investor.name}</h4>
                      {investor.company && (
                        <p className="text-xs text-muted-foreground mt-0.5" data-testid={`text-investor-company-${investor.id}`}>
                          <Building2 className="w-3 h-3 inline mr-1" />
                          {investor.company.tradeName || investor.company.legalName}
                          {investor.company.cnpj && <span className="ml-1 opacity-70">({investor.company.cnpj})</span>}
                        </p>
                      )}
                      <div className="flex gap-1.5 mt-1 flex-wrap">
                        {(investor.assetTypes as string[])?.map((tag: string, i: number) => (
                          <Badge key={i} variant="secondary" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                      {(investor.regionsOfInterest as string[])?.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          <MapPin className="w-3 h-3 inline mr-1" />
                          {(investor.regionsOfInterest as string[]).join(", ")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right text-sm">
                        {investor.ticketMin && (
                          <p className="font-medium text-emerald-600">
                            R$ {(investor.ticketMin / 1000000).toFixed(1)}M–{investor.ticketMax ? (investor.ticketMax / 1000000).toFixed(1) + "M" : "∞"}
                          </p>
                        )}
                      </div>
                      <EditInvestorDialog investor={investor} onSuccess={invalidateAll} />
                      <Button
                        variant="ghost"
                        size="icon"
                        data-testid={`button-delete-investor-${investor.id}`}
                        onClick={() => {
                          if (confirm("Remover este investidor permanentemente?")) {
                            deleteInvestor.mutate(investor.id);
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
