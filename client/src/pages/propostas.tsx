import { useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import FontFamily from "@tiptap/extension-font-family";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Heading1, Heading2, Heading3,
  Plus, Trash2, Edit, Download, Eye, FileText, ChevronDown,
  Variable, Copy, Check, X as XIcon, Braces, Building2, Layers, Send, Mail, Search, CloudUpload, ExternalLink,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// ── Variable reference ──────────────────────────────────────────────────────
const VARIABLE_GROUPS = [
  {
    label: "Empresa",
    color: "blue",
    vars: [
      { key: "{{empresa.nome}}", desc: "Nome comercial" },
      { key: "{{empresa.razao_social}}", desc: "Razão social" },
      { key: "{{empresa.cnpj}}", desc: "CNPJ formatado" },
      { key: "{{empresa.cidade}}", desc: "Cidade" },
      { key: "{{empresa.estado}}", desc: "Estado (UF)" },
      { key: "{{empresa.porte}}", desc: "Porte da empresa" },
      { key: "{{empresa.cnae_principal}}", desc: "CNAE principal" },
      { key: "{{empresa.website}}", desc: "Website" },
      { key: "{{empresa.telefone}}", desc: "Primeiro telefone" },
      { key: "{{empresa.email}}", desc: "Primeiro e-mail" },
    ]
  },
  {
    label: "Ativo",
    color: "green",
    vars: [
      { key: "{{ativo.titulo}}", desc: "Título do ativo" },
      { key: "{{ativo.tipo}}", desc: "Tipo (TERRA, MINA...)" },
      { key: "{{ativo.preco}}", desc: "Preço pedido" },
      { key: "{{ativo.area_ha}}", desc: "Área em hectares" },
      { key: "{{ativo.localizacao}}", desc: "Localização" },
      { key: "{{ativo.matricula}}", desc: "Matrícula" },
      { key: "{{ativo.observacoes}}", desc: "Observações" },
    ]
  },
  {
    label: "Investidor",
    color: "purple",
    vars: [
      { key: "{{investidor.nome}}", desc: "Nome do fundo/investidor" },
      { key: "{{investidor.ticket_min}}", desc: "Ticket mínimo" },
      { key: "{{investidor.ticket_max}}", desc: "Ticket máximo" },
      { key: "{{investidor.regioes}}", desc: "Regiões de interesse" },
      { key: "{{investidor.tipos_ativos}}", desc: "Tipos de ativos" },
    ]
  },
  {
    label: "Minha Empresa",
    color: "amber",
    vars: [
      { key: "{{minha_empresa.nome}}", desc: "Nome da sua empresa" },
      { key: "{{minha_empresa.logo}}", desc: "Logo (URL da imagem)" },
    ]
  },
  {
    label: "Data",
    color: "slate",
    vars: [
      { key: "{{data.hoje}}", desc: "Data de hoje por extenso" },
      { key: "{{data.mes_ano}}", desc: "Mês e ano atual" },
    ]
  },
];

const FONT_OPTIONS = [
  { label: "Inter (Padrão)", value: "Inter, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Courier New", value: "'Courier New', monospace" },
  { label: "Times New Roman", value: "'Times New Roman', serif" },
];

const COLOR_PRESETS = ["#000000", "#374151", "#1d4ed8", "#15803d", "#b45309", "#dc2626", "#7c3aed"];

// ── Toolbar ──────────────────────────────────────────────────────────────────
function ToolbarButton({ active, onClick, children, title }: {
  active?: boolean; onClick: () => void; children: React.ReactNode; title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "h-8 w-8 rounded flex items-center justify-center text-sm transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "hover:bg-muted text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function EditorToolbar({ editor }: { editor: any }) {
  if (!editor) return null;
  return (
    <div className="flex flex-wrap items-center gap-0.5 p-2 border-b bg-muted/30">
      {/* Heading */}
      <ToolbarButton
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        title="Título 1"
      ><Heading1 className="w-3.5 h-3.5" /></ToolbarButton>
      <ToolbarButton
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Título 2"
      ><Heading2 className="w-3.5 h-3.5" /></ToolbarButton>
      <ToolbarButton
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        title="Título 3"
      ><Heading3 className="w-3.5 h-3.5" /></ToolbarButton>

      <div className="w-px h-6 bg-border mx-1" />

      {/* Text style */}
      <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Negrito"><Bold className="w-3.5 h-3.5" /></ToolbarButton>
      <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Itálico"><Italic className="w-3.5 h-3.5" /></ToolbarButton>
      <ToolbarButton active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Sublinhado"><UnderlineIcon className="w-3.5 h-3.5" /></ToolbarButton>
      <ToolbarButton active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Tachado"><Strikethrough className="w-3.5 h-3.5" /></ToolbarButton>

      <div className="w-px h-6 bg-border mx-1" />

      {/* Alignment */}
      <ToolbarButton active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Alinhar à esquerda"><AlignLeft className="w-3.5 h-3.5" /></ToolbarButton>
      <ToolbarButton active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Centralizar"><AlignCenter className="w-3.5 h-3.5" /></ToolbarButton>
      <ToolbarButton active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="Alinhar à direita"><AlignRight className="w-3.5 h-3.5" /></ToolbarButton>
      <ToolbarButton active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()} title="Justificar"><AlignJustify className="w-3.5 h-3.5" /></ToolbarButton>

      <div className="w-px h-6 bg-border mx-1" />

      {/* Lists */}
      <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Lista"><List className="w-3.5 h-3.5" /></ToolbarButton>
      <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Lista numerada"><ListOrdered className="w-3.5 h-3.5" /></ToolbarButton>

      <div className="w-px h-6 bg-border mx-1" />

      {/* Font family */}
      <select
        className="h-8 text-xs border rounded px-1 bg-background text-foreground"
        value={editor.getAttributes("textStyle").fontFamily || ""}
        onChange={e => {
          if (e.target.value) {
            editor.chain().focus().setFontFamily(e.target.value).run();
          } else {
            editor.chain().focus().unsetFontFamily().run();
          }
        }}
      >
        <option value="">Fonte padrão</option>
        {FONT_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>

      {/* Color */}
      <div className="flex items-center gap-1 ml-1">
        {COLOR_PRESETS.map(c => (
          <button
            key={c}
            type="button"
            className="w-5 h-5 rounded-full border border-border/60 hover:scale-110 transition-transform"
            style={{ backgroundColor: c }}
            onClick={() => editor.chain().focus().setColor(c).run()}
            title={c}
          />
        ))}
        <input
          type="color"
          className="w-6 h-6 cursor-pointer rounded border"
          onChange={e => editor.chain().focus().setColor(e.target.value).run()}
          title="Cor personalizada"
        />
      </div>
    </div>
  );
}

// ── Variable floating popup ───────────────────────────────────────────────────
function VariablePopup({ onInsert, onClose }: { onInsert: (variable: string) => void; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);

  const copyAndInsert = (variable: string) => {
    onInsert(variable);
    setCopied(variable);
    setTimeout(() => setCopied(null), 1500);
  };

  const GROUP_COLORS: Record<string, string> = {
    "Empresa":      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    "Ativo":        "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    "Investidor":   "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
    "Minha Empresa":"bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    "Data":         "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300",
  };

  return (
    <div
      className="fixed bottom-6 right-6 z-[200] w-72 max-h-[70vh] flex flex-col bg-background border border-border rounded-xl shadow-2xl overflow-hidden"
      style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.22)" }}
      data-testid="variable-popup"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/40 shrink-0">
        <div className="flex items-center gap-2">
          <Braces className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Expressões</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Fechar"
          data-testid="button-close-variable-popup"
        >
          <XIcon className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground px-4 py-2 border-b shrink-0">
        Clique numa variável para inserir no editor
      </p>
      {/* Scrollable body */}
      <div className="overflow-y-auto p-3 space-y-4">
        {VARIABLE_GROUPS.map(group => (
          <div key={group.label}>
            <p className={cn("text-xs font-semibold px-2 py-1 rounded-md mb-1.5", GROUP_COLORS[group.label])}>
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.vars.map(v => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => copyAndInsert(v.key)}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-muted transition-colors group"
                >
                  <div className="flex items-center justify-between gap-1">
                    <code className="text-xs text-primary font-mono truncate">{v.key}</code>
                    {copied === v.key
                      ? <Check className="w-3 h-3 text-green-500 shrink-0" />
                      : <Copy className="w-3 h-3 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{v.desc}</p>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Template Editor Modal ─────────────────────────────────────────────────────
function TemplateEditorModal({
  template, onClose, onSaved
}: { template?: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(template?.name || "");
  const [type, setType] = useState(template?.type || "INVESTOR");
  const [showVars, setShowVars] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Highlight,
      TextStyle,
      FontFamily,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: "Escreva o conteúdo da proposta aqui. Use as variáveis ao lado para inserir dados dinâmicos..." }),
    ],
    content: template?.bodyHtml || "<p></p>",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none min-h-[400px] p-5 focus:outline-none dark:prose-invert",
      },
    },
  });

  const insertVariable = useCallback((variable: string) => {
    editor?.chain().focus().insertContent(variable).run();
  }, [editor]);

  const save = async () => {
    if (!name.trim()) { toast({ title: "Nome é obrigatório", variant: "destructive" }); return; }
    const bodyHtml = editor?.getHTML() || "";
    const bodyJson = editor?.getJSON();
    try {
      if (template?.id) {
        await apiRequest("PUT", `/api/proposals/templates/${template.id}`, { name, type, bodyHtml, bodyJson });
      } else {
        await apiRequest("POST", "/api/proposals/templates", { name, type, bodyHtml, bodyJson });
      }
      toast({ title: template?.id ? "Template salvo!" : "Template criado!" });
      onSaved();
      onClose();
    } catch {
      toast({ title: "Erro ao salvar template", variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-primary" />
          <div>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Nome do template..."
              className="h-7 text-base font-semibold border-0 shadow-none px-0 focus-visible:ring-0"
            />
          </div>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-7 text-xs w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="INVESTOR">Para Investidor</SelectItem>
              <SelectItem value="ASSET_OWNER">Para Cedente de Ativo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm"
            onClick={() => setShowVars(v => !v)}
            className={cn("gap-1.5", showVars && "border-primary text-primary bg-primary/5")}
            data-testid="button-toggle-expressoes"
          >
            <Braces className="w-4 h-4" /> Expressões
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={save}>Salvar Template</Button>
        </div>
      </div>

      {/* Editor area — full width, no sidebar */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <EditorToolbar editor={editor} />
          <div className="flex-1 overflow-y-auto">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      {/* Sticky bottom save bar */}
      <div className="shrink-0 border-t bg-background/95 backdrop-blur-sm px-4 py-3 flex items-center justify-between gap-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
        <p className="text-xs text-muted-foreground hidden sm:block">
          Use <span className="font-mono bg-muted px-1 rounded text-primary">{"{{variavel}}"}</span> para inserir dados dinâmicos — clique em <strong>Expressões</strong> para ver a lista completa
        </p>
        <div className="flex items-center gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={save} className="gap-1.5 min-w-[140px]" data-testid="button-save-template">
            <Check className="w-4 h-4" />
            {template?.id ? "Salvar Alterações" : "Criar Template"}
          </Button>
        </div>
      </div>

      {/* Floating variable popup */}
      {showVars && (
        <VariablePopup
          onInsert={insertVariable}
          onClose={() => setShowVars(false)}
        />
      )}
    </div>
  );
}

// ── Generate Proposal Dialog ──────────────────────────────────────────────────
function GenerateProposalDialog({ template, onGenerated }: { template: any; onGenerated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`${template.name} — ${new Date().toLocaleDateString("pt-BR")}`);
  const [companyId, setCompanyId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [investorId, setInvestorId] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: companies = [] } = useQuery({ queryKey: ["/api/crm/companies"], queryFn: () => apiRequest("GET", "/api/crm/companies").then(r => r.json()) });
  const { data: assets = [] } = useQuery({ queryKey: ["/api/matching/assets"], queryFn: () => apiRequest("GET", "/api/matching/assets").then(r => r.json()) });
  const { data: investors = [] } = useQuery({ queryKey: ["/api/matching/investors"], queryFn: () => apiRequest("GET", "/api/matching/investors").then(r => r.json()) });

  const selectedCompany = (companies as any[]).find(c => String(c.id) === companyId);
  const selectedAsset = (assets as any[]).find(a => String(a.id) === assetId);

  const generate = async () => {
    if (!name.trim()) { toast({ title: "Nome é obrigatório", variant: "destructive" }); return; }
    try {
      await apiRequest("POST", "/api/proposals", {
        templateId: template.id,
        name,
        type: template.type,
        companyId: companyId !== "none" && companyId ? parseInt(companyId) : undefined,
        assetId: assetId !== "none" && assetId ? parseInt(assetId) : undefined,
        investorProfileId: investorId !== "none" && investorId ? parseInt(investorId) : undefined,
      });
      toast({ title: "Proposta gerada!", description: `"${name}" está pronta para visualização.` });
      queryClient.invalidateQueries({ queryKey: ["/api/proposals"] });
      setOpen(false);
      onGenerated();
    } catch {
      toast({ title: "Erro ao gerar proposta", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="w-4 h-4 mr-1.5" /> Gerar Proposta
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Gerar Proposta — {template.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">

          {/* Empresa — destaque principal */}
          <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" />
              <Label className="text-sm font-semibold text-primary">Empresa destinatária</Label>
              <span className="ml-auto text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">Recomendado</span>
            </div>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger data-testid="select-proposal-company">
                <SelectValue placeholder="Selecionar empresa para importar dados..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhuma (proposta genérica)</SelectItem>
                {(companies as any[]).map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.tradeName || c.legalName}
                    {c.cnpj ? ` — ${c.cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCompany ? (
              <div className="rounded-md bg-background border p-3 space-y-1.5">
                <p className="text-xs font-semibold text-foreground">{selectedCompany.tradeName || selectedCompany.legalName}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {(selectedCompany.address?.city || selectedCompany.address?.state) && (
                    <span>📍 {[selectedCompany.address?.city, selectedCompany.address?.state].filter(Boolean).join(", ")}</span>
                  )}
                  {selectedCompany.porte && <span>🏢 {selectedCompany.porte}</span>}
                  {((selectedCompany.phones as string[]) || [])[0] && (
                    <span>📞 {((selectedCompany.phones as string[]) || [])[0]}</span>
                  )}
                  {((selectedCompany.emails as string[]) || [])[0] && (
                    <span>✉️ {((selectedCompany.emails as string[]) || [])[0]}</span>
                  )}
                </div>
                <p className="text-[11px] text-emerald-600 font-medium pt-0.5">
                  ✓ Variáveis <span className="font-mono">{"{{empresa.*}}"}</span> serão preenchidas automaticamente
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Ao selecionar uma empresa, todas as variáveis <span className="font-mono bg-muted px-1 rounded">{"{{empresa.*}}"}</span> serão substituídas pelos dados reais na proposta gerada.
              </p>
            )}
          </div>

          {/* Ativo */}
          {(template.type === "ASSET_OWNER" || template.type === "INVESTOR") && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-muted-foreground" /> Ativo relacionado
                <span className="ml-auto text-xs text-muted-foreground font-normal">(opcional)</span>
              </Label>
              <Select value={assetId} onValueChange={setAssetId}>
                <SelectTrigger><SelectValue placeholder="Selecionar ativo..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {(assets as any[]).map((a: any) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.title}
                      {a.estado ? ` — ${a.estado}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedAsset && (
                <p className="text-[11px] text-emerald-600 font-medium">
                  ✓ Variáveis <span className="font-mono">{"{{ativo.*}}"}</span> serão preenchidas com dados de "{selectedAsset.title}"
                </p>
              )}
            </div>
          )}

          {/* Investidor */}
          {template.type === "INVESTOR" && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Variable className="w-3.5 h-3.5 text-muted-foreground" /> Investidor
                <span className="ml-auto text-xs text-muted-foreground font-normal">(opcional)</span>
              </Label>
              <Select value={investorId} onValueChange={setInvestorId}>
                <SelectTrigger><SelectValue placeholder="Selecionar investidor..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {(investors as any[]).map((inv: any) => (
                    <SelectItem key={inv.id} value={String(inv.id)}>{inv.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Nome da proposta */}
          <div className="space-y-2">
            <Label>Nome da proposta gerada</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Proposta Comercial — Empresa XYZ" />
          </div>

          <Button className="w-full gap-2" onClick={generate} data-testid="button-generate-proposal">
            <FileText className="w-4 h-4" /> Gerar Proposta
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Send Email Dialog ─────────────────────────────────────────────────────────
function SendEmailDialog({ proposal, onClose }: { proposal: any; onClose: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [subject, setSubject] = useState(`Proposta: ${proposal.name}`);
  const [customMessage, setCustomMessage] = useState("");
  const [isSending, setIsSending] = useState(false);

  const userEmail = (user as any)?.email || "";
  const userSignature = (user as any)?.emailSignature || "";
  const hasSignature = !!userSignature;

  const send = async () => {
    if (!recipientEmail.trim()) {
      toast({ title: "Email do destinatário é obrigatório", variant: "destructive" });
      return;
    }
    setIsSending(true);
    try {
      const res = await apiRequest("POST", `/api/proposals/${proposal.id}/send-email`, {
        recipientEmail: recipientEmail.trim(),
        recipientName: recipientName.trim() || undefined,
        subject: subject.trim(),
        customMessage: customMessage.trim() || undefined,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      toast({ title: "Email enviado!", description: `Proposta enviada para ${recipientEmail}` });
      queryClient.invalidateQueries({ queryKey: ["/api/proposals"] });
      onClose();
    } catch (e: any) {
      toast({ title: "Erro ao enviar", description: e.message, variant: "destructive" });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" />
            <h2 className="font-semibold">Enviar Proposta por Email</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted transition-colors" data-testid="button-close-email-dialog">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="rounded-lg bg-muted/40 p-3 space-y-0.5">
            <p className="text-xs text-muted-foreground">Proposta</p>
            <p className="text-sm font-medium">{proposal.name}</p>
          </div>

          <div className="space-y-1.5">
            <Label>Email do destinatário *</Label>
            <Input
              type="email"
              value={recipientEmail}
              onChange={e => setRecipientEmail(e.target.value)}
              placeholder="contato@empresa.com.br"
              data-testid="input-recipient-email"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Nome do destinatário <span className="text-muted-foreground font-normal">(opcional)</span></Label>
            <Input
              value={recipientName}
              onChange={e => setRecipientName(e.target.value)}
              placeholder="João Silva"
              data-testid="input-recipient-name"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Assunto</Label>
            <Input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              data-testid="input-email-subject"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Mensagem de abertura <span className="text-muted-foreground font-normal">(opcional)</span></Label>
            <Textarea
              value={customMessage}
              onChange={e => setCustomMessage(e.target.value)}
              placeholder="Prezado(a) {{nome}}, segue em anexo a proposta..."
              rows={3}
              data-testid="textarea-custom-message"
            />
          </div>

          {/* Reply-to and signature info */}
          <div className="rounded-lg border p-3 space-y-2 text-xs bg-muted/20">
            <div className="flex items-center gap-1.5 text-muted-foreground font-medium">
              <Send className="w-3.5 h-3.5" />
              Configurações de envio
            </div>
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground w-20 shrink-0">Reply-To:</span>
              {userEmail ? (
                <span className="text-emerald-600 font-medium">{userEmail}</span>
              ) : (
                <span className="text-amber-600">
                  Não configurado —{" "}
                  <a href="/users" className="underline">configure em Usuários</a>
                </span>
              )}
            </div>
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground w-20 shrink-0">Assinatura:</span>
              {hasSignature ? (
                <span className="text-emerald-600 font-medium">Configurada ✓</span>
              ) : (
                <span className="text-amber-600">
                  Não configurada —{" "}
                  <a href="/users" className="underline">configure em Usuários</a>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={send}
            disabled={isSending || !recipientEmail.trim()}
            className="gap-2"
            data-testid="button-send-email"
          >
            {isSending ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {isSending ? "Enviando..." : "Enviar Email"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── PDF Generator ─────────────────────────────────────────────────────────────
const PDF_STYLES = `
  * { box-sizing: border-box; }
  .pdf-page { width: 794px; min-height: 1123px; background: #fff; padding: 72px 64px 80px; font-family: 'Georgia', 'Times New Roman', serif; color: #1a1a1a; line-height: 1.8; font-size: 13.5px; position: relative; }
  .pdf-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 36px; padding-bottom: 18px; border-bottom: 2.5px solid #1a365d; }
  .pdf-header-logo img { height: 44px; object-fit: contain; }
  .pdf-header-info { text-align: right; color: #4a5568; font-size: 11px; line-height: 1.6; }
  .pdf-header-info .doc-type { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #1a365d; font-weight: 600; margin-bottom: 2px; }
  .pdf-title-block { text-align: center; margin: 32px 0 40px; padding: 24px 0; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; }
  .pdf-title-block h1 { font-size: 24px; font-weight: 700; color: #1a365d; margin: 0 0 6px; letter-spacing: -0.3px; }
  .pdf-title-block .subtitle { font-size: 12px; color: #718096; font-style: italic; }
  .pdf-body h1 { font-size: 22px; font-weight: 700; margin: 32px 0 14px; color: #1a365d; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 8px; }
  .pdf-body h2 { font-size: 18px; font-weight: 700; margin: 28px 0 12px; color: #2d3748; }
  .pdf-body h3 { font-size: 15px; font-weight: 700; margin: 22px 0 10px; color: #4a5568; }
  .pdf-body p { margin: 0 0 14px; text-align: justify; orphans: 3; widows: 3; }
  .pdf-body ul, .pdf-body ol { margin: 8px 0 16px; padding-left: 28px; }
  .pdf-body li { margin-bottom: 6px; line-height: 1.7; }
  .pdf-body li::marker { color: #1a365d; }
  .pdf-body strong { font-weight: 700; color: #1a202c; }
  .pdf-body em { font-style: italic; }
  .pdf-body u { text-decoration: underline; text-underline-offset: 2px; }
  .pdf-body s { text-decoration: line-through; color: #a0aec0; }
  .pdf-body mark { background: #fefcbf; padding: 1px 4px; border-radius: 2px; }
  .pdf-body blockquote { border-left: 3px solid #1a365d; padding: 12px 20px; margin: 18px 0; background: #f7fafc; color: #4a5568; font-style: italic; border-radius: 0 4px 4px 0; }
  .pdf-body hr { border: none; border-top: 1px solid #e2e8f0; margin: 28px 0; }
  .pdf-body table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
  .pdf-body table th { background: #edf2f7; padding: 10px 12px; text-align: left; font-weight: 700; border: 1px solid #e2e8f0; color: #2d3748; }
  .pdf-body table td { padding: 8px 12px; border: 1px solid #e2e8f0; }
  .pdf-body table tr:nth-child(even) td { background: #f7fafc; }
  .pdf-body [style*="text-align: center"] { text-align: center; }
  .pdf-body [style*="text-align: right"] { text-align: right; }
  .pdf-body [style*="text-align: justify"] { text-align: justify; }
`;

async function generatePdf(proposal: any, logoUrl?: string, returnBase64?: boolean): Promise<string | null> {
  const { default: jsPDF } = await import("jspdf");
  const { default: html2canvas } = await import("html2canvas");

  const dateStr = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

  const container = document.createElement("div");
  container.style.cssText = "position:fixed;top:-9999px;left:-9999px;";

  const style = document.createElement("style");
  style.textContent = PDF_STYLES;
  container.appendChild(style);

  const page = document.createElement("div");
  page.className = "pdf-page";
  page.innerHTML = `
    <div class="pdf-header">
      <div class="pdf-header-logo">
        ${logoUrl ? `<img src="${logoUrl}" crossorigin="anonymous" />` : `<div style="font-size:16px;font-weight:700;color:#1a365d;letter-spacing:-0.5px;">PROPOSTA COMERCIAL</div>`}
      </div>
      <div class="pdf-header-info">
        <div class="doc-type">Proposta Confidencial</div>
        <div>${dateStr}</div>
        <div>Ref: ${proposal.name || "—"}</div>
      </div>
    </div>
    <div class="pdf-title-block">
      <h1>${proposal.name || "Proposta Comercial"}</h1>
      <div class="subtitle">${dateStr}</div>
    </div>
    <div class="pdf-body">
      ${proposal.filledHtml || "<p>Proposta sem conteúdo.</p>"}
    </div>
  `;
  container.appendChild(page);
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(page, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();
    const marginX = 0;
    const pageHeightPx = (pdfH / pdfW) * canvas.width;
    let yPos = 0;
    let pageNum = 0;

    while (yPos < canvas.height) {
      const sliceH = Math.min(pageHeightPx, canvas.height - yPos);
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = sliceH;
      const ctx = sliceCanvas.getContext("2d")!;
      ctx.drawImage(canvas, 0, yPos, sliceCanvas.width, sliceH, 0, 0, sliceCanvas.width, sliceH);
      if (pageNum > 0) pdf.addPage();
      const sliceHeightMm = (sliceH / sliceCanvas.width) * pdfW;
      pdf.addImage(sliceCanvas.toDataURL("image/png"), "PNG", marginX, 0, pdfW, sliceHeightMm);

      pdf.setFontSize(7.5);
      pdf.setTextColor(160, 160, 160);
      pdf.setDrawColor(220, 220, 220);
      pdf.line(15, pdfH - 12, pdfW - 15, pdfH - 12);
      pdf.text("Confidencial", 15, pdfH - 7);
      pdf.text(`Página ${pageNum + 1}`, pdfW / 2, pdfH - 7, { align: "center" });
      pdf.text(proposal.name || "Proposta", pdfW - 15, pdfH - 7, { align: "right" });

      yPos += pageHeightPx;
      pageNum++;
    }

    if (returnBase64) {
      const base64 = pdf.output("datauristring").split(",")[1];
      return base64;
    }
    pdf.save(`${proposal.name || "proposta"}.pdf`);
    return null;
  } finally {
    document.body.removeChild(container);
  }
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PropostasPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("templates");
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [previewProposal, setPreviewProposal] = useState<any>(null);
  const [sendingEmailProposal, setSendingEmailProposal] = useState<any>(null);
  const [generatedTab, setGeneratedTab] = useState("generated");
  const [confirmDeleteTemplateId, setConfirmDeleteTemplateId] = useState<number | null>(null);
  const [confirmDeleteProposalId, setConfirmDeleteProposalId] = useState<number | null>(null);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateType, setTemplateType] = useState("all");
  const [proposalSearch, setProposalSearch] = useState("");
  const [proposalType, setProposalType] = useState("all");
  const [proposalStatus, setProposalStatus] = useState("all");

  const { data: templates = [], isLoading: loadingTemplates } = useQuery({
    queryKey: ["/api/proposals/templates"],
    queryFn: () => apiRequest("GET", "/api/proposals/templates").then(r => r.json()),
  });

  const { data: proposals = [], isLoading: loadingProposals } = useQuery({
    queryKey: ["/api/proposals"],
    queryFn: () => apiRequest("GET", "/api/proposals").then(r => r.json()),
  });

  const { data: orgSettings } = useQuery({
    queryKey: ["/api/org/settings"],
    queryFn: () => apiRequest("GET", "/api/org/settings").then(r => r.json()),
  });

  const deleteTemplate = async (id: number) => {
    await apiRequest("DELETE", `/api/proposals/templates/${id}`);
    setConfirmDeleteTemplateId(null);
    queryClient.invalidateQueries({ queryKey: ["/api/proposals/templates"] });
    toast({ title: "Template excluído" });
  };

  const deleteProposal = async (id: number) => {
    await apiRequest("DELETE", `/api/proposals/${id}`);
    setConfirmDeleteProposalId(null);
    queryClient.invalidateQueries({ queryKey: ["/api/proposals"] });
    toast({ title: "Proposta excluída" });
  };

  const downloadPdf = async (proposal: any) => {
    toast({ title: "Gerando PDF...", description: "Aguarde um momento." });
    try {
      await generatePdf(proposal, (orgSettings as any)?.logo_url);
      toast({ title: "PDF baixado!" });
    } catch (e) {
      toast({ title: "Erro ao gerar PDF", variant: "destructive" });
    }
  };

  const [savingToDrive, setSavingToDrive] = useState<number | null>(null);
  const saveToDrive = async (proposal: any) => {
    setSavingToDrive(proposal.id);
    toast({ title: "Enviando para Google Drive...", description: "Gerando PDF e fazendo upload." });
    try {
      const base64 = await generatePdf(proposal, (orgSettings as any)?.logo_url, true);
      if (!base64) throw new Error("Falha ao gerar PDF");
      const result = await apiRequest("POST", "/api/drive/upload-pdf", {
        type: "proposal", id: proposal.id, name: proposal.name, pdfBase64: base64,
      });
      const data = await result.json();
      queryClient.invalidateQueries({ queryKey: ["/api/proposals"] });
      toast({ title: "Salvo no Google Drive!", description: "Arquivo disponível na pasta Mavrion Conect / Propostas." });
    } catch (e) {
      toast({ title: "Erro ao salvar no Drive", description: String(e), variant: "destructive" });
    } finally {
      setSavingToDrive(null);
    }
  };

  return (
    <>
      {editorOpen && (
        <TemplateEditorModal
          template={editingTemplate}
          onClose={() => { setEditorOpen(false); setEditingTemplate(null); }}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["/api/proposals/templates"] })}
        />
      )}

      {sendingEmailProposal && (
        <SendEmailDialog
          proposal={sendingEmailProposal}
          onClose={() => setSendingEmailProposal(null)}
        />
      )}

      {/* Preview modal */}
      {previewProposal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 md:p-8">
          <div className="bg-muted/40 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b bg-background">
              <div>
                <h2 className="font-semibold text-sm">{previewProposal.name}</h2>
                <p className="text-xs text-muted-foreground">Pré-visualização da proposta</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => downloadPdf(previewProposal)} data-testid="button-preview-download-pdf">
                  <Download className="w-4 h-4 mr-1.5" /> Baixar PDF
                </Button>
                {previewProposal.driveFileUrl ? (
                  <Button size="sm" variant="outline" onClick={() => window.open(previewProposal.driveFileUrl, "_blank")} data-testid="button-preview-open-drive">
                    <ExternalLink className="w-4 h-4 mr-1.5" /> Abrir no Drive
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => saveToDrive(previewProposal)} disabled={savingToDrive === previewProposal.id} data-testid="button-preview-save-drive">
                    <CloudUpload className="w-4 h-4 mr-1.5" /> {savingToDrive === previewProposal.id ? "Enviando..." : "Salvar no Drive"}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setPreviewProposal(null)}>Fechar</Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 md:p-10 flex justify-center">
              <div
                className="bg-white shadow-lg border rounded-sm w-full max-w-[680px] p-12 md:p-16"
                style={{ fontFamily: "'Georgia', 'Times New Roman', serif", color: "#1a1a1a", lineHeight: 1.8, fontSize: "13.5px" }}
              >
                <div className="text-center mb-8 pb-6 border-b-2" style={{ borderColor: "#1a365d" }}>
                  <h1 className="text-xl font-bold mb-1" style={{ color: "#1a365d" }}>{previewProposal.name}</h1>
                  <p className="text-xs italic" style={{ color: "#718096" }}>
                    {new Date(previewProposal.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
                  </p>
                </div>
                <div
                  className="prose prose-sm max-w-none [&_h1]:text-lg [&_h1]:font-bold [&_h1]:border-b [&_h1]:pb-2 [&_h1]:mb-4 [&_h2]:text-base [&_h2]:font-bold [&_h3]:text-sm [&_h3]:font-bold [&_p]:text-justify [&_p]:mb-3 [&_blockquote]:border-l-[3px] [&_blockquote]:border-blue-900 [&_blockquote]:bg-slate-50 [&_blockquote]:italic [&_blockquote]:pl-4 [&_blockquote]:py-2 [&_li]:mb-1"
                  style={{ color: "#1a1a1a" }}
                  dangerouslySetInnerHTML={{ __html: previewProposal.filledHtml || "<p>Sem conteúdo.</p>" }}
                />
                <div className="mt-10 pt-4 border-t text-center" style={{ color: "#a0aec0", fontSize: "10px" }}>
                  Documento gerado automaticamente — Confidencial
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Propostas</h1>
          <p className="text-sm text-muted-foreground">Crie templates personalizados e gere propostas automaticamente</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="templates">
              <FileText className="w-4 h-4 mr-1.5" /> Templates ({(templates as any[]).length})
            </TabsTrigger>
            <TabsTrigger value="generated">
              <Eye className="w-4 h-4 mr-1.5" /> Propostas Geradas ({(proposals as any[]).length})
            </TabsTrigger>
          </TabsList>

          {/* Templates tab */}
          <TabsContent value="templates" className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="flex gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Buscar template..."
                    value={templateSearch}
                    onChange={e => setTemplateSearch(e.target.value)}
                    className="pl-8 h-8 text-sm w-44"
                    data-testid="input-template-search"
                  />
                </div>
                <Select value={templateType} onValueChange={setTemplateType}>
                  <SelectTrigger className="h-8 text-sm w-40" data-testid="select-template-type">
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os tipos</SelectItem>
                    <SelectItem value="INVESTOR">Para Investidor</SelectItem>
                    <SelectItem value="ASSET_OWNER">Para Cedente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => { setEditingTemplate(null); setEditorOpen(true); }}>
                <Plus className="w-4 h-4 mr-1.5" /> Novo Template
              </Button>
            </div>

            {loadingTemplates ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : (templates as any[]).length === 0 ? (
              <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
                <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-40" />
                <h3 className="font-semibold text-lg mb-2">Nenhum template criado</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Crie seu primeiro template com o editor de texto rico e variáveis dinâmicas.
                </p>
                <Button onClick={() => { setEditingTemplate(null); setEditorOpen(true); }}>
                  <Plus className="w-4 h-4 mr-1.5" /> Criar Primeiro Template
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(templates as any[]).filter((t: any) => {
                  if (templateSearch.trim() && !t.name.toLowerCase().includes(templateSearch.toLowerCase())) return false;
                  if (templateType !== "all" && t.type !== templateType) return false;
                  return true;
                }).map((t: any) => (
                  <Card key={t.id} className="hover:border-primary/30 transition-colors">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-base">{t.name}</CardTitle>
                          <Badge variant="outline" className="mt-1 text-xs">
                            {t.type === "INVESTOR" ? "Para Investidor" : "Para Cedente de Ativo"}
                          </Badge>
                        </div>
                        <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground mb-4">
                        Criado em {format(new Date(t.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm" variant="outline" className="flex-1"
                          onClick={() => { setEditingTemplate(t); setEditorOpen(true); }}
                        >
                          <Edit className="w-3.5 h-3.5 mr-1" /> Editar
                        </Button>
                        <GenerateProposalDialog
                          template={t}
                          onGenerated={() => setActiveTab("generated")}
                        />
                        <Button
                          size="sm" variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setConfirmDeleteTemplateId(t.id)}
                          data-testid={`button-delete-template-${t.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Generated proposals tab */}
          <TabsContent value="generated" className="mt-4">
            <div className="flex flex-wrap gap-2 mb-4">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar proposta..."
                  value={proposalSearch}
                  onChange={e => setProposalSearch(e.target.value)}
                  className="pl-8 h-8 text-sm w-44"
                  data-testid="input-proposal-search"
                />
              </div>
              <Select value={proposalType} onValueChange={setProposalType}>
                <SelectTrigger className="h-8 text-sm w-40" data-testid="select-proposal-type">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os tipos</SelectItem>
                  <SelectItem value="INVESTOR">Investidor</SelectItem>
                  <SelectItem value="ASSET_OWNER">Cedente de Ativo</SelectItem>
                </SelectContent>
              </Select>
              <Select value={proposalStatus} onValueChange={setProposalStatus}>
                <SelectTrigger className="h-8 text-sm w-36" data-testid="select-proposal-status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="draft">Rascunho</SelectItem>
                  <SelectItem value="sent">Enviado</SelectItem>
                </SelectContent>
              </Select>
              {(proposalSearch || proposalType !== "all" || proposalStatus !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setProposalSearch(""); setProposalType("all"); setProposalStatus("all"); }}
                  className="h-8 px-2 text-xs text-muted-foreground"
                  data-testid="button-clear-proposal-filters"
                >
                  <XIcon className="w-3.5 h-3.5 mr-1" /> Limpar
                </Button>
              )}
            </div>
            {loadingProposals ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : (proposals as any[]).length === 0 ? (
              <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
                <Eye className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-40" />
                <h3 className="font-semibold text-lg mb-2">Nenhuma proposta gerada</h3>
                <p className="text-sm text-muted-foreground">
                  Vá até a aba Templates e clique em "Gerar Proposta" para criar sua primeira proposta.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {(proposals as any[]).filter((p: any) => {
                  if (proposalSearch.trim() && !p.name.toLowerCase().includes(proposalSearch.toLowerCase())) return false;
                  if (proposalType !== "all" && p.type !== proposalType) return false;
                  if (proposalStatus !== "all" && (p.status || "draft") !== proposalStatus) return false;
                  return true;
                }).map((p: any) => (
                  <Card key={p.id}>
                    <CardContent className="p-4 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <FileText className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{p.name}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <Badge variant="outline" className="text-xs">
                              {p.type === "INVESTOR" ? "Investidor" : "Cedente de Ativo"}
                            </Badge>
                            {p.status === "sent" && (
                              <Badge className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200">
                                ✓ Enviado
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(p.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                        <Button size="sm" variant="outline" onClick={() => setPreviewProposal(p)}>
                          <Eye className="w-4 h-4 mr-1.5" /> Visualizar
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => downloadPdf(p)}>
                          <Download className="w-4 h-4 mr-1.5" /> PDF
                        </Button>
                        {p.driveFileUrl ? (
                          <Button size="sm" variant="outline" onClick={() => window.open(p.driveFileUrl, "_blank")} data-testid={`button-open-drive-${p.id}`}>
                            <ExternalLink className="w-4 h-4 mr-1.5" /> Drive
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => saveToDrive(p)} disabled={savingToDrive === p.id} data-testid={`button-save-drive-${p.id}`}>
                            <CloudUpload className="w-4 h-4 mr-1.5" /> {savingToDrive === p.id ? "Enviando..." : "Drive"}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => setSendingEmailProposal(p)}
                          className="gap-1.5"
                          data-testid={`button-send-email-${p.id}`}
                        >
                          <Mail className="w-4 h-4" /> Enviar
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setConfirmDeleteProposalId(p.id)}
                          data-testid={`button-delete-proposal-${p.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog open={confirmDeleteTemplateId !== null} onOpenChange={o => !o && setConfirmDeleteTemplateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir template?</AlertDialogTitle>
            <AlertDialogDescription>
              O template será removido permanentemente. As propostas já geradas não serão afetadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDeleteTemplateId && deleteTemplate(confirmDeleteTemplateId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeleteProposalId !== null} onOpenChange={o => !o && setConfirmDeleteProposalId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir proposta?</AlertDialogTitle>
            <AlertDialogDescription>
              A proposta gerada será removida permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDeleteProposalId && deleteProposal(confirmDeleteProposalId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
