import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Globe, Plus, Eye, Trash2, ExternalLink, Mail, Phone,
  Building2, Calendar, Search, CheckCircle2, Clock, XCircle, MapPin,
  Image, Palette, Sparkles, BarChart3, Edit3, GripVertical,
  X, ChevronDown, ChevronUp, FileText, Layers, Link2, Copy, Check, Upload, Handshake,
} from "lucide-react";
import { cn } from "@/lib/utils";

async function uploadImages(files: FileList): Promise<string[]> {
  const form = new FormData();
  for (let i = 0; i < files.length; i++) form.append("images", files[i]);
  const res = await fetch("/api/upload/images", { method: "POST", body: form, credentials: "include" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Erro ao fazer upload");
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new Error("Resposta inesperada do servidor");
  }
  const data = await res.json();
  return data.urls || [];
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-gray-100 text-gray-700" },
  published: { label: "Publicado", color: "bg-green-100 text-green-700" },
  archived: { label: "Arquivado", color: "bg-yellow-100 text-yellow-700" },
};

const INQUIRY_STATUS: Record<string, { label: string; icon: any; color: string }> = {
  new: { label: "Novo", icon: Clock, color: "text-blue-600" },
  contacted: { label: "Contatado", icon: CheckCircle2, color: "text-green-600" },
  closed: { label: "Fechado", icon: XCircle, color: "text-gray-500" },
};

const TIPO_LABEL: Record<string, string> = {
  TERRA: "Terras/Fazendas", MINA: "Mineração", NEGOCIO: "Negócio/M&A",
  FII_CRI: "FII/CRI", DESENVOLVIMENTO: "Desenvolvimento", AGRO: "Agronegócio",
};

export default function PortalAdminPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("listings");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editListing, setEditListing] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [showCreateLP, setShowCreateLP] = useState(false);
  const [editLP, setEditLP] = useState<any>(null);

  const { data: orgSettings } = useQuery<any>({ queryKey: ["/api/org/settings"] });

  const { data: listings = [], isLoading: loadingListings } = useQuery<any[]>({
    queryKey: ["/api/portal/listings"],
  });
  const { data: inquiries = [], isLoading: loadingInquiries } = useQuery<any[]>({
    queryKey: ["/api/portal/inquiries"],
  });
  const { data: assets = [] } = useQuery<any[]>({
    queryKey: ["/api/matching/assets"],
    queryFn: () => apiRequest("GET", "/api/matching/assets").then(r => r.json()),
  });
  const { data: landingPages = [], isLoading: loadingLP } = useQuery<any[]>({
    queryKey: ["/api/landing-pages"],
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/portal/listings", data),
    onSuccess: () => {
      toast({ title: "Publicação criada!" });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/listings"] });
      setShowCreateDialog(false);
    },
    onError: () => toast({ title: "Erro ao criar publicação", variant: "destructive" }),
  });

  const updateListingMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest("PATCH", `/api/portal/listings/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/listings"] });
      toast({ title: "Publicação atualizada!" });
    },
  });

  const deleteListingMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/portal/listings/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/listings"] });
      toast({ title: "Publicação removida!" });
    },
  });

  const updateInquiryMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest("PATCH", `/api/portal/inquiries/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/inquiries"] });
      toast({ title: "Status atualizado!" });
    },
  });

  const createDealFromInquiry = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/portal/inquiries/${id}/create-deal`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/inquiries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      toast({ title: "Deal criado com sucesso!", description: "O interesse foi promovido a oportunidade no CRM." });
    },
    onError: () => toast({ title: "Erro ao criar deal", variant: "destructive" }),
  });

  const createLPMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/landing-pages", data),
    onSuccess: () => {
      toast({ title: "Landing page criada!" });
      queryClient.invalidateQueries({ queryKey: ["/api/landing-pages"] });
      setShowCreateLP(false);
    },
    onError: (err: any) => toast({ title: err?.message || "Erro ao criar landing page", variant: "destructive" }),
  });

  const updateLPMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest("PATCH", `/api/landing-pages/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/landing-pages"] });
      toast({ title: "Landing page atualizada!" });
    },
  });

  const deleteLPMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/landing-pages/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/landing-pages"] });
      toast({ title: "Landing page removida!" });
    },
  });

  const [portalHeroImage, setPortalHeroImage] = useState("");
  const [portalTitle, setPortalTitle] = useState("");
  const [portalSubtitle, setPortalSubtitle] = useState("");
  const [portalWhyTitle, setPortalWhyTitle] = useState("");
  const [portalWhyBullets, setPortalWhyBullets] = useState(["", "", ""]);
  const [portalAccentColor, setPortalAccentColor] = useState("#1a365d");
  const [portalContactEmail, setPortalContactEmail] = useState("");
  const [portalContactPhone, setPortalContactPhone] = useState("");
  const [portalContactWhatsapp, setPortalContactWhatsapp] = useState("");
  const [customizationLoaded, setCustomizationLoaded] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  if (orgSettings && !customizationLoaded) {
    setPortalHeroImage(orgSettings.portal_hero_image || "");
    setPortalTitle(orgSettings.portal_title || "");
    setPortalSubtitle(orgSettings.portal_subtitle || "");
    setPortalWhyTitle(orgSettings.portal_why_title || "");
    const bullets = orgSettings.portal_why_bullets;
    if (Array.isArray(bullets)) {
      setPortalWhyBullets([bullets[0] || "", bullets[1] || "", bullets[2] || ""]);
    }
    setPortalAccentColor(orgSettings.portal_accent_color || "#1a365d");
    const contact = orgSettings.portal_contact;
    if (contact && typeof contact === "object") {
      setPortalContactEmail(contact.email || "");
      setPortalContactPhone(contact.phone || "");
      setPortalContactWhatsapp(contact.whatsapp || "");
    }
    setCustomizationLoaded(true);
  }

  const saveSetting = async (key: string, value: any) => {
    setSavingKey(key);
    try {
      await apiRequest("PUT", `/api/org/settings/${key}`, { value });
      queryClient.invalidateQueries({ queryKey: ["/api/org/settings"] });
      toast({ title: "Configuração salva!" });
    } catch {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    } finally {
      setSavingKey(null);
    }
  };

  const filteredListings = (listings as any[]).filter(l => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return l.title?.toLowerCase().includes(q) || l.asset?.title?.toLowerCase().includes(q);
  });

  const newInquiriesCount = (inquiries as any[]).filter(i => i.status === "new").length;

  const totalViews = (listings as any[]).reduce((s, l) => s + (l.viewCount || 0), 0);
  const publishedCount = (listings as any[]).filter(l => l.status === "published").length;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="page-title-portal-admin">
            <Globe className="w-6 h-6 text-primary" /> Portal do Investidor
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gerencie publicações, landing pages e acompanhe interessados
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => window.open("/portal", "_blank")} data-testid="btn-preview-portal">
            <ExternalLink className="w-4 h-4 mr-1.5" /> Ver Portal
          </Button>
          <Button size="sm" onClick={() => setShowCreateDialog(true)} data-testid="btn-new-listing">
            <Plus className="w-4 h-4 mr-1.5" /> Nova Publicação
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{listings.length}</p>
            <p className="text-xs text-muted-foreground">Total Publicações</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{publishedCount}</p>
            <p className="text-xs text-muted-foreground">Publicadas</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{(inquiries as any[]).length}</p>
            <p className="text-xs text-muted-foreground">Interessados</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{totalViews}</p>
            <p className="text-xs text-muted-foreground">Visualizações</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="listings" data-testid="tab-listings">
            Publicações ({filteredListings.length})
          </TabsTrigger>
          <TabsTrigger value="inquiries" data-testid="tab-inquiries">
            Interessados
            {newInquiriesCount > 0 && (
              <Badge className="ml-1.5 h-5 bg-red-500 text-white text-[10px]">{newInquiriesCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="landing-pages" data-testid="tab-landing-pages">
            <Link2 className="w-3.5 h-3.5 mr-1" />
            Landing Pages ({(landingPages as any[]).length})
          </TabsTrigger>
          <TabsTrigger value="personalizacao" data-testid="tab-personalizacao">
            <Palette className="w-3.5 h-3.5 mr-1" />
            Personalização
          </TabsTrigger>
        </TabsList>

        <TabsContent value="listings" className="space-y-4 mt-4">
          <div className="flex gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar publicação..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-9"
                data-testid="input-search-listings"
              />
            </div>
          </div>

          {loadingListings ? (
            <div className="text-center py-12 text-muted-foreground">Carregando...</div>
          ) : filteredListings.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Globe className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground">Nenhuma publicação ainda.</p>
                <p className="text-sm text-muted-foreground/70 mt-1">Clique em "Nova Publicação" para publicar um ativo no portal.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredListings.map((listing: any) => {
                const st = STATUS_LABELS[listing.status] || STATUS_LABELS.draft;
                return (
                  <Card key={listing.id} className="border-border/50 shadow-sm" data-testid={`listing-card-${listing.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex gap-3 flex-1 min-w-0">
                          {listing.featuredImage ? (
                            <div className="w-16 h-12 rounded-lg overflow-hidden shrink-0 bg-muted">
                              <img src={listing.featuredImage} alt="" className="w-full h-full object-cover" />
                            </div>
                          ) : (
                            <div className="w-16 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                              <Layers className="w-5 h-5 text-muted-foreground/40" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-semibold truncate">{listing.title}</h3>
                              <Badge className={cn("text-[10px] h-5", st.color)}>{st.label}</Badge>
                              {listing.visibilityLevel === "full" && (
                                <Badge variant="outline" className="text-[10px] h-5">Completo</Badge>
                              )}
                            </div>
                            {listing.asset && (
                              <p className="text-xs text-muted-foreground">
                                {TIPO_LABEL[listing.asset.type] || listing.asset.type}
                                {listing.asset.estado && ` — ${listing.asset.municipio || ""} ${listing.asset.estado}`}
                                {listing.asset.areaHa && ` — ${Number(listing.asset.areaHa).toLocaleString("pt-BR")} ha`}
                              </p>
                            )}
                            <div className="flex items-center gap-4 mt-1.5">
                              {listing.viewCount > 0 && (
                                <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                                  <Eye className="w-3 h-3" /> {listing.viewCount} views
                                </span>
                              )}
                              {listing.publishedAt && (
                                <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                                  <Calendar className="w-3 h-3" /> {new Date(listing.publishedAt).toLocaleDateString("pt-BR")}
                                </span>
                              )}
                              {((listing.galleryImages as any[]) || []).length > 0 && (
                                <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                                  <Image className="w-3 h-3" /> {((listing.galleryImages as any[]) || []).length} fotos
                                </span>
                              )}
                              {((listing.highlights as any[]) || []).length > 0 && (
                                <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                                  <Sparkles className="w-3 h-3" /> {((listing.highlights as any[]) || []).length} destaques
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs"
                            onClick={() => setEditListing(listing)}
                            data-testid={`btn-edit-${listing.id}`}
                          >
                            <Edit3 className="w-3 h-3 mr-1" /> Editar
                          </Button>
                          {listing.status === "draft" && (
                            <Button
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => updateListingMutation.mutate({ id: listing.id, data: { status: "published" } })}
                              data-testid={`btn-publish-${listing.id}`}
                            >
                              Publicar
                            </Button>
                          )}
                          {listing.status === "published" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              onClick={() => updateListingMutation.mutate({ id: listing.id, data: { status: "archived" } })}
                              data-testid={`btn-archive-${listing.id}`}
                            >
                              Arquivar
                            </Button>
                          )}
                          {listing.status === "archived" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              onClick={() => updateListingMutation.mutate({ id: listing.id, data: { status: "draft" } })}
                            >
                              Reativar
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs text-red-500 hover:text-red-700"
                            onClick={() => deleteListingMutation.mutate(listing.id)}
                            data-testid={`btn-delete-listing-${listing.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="inquiries" className="space-y-4 mt-4">
          {loadingInquiries ? (
            <div className="text-center py-12 text-muted-foreground">Carregando...</div>
          ) : (inquiries as any[]).length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Mail className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground">Nenhum interessado ainda.</p>
                <p className="text-sm text-muted-foreground/70 mt-1">Quando alguém demonstrar interesse pelo portal, aparecerá aqui.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {(inquiries as any[]).map((inq: any) => {
                const is = INQUIRY_STATUS[inq.status] || INQUIRY_STATUS.new;
                const IsIcon = is.icon;
                return (
                  <Card key={inq.id} className="border-border/50 shadow-sm" data-testid={`inquiry-card-${inq.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-sm">{inq.name}</h3>
                            <Badge variant="outline" className={cn("text-[10px] h-5", is.color)}>
                              <IsIcon className="w-3 h-3 mr-0.5" /> {is.label}
                            </Badge>
                            {inq.intentScore != null && inq.intentScore > 0 && (
                              <Badge className={cn("text-[10px] h-5", inq.intentScore >= 70 ? "bg-emerald-100 text-emerald-700" : inq.intentScore >= 40 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600")} data-testid={`badge-intent-${inq.id}`}>
                                Intent {inq.intentScore}%
                              </Badge>
                            )}
                            {inq.leadId && (
                              <Badge variant="outline" className="text-[10px] h-5 border-blue-300 text-blue-600" data-testid={`badge-lead-${inq.id}`}>
                                Lead #{inq.leadId}
                              </Badge>
                            )}
                            {inq.dealId && (
                              <Badge variant="outline" className="text-[10px] h-5 border-emerald-300 text-emerald-600" data-testid={`badge-deal-${inq.id}`}>
                                Deal #{inq.dealId}
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                            {inq.email && (
                              <span className="flex items-center gap-1">
                                <Mail className="w-3 h-3" /> {inq.email}
                              </span>
                            )}
                            {inq.phone && (
                              <span className="flex items-center gap-1">
                                <Phone className="w-3 h-3" /> {inq.phone}
                              </span>
                            )}
                            {inq.company && (
                              <span className="flex items-center gap-1">
                                <Building2 className="w-3 h-3" /> {inq.company}
                              </span>
                            )}
                          </div>
                          {inq.message && (
                            <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2 mt-1">{inq.message}</p>
                          )}
                          {inq.listing && (
                            <p className="text-[10px] text-muted-foreground/60">
                              Ativo: {inq.listing.title}
                            </p>
                          )}
                          {inq.intentSignalsJson && Array.isArray(inq.intentSignalsJson) && inq.intentSignalsJson.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {(inq.intentSignalsJson as string[]).map((sig: string, idx: number) => (
                                <span key={idx} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{sig}</span>
                              ))}
                            </div>
                          )}
                          <p className="text-[10px] text-muted-foreground/60">
                            {new Date(inq.createdAt).toLocaleString("pt-BR")}
                          </p>
                        </div>
                        <div className="flex flex-col gap-1.5 shrink-0 items-end">
                          <Select
                            value={inq.status}
                            onValueChange={v => updateInquiryMutation.mutate({ id: inq.id, data: { status: v } })}
                          >
                            <SelectTrigger className="h-8 w-28 text-xs" data-testid={`select-inquiry-status-${inq.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="new">Novo</SelectItem>
                              <SelectItem value="contacted">Contatado</SelectItem>
                              <SelectItem value="closed">Fechado</SelectItem>
                            </SelectContent>
                          </Select>
                          {!inq.dealId && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px] w-28"
                              onClick={() => createDealFromInquiry.mutate(inq.id)}
                              disabled={createDealFromInquiry.isPending}
                              data-testid={`btn-create-deal-${inq.id}`}
                            >
                              <Handshake className="w-3 h-3 mr-1" /> Criar Deal
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="landing-pages" className="space-y-4 mt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Crie landing pages exclusivas para ativos e compartilhe o link com investidores.
            </p>
            <Button size="sm" onClick={() => setShowCreateLP(true)} data-testid="btn-new-lp">
              <Plus className="w-4 h-4 mr-1.5" /> Nova Landing Page
            </Button>
          </div>

          {loadingLP ? (
            <div className="text-center py-12 text-muted-foreground">Carregando...</div>
          ) : (landingPages as any[]).length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Link2 className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground">Nenhuma landing page criada.</p>
                <p className="text-sm text-muted-foreground/70 mt-1">Crie uma landing page exclusiva para um ativo e compartilhe via link.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {(landingPages as any[]).map((lp: any) => {
                const st = STATUS_LABELS[lp.status] || STATUS_LABELS.draft;
                const lpUrl = `${window.location.origin}/lp/${lp.slug}`;
                return (
                  <LandingPageCard
                    key={lp.id}
                    lp={lp}
                    st={st}
                    lpUrl={lpUrl}
                    onEdit={() => setEditLP(lp)}
                    onPublish={() => updateLPMutation.mutate({ id: lp.id, data: { status: "published" } })}
                    onArchive={() => updateLPMutation.mutate({ id: lp.id, data: { status: "archived" } })}
                    onReactivate={() => updateLPMutation.mutate({ id: lp.id, data: { status: "draft" } })}
                    onDelete={() => deleteLPMutation.mutate(lp.id)}
                    toast={toast}
                  />
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="personalizacao" className="space-y-6 mt-4">
          <p className="text-sm text-muted-foreground">
            Personalize a aparência e conteúdo do Portal do Investidor público.
          </p>

          <Card className="border-border/50">
            <CardContent className="p-5 space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Image className="w-4 h-4" /> Imagem Hero do Portal
              </h3>
              <div className="flex gap-2">
                <Input
                  value={portalHeroImage}
                  onChange={e => setPortalHeroImage(e.target.value)}
                  placeholder="URL da imagem de fundo do hero..."
                  className="flex-1"
                  data-testid="input-portal-hero-image"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "image/*";
                    input.onchange = async () => {
                      if (input.files?.length) {
                        const urls = await uploadImages(input.files);
                        if (urls.length > 0) setPortalHeroImage(urls[0]);
                      }
                    };
                    input.click();
                  }}
                  data-testid="btn-upload-portal-hero"
                >
                  <Upload className="w-4 h-4 mr-1" /> Upload
                </Button>
              </div>
              {portalHeroImage && (
                <div className="rounded-lg overflow-hidden h-32 bg-muted">
                  <img src={portalHeroImage} alt="" className="w-full h-full object-cover" data-testid="img-portal-hero-preview" onError={e => (e.currentTarget.style.display = "none")} />
                </div>
              )}
              <Button
                size="sm"
                onClick={() => saveSetting("portal_hero_image", portalHeroImage || null)}
                disabled={savingKey === "portal_hero_image"}
                data-testid="btn-save-portal-hero-image"
              >
                {savingKey === "portal_hero_image" ? "Salvando..." : "Salvar Imagem Hero"}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="p-5 space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Edit3 className="w-4 h-4" /> Título e Subtítulo do Hero
              </h3>
              <div>
                <Label>Título principal</Label>
                <Input
                  value={portalTitle}
                  onChange={e => setPortalTitle(e.target.value)}
                  placeholder="Ex: Invest with Purpose"
                  data-testid="input-portal-title"
                />
              </div>
              <div>
                <Label>Subtítulo</Label>
                <Textarea
                  value={portalSubtitle}
                  onChange={e => setPortalSubtitle(e.target.value)}
                  placeholder="Ex: Oportunidades exclusivas em Real Estate, Mineração..."
                  rows={2}
                  data-testid="input-portal-subtitle"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => saveSetting("portal_title", portalTitle || null)}
                  disabled={savingKey === "portal_title"}
                  data-testid="btn-save-portal-title"
                >
                  {savingKey === "portal_title" ? "Salvando..." : "Salvar Título"}
                </Button>
                <Button
                  size="sm"
                  onClick={() => saveSetting("portal_subtitle", portalSubtitle || null)}
                  disabled={savingKey === "portal_subtitle"}
                  data-testid="btn-save-portal-subtitle"
                >
                  {savingKey === "portal_subtitle" ? "Salvando..." : "Salvar Subtítulo"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="p-5 space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> Seção "Por que Investir"
              </h3>
              <div>
                <Label>Título da seção</Label>
                <Input
                  value={portalWhyTitle}
                  onChange={e => setPortalWhyTitle(e.target.value)}
                  placeholder="Ex: Por que Investir Conosco"
                  data-testid="input-portal-why-title"
                />
              </div>
              <div className="space-y-2">
                <Label>Bullet Points (3 itens)</Label>
                {portalWhyBullets.map((bullet, i) => (
                  <Input
                    key={i}
                    value={bullet}
                    onChange={e => {
                      const updated = [...portalWhyBullets];
                      updated[i] = e.target.value;
                      setPortalWhyBullets(updated);
                    }}
                    placeholder={`Bullet ${i + 1}: Ex: Ativos verificados e curados`}
                    data-testid={`input-portal-why-bullet-${i}`}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => saveSetting("portal_why_title", portalWhyTitle || null)}
                  disabled={savingKey === "portal_why_title"}
                  data-testid="btn-save-portal-why-title"
                >
                  {savingKey === "portal_why_title" ? "Salvando..." : "Salvar Título"}
                </Button>
                <Button
                  size="sm"
                  onClick={() => saveSetting("portal_why_bullets", portalWhyBullets.filter(b => b.trim()))}
                  disabled={savingKey === "portal_why_bullets"}
                  data-testid="btn-save-portal-why-bullets"
                >
                  {savingKey === "portal_why_bullets" ? "Salvando..." : "Salvar Bullets"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="p-5 space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Palette className="w-4 h-4" /> Cor de Destaque do Portal
              </h3>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={portalAccentColor}
                  onChange={e => setPortalAccentColor(e.target.value)}
                  className="w-10 h-10 rounded-lg border border-border cursor-pointer"
                  data-testid="input-portal-accent-color"
                />
                <Input
                  value={portalAccentColor}
                  onChange={e => setPortalAccentColor(e.target.value)}
                  className="max-w-[140px]"
                  data-testid="input-portal-accent-color-text"
                />
                <div className="w-24 h-10 rounded-lg" style={{ backgroundColor: portalAccentColor }} />
              </div>
              <Button
                size="sm"
                onClick={() => saveSetting("portal_accent_color", portalAccentColor)}
                disabled={savingKey === "portal_accent_color"}
                data-testid="btn-save-portal-accent-color"
              >
                {savingKey === "portal_accent_color" ? "Salvando..." : "Salvar Cor"}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="p-5 space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Mail className="w-4 h-4" /> Contato do Portal (Footer)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={portalContactEmail}
                    onChange={e => setPortalContactEmail(e.target.value)}
                    placeholder="contato@empresa.com"
                    data-testid="input-portal-contact-email"
                  />
                </div>
                <div>
                  <Label>Telefone</Label>
                  <Input
                    type="tel"
                    value={portalContactPhone}
                    onChange={e => setPortalContactPhone(e.target.value)}
                    placeholder="(11) 99999-9999"
                    data-testid="input-portal-contact-phone"
                  />
                </div>
                <div>
                  <Label>WhatsApp</Label>
                  <Input
                    type="tel"
                    value={portalContactWhatsapp}
                    onChange={e => setPortalContactWhatsapp(e.target.value)}
                    placeholder="(11) 99999-9999"
                    data-testid="input-portal-contact-whatsapp"
                  />
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => saveSetting("portal_contact", {
                  email: portalContactEmail || null,
                  phone: portalContactPhone || null,
                  whatsapp: portalContactWhatsapp || null,
                })}
                disabled={savingKey === "portal_contact"}
                data-testid="btn-save-portal-contact"
              >
                {savingKey === "portal_contact" ? "Salvando..." : "Salvar Contato"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <CreateListingDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        assets={assets}
        onSubmit={data => createMutation.mutate(data)}
        isPending={createMutation.isPending}
      />

      {editListing && (
        <EditListingDialog
          listing={editListing}
          onClose={() => setEditListing(null)}
          onSave={(data) => {
            updateListingMutation.mutate({ id: editListing.id, data }, {
              onSuccess: () => setEditListing(null),
            });
          }}
          isPending={updateListingMutation.isPending}
        />
      )}

      <CreateLPDialog
        open={showCreateLP}
        onOpenChange={setShowCreateLP}
        assets={assets}
        onSubmit={data => createLPMutation.mutate(data)}
        isPending={createLPMutation.isPending}
      />

      {editLP && (
        <EditLPDialog
          lp={editLP}
          onClose={() => setEditLP(null)}
          onSave={(data) => {
            updateLPMutation.mutate({ id: editLP.id, data }, {
              onSuccess: () => setEditLP(null),
            });
          }}
          isPending={updateLPMutation.isPending}
        />
      )}
    </div>
  );
}

function CreateListingDialog({ open, onOpenChange, assets, onSubmit, isPending }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  assets: any[];
  onSubmit: (data: any) => void;
  isPending: boolean;
}) {
  const [assetId, setAssetId] = useState("");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibilityLevel, setVisibilityLevel] = useState("teaser");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [featuredImage, setFeaturedImage] = useState("");

  const selectedAsset = assets.find(a => a.id === Number(assetId));

  const handleSubmit = () => {
    if (!title.trim()) return;
    onSubmit({
      assetId: assetId ? Number(assetId) : null,
      title: title.trim(),
      subtitle: subtitle.trim() || null,
      description: description.trim() || null,
      featuredImage: featuredImage.trim() || null,
      visibilityLevel,
      contactEmail: contactEmail.trim() || null,
      contactPhone: contactPhone.trim() || null,
      status: "draft",
    });
    setTitle(""); setSubtitle(""); setDescription(""); setAssetId("");
    setContactEmail(""); setContactPhone(""); setFeaturedImage("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova Publicação no Portal</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Ativo vinculado</Label>
            <Select value={assetId} onValueChange={v => {
              setAssetId(v);
              const a = assets.find(x => x.id === Number(v));
              if (a && !title) setTitle(a.title);
            }}>
              <SelectTrigger data-testid="select-listing-asset">
                <SelectValue placeholder="Selecione um ativo..." />
              </SelectTrigger>
              <SelectContent>
                {assets.map(a => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.title} ({TIPO_LABEL[a.type] || a.type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedAsset && (
            <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-0.5">
              <p><strong>Tipo:</strong> {TIPO_LABEL[selectedAsset.type] || selectedAsset.type}</p>
              {selectedAsset.estado && <p><strong>Local:</strong> {selectedAsset.municipio} - {selectedAsset.estado}</p>}
              {selectedAsset.areaHa && <p><strong>Área:</strong> {Number(selectedAsset.areaHa).toLocaleString("pt-BR")} ha</p>}
              {selectedAsset.priceAsking && <p><strong>Valor:</strong> R$ {Number(selectedAsset.priceAsking).toLocaleString("pt-BR")}</p>}
            </div>
          )}

          <div>
            <Label>Título da publicação *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Fazenda 500ha no MT" data-testid="input-listing-title" />
          </div>

          <div>
            <Label>Subtítulo</Label>
            <Input value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="Ex: Oportunidade premium em região valorizada" />
          </div>

          <div>
            <Label>Descrição pública</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Descrição que aparecerá no portal..." rows={3} data-testid="input-listing-description" />
          </div>

          <div>
            <Label>Imagem de capa</Label>
            <div className="flex gap-2">
              <Input value={featuredImage} onChange={e => setFeaturedImage(e.target.value)} placeholder="https://exemplo.com/imagem.jpg" className="flex-1" data-testid="input-listing-image" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = "image/*";
                  input.onchange = async () => {
                    if (input.files?.length) {
                      const urls = await uploadImages(input.files);
                      if (urls.length > 0) setFeaturedImage(urls[0]);
                    }
                  };
                  input.click();
                }}
                data-testid="btn-upload-hero"
              >
                <Upload className="w-4 h-4 mr-1" /> Upload
              </Button>
            </div>
            {featuredImage && (
              <div className="mt-2 rounded-lg overflow-hidden h-32 bg-muted">
                <img src={featuredImage} alt="" className="w-full h-full object-cover" data-testid="img-hero-preview" onError={e => (e.currentTarget.style.display = "none")} />
              </div>
            )}
          </div>

          <div>
            <Label>Nível de visibilidade</Label>
            <Select value={visibilityLevel} onValueChange={setVisibilityLevel}>
              <SelectTrigger data-testid="select-visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="teaser">Teaser (sem valor, dados limitados)</SelectItem>
                <SelectItem value="full">Completo (com valor e detalhes)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Email de contato</Label>
              <Input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="contato@empresa.com" data-testid="input-listing-email" />
            </div>
            <div>
              <Label>Telefone de contato</Label>
              <Input type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="(11) 99999-9999" data-testid="input-listing-phone" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!title.trim() || isPending} data-testid="btn-confirm-create-listing">
            {isPending ? "Criando..." : "Criar Publicação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditListingDialog({ listing, onClose, onSave, isPending }: {
  listing: any;
  onClose: () => void;
  onSave: (data: any) => void;
  isPending: boolean;
}) {
  const [title, setTitle] = useState(listing.title || "");
  const [subtitle, setSubtitle] = useState(listing.subtitle || "");
  const [description, setDescription] = useState(listing.description || "");
  const [featuredImage, setFeaturedImage] = useState(listing.featuredImage || "");
  const [visibilityLevel, setVisibilityLevel] = useState(listing.visibilityLevel || "teaser");
  const [contactEmail, setContactEmail] = useState(listing.contactEmail || "");
  const [contactPhone, setContactPhone] = useState(listing.contactPhone || "");
  const [accentColor, setAccentColor] = useState(listing.accentColor || "#1a365d");
  const [galleryImages, setGalleryImages] = useState<string[]>((listing.galleryImages as string[]) || []);
  const [newImageUrl, setNewImageUrl] = useState("");
  const [highlights, setHighlights] = useState<{ label: string; value: string }[]>((listing.highlights as any[]) || []);
  const [sections, setSections] = useState<{ title: string; content: string }[]>((listing.sectionsConfig as any[]) || []);
  const [editTab, setEditTab] = useState("geral");

  const addGalleryImage = () => {
    if (newImageUrl.trim()) {
      setGalleryImages([...galleryImages, newImageUrl.trim()]);
      setNewImageUrl("");
    }
  };

  const removeGalleryImage = (idx: number) => {
    setGalleryImages(galleryImages.filter((_: string, i: number) => i !== idx));
  };

  const addHighlight = () => setHighlights([...highlights, { label: "", value: "" }]);
  const removeHighlight = (idx: number) => setHighlights(highlights.filter((_: any, i: number) => i !== idx));
  const updateHighlight = (idx: number, field: "label" | "value", val: string) => {
    const updated = [...highlights];
    updated[idx] = { ...updated[idx], [field]: val };
    setHighlights(updated);
  };

  const addSection = () => setSections([...sections, { title: "", content: "" }]);
  const removeSection = (idx: number) => setSections(sections.filter((_: any, i: number) => i !== idx));
  const updateSection = (idx: number, field: "title" | "content", val: string) => {
    const updated = [...sections];
    updated[idx] = { ...updated[idx], [field]: val };
    setSections(updated);
  };

  const handleSave = () => {
    onSave({
      title: title.trim(),
      subtitle: subtitle.trim() || null,
      description: description.trim() || null,
      featuredImage: featuredImage.trim() || null,
      visibilityLevel,
      contactEmail: contactEmail.trim() || null,
      contactPhone: contactPhone.trim() || null,
      accentColor,
      galleryImages: galleryImages.filter(Boolean),
      highlights: highlights.filter(h => h.label && h.value),
      sectionsConfig: sections.filter(s => s.title || s.content),
    });
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit3 className="w-5 h-5" /> Editar Landing Page
          </DialogTitle>
        </DialogHeader>

        <Tabs value={editTab} onValueChange={setEditTab}>
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="geral" className="text-xs">Geral</TabsTrigger>
            <TabsTrigger value="galeria" className="text-xs">Galeria</TabsTrigger>
            <TabsTrigger value="destaques" className="text-xs">Destaques</TabsTrigger>
            <TabsTrigger value="secoes" className="text-xs">Seções</TabsTrigger>
          </TabsList>

          <TabsContent value="geral" className="space-y-4 mt-4">
            <div>
              <Label>Título *</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} data-testid="edit-listing-title" />
            </div>
            <div>
              <Label>Subtítulo</Label>
              <Input value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="Frase de impacto para a landing page" />
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} />
            </div>
            <div>
              <Label>Imagem de capa</Label>
              <div className="flex gap-2">
                <Input value={featuredImage} onChange={e => setFeaturedImage(e.target.value)} placeholder="https://..." className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "image/*";
                    input.onchange = async () => {
                      if (input.files?.length) {
                        const urls = await uploadImages(input.files);
                        if (urls.length > 0) setFeaturedImage(urls[0]);
                      }
                    };
                    input.click();
                  }}
                  data-testid="btn-upload-hero"
                >
                  <Upload className="w-4 h-4 mr-1" /> Upload
                </Button>
              </div>
              {featuredImage && (
                <div className="mt-2 rounded-lg overflow-hidden h-32 bg-muted">
                  <img src={featuredImage} alt="" className="w-full h-full object-cover" data-testid="img-hero-preview" onError={e => (e.currentTarget.style.display = "none")} />
                </div>
              )}
            </div>
            <div>
              <Label>Visibilidade</Label>
              <Select value={visibilityLevel} onValueChange={setVisibilityLevel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="teaser">Teaser</SelectItem>
                  <SelectItem value="full">Completo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Email de contato</Label>
                <Input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} />
              </div>
              <div>
                <Label>Telefone</Label>
                <Input type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="flex items-center gap-2">
                <Palette className="w-4 h-4" /> Cor de destaque
              </Label>
              <div className="flex items-center gap-3 mt-1">
                <input
                  type="color"
                  value={accentColor}
                  onChange={e => setAccentColor(e.target.value)}
                  className="w-10 h-10 rounded-lg border border-border cursor-pointer"
                />
                <Input value={accentColor} onChange={e => setAccentColor(e.target.value)} className="max-w-[120px] h-10" />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="galeria" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">Adicione imagens extras para a galeria da landing page.</p>
            <div className="flex gap-2">
              <Input
                value={newImageUrl}
                onChange={e => setNewImageUrl(e.target.value)}
                placeholder="URL da imagem..."
                className="flex-1"
                onKeyDown={e => e.key === "Enter" && addGalleryImage()}
                data-testid="input-gallery-url"
              />
              <Button variant="outline" size="sm" onClick={addGalleryImage} disabled={!newImageUrl.trim()} data-testid="btn-add-gallery">
                <Plus className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = "image/*";
                  input.multiple = true;
                  input.onchange = async () => {
                    if (input.files?.length) {
                      const urls = await uploadImages(input.files);
                      if (urls.length > 0) setGalleryImages(prev => [...prev, ...urls]);
                    }
                  };
                  input.click();
                }}
                data-testid="btn-upload-gallery"
              >
                <Upload className="w-4 h-4 mr-1" /> Upload
              </Button>
            </div>
            {galleryImages.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {galleryImages.map((img: string, i: number) => (
                  <div key={i} className="relative rounded-lg overflow-hidden h-24 bg-muted group">
                    <img src={img} alt="" className="w-full h-full object-cover" data-testid={`img-gallery-${i}`} />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => removeGalleryImage(i)}
                      data-testid={`btn-remove-gallery-${i}`}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {galleryImages.length === 0 && (
              <div className="text-center py-8 text-muted-foreground/60 border border-dashed rounded-lg">
                <Image className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                <p className="text-sm">Nenhuma imagem na galeria</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="destaques" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">Destaques aparecem como badges de informação rápida na landing page.</p>
            {highlights.map((h: any, i: number) => (
              <div key={i} className="flex gap-2 items-center">
                <Input
                  value={h.label}
                  onChange={e => updateHighlight(i, "label", e.target.value)}
                  placeholder="Ex: Produtividade"
                  className="flex-1"
                />
                <Input
                  value={h.value}
                  onChange={e => updateHighlight(i, "value", e.target.value)}
                  placeholder="Ex: 60 sc/ha"
                  className="flex-1"
                />
                <Button variant="ghost" size="icon" className="shrink-0 text-red-500" onClick={() => removeHighlight(i)} data-testid={`btn-remove-highlight-${i}`}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addHighlight} data-testid="btn-add-highlight">
              <Plus className="w-4 h-4 mr-1" /> Adicionar Destaque
            </Button>
          </TabsContent>

          <TabsContent value="secoes" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">Seções de conteúdo adicionais para a landing page.</p>
            {sections.map((s: any, i: number) => (
              <div key={i} className="p-3 border rounded-lg space-y-2 bg-muted/30">
                <div className="flex items-center gap-2">
                  <Input
                    value={s.title}
                    onChange={e => updateSection(i, "title", e.target.value)}
                    placeholder="Título da seção"
                    className="flex-1"
                  />
                  <Button variant="ghost" size="icon" className="shrink-0 text-red-500" onClick={() => removeSection(i)} data-testid={`btn-remove-section-${i}`}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <Textarea
                  value={s.content}
                  onChange={e => updateSection(i, "content", e.target.value)}
                  placeholder="Conteúdo da seção..."
                  rows={3}
                />
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addSection} data-testid="btn-add-section">
              <Plus className="w-4 h-4 mr-1" /> Adicionar Seção
            </Button>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!title.trim() || isPending} data-testid="btn-save-listing">
            {isPending ? "Salvando..." : "Salvar Alterações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function slugify(text: string) {
  return text.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function LandingPageCard({ lp, st, lpUrl, onEdit, onPublish, onArchive, onReactivate, onDelete, toast }: any) {
  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    navigator.clipboard.writeText(lpUrl);
    setCopied(true);
    toast({ title: "Link copiado!" });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="border-border/50 shadow-sm" data-testid={`lp-card-${lp.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3 flex-1 min-w-0">
            {lp.featuredImage ? (
              <div className="w-16 h-12 rounded-lg overflow-hidden shrink-0 bg-muted">
                <img src={lp.featuredImage} alt="" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-16 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Link2 className="w-5 h-5 text-muted-foreground/40" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold truncate">{lp.title}</h3>
                <Badge className={cn("text-[10px] h-5", st.color)}>{st.label}</Badge>
              </div>
              {lp.asset && (
                <p className="text-xs text-muted-foreground">
                  {TIPO_LABEL[lp.asset.type] || lp.asset.type}
                  {lp.asset.estado && ` — ${lp.asset.municipio || ""} ${lp.asset.estado}`}
                </p>
              )}
              <div className="flex items-center gap-3 mt-1.5">
                <button
                  className="text-[11px] text-primary hover:underline flex items-center gap-1 font-mono"
                  onClick={copyLink}
                  data-testid={`btn-copy-lp-${lp.id}`}
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  /lp/{lp.slug}
                </button>
                {lp.viewCount > 0 && (
                  <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                    <Eye className="w-3 h-3" /> {lp.viewCount} views
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            {lp.status === "published" && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => window.open(`/lp/${lp.slug}`, "_blank")}
                data-testid={`btn-preview-lp-${lp.id}`}
              >
                <ExternalLink className="w-3 h-3 mr-1" /> Ver
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onEdit} data-testid={`btn-edit-lp-${lp.id}`}>
              <Edit3 className="w-3 h-3 mr-1" /> Editar
            </Button>
            {lp.status === "draft" && (
              <Button size="sm" className="h-8 text-xs" onClick={onPublish} data-testid={`btn-publish-lp-${lp.id}`}>
                Publicar
              </Button>
            )}
            {lp.status === "published" && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onArchive}>
                Arquivar
              </Button>
            )}
            {lp.status === "archived" && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onReactivate}>
                Reativar
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-8 text-xs text-red-500 hover:text-red-700" onClick={onDelete} data-testid={`btn-delete-lp-${lp.id}`}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateLPDialog({ open, onOpenChange, assets, onSubmit, isPending }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  assets: any[];
  onSubmit: (data: any) => void;
  isPending: boolean;
}) {
  const [assetId, setAssetId] = useState("");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [featuredImage, setFeaturedImage] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  const selectedAsset = assets.find(a => a.id === Number(assetId));

  const handleAssetChange = (v: string) => {
    setAssetId(v);
    const asset = assets.find(a => a.id === Number(v));
    if (asset) {
      setTitle(asset.title || "");
      setSlug(slugify(asset.title || ""));
      setDescription(asset.description || "");
    }
  };

  const handleTitleChange = (v: string) => {
    setTitle(v);
    if (!slug || slug === slugify(title)) {
      setSlug(slugify(v));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova Landing Page</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Ativo vinculado</Label>
            <Select value={assetId} onValueChange={handleAssetChange}>
              <SelectTrigger data-testid="select-lp-asset">
                <SelectValue placeholder="Selecione um ativo..." />
              </SelectTrigger>
              <SelectContent>
                {assets.map((a: any) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.title} ({TIPO_LABEL[a.type] || a.type})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Título da página</Label>
            <Input value={title} onChange={e => handleTitleChange(e.target.value)} placeholder="Ex: Fazenda Premium 500ha no MT" data-testid="input-lp-title" />
          </div>
          <div>
            <Label>
              Slug (URL) <span className="text-muted-foreground text-xs font-normal ml-1">/lp/{slug || "..."}</span>
            </Label>
            <Input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="fazenda-premium-500ha-mt" data-testid="input-lp-slug" />
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Descrição da oportunidade..." data-testid="input-lp-description" />
          </div>
          <div>
            <Label>Imagem de capa</Label>
            <div className="flex gap-2">
              <Input value={featuredImage} onChange={e => setFeaturedImage(e.target.value)} placeholder="https://..." className="flex-1" data-testid="input-lp-image" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = "image/*";
                  input.onchange = async () => {
                    if (input.files?.length) {
                      const urls = await uploadImages(input.files);
                      if (urls.length > 0) setFeaturedImage(urls[0]);
                    }
                  };
                  input.click();
                }}
                data-testid="btn-upload-hero"
              >
                <Upload className="w-4 h-4 mr-1" /> Upload
              </Button>
            </div>
            {featuredImage && (
              <div className="mt-2 rounded-lg overflow-hidden h-32 bg-muted">
                <img src={featuredImage} alt="" className="w-full h-full object-cover" data-testid="img-hero-preview" onError={e => (e.currentTarget.style.display = "none")} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Email de contato</Label>
              <Input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} data-testid="input-lp-contact-email" />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} data-testid="input-lp-contact-phone" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={() => onSubmit({
              assetId: assetId ? Number(assetId) : null,
              title, slug, description,
              featuredImage: featuredImage || null,
              contactEmail: contactEmail || null,
              contactPhone: contactPhone || null,
            })}
            disabled={!title.trim() || !slug.trim() || isPending}
            data-testid="btn-create-lp"
          >
            {isPending ? "Criando..." : "Criar Landing Page"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditLPDialog({ lp, onClose, onSave, isPending }: {
  lp: any;
  onClose: () => void;
  onSave: (data: any) => void;
  isPending: boolean;
}) {
  const [title, setTitle] = useState(lp.title || "");
  const [subtitle, setSubtitle] = useState(lp.subtitle || "");
  const [slug, setSlug] = useState(lp.slug || "");
  const [description, setDescription] = useState(lp.description || "");
  const [featuredImage, setFeaturedImage] = useState(lp.featuredImage || "");
  const [contactEmail, setContactEmail] = useState(lp.contactEmail || "");
  const [contactPhone, setContactPhone] = useState(lp.contactPhone || "");
  const [accentColor, setAccentColor] = useState(lp.accentColor || "#1a365d");
  const [galleryImages, setGalleryImages] = useState<string[]>(lp.galleryImages || []);
  const [highlights, setHighlights] = useState<{ label: string; value: string }[]>(lp.highlights || []);
  const [sections, setSections] = useState<{ title: string; content: string }[]>(lp.sectionsConfig || []);
  const [newImageUrl, setNewImageUrl] = useState("");

  const addGalleryImage = () => {
    if (newImageUrl.trim()) {
      setGalleryImages([...galleryImages, newImageUrl.trim()]);
      setNewImageUrl("");
    }
  };
  const removeGalleryImage = (i: number) => setGalleryImages(galleryImages.filter((_, idx) => idx !== i));
  const addHighlight = () => setHighlights([...highlights, { label: "", value: "" }]);
  const removeHighlight = (i: number) => setHighlights(highlights.filter((_, idx) => idx !== i));
  const updateHighlight = (i: number, field: string, val: string) => {
    const copy = [...highlights];
    (copy[i] as any)[field] = val;
    setHighlights(copy);
  };
  const addSection = () => setSections([...sections, { title: "", content: "" }]);
  const removeSection = (i: number) => setSections(sections.filter((_, idx) => idx !== i));
  const updateSection = (i: number, field: string, val: string) => {
    const copy = [...sections];
    (copy[i] as any)[field] = val;
    setSections(copy);
  };

  const handleSave = () => {
    onSave({
      title, subtitle, slug, description,
      featuredImage: featuredImage || null,
      contactEmail: contactEmail || null,
      contactPhone: contactPhone || null,
      accentColor,
      galleryImages,
      highlights: highlights.filter(h => h.label.trim()),
      sectionsConfig: sections.filter(s => s.title.trim() || s.content.trim()),
    });
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Landing Page</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="geral" className="mt-2">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="geral">Geral</TabsTrigger>
            <TabsTrigger value="galeria">Galeria</TabsTrigger>
            <TabsTrigger value="destaques">Destaques</TabsTrigger>
            <TabsTrigger value="secoes">Seções</TabsTrigger>
          </TabsList>

          <TabsContent value="geral" className="space-y-4 mt-4">
            <div>
              <Label>Título</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} data-testid="input-edit-lp-title" />
            </div>
            <div>
              <Label>Subtítulo</Label>
              <Input value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="Uma breve descrição complementar" data-testid="input-edit-lp-subtitle" />
            </div>
            <div>
              <Label>
                Slug (URL) <span className="text-muted-foreground text-xs font-normal ml-1">/lp/{slug}</span>
              </Label>
              <Input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} data-testid="input-edit-lp-slug" />
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} data-testid="input-edit-lp-desc" />
            </div>
            <div>
              <Label>Imagem de capa</Label>
              <div className="flex gap-2">
                <Input value={featuredImage} onChange={e => setFeaturedImage(e.target.value)} placeholder="https://..." className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "image/*";
                    input.onchange = async () => {
                      if (input.files?.length) {
                        const urls = await uploadImages(input.files);
                        if (urls.length > 0) setFeaturedImage(urls[0]);
                      }
                    };
                    input.click();
                  }}
                  data-testid="btn-upload-hero"
                >
                  <Upload className="w-4 h-4 mr-1" /> Upload
                </Button>
              </div>
              {featuredImage && (
                <div className="mt-2 rounded-lg overflow-hidden h-32 bg-muted">
                  <img src={featuredImage} alt="" className="w-full h-full object-cover" data-testid="img-hero-preview" onError={e => (e.currentTarget.style.display = "none")} />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Email de contato</Label>
                <Input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} />
              </div>
              <div>
                <Label>Telefone</Label>
                <Input type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="flex items-center gap-2">
                <Palette className="w-4 h-4" /> Cor de destaque
              </Label>
              <div className="flex items-center gap-3 mt-1">
                <input type="color" value={accentColor} onChange={e => setAccentColor(e.target.value)} className="w-10 h-10 rounded-lg border border-border cursor-pointer" />
                <Input value={accentColor} onChange={e => setAccentColor(e.target.value)} className="max-w-[120px] h-10" />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="galeria" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">Adicione imagens extras para a galeria.</p>
            <div className="flex gap-2">
              <Input value={newImageUrl} onChange={e => setNewImageUrl(e.target.value)} placeholder="URL da imagem..." className="flex-1" onKeyDown={e => e.key === "Enter" && addGalleryImage()} />
              <Button variant="outline" size="sm" onClick={addGalleryImage} disabled={!newImageUrl.trim()}>
                <Plus className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = "image/*";
                  input.multiple = true;
                  input.onchange = async () => {
                    if (input.files?.length) {
                      const urls = await uploadImages(input.files);
                      if (urls.length > 0) setGalleryImages(prev => [...prev, ...urls]);
                    }
                  };
                  input.click();
                }}
                data-testid="btn-upload-gallery"
              >
                <Upload className="w-4 h-4 mr-1" /> Upload
              </Button>
            </div>
            {galleryImages.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {galleryImages.map((img: string, i: number) => (
                  <div key={i} className="relative rounded-lg overflow-hidden h-24 bg-muted group">
                    <img src={img} alt="" className="w-full h-full object-cover" data-testid={`img-gallery-${i}`} />
                    <Button variant="ghost" size="icon" className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeGalleryImage(i)}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground/60 border border-dashed rounded-lg">
                <Image className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                <p className="text-sm">Nenhuma imagem na galeria</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="destaques" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">Destaques aparecem como badges de informação rápida.</p>
            {highlights.map((h: any, i: number) => (
              <div key={i} className="flex gap-2 items-center">
                <Input value={h.label} onChange={e => updateHighlight(i, "label", e.target.value)} placeholder="Ex: Produtividade" className="flex-1" />
                <Input value={h.value} onChange={e => updateHighlight(i, "value", e.target.value)} placeholder="Ex: 60 sc/ha" className="flex-1" />
                <Button variant="ghost" size="icon" className="shrink-0 text-red-500" onClick={() => removeHighlight(i)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addHighlight}>
              <Plus className="w-4 h-4 mr-1" /> Adicionar Destaque
            </Button>
          </TabsContent>

          <TabsContent value="secoes" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">Seções de conteúdo adicionais.</p>
            {sections.map((s: any, i: number) => (
              <div key={i} className="p-3 border rounded-lg space-y-2 bg-muted/30">
                <div className="flex items-center gap-2">
                  <Input value={s.title} onChange={e => updateSection(i, "title", e.target.value)} placeholder="Título da seção" className="flex-1" />
                  <Button variant="ghost" size="icon" className="shrink-0 text-red-500" onClick={() => removeSection(i)}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <Textarea value={s.content} onChange={e => updateSection(i, "content", e.target.value)} placeholder="Conteúdo da seção..." rows={3} />
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addSection}>
              <Plus className="w-4 h-4 mr-1" /> Adicionar Seção
            </Button>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!title.trim() || !slug.trim() || isPending} data-testid="btn-save-lp">
            {isPending ? "Salvando..." : "Salvar Alterações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
