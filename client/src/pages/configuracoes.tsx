import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Settings, Upload, Building2, HardDrive, CheckCircle2, XCircle,
  Link, Image, Save, ExternalLink, Crop, ZoomIn, RotateCw, Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ConfiguracoesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["/api/org/settings"],
    queryFn: () => apiRequest("GET", "/api/org/settings").then(r => r.json()),
  });

  const [companyName, setCompanyName] = useState("");
  const [currentLogo, setCurrentLogo] = useState("");

  if (settings && companyName === "" && (settings as any).company_name) {
    setCompanyName((settings as any).company_name || "");
  }
  if (settings && currentLogo === "" && (settings as any).logo_url) {
    setCurrentLogo((settings as any).logo_url || "");
  }

  const saveSetting = async (key: string, value: any) => {
    await apiRequest("PUT", `/api/org/settings/${key}`, { value });
    queryClient.invalidateQueries({ queryKey: ["/api/org/settings"] });
    toast({ title: "Configuração salva!" });
  };

  const removeLogo = async () => {
    await apiRequest("PUT", `/api/org/settings/logo_url`, { value: "" });
    setCurrentLogo("");
    queryClient.invalidateQueries({ queryKey: ["/api/org/settings"] });
    toast({ title: "Logo removida!" });
  };

  const driveConnected = (settings as any)?.drive_connected === true;

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-4 md:space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="page-title-configuracoes">
          <Settings className="w-6 h-6 text-primary" /> Configurações
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Gerencie as configurações da sua organização e integrações</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="w-4 h-4 text-muted-foreground" /> Identidade da Empresa
          </CardTitle>
          <CardDescription>Esses dados aparecem automaticamente nas propostas e contratos gerados</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Nome da empresa</Label>
            <div className="flex gap-2">
              <Input
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                placeholder="Ex: Capital Verde Investimentos"
                data-testid="input-company-name"
              />
              <Button variant="outline" onClick={() => saveSetting("company_name", companyName)} data-testid="btn-save-company-name">
                <Save className="w-4 h-4 mr-1.5" /> Salvar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Usado na variável <code className="bg-muted px-1 rounded text-primary">{"{{minha_empresa.nome}}"}</code>
            </p>
          </div>

          <Separator />

          <LogoUploadSection
            currentLogo={currentLogo}
            onLogoUpdated={(url) => {
              setCurrentLogo(url);
              queryClient.invalidateQueries({ queryKey: ["/api/org/settings"] });
            }}
            onRemoveLogo={removeLogo}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-muted-foreground" /> Google Drive
          </CardTitle>
          <CardDescription>
            Conecte seu Google Drive para que os arquivos anexados a deals sejam sincronizados automaticamente na nuvem
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${driveConnected ? "bg-green-100 dark:bg-green-900/30" : "bg-muted"}`}>
                <HardDrive className={`w-5 h-5 ${driveConnected ? "text-green-600" : "text-muted-foreground"}`} />
              </div>
              <div>
                <p className="font-medium text-sm">Google Drive</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {driveConnected ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      <span className="text-xs text-green-600 font-medium">Conectado</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Não conectado</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            {driveConnected ? (
              <Button variant="outline" size="sm" onClick={() => saveSetting("drive_connected", false)}>
                Desconectar
              </Button>
            ) : (
              <Button size="sm" onClick={() => {
                toast({
                  title: "Integração Google Drive",
                  description: "Para conectar o Google Drive, clique em 'Configurar integração' e siga o fluxo OAuth.",
                });
              }}>
                <Link className="w-4 h-4 mr-1.5" /> Conectar Drive
              </Button>
            )}
          </div>

          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-1">Como conectar o Google Drive</p>
            <ol className="text-xs text-amber-700 dark:text-amber-400 space-y-1 list-decimal list-inside">
              <li>Acesse as Integrações da plataforma</li>
              <li>Localize "Google Drive" e clique em "Conectar conta"</li>
              <li>Autorize o acesso à sua conta Google</li>
              <li>Todos os arquivos anexados aos deals serão salvos automaticamente no Drive</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Image className="w-4 h-4 text-muted-foreground" /> Manual de Variáveis — Propostas & Contratos
          </CardTitle>
          <CardDescription>
            Use estas variáveis no editor de templates. Elas são substituídas automaticamente pelos dados reais ao gerar uma proposta ou contrato.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              {
                group: "Empresa (vinculada ao deal ou proposta)",
                badge: "bg-blue-100 text-blue-700",
                vars: [
                  ["{{empresa.nome}}", "Nome comercial (tradeName) ou razão social"],
                  ["{{empresa.razao_social}}", "Razão social completa"],
                  ["{{empresa.cnpj}}", "CNPJ formatado: 00.000.000/0001-00"],
                  ["{{empresa.cidade}}", "Cidade do endereço cadastrado"],
                  ["{{empresa.estado}}", "Estado (UF)"],
                  ["{{empresa.porte}}", "Porte: Microempresa, EPP, Demais..."],
                  ["{{empresa.cnae_principal}}", "Atividade principal (CNAE)"],
                  ["{{empresa.website}}", "Site da empresa"],
                  ["{{empresa.telefone}}", "Primeiro telefone cadastrado"],
                  ["{{empresa.email}}", "Primeiro e-mail cadastrado"],
                ]
              },
              {
                group: "Ativo (imóvel, terra, mina, negócio...)",
                badge: "bg-green-100 text-green-700",
                vars: [
                  ["{{ativo.titulo}}", "Título do ativo"],
                  ["{{ativo.tipo}}", "Tipo: TERRA, MINA, NEGOCIO..."],
                  ["{{ativo.preco}}", "Preço pedido formatado em R$"],
                  ["{{ativo.area_ha}}", "Área em hectares"],
                  ["{{ativo.localizacao}}", "Localização / município"],
                  ["{{ativo.matricula}}", "Número de matrícula do imóvel"],
                  ["{{ativo.observacoes}}", "Observações do ativo"],
                ]
              },
              {
                group: "Investidor (fundo ou perfil)",
                badge: "bg-purple-100 text-purple-700",
                vars: [
                  ["{{investidor.nome}}", "Nome do fundo ou investidor"],
                  ["{{investidor.ticket_min}}", "Ticket mínimo formatado"],
                  ["{{investidor.ticket_max}}", "Ticket máximo formatado"],
                  ["{{investidor.regioes}}", "Regiões de interesse"],
                  ["{{investidor.tipos_ativos}}", "Tipos de ativos de interesse"],
                ]
              },
              {
                group: "Sua empresa",
                badge: "bg-amber-100 text-amber-700",
                vars: [
                  ["{{minha_empresa.nome}}", "Nome configurado acima"],
                  ["{{minha_empresa.logo}}", "URL da logo configurada acima"],
                ]
              },
              {
                group: "Data",
                badge: "bg-slate-100 text-slate-700",
                vars: [
                  ["{{data.hoje}}", "Ex: 22 de fevereiro de 2026"],
                  ["{{data.mes_ano}}", "Ex: fevereiro de 2026"],
                ]
              },
              {
                group: "Contrato",
                badge: "bg-indigo-100 text-indigo-700",
                vars: [
                  ["{{contrato.foro}}", "Foro de eleição"],
                  ["{{contrato.prazo}}", "Prazo do contrato"],
                  ["{{contrato.valor}}", "Valor do contrato"],
                  ["{{contrato.garantia}}", "Garantia contratual"],
                  ["{{contrato.clausula_especial}}", "Cláusula especial"],
                ]
              },
            ].map(section => (
              <div key={section.group}>
                <Badge className={`mb-2 text-xs font-medium ${section.badge} border-0`}>{section.group}</Badge>
                <table className="w-full text-xs">
                  <tbody>
                    {section.vars.map(([key, desc]) => (
                      <tr key={key} className="border-b border-border/40 last:border-0">
                        <td className="py-1.5 pr-4 font-mono text-primary whitespace-nowrap">{key}</td>
                        <td className="py-1.5 text-muted-foreground">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LogoUploadSection({ currentLogo, onLogoUpdated, onRemoveLogo }: {
  currentLogo: string;
  onLogoUpdated: (url: string) => void;
  onRemoveLogo: () => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCropDialog, setShowCropDialog] = useState(false);
  const [rawImageSrc, setRawImageSrc] = useState("");
  const [uploading, setUploading] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Tipo inválido", description: "Selecione um arquivo de imagem (PNG, JPG, etc.)", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande", description: "O tamanho máximo é 5MB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setRawImageSrc(reader.result as string);
      setShowCropDialog(true);
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("logo", croppedBlob, "logo.png");
      const resp = await fetch("/api/upload/logo", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ message: "Erro desconhecido" }));
        throw new Error(err.message);
      }
      const data = await resp.json();
      onLogoUpdated(data.url);
      toast({ title: "Logo atualizada!" });
      setShowCropDialog(false);
    } catch (err: any) {
      toast({ title: "Erro ao enviar logo", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <Label>Logo da empresa</Label>
      <p className="text-xs text-muted-foreground -mt-1">
        Envie a logo da sua empresa. Usada em propostas e contratos como <code className="bg-muted px-1 rounded text-primary">{"{{minha_empresa.logo}}"}</code>
      </p>

      {currentLogo ? (
        <div className="flex items-center gap-4 p-4 border rounded-lg bg-muted/30">
          <div className="w-24 h-24 rounded-lg border bg-white dark:bg-gray-900 flex items-center justify-center overflow-hidden p-2">
            <img
              src={currentLogo}
              alt="Logo da empresa"
              className="max-w-full max-h-full object-contain"
              data-testid="img-current-logo"
            />
          </div>
          <div className="flex-1 space-y-2">
            <p className="text-sm font-medium">Logo atual</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                data-testid="btn-change-logo"
              >
                <Upload className="w-3.5 h-3.5 mr-1.5" /> Trocar
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-red-500 hover:text-red-700"
                onClick={onRemoveLogo}
                data-testid="btn-remove-logo"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Remover
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
          onClick={() => fileInputRef.current?.click()}
          data-testid="dropzone-logo"
        >
          <Upload className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">Clique para enviar a logo</p>
          <p className="text-xs text-muted-foreground/70 mt-1">PNG, JPG ou SVG. Máximo 5MB.</p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
        data-testid="input-file-logo"
      />

      <CropDialog
        open={showCropDialog}
        onOpenChange={setShowCropDialog}
        imageSrc={rawImageSrc}
        onCropComplete={handleCropComplete}
        uploading={uploading}
      />
    </div>
  );
}

function CropDialog({ open, onOpenChange, imageSrc, onCropComplete, uploading }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  imageSrc: string;
  onCropComplete: (blob: Blob) => void;
  uploading: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [imgLoaded, setImgLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [cropSize, setCropSize] = useState(200);

  useEffect(() => {
    if (open) {
      setScale(1);
      setOffsetX(0);
      setOffsetY(0);
      setImgLoaded(false);
    }
  }, [open, imageSrc]);

  const handleImageLoad = () => {
    setImgLoaded(true);
    const img = imgRef.current;
    if (img) {
      const containerSize = 400;
      const fitScale = Math.min(containerSize / img.naturalWidth, containerSize / img.naturalHeight, 1);
      setScale(fitScale);
      setOffsetX(0);
      setOffsetY(0);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    setDragStart({ x: e.clientX - offsetX, y: e.clientY - offsetY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setOffsetX(e.clientX - dragStart.x);
    setOffsetY(e.clientY - dragStart.y);
  };

  const handleMouseUp = () => setDragging(false);

  const handleCrop = () => {
    const img = imgRef.current;
    if (!img) return;

    const canvas = document.createElement("canvas");
    canvas.width = cropSize;
    canvas.height = cropSize;
    const ctx = canvas.getContext("2d")!;

    const containerSize = 400;
    const cropAreaLeft = (containerSize - cropSize) / 2;
    const cropAreaTop = (containerSize - cropSize) / 2;

    const imgDisplayWidth = img.naturalWidth * scale;
    const imgDisplayHeight = img.naturalHeight * scale;
    const imgDisplayX = (containerSize - imgDisplayWidth) / 2 + offsetX;
    const imgDisplayY = (containerSize - imgDisplayHeight) / 2 + offsetY;

    const srcX = (cropAreaLeft - imgDisplayX) / scale;
    const srcY = (cropAreaTop - imgDisplayY) / scale;
    const srcW = cropSize / scale;
    const srcH = cropSize / scale;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cropSize, cropSize);
    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, cropSize, cropSize);

    canvas.toBlob((blob) => {
      if (blob) onCropComplete(blob);
    }, "image/png", 0.95);
  };

  const containerSize = 400;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crop className="w-5 h-5" /> Ajustar Logo
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div
            ref={containerRef}
            className="relative mx-auto overflow-hidden bg-[repeating-conic-gradient(#e5e7eb_0%_25%,transparent_0%_50%)_0_0/20px_20px] dark:bg-[repeating-conic-gradient(#374151_0%_25%,transparent_0%_50%)_0_0/20px_20px] rounded-lg border"
            style={{ width: containerSize, height: containerSize, cursor: dragging ? "grabbing" : "grab" }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            data-testid="crop-area"
          >
            {imageSrc && (
              <img
                ref={imgRef}
                src={imageSrc}
                alt="Crop preview"
                onLoad={handleImageLoad}
                className="absolute select-none pointer-events-none"
                style={{
                  transform: `scale(${scale})`,
                  transformOrigin: "center center",
                  left: `calc(50% - ${imgRef.current ? imgRef.current.naturalWidth / 2 : 0}px + ${offsetX}px)`,
                  top: `calc(50% - ${imgRef.current ? imgRef.current.naturalHeight / 2 : 0}px + ${offsetY}px)`,
                }}
                draggable={false}
              />
            )}

            <div
              className="absolute border-2 border-primary rounded-md pointer-events-none"
              style={{
                width: cropSize,
                height: cropSize,
                left: (containerSize - cropSize) / 2,
                top: (containerSize - cropSize) / 2,
                boxShadow: `0 0 0 ${containerSize}px rgba(0,0,0,0.5)`,
              }}
            />

            <div
              className="absolute text-[10px] text-white/80 bg-black/50 rounded px-1.5 py-0.5 pointer-events-none"
              style={{
                left: (containerSize - cropSize) / 2 + 4,
                top: (containerSize + cropSize) / 2 + 4,
              }}
            >
              {cropSize} × {cropSize}px
            </div>
          </div>

          <div className="space-y-3 px-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs flex items-center gap-1.5">
                  <ZoomIn className="w-3.5 h-3.5" /> Zoom
                </Label>
                <span className="text-xs text-muted-foreground font-mono">{Math.round(scale * 100)}%</span>
              </div>
              <Slider
                value={[scale]}
                min={0.1}
                max={3}
                step={0.05}
                onValueChange={([v]) => setScale(v)}
                data-testid="slider-zoom"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs flex items-center gap-1.5">
                  <Crop className="w-3.5 h-3.5" /> Tamanho do recorte
                </Label>
                <span className="text-xs text-muted-foreground font-mono">{cropSize}px</span>
              </div>
              <Slider
                value={[cropSize]}
                min={64}
                max={380}
                step={4}
                onValueChange={([v]) => setCropSize(v)}
                data-testid="slider-crop-size"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Arraste a imagem para posicionar. Use o zoom e o recorte para ajustar.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={handleCrop}
            disabled={!imgLoaded || uploading}
            data-testid="btn-apply-crop"
          >
            {uploading ? "Enviando..." : "Aplicar e Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
