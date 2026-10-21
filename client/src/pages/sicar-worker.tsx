import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Play, Square, RefreshCcw, Mountain, Thermometer, Droplets,
  TrendingUp, Ruler, MapPin, ChevronLeft, ChevronRight, Activity,
  ArrowUpDown, Timer,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const API_BASE = "/api/sicar-worker";
const PAGE_SIZE = 50;

interface WorkerStatus {
  worker: {
    processed: number;
    errors: number;
    total: number;
    startedAt: string | null;
    lastBatchAt: string | null;
    status: string;
    isRunning: boolean;
    eta: string | null;
    rate: number;
  };
  database: {
    pending: number;
    completed: number;
    errors: number;
  };
}

interface UfStats {
  uf: string;
  total: string;
  alt_media_avg: string;
  alt_min_global: string;
  alt_max_global: string;
  decliv_avg: string | null;
  temp_avg: string | null;
  precip_avg: string | null;
  perim_avg: string | null;
}

interface PropertyRow {
  id: number;
  cod_imovel: string;
  uf: string;
  municipio: string;
  num_area: string;
  ind_status: string;
  alt_media: number;
  alt_min: number;
  alt_max: number;
  centroid_lat: number | null;
  centroid_lon: number | null;
  perimetro_km: number | null;
  declividade: number | null;
  temp_media: number | null;
  precip_anual: number | null;
}

export default function SicarWorkerPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [data, setData] = useState<PropertyRow[]>([]);
  const [byUf, setByUf] = useState<UfStats[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState("alt_media");
  const [order, setOrder] = useState("desc");
  const [filterUf, setFilterUf] = useState("");
  const [filterAltMin, setFilterAltMin] = useState("");
  const [filterAltMax, setFilterAltMax] = useState("");
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(API_BASE + "/status");
      if (res.ok) {
        const d = await res.json();
        setStatus(d);
      }
    } catch {}
  }, []);

  const fetchData = useCallback(async () => {
    try {
      let url = API_BASE + "/data?limit=" + PAGE_SIZE + "&offset=" + offset + "&sort=" + sort + "&order=" + order;
      if (filterUf) url += "&uf=" + filterUf;
      if (filterAltMin) url += "&alt_min=" + filterAltMin;
      if (filterAltMax) url += "&alt_max=" + filterAltMax;
      const res = await fetch(url);
      if (res.ok) {
        const d = await res.json();
        setData(d.data || []);
        setTotal(d.total || 0);
        if (d.byUf) setByUf(d.byUf);
      }
    } catch {}
    setLoading(false);
  }, [offset, sort, order, filterUf, filterAltMin, filterAltMax]);

  useEffect(() => { fetchStatus(); fetchData(); }, [fetchStatus, fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const iv = setInterval(fetchStatus, 10000);
    return () => clearInterval(iv);
  }, [autoRefresh, fetchStatus]);

  const doAction = async (action: "start" | "stop") => {
    setActionLoading(true);
    try {
      await apiRequest("POST", API_BASE + "/" + action);
      toast({ title: action === "start" ? "Worker iniciado" : "Worker parado" });
      setTimeout(() => { fetchStatus(); fetchData(); }, 1500);
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
    setActionLoading(false);
  };

  const handleSort = (col: string) => {
    if (sort === col) { setOrder(order === "desc" ? "asc" : "desc"); }
    else { setSort(col); setOrder("desc"); }
    setOffset(0);
  };

  const handleFilter = () => { setOffset(0); fetchData(); };

  const fmt = (n: number) => n.toLocaleString("pt-BR");
  const nv = (v: number | null | undefined, suffix: string) =>
    v !== null && v !== undefined ? v + suffix : "—";

  const db = status?.database;
  const w = status?.worker;
  const totalProp = db ? db.completed + db.pending : 0;
  const pct = totalProp > 0 ? (db!.completed / totalProp) * 100 : 0;

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto" data-testid="sicar-worker-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="page-title">
            <Activity className="w-6 h-6 text-green-500" />
            Enrichment Worker — SICAR
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Altitude, centroide, perimetro, declividade e clima para imoveis SICAR
          </p>
        </div>
        {w && (
          <Badge
            data-testid="worker-status-badge"
            variant={w.status === "running" ? "default" : w.status === "completed" ? "secondary" : "outline"}
            className={
              w.status === "running" ? "bg-green-600 hover:bg-green-700 text-white" :
              w.status === "completed" ? "bg-blue-600 hover:bg-blue-700 text-white" :
              w.status === "idle" ? "bg-yellow-600 hover:bg-yellow-700 text-white" :
              "bg-red-600 hover:bg-red-700 text-white"
            }
          >
            {w.status.toUpperCase()}
          </Badge>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-sm uppercase text-muted-foreground tracking-wide">Progresso Geral</h3>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded"
                  data-testid="auto-refresh-toggle"
                />
                Auto-refresh 10s
              </label>
            </div>
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-muted-foreground">Processados</span>
              <span className="font-mono font-semibold" data-testid="progress-pct">{pct.toFixed(3)}%</span>
            </div>
            <Progress value={pct} className="h-3" data-testid="progress-bar" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard icon={<Mountain className="w-4 h-4 text-green-500" />} label="Processados" value={db ? fmt(db.completed) : "—"} color="text-green-600" testId="stat-processed" />
            <StatCard icon={<Timer className="w-4 h-4 text-muted-foreground" />} label="Pendentes" value={db ? fmt(db.pending) : "—"} testId="stat-pending" />
            <StatCard icon={<Activity className="w-4 h-4 text-red-500" />} label="Erros" value={db ? fmt(db.errors) : "—"} color={db && db.errors > 0 ? "text-red-600" : undefined} testId="stat-errors" />
            <StatCard icon={<TrendingUp className="w-4 h-4 text-blue-500" />} label="Velocidade" value={w && w.rate > 0 ? w.rate + "/min" : "—"} testId="stat-rate" />
            <StatCard icon={<Timer className="w-4 h-4 text-purple-500" />} label="ETA" value={w?.eta || "—"} testId="stat-eta" />
            <StatCard icon={<Activity className="w-4 h-4 text-cyan-500" />} label="Status" value={w ? w.status.charAt(0).toUpperCase() + w.status.slice(1) : "—"} color={w?.status === "running" ? "text-green-600" : w?.status === "idle" ? "text-yellow-600" : undefined} testId="stat-status" />
          </div>

          <div className="flex gap-3 mt-4">
            <Button
              onClick={() => doAction("start")}
              disabled={actionLoading || (w?.isRunning ?? false)}
              className="bg-green-600 hover:bg-green-700 text-white"
              data-testid="btn-start"
            >
              <Play className="w-4 h-4 mr-1" /> Iniciar
            </Button>
            <Button
              onClick={() => doAction("stop")}
              disabled={actionLoading || !(w?.isRunning ?? false)}
              variant="destructive"
              data-testid="btn-stop"
            >
              <Square className="w-4 h-4 mr-1" /> Parar
            </Button>
            <Button
              onClick={() => { fetchStatus(); fetchData(); }}
              variant="outline"
              data-testid="btn-refresh"
            >
              <RefreshCcw className="w-4 h-4 mr-1" /> Atualizar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Tabs defaultValue="imoveis">
            <TabsList data-testid="tabs">
              <TabsTrigger value="imoveis" data-testid="tab-imoveis">Imóveis Processados</TabsTrigger>
              <TabsTrigger value="estados" data-testid="tab-estados">Por Estado (UF)</TabsTrigger>
            </TabsList>

            <TabsContent value="imoveis" className="mt-4">
              <div className="flex flex-wrap items-end gap-3 mb-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">UF</label>
                  <Select value={filterUf || "all"} onValueChange={(v) => setFilterUf(v === "all" ? "" : v)} data-testid="filter-uf">
                    <SelectTrigger className="w-[120px]" data-testid="filter-uf-trigger">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {byUf.map(u => (
                        <SelectItem key={u.uf} value={u.uf}>{u.uf} ({Number(u.total).toLocaleString("pt-BR")})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Alt. min</label>
                  <Input type="number" value={filterAltMin} onChange={e => setFilterAltMin(e.target.value)} className="w-[80px]" placeholder="0" data-testid="filter-alt-min" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Alt. max</label>
                  <Input type="number" value={filterAltMax} onChange={e => setFilterAltMax(e.target.value)} className="w-[80px]" placeholder="9999" data-testid="filter-alt-max" />
                </div>
                <Button onClick={handleFilter} variant="outline" size="sm" data-testid="btn-filter">Filtrar</Button>
              </div>

              {loading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <SortHead label="Cod. Imóvel" col="cod_imovel" sort={sort} order={order} onClick={handleSort} />
                          <TableHead>Município</TableHead>
                          <TableHead>UF</TableHead>
                          <SortHead label="Área(ha)" col="num_area" sort={sort} order={order} onClick={handleSort} />
                          <SortHead label="Alt.Méd" col="alt_media" sort={sort} order={order} onClick={handleSort} />
                          <SortHead label="Alt.Min" col="alt_min" sort={sort} order={order} onClick={handleSort} />
                          <SortHead label="Alt.Max" col="alt_max" sort={sort} order={order} onClick={handleSort} />
                          <SortHead label="Decliv%" col="declividade" sort={sort} order={order} onClick={handleSort} />
                          <SortHead label="Perím.km" col="perimetro_km" sort={sort} order={order} onClick={handleSort} />
                          <SortHead label="Temp°C" col="temp_media" sort={sort} order={order} onClick={handleSort} />
                          <SortHead label="Precip.mm" col="precip_anual" sort={sort} order={order} onClick={handleSort} />
                          <TableHead>Lat</TableHead>
                          <TableHead>Lon</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.length === 0 ? (
                          <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-8">Nenhum dado encontrado</TableCell></TableRow>
                        ) : data.map((r) => (
                          <TableRow key={r.id} data-testid={"row-property-" + r.id}>
                            <TableCell className="font-mono text-xs">{r.cod_imovel}</TableCell>
                            <TableCell className="text-sm">{r.municipio || "—"}</TableCell>
                            <TableCell className="font-semibold">{r.uf}</TableCell>
                            <TableCell className="text-right">{r.num_area ? Number(r.num_area).toLocaleString("pt-BR") : "—"}</TableCell>
                            <TableCell className="text-right font-semibold text-green-600">{nv(r.alt_media, "m")}</TableCell>
                            <TableCell className="text-right text-blue-600">{nv(r.alt_min, "m")}</TableCell>
                            <TableCell className="text-right text-orange-500">{nv(r.alt_max, "m")}</TableCell>
                            <TableCell className="text-right text-purple-600">{nv(r.declividade, "%")}</TableCell>
                            <TableCell className="text-right text-cyan-600">{nv(r.perimetro_km, "")}</TableCell>
                            <TableCell className="text-right text-yellow-600">{nv(r.temp_media, "°")}</TableCell>
                            <TableCell className="text-right text-sky-500">{nv(r.precip_anual, "")}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{r.centroid_lat?.toFixed(4) ?? "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{r.centroid_lon?.toFixed(4) ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-sm text-muted-foreground" data-testid="pagination-info">
                      {total > 0 ? `${fmt(offset + 1)}–${fmt(Math.min(offset + PAGE_SIZE, total))} de ${fmt(total)}` : "0 resultados"}
                    </span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} data-testid="btn-prev">
                        <ChevronLeft className="w-4 h-4" /> Anterior
                      </Button>
                      <Button size="sm" variant="outline" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)} data-testid="btn-next">
                        Próximo <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="estados" className="mt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {byUf.map(u => (
                  <Card
                    key={u.uf}
                    className="cursor-pointer hover:ring-2 hover:ring-green-500/50 transition-all"
                    onClick={() => { setFilterUf(u.uf); setOffset(0); }}
                    data-testid={"uf-card-" + u.uf}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-lg">{u.uf}</span>
                        <Badge variant="secondary" className="font-mono">{Number(u.total).toLocaleString("pt-BR")}</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span><Mountain className="w-3 h-3 inline mr-1" />Alt. média: <strong className="text-foreground">{u.alt_media_avg}m</strong></span>
                        <span><TrendingUp className="w-3 h-3 inline mr-1" />Decliv: <strong className="text-foreground">{u.decliv_avg ?? "—"}%</strong></span>
                        <span><Thermometer className="w-3 h-3 inline mr-1" />Temp: <strong className="text-foreground">{u.temp_avg ?? "—"}°C</strong></span>
                        <span><Droplets className="w-3 h-3 inline mr-1" />Precip: <strong className="text-foreground">{u.precip_avg ?? "—"}mm</strong></span>
                        <span><Ruler className="w-3 h-3 inline mr-1" />Perím: <strong className="text-foreground">{u.perim_avg ?? "—"}km</strong></span>
                        <span><MapPin className="w-3 h-3 inline mr-1" />Alt: {u.alt_min_global}–{u.alt_max_global}m</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, color, testId }: { icon: React.ReactNode; label: string; value: string; color?: string; testId: string }) {
  return (
    <div className="bg-muted/50 rounded-lg p-3 border" data-testid={testId}>
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <span className={"text-xl font-bold " + (color || "")}>{value}</span>
    </div>
  );
}

function SortHead({ label, col, sort, order, onClick }: { label: string; col: string; sort: string; order: string; onClick: (col: string) => void }) {
  return (
    <TableHead className="cursor-pointer hover:text-foreground select-none whitespace-nowrap" onClick={() => onClick(col)}>
      <span className="flex items-center gap-1">
        {label}
        {sort === col && <ArrowUpDown className="w-3 h-3" />}
      </span>
    </TableHead>
  );
}
