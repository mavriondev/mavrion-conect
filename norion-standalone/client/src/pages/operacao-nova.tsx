import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import {
  Building2, Plus, X, Loader2, ArrowLeft,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";

const FINALIDADES = ["Capital de Giro", "Expansão", "Equipamentos", "Imóvel", "Agro", "Outro"];
const PRAZOS = ["Até 12 meses", "12 a 24 meses", "24 a 36 meses", "Acima de 36 meses"];
const GARANTIAS = ["Imóvel", "Recebíveis", "Veículos", "Equipamentos", "Terra", "Sem garantia"];
const FATURAMENTOS = ["Até R$500k", "R$500k a R$2M", "R$2M a R$10M", "Acima de R$10M"];

export default function OperacaoNovaPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [companySearch, setCompanySearch] = useState("");
  const [selectedCompany, setSelectedCompany] = useState<any>(null);
  const [valorSolicitado, setValorSolicitado] = useState("");
  const [finalidade, setFinalidade] = useState("");
  const [prazo, setPrazo] = useState("");
  const [garantias, setGarantias] = useState<string[]>([]);
  const [faturamento, setFaturamento] = useState("");
  const [possuiDivida, setPossuiDivida] = useState<boolean | null>(null);
  const [observacoes, setObservacoes] = useState("");

  const { data: companiesData } = useQuery<any[]>({ queryKey: ["/api/crm/companies"] });

  const filtered = (companiesData || []).filter((c: any) => {
    if (companySearch.length < 2) return false;
    const q = companySearch.toLowerCase();
    const digits = companySearch.replace(/\D/g, "");
    return c.legalName?.toLowerCase().includes(q) || c.tradeName?.toLowerCase().includes(q) || (digits.length >= 2 && c.cnpj?.includes(digits));
  }).slice(0, 8);

  const createMutation = useMutation({
    mutationFn: async (data: any) => { const res = await apiRequest("POST", "/api/norion/operations", data); return res.json(); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/operations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/dashboard"] });
      toast({ title: "Operação criada com sucesso" });
      setLocation("/operacoes");
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/operacoes">
          <Button variant="ghost" size="icon" data-testid="button-voltar-operacoes">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-nova-operacao-title">Nova Operação</h1>
          <p className="text-sm text-muted-foreground">Preencha os dados para criar uma nova operação de crédito</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div>
            <Label className="text-sm">Empresa</Label>
            {selectedCompany ? (
              <div className="flex items-center gap-2 mt-1 p-2 bg-muted/30 rounded border">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium flex-1">{selectedCompany.legalName}</span>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setSelectedCompany(null)}><X className="w-3 h-3" /></Button>
              </div>
            ) : (
              <div className="mt-1">
                <Input placeholder="Buscar por nome ou CNPJ..." value={companySearch} onChange={(e) => setCompanySearch(e.target.value)} data-testid="input-n-company-search" />
                {filtered.length > 0 && companySearch.length >= 2 && (
                  <div className="mt-1 border rounded-md max-h-48 overflow-y-auto">
                    {filtered.map((c: any) => (
                      <div key={c.id} role="option" className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex items-center gap-2 cursor-pointer border-b last:border-b-0"
                        onClick={() => { setSelectedCompany(c); setCompanySearch(""); }} data-testid={`option-n-company-${c.id}`}>
                        <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate">{c.legalName}</span>
                        {c.cnpj && <span className="text-muted-foreground text-xs ml-auto shrink-0">{c.cnpj}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div>
            <Label className="text-sm">Valor Solicitado (R$)</Label>
            <Input type="number" placeholder="0" value={valorSolicitado} onChange={(e) => setValorSolicitado(e.target.value)} data-testid="input-n-valor-solicitado" />
          </div>
          <div>
            <Label className="text-sm">Finalidade</Label>
            <Select value={finalidade} onValueChange={setFinalidade}>
              <SelectTrigger data-testid="select-n-finalidade"><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>{FINALIDADES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Prazo Desejado</Label>
            <Select value={prazo} onValueChange={setPrazo}>
              <SelectTrigger data-testid="select-n-prazo"><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>{PRAZOS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Garantias Disponíveis</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {GARANTIAS.map(g => (
                <label key={g} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={garantias.includes(g)} onCheckedChange={() => setGarantias(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g])} />
                  {g}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-sm">Faturamento Anual</Label>
            <Select value={faturamento} onValueChange={setFaturamento}>
              <SelectTrigger data-testid="select-n-faturamento"><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>{FATURAMENTOS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Possui dívida bancária?</Label>
            <div className="flex gap-4 mt-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={possuiDivida === true} onCheckedChange={() => setPossuiDivida(true)} /> Sim
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={possuiDivida === false} onCheckedChange={() => setPossuiDivida(false)} /> Não
              </label>
            </div>
          </div>
          <div>
            <Label className="text-sm">Observações</Label>
            <Textarea placeholder="Observações internas..." value={observacoes} onChange={(e) => setObservacoes(e.target.value)} data-testid="input-n-observacoes" />
          </div>

          <div className="flex items-center gap-3 pt-2 flex-wrap">
            <Link href="/operacoes">
              <Button variant="outline" data-testid="button-cancelar-nova-operacao">Cancelar</Button>
            </Link>
            <Button onClick={() => {
              if (!selectedCompany) return toast({ title: "Selecione uma empresa", variant: "destructive" });
              createMutation.mutate({
                companyId: selectedCompany.id,
                diagnostico: { valorSolicitado: parseFloat(valorSolicitado) || 0, finalidade, prazo, garantias, faturamento, possuiDivida },
                observacoesInternas: observacoes || null,
              });
            }} disabled={createMutation.isPending || !selectedCompany} data-testid="button-n-create-operation">
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Plus className="w-4 h-4 mr-1.5" />}
              Criar Operação
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
