import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Briefcase, Phone, Mail, Users, Loader2, Plus, Trash2, Save, BookOpen, Clock
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { CheckCircle2 } from "lucide-react";

interface ContactVerificationProps {
  verifiedContacts: {
    phone?: string; email?: string; whatsapp?: string;
    contactName?: string; contactRole?: string; notes?: string;
    verifiedAt?: string; verifiedBy?: string;
  };
  setVerifiedContacts: (fn: (prev: any) => any) => void;
  hasVerifiedData: boolean;
  savingVerified: boolean;
  handleSaveVerified: () => void;
  saveVerifiedMutation: any;
  researchNotes: { id: string; fieldName: string; content: string }[];
  addNote: () => void;
  updateNote: (noteId: string, field: "fieldName" | "content", value: string) => void;
  handleSaveNotes: () => void;
  savingNotes: boolean;
  saveNotesMutation: any;
  confirmDeleteNoteId: string | null;
  setConfirmDeleteNoteId: (id: string | null) => void;
  removeNote: (id: string) => void;
}

export default function ContactVerification({
  verifiedContacts,
  setVerifiedContacts,
  hasVerifiedData,
  savingVerified,
  handleSaveVerified,
  saveVerifiedMutation,
  researchNotes,
  addNote,
  updateNote,
  handleSaveNotes,
  savingNotes,
  saveNotesMutation,
  confirmDeleteNoteId,
  setConfirmDeleteNoteId,
  removeNote,
}: ContactVerificationProps) {
  return (
    <div className="space-y-6">
      <Card className={`border-2 ${hasVerifiedData ? "border-green-300 dark:border-green-700" : "border-dashed border-muted-foreground/30"}`}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className={`w-4 h-4 ${hasVerifiedData ? "text-green-500" : "text-muted-foreground/50"}`} />
              <CardTitle className="text-sm font-semibold">Dados de Contato Verificados</CardTitle>
              {hasVerifiedData && (
                <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-300 dark:bg-green-900/20 dark:text-green-400 dark:border-green-700" data-testid="badge-verified">
                  Verificado
                </Badge>
              )}
            </div>
            <Button size="sm" onClick={handleSaveVerified} disabled={savingVerified || saveVerifiedMutation.isPending} data-testid="button-save-verified" className="gap-1.5">
              {savingVerified ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Salvar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Insira os dados reais de contato que você pesquisou. Esses dados terão prioridade sobre os dados da Receita Federal ao promover o lead.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Users className="w-3 h-3" /> Nome do Contato
              </label>
              <input
                type="text"
                value={verifiedContacts.contactName || ""}
                onChange={e => setVerifiedContacts((prev: any) => ({ ...prev, contactName: e.target.value }))}
                placeholder="Nome da pessoa de contato"
                className="w-full px-3 py-2 text-sm border rounded-md bg-background"
                data-testid="input-verified-name"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Briefcase className="w-3 h-3" /> Cargo
              </label>
              <input
                type="text"
                value={verifiedContacts.contactRole || ""}
                onChange={e => setVerifiedContacts((prev: any) => ({ ...prev, contactRole: e.target.value }))}
                placeholder="Cargo / Função"
                className="w-full px-3 py-2 text-sm border rounded-md bg-background"
                data-testid="input-verified-role"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Phone className="w-3 h-3" /> Telefone Verificado
              </label>
              <input
                type="tel"
                value={verifiedContacts.phone || ""}
                onChange={e => setVerifiedContacts((prev: any) => ({ ...prev, phone: e.target.value }))}
                placeholder="(00) 00000-0000"
                className="w-full px-3 py-2 text-sm border rounded-md bg-background"
                data-testid="input-verified-phone"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Mail className="w-3 h-3" /> Email Verificado
              </label>
              <input
                type="email"
                value={verifiedContacts.email || ""}
                onChange={e => setVerifiedContacts((prev: any) => ({ ...prev, email: e.target.value }))}
                placeholder="contato@empresa.com"
                className="w-full px-3 py-2 text-sm border rounded-md bg-background"
                data-testid="input-verified-email"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <SiWhatsapp className="w-3 h-3" /> WhatsApp Verificado
              </label>
              <input
                type="tel"
                value={verifiedContacts.whatsapp || ""}
                onChange={e => setVerifiedContacts((prev: any) => ({ ...prev, whatsapp: e.target.value }))}
                placeholder="(00) 00000-0000"
                className="w-full px-3 py-2 text-sm border rounded-md bg-background"
                data-testid="input-verified-whatsapp"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Observações de Contato</label>
            <Textarea
              value={verifiedContacts.notes || ""}
              onChange={e => setVerifiedContacts((prev: any) => ({ ...prev, notes: e.target.value }))}
              placeholder="Melhor horário para ligar, como conseguiu o contato, referências..."
              className="min-h-[60px] text-sm resize-none"
              data-testid="input-verified-notes"
            />
          </div>
          {verifiedContacts.verifiedAt && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Verificado por {verifiedContacts.verifiedBy || "\u2014"} em {new Date(verifiedContacts.verifiedAt).toLocaleString("pt-BR")}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold">Notas de Pesquisa</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Campos customizados para registrar informações coletadas manualmente sobre esta empresa.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={addNote} data-testid="button-add-note" className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Adicionar campo
          </Button>
          <Button size="sm" onClick={handleSaveNotes} disabled={savingNotes || saveNotesMutation.isPending} data-testid="button-save-notes" className="gap-1.5">
            {savingNotes ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Salvar
          </Button>
        </div>
      </div>

      {researchNotes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-xl">
          <BookOpen className="w-10 h-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">Nenhuma nota de pesquisa ainda</p>
          <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">Use campos customizados para registrar informações como contato, interesse, histórico de relacionamento, due diligence inicial, etc.</p>
          <Button variant="outline" size="sm" onClick={addNote} className="mt-4 gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Adicionar primeiro campo
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {researchNotes.map((note) => (
            <Card key={note.id} data-testid={`card-note-${note.id}`}>
              <CardContent className="pt-4 pb-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={note.fieldName}
                    onChange={e => updateNote(note.id, "fieldName", e.target.value)}
                    placeholder="Nome do campo (ex: Contato Principal, Interesse, Observação)"
                    className="flex-1 text-sm font-semibold bg-transparent border-0 border-b border-dashed border-muted-foreground/30 focus:outline-none focus:border-primary pb-0.5 placeholder:text-muted-foreground/50 placeholder:font-normal"
                    data-testid={`input-note-name-${note.id}`}
                  />
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => setConfirmDeleteNoteId(note.id)} data-testid={`button-delete-note-${note.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <Textarea
                  value={note.content}
                  onChange={e => updateNote(note.id, "content", e.target.value)}
                  placeholder="Conteúdo da nota..."
                  className="min-h-[80px] text-sm resize-none"
                  data-testid={`input-note-content-${note.id}`}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={confirmDeleteNoteId !== null} onOpenChange={o => !o && setConfirmDeleteNoteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir campo?</AlertDialogTitle>
            <AlertDialogDescription>
              O campo de pesquisa será removido. Lembre-se de salvar as notas após a exclusão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDeleteNoteId && removeNote(confirmDeleteNoteId)}
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
