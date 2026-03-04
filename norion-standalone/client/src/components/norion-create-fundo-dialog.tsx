import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

const TIPOS_OPERACAO = ["Capital de Giro", "Expansão", "Equipamentos", "Imóvel", "Agro", "Outro"];
const GARANTIAS_OPTIONS = ["Imóvel", "Recebíveis", "Veículos", "Equipamentos", "Terra", "Sem garantia"];
const CATEGORIAS = ["FIDC", "FII", "FIP", "Securitizadora", "Banco", "Fintech", "Outro"];

interface InitialData {
  nome?: string;
  cnpj?: string;
  categoria?: string;
}

interface CreateFundoDialogProps {
  open: boolean;
  onClose: () => void;
  initialData?: InitialData;
}

export function CreateFundoDialog({ open, onClose, initialData }: CreateFundoDialogProps) {
  const { toast } = useToast();
  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [categoria, setCategoria] = useState("");
  const [tipoOperacao, setTipoOperacao] = useState<string[]>([]);
  const [valorMinimo, setValorMinimo] = useState("");
  const [valorMaximo, setValorMaximo] = useState("");
  const [prazoMinimo, setPrazoMinimo] = useState("");
  const [prazoMaximo, setPrazoMaximo] = useState("");
  const [garantiasAceitas, setGarantiasAceitas] = useState<string[]>([]);
  const [contatoNome, setContatoNome] = useState("");
  const [contatoEmail, setContatoEmail] = useState("");
  const [contatoTelefone, setContatoTelefone] = useState("");
  const [observacoes, setObservacoes] = useState("");

  useEffect(() => {
    if (open && initialData) {
      if (initialData.nome) setNome(initialData.nome);
      if (initialData.cnpj) setCnpj(initialData.cnpj);
      if (initialData.categoria) setCategoria(initialData.categoria);
    }
  }, [open, initialData]);

  const createMutation = useMutation({
    mutationFn: async (data: any) => { const res = await apiRequest("POST", "/api/norion/fundos-parceiros", data); return res.json(); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/fundos-parceiros"] });
      toast({ title: "Fundo parceiro cadastrado com sucesso" });
      resetAndClose();
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const resetAndClose = () => {
    setNome(""); setCnpj(""); setCategoria(""); setTipoOperacao([]); setValorMinimo(""); setValorMaximo("");
    setPrazoMinimo(""); setPrazoMaximo(""); setGarantiasAceitas([]); setContatoNome(""); setContatoEmail("");
    setContatoTelefone(""); setObservacoes(""); onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && resetAndClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Cadastrar Fundo Parceiro</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-sm">Nome do Fundo *</Label>
              <Input placeholder="Nome do fundo" value={nome} onChange={(e) => setNome(e.target.value)} data-testid="input-fp-nome" />
            </div>
            <div>
              <Label className="text-sm">CNPJ</Label>
              <Input placeholder="00.000.000/0000-00" value={cnpj} onChange={(e) => setCnpj(e.target.value)} className="font-mono" data-testid="input-fp-cnpj" />
            </div>
            <div>
              <Label className="text-sm">Categoria</Label>
              <Select value={categoria} onValueChange={setCategoria}>
                <SelectTrigger data-testid="select-fp-categoria"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>{CATEGORIAS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-sm">Tipos de Operação Aceitos</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {TIPOS_OPERACAO.map(t => (
                <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={tipoOperacao.includes(t)} onCheckedChange={() => setTipoOperacao(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])} />
                  {t}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-sm">Valor Mínimo (R$)</Label><Input type="number" placeholder="0" value={valorMinimo} onChange={(e) => setValorMinimo(e.target.value)} data-testid="input-fp-val-min" /></div>
            <div><Label className="text-sm">Valor Máximo (R$)</Label><Input type="number" placeholder="0" value={valorMaximo} onChange={(e) => setValorMaximo(e.target.value)} data-testid="input-fp-val-max" /></div>
            <div><Label className="text-sm">Prazo Mínimo</Label><Input placeholder="12 meses" value={prazoMinimo} onChange={(e) => setPrazoMinimo(e.target.value)} /></div>
            <div><Label className="text-sm">Prazo Máximo</Label><Input placeholder="60 meses" value={prazoMaximo} onChange={(e) => setPrazoMaximo(e.target.value)} /></div>
          </div>
          <div>
            <Label className="text-sm">Garantias Aceitas</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {GARANTIAS_OPTIONS.map(g => (
                <label key={g} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={garantiasAceitas.includes(g)} onCheckedChange={() => setGarantiasAceitas(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g])} />
                  {g}
                </label>
              ))}
            </div>
          </div>
          <Separator />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><Label className="text-sm">Contato — Nome</Label><Input placeholder="Nome" value={contatoNome} onChange={(e) => setContatoNome(e.target.value)} /></div>
            <div><Label className="text-sm">Email</Label><Input placeholder="email@fundo.com" value={contatoEmail} onChange={(e) => setContatoEmail(e.target.value)} /></div>
            <div><Label className="text-sm">Telefone</Label><Input placeholder="(11) 99999-9999" value={contatoTelefone} onChange={(e) => setContatoTelefone(e.target.value)} /></div>
          </div>
          <div><Label className="text-sm">Observações</Label><Textarea placeholder="Notas internas..." value={observacoes} onChange={(e) => setObservacoes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose}>Cancelar</Button>
          <Button onClick={() => {
            if (!nome) return toast({ title: "Nome é obrigatório", variant: "destructive" });
            createMutation.mutate({
              nome, cnpj: cnpj || null, categoria: categoria || null, tipoOperacao, garantiasAceitas,
              valorMinimo: parseFloat(valorMinimo) || null, valorMaximo: parseFloat(valorMaximo) || null,
              prazoMinimo: prazoMinimo || null, prazoMaximo: prazoMaximo || null,
              contatoNome: contatoNome || null, contatoEmail: contatoEmail || null, contatoTelefone: contatoTelefone || null,
              observacoes: observacoes || null,
            });
          }} disabled={createMutation.isPending || !nome} data-testid="button-fp-create">
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Plus className="w-4 h-4 mr-1.5" />}
            Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
