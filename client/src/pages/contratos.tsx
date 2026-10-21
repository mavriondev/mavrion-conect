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
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  Plus, Trash2, Download, Eye, FileText, FileSignature,
  Variable, Copy, Check, X as XIcon, Braces, Building2, Layers, Search, CloudUpload, ExternalLink,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const TYPE_LABELS: Record<string, string> = {
  COMPRA_VENDA: "Compra e Venda",
  CESSAO_DIREITOS: "Cessão de Direitos",
  NDA: "Acordo de Confidencialidade",
  PARCERIA: "Acordo de Parceria",
  CUSTOM: "Personalizado",
};

const CONTRACT_VARIABLE_GROUPS = [
  {
    label: "Empresa",
    color: "blue",
    vars: [
      { key: "{{empresa.nome}}", desc: "Nome comercial" },
      { key: "{{empresa.razao_social}}", desc: "Razão social" },
      { key: "{{empresa.cnpj}}", desc: "CNPJ formatado" },
      { key: "{{empresa.endereco}}", desc: "Endereço completo" },
      { key: "{{empresa.cep}}", desc: "CEP" },
      { key: "{{empresa.contato_nome}}", desc: "Nome do contato" },
      { key: "{{empresa.contato_cargo}}", desc: "Cargo do contato" },
      { key: "{{empresa.contato_email}}", desc: "Email do contato" },
      { key: "{{empresa.contato_telefone}}", desc: "Telefone do contato" },
    ]
  },
  {
    label: "Ativo",
    color: "green",
    vars: [
      { key: "{{ativo.titulo}}", desc: "Título do ativo" },
      { key: "{{ativo.tipo}}", desc: "Tipo (TERRA, MINA...)" },
      { key: "{{ativo.localizacao}}", desc: "Localização" },
      { key: "{{ativo.area_ha}}", desc: "Área em hectares" },
      { key: "{{ativo.area_util}}", desc: "Área útil" },
      { key: "{{ativo.preco}}", desc: "Preço pedido" },
      { key: "{{ativo.matricula}}", desc: "Matrícula" },
      { key: "{{ativo.municipio}}", desc: "Município" },
      { key: "{{ativo.estado}}", desc: "Estado (UF)" },
      { key: "{{ativo.docs_status}}", desc: "Status dos documentos" },
    ]
  },
  {
    label: "Investidor",
    color: "purple",
    vars: [
      { key: "{{investidor.nome}}", desc: "Nome do fundo/investidor" },
      { key: "{{investidor.ticket_min}}", desc: "Ticket mínimo" },
      { key: "{{investidor.ticket_max}}", desc: "Ticket máximo" },
    ]
  },
  {
    label: "Minha Empresa",
    color: "amber",
    vars: [
      { key: "{{minha_empresa.nome}}", desc: "Nome da sua empresa" },
      { key: "{{minha_empresa.cnpj}}", desc: "CNPJ da sua empresa" },
      { key: "{{minha_empresa.endereco}}", desc: "Endereço da sua empresa" },
    ]
  },
  {
    label: "Data",
    color: "slate",
    vars: [
      { key: "{{data.hoje}}", desc: "Data de hoje por extenso" },
      { key: "{{data.mes_ano}}", desc: "Mês e ano atual" },
      { key: "{{data.extenso}}", desc: "Data por extenso completa" },
    ]
  },
  {
    label: "Contrato",
    color: "rose",
    vars: [
      { key: "{{contrato.foro}}", desc: "Foro de eleição" },
      { key: "{{contrato.prazo}}", desc: "Prazo do contrato" },
      { key: "{{contrato.valor}}", desc: "Valor do contrato" },
      { key: "{{contrato.garantia}}", desc: "Garantia contratual" },
      { key: "{{contrato.clausula_especial}}", desc: "Cláusula especial" },
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
      <ToolbarButton active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Título 1"><Heading1 className="w-3.5 h-3.5" /></ToolbarButton>
      <ToolbarButton active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Título 2"><Heading2 className="w-3.5 h-3.5" /></ToolbarButton>
      <ToolbarButton active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Título 3"><Heading3 className="w-3.5 h-3.5" /></ToolbarButton>
      <div className="w-px h-6 bg-border mx-1" />
      <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Negrito"><Bold className="w-3.5 h-3.5" /></ToolbarButton>
      <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Itálico"><Italic className="w-3.5 h-3.5" /></ToolbarButton>
      <ToolbarButton active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Sublinhado"><UnderlineIcon className="w-3.5 h-3.5" /></ToolbarButton>
      <ToolbarButton active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Tachado"><Strikethrough className="w-3.5 h-3.5" /></ToolbarButton>
      <div className="w-px h-6 bg-border mx-1" />
      <ToolbarButton active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Alinhar à esquerda"><AlignLeft className="w-3.5 h-3.5" /></ToolbarButton>
      <ToolbarButton active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Centralizar"><AlignCenter className="w-3.5 h-3.5" /></ToolbarButton>
      <ToolbarButton active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="Alinhar à direita"><AlignRight className="w-3.5 h-3.5" /></ToolbarButton>
      <ToolbarButton active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()} title="Justificar"><AlignJustify className="w-3.5 h-3.5" /></ToolbarButton>
      <div className="w-px h-6 bg-border mx-1" />
      <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Lista"><List className="w-3.5 h-3.5" /></ToolbarButton>
      <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Lista numerada"><ListOrdered className="w-3.5 h-3.5" /></ToolbarButton>
      <div className="w-px h-6 bg-border mx-1" />
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

function ContractVariablePopup({ onInsert, onClose }: { onInsert: (variable: string) => void; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);

  const copyAndInsert = (variable: string) => {
    onInsert(variable);
    setCopied(variable);
    setTimeout(() => setCopied(null), 1500);
  };

  const GROUP_COLORS: Record<string, string> = {
    "Empresa":       "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    "Ativo":         "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    "Investidor":    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
    "Minha Empresa": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    "Data":          "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300",
    "Contrato":      "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  };

  return (
    <div
      className="fixed bottom-6 right-6 z-[200] w-72 max-h-[70vh] flex flex-col bg-background border border-border rounded-xl shadow-2xl overflow-hidden"
      style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.22)" }}
      data-testid="contract-variable-popup"
    >
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
          data-testid="button-close-contract-variable-popup"
        >
          <XIcon className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground px-4 py-2 border-b shrink-0">
        Clique numa variável para inserir no editor
      </p>
      <div className="overflow-y-auto p-3 space-y-4">
        {CONTRACT_VARIABLE_GROUPS.map(group => (
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
                  data-testid={`button-insert-var-${v.key}`}
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

function ContractTemplateEditorModal({
  template, onClose, onSaved
}: { template?: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(template?.name || "");
  const [type, setType] = useState(template?.type || "COMPRA_VENDA");
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
      Placeholder.configure({ placeholder: "Escreva o conteúdo do contrato aqui. Use as variáveis ao lado para inserir dados dinâmicos..." }),
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
        await apiRequest("PUT", `/api/contract-templates/${template.id}`, { name, type, bodyHtml, bodyJson });
      } else {
        await apiRequest("POST", "/api/contract-templates", { name, type, bodyHtml, bodyJson });
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
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-3">
          <FileSignature className="w-5 h-5 text-primary" />
          <div>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Nome do template..."
              className="h-7 text-base font-semibold border-0 shadow-none px-0 focus-visible:ring-0"
              data-testid="input-contract-template-name"
            />
          </div>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-7 text-xs w-48" data-testid="select-contract-template-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm"
            onClick={() => setShowVars(v => !v)}
            className={cn("gap-1.5", showVars && "border-primary text-primary bg-primary/5")}
            data-testid="button-toggle-contract-expressoes"
          >
            <Braces className="w-4 h-4" /> Expressões
          </Button>
          <Button variant="outline" size="sm" onClick={onClose} data-testid="button-cancel-contract-template">Cancelar</Button>
          <Button size="sm" onClick={save} data-testid="button-save-contract-template-header">Salvar Template</Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <EditorToolbar editor={editor} />
          <div className="flex-1 overflow-y-auto">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t bg-background/95 backdrop-blur-sm px-4 py-3 flex items-center justify-between gap-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
        <p className="text-xs text-muted-foreground hidden sm:block">
          Use <span className="font-mono bg-muted px-1 rounded text-primary">{"{{variavel}}"}</span> para inserir dados dinâmicos — clique em <strong>Expressões</strong> para ver a lista completa
        </p>
        <div className="flex items-center gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={save} className="gap-1.5 min-w-[140px]" data-testid="button-save-contract-template">
            <Check className="w-4 h-4" />
            {template?.id ? "Salvar Alterações" : "Criar Template"}
          </Button>
        </div>
      </div>

      {showVars && (
        <ContractVariablePopup
          onInsert={insertVariable}
          onClose={() => setShowVars(false)}
        />
      )}
    </div>
  );
}

function GenerateContractDialog({ template, onGenerated }: { template: any; onGenerated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`${template.name} — ${new Date().toLocaleDateString("pt-BR")}`);
  const [companyId, setCompanyId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [investorId, setInvestorId] = useState("");
  const [foro, setForo] = useState("");
  const [prazo, setPrazo] = useState("");
  const [valor, setValor] = useState("");
  const [garantia, setGarantia] = useState("");
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
      await apiRequest("POST", "/api/contracts", {
        templateId: template.id,
        name,
        type: template.type,
        companyId: companyId !== "none" && companyId ? parseInt(companyId) : undefined,
        assetId: assetId !== "none" && assetId ? parseInt(assetId) : undefined,
        investorProfileId: investorId !== "none" && investorId ? parseInt(investorId) : undefined,
        foro, prazo, valor, garantia,
      });
      toast({ title: "Contrato gerado!", description: `"${name}" está pronto para visualização.` });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      setOpen(false);
      onGenerated();
    } catch {
      toast({ title: "Erro ao gerar contrato", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-generate-contract-${template.id}`}>
          <Plus className="w-4 h-4 mr-1.5" /> Gerar Contrato
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gerar Contrato — {template.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" />
              <Label className="text-sm font-semibold text-primary">Empresa / Parte contratante</Label>
              <span className="ml-auto text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">Recomendado</span>
            </div>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger data-testid="select-contract-company">
                <SelectValue placeholder="Selecionar empresa..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhuma (contrato genérico)</SelectItem>
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
                    <span>{[selectedCompany.address?.city, selectedCompany.address?.state].filter(Boolean).join(", ")}</span>
                  )}
                  {selectedCompany.cnpj && <span>CNPJ: {selectedCompany.cnpj}</span>}
                </div>
                <p className="text-[11px] text-emerald-600 font-medium pt-0.5">
                  Variáveis <span className="font-mono">{"{{empresa.*}}"}</span> serão preenchidas automaticamente
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Ao selecionar uma empresa, todas as variáveis <span className="font-mono bg-muted px-1 rounded">{"{{empresa.*}}"}</span> serão substituídas pelos dados reais.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-muted-foreground" /> Ativo relacionado
              <span className="ml-auto text-xs text-muted-foreground font-normal">(opcional)</span>
            </Label>
            <Select value={assetId} onValueChange={setAssetId}>
              <SelectTrigger data-testid="select-contract-asset">
                <SelectValue placeholder="Selecionar ativo..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum</SelectItem>
                {(assets as any[]).map((a: any) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.title}{a.estado ? ` — ${a.estado}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedAsset && (
              <p className="text-[11px] text-emerald-600 font-medium">
                Variáveis <span className="font-mono">{"{{ativo.*}}"}</span> serão preenchidas com dados de "{selectedAsset.title}"
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Variable className="w-3.5 h-3.5 text-muted-foreground" /> Investidor
              <span className="ml-auto text-xs text-muted-foreground font-normal">(opcional)</span>
            </Label>
            <Select value={investorId} onValueChange={setInvestorId}>
              <SelectTrigger data-testid="select-contract-investor">
                <SelectValue placeholder="Selecionar investidor..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum</SelectItem>
                {(investors as any[]).map((inv: any) => (
                  <SelectItem key={inv.id} value={String(inv.id)}>{inv.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
            <div className="flex items-center gap-2 mb-1">
              <FileSignature className="w-4 h-4 text-muted-foreground" />
              <Label className="text-sm font-semibold">Campos do Contrato</Label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Foro</Label>
                <Input value={foro} onChange={e => setForo(e.target.value)} placeholder="Ex: Comarca de São Paulo/SP" data-testid="input-contract-foro" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Prazo</Label>
                <Input value={prazo} onChange={e => setPrazo(e.target.value)} placeholder="Ex: 12 meses" data-testid="input-contract-prazo" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Valor</Label>
                <Input value={valor} onChange={e => setValor(e.target.value)} placeholder="Ex: R$ 1.000.000,00" data-testid="input-contract-valor" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Garantia</Label>
                <Input value={garantia} onChange={e => setGarantia(e.target.value)} placeholder="Ex: Caução de 10%" data-testid="input-contract-garantia" />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Nome do contrato gerado</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Contrato de Compra e Venda — Empresa XYZ" data-testid="input-contract-name" />
          </div>

          <Button className="w-full gap-2" onClick={generate} data-testid="button-generate-contract">
            <FileSignature className="w-4 h-4" /> Gerar Contrato
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const CONTRACT_PDF_STYLES = `
  * { box-sizing: border-box; }
  .pdf-page { width: 794px; min-height: 1123px; background: #fff; padding: 72px 64px 80px; font-family: 'Georgia', 'Times New Roman', serif; color: #1a1a1a; line-height: 1.8; font-size: 13.5px; position: relative; }
  .pdf-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 36px; padding-bottom: 18px; border-bottom: 2.5px solid #1a365d; }
  .pdf-header-logo img { height: 44px; object-fit: contain; }
  .pdf-header-info { text-align: right; color: #4a5568; font-size: 11px; line-height: 1.6; }
  .pdf-header-info .doc-type { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #1a365d; font-weight: 600; margin-bottom: 2px; }
  .pdf-title-block { text-align: center; margin: 32px 0 40px; padding: 28px 0; border-top: 2px solid #1a365d; border-bottom: 2px solid #1a365d; }
  .pdf-title-block h1 { font-size: 22px; font-weight: 700; color: #1a365d; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 1px; }
  .pdf-title-block .contract-type { font-size: 13px; color: #2d3748; font-weight: 600; margin: 4px 0; }
  .pdf-title-block .subtitle { font-size: 11px; color: #718096; font-style: italic; }
  .pdf-body h1 { font-size: 16px; font-weight: 700; margin: 28px 0 12px; color: #1a365d; text-transform: uppercase; letter-spacing: 0.5px; }
  .pdf-body h2 { font-size: 15px; font-weight: 700; margin: 24px 0 10px; color: #2d3748; }
  .pdf-body h3 { font-size: 14px; font-weight: 700; margin: 20px 0 8px; color: #4a5568; }
  .pdf-body p { margin: 0 0 12px; text-align: justify; orphans: 3; widows: 3; }
  .pdf-body ul, .pdf-body ol { margin: 8px 0 14px; padding-left: 28px; }
  .pdf-body li { margin-bottom: 5px; line-height: 1.7; }
  .pdf-body li::marker { color: #1a365d; }
  .pdf-body strong { font-weight: 700; color: #1a202c; }
  .pdf-body em { font-style: italic; }
  .pdf-body u { text-decoration: underline; text-underline-offset: 2px; }
  .pdf-body s { text-decoration: line-through; color: #a0aec0; }
  .pdf-body mark { background: #fefcbf; padding: 1px 4px; border-radius: 2px; }
  .pdf-body blockquote { border-left: 3px solid #1a365d; padding: 12px 20px; margin: 18px 0; background: #f7fafc; color: #4a5568; font-style: italic; border-radius: 0 4px 4px 0; }
  .pdf-body hr { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
  .pdf-body table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
  .pdf-body table th { background: #edf2f7; padding: 10px 12px; text-align: left; font-weight: 700; border: 1px solid #e2e8f0; color: #2d3748; }
  .pdf-body table td { padding: 8px 12px; border: 1px solid #e2e8f0; }
  .pdf-body table tr:nth-child(even) td { background: #f7fafc; }
  .pdf-body [style*="text-align: center"] { text-align: center; }
  .pdf-body [style*="text-align: right"] { text-align: right; }
  .pdf-body [style*="text-align: justify"] { text-align: justify; }
  .pdf-signatures { margin-top: 56px; padding-top: 20px; border-top: 1px solid #e2e8f0; }
  .pdf-signatures h2 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #4a5568; margin-bottom: 40px; text-align: center; }
  .pdf-sig-row { display: flex; justify-content: space-between; gap: 48px; }
  .pdf-sig-block { flex: 1; text-align: center; }
  .pdf-sig-line { border-top: 1px solid #1a1a1a; margin-top: 64px; padding-top: 8px; }
  .pdf-sig-name { font-size: 13px; font-weight: 600; color: #1a1a1a; }
  .pdf-sig-role { font-size: 11px; color: #718096; margin-top: 2px; }
  .pdf-sig-cpf { font-size: 10px; color: #a0aec0; margin-top: 2px; }
`;

async function generateContractPdf(contract: any, logoUrl?: string, returnBase64?: boolean): Promise<string | null> {
  const { default: jsPDF } = await import("jspdf");
  const { default: html2canvas } = await import("html2canvas");

  const dateStr = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const typeLabel = TYPE_LABELS[contract.type] || contract.type || "Contrato";

  const container = document.createElement("div");
  container.style.cssText = "position:fixed;top:-9999px;left:-9999px;";

  const style = document.createElement("style");
  style.textContent = CONTRACT_PDF_STYLES;
  container.appendChild(style);

  const page = document.createElement("div");
  page.className = "pdf-page";
  page.innerHTML = `
    <div class="pdf-header">
      <div class="pdf-header-logo">
        ${logoUrl ? `<img src="${logoUrl}" crossorigin="anonymous" />` : `<div style="font-size:16px;font-weight:700;color:#1a365d;letter-spacing:-0.5px;">CONTRATO</div>`}
      </div>
      <div class="pdf-header-info">
        <div class="doc-type">Instrumento Particular</div>
        <div>${dateStr}</div>
        <div>Ref: ${contract.name || "—"}</div>
      </div>
    </div>
    <div class="pdf-title-block">
      <h1>Contrato</h1>
      <div class="contract-type">${typeLabel}</div>
      <div class="subtitle">${contract.name || ""} — ${dateStr}</div>
    </div>
    <div class="pdf-body">
      ${contract.filledHtml || "<p>Contrato sem conteúdo.</p>"}
    </div>
    <div class="pdf-signatures">
      <h2>Assinaturas</h2>
      <div class="pdf-sig-row">
        <div class="pdf-sig-block">
          <div class="pdf-sig-line">
            <div class="pdf-sig-name">CONTRATANTE</div>
            <div class="pdf-sig-role">Representante Legal</div>
            <div class="pdf-sig-cpf">CPF/CNPJ: ___________________</div>
          </div>
        </div>
        <div class="pdf-sig-block">
          <div class="pdf-sig-line">
            <div class="pdf-sig-name">CONTRATADA</div>
            <div class="pdf-sig-role">Representante Legal</div>
            <div class="pdf-sig-cpf">CPF/CNPJ: ___________________</div>
          </div>
        </div>
      </div>
      <div style="text-align:center;margin-top:48px;">
        <div class="pdf-sig-block" style="display:inline-block;width:280px;">
          <div class="pdf-sig-line">
            <div class="pdf-sig-name">TESTEMUNHA 1</div>
            <div class="pdf-sig-cpf">CPF: ___________________</div>
          </div>
        </div>
        <div style="display:inline-block;width:48px;"></div>
        <div class="pdf-sig-block" style="display:inline-block;width:280px;">
          <div class="pdf-sig-line">
            <div class="pdf-sig-name">TESTEMUNHA 2</div>
            <div class="pdf-sig-cpf">CPF: ___________________</div>
          </div>
        </div>
      </div>
    </div>
  `;
  container.appendChild(page);
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(page, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();
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
      pdf.addImage(sliceCanvas.toDataURL("image/png"), "PNG", 0, 0, pdfW, sliceHeightMm);

      pdf.setFontSize(7.5);
      pdf.setTextColor(160, 160, 160);
      pdf.setDrawColor(220, 220, 220);
      pdf.line(15, pdfH - 12, pdfW - 15, pdfH - 12);
      pdf.text("Confidencial", 15, pdfH - 7);
      pdf.text(`Página ${pageNum + 1}`, pdfW / 2, pdfH - 7, { align: "center" });
      pdf.text(contract.name || "Contrato", pdfW - 15, pdfH - 7, { align: "right" });

      yPos += pageHeightPx;
      pageNum++;
    }

    if (returnBase64) {
      const base64 = pdf.output("datauristring").split(",")[1];
      return base64;
    }
    pdf.save(`${contract.name || "contrato"}.pdf`);
    return null;
  } finally {
    document.body.removeChild(container);
  }
}

export default function ContratosPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("templates");
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [previewContract, setPreviewContract] = useState<any>(null);
  const [confirmDeleteTemplateId, setConfirmDeleteTemplateId] = useState<number | null>(null);
  const [confirmDeleteContractId, setConfirmDeleteContractId] = useState<number | null>(null);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateType, setTemplateType] = useState("all");
  const [contractSearch, setContractSearch] = useState("");
  const [contractType, setContractType] = useState("all");
  const [contractStatus, setContractStatus] = useState("all");

  const { data: templates = [], isLoading: loadingTemplates } = useQuery({
    queryKey: ["/api/contract-templates"],
    queryFn: () => apiRequest("GET", "/api/contract-templates").then(r => r.json()),
  });

  const { data: contracts = [], isLoading: loadingContracts } = useQuery({
    queryKey: ["/api/contracts"],
    queryFn: () => apiRequest("GET", "/api/contracts").then(r => r.json()),
  });

  const { data: orgSettings } = useQuery({
    queryKey: ["/api/org/settings"],
    queryFn: () => apiRequest("GET", "/api/org/settings").then(r => r.json()),
  });

  const deleteTemplate = async (id: number) => {
    await apiRequest("DELETE", `/api/contract-templates/${id}`);
    setConfirmDeleteTemplateId(null);
    queryClient.invalidateQueries({ queryKey: ["/api/contract-templates"] });
    toast({ title: "Template excluído" });
  };

  const deleteContract = async (id: number) => {
    await apiRequest("DELETE", `/api/contracts/${id}`);
    setConfirmDeleteContractId(null);
    queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
    toast({ title: "Contrato excluído" });
  };

  const downloadPdf = async (contract: any) => {
    toast({ title: "Gerando PDF...", description: "Aguarde um momento." });
    try {
      await generateContractPdf(contract, (orgSettings as any)?.logo_url);
      toast({ title: "PDF baixado!" });
    } catch {
      toast({ title: "Erro ao gerar PDF", variant: "destructive" });
    }
  };

  const [savingToDrive, setSavingToDrive] = useState<number | null>(null);
  const saveToDrive = async (contract: any) => {
    setSavingToDrive(contract.id);
    toast({ title: "Enviando para Google Drive...", description: "Gerando PDF e fazendo upload." });
    try {
      const base64 = await generateContractPdf(contract, (orgSettings as any)?.logo_url, true);
      if (!base64) throw new Error("Falha ao gerar PDF");
      await apiRequest("POST", "/api/drive/upload-pdf", {
        type: "contract", id: contract.id, name: contract.name, pdfBase64: base64,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      toast({ title: "Salvo no Google Drive!", description: "Arquivo disponível na pasta Mavrion Connect / Contratos." });
    } catch (e) {
      toast({ title: "Erro ao salvar no Drive", description: String(e), variant: "destructive" });
    } finally {
      setSavingToDrive(null);
    }
  };

  return (
    <>
      {editorOpen && (
        <ContractTemplateEditorModal
          template={editingTemplate}
          onClose={() => { setEditorOpen(false); setEditingTemplate(null); }}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["/api/contract-templates"] })}
        />
      )}

      {previewContract && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 md:p-8">
          <div className="bg-muted/40 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-b bg-background">
              <div>
                <h2 className="font-semibold text-sm" data-testid="text-preview-contract-name">{previewContract.name}</h2>
                <p className="text-xs text-muted-foreground">Pré-visualização do contrato</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => downloadPdf(previewContract)} data-testid="button-preview-download-pdf">
                  <Download className="w-4 h-4 mr-1.5" /> Baixar PDF
                </Button>
                {previewContract.driveFileUrl ? (
                  <Button size="sm" variant="outline" onClick={() => window.open(previewContract.driveFileUrl, "_blank")} data-testid="button-preview-open-drive">
                    <ExternalLink className="w-4 h-4 mr-1.5" /> Abrir no Drive
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => saveToDrive(previewContract)} disabled={savingToDrive === previewContract.id} data-testid="button-preview-save-drive">
                    <CloudUpload className="w-4 h-4 mr-1.5" /> {savingToDrive === previewContract.id ? "Enviando..." : "Salvar no Drive"}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setPreviewContract(null)} data-testid="button-close-preview">Fechar</Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 md:p-10 flex justify-center">
              <div
                className="bg-white shadow-lg border rounded-sm w-full max-w-[680px] p-12 md:p-16"
                style={{ fontFamily: "'Georgia', 'Times New Roman', serif", color: "#1a1a1a", lineHeight: 1.8, fontSize: "13.5px" }}
              >
                <div className="text-center mb-8 pb-6 border-b-2 border-t-2 py-6" style={{ borderColor: "#1a365d" }}>
                  <h1 className="text-lg font-bold uppercase tracking-wide mb-1" style={{ color: "#1a365d" }}>Contrato</h1>
                  <p className="text-sm font-semibold" style={{ color: "#2d3748" }}>{TYPE_LABELS[previewContract.type] || previewContract.type}</p>
                  <p className="text-xs italic mt-1" style={{ color: "#718096" }}>
                    {previewContract.name} — {new Date(previewContract.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
                  </p>
                </div>
                <div
                  className="prose prose-sm max-w-none [&_h1]:text-base [&_h1]:font-bold [&_h1]:uppercase [&_h1]:tracking-wide [&_h1]:border-b [&_h1]:pb-2 [&_h1]:mb-4 [&_h2]:text-sm [&_h2]:font-bold [&_h3]:text-sm [&_h3]:font-bold [&_p]:text-justify [&_p]:mb-3 [&_blockquote]:border-l-[3px] [&_blockquote]:border-blue-900 [&_blockquote]:bg-slate-50 [&_blockquote]:italic [&_blockquote]:pl-4 [&_blockquote]:py-2 [&_li]:mb-1"
                  style={{ color: "#1a1a1a" }}
                  dangerouslySetInnerHTML={{ __html: previewContract.filledHtml || "<p>Sem conteúdo.</p>" }}
                  data-testid="contract-preview-content"
                />
                <div className="mt-12 pt-5 border-t">
                  <p className="text-xs uppercase tracking-widest text-center font-bold mb-10" style={{ color: "#4a5568" }}>Assinaturas</p>
                  <div className="flex justify-between gap-12">
                    <div className="flex-1 text-center pt-16 border-t border-black">
                      <p className="text-xs font-semibold">CONTRATANTE</p>
                      <p className="text-[10px]" style={{ color: "#718096" }}>Representante Legal</p>
                    </div>
                    <div className="flex-1 text-center pt-16 border-t border-black">
                      <p className="text-xs font-semibold">CONTRATADA</p>
                      <p className="text-[10px]" style={{ color: "#718096" }}>Representante Legal</p>
                    </div>
                  </div>
                </div>
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
          <h1 className="text-xl md:text-2xl font-bold" data-testid="text-contratos-title">Contratos</h1>
          <p className="text-sm text-muted-foreground">Crie templates de contratos e gere documentos automaticamente</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="templates" data-testid="tab-contract-templates">
              <FileSignature className="w-4 h-4 mr-1.5" /> Templates ({(templates as any[]).length})
            </TabsTrigger>
            <TabsTrigger value="generated" data-testid="tab-contracts-generated">
              <Eye className="w-4 h-4 mr-1.5" /> Contratos Gerados ({(contracts as any[]).length})
            </TabsTrigger>
          </TabsList>

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
                    data-testid="input-contract-template-search"
                  />
                </div>
                <Select value={templateType} onValueChange={setTemplateType}>
                  <SelectTrigger className="h-8 text-sm w-48" data-testid="select-contract-template-type-filter">
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os tipos</SelectItem>
                    {Object.entries(TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => { setEditingTemplate(null); setEditorOpen(true); }} data-testid="button-new-contract-template">
                <Plus className="w-4 h-4 mr-1.5" /> Novo Template
              </Button>
            </div>

            {loadingTemplates ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : (templates as any[]).length === 0 ? (
              <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
                <FileSignature className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-40" />
                <h3 className="font-semibold text-lg mb-2">Nenhum template criado</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Crie seu primeiro template de contrato com o editor de texto rico e variáveis dinâmicas.
                </p>
                <Button onClick={() => { setEditingTemplate(null); setEditorOpen(true); }} data-testid="button-create-first-contract-template">
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
                  <Card key={t.id} className="hover:border-primary/30 transition-colors" data-testid={`card-contract-template-${t.id}`}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-base" data-testid={`text-contract-template-name-${t.id}`}>{t.name}</CardTitle>
                          <Badge variant="outline" className="mt-1 text-xs">
                            {TYPE_LABELS[t.type] || t.type}
                          </Badge>
                        </div>
                        <FileSignature className="w-5 h-5 text-muted-foreground shrink-0" />
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
                          data-testid={`button-edit-contract-template-${t.id}`}
                        >
                          <FileText className="w-3.5 h-3.5 mr-1" /> Editar
                        </Button>
                        <GenerateContractDialog
                          template={t}
                          onGenerated={() => setActiveTab("generated")}
                        />
                        <Button
                          size="sm" variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setConfirmDeleteTemplateId(t.id)}
                          data-testid={`button-delete-contract-template-${t.id}`}
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

          <TabsContent value="generated" className="mt-4">
            <div className="flex flex-wrap gap-2 mb-4">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar contrato..."
                  value={contractSearch}
                  onChange={e => setContractSearch(e.target.value)}
                  className="pl-8 h-8 text-sm w-44"
                  data-testid="input-contract-search"
                />
              </div>
              <Select value={contractType} onValueChange={setContractType}>
                <SelectTrigger className="h-8 text-sm w-48" data-testid="select-contract-type-filter">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os tipos</SelectItem>
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={contractStatus} onValueChange={setContractStatus}>
                <SelectTrigger className="h-8 text-sm w-36" data-testid="select-contract-status-filter">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="draft">Rascunho</SelectItem>
                  <SelectItem value="generated">Gerado</SelectItem>
                  <SelectItem value="signed">Assinado</SelectItem>
                  <SelectItem value="cancelled">Cancelado</SelectItem>
                </SelectContent>
              </Select>
              {(contractSearch || contractType !== "all" || contractStatus !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setContractSearch(""); setContractType("all"); setContractStatus("all"); }}
                  className="h-8 px-2 text-xs text-muted-foreground"
                  data-testid="button-clear-contract-filters"
                >
                  <XIcon className="w-3.5 h-3.5 mr-1" /> Limpar
                </Button>
              )}
            </div>
            {loadingContracts ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : (contracts as any[]).length === 0 ? (
              <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
                <Eye className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-40" />
                <h3 className="font-semibold text-lg mb-2">Nenhum contrato gerado</h3>
                <p className="text-sm text-muted-foreground">
                  Vá até a aba Templates e clique em "Gerar Contrato" para criar seu primeiro contrato.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {(contracts as any[]).filter((c: any) => {
                  if (contractSearch.trim() && !c.name.toLowerCase().includes(contractSearch.toLowerCase())) return false;
                  if (contractType !== "all" && c.type !== contractType) return false;
                  if (contractStatus !== "all" && (c.status || "draft") !== contractStatus) return false;
                  return true;
                }).map((c: any) => (
                  <Card key={c.id} data-testid={`card-contract-${c.id}`}>
                    <CardContent className="p-4 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <FileSignature className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-sm" data-testid={`text-contract-name-${c.id}`}>{c.name}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <Badge variant="outline" className="text-xs">
                              {TYPE_LABELS[c.type] || c.type}
                            </Badge>
                            {c.status === "signed" && (
                              <Badge className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200">
                                Assinado
                              </Badge>
                            )}
                            {c.status === "cancelled" && (
                              <Badge className="text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200">
                                Cancelado
                              </Badge>
                            )}
                            {c.status === "generated" && (
                              <Badge className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200">
                                Gerado
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(c.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                        <Button size="sm" variant="outline" onClick={() => setPreviewContract(c)} data-testid={`button-preview-contract-${c.id}`}>
                          <Eye className="w-4 h-4 mr-1.5" /> Visualizar
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => downloadPdf(c)} data-testid={`button-download-contract-${c.id}`}>
                          <Download className="w-4 h-4 mr-1.5" /> PDF
                        </Button>
                        {c.driveFileUrl ? (
                          <Button size="sm" variant="outline" onClick={() => window.open(c.driveFileUrl, "_blank")} data-testid={`button-open-drive-${c.id}`}>
                            <ExternalLink className="w-4 h-4 mr-1.5" /> Drive
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => saveToDrive(c)} disabled={savingToDrive === c.id} data-testid={`button-save-drive-${c.id}`}>
                            <CloudUpload className="w-4 h-4 mr-1.5" /> {savingToDrive === c.id ? "Enviando..." : "Drive"}
                          </Button>
                        )}
                        <Button
                          size="sm" variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setConfirmDeleteContractId(c.id)}
                          data-testid={`button-delete-contract-${c.id}`}
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
              O template será removido permanentemente. Os contratos já gerados não serão afetados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-contract-template">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDeleteTemplateId && deleteTemplate(confirmDeleteTemplateId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-contract-template"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeleteContractId !== null} onOpenChange={o => !o && setConfirmDeleteContractId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir contrato?</AlertDialogTitle>
            <AlertDialogDescription>
              O contrato gerado será removido permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-contract">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDeleteContractId && deleteContract(confirmDeleteContractId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-contract"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
