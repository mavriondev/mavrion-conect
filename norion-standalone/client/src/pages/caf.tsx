import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Leaf, Plus, Search, Upload, Download, Trash2,
  Users, MapPin, Filter, CheckCircle, XCircle, AlertTriangle, ExternalLink, FileText,
} from "lucide-react";
import type { NorionCafRegistro } from "@shared/schema";

const UF_LIST = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA",
  "PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

const GRUPO_OPTIONS = [
  { value: "A", label: "Grupo A" },
  { value: "A/C", label: "Grupo A/C" },
  { value: "B", label: "Grupo B" },
  { value: "V", label: "Grupo V" },
];

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ativo") return <Badge className="bg-green-100 text-green-700 border-green-300" data-testid="badge-status-ativo"><CheckCircle className="w-3 h-3 mr-1" />Ativo</Badge>;
  if (status === "vencido") return <Badge className="bg-red-100 text-red-700 border-red-300" data-testid="badge-status-vencido"><XCircle className="w-3 h-3 mr-1" />Vencido</Badge>;
  return <Badge variant="outline" data-testid="badge-status-pendente"><AlertTriangle className="w-3 h-3 mr-1" />Pendente</Badge>;
}

export default function NorionCafPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [filterGrupo, setFilterGrupo] = useState<string>("");
  const [filterUf, setFilterUf] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterAreaMin, setFilterAreaMin] = useState<string>("");
  const [filterAreaMax, setFilterAreaMax] = useState<string>("");

  const queryParams = new URLSearchParams();
  if (filterGrupo) queryParams.set("grupo", filterGrupo);
  if (filterUf) queryParams.set("uf", filterUf);
  if (filterStatus) queryParams.set("status", filterStatus);
  if (filterAreaMin.trim()) queryParams.set("areaMin", filterAreaMin.trim());
  if (filterAreaMax.trim()) queryParams.set("areaMax", filterAreaMax.trim());
  if (search.trim()) queryParams.set("search", search.trim());
  const qs = queryParams.toString();

  const { data: registros = [], isLoading } = useQuery<NorionCafRegistro[]>({
    queryKey: ["/api/norion/caf", qs],
    queryFn: () => fetch(`/api/norion/caf${qs ? `?${qs}` : ""}`).then(r => r.json()),
  });

  const { data: stats } = useQuery<any>({
    queryKey: ["/api/norion/caf/stats"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/norion/caf/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/caf"] });
      queryClient.invalidateQueries({ queryKey: ["/api/norion/caf/stats"] });
      toast({ title: "Registro excluído" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-100 rounded-lg">
            <Leaf className="w-6 h-6 text-green-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="title-caf">CAF - Agricultura Familiar</h1>
            <p className="text-sm text-muted-foreground">Cadastro Nacional da Agricultura Familiar e PRONAF</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.open("https://caf.mda.gov.br/", "_blank")} data-testid="button-portal-caf">
            <ExternalLink className="w-4 h-4 mr-1" /> Portal CAF
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.open("https://dap.mda.gov.br/", "_blank")} data-testid="button-portal-dap">
            <FileText className="w-4 h-4 mr-1" /> Portal DAP
          </Button>
          <Button variant="outline" size="sm" onClick={() => setLocation("/caf/importar")} data-testid="button-importar-csv">
            <Upload className="w-4 h-4 mr-1" /> Importar CSV
          </Button>
          <Button onClick={() => setLocation("/caf/novo")} data-testid="button-novo-caf">
            <Plus className="w-4 h-4 mr-1" /> Novo Registro
          </Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground">Total Registros</div>
              <div className="text-2xl font-bold" data-testid="stat-total">{stats.total || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground">CAF Ativos</div>
              <div className="text-2xl font-bold text-green-600" data-testid="stat-ativos">{stats.ativos || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground">Vencidos</div>
              <div className="text-2xl font-bold text-red-500" data-testid="stat-vencidos">{stats.vencidos || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground">Área Total (ha)</div>
              <div className="text-2xl font-bold" data-testid="stat-area">{(stats.totalArea || 0).toLocaleString("pt-BR")}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground">Renda Bruta Total</div>
              <div className="text-xl font-bold" data-testid="stat-renda">{formatCurrency(stats.totalRenda || 0)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4" /> Registros CAF
              <Badge variant="outline">{registros.length}</Badge>
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open("/api/norion/caf/exportar-csv", "_blank")}
              disabled={registros.length === 0}
              data-testid="button-exportar-caf-csv"
            >
              <Download className="w-4 h-4 mr-1" /> Baixar CSV
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, CPF, CAF ou município..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-caf"
              />
            </div>
            <Select value={filterGrupo} onValueChange={(v) => setFilterGrupo(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[140px]" data-testid="filter-grupo">
                <Filter className="w-3 h-3 mr-1" /><SelectValue placeholder="Grupo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {GRUPO_OPTIONS.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterUf} onValueChange={(v) => setFilterUf(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[100px]" data-testid="filter-uf">
                <MapPin className="w-3 h-3 mr-1" /><SelectValue placeholder="UF" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {UF_LIST.map(uf => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[120px]" data-testid="filter-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="ativo">Ativo</SelectItem>
                <SelectItem value="vencido">Vencido</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                placeholder="ha mín"
                className="w-[90px]"
                value={filterAreaMin}
                onChange={(e) => setFilterAreaMin(e.target.value)}
                data-testid="filter-area-min"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <Input
                type="number"
                placeholder="ha máx"
                className="w-[90px]"
                value={filterAreaMax}
                onChange={(e) => setFilterAreaMax(e.target.value)}
                data-testid="filter-area-max"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Titular</TableHead>
                <TableHead>CPF</TableHead>
                <TableHead>Nº CAF/DAP</TableHead>
                <TableHead>Grupo</TableHead>
                <TableHead>Município/UF</TableHead>
                <TableHead>Área (ha)</TableHead>
                <TableHead>Renda Bruta</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Validade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : registros.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  Nenhum registro encontrado. Clique em "Novo Registro" ou "Importar CSV" para começar.
                </TableCell></TableRow>
              ) : registros.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setLocation(`/caf/${r.id}`)}
                  data-testid={`row-caf-${r.id}`}
                >
                  <TableCell className="font-medium" data-testid={`text-nome-${r.id}`}>{r.nomeTitular}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.cpfTitular || "—"}</TableCell>
                  <TableCell className="text-sm">{r.numeroCAF || r.numeroDAPAntigo || "—"}</TableCell>
                  <TableCell>
                    {r.grupo ? <Badge variant="outline" className="text-xs">{r.grupo}</Badge> : "—"}
                  </TableCell>
                  <TableCell className="text-sm">{[r.municipio, r.uf].filter(Boolean).join("/") || "—"}</TableCell>
                  <TableCell className="text-sm">{r.areaHa ? `${r.areaHa.toLocaleString("pt-BR")} ha` : "—"}</TableCell>
                  <TableCell className="text-sm">{r.rendaBrutaAnual ? formatCurrency(r.rendaBrutaAnual) : "—"}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-sm">{r.validade || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
