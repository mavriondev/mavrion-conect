import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Leaf, Edit2, Save, Trash2, Search, CheckCircle, XCircle, AlertTriangle,
  BarChart3, MapPin, Loader2,
} from "lucide-react";
import type { NorionCafRegistro } from "@shared/schema";

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

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ativo") return <Badge className="bg-green-100 text-green-700 border-green-300"><CheckCircle className="w-3 h-3 mr-1" />Ativo</Badge>;
  if (status === "vencido") return <Badge className="bg-red-100 text-red-700 border-red-300"><XCircle className="w-3 h-3 mr-1" />Vencido</Badge>;
  return <Badge variant="outline"><AlertTriangle className="w-3 h-3 mr-1" />Pendente</Badge>;
}

export default function CafDetalhePage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0");

  const { data: registro, isLoading } = useQuery<NorionCafRegistro>({
    queryKey: ["/api/norion/caf", id],
    queryFn: async () => {
      const res = await fetch(`/api/norion/caf/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Não encontrado");
      const data = await res.json();
      return data.data || data;
    },
    enabled: id > 0,
  });

  const [editing, setEditing] = useState(false);

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!registro) {
    return (
      <div className="p-6 space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/caf")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
        </Button>
        <p className="text-muted-foreground">Registro não encontrado.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1000px] mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/caf")} data-testid="button-voltar-caf">
            <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
          </Button>
          <div className="p-2 bg-green-100 rounded-lg">
            <Leaf className="w-6 h-6 text-green-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="title-caf-detalhe">{registro.nomeTitular}</h1>
            <p className="text-sm text-muted-foreground">Registro CAF #{registro.id}</p>
          </div>
        </div>
        <StatusBadge status={registro.status} />
      </div>

      {editing ? (
        <EditForm registro={registro} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />
      ) : (
        <DetailView registro={registro} onEdit={() => setEditing(true)} />
      )}
    </div>
  );
}

function DetailView({ registro, onEdit }: { registro: NorionCafRegistro; onEdit: () => void }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const r: any = registro;
  const composicao: any[] = Array.isArray(r.composicaoFamiliar) ? r.composicaoFamiliar : [];

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/norion/caf/${registro.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/caf"] });
      queryClient.invalidateQueries({ queryKey: ["/api/caf-extrator/registros"] });
      toast({ title: "Registro excluído" });
      setLocation("/caf");
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const consultaDapMutation = useMutation({
    mutationFn: async () => {
      const cpf = (registro.cpfTitular || "").replace(/\D/g, "");
      if (!cpf || cpf.length !== 11) throw new Error("CPF inválido para consulta");
      const res = await fetch(`/api/norion/caf/consulta-dap/${cpf}`);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.encontrado) {
        toast({ title: "DAP encontrada", description: data.mensagem });
      } else {
        toast({ title: "Consulta realizada", description: data.mensagem });
      }
    },
    onError: (err: any) => toast({ title: "Erro na consulta", description: err.message, variant: "destructive" }),
  });

  const { data: pronafLinhas } = useQuery<any[]>({
    queryKey: ["/api/norion/pronaf/linhas", registro.grupo, registro.rendaBrutaAnual],
    queryFn: () => {
      const params = new URLSearchParams();
      if (registro.grupo) params.set("grupo", registro.grupo);
      if (registro.rendaBrutaAnual) params.set("renda", String(registro.rendaBrutaAnual));
      return fetch(`/api/norion/pronaf/linhas?${params}`).then(r => r.json());
    },
    enabled: !!registro.grupo,
  });

  const { data: sicorData } = useQuery<any>({
    queryKey: ["/api/norion/sicor", r.codigoMunicipio],
    queryFn: () => fetch(`/api/norion/sicor/${r.codigoMunicipio}`).then(r => r.json()),
    enabled: !!r.codigoMunicipio,
  });

  return (
    <>
      <div className="flex items-center gap-2">
        {registro.cpfTitular && (
          <Button variant="outline" size="sm" onClick={() => consultaDapMutation.mutate()} disabled={consultaDapMutation.isPending} data-testid="button-consultar-dap">
            <Search className="w-3 h-3 mr-1" /> Consultar DAP
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onEdit} data-testid="button-editar-registro">
          <Edit2 className="w-3 h-3 mr-1" /> Editar
        </Button>
        <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate()} data-testid="button-excluir-registro">
          <Trash2 className="w-3 h-3 mr-1" /> Excluir
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground uppercase tracking-wide">Informações da UFPA</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">CPF:</span> <span data-testid="detail-cpf">{registro.cpfTitular || "—"}</span></div>
            <div><span className="text-muted-foreground">Grupo:</span> <span data-testid="detail-grupo">{registro.grupo || "—"}</span></div>
            {r.numeroUFPA && <div><span className="text-muted-foreground">Nº UFPA:</span> <span className="font-mono text-xs" data-testid="detail-ufpa">{r.numeroUFPA}</span></div>}
            <div><span className="text-muted-foreground">Nº CAF:</span> <span data-testid="detail-caf">{registro.numeroCAF || "—"}</span></div>
            <div><span className="text-muted-foreground">Nº DAP:</span> <span data-testid="detail-dap">{registro.numeroDAPAntigo || "—"}</span></div>
            {r.enquadramentoPronaf && <div><span className="text-muted-foreground">Enquadramento:</span> {r.enquadramentoPronaf}</div>}
            <div><span className="text-muted-foreground">Validade:</span> <span data-testid="detail-validade">{registro.validade || "—"}</span></div>
            {r.dataInscricao && <div><span className="text-muted-foreground">Inscrição:</span> {r.dataInscricao}</div>}
            {r.ultimaAtualizacao && <div><span className="text-muted-foreground">Última Atualização:</span> {r.ultimaAtualizacao}</div>}
            {r.norionProfile && <div><span className="text-muted-foreground">Perfil Norion:</span> <Badge variant="outline">{r.norionProfile}</Badge></div>}
            {r.classificacao && <div><span className="text-muted-foreground">Classificação:</span> <Badge variant="outline">{r.classificacao}</Badge></div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground uppercase tracking-wide">Propriedade</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">Município:</span> <span data-testid="detail-municipio">{[registro.municipio, registro.uf].filter(Boolean).join("/") || "—"}</span></div>
            <div><span className="text-muted-foreground">Área Imóvel:</span> <span data-testid="detail-area">{registro.areaHa ? `${registro.areaHa.toLocaleString("pt-BR")} ha` : "—"}</span></div>
            {r.totalEstabelecimentoHa && <div><span className="text-muted-foreground">Total Estab.:</span> {r.totalEstabelecimentoHa.toLocaleString("pt-BR")} ha</div>}
            {r.numImoveis && <div><span className="text-muted-foreground">Nº Imóveis:</span> {r.numImoveis}</div>}
            {r.condicaoPosse && <div><span className="text-muted-foreground">Posse:</span> {r.condicaoPosse}</div>}
            <div><span className="text-muted-foreground">Renda Bruta:</span> <span data-testid="detail-renda">{registro.rendaBrutaAnual ? formatCurrency(registro.rendaBrutaAnual) : "—"}</span></div>
            {r.atividadePrincipal && <div><span className="text-muted-foreground">Atividade Principal:</span> {r.atividadePrincipal}</div>}
            {registro.atividadesProdutivas && <div><span className="text-muted-foreground">Atividades:</span> {registro.atividadesProdutivas}</div>}
          </CardContent>
        </Card>
      </div>

      {composicao.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              Composição Familiar <Badge variant="outline" className="text-[10px]">{composicao.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {composicao.map((m: any, i: number) => (
                <div key={i} className="border rounded px-2.5 py-1.5 text-xs flex items-center justify-between" data-testid={`familiar-view-${i}`}>
                  <div>
                    <span className="font-medium">{m.nome}</span>
                    {m.cpf && <span className="text-muted-foreground ml-2">{m.cpf}</span>}
                  </div>
                  <div className="text-muted-foreground text-right">
                    {m.parentesco && <span>{m.parentesco}</span>}
                    {m.dataInclusao && <span className="ml-2">{m.dataInclusao}</span>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {(r.entidadeNome || r.cadastrador) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground uppercase tracking-wide">Entidade Responsável</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {r.entidadeNome && <div><span className="text-muted-foreground">Entidade:</span> {r.entidadeNome}</div>}
            {r.entidadeCnpj && <div><span className="text-muted-foreground">CNPJ:</span> {r.entidadeCnpj}</div>}
            {r.cadastrador && <div><span className="text-muted-foreground">Cadastrador:</span> {r.cadastrador}</div>}
          </CardContent>
        </Card>
      )}

      {registro.observacoes && (
        <Card>
          <CardContent className="pt-4 text-sm">
            <span className="text-muted-foreground">Observações:</span>
            <p className="mt-1">{registro.observacoes}</p>
          </CardContent>
        </Card>
      )}

      {pronafLinhas && pronafLinhas.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4 text-green-600" /> Linhas PRONAF Elegíveis
              <Badge variant="outline" className="text-xs">{pronafLinhas.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {pronafLinhas.map((l: any) => (
                <div key={l.id} className="border rounded-md p-2.5 text-xs hover:bg-green-50/50" data-testid={`pronaf-linha-${l.id}`}>
                  <div className="font-medium">{l.nome}</div>
                  <div className="flex items-center gap-3 mt-1 text-muted-foreground">
                    <span>Taxa: {l.taxa}% a.a.</span>
                    <span>Limite: {formatCurrency(l.limite)}</span>
                    <span>Prazo: {l.prazoMaximo}</span>
                  </div>
                  <div className="mt-0.5 text-muted-foreground">
                    Grupos: {l.gruposElegiveis?.join(", ")}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {sicorData && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-blue-600" /> Crédito Rural na Região
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="border rounded p-2">
                <div className="text-xs text-muted-foreground">Contratos PRONAF</div>
                <div className="font-bold">{sicorData.totalContratos?.toLocaleString("pt-BR") || 0}</div>
              </div>
              <div className="border rounded p-2">
                <div className="text-xs text-muted-foreground">Volume</div>
                <div className="font-bold">{formatCurrency(sicorData.totalValor || 0)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function EditForm({ registro, onCancel, onSaved }: { registro: NorionCafRegistro; onCancel: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const r: any = registro;
  const [form, setForm] = useState({
    nomeTitular: registro.nomeTitular || "",
    cpfTitular: registro.cpfTitular || "",
    numeroUFPA: r.numeroUFPA || "",
    numeroCAF: registro.numeroCAF || "",
    numeroDAPAntigo: registro.numeroDAPAntigo || "",
    grupo: registro.grupo || "",
    enquadramentoPronaf: r.enquadramentoPronaf || "",
    validade: registro.validade || "",
    dataInscricao: r.dataInscricao || "",
    ultimaAtualizacao: r.ultimaAtualizacao || "",
    municipio: registro.municipio || "",
    uf: registro.uf || "",
    areaHa: registro.areaHa ? String(registro.areaHa) : "",
    totalEstabelecimentoHa: r.totalEstabelecimentoHa ? String(r.totalEstabelecimentoHa) : "",
    totalEstabelecimentoM3: r.totalEstabelecimentoM3 ? String(r.totalEstabelecimentoM3) : "",
    numImoveis: r.numImoveis ? String(r.numImoveis) : "1",
    condicaoPosse: r.condicaoPosse || "",
    atividadePrincipal: r.atividadePrincipal || "",
    caracterizacaoUfpa: r.caracterizacaoUfpa || "",
    atividadesProdutivas: registro.atividadesProdutivas || "",
    rendaBrutaAnual: registro.rendaBrutaAnual ? String(registro.rendaBrutaAnual) : "",
    entidadeNome: r.entidadeNome || "",
    entidadeCnpj: r.entidadeCnpj || "",
    cadastrador: r.cadastrador || "",
    observacoes: registro.observacoes || "",
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/norion/caf/${registro.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/caf"] });
      queryClient.invalidateQueries({ queryKey: ["/api/caf-extrator/registros"] });
      toast({ title: "Registro atualizado" });
      onSaved();
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  function handleSave() {
    const payload: any = { ...form };
    if (payload.areaHa) payload.areaHa = parseFloat(payload.areaHa); else payload.areaHa = null;
    if (payload.rendaBrutaAnual) payload.rendaBrutaAnual = parseFloat(payload.rendaBrutaAnual); else payload.rendaBrutaAnual = null;
    if (payload.totalEstabelecimentoHa) payload.totalEstabelecimentoHa = parseFloat(payload.totalEstabelecimentoHa); else delete payload.totalEstabelecimentoHa;
    if (payload.totalEstabelecimentoM3) payload.totalEstabelecimentoM3 = parseFloat(payload.totalEstabelecimentoM3); else delete payload.totalEstabelecimentoM3;
    if (payload.numImoveis) payload.numImoveis = parseInt(payload.numImoveis); else delete payload.numImoveis;
    Object.keys(payload).forEach(k => { if (payload[k] === "") delete payload[k]; });
    saveMutation.mutate(payload);
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Editar Registro</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 border rounded-lg p-4 bg-green-50/30">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Nome Titular</Label>
              <Input value={form.nomeTitular} onChange={(e) => setForm(p => ({ ...p, nomeTitular: e.target.value }))} data-testid="edit-nome" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CPF</Label>
              <Input value={form.cpfTitular} onChange={(e) => setForm(p => ({ ...p, cpfTitular: e.target.value }))} data-testid="edit-cpf" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Nº UFPA</Label>
              <Input value={form.numeroUFPA} onChange={(e) => setForm(p => ({ ...p, numeroUFPA: e.target.value }))} data-testid="edit-ufpa" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nº CAF</Label>
              <Input value={form.numeroCAF} onChange={(e) => setForm(p => ({ ...p, numeroCAF: e.target.value }))} data-testid="edit-caf" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nº DAP (antigo)</Label>
              <Input value={form.numeroDAPAntigo} onChange={(e) => setForm(p => ({ ...p, numeroDAPAntigo: e.target.value }))} data-testid="edit-dap" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Grupo</Label>
              <Select value={form.grupo} onValueChange={(v) => setForm(p => ({ ...p, grupo: v }))}>
                <SelectTrigger data-testid="edit-grupo"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{GRUPO_OPTIONS.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Enquadramento PRONAF</Label>
              <Input value={form.enquadramentoPronaf} onChange={(e) => setForm(p => ({ ...p, enquadramentoPronaf: e.target.value }))} data-testid="edit-enquadramento" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Município</Label>
              <Input value={form.municipio} onChange={(e) => setForm(p => ({ ...p, municipio: e.target.value }))} data-testid="edit-municipio" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">UF</Label>
              <Select value={form.uf} onValueChange={(v) => setForm(p => ({ ...p, uf: v }))}>
                <SelectTrigger data-testid="edit-uf"><SelectValue placeholder="UF" /></SelectTrigger>
                <SelectContent>{UF_LIST.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Área (ha)</Label>
              <Input type="number" value={form.areaHa} onChange={(e) => setForm(p => ({ ...p, areaHa: e.target.value }))} data-testid="edit-area" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Renda Bruta Anual (R$)</Label>
              <Input type="number" value={form.rendaBrutaAnual} onChange={(e) => setForm(p => ({ ...p, rendaBrutaAnual: e.target.value }))} data-testid="edit-renda" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Atividade Principal</Label>
              <Input value={form.atividadePrincipal} onChange={(e) => setForm(p => ({ ...p, atividadePrincipal: e.target.value }))} data-testid="edit-atividade-principal" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Atividades Produtivas</Label>
              <Textarea value={form.atividadesProdutivas} onChange={(e) => setForm(p => ({ ...p, atividadesProdutivas: e.target.value }))} rows={2} data-testid="edit-atividades" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Observações</Label>
            <Textarea value={form.observacoes} onChange={(e) => setForm(p => ({ ...p, observacoes: e.target.value }))} rows={2} data-testid="edit-observacoes" />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-salvar-edicao">
              <Save className="w-4 h-4 mr-1" /> Salvar Alterações
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
