import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  X, ExternalLink, Layers, Building2, Maximize2, Minimize2,
  Zap, Lock, Info, SlidersHorizontal, Filter, ZoomIn, ZoomOut, RotateCcw,
  ArrowRight, TrendingUp, DollarSign, MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TIPO_CONFIG: Record<string, { color: string; bg: string; label: string; icon: string }> = {
  TERRA:           { color: "#16a34a", bg: "#dcfce7", label: "TERRA",  icon: "🌿" },
  MINA:            { color: "#ea580c", bg: "#ffedd5", label: "MINA",   icon: "⛏" },
  NEGOCIO:         { color: "#2563eb", bg: "#dbeafe", label: "M&A",    icon: "💼" },
  FII_CRI:         { color: "#9333ea", bg: "#f3e8ff", label: "FII",    icon: "🏢" },
  DESENVOLVIMENTO: { color: "#db2777", bg: "#fce7f3", label: "DESENV", icon: "🏗" },
  AGRO:            { color: "#ca8a04", bg: "#fef9c3", label: "AGRO",   icon: "🌾" },
  ENERGIA:         { color: "#0891b2", bg: "#cffafe", label: "ENERGIA",icon: "⚡" },
};

const ESTADOS_BR = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS",
  "MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"
];

function truncate(s: string, n: number) {
  return s && s.length > n ? s.substring(0, n) + "…" : (s || "");
}

function formatCurrency(v: number) {
  if (!v) return "";
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}k`;
  return `R$ ${v.toLocaleString("pt-BR")}`;
}

interface GraphNode {
  id: string;
  rawId: number;
  label: string;
  nodeType: "ativo" | "financeiro" | "estrategico";
  tipo?: string;
  estado?: string;
  preco?: number;
  status?: string;
  emNegociacao?: boolean;
  exclusivo?: boolean;
  buyerType?: string;
  regioes?: string[];
  ticketMin?: number;
  empresaId?: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  tipo: "deal" | "match";
  label: string;
  score: number;
  dealId?: number;
}

const FILTROS_DEFAULT = {
  tipoAtivo: "all",
  statusAtivo: "all",
  estado: "all",
  tipoBuyer: "all",
  dealId: "all",
  scoreMin: 0,
  apenasNegociacao: false,
  apenasExclusivos: false,
  apenasComDeal: false,
  apenasComMatch: false,
};

function FilterPanel({
  filtros, setFiltros, deals, ativos, onClose
}: {
  filtros: any; setFiltros: (f: any) => void;
  deals: any[]; ativos: any[]; onClose: () => void;
}) {
  const set = (key: string, val: any) => setFiltros((f: any) => ({ ...f, [key]: val }));
  const estadosDisponiveis = useMemo(() => {
    const s = new Set<string>();
    ativos.forEach(a => { if (a.estado) s.add(a.estado); });
    return Array.from(s).sort();
  }, [ativos]);

  return (
    <div className="absolute top-0 left-0 bottom-0 w-72 bg-background border-r shadow-xl z-30 overflow-y-auto animate-in slide-in-from-left-4 duration-200">
      <div className="p-4 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4" /> Filtros
          </h3>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose} data-testid="button-close-filters">
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tipo de ativo</Label>
          <Select value={filtros.tipoAtivo} onValueChange={v => set("tipoAtivo", v)}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-tipo-ativo"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              {Object.entries(TIPO_CONFIG).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.icon} {v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status do ativo</Label>
          <Select value={filtros.statusAtivo} onValueChange={v => set("statusAtivo", v)}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-status-ativo"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="ativo">Ativo</SelectItem>
              <SelectItem value="negociacao">Em negociação</SelectItem>
              <SelectItem value="rascunho">Rascunho</SelectItem>
              <SelectItem value="fechado">Fechado</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Estado</Label>
          <Select value={filtros.estado} onValueChange={v => set("estado", v)}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-estado"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os estados</SelectItem>
              {estadosDisponiveis.map(e => (<SelectItem key={e} value={e}>{e}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tipo de comprador</Label>
          <Select value={filtros.tipoBuyer} onValueChange={v => set("tipoBuyer", v)}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-tipo-buyer"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="financeiro">◯ Investidor financeiro</SelectItem>
              <SelectItem value="estrategico">◇ Comprador estratégico</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Negociação específica</Label>
          <Select value={filtros.dealId} onValueChange={v => set("dealId", v)}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-deal">
              <SelectValue placeholder="Selecionar deal..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as negociações</SelectItem>
              {deals.map((d: any) => (
                <SelectItem key={d.id} value={String(d.id)}>{truncate(d.title || `Deal #${d.id}`, 30)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Score mínimo: <span className="text-primary font-bold">{filtros.scoreMin}</span>
          </Label>
          <Slider min={0} max={100} step={5} value={[filtros.scoreMin]}
            onValueChange={([v]) => set("scoreMin", v)} className="w-full" data-testid="slider-score" />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>0 — mostrar tudo</span><span>100 — só perfeitos</span>
          </div>
        </div>

        <div className="space-y-3 pt-1">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mostrar apenas</Label>
          {[
            { key: "apenasNegociacao", label: "Em negociação" },
            { key: "apenasExclusivos", label: "Em exclusividade" },
            { key: "apenasComDeal", label: "Com deal aberto" },
            { key: "apenasComMatch", label: "Com match pendente" },
          ].map(item => (
            <div key={item.key} className="flex items-center justify-between">
              <Label className="text-xs cursor-pointer">{item.label}</Label>
              <Switch checked={filtros[item.key]} onCheckedChange={v => set(item.key, v)} data-testid={`switch-${item.key}`} />
            </div>
          ))}
        </div>

        <Button variant="outline" size="sm" className="w-full text-xs"
          onClick={() => setFiltros(FILTROS_DEFAULT)} data-testid="button-limpar-filtros">
          <X className="w-3.5 h-3.5 mr-1.5" /> Limpar todos os filtros
        </Button>
      </div>
    </div>
  );
}

function DetailPanel({ node, edges, allNodes, onClose, navigate, onFocusNode }: {
  node: GraphNode; edges: GraphEdge[]; allNodes: GraphNode[];
  onClose: () => void; navigate: (p: string) => void;
  onFocusNode: (id: string) => void;
}) {
  const connectedEdges = edges.filter(e => e.source === node.id || e.target === node.id);
  const connectedNodes = connectedEdges.map(e => {
    const otherId = e.source === node.id ? e.target : e.source;
    return { edge: e, node: allNodes.find(n => n.id === otherId) };
  }).filter(c => c.node);

  const dealCount = connectedEdges.filter(e => e.tipo === "deal").length;
  const matchCount = connectedEdges.filter(e => e.tipo === "match").length;

  return (
    <div className="absolute top-4 right-4 w-80 z-20 animate-in slide-in-from-right-4 duration-200">
      <Card className="shadow-2xl border-primary/20 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <Badge variant="outline" className="text-xs mb-1.5" data-testid="badge-node-type"
                style={{
                  borderColor: node.nodeType === "ativo"
                    ? (TIPO_CONFIG[node.tipo || ""]?.color || "#16a34a")
                    : node.nodeType === "estrategico" ? "#6366f1" : "#10b981",
                  color: node.nodeType === "ativo"
                    ? (TIPO_CONFIG[node.tipo || ""]?.color || "#16a34a")
                    : node.nodeType === "estrategico" ? "#6366f1" : "#10b981",
                }}>
                {node.nodeType === "ativo" ? `${TIPO_CONFIG[node.tipo || ""]?.icon || ""} Ativo`
                  : node.nodeType === "estrategico" ? "◇ Comprador Estratégico"
                  : "◯ Investidor Financeiro"}
              </Badge>
              <CardTitle className="text-sm leading-snug">{node.label}</CardTitle>
            </div>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={onClose} data-testid="button-close-detail">
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {node.nodeType === "ativo" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {node.tipo && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground text-[10px] uppercase">Tipo</span>
                    <span className="font-medium">{TIPO_CONFIG[node.tipo]?.label || node.tipo}</span>
                  </div>
                )}
                {node.estado && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground text-[10px] uppercase">Estado</span>
                    <span className="font-medium">{node.estado}</span>
                  </div>
                )}
                {node.preco && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground text-[10px] uppercase">Preço</span>
                    <span className="font-bold text-emerald-600">{formatCurrency(node.preco)}</span>
                  </div>
                )}
                {node.status && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground text-[10px] uppercase">Status</span>
                    <span className="font-medium capitalize">{node.status}</span>
                  </div>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                {node.emNegociacao && (
                  <Badge className="bg-blue-600 text-white text-[10px] gap-1 h-5">
                    <Zap className="w-2.5 h-2.5" /> Em negociação
                  </Badge>
                )}
                {node.exclusivo && (
                  <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px] gap-1 h-5">
                    <Lock className="w-2.5 h-2.5" /> Exclusivo
                  </Badge>
                )}
              </div>
              <Button size="sm" className="w-full h-7 text-xs gap-1"
                onClick={() => navigate(`/ativos/${node.rawId}`)} data-testid="button-ver-ativo">
                <ExternalLink className="w-3 h-3" /> Ver ativo completo
              </Button>
            </>
          )}
          {node.nodeType !== "ativo" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {node.regioes && node.regioes.length > 0 && (
                  <div className="flex flex-col gap-0.5 col-span-2">
                    <span className="text-muted-foreground text-[10px] uppercase">Regiões</span>
                    <div className="flex gap-1 flex-wrap">
                      {node.regioes.map(r => (
                        <Badge key={r} variant="outline" className="text-[10px] h-4 px-1.5">{r}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {node.ticketMin && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground text-[10px] uppercase">Ticket mín.</span>
                    <span className="font-medium">{formatCurrency(node.ticketMin)}</span>
                  </div>
                )}
              </div>
              {node.empresaId && (
                <Button size="sm" className="w-full h-7 text-xs gap-1"
                  onClick={() => navigate(`/empresas/${node.empresaId}`)} data-testid="button-ver-empresa">
                  <ExternalLink className="w-3 h-3" /> Ver empresa
                </Button>
              )}
            </>
          )}

          {connectedNodes.length > 0 && (
            <div className="border-t pt-3 space-y-2">
              <div className="flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">
                  Conexões ({connectedNodes.length})
                </span>
                {dealCount > 0 && <Badge className="bg-emerald-100 text-emerald-700 text-[10px] h-4 px-1.5">{dealCount} deals</Badge>}
                {matchCount > 0 && <Badge className="bg-amber-100 text-amber-700 text-[10px] h-4 px-1.5">{matchCount} matches</Badge>}
              </div>
              <ScrollArea className="max-h-40">
                <div className="space-y-1.5">
                  {connectedNodes.map(({ edge, node: cn }) => {
                    if (!cn) return null;
                    const config = cn.nodeType === "ativo" ? TIPO_CONFIG[cn.tipo || ""] : null;
                    return (
                      <button
                        key={edge.id}
                        className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-muted/60 transition-colors text-left group"
                        onClick={() => onFocusNode(cn.id)}
                        data-testid={`connection-${cn.id}`}
                      >
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] shrink-0"
                          style={{
                            background: cn.nodeType === "ativo"
                              ? (config?.color || "#16a34a")
                              : cn.nodeType === "estrategico" ? "#6366f1" : "#10b981"
                          }}>
                          {cn.nodeType === "ativo" ? (config?.icon || "📦") : cn.nodeType === "estrategico" ? "◇" : "◯"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{cn.label}</div>
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            {edge.tipo === "deal" ? (
                              <span className="text-emerald-600 font-medium">Deal</span>
                            ) : (
                              <span className="text-amber-600 font-medium">Match {edge.score}%</span>
                            )}
                            {cn.nodeType === "ativo" && cn.estado && <span>· {cn.estado}</span>}
                          </div>
                        </div>
                        <ArrowRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function useForceSimulation(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number
) {
  const nodesRef = useRef<GraphNode[]>([]);
  const [tick, setTick] = useState(0);
  const animRef = useRef<number | null>(null);
  const coolingRef = useRef(1);

  useEffect(() => {
    const existing = new Map(nodesRef.current.map(n => [n.id, n]));
    nodesRef.current = nodes.map(n => {
      const prev = existing.get(n.id);
      if (prev) {
        return { ...n, x: prev.x, y: prev.y, vx: prev.vx, vy: prev.vy, fx: prev.fx, fy: prev.fy };
      }
      const isAtivo = n.nodeType === "ativo";
      return {
        ...n,
        x: (isAtivo ? width * 0.25 : width * 0.75) + (Math.random() - 0.5) * width * 0.3,
        y: height * 0.2 + Math.random() * height * 0.6,
        vx: 0, vy: 0,
      };
    });
    coolingRef.current = 1;
  }, [nodes, width, height]);

  useEffect(() => {
    const simulate = () => {
      const ns = nodesRef.current;
      const alpha = coolingRef.current;
      if (alpha < 0.001) {
        animRef.current = requestAnimationFrame(simulate);
        return;
      }
      coolingRef.current *= 0.995;

      const PADDING = 60;

      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const a = ns[i], b = ns[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minDist = 120;
          if (dist < minDist) {
            const force = ((minDist - dist) / dist) * 0.5 * alpha;
            const fx = dx * force;
            const fy = dy * force;
            if (a.fx == null) { a.vx -= fx; a.vy -= fy; }
            if (b.fx == null) { b.vx += fx; b.vy += fy; }
          }
        }
      }

      for (const edge of edges) {
        const s = ns.find(n => n.id === edge.source);
        const t = ns.find(n => n.id === edge.target);
        if (!s || !t) continue;
        let dx = t.x - s.x;
        let dy = t.y - s.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const idealDist = edge.tipo === "deal" ? 250 : 300;
        const force = (dist - idealDist) * 0.003 * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (s.fx == null) { s.vx += fx; s.vy += fy; }
        if (t.fx == null) { t.vx -= fx; t.vy -= fy; }
      }

      for (const n of ns) {
        if (n.nodeType === "ativo") {
          const targetX = width * 0.3;
          n.vx += (targetX - n.x) * 0.002 * alpha;
        } else {
          const targetX = width * 0.7;
          n.vx += (targetX - n.x) * 0.002 * alpha;
        }
        const targetY = height * 0.5;
        n.vy += (targetY - n.y) * 0.0005 * alpha;
      }

      for (const n of ns) {
        if (n.fx != null) { n.x = n.fx; n.vx = 0; }
        else {
          n.vx *= 0.6;
          n.x += n.vx;
        }
        if (n.fy != null) { n.y = n.fy; n.vy = 0; }
        else {
          n.vy *= 0.6;
          n.y += n.vy;
        }
        n.x = Math.max(PADDING, Math.min(width - PADDING, n.x));
        n.y = Math.max(PADDING, Math.min(height - PADDING, n.y));
      }

      setTick(t => t + 1);
      animRef.current = requestAnimationFrame(simulate);
    };

    animRef.current = requestAnimationFrame(simulate);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [edges, width, height]);

  const reheat = useCallback(() => { coolingRef.current = 1; }, []);

  return { nodes: nodesRef, tick, reheat };
}

function ConexoesGraph({ ativos, investidores, deals, matchSuggestions, filtros }: {
  ativos: any[]; investidores: any[]; deals: any[];
  matchSuggestions: any[]; filtros: any;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 1200, h: 700 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const [dimensions, setDimensions] = useState({ w: 1200, h: 700 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDimensions({ w: Math.max(800, width), h: Math.max(500, height) });
      setViewBox(v => ({ ...v, w: Math.max(800, width), h: Math.max(500, height) }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = dimensions.w;
  const H = dimensions.h;

  const ativosFiltrados = useMemo(() => {
    return ativos.filter(a => {
      if (filtros.tipoAtivo !== "all" && a.type !== filtros.tipoAtivo) return false;
      if (filtros.estado !== "all" && a.estado !== filtros.estado) return false;
      if (filtros.statusAtivo !== "all" && a.statusAtivo !== filtros.statusAtivo) return false;
      const campos = (a.camposEspecificos as any) || {};
      const exclusivo = campos.exclusividadeAte ? new Date(campos.exclusividadeAte) >= new Date() : false;
      if (filtros.apenasExclusivos && !exclusivo) return false;
      if (filtros.apenasNegociacao && !a.emNegociacao) return false;
      if (filtros.apenasComDeal && !deals.some((d: any) => d.assetId === a.id)) return false;
      if (filtros.apenasComMatch && !matchSuggestions.some((m: any) => m.assetId === a.id)) return false;
      if (filtros.dealId !== "all") {
        const deal = deals.find((d: any) => String(d.id) === filtros.dealId);
        if (!deal || deal.assetId !== a.id) return false;
      }
      return true;
    });
  }, [ativos, filtros, deals, matchSuggestions]);

  const investidoresFiltrados = useMemo(() => {
    return investidores.filter(inv => {
      if (filtros.tipoBuyer !== "all" && inv.buyerType !== filtros.tipoBuyer) return false;
      if (filtros.dealId !== "all") {
        const deal = deals.find((d: any) => String(d.id) === filtros.dealId);
        if (!deal) return false;
        const conectado = deal.investorProfileId === inv.id || deal.companyId === inv.companyId;
        if (!conectado) return false;
      }
      return true;
    });
  }, [investidores, filtros, deals]);

  const graphNodes = useMemo<GraphNode[]>(() => {
    const nodes: GraphNode[] = [];
    ativosFiltrados.forEach((a) => {
      const campos = (a.camposEspecificos as any) || {};
      const exclusivo = campos.exclusividadeAte ? new Date(campos.exclusividadeAte) >= new Date() : false;
      nodes.push({
        id: `ativo-${a.id}`, rawId: a.id,
        label: truncate(a.title || "", 22),
        tipo: a.type, estado: a.estado,
        preco: a.priceAsking, status: a.statusAtivo,
        emNegociacao: a.emNegociacao, exclusivo,
        nodeType: "ativo",
        x: W * 0.25 + (Math.random() - 0.5) * W * 0.2,
        y: H * 0.2 + Math.random() * H * 0.6,
        vx: 0, vy: 0,
      });
    });
    investidoresFiltrados.forEach((inv) => {
      nodes.push({
        id: `inv-${inv.id}`, rawId: inv.id,
        label: truncate(inv.name || "", 20),
        buyerType: inv.buyerType,
        regioes: inv.regions || [],
        ticketMin: inv.ticketMin,
        empresaId: inv.companyId,
        nodeType: inv.buyerType === "estrategico" ? "estrategico" : "financeiro",
        x: W * 0.75 + (Math.random() - 0.5) * W * 0.2,
        y: H * 0.2 + Math.random() * H * 0.6,
        vx: 0, vy: 0,
      });
    });
    return nodes;
  }, [ativosFiltrados, investidoresFiltrados, W, H]);

  const graphEdges = useMemo<GraphEdge[]>(() => {
    const edges: GraphEdge[] = [];
    const addedPairs = new Set<string>();
    deals.forEach((deal: any) => {
      const an = graphNodes.find(n => n.nodeType === "ativo" && n.rawId === deal.assetId);
      const inv = graphNodes.find(n =>
        n.nodeType !== "ativo" && (n.rawId === deal.investorProfileId || n.empresaId === deal.companyId)
      );
      if (an && inv) {
        const pairKey = `${an.id}-${inv.id}`;
        if (!addedPairs.has(pairKey)) {
          addedPairs.add(pairKey);
          edges.push({
            id: `deal-${deal.id}`, source: an.id, target: inv.id,
            tipo: "deal", label: truncate(deal.title || "Deal", 28), score: 100,
            dealId: deal.id,
          });
        }
      }
    });
    matchSuggestions
      .filter((m: any) => (m.score || 0) >= filtros.scoreMin)
      .forEach((m: any) => {
        const an = graphNodes.find(n => n.nodeType === "ativo" && n.rawId === m.assetId);
        const inv = graphNodes.find(n => n.nodeType !== "ativo" && n.rawId === m.investorProfileId);
        if (an && inv) {
          const pairKey = `${an.id}-${inv.id}`;
          if (!addedPairs.has(pairKey)) {
            addedPairs.add(pairKey);
            edges.push({
              id: `match-${m.id}`, source: an.id, target: inv.id,
              tipo: "match", label: `Score ${m.score || 0}%`, score: m.score || 0,
            });
          }
        }
      });
    return edges;
  }, [graphNodes, deals, matchSuggestions, filtros.scoreMin]);

  const { nodes: simNodes, tick, reheat } = useForceSimulation(graphNodes, graphEdges, W, H);

  const selectedNode = simNodes.current.find(n => n.id === selected) || null;
  const connectedIds = useMemo(() => {
    if (!selected) return new Set<string>();
    const ids = new Set<string>([selected]);
    graphEdges.forEach(e => {
      if (e.source === selected) ids.add(e.target);
      if (e.target === selected) ids.add(e.source);
    });
    return ids;
  }, [selected, graphEdges]);

  const connectedEdgeIds = useMemo(() => {
    if (!selected) return new Set<string>();
    return new Set(graphEdges.filter(e => e.source === selected || e.target === selected).map(e => e.id));
  }, [selected, graphEdges]);

  const getSvgPoint = useCallback((e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const scaleX = viewBox.w / rect.width;
    const scaleY = viewBox.h / rect.height;
    return {
      x: viewBox.x + (e.clientX - rect.left) * scaleX,
      y: viewBox.y + (e.clientY - rect.top) * scaleY,
    };
  }, [viewBox]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (dragging) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, vx: viewBox.x, vy: viewBox.y };
  }, [dragging, viewBox]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragging) {
      const pt = getSvgPoint(e);
      const node = simNodes.current.find(n => n.id === dragging);
      if (node) {
        node.fx = pt.x;
        node.fy = pt.y;
        node.x = pt.x;
        node.y = pt.y;
      }
      return;
    }
    if (isPanning) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = viewBox.w / rect.width;
      const scaleY = viewBox.h / rect.height;
      const dx = (e.clientX - panStart.current.x) * scaleX;
      const dy = (e.clientY - panStart.current.y) * scaleY;
      setViewBox(v => ({ ...v, x: panStart.current.vx - dx, y: panStart.current.vy - dy }));
    }
  }, [dragging, isPanning, getSvgPoint, viewBox]);

  const handleMouseUp = useCallback(() => {
    if (dragging) {
      const node = simNodes.current.find(n => n.id === dragging);
      if (node) { node.fx = null; node.fy = null; }
      setDragging(null);
    }
    setIsPanning(false);
  }, [dragging]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    setViewBox(v => {
      const nw = Math.max(400, Math.min(3000, v.w * factor));
      const nh = Math.max(250, Math.min(2000, v.h * factor));
      return {
        x: v.x + (v.w - nw) * mx,
        y: v.y + (v.h - nh) * my,
        w: nw, h: nh,
      };
    });
  }, []);

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    setDragging(nodeId);
    const pt = getSvgPoint(e);
    const node = simNodes.current.find(n => n.id === nodeId);
    if (node) { node.fx = pt.x; node.fy = pt.y; }
    reheat();
  }, [getSvgPoint, reheat]);

  const handleNodeClick = useCallback((nodeId: string) => {
    if (dragging) return;
    setSelected(prev => prev === nodeId ? null : nodeId);
  }, [dragging]);

  const zoomIn = () => setViewBox(v => ({ x: v.x + v.w * 0.1, y: v.y + v.h * 0.1, w: v.w * 0.8, h: v.h * 0.8 }));
  const zoomOut = () => setViewBox(v => ({ x: v.x - v.w * 0.125, y: v.y - v.h * 0.125, w: v.w * 1.25, h: v.h * 1.25 }));
  const resetView = () => { setViewBox({ x: 0, y: 0, w: W, h: H }); reheat(); };

  const focusNode = useCallback((id: string) => {
    const node = simNodes.current.find(n => n.id === id);
    if (node) {
      setViewBox({ x: node.x - W * 0.4, y: node.y - H * 0.4, w: W * 0.8, h: H * 0.8 });
      setSelected(id);
    }
  }, [W, H]);

  if (graphNodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3 text-muted-foreground">
        <Filter className="w-12 h-12 opacity-20" />
        <p className="text-sm">Nenhum resultado para os filtros selecionados.</p>
        <p className="text-xs">Ajuste os filtros no painel à esquerda.</p>
      </div>
    );
  }

  const currentNodes = simNodes.current;

  const getCurvedPath = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const cx1 = x1 + dx * 0.3;
    const cy1 = y1;
    const cx2 = x2 - dx * 0.3;
    const cy2 = y2;
    return `M ${x1},${y1} C ${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`;
  };

  return (
    <div className="relative w-full" ref={containerRef} style={{ height: "calc(100vh - 200px)", minHeight: 500 }}>
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1">
        <Button variant="outline" size="icon" className="h-8 w-8 bg-background/90 backdrop-blur-sm shadow-sm" onClick={zoomIn} data-testid="button-zoom-in">
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8 bg-background/90 backdrop-blur-sm shadow-sm" onClick={zoomOut} data-testid="button-zoom-out">
          <ZoomOut className="w-4 h-4" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8 bg-background/90 backdrop-blur-sm shadow-sm" onClick={resetView} data-testid="button-reset-view">
          <RotateCcw className="w-4 h-4" />
        </Button>
      </div>

      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-3 bg-background/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow-sm border text-[10px]">
        {[
          { shape: "rect", color: "#4ade80", label: "Ativo" },
          { shape: "circle", color: "#34d399", label: "Inv. financeiro" },
          { shape: "diamond", color: "#818cf8", label: "Comp. estratégico" },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-1.5">
            {item.shape === "rect" && <div className="w-3 h-2 rounded-sm" style={{ background: item.color }} />}
            {item.shape === "circle" && <div className="w-3 h-3 rounded-full" style={{ background: item.color }} />}
            {item.shape === "diamond" && <div className="w-3 h-3 rotate-45 rounded-[1px]" style={{ background: item.color }} />}
            <span className="text-muted-foreground">{item.label}</span>
          </div>
        ))}
        <div className="w-px h-3 bg-border mx-1" />
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 bg-emerald-500 rounded" />
          <span className="text-muted-foreground">Deal</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 bg-amber-500 rounded" style={{ borderBottom: "2px dashed #f59e0b", background: "transparent" }} />
          <span className="text-muted-foreground">Match</span>
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className="w-full h-full bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 rounded-xl border select-none"
        style={{ cursor: dragging ? "grabbing" : isPanning ? "grabbing" : "grab" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <defs>
          {Object.entries(TIPO_CONFIG).map(([key, { color }]) => (
            <linearGradient key={key} id={`grad-${key}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={color} stopOpacity="0.9" />
              <stop offset="100%" stopColor={color} />
            </linearGradient>
          ))}
          <linearGradient id="grad-financeiro" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#34d399" /><stop offset="100%" stopColor="#047857" />
          </linearGradient>
          <linearGradient id="grad-estrategico" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#818cf8" /><stop offset="100%" stopColor="#4338ca" />
          </linearGradient>
          <filter id="shadow-sm">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#00000015" />
          </filter>
          <filter id="shadow-lg">
            <feDropShadow dx="0" dy="4" stdDeviation="8" floodColor="#00000025" />
          </filter>
          <filter id="glow-green">
            <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#10b98150" />
          </filter>
          <filter id="glow-purple">
            <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#6366f150" />
          </filter>
          <marker id="arrow-deal" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6" fill="none" stroke="#10b981" strokeWidth="1" />
          </marker>
          <marker id="arrow-match" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6" fill="none" stroke="#f59e0b" strokeWidth="1" />
          </marker>
        </defs>

        <text
          x={viewBox.x + 80}
          y={viewBox.y + 30}
          textAnchor="middle" fill="#94a3b8"
          fontSize="12" fontFamily="system-ui" fontWeight="700" letterSpacing="3"
          opacity="0.5"
        >
          ATIVOS
        </text>
        <text
          x={viewBox.x + viewBox.w - 80}
          y={viewBox.y + 30}
          textAnchor="middle" fill="#94a3b8"
          fontSize="12" fontFamily="system-ui" fontWeight="700" letterSpacing="3"
          opacity="0.5"
        >
          COMPRADORES
        </text>

        {graphEdges.map(edge => {
          const s = currentNodes.find(n => n.id === edge.source);
          const t = currentNodes.find(n => n.id === edge.target);
          if (!s || !t) return null;

          const isHighlighted = selected ? connectedEdgeIds.has(edge.id) : false;
          const isDimmed = selected ? !connectedEdgeIds.has(edge.id) : false;
          const isEdgeHovered = hovered === edge.id;

          const opacity = isDimmed ? 0.08 : isHighlighted ? 1 : isEdgeHovered ? 1 : edge.tipo === "match" ? Math.max(0.25, edge.score / 100) : 0.6;
          const strokeWidth = isHighlighted ? 3 : isEdgeHovered ? 3 : edge.tipo === "deal" ? 2 : Math.max(1, edge.score / 50);

          const path = getCurvedPath(s.x, s.y, t.x, t.y);
          const mx = (s.x + t.x) / 2;
          const my = (s.y + t.y) / 2 - 12;

          return (
            <g key={edge.id}>
              <path
                d={path}
                fill="none"
                stroke={edge.tipo === "deal" ? "#10b981" : "#f59e0b"}
                strokeWidth={strokeWidth}
                strokeDasharray={edge.tipo === "match" ? "8 5" : undefined}
                opacity={opacity}
                style={{ cursor: "pointer", transition: "opacity 0.3s, stroke-width 0.2s" }}
                markerEnd={isHighlighted || isEdgeHovered ? `url(#arrow-${edge.tipo})` : undefined}
                onMouseEnter={() => setHovered(edge.id)}
                onMouseLeave={() => setHovered(null)}
              />
              {(isHighlighted || isEdgeHovered) && (
                <g>
                  <rect x={mx - 50} y={my - 10} width="100" height="20" rx="6"
                    fill={edge.tipo === "deal" ? "#ecfdf5" : "#fffbeb"}
                    stroke={edge.tipo === "deal" ? "#10b981" : "#f59e0b"}
                    strokeWidth="0.5"
                    opacity="0.95" />
                  <text x={mx} y={my + 4} textAnchor="middle" fill={edge.tipo === "deal" ? "#047857" : "#b45309"}
                    fontSize="9" fontFamily="system-ui" fontWeight="600">
                    {edge.tipo === "deal" ? `✓ ${edge.label}` : `⚡ ${edge.label}`}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {currentNodes.filter(n => n.nodeType === "ativo").map(node => {
          const isH = hovered === node.id;
          const isSel = selected === node.id;
          const isConnected = connectedIds.has(node.id);
          const isDimmed = selected && !isConnected;
          const config = TIPO_CONFIG[node.tipo || ""] || TIPO_CONFIG.TERRA;
          const nodeW = 90, nodeH = 44;

          return (
            <g key={node.id}
              onMouseEnter={() => { if (!dragging) setHovered(node.id); }}
              onMouseLeave={() => setHovered(null)}
              onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
              onClick={() => handleNodeClick(node.id)}
              style={{ cursor: dragging === node.id ? "grabbing" : "pointer", transition: "opacity 0.3s" }}
              opacity={isDimmed ? 0.15 : 1}
              data-testid={`node-ativo-${node.rawId}`}
            >
              {isSel && (
                <rect
                  x={node.x - nodeW / 2 - 6} y={node.y - nodeH / 2 - 6}
                  width={nodeW + 12} height={nodeH + 12} rx={14}
                  fill="none" stroke={config.color} strokeWidth="2.5"
                  opacity="0.6"
                />
              )}
              <rect
                x={node.x - nodeW / 2} y={node.y - nodeH / 2}
                width={nodeW} height={nodeH} rx={10}
                fill={`url(#grad-${node.tipo})`}
                filter={isSel || isH ? "url(#shadow-lg)" : "url(#shadow-sm)"}
                style={{ transition: "filter 0.2s" }}
              />
              <text x={node.x - nodeW / 2 + 10} y={node.y - 4} dominantBaseline="middle"
                fontSize="14" fontFamily="system-ui">
                {config.icon}
              </text>
              <text x={node.x - nodeW / 2 + 28} y={node.y - 5} dominantBaseline="middle"
                fill="white" fontSize="9" fontWeight="800" fontFamily="system-ui" letterSpacing="0.5">
                {config.label}
              </text>
              {node.estado && (
                <text x={node.x - nodeW / 2 + 28} y={node.y + 9} dominantBaseline="middle"
                  fill="rgba(255,255,255,0.75)" fontSize="8" fontFamily="system-ui">
                  {node.estado}
                </text>
              )}
              {node.emNegociacao && (
                <circle cx={node.x + nodeW / 2 - 6} cy={node.y - nodeH / 2 + 6}
                  r={5} fill="#3b82f6" stroke="white" strokeWidth="1.5" />
              )}
              {node.exclusivo && (
                <circle cx={node.x - nodeW / 2 + 6} cy={node.y - nodeH / 2 + 6}
                  r={5} fill="#ef4444" stroke="white" strokeWidth="1.5" />
              )}
              <rect x={node.x - 42} y={node.y + nodeH / 2 + 4} width="84" height="16" rx="4"
                fill="white" fillOpacity="0.95" filter="url(#shadow-sm)" />
              <text x={node.x} y={node.y + nodeH / 2 + 13} textAnchor="middle"
                fill="#334155" fontSize="7.5" fontFamily="system-ui" fontWeight="600">
                {truncate(node.label, 14)}
              </text>
            </g>
          );
        })}

        {currentNodes.filter(n => n.nodeType === "financeiro").map(node => {
          const isH = hovered === node.id;
          const isSel = selected === node.id;
          const isConnected = connectedIds.has(node.id);
          const isDimmed = selected && !isConnected;
          const r = 24;

          return (
            <g key={node.id}
              onMouseEnter={() => { if (!dragging) setHovered(node.id); }}
              onMouseLeave={() => setHovered(null)}
              onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
              onClick={() => handleNodeClick(node.id)}
              style={{ cursor: dragging === node.id ? "grabbing" : "pointer", transition: "opacity 0.3s" }}
              opacity={isDimmed ? 0.15 : 1}
              data-testid={`node-inv-${node.rawId}`}
            >
              {isSel && (
                <circle cx={node.x} cy={node.y} r={r + 7} fill="none"
                  stroke="#34d399" strokeWidth="2.5" opacity="0.6" />
              )}
              <circle cx={node.x} cy={node.y} r={r}
                fill="url(#grad-financeiro)"
                filter={isSel || isH ? "url(#glow-green)" : "url(#shadow-sm)"}
                style={{ transition: "filter 0.2s" }} />
              <text x={node.x} y={node.y + 1} textAnchor="middle" dominantBaseline="middle"
                fill="white" fontSize="8" fontWeight="700" fontFamily="system-ui">
                💰
              </text>
              <rect x={node.x - 42} y={node.y + r + 4} width="84" height="16" rx="4"
                fill="white" fillOpacity="0.95" filter="url(#shadow-sm)" />
              <text x={node.x} y={node.y + r + 13} textAnchor="middle"
                fill="#334155" fontSize="7.5" fontFamily="system-ui" fontWeight="600">
                {truncate(node.label, 14)}
              </text>
            </g>
          );
        })}

        {currentNodes.filter(n => n.nodeType === "estrategico").map(node => {
          const isH = hovered === node.id;
          const isSel = selected === node.id;
          const isConnected = connectedIds.has(node.id);
          const isDimmed = selected && !isConnected;
          const r = 26;
          const pts = `${node.x},${node.y - r} ${node.x + r},${node.y} ${node.x},${node.y + r} ${node.x - r},${node.y}`;

          return (
            <g key={node.id}
              onMouseEnter={() => { if (!dragging) setHovered(node.id); }}
              onMouseLeave={() => setHovered(null)}
              onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
              onClick={() => handleNodeClick(node.id)}
              style={{ cursor: dragging === node.id ? "grabbing" : "pointer", transition: "opacity 0.3s" }}
              opacity={isDimmed ? 0.15 : 1}
              data-testid={`node-inv-${node.rawId}`}
            >
              {isSel && (
                <polygon
                  points={`${node.x},${node.y - r - 7} ${node.x + r + 7},${node.y} ${node.x},${node.y + r + 7} ${node.x - r - 7},${node.y}`}
                  fill="none" stroke="#818cf8" strokeWidth="2.5" opacity="0.6" />
              )}
              <polygon points={pts}
                fill="url(#grad-estrategico)"
                filter={isSel || isH ? "url(#glow-purple)" : "url(#shadow-sm)"}
                style={{ transition: "filter 0.2s" }} />
              <text x={node.x} y={node.y + 1} textAnchor="middle" dominantBaseline="middle"
                fill="white" fontSize="9" fontWeight="700" fontFamily="system-ui">
                🏢
              </text>
              <rect x={node.x - 42} y={node.y + r + 4} width="84" height="16" rx="4"
                fill="white" fillOpacity="0.95" filter="url(#shadow-sm)" />
              <text x={node.x} y={node.y + r + 13} textAnchor="middle"
                fill="#334155" fontSize="7.5" fontFamily="system-ui" fontWeight="600">
                {truncate(node.label, 14)}
              </text>
            </g>
          );
        })}
      </svg>

      {selectedNode && (
        <DetailPanel
          node={selectedNode}
          edges={graphEdges}
          allNodes={currentNodes}
          onClose={() => setSelected(null)}
          navigate={navigate}
          onFocusNode={focusNode}
        />
      )}
    </div>
  );
}

export default function MapaConexoesPage() {
  const [filtros, setFiltros] = useState(FILTROS_DEFAULT);
  const [filtrosPanelOpen, setFiltrosPanelOpen] = useState(false);

  const { data: ativos = [] } = useQuery<any[]>({
    queryKey: ["/api/matching/assets"],
    queryFn: () => apiRequest("GET", "/api/matching/assets").then(r => r.json()),
  });
  const { data: investidores = [] } = useQuery<any[]>({
    queryKey: ["/api/matching/investors"],
    queryFn: () => apiRequest("GET", "/api/matching/investors").then(r => r.json()),
  });
  const { data: deals = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/deals"],
    queryFn: () => apiRequest("GET", "/api/crm/deals").then(r => r.json()),
  });
  const { data: matchSuggestions = [] } = useQuery<any[]>({
    queryKey: ["/api/matching/suggestions"],
    queryFn: () => apiRequest("GET", "/api/matching/suggestions").then(r => r.json()),
  });

  const filtrosAtivos = Object.entries(filtros).filter(([k, v]) =>
    v !== FILTROS_DEFAULT[k as keyof typeof FILTROS_DEFAULT]
  ).length;

  return (
    <div className="p-4 md:p-6 max-w-full mx-auto space-y-4" data-testid="page-mapa-conexoes">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Mapa de Conexões</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Arraste os nós para reorganizar · Clique para ver detalhes e conexões · Scroll para zoom
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium" data-testid="text-ativos-count">
              {ativos.length} ativos
            </span>
            <span className="px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 font-medium" data-testid="text-compradores-count">
              {investidores.length} compradores
            </span>
            <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-medium" data-testid="text-conexoes-count">
              {deals.length + matchSuggestions.length} conexões
            </span>
          </div>
          <Button
            variant={filtrosAtivos > 0 ? "default" : "outline"}
            size="sm" className="gap-2 h-8"
            onClick={() => setFiltrosPanelOpen(o => !o)}
            data-testid="button-toggle-filtros"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filtros
            {filtrosAtivos > 0 && (
              <Badge className="bg-white text-primary text-xs px-1.5 py-0 h-4">{filtrosAtivos}</Badge>
            )}
          </Button>
          {filtrosAtivos > 0 && (
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1"
              onClick={() => setFiltros(FILTROS_DEFAULT)} data-testid="button-limpar-filtros-header">
              <X className="w-3.5 h-3.5" /> Limpar
            </Button>
          )}
        </div>
      </div>

      <div className="relative rounded-xl overflow-hidden">
        {filtrosPanelOpen && (
          <FilterPanel
            filtros={filtros} setFiltros={setFiltros}
            deals={deals as any[]} ativos={ativos as any[]}
            onClose={() => setFiltrosPanelOpen(false)}
          />
        )}
        <ConexoesGraph
          ativos={ativos as any[]}
          investidores={investidores as any[]}
          deals={deals as any[]}
          matchSuggestions={matchSuggestions as any[]}
          filtros={filtros}
        />
      </div>
    </div>
  );
}
