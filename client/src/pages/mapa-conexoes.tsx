import { useState, useMemo } from "react";
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
import {
  X, ExternalLink, Layers, Building2,
  Zap, Lock, Info, SlidersHorizontal, Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TIPO_CONFIG: Record<string, { grad: [string, string]; label: string; icon: string }> = {
  TERRA:           { grad: ["#4ade80", "#16a34a"], label: "TERRA",  icon: "🌿" },
  MINA:            { grad: ["#fb923c", "#ea580c"], label: "MINA",   icon: "⛏" },
  NEGOCIO:         { grad: ["#60a5fa", "#2563eb"], label: "M&A",    icon: "💼" },
  FII_CRI:         { grad: ["#c084fc", "#9333ea"], label: "FII",    icon: "🏢" },
  DESENVOLVIMENTO: { grad: ["#f472b6", "#db2777"], label: "DESENV", icon: "🏗" },
  AGRO:            { grad: ["#facc15", "#ca8a04"], label: "AGRO",   icon: "🌾" },
};

const ESTADOS_BR = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS",
  "MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"
];

function truncate(s: string, n: number) {
  return s && s.length > n ? s.substring(0, n) + "…" : (s || "");
}

function RoundedRect({ x, y, w, h, rx, fill, stroke, strokeWidth, filter, opacity }: any) {
  return (
    <rect
      x={x - w / 2} y={y - h / 2}
      width={w} height={h} rx={rx}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth || 0}
      filter={filter}
      opacity={opacity || 1}
    />
  );
}

function Diamond({ x, y, r, fill, filter }: any) {
  const pts = `${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`;
  return <polygon points={pts} fill={fill} filter={filter} />;
}

function DetailPanel({ node, onClose, navigate }: {
  node: any; onClose: () => void; navigate: (p: string) => void;
}) {
  if (!node) return null;
  return (
    <div className="absolute top-4 right-4 w-72 z-20 animate-in slide-in-from-right-4 duration-200">
      <Card className="shadow-xl border-primary/20">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <Badge variant="outline" className="text-xs mb-1.5" data-testid="badge-node-type">
                {node.nodeType === "ativo" ? "Ativo"
                  : node.nodeType === "estrategico" ? "Comprador Estratégico"
                  : "Investidor Financeiro"}
              </Badge>
              <CardTitle className="text-sm leading-snug">{node.label}</CardTitle>
            </div>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={onClose} data-testid="button-close-detail">
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          {node.nodeType === "ativo" && (
            <>
              {node.tipo && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tipo</span>
                  <span className="font-medium">{TIPO_CONFIG[node.tipo]?.label || node.tipo}</span>
                </div>
              )}
              {node.estado && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Estado</span>
                  <span className="font-medium">{node.estado}</span>
                </div>
              )}
              {node.preco && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Preço</span>
                  <span className="font-bold text-emerald-600">
                    R$ {(node.preco / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M
                  </span>
                </div>
              )}
              {node.status && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className="font-medium capitalize">{node.status}</span>
                </div>
              )}
              <div className="flex gap-2 flex-wrap pt-1">
                {node.emNegociacao && (
                  <Badge className="bg-blue-600 text-white text-xs gap-1">
                    <Zap className="w-3 h-3" /> Em negociação
                  </Badge>
                )}
                {node.exclusivo && (
                  <Badge className="bg-red-100 text-red-700 border-red-200 text-xs gap-1">
                    <Lock className="w-3 h-3" /> Exclusivo
                  </Badge>
                )}
              </div>
              <Button size="sm" className="w-full h-7 text-xs gap-1 mt-2"
                onClick={() => navigate(`/ativos/${node.rawId}`)}
                data-testid="button-ver-ativo">
                <ExternalLink className="w-3 h-3" /> Ver ativo completo
              </Button>
            </>
          )}
          {node.nodeType !== "ativo" && (
            <>
              {node.regioes?.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Regiões</span>
                  <span className="font-medium">{node.regioes.join(", ")}</span>
                </div>
              )}
              {node.ticketMin && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ticket mín.</span>
                  <span className="font-medium">
                    R$ {(node.ticketMin / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M
                  </span>
                </div>
              )}
              {node.empresaId && (
                <Button size="sm" className="w-full h-7 text-xs gap-1 mt-2"
                  onClick={() => navigate(`/empresas/${node.empresaId}`)}
                  data-testid="button-ver-empresa">
                  <ExternalLink className="w-3 h-3" /> Ver empresa
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

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
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Tipo de ativo
          </Label>
          <Select value={filtros.tipoAtivo} onValueChange={v => set("tipoAtivo", v)}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-tipo-ativo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              <SelectItem value="TERRA">🌿 Terras & Fazendas</SelectItem>
              <SelectItem value="MINA">⛏ Mineração</SelectItem>
              <SelectItem value="NEGOCIO">💼 Negócios M&A</SelectItem>
              <SelectItem value="FII_CRI">🏢 FII / CRI</SelectItem>
              <SelectItem value="DESENVOLVIMENTO">🏗 Desenvolvimento</SelectItem>
              <SelectItem value="AGRO">🌾 Agronegócio</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Status do ativo
          </Label>
          <Select value={filtros.statusAtivo} onValueChange={v => set("statusAtivo", v)}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-status-ativo">
              <SelectValue />
            </SelectTrigger>
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
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Estado
          </Label>
          <Select value={filtros.estado} onValueChange={v => set("estado", v)}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-estado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os estados</SelectItem>
              {estadosDisponiveis.map(e => (
                <SelectItem key={e} value={e}>{e}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Tipo de comprador
          </Label>
          <Select value={filtros.tipoBuyer} onValueChange={v => set("tipoBuyer", v)}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-tipo-buyer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="financeiro">◯ Investidor financeiro</SelectItem>
              <SelectItem value="estrategico">◇ Comprador estratégico</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Negociação específica
          </Label>
          <Select value={filtros.dealId} onValueChange={v => set("dealId", v)}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-deal">
              <SelectValue placeholder="Selecionar deal..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as negociações</SelectItem>
              {deals.map((d: any) => (
                <SelectItem key={d.id} value={String(d.id)}>
                  {truncate(d.title || `Deal #${d.id}`, 30)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Score mínimo de match: <span className="text-primary font-bold">{filtros.scoreMin}</span>
          </Label>
          <Slider
            min={0} max={100} step={5}
            value={[filtros.scoreMin]}
            onValueChange={([v]) => set("scoreMin", v)}
            className="w-full"
            data-testid="slider-score"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>0 — mostrar tudo</span>
            <span>100 — só perfeitos</span>
          </div>
        </div>

        <div className="space-y-3 pt-1">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Mostrar apenas
          </Label>
          {[
            { key: "apenasNegociacao", label: "Em negociação" },
            { key: "apenasExclusivos", label: "Em exclusividade" },
            { key: "apenasComDeal", label: "Com deal aberto" },
            { key: "apenasComMatch", label: "Com match pendente" },
          ].map(item => (
            <div key={item.key} className="flex items-center justify-between">
              <Label className="text-xs cursor-pointer">{item.label}</Label>
              <Switch
                checked={filtros[item.key]}
                onCheckedChange={v => set(item.key, v)}
                data-testid={`switch-${item.key}`}
              />
            </div>
          ))}
        </div>

        <Button
          variant="outline" size="sm" className="w-full text-xs"
          onClick={() => setFiltros(FILTROS_DEFAULT)}
          data-testid="button-limpar-filtros"
        >
          <X className="w-3.5 h-3.5 mr-1.5" /> Limpar todos os filtros
        </Button>
      </div>
    </div>
  );
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

function ConexoesGraph({ ativos, investidores, deals, matchSuggestions, filtros }: {
  ativos: any[]; investidores: any[]; deals: any[];
  matchSuggestions: any[]; filtros: any;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [, navigate] = useLocation();

  const W = 1100, H = 620;
  const cx = W / 2, cy = H / 2;

  const ativosFiltrados = useMemo(() => {
    return ativos.filter(a => {
      if (filtros.tipoAtivo !== "all" && a.type !== filtros.tipoAtivo) return false;
      if (filtros.estado !== "all" && a.estado !== filtros.estado) return false;
      if (filtros.statusAtivo !== "all" && a.statusAtivo !== filtros.statusAtivo) return false;
      const campos = (a.camposEspecificos as any) || {};
      const exclusivo = campos.exclusividadeAte
        ? new Date(campos.exclusividadeAte) >= new Date() : false;
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

  const ativoNodes = useMemo(() => {
    const total = ativosFiltrados.length;
    if (total === 0) return [];
    return ativosFiltrados.map((a, i) => {
      const spread = Math.min(Math.PI * 1.3, total * 0.4);
      const angle = total === 1
        ? -Math.PI / 2
        : -Math.PI / 2 - spread / 2 + (i / (total - 1)) * spread;
      const r = Math.min(240, 160 + total * 12);
      const campos = (a.camposEspecificos as any) || {};
      const exclusivo = campos.exclusividadeAte
        ? new Date(campos.exclusividadeAte) >= new Date() : false;
      return {
        id: `ativo-${a.id}`, rawId: a.id,
        label: truncate(a.title || "", 18),
        tipo: a.type, estado: a.estado,
        preco: a.priceAsking, status: a.statusAtivo,
        emNegociacao: a.emNegociacao, exclusivo,
        nodeType: "ativo",
        x: cx - 120 + r * Math.cos(angle - 0.3),
        y: cy + r * Math.sin(angle),
      };
    });
  }, [ativosFiltrados, cx, cy]);

  const investidorNodes = useMemo(() => {
    const total = investidoresFiltrados.length;
    if (total === 0) return [];
    return investidoresFiltrados.map((inv, i) => {
      const spread = Math.min(Math.PI * 1.3, total * 0.4);
      const angle = total === 1
        ? -Math.PI / 2
        : -Math.PI / 2 - spread / 2 + (i / (total - 1)) * spread;
      const r = Math.min(240, 160 + total * 12);
      return {
        id: `inv-${inv.id}`, rawId: inv.id,
        label: truncate(inv.name || "", 16),
        buyerType: inv.buyerType,
        regioes: inv.regions || [],
        ticketMin: inv.ticketMin,
        empresaId: inv.companyId,
        nodeType: inv.buyerType === "estrategico" ? "estrategico" : "financeiro",
        x: cx + 120 + r * Math.cos(angle + 0.3),
        y: cy + r * Math.sin(angle),
      };
    });
  }, [investidoresFiltrados, cx, cy]);

  const connections = useMemo(() => {
    const conns: any[] = [];
    deals.forEach((deal: any) => {
      const an = ativoNodes.find(n => n.rawId === deal.assetId);
      const inv = investidorNodes.find(n =>
        n.rawId === deal.investorProfileId || n.empresaId === deal.companyId
      );
      if (an && inv) {
        conns.push({
          id: `deal-${deal.id}`, x1: an.x, y1: an.y, x2: inv.x, y2: inv.y,
          tipo: "deal", label: truncate(deal.title || "Deal", 28), score: 100,
        });
      }
    });
    matchSuggestions
      .filter((m: any) => (m.score || 0) >= filtros.scoreMin)
      .forEach((m: any) => {
        const an = ativoNodes.find(n => n.rawId === m.assetId);
        const inv = investidorNodes.find(n => n.rawId === m.investorProfileId);
        if (an && inv) {
          const jaTemDeal = conns.some(c => c.x1 === an.x && c.x2 === inv.x && c.tipo === "deal");
          if (!jaTemDeal) {
            conns.push({
              id: `match-${m.id}`, x1: an.x, y1: an.y, x2: inv.x, y2: inv.y,
              tipo: "match", label: `Score ${m.score || 0}`, score: m.score || 0,
            });
          }
        }
      });
    return conns;
  }, [ativoNodes, investidorNodes, deals, matchSuggestions, filtros.scoreMin]);

  if (ativoNodes.length === 0 && investidorNodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <Filter className="w-12 h-12 opacity-20" />
        <p className="text-sm">Nenhum resultado para os filtros selecionados.</p>
        <p className="text-xs">Ajuste os filtros no painel à esquerda.</p>
      </div>
    );
  }

  return (
    <div className="relative w-full">
      <div className="w-full bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 rounded-xl overflow-hidden border">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" style={{ maxHeight: 620 }}>
          <defs>
            {Object.entries(TIPO_CONFIG).map(([key, { grad }]) => (
              <linearGradient key={key} id={`grad-${key}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={grad[0]} />
                <stop offset="100%" stopColor={grad[1]} />
              </linearGradient>
            ))}
            <linearGradient id="grad-financeiro" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#34d399" /><stop offset="100%" stopColor="#047857" />
            </linearGradient>
            <linearGradient id="grad-estrategico" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#818cf8" /><stop offset="100%" stopColor="#4338ca" />
            </linearGradient>
            <filter id="sh"><feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#00000025" /></filter>
            <filter id="shh"><feDropShadow dx="0" dy="6" stdDeviation="14" floodColor="#6366f140" /></filter>
          </defs>

          <text x={cx - 200} y={28} textAnchor="middle" fill="#94a3b8"
            fontSize="11" fontFamily="system-ui" fontWeight="700" letterSpacing="2">
            ATIVOS
          </text>
          <text x={cx + 200} y={28} textAnchor="middle" fill="#94a3b8"
            fontSize="11" fontFamily="system-ui" fontWeight="700" letterSpacing="2">
            COMPRADORES
          </text>
          <line x1={cx} y1={36} x2={cx} y2={H - 50}
            stroke="#e2e8f025" strokeWidth="1" strokeDasharray="6 6" />

          {connections.map(conn => {
            const isH = hovered === conn.id;
            const mx = (conn.x1 + conn.x2) / 2;
            const my = (conn.y1 + conn.y2) / 2 - 10;
            const scoreOpacity = conn.tipo === "match"
              ? Math.max(0.3, conn.score / 100)
              : 0.75;
            return (
              <g key={conn.id}>
                <line
                  x1={conn.x1} y1={conn.y1} x2={conn.x2} y2={conn.y2}
                  stroke={conn.tipo === "deal" ? "#10b981" : "#f59e0b"}
                  strokeWidth={isH ? 3.5 : conn.tipo === "deal" ? 2.5 : Math.max(1, conn.score / 40)}
                  strokeDasharray={conn.tipo === "match" ? "7 4" : undefined}
                  opacity={isH ? 1 : scoreOpacity}
                  style={{ cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={() => setHovered(conn.id)}
                  onMouseLeave={() => setHovered(null)}
                />
                {isH && (
                  <>
                    <rect x={mx - 55} y={my - 12} width="110" height="22" rx="5"
                      fill="white" fillOpacity="0.96"
                      style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.12))" }} />
                    <text x={mx} y={my + 1} textAnchor="middle" fill="#1e293b"
                      fontSize="8.5" fontFamily="system-ui" fontWeight="600">
                      {conn.tipo === "deal" ? `✓ ${conn.label}` : `⚡ ${conn.label}`}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {ativoNodes.map(node => {
            const isH = hovered === node.id;
            const isSel = selected?.id === node.id;
            const config = TIPO_CONFIG[node.tipo] || TIPO_CONFIG.TERRA;
            const W_rect = 80, H_rect = 52;
            return (
              <g key={node.id}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => setSelected(isSel ? null : node)}
                style={{ cursor: "pointer" }}
              >
                {(isH || isSel) && (
                  <rect
                    x={node.x - W_rect / 2 - 5} y={node.y - H_rect / 2 - 5}
                    width={W_rect + 10} height={H_rect + 10} rx={14}
                    fill="none"
                    stroke={config.grad[0]}
                    strokeWidth="2" strokeDasharray="4 3"
                  />
                )}
                {node.exclusivo && (
                  <rect
                    x={node.x - W_rect / 2 - 2} y={node.y - H_rect / 2 - 2}
                    width={W_rect + 4} height={H_rect + 4} rx={12}
                    fill="none" stroke="#ef4444" strokeWidth="2"
                  />
                )}
                <RoundedRect
                  x={node.x} y={node.y} w={W_rect} h={H_rect} rx={10}
                  fill={`url(#grad-${node.tipo})`}
                  filter={(isH || isSel) ? "url(#shh)" : "url(#sh)"}
                />
                <text x={node.x} y={node.y - 9} textAnchor="middle"
                  dominantBaseline="middle" fontSize="14" fontFamily="system-ui">
                  {config.icon}
                </text>
                <text x={node.x} y={node.y + 5} textAnchor="middle"
                  dominantBaseline="middle" fill="white"
                  fontSize="8" fontWeight="800" fontFamily="system-ui" letterSpacing="0.5">
                  {config.label}
                </text>
                {node.estado && (
                  <text x={node.x} y={node.y + 16} textAnchor="middle"
                    dominantBaseline="middle" fill="rgba(255,255,255,0.8)"
                    fontSize="7" fontFamily="system-ui">
                    {node.estado}
                  </text>
                )}
                {node.emNegociacao && (
                  <circle cx={node.x + W_rect / 2 - 5} cy={node.y - H_rect / 2 + 5}
                    r={6} fill="#3b82f6" stroke="white" strokeWidth="1.5" />
                )}
                {node.exclusivo && (
                  <circle cx={node.x - W_rect / 2 + 5} cy={node.y - H_rect / 2 + 5}
                    r={6} fill="#ef4444" stroke="white" strokeWidth="1.5" />
                )}
                <rect x={node.x - 50} y={node.y + H_rect / 2 + 4} width="100" height="18" rx="4"
                  fill="white" fillOpacity="0.92" />
                <text x={node.x} y={node.y + H_rect / 2 + 13} textAnchor="middle"
                  fill="#1e293b" fontSize="7.5" fontFamily="system-ui" fontWeight="500">
                  {node.label}
                </text>
              </g>
            );
          })}

          {investidorNodes.filter(n => n.nodeType === "financeiro").map(node => {
            const isH = hovered === node.id;
            const isSel = selected?.id === node.id;
            const r = 28;
            return (
              <g key={node.id}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => setSelected(isSel ? null : node)}
                style={{ cursor: "pointer" }}
              >
                {(isH || isSel) && (
                  <circle cx={node.x} cy={node.y} r={r + 8} fill="none"
                    stroke="#34d399" strokeWidth="2" strokeDasharray="4 3" />
                )}
                <circle cx={node.x} cy={node.y} r={r}
                  fill="url(#grad-financeiro)"
                  filter={(isH || isSel) ? "url(#shh)" : "url(#sh)"}
                  style={{ transition: "all 0.2s" }} />
                <text x={node.x} y={node.y - 4} textAnchor="middle"
                  dominantBaseline="middle" fill="white"
                  fontSize="7.5" fontWeight="700" fontFamily="system-ui">
                  FINANC.
                </text>
                <rect x={node.x - 48} y={node.y + r + 4} width="96" height="18" rx="4"
                  fill="white" fillOpacity="0.92" />
                <text x={node.x} y={node.y + r + 13} textAnchor="middle"
                  fill="#1e293b" fontSize="7.5" fontFamily="system-ui" fontWeight="500">
                  {node.label}
                </text>
              </g>
            );
          })}

          {investidorNodes.filter(n => n.nodeType === "estrategico").map(node => {
            const isH = hovered === node.id;
            const isSel = selected?.id === node.id;
            const r = 32;
            return (
              <g key={node.id}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => setSelected(isSel ? null : node)}
                style={{ cursor: "pointer" }}
              >
                {(isH || isSel) && (
                  <Diamond x={node.x} y={node.y} r={r + 8}
                    fill="none"
                    filter={undefined} />
                )}
                {(isH || isSel) && (
                  <polygon
                    points={`${node.x},${node.y - r - 8} ${node.x + r + 8},${node.y} ${node.x},${node.y + r + 8} ${node.x - r - 8},${node.y}`}
                    fill="none" stroke="#818cf8" strokeWidth="2" strokeDasharray="4 3" />
                )}
                <Diamond x={node.x} y={node.y} r={r}
                  fill="url(#grad-estrategico)"
                  filter={(isH || isSel) ? "url(#shh)" : "url(#sh)"} />
                <text x={node.x} y={node.y - 3} textAnchor="middle"
                  dominantBaseline="middle" fill="white"
                  fontSize="7" fontWeight="700" fontFamily="system-ui">
                  ESTRATÉG.
                </text>
                <rect x={node.x - 48} y={node.y + r + 4} width="96" height="18" rx="4"
                  fill="white" fillOpacity="0.92" />
                <text x={node.x} y={node.y + r + 13} textAnchor="middle"
                  fill="#1e293b" fontSize="7.5" fontFamily="system-ui" fontWeight="500">
                  {node.label}
                </text>
              </g>
            );
          })}

          <g transform={`translate(16, ${H - 38})`}>
            {[
              { shape: "rect", color: "#4ade80", label: "Ativo (retângulo)" },
              { shape: "circle", color: "#34d399", label: "Inv. financeiro (círculo)" },
              { shape: "diamond", color: "#818cf8", label: "Comprador estratégico (diamante)" },
              { shape: "line", color: "#10b981", label: "Deal aberto", dash: false },
              { shape: "line", color: "#f59e0b", label: "Match pendente", dash: true },
            ].map((item, i) => (
              <g key={i} transform={`translate(${i * 160}, 0)`}>
                {item.shape === "rect" && (
                  <rect x={0} y={2} width={18} height={12} rx={3} fill={item.color} />
                )}
                {item.shape === "circle" && (
                  <circle cx={9} cy={8} r={7} fill={item.color} />
                )}
                {item.shape === "diamond" && (
                  <polygon points="9,1 17,8 9,15 1,8" fill={item.color} />
                )}
                {item.shape === "line" && (
                  <line x1={0} y1={8} x2={20} y2={8}
                    stroke={item.color} strokeWidth="2.5"
                    strokeDasharray={item.dash ? "5 3" : undefined} />
                )}
                <text x={item.shape === "line" ? 26 : 24} y={12}
                  fontSize="9.5" fill="#64748b" fontFamily="system-ui">
                  {item.label}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>

      {selected && (
        <DetailPanel node={selected} onClose={() => setSelected(null)} navigate={navigate} />
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
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4" data-testid="page-mapa-conexoes">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Mapa de Conexões</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Visualização interativa de ativos, compradores e negociações
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
              <Badge className="bg-white text-primary text-xs px-1.5 py-0 h-4">
                {filtrosAtivos}
              </Badge>
            )}
          </Button>
          {filtrosAtivos > 0 && (
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1"
              onClick={() => setFiltros(FILTROS_DEFAULT)}
              data-testid="button-limpar-filtros-header">
              <X className="w-3.5 h-3.5" /> Limpar
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 px-3 py-2 rounded-lg">
        <Info className="w-3.5 h-3.5 shrink-0" />
        Clique nos nós para ver detalhes. Passe o mouse nas linhas para ver o tipo de conexão.
        Use os filtros para focar em uma negociação específica.
      </div>

      <div className="relative rounded-xl overflow-hidden">
        {filtrosPanelOpen && (
          <FilterPanel
            filtros={filtros}
            setFiltros={setFiltros}
            deals={deals as any[]}
            ativos={ativos as any[]}
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
