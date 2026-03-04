import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Loader2, Upload, Camera, Check, X, FileText, User,
  Home, Wallet, ClipboardList, LogOut, Building2, Eye,
  ChevronDown, ChevronUp, MapPin,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const CATEGORY_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  pessoal: { label: "Documentos Pessoais", icon: User, color: "text-blue-500" },
  imovel: { label: "Imóvel / Garantia", icon: Home, color: "text-green-500" },
  renda: { label: "Renda e Financeiro", icon: Wallet, color: "text-amber-500" },
  briefing: { label: "Briefing da Operação", icon: ClipboardList, color: "text-purple-500" },
};

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; color: string }> = {
  pendente: { label: "Pendente", variant: "outline", color: "text-slate-400" },
  enviado: { label: "Enviado", variant: "secondary", color: "text-blue-500" },
  aprovado: { label: "Aprovado", variant: "default", color: "text-green-500" },
  rejeitado: { label: "Rejeitado", variant: "destructive", color: "text-red-500" },
};

function getPortalHeaders(): Record<string, string> {
  return {
    "x-portal-client-id": sessionStorage.getItem("portalClientId") || "",
    "x-portal-token": sessionStorage.getItem("portalToken") || "",
  };
}

async function portalFetch(url: string, options?: RequestInit) {
  const headers = { ...getPortalHeaders(), ...(options?.headers || {}) };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Erro na requisição" }));
    throw new Error(err.message);
  }
  return res.json();
}

function formatTaxId(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return digits
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

function formatCep(value: string): string {
  return value.replace(/\D/g, "").replace(/(\d{5})(\d{1,3})/, "$1-$2").slice(0, 9);
}

export default function PortalClienteDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    pessoal: true, imovel: true, renda: true, briefing: true,
  });
  const [uploadingDocId, setUploadingDocId] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewDocId, setPreviewDocId] = useState<number | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [cnpjInput, setCnpjInput] = useState("");
  const [cepInput, setCepInput] = useState("");
  const [cnpjData, setCnpjData] = useState<any>(null);
  const [cepData, setCepData] = useState<any>(null);
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);

  const clientStr = sessionStorage.getItem("portalClient");
  const client = clientStr ? JSON.parse(clientStr) : null;

  useEffect(() => {
    if (!client) {
      setLocation("/portal-cliente");
    }
  }, [client, setLocation]);

  const { data: meData } = useQuery({
    queryKey: ["/api/norion-portal/me"],
    queryFn: () => portalFetch("/api/norion-portal/me"),
    enabled: !!client,
  });

  const { data: docs = [], isLoading: docsLoading } = useQuery({
    queryKey: ["/api/norion-portal/documentos"],
    queryFn: () => portalFetch("/api/norion-portal/documentos"),
    enabled: !!client,
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ docId, file }: { docId: number; file: File }) => {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.readAsDataURL(file);
      });

      return portalFetch(`/api/norion-portal/documentos/${docId}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileBase64: base64,
          fileName: file.name,
          mimeType: file.type,
        }),
      });
    },
    onSuccess: () => {
      toast({ title: "Documento enviado com sucesso!" });
      qc.invalidateQueries({ queryKey: ["/api/norion-portal/documentos"] });
      setPreviewUrl(null);
      setPreviewFile(null);
      setPreviewDocId(null);
      setUploadingDocId(null);
    },
    onError: (err: any) => {
      toast({ title: "Erro no envio", description: err.message, variant: "destructive" });
    },
  });

  const handleFileSelect = (docId: number) => {
    setUploadingDocId(docId);
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadingDocId) return;

    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      setPreviewFile(file);
      setPreviewDocId(uploadingDocId);
    } else {
      uploadMutation.mutate({ docId: uploadingDocId, file });
    }
    e.target.value = "";
  };

  const confirmUpload = () => {
    if (previewDocId && previewFile) {
      uploadMutation.mutate({ docId: previewDocId, file: previewFile });
    }
  };

  const cancelPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewFile(null);
    setPreviewDocId(null);
    setUploadingDocId(null);
  };

  const lookupCnpj = useCallback(async () => {
    const digits = cnpjInput.replace(/\D/g, "");
    if (digits.length !== 14) return;
    setCnpjLoading(true);
    try {
      const data = await portalFetch(`/api/norion-portal/cnpj/${digits}`);
      setCnpjData(data);
    } catch {
      toast({ title: "CNPJ não encontrado", variant: "destructive" });
    } finally {
      setCnpjLoading(false);
    }
  }, [cnpjInput, toast]);

  const lookupCep = useCallback(async () => {
    const digits = cepInput.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const data = await portalFetch(`/api/norion-portal/cep/${digits}`);
      setCepData(data);
    } catch {
      toast({ title: "CEP não encontrado", variant: "destructive" });
    } finally {
      setCepLoading(false);
    }
  }, [cepInput, toast]);

  const handleLogout = () => {
    sessionStorage.removeItem("portalClientId");
    sessionStorage.removeItem("portalToken");
    sessionStorage.removeItem("portalClient");
    setLocation("/portal-cliente");
  };

  if (!client) return null;

  const grouped = (docs as any[]).reduce((acc: Record<string, any[]>, doc: any) => {
    const cat = doc.categoria || "outros";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(doc);
    return acc;
  }, {});

  const totalDocs = (docs as any[]).length;
  const sentDocs = (docs as any[]).filter((d: any) => d.status === "enviado" || d.status === "aprovado").length;
  const progressPercent = totalDocs > 0 ? Math.round((sentDocs / totalDocs) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="bg-slate-800 text-white sticky top-0 z-40">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-amber-400" />
            <span className="font-semibold text-sm">Norion Capital</span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/portal-cliente/formulario")} className="text-slate-300 hover:text-white text-xs" data-testid="link-nav-formulario">
              <ClipboardList className="w-3.5 h-3.5 mr-1" />
              Formulário
            </Button>
            <span className="text-xs text-slate-300 hidden sm:block" data-testid="text-portal-client-name">{client.name || formatTaxId(client.taxId)}</span>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-slate-300 hover:text-white" data-testid="button-portal-logout">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 space-y-4">
        {meData?.operation && (
          <Card>
            <CardContent className="p-4">
              <p className="text-sm font-medium text-muted-foreground">Operação</p>
              <p className="font-semibold" data-testid="text-portal-operation">{meData.operation.tipoCredito} - {meData.company?.tradeName || meData.company?.legalName || "—"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Valor: R$ {Number(meData.operation.valorSolicitado || 0).toLocaleString("pt-BR")}</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium">Progresso dos Documentos</p>
              <span className="text-xs font-bold text-amber-600" data-testid="text-portal-progress">{sentDocs}/{totalDocs}</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
            <p className="text-xs text-muted-foreground mt-1">{progressPercent}% concluído</p>
          </CardContent>
        </Card>

        {docsLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          Object.entries(CATEGORY_CONFIG).map(([catKey, catConfig]) => {
            const catDocs = grouped[catKey] || [];
            if (catDocs.length === 0) return null;
            const CatIcon = catConfig.icon;
            const isExpanded = expandedCategories[catKey];

            return (
              <Card key={catKey} data-testid={`card-portal-category-${catKey}`}>
                <CardContent className="p-0">
                  <button
                    className="w-full flex items-center justify-between p-4 text-left"
                    onClick={() => setExpandedCategories(prev => ({ ...prev, [catKey]: !prev[catKey] }))}
                    data-testid={`button-toggle-category-${catKey}`}
                  >
                    <div className="flex items-center gap-2">
                      <CatIcon className={cn("w-4 h-4", catConfig.color)} />
                      <span className="font-medium text-sm">{catConfig.label}</span>
                      <Badge variant="secondary" className="text-[10px] h-5">{catDocs.length}</Badge>
                    </div>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-2">
                      {catDocs.map((doc: any) => {
                        const statusConf = STATUS_CONFIG[doc.status] || STATUS_CONFIG.pendente;
                        const isUploading = uploadMutation.isPending && uploadingDocId === doc.id;

                        return (
                          <div
                            key={doc.id}
                            className="flex items-center justify-between p-3 rounded-lg border bg-white dark:bg-slate-800"
                            data-testid={`portal-doc-${doc.id}`}
                          >
                            <div className="flex-1 min-w-0 mr-3">
                              <p className="text-sm font-medium truncate">{doc.nomeDocumento || doc.tipoDocumento}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <Badge variant={statusConf.variant} className="text-[10px]">{statusConf.label}</Badge>
                                {doc.obrigatorio && <span className="text-[10px] text-red-500">Obrigatório</span>}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                              {doc.driveFileUrl && (
                                <Button variant="ghost" size="sm" asChild>
                                  <a href={doc.driveFileUrl} target="_blank" rel="noreferrer" data-testid={`button-view-doc-${doc.id}`}>
                                    <Eye className="w-4 h-4" />
                                  </a>
                                </Button>
                              )}
                              {(doc.status === "pendente" || doc.status === "rejeitado") && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleFileSelect(doc.id)}
                                  disabled={isUploading}
                                  className="text-xs"
                                  data-testid={`button-upload-doc-${doc.id}`}
                                >
                                  {isUploading ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <>
                                      <Upload className="w-3.5 h-3.5 mr-1" />
                                      Enviar
                                    </>
                                  )}
                                </Button>
                              )}
                              {doc.status === "aprovado" && <Check className="w-4 h-4 text-green-500" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}

        <Separator />

        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-medium text-sm flex items-center gap-2">
              <FileText className="w-4 h-4 text-muted-foreground" /> Dados da Operação
            </h3>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">CNPJ da Empresa</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="00.000.000/0001-00"
                    value={cnpjInput}
                    onChange={(e) => setCnpjInput(formatTaxId(e.target.value))}
                    onBlur={lookupCnpj}
                    className={cn(cnpjData && "border-green-500")}
                    data-testid="input-portal-cnpj"
                    maxLength={18}
                  />
                  {cnpjLoading && <Loader2 className="w-4 h-4 animate-spin self-center" />}
                </div>
                {cnpjData && (
                  <div className="text-xs bg-green-50 dark:bg-green-950/30 p-2 rounded border border-green-200 space-y-0.5" data-testid="cnpj-autofill-result">
                    <p className="font-medium">{cnpjData.company?.name || cnpjData.alias || "—"}</p>
                    {cnpjData.address && (
                      <p className="text-muted-foreground">
                        {cnpjData.address.street}, {cnpjData.address.number} - {cnpjData.address.district}, {cnpjData.address.city}/{cnpjData.address.state}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">CEP</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="00000-000"
                    value={cepInput}
                    onChange={(e) => setCepInput(formatCep(e.target.value))}
                    onBlur={lookupCep}
                    className={cn(cepData && "border-green-500")}
                    data-testid="input-portal-cep"
                    maxLength={9}
                  />
                  {cepLoading && <Loader2 className="w-4 h-4 animate-spin self-center" />}
                </div>
                {cepData && (
                  <div className="text-xs bg-green-50 dark:bg-green-950/30 p-2 rounded border border-green-200 space-y-0.5" data-testid="cep-autofill-result">
                    <p className="font-medium flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> {cepData.logradouro}
                    </p>
                    <p className="text-muted-foreground">{cepData.bairro} - {cepData.localidade}/{cepData.uf}</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
        data-testid="input-file-upload"
      />

      {previewUrl && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl max-w-md w-full overflow-hidden">
            <div className="p-3 border-b flex items-center justify-between">
              <span className="text-sm font-medium">Confirmar Envio</span>
              <Button variant="ghost" size="sm" onClick={cancelPreview}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-4">
              <img src={previewUrl} alt="Preview" className="w-full rounded-lg max-h-[50vh] object-contain" data-testid="img-upload-preview" />
            </div>
            <div className="p-3 border-t flex gap-2">
              <Button variant="outline" onClick={cancelPreview} className="flex-1" data-testid="button-cancel-upload">
                <X className="w-4 h-4 mr-1" /> Cancelar
              </Button>
              <Button onClick={confirmUpload} disabled={uploadMutation.isPending} className="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-900" data-testid="button-confirm-upload">
                {uploadMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                Enviar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
