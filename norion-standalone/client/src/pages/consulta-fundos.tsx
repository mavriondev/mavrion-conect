import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Loader2, AlertTriangle, Plus,
  Landmark, FileText, Handshake,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreateFundoDialog } from "@/components/norion-create-fundo-dialog";

export default function NorionConsultaFundosPage() {
  const { toast } = useToast();
  const [cvmCnpj, setCvmCnpj] = useState("");
  const [cvmResult, setCvmResult] = useState<any>(null);
  const [cvmLoading, setCvmLoading] = useState(false);
  const [cvmError, setCvmError] = useState<string | null>(null);
  const [anbimaType, setAnbimaType] = useState("");
  const [anbimaSearch, setAnbimaSearch] = useState("");
  const [anbimaResult, setAnbimaResult] = useState<any>(null);
  const [anbimaLoading, setAnbimaLoading] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createInitialData, setCreateInitialData] = useState<{ nome?: string; cnpj?: string; categoria?: string } | undefined>(undefined);

  const { data: settingsData } = useQuery<any>({ queryKey: ["/api/norion/settings"] });

  const buscarCVM = async () => {
    const clean = cvmCnpj.replace(/\D/g, "");
    if (clean.length < 14) { setCvmError("CNPJ inválido"); return; }
    setCvmLoading(true); setCvmError(null); setCvmResult(null);
    try {
      const res = await fetch(`/api/norion/fundo/${clean}`);
      if (!res.ok) { setCvmError((await res.json()).message || "Não encontrado"); } else { setCvmResult(await res.json()); }
    } catch { setCvmError("Erro de conexão"); } finally { setCvmLoading(false); }
  };

  const buscarANBIMA = async () => {
    setAnbimaLoading(true); setAnbimaResult(null);
    try {
      const res = await fetch(`/api/norion/fundos-estruturados`);
      if (!res.ok) { toast({ title: "Erro", variant: "destructive" }); return; }
      setAnbimaResult(await res.json());
    } catch { toast({ title: "Erro ao buscar", variant: "destructive" }); } finally { setAnbimaLoading(false); }
  };

  const anbimaFiltered = (anbimaResult?.fundos || []).filter((f: any) => {
    if (anbimaType && anbimaType !== "all") {
      const cat = (f.categoria || "").toLowerCase();
      if (anbimaType === "renda_fixa" && !cat.includes("renda fixa")) return false;
      if (anbimaType === "acoes" && !cat.includes("ações")) return false;
      if (anbimaType === "multimercados" && !cat.includes("multimercado")) return false;
      if (anbimaType === "previdencia" && !cat.includes("previdência")) return false;
      if (anbimaType === "cambial" && !cat.includes("cambial")) return false;
    }
    if (anbimaSearch.trim()) {
      const q = anbimaSearch.toLowerCase();
      if (!f.nome?.toLowerCase().includes(q) && !f.cnpj?.includes(q)) return false;
    }
    return true;
  });

  const openCreateFromCVM = () => {
    setCreateInitialData({
      nome: cvmResult?.nome || "",
      cnpj: cvmResult?.cnpj || "",
      categoria: cvmResult?.tipo || "",
    });
    setShowCreateDialog(true);
  };

  const openCreateFromANBIMA = (fundo: any) => {
    setCreateInitialData({
      nome: fundo.nome || "",
      cnpj: fundo.cnpj || "",
      categoria: fundo.categoria || "",
    });
    setShowCreateDialog(true);
  };

  const handleCloseDialog = () => {
    setShowCreateDialog(false);
    setCreateInitialData(undefined);
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Landmark className="w-7 h-7 text-amber-500" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-norion-consulta-title">Consulta de Fundos</h1>
          <p className="text-sm text-muted-foreground">Pesquisar fundos na CVM e ANBIMA</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Landmark className="w-4 h-4" />Consulta CVM (Pública)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Input placeholder="CNPJ do fundo" value={cvmCnpj} onChange={(e) => { setCvmCnpj(e.target.value); setCvmError(null); }}
              onKeyDown={(e) => e.key === "Enter" && buscarCVM()} className="max-w-xs font-mono" data-testid="input-n-cvm-cnpj" />
            <Button onClick={buscarCVM} disabled={cvmLoading} data-testid="button-n-buscar-cvm">
              {cvmLoading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Search className="w-4 h-4 mr-1.5" />}Consultar
            </Button>
          </div>
          {cvmError && <div className="flex items-center gap-2 text-sm text-destructive"><AlertTriangle className="w-4 h-4" />{cvmError}</div>}
          {cvmResult && (
            <div className="border rounded-md p-4 bg-muted/20 space-y-3" data-testid="n-cvm-result">
              <p className="font-semibold">{cvmResult.nome}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Tipo</p><p>{cvmResult.tipo || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">CNPJ</p><p className="font-mono text-xs">{cvmResult.cnpj}</p></div>
                <div><p className="text-xs text-muted-foreground">Situação</p><p>{cvmResult.situacao || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Administrador</p><p>{cvmResult.administrador || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Gestor</p><p>{cvmResult.gestor || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Data Constituição</p><p>{cvmResult.dataConstituicao || "—"}</p></div>
              </div>
              <Button onClick={openCreateFromCVM} data-testid="button-cvm-cadastrar-parceiro">
                <Handshake className="w-4 h-4 mr-1.5" />Cadastrar como Parceiro
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" />Fundos Estruturados ANBIMA</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Select value={anbimaType} onValueChange={setAnbimaType}>
              <SelectTrigger className="w-40" data-testid="select-n-anbima-tipo"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="renda_fixa">Renda Fixa</SelectItem>
                <SelectItem value="acoes">Ações</SelectItem>
                <SelectItem value="multimercados">Multimercados</SelectItem>
                <SelectItem value="previdencia">Previdência</SelectItem>
                <SelectItem value="cambial">Cambial</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={buscarANBIMA} disabled={anbimaLoading || !settingsData?.configured} data-testid="button-n-buscar-anbima">
              {anbimaLoading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Search className="w-4 h-4 mr-1.5" />}Buscar
            </Button>
            {anbimaResult?.fundos?.length > 0 && (
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input placeholder="Filtrar por nome..." value={anbimaSearch} onChange={(e) => setAnbimaSearch(e.target.value)} className="pl-8" />
              </div>
            )}
          </div>
          {!settingsData?.configured && (
            <div className="border border-amber-200 rounded-md p-4 bg-amber-50/50">
              <div className="flex items-center gap-2 text-amber-700"><AlertTriangle className="w-4 h-4" /><p className="text-sm font-medium">ANBIMA não configurada</p></div>
              <p className="text-xs text-muted-foreground mt-1">Configure as credenciais na página de Configurações.</p>
            </div>
          )}
          {anbimaLoading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}
          {anbimaResult?.configured && !anbimaLoading && (
            anbimaFiltered.length > 0 ? (
              <>
                <p className="text-xs text-muted-foreground mb-2">{anbimaFiltered.length} fundo(s) encontrado(s)</p>
                <Card>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Categoria</TableHead>
                        <TableHead>CNPJ</TableHead>
                        <TableHead>Situação</TableHead>
                        <TableHead className="text-center">Ação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {anbimaFiltered.slice(0, 100).map((f: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium max-w-[280px] truncate">{f.nome || "—"}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{f.tipo || "—"}</Badge></TableCell>
                          <TableCell className="text-sm">{f.categoria || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{f.cnpj || "—"}</TableCell>
                          <TableCell><Badge variant={f.situacao === "Ativo" ? "default" : "secondary"} className="text-xs">{f.situacao || "—"}</Badge></TableCell>
                          <TableCell className="text-center">
                            <Button size="icon" variant="ghost" onClick={() => openCreateFromANBIMA(f)} data-testid={`button-anbima-add-${i}`}>
                              <Plus className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhum fundo encontrado</p>
            )
          )}
        </CardContent>
      </Card>

      <CreateFundoDialog open={showCreateDialog} onClose={handleCloseDialog} initialData={createInitialData} />
    </div>
  );
}
