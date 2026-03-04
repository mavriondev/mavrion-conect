import { useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useStages } from "@/hooks/use-crm";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Plus, Building2, Trash2,
  Paperclip, X, Send, ExternalLink, Link2, FileText,
  Mountain, TreePine, CheckCircle2, Layers, ArrowRight,
  History, PenLine, Shuffle, CirclePlus, CircleMinus
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import MinimalEditor from "./minimal-editor";
import { PRIORITY_CONFIG, LABEL_COLORS } from "./index";
import { getSourceBadge } from "./source-utils";

function useDealDetail(dealId: number | null) {
  return useQuery({
    queryKey: ["/api/crm/deals", dealId],
    queryFn: () => dealId ? apiRequest("GET", `/api/crm/deals/${dealId}`).then(r => r.json()) : null,
    enabled: !!dealId,
  });
}

function useDealComments(dealId: number | null) {
  return useQuery({
    queryKey: ["/api/deal-comments", dealId],
    queryFn: () => dealId ? apiRequest("GET", `/api/deal-comments?dealId=${dealId}`).then(r => r.json()) : [],
    enabled: !!dealId,
  });
}

function useDealAuditLog(dealId: number | null) {
  return useQuery({
    queryKey: ["/api/audit-logs", "deal", dealId],
    queryFn: () => dealId ? apiRequest("GET", `/api/audit-logs?entity=deal&entityId=${dealId}&limit=50`).then(r => r.json()) : [],
    enabled: !!dealId,
  });
}

const ACTION_CONFIG: Record<string, { label: string; icon: typeof CirclePlus; color: string }> = {
  created: { label: "Criado", icon: CirclePlus, color: "text-emerald-600" },
  updated: { label: "Atualizado", icon: PenLine, color: "text-blue-600" },
  deleted: { label: "Excluído", icon: CircleMinus, color: "text-red-600" },
  stage_changed: { label: "Etapa alterada", icon: Shuffle, color: "text-purple-600" },
  status_changed: { label: "Status alterado", icon: Shuffle, color: "text-amber-600" },
};

function formatChange(field: string, change: { from: any; to: any }, stages: any[]) {
  if (field === "stageId") {
    const fromStage = stages.find(s => s.id === change.from);
    const toStage = stages.find(s => s.id === change.to);
    return `Movido de "${fromStage?.name || change.from}" para "${toStage?.name || change.to}"`;
  }
  if (field === "amountEstimate") {
    const fmt = (v: any) => v ? `R$ ${(Number(v) / 1000).toFixed(0)}k` : "N/A";
    return `Valor: ${fmt(change.from)} → ${fmt(change.to)}`;
  }
  if (field === "priority") {
    const labels: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta", urgent: "Urgente" };
    return `Prioridade: ${labels[change.from] || change.from} → ${labels[change.to] || change.to}`;
  }
  if (field === "probability") {
    return `Probabilidade: ${change.from || 0}% → ${change.to || 0}%`;
  }
  if (field === "title") {
    return `Título: "${change.from}" → "${change.to}"`;
  }
  if (field === "labels") {
    return `Etiquetas atualizadas`;
  }
  if (field === "dueDate") {
    const fmt = (v: any) => v ? format(new Date(v), "dd/MM/yyyy", { locale: ptBR }) : "Sem prazo";
    return `Prazo: ${fmt(change.from)} → ${fmt(change.to)}`;
  }
  return `${field}: ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`;
}

function AuditTimeline({ dealId, stages }: { dealId: number | null; stages: any[] }) {
  const { data: logs = [], isLoading } = useDealAuditLog(dealId);

  if (isLoading) {
    return <div className="text-xs text-muted-foreground p-4 text-center">Carregando histórico...</div>;
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <History className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-xs">Nenhuma atividade registrada ainda.</p>
      </div>
    );
  }

  return (
    <div className="space-y-0 relative" data-testid="deal-audit-timeline">
      <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
      {logs.map((log: any) => {
        const config = ACTION_CONFIG[log.action] || ACTION_CONFIG.updated;
        const Icon = config.icon;
        const changes = (log.changesJson && typeof log.changesJson === "object") ? log.changesJson as Record<string, { from: any; to: any }> : {};
        return (
          <div key={log.id} className="flex gap-3 py-2.5 pl-0 relative" data-testid={`audit-entry-${log.id}`}>
            <div className={cn("w-6 h-6 rounded-full flex items-center justify-center shrink-0 z-10 bg-background border", config.color)}>
              <Icon className="w-3 h-3" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold">{log.userName}</span>
                <Badge variant="outline" className="text-[10px] h-4 px-1.5">{config.label}</Badge>
                <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                  {format(new Date(log.createdAt), "dd/MM HH:mm", { locale: ptBR })}
                </span>
              </div>
              {Object.keys(changes).length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {Object.entries(changes).map(([field, change]) => (
                    <p key={field} className="text-[11px] text-muted-foreground">
                      {formatChange(field, change, stages)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function DealDetailPanel({
  dealId, open, onClose, assetsById = {}
}: { dealId: number | null; open: boolean; onClose: () => void; assetsById?: Record<number, any> }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: deal, isLoading } = useDealDetail(dealId);
  const { data: comments = [] } = useDealComments(dealId);
  const { data: allStages } = useStages();
  const [newComment, setNewComment] = useState("");
  const [editTitle, setEditTitle] = useState(false);
  const [titleVal, setTitleVal] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newAttachName, setNewAttachName] = useState("");
  const [newAttachUrl, setNewAttachUrl] = useState("");
  const [showAddAttach, setShowAddAttach] = useState(false);
  const [confirmDeleteDeal, setConfirmDeleteDeal] = useState(false);
  const [confirmDeleteCommentId, setConfirmDeleteCommentId] = useState<number | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
    queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", dealId] });
  };

  const updateField = async (field: string, value: any) => {
    if (!dealId) return;
    await apiRequest("PATCH", `/api/crm/deals/${dealId}`, { [field]: value });
    invalidate();
  };

  const addComment = async () => {
    if (!newComment.trim() || !dealId) return;
    await apiRequest("POST", "/api/deal-comments", { dealId, content: newComment, authorName: "Usuário" });
    setNewComment("");
    queryClient.invalidateQueries({ queryKey: ["/api/deal-comments", dealId] });
  };

  const deleteComment = async (commentId: number) => {
    await apiRequest("DELETE", `/api/deal-comments/${commentId}`);
    setConfirmDeleteCommentId(null);
    queryClient.invalidateQueries({ queryKey: ["/api/deal-comments", dealId] });
  };

  const deleteDeal = async () => {
    if (!dealId) return;
    await apiRequest("DELETE", `/api/crm/deals/${dealId}`);
    setConfirmDeleteDeal(false);
    invalidate();
    onClose();
    toast({ title: "Deal excluído" });
  };

  const addLabel = () => {
    if (!newLabel.trim() || !deal) return;
    const labels = [...(deal.labels || []), newLabel.trim()];
    updateField("labels", labels);
    setNewLabel("");
  };

  const removeLabel = (lbl: string) => {
    if (!deal) return;
    updateField("labels", (deal.labels || []).filter((l: string) => l !== lbl));
  };

  const addAttachment = () => {
    if (!newAttachName.trim() || !newAttachUrl.trim() || !deal) return;
    const attachments = [...((deal.attachments as any[]) || []), {
      name: newAttachName.trim(),
      url: newAttachUrl.trim(),
      uploadedAt: new Date().toISOString(),
    }];
    updateField("attachments", attachments);
    setNewAttachName("");
    setNewAttachUrl("");
    setShowAddAttach(false);
  };

  const removeAttachment = (idx: number) => {
    if (!deal) return;
    const attachments = ((deal.attachments as any[]) || []).filter((_: any, i: number) => i !== idx);
    updateField("attachments", attachments);
  };

  const stages = allStages?.filter(s => deal && s.pipelineType === deal.pipelineType)
    .sort((a, b) => a.order - b.order) || [];

  if (!open) return null;

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[600px] sm:max-w-[600px] overflow-y-auto p-0">
        {isLoading || !deal ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <div className={cn("h-1.5 w-full shrink-0", PRIORITY_CONFIG[deal.priority || "medium"]?.color)} />
            <div className="p-5 border-b">
              {editTitle ? (
                <Input
                  autoFocus
                  value={titleVal}
                  onChange={e => setTitleVal(e.target.value)}
                  onBlur={() => { updateField("title", titleVal); setEditTitle(false); }}
                  onKeyDown={e => { if (e.key === "Enter") { updateField("title", titleVal); setEditTitle(false); } }}
                  className="text-lg font-bold h-auto text-lg"
                />
              ) : (
                <h2
                  className="text-xl font-bold cursor-pointer hover:text-primary transition-colors"
                  onClick={() => { setTitleVal(deal.title); setEditTitle(true); }}
                  title="Clique para editar"
                >
                  {deal.title}
                </h2>
              )}
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {deal.company && (
                  <Link href={`/empresas/${deal.companyId}`} className="flex items-center gap-1 text-sm text-primary hover:underline" data-testid="link-deal-company">
                    <Building2 className="w-3.5 h-3.5" /> {deal.company.tradeName || deal.company.legalName}
                  </Link>
                )}
                <span className="text-xs text-muted-foreground">
                  {deal.pipelineType === "INVESTOR" ? "Pipeline Investidor" : "Pipeline Ativo"}
                </span>
                {(() => {
                  const src = getSourceBadge(deal, assetsById);
                  if (!src) return null;
                  return (
                    <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1", src.className)} data-testid="badge-deal-source">
                      <src.icon className="w-3 h-3" />
                      {src.label}
                    </span>
                  );
                })()}
              </div>
              {(() => {
                const currentStage = stages.find(s => s.id === deal.stageId);
                if (!stages.length) return null;
                return (
                  <div className="mt-3 flex items-center gap-1 flex-wrap" data-testid="deal-timeline">
                    {stages.map((s, i) => {
                      const isPast = stages.indexOf(s) < stages.indexOf(currentStage!);
                      const isCurrent = s.id === deal.stageId;
                      return (
                        <div key={s.id} className="flex items-center gap-1">
                          {i > 0 && <ArrowRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />}
                          <span
                            className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap",
                              isCurrent ? "bg-primary text-white" : isPast ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                            )}
                          >
                            {s.name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              {deal.assetId && assetsById[deal.assetId]?.anmProcesso && (() => {
                const linkedAsset = assetsById[deal.assetId!];
                const attrs = linkedAsset.attributesJson as Record<string, any> | null;
                return (
                  <div className="mt-3 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-900/10 p-2.5 space-y-1" data-testid="deal-anm-info">
                    <Link href="/anm" className="flex items-center gap-1.5 text-xs font-semibold text-orange-600 hover:text-orange-700">
                      <Mountain className="w-3.5 h-3.5" /> ANM: <span className="font-mono">{linkedAsset.anmProcesso}</span>
                    </Link>
                    {attrs && (
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        {attrs.anmFase && <p><span className="font-medium">Fase:</span> {attrs.anmFase}</p>}
                        {attrs.anmSubstancia && <p><span className="font-medium">Substância:</span> {attrs.anmSubstancia}</p>}
                        {attrs.anmNome && <p className="col-span-2 truncate"><span className="font-medium">Titular:</span> {attrs.anmNome}</p>}
                        {attrs.anmUltEvento && <p className="col-span-2 truncate"><span className="font-medium">Últ. Evento:</span> {attrs.anmUltEvento}</p>}
                      </div>
                    )}
                    <Link href={`/ativos/${linkedAsset.id}`} className="flex items-center gap-1 text-[10px] text-primary hover:underline mt-1">
                      Ver ativo vinculado <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                );
              })()}
              {deal.assetId && !assetsById[deal.assetId]?.anmProcesso && (() => {
                const linkedAsset = assetsById[deal.assetId!];
                const attrs = linkedAsset?.attributesJson as Record<string, any> | null;
                if (!attrs?.carCodImovel) return null;
                return (
                  <div className="mt-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10 p-2.5 space-y-1" data-testid="deal-car-info">
                    <Link href="/geo-rural" className="flex items-center gap-1.5 text-xs font-semibold text-green-600 hover:text-green-700">
                      <TreePine className="w-3.5 h-3.5" /> CAR: <span className="font-mono">{attrs.carCodImovel}</span>
                    </Link>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      {attrs.carMunicipio && <p><span className="font-medium">Município:</span> {attrs.carMunicipio}</p>}
                      {attrs.geoScore != null && <p><span className="font-medium">Score:</span> {attrs.geoScore}/100</p>}
                      {attrs.geoTemRio && <p><span className="font-medium">Água:</span> Presente</p>}
                      {attrs.geoTemEnergia && <p><span className="font-medium">Energia:</span> Próxima</p>}
                    </div>
                    <Link href={`/ativos/${linkedAsset.id}`} className="flex items-center gap-1 text-[10px] text-primary hover:underline mt-1">
                      Ver ativo vinculado <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                );
              })()}
            </div>

            {deal.company && (() => {
              const vc = (deal.company as any)?.verifiedContacts || {};
              const hasV = !!(vc.phone || vc.email || vc.whatsapp || vc.contactName);
              if (!hasV) return null;
              return (
                <div className="mx-5 mt-3 rounded-lg border border-green-200 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10 p-2.5 space-y-1" data-testid="deal-verified-contacts">
                  <p className="text-xs font-semibold text-green-700 dark:text-green-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Contato Verificado
                  </p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-green-600 dark:text-green-400">
                    {vc.contactName && <p className="col-span-2"><span className="font-medium">Contato:</span> {vc.contactName}{vc.contactRole ? ` (${vc.contactRole})` : ""}</p>}
                    {vc.phone && <p><span className="font-medium">Tel:</span> {vc.phone}</p>}
                    {vc.email && <p><span className="font-medium">Email:</span> {vc.email}</p>}
                    {vc.whatsapp && <p><span className="font-medium">WhatsApp:</span> {vc.whatsapp}</p>}
                  </div>
                </div>
              );
            })()}

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <Tabs defaultValue="details" className="w-full">
                <TabsList className="w-full mb-4">
                  <TabsTrigger value="details" className="flex-1 text-xs" data-testid="tab-deal-details">Detalhes</TabsTrigger>
                  <TabsTrigger value="comments" className="flex-1 text-xs" data-testid="tab-deal-comments">
                    Comentários ({comments.length})
                  </TabsTrigger>
                  <TabsTrigger value="history" className="flex-1 text-xs" data-testid="tab-deal-history">
                    <History className="w-3 h-3 mr-1" /> Histórico
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="details" className="space-y-5 mt-0">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Estágio</Label>
                  <Select value={String(deal.stageId || "")} onValueChange={v => updateField("stageId", parseInt(v))}>
                    <SelectTrigger className="h-8 text-sm mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {stages.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Prioridade</Label>
                  <Select value={deal.priority || "medium"} onValueChange={v => updateField("priority", v)}>
                    <SelectTrigger className="h-8 text-sm mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Prazo</Label>
                  <Input
                    type="date"
                    className="h-8 text-sm mt-1"
                    value={deal.dueDate ? format(new Date(deal.dueDate), "yyyy-MM-dd") : ""}
                    onChange={e => updateField("dueDate", e.target.value ? new Date(e.target.value).toISOString() : null)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Valor Estimado (R$)</Label>
                  <Input
                    className="h-8 text-sm mt-1"
                    type="number"
                    defaultValue={deal.amountEstimate || ""}
                    onBlur={e => updateField("amountEstimate", e.target.value ? parseFloat(e.target.value) : null)}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Probabilidade (%)</Label>
                  <Input
                    className="h-8 text-sm mt-1"
                    type="number"
                    min={0} max={100}
                    defaultValue={deal.probability || ""}
                    onBlur={e => updateField("probability", e.target.value ? parseInt(e.target.value) : null)}
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Etiquetas</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5 mb-2">
                  {(deal.labels || []).map((lbl: string, i: number) => (
                    <span key={lbl} className={cn("text-xs px-2 py-0.5 rounded-full flex items-center gap-1 font-medium", LABEL_COLORS[i % LABEL_COLORS.length])}>
                      {lbl}
                      <button onClick={() => removeLabel(lbl)} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    className="h-7 text-xs"
                    placeholder="Nova etiqueta..."
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") addLabel(); }}
                  />
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={addLabel}>+</Button>
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Descrição</Label>
                <MinimalEditor
                  content={deal.description || null}
                  onSave={html => updateField("description", html)}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs text-muted-foreground">
                    Anexos ({((deal.attachments as any[]) || []).length})
                  </Label>
                  <button
                    type="button"
                    onClick={() => setShowAddAttach(v => !v)}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                    data-testid="button-add-attachment"
                  >
                    <Plus className="w-3 h-3" /> Adicionar
                  </button>
                </div>

                <div className="space-y-1.5 mb-2">
                  {((deal.attachments as any[]) || []).map((att: any, idx: number) => (
                    <div key={idx} className="flex items-center gap-2 group p-2 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
                      <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <a
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 text-xs text-primary hover:underline truncate font-medium"
                        data-testid={`link-attachment-${idx}`}
                      >
                        {att.name}
                      </a>
                      {att.uploadedAt && (
                        <span className="text-[10px] text-muted-foreground hidden group-hover:block shrink-0">
                          {format(new Date(att.uploadedAt), "dd/MM/yy", { locale: ptBR })}
                        </span>
                      )}
                      <button
                        onClick={() => removeAttachment(idx)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0"
                        data-testid={`button-remove-attachment-${idx}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>

                {showAddAttach && (
                  <div className="border rounded-lg p-3 space-y-2 bg-background">
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Link2 className="w-3.5 h-3.5" /> Adicionar link (Google Drive, Dropbox, etc.)
                    </p>
                    <Input
                      className="h-7 text-xs"
                      placeholder="Nome do arquivo..."
                      value={newAttachName}
                      onChange={e => setNewAttachName(e.target.value)}
                      data-testid="input-attach-name"
                    />
                    <Input
                      className="h-7 text-xs"
                      placeholder="URL (ex: https://drive.google.com/...)"
                      value={newAttachUrl}
                      onChange={e => setNewAttachUrl(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") addAttachment(); }}
                      data-testid="input-attach-url"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" className="h-7 text-xs flex-1" onClick={addAttachment} data-testid="button-save-attachment">
                        <Paperclip className="w-3 h-3 mr-1" /> Salvar Anexo
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAddAttach(false)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
                </TabsContent>

                <TabsContent value="comments" className="mt-0">
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">
                  Comentários ({comments.length})
                </Label>
                <div className="space-y-2.5 mb-3">
                  {comments.map((c: any) => (
                    <div key={c.id} className="flex gap-2.5 group">
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                        {c.authorName?.[0] || "U"}
                      </div>
                      <div className="flex-1 bg-muted/40 rounded-lg p-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium">{c.authorName || "Usuário"}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(c.createdAt), "dd/MM HH:mm", { locale: ptBR })}
                            </span>
                            <button
                              onClick={() => setConfirmDeleteCommentId(c.id)}
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                              data-testid={`button-delete-comment-${c.id}`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed">{c.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    className="h-8 text-sm"
                    placeholder="Adicionar comentário..."
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") addComment(); }}
                  />
                  <Button size="sm" className="h-8 px-3" onClick={addComment}>
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
                </TabsContent>

                <TabsContent value="history" className="mt-0">
                  <AuditTimeline dealId={deal.id} stages={stages} />
                </TabsContent>
              </Tabs>
            </div>

            <div className="p-4 border-t flex items-center gap-2">
              <Button variant="destructive" size="sm" onClick={() => setConfirmDeleteDeal(true)} data-testid="button-delete-deal">
                <Trash2 className="w-4 h-4 mr-1.5" /> Excluir
              </Button>
              <div className="flex-1" />
              {deal.assetId && (
                <Button variant="outline" size="sm" asChild data-testid="link-deal-asset">
                  <Link href={`/ativos/${deal.assetId}`}>
                    <Layers className="w-4 h-4 mr-1.5" /> Ver Ativo
                  </Link>
                </Button>
              )}
              {deal.companyId && (
                <Button variant="outline" size="sm" asChild data-testid="link-deal-empresa">
                  <Link href={`/empresas/${deal.companyId}`}>
                    <ExternalLink className="w-4 h-4 mr-1.5" /> Ver Empresa
                  </Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </SheetContent>

      <AlertDialog open={confirmDeleteDeal} onOpenChange={o => !o && setConfirmDeleteDeal(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir deal?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O deal e todos os seus comentários serão removidos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={deleteDeal} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeleteCommentId !== null} onOpenChange={o => !o && setConfirmDeleteCommentId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir comentário?</AlertDialogTitle>
            <AlertDialogDescription>
              O comentário será removido permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDeleteCommentId && deleteComment(confirmDeleteCommentId)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
