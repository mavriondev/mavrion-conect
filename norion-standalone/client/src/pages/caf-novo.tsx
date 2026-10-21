import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Leaf, Plus, Trash2 } from "lucide-react";

const UF_LIST = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA",
  "PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

const GRUPO_OPTIONS = [
  { value: "A", label: "Grupo A (Reforma Agrária)" },
  { value: "A/C", label: "Grupo A/C (Pós-assentamento)" },
  { value: "B", label: "Grupo B (Microcrédito)" },
  { value: "V", label: "Grupo V (Renda Variável)" },
];

const CONDICAO_POSSE_OPTIONS = [
  "Proprietário", "Arrendatário", "Parceiro", "Meeiro", "Comodatário",
  "Posseiro", "Assentado", "Concessionário", "Quilombola", "Indígena", "Outro",
];

export default function CafNovoPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const emptyForm = {
    nomeTitular: "", cpfTitular: "", numeroUFPA: "", numeroCAF: "", numeroDAPAntigo: "",
    grupo: "", enquadramentoPronaf: "", validade: "", dataInscricao: "", ultimaAtualizacao: "",
    municipio: "", uf: "", areaHa: "", totalEstabelecimentoHa: "", totalEstabelecimentoM3: "",
    numImoveis: "1", condicaoPosse: "", atividadePrincipal: "", caracterizacaoUfpa: "",
    atividadesProdutivas: "", rendaBrutaAnual: "",
    entidadeNome: "", entidadeCnpj: "", cadastrador: "", observacoes: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [familiarRows, setFamiliarRows] = useState<{ nome: string; cpf: string; parentesco: string; dataInclusao: string }[]>([]);
  const [tab, setTab] = useState<"info" | "propriedade" | "familia" | "entidade">("info");

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/norion/caf", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/caf"] });
      queryClient.invalidateQueries({ queryKey: ["/api/caf-extrator/registros"] });
      toast({ title: "Registro CAF criado" });
      setLocation("/caf");
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  function handleSubmit() {
    if (!form.nomeTitular.trim()) {
      toast({ title: "Preencha o nome do titular", variant: "destructive" });
      return;
    }
    const payload: any = { ...form };
    if (payload.areaHa) payload.areaHa = parseFloat(payload.areaHa); else delete payload.areaHa;
    if (payload.rendaBrutaAnual) payload.rendaBrutaAnual = parseFloat(payload.rendaBrutaAnual); else delete payload.rendaBrutaAnual;
    if (payload.totalEstabelecimentoHa) payload.totalEstabelecimentoHa = parseFloat(payload.totalEstabelecimentoHa); else delete payload.totalEstabelecimentoHa;
    if (payload.totalEstabelecimentoM3) payload.totalEstabelecimentoM3 = parseFloat(payload.totalEstabelecimentoM3); else delete payload.totalEstabelecimentoM3;
    if (payload.numImoveis) payload.numImoveis = parseInt(payload.numImoveis); else delete payload.numImoveis;
    payload.composicaoFamiliar = familiarRows.filter(r => r.nome.trim());
    Object.keys(payload).forEach(k => { if (payload[k] === "") delete payload[k]; });
    createMutation.mutate(payload);
  }

  const F = (field: string) => (e: any) => setForm(p => ({ ...p, [field]: e.target.value }));

  return (
    <div className="p-6 space-y-6 max-w-[900px] mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/caf")} data-testid="button-voltar-caf">
          <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
        </Button>
        <div className="p-2 bg-green-100 rounded-lg">
          <Leaf className="w-6 h-6 text-green-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold" data-testid="title-caf-novo">Novo Registro CAF</h1>
          <p className="text-sm text-muted-foreground">Cadastre os dados do extrato público da UFPA</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex gap-1 border-b">
            {[
              { id: "info" as const, label: "Informações" },
              { id: "propriedade" as const, label: "Propriedade" },
              { id: "familia" as const, label: "Composição Familiar" },
              { id: "entidade" as const, label: "Entidade" },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${tab === t.id ? "border-green-600 text-green-700" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                data-testid={`tab-${t.id}`}
              >{t.label}</button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {tab === "info" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Nome Titular (Declarante) *</Label>
                <Input value={form.nomeTitular} onChange={F("nomeTitular")} placeholder="Nome completo" data-testid="create-nome" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">CPF</Label>
                <Input value={form.cpfTitular} onChange={F("cpfTitular")} placeholder="000.000.000-00" data-testid="create-cpf" />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Nº UFPA</Label>
                <Input value={form.numeroUFPA} onChange={F("numeroUFPA")} placeholder="RS032025.01.002731822CAF" data-testid="create-ufpa" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nº CAF</Label>
                <Input value={form.numeroCAF} onChange={F("numeroCAF")} data-testid="create-caf" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nº DAP (antigo)</Label>
                <Input value={form.numeroDAPAntigo} onChange={F("numeroDAPAntigo")} data-testid="create-dap" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Grupo PRONAF</Label>
                <Select value={form.grupo} onValueChange={(v) => setForm(p => ({ ...p, grupo: v }))}>
                  <SelectTrigger data-testid="create-grupo"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{GRUPO_OPTIONS.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Enquadramento PRONAF</Label>
                <Input value={form.enquadramentoPronaf} onChange={F("enquadramentoPronaf")} placeholder="Ex: PRONAF V" data-testid="create-enquadramento" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Data de Inscrição</Label>
                <Input type="date" value={form.dataInscricao} onChange={F("dataInscricao")} data-testid="create-data-inscricao" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Data de Validade</Label>
                <Input type="date" value={form.validade} onChange={F("validade")} data-testid="create-validade" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Última Atualização</Label>
                <Input type="date" value={form.ultimaAtualizacao} onChange={F("ultimaAtualizacao")} data-testid="create-ultima-atualizacao" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Situação</Label>
                <Badge variant={form.validade && new Date(form.validade) > new Date() ? "default" : "destructive"} className="mt-1">
                  {form.validade && new Date(form.validade) > new Date() ? "ATIVA" : form.validade ? "INATIVA" : "—"}
                </Badge>
              </div>
            </div>
          )}

          {tab === "propriedade" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Município</Label>
                <Input value={form.municipio} onChange={F("municipio")} placeholder="Ex: Lagoa Vermelha" data-testid="create-municipio" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">UF</Label>
                <Select value={form.uf} onValueChange={(v) => setForm(p => ({ ...p, uf: v }))}>
                  <SelectTrigger data-testid="create-uf"><SelectValue placeholder="UF" /></SelectTrigger>
                  <SelectContent>{UF_LIST.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Área do Imóvel Principal (ha)</Label>
                <Input type="number" step="0.01" value={form.areaHa} onChange={F("areaHa")} data-testid="create-area" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Total Estabelecimento (ha)</Label>
                <Input type="number" step="0.01" value={form.totalEstabelecimentoHa} onChange={F("totalEstabelecimentoHa")} data-testid="create-total-ha" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Total Estabelecimento (m³)</Label>
                <Input type="number" step="0.01" value={form.totalEstabelecimentoM3} onChange={F("totalEstabelecimentoM3")} data-testid="create-total-m3" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nº de Imóveis Explorados</Label>
                <Input type="number" value={form.numImoveis} onChange={F("numImoveis")} data-testid="create-num-imoveis" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Condição de Posse</Label>
                <Select value={form.condicaoPosse} onValueChange={(v) => setForm(p => ({ ...p, condicaoPosse: v }))}>
                  <SelectTrigger data-testid="create-condicao-posse"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{CONDICAO_POSSE_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Renda Bruta Anual (R$)</Label>
                <Input type="number" value={form.rendaBrutaAnual} onChange={F("rendaBrutaAnual")} data-testid="create-renda" />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Atividade Principal</Label>
                <Input value={form.atividadePrincipal} onChange={F("atividadePrincipal")} placeholder="Agricultura, Pecuária..." data-testid="create-atividade-principal" />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Atividades Produtivas</Label>
                <Textarea value={form.atividadesProdutivas} onChange={F("atividadesProdutivas")} rows={2} placeholder="Soja, Milho, Gado, etc." data-testid="create-atividades" />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Caracterização da UFPA</Label>
                <Input value={form.caracterizacaoUfpa} onChange={F("caracterizacaoUfpa")} data-testid="create-caracterizacao" />
              </div>
            </div>
          )}

          {tab === "familia" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Membros da Unidade Familiar de Produção Agrária.</p>
              {familiarRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_140px_160px_120px_32px] gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-[10px]">Nome</Label>
                    <Input className="h-8 text-xs" value={row.nome} onChange={(e) => {
                      const upd = [...familiarRows]; upd[i].nome = e.target.value; setFamiliarRows(upd);
                    }} data-testid={`familiar-nome-${i}`} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">CPF</Label>
                    <Input className="h-8 text-xs" value={row.cpf} onChange={(e) => {
                      const upd = [...familiarRows]; upd[i].cpf = e.target.value; setFamiliarRows(upd);
                    }} data-testid={`familiar-cpf-${i}`} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Parentesco</Label>
                    <Input className="h-8 text-xs" value={row.parentesco} onChange={(e) => {
                      const upd = [...familiarRows]; upd[i].parentesco = e.target.value; setFamiliarRows(upd);
                    }} placeholder="Declarante, Cônjuge..." data-testid={`familiar-parentesco-${i}`} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Data Inclusão</Label>
                    <Input type="date" className="h-8 text-xs" value={row.dataInclusao} onChange={(e) => {
                      const upd = [...familiarRows]; upd[i].dataInclusao = e.target.value; setFamiliarRows(upd);
                    }} data-testid={`familiar-data-${i}`} />
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setFamiliarRows(familiarRows.filter((_, idx) => idx !== i))} data-testid={`familiar-remover-${i}`}>
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setFamiliarRows([...familiarRows, { nome: "", cpf: "", parentesco: "", dataInclusao: "" }])} data-testid="button-add-familiar">
                <Plus className="w-3.5 h-3.5 mr-1" /> Adicionar Membro
              </Button>
            </div>
          )}

          {tab === "entidade" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Entidade Responsável pela Inscrição</Label>
                <Input value={form.entidadeNome} onChange={F("entidadeNome")} data-testid="create-entidade-nome" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">CNPJ da Entidade</Label>
                <Input value={form.entidadeCnpj} onChange={F("entidadeCnpj")} data-testid="create-entidade-cnpj" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cadastrador</Label>
                <Input value={form.cadastrador} onChange={F("cadastrador")} data-testid="create-cadastrador" />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Observações</Label>
                <Textarea value={form.observacoes} onChange={F("observacoes")} rows={2} data-testid="create-observacoes" />
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => setLocation("/caf")}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending} data-testid="button-criar-caf">
              <Plus className="w-4 h-4 mr-1" /> Criar Registro
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
