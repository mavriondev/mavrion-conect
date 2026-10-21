import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Upload, FileText, ExternalLink, Trash2, Loader2,
  File, Image, FileSpreadsheet, FileType,
  Sparkles, ScanText, AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type DocumentoTipo = "ativo" | "empresa";

interface DocumentsPanelProps {
  tipo: DocumentoTipo;
  entityId: number;
  ativoTipo?: string;
  ativoTitulo?: string;
  empresaNome?: string;
}

function iconeArquivo(mimeType: string) {
  if (mimeType.startsWith("image/")) return <Image className="w-4 h-4 text-blue-500" />;
  if (mimeType.includes("pdf")) return <FileType className="w-4 h-4 text-red-500" />;
  if (mimeType.includes("sheet") || mimeType.includes("excel")) return <FileSpreadsheet className="w-4 h-4 text-green-600" />;
  if (mimeType.includes("word")) return <FileText className="w-4 h-4 text-blue-600" />;
  return <File className="w-4 h-4 text-muted-foreground" />;
}

function formatBytes(bytes: string | number): string {
  const b = Number(bytes);
  if (!b || isNaN(b)) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatNomeArquivo(nome: string): string {
  return nome.replace(/^\d{8}_\d{6}_/, "");
}

export default function DocumentsPanel({
  tipo, entityId, ativoTipo, ativoTitulo, empresaNome,
}: DocumentsPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const queryParams = new URLSearchParams();
  let endpoint = "";
  if (tipo === "ativo") {
    endpoint = `/api/documents/ativo/${entityId}`;
    queryParams.set("tipo", ativoTipo || "");
    queryParams.set("titulo", ativoTitulo || "");
  } else if (tipo === "empresa") {
    endpoint = `/api/documents/empresa/${entityId}`;
    queryParams.set("nome", empresaNome || "");
  }

  const queryKey = [`docs-${tipo}-${entityId}`];

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => apiRequest("GET", `${endpoint}?${queryParams}`).then(r => r.json()),
    enabled: !!(tipo === "ativo" ? ativoTitulo : empresaNome),
  });

  const arquivos: any[] = data?.arquivos || [];

  // Status de leitura pela IA (apenas para documentos de ativo)
  const textosQueryKey = [`docs-ativo-textos-${entityId}`];
  const { data: textosData } = useQuery({
    queryKey: textosQueryKey,
    queryFn: () => apiRequest("GET", `/api/documents/ativo/${entityId}/textos`).then(r => r.json()),
    enabled: tipo === "ativo",
    refetchInterval: (query) => {
      const t = (query.state.data as any)?.textos || [];
      return t.some((x: any) => x.status === "processando") ? 4000 : false;
    },
  });
  const textosPorArquivo: Record<string, any> = {};
  for (const t of (textosData?.textos || [])) {
    textosPorArquivo[t.fileId] = t;
  }

  const [reprocessando, setReprocessando] = useState<string | null>(null);

  const handleReprocessar = async (fileId: string) => {
    setReprocessando(fileId);
    try {
      const res = await fetch(`/api/documents/ativo/${entityId}/extrair/${fileId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // tipo/titulo permitem ao servidor validar que o arquivo pertence à pasta deste ativo
        body: JSON.stringify({ tipo: ativoTipo || "", titulo: ativoTitulo || "" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as any));
        throw new Error(err.message || "Erro ao iniciar leitura");
      }
      toast({ title: "Leitura pela IA iniciada", description: "O documento está sendo processado." });
      queryClient.invalidateQueries({ queryKey: textosQueryKey });
    } catch (err: any) {
      toast({ title: "Erro ao ler documento", description: err.message, variant: "destructive" });
    } finally {
      setReprocessando(null);
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);

    if (tipo === "ativo") {
      // Upload múltiplo em uma única requisição
      try {
        const formData = new FormData();
        for (const file of Array.from(files)) {
          formData.append("arquivos", file);
        }
        formData.append("tipo", ativoTipo || "");
        formData.append("titulo", ativoTitulo || "");

        const response = await fetch(endpoint, {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        const dataRes = await response.json().catch(() => ({} as any));
        if (!response.ok && !dataRes?.resultados) {
          throw new Error(dataRes.message || "Erro no upload");
        }
        const resultados: any[] = dataRes.resultados || [];
        const ok = resultados.filter(r => r.success);
        const falhas = resultados.filter(r => !r.success);
        if (ok.length > 0) {
          toast({
            title: `✓ ${ok.length} arquivo${ok.length !== 1 ? "s" : ""} enviado${ok.length !== 1 ? "s" : ""}!`,
            description: "A IA está lendo o conteúdo dos documentos.",
          });
        }
        for (const f of falhas) {
          toast({ title: `Erro ao enviar ${f.originalName}`, description: f.error, variant: "destructive" });
        }
      } catch (err: any) {
        toast({ title: "Erro no upload", description: err.message, variant: "destructive" });
      }
    } else {
      for (const file of Array.from(files)) {
        try {
          const formData = new FormData();
          formData.append("arquivo", file);
          if (tipo === "empresa") {
            formData.append("nome", empresaNome || "");
          } else {
            formData.append("titulo", ativoTitulo || "");
          }

          const response = await fetch(endpoint, {
            method: "POST",
            body: formData,
            credentials: "include",
          });

          if (!response.ok) {
            const err = await response.json();
            throw new Error(err.message || "Erro no upload");
          }

          toast({ title: `✓ ${file.name} enviado com sucesso!` });
        } catch (err: any) {
          toast({
            title: `Erro ao enviar ${file.name}`,
            description: err.message,
            variant: "destructive",
          });
        }
      }
    }

    setUploading(false);
    queryClient.invalidateQueries({ queryKey });
    if (tipo === "ativo") queryClient.invalidateQueries({ queryKey: textosQueryKey });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDelete = async () => {
    if (!deleteFileId) return;
    setDeleting(true);
    try {
      await apiRequest("DELETE", `/api/documents/${deleteFileId}`);
      toast({ title: "Documento removido" });
      queryClient.invalidateQueries({ queryKey });
    } catch {
      toast({ title: "Erro ao remover documento", variant: "destructive" });
    } finally {
      setDeleting(false);
      setDeleteFileId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/20 hover:border-primary/40 hover:bg-muted/30"
        )}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault();
          setDragOver(false);
          handleUpload(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        data-testid="upload-dropzone"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.txt"
          onChange={e => handleUpload(e.target.files)}
          data-testid="input-file-upload"
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Enviando documento...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="w-8 h-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">Clique ou arraste arquivos aqui</p>
            <p className="text-xs text-muted-foreground">
              PDF, imagem, Word, Excel — máximo 50MB por arquivo
              {tipo === "ativo" ? " · vários de uma vez · conteúdo lido pela IA" : ""}
            </p>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="text-center py-6 text-sm text-destructive">
          Erro ao carregar documentos. Verifique a conexão de armazenamento.
        </div>
      ) : arquivos.length === 0 ? (
        <div className="text-center py-8 space-y-1">
          <FileText className="w-10 h-10 mx-auto text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">Nenhum documento enviado ainda.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">
            {arquivos.length} documento{arquivos.length !== 1 ? "s" : ""}
          </p>
          {arquivos.map((arquivo: any) => (
            <Card key={arquivo.id} className="hover:border-primary/30 transition-colors">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="shrink-0">
                  {iconeArquivo(arquivo.mimeType || "")}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {formatNomeArquivo(arquivo.name)}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">
                      {formatBytes(arquivo.size)}
                    </span>
                    {arquivo.createdTime && (
                      <span className="text-xs text-muted-foreground">
                        · {new Date(arquivo.createdTime).toLocaleDateString("pt-BR")}
                      </span>
                    )}
                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                      {arquivo.webViewLink?.startsWith("/api/") ? "Local" : "Drive"}
                    </Badge>
                    {tipo === "ativo" && (() => {
                      const leitura = textosPorArquivo[arquivo.id];
                      if (!leitura) return null;
                      if (leitura.status === "processando") {
                        return (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 gap-1 text-blue-600 border-blue-300" data-testid={`badge-ia-processando-${arquivo.id}`}>
                            <Loader2 className="w-2.5 h-2.5 animate-spin" /> Processando
                          </Badge>
                        );
                      }
                      if (leitura.status === "concluido") {
                        return (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 gap-1 text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30" data-testid={`badge-ia-lido-${arquivo.id}`} title={`Texto extraído (${leitura.metodo === "visao" || leitura.metodo === "visao_pdf" ? "leitura por visão IA" : "extração direta"}, ${leitura.textoChars} caracteres)`}>
                            <Sparkles className="w-2.5 h-2.5" /> Lido pela IA
                          </Badge>
                        );
                      }
                      if (leitura.status === "sem_texto") {
                        return (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 gap-1 text-muted-foreground" data-testid={`badge-ia-sem-texto-${arquivo.id}`} title={leitura.erro || "Nenhum texto extraível"}>
                            Sem texto extraível
                          </Badge>
                        );
                      }
                      return (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 gap-1 text-amber-700 border-amber-300" data-testid={`badge-ia-erro-${arquivo.id}`} title={leitura.erro || "Erro na leitura"}>
                          <AlertTriangle className="w-2.5 h-2.5" /> Erro na leitura
                        </Badge>
                      );
                    })()}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {tipo === "ativo" && (() => {
                    const leitura = textosPorArquivo[arquivo.id];
                    const podeReprocessar = !leitura || leitura.status === "erro" || leitura.status === "sem_texto";
                    if (!podeReprocessar) return null;
                    return (
                      <Button
                        size="sm" variant="ghost" className="h-7 px-1.5 text-xs gap-1"
                        onClick={() => handleReprocessar(arquivo.id)}
                        disabled={reprocessando === arquivo.id}
                        title="Ler conteúdo com IA"
                        data-testid={`button-ler-ia-${arquivo.id}`}
                      >
                        {reprocessando === arquivo.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <ScanText className="w-3.5 h-3.5" />}
                        <span className="hidden sm:inline">Ler com IA</span>
                      </Button>
                    );
                  })()}
                  <Button
                    size="sm" variant="ghost" className="h-7 w-7 p-0"
                    onClick={() => window.open(arquivo.webViewLink, "_blank")}
                    title="Abrir no Google Drive"
                    data-testid={`button-open-doc-${arquivo.id}`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm" variant="ghost"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteFileId(arquivo.id)}
                    title="Remover documento"
                    data-testid={`button-delete-doc-${arquivo.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteFileId} onOpenChange={() => setDeleteFileId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover documento?</AlertDialogTitle>
            <AlertDialogDescription>
              O arquivo será removido permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete-doc"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
