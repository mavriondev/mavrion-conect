import { useState, useRef, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  MapPin, Ruler, DollarSign, Zap, ArrowLeft, CheckCircle2,
  Send, Building2, Phone, Mail, TreePine, Pickaxe, Briefcase,
  Home, Wheat, Factory, Layers, Search, Shield, Eye, Users,
  FileCheck, ArrowRight, ChevronDown, Star, Clock,
  TrendingUp, Award, Menu, X, ChevronLeft, ChevronRight,
  Sparkles, Globe, Target, BarChart3, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRoute, Link } from "wouter";
import heroImg from "@assets/image_1772511452694.png";

const TIPO_ICON: Record<string, any> = {
  TERRA: TreePine, MINA: Pickaxe, NEGOCIO: Briefcase,
  FII_CRI: Home, DESENVOLVIMENTO: Factory, AGRO: Wheat,
};
const TIPO_LABEL: Record<string, string> = {
  TERRA: "Terras & Fazendas", MINA: "Mineração", NEGOCIO: "Negócio M&A",
  FII_CRI: "FII / CRI / Imóveis", DESENVOLVIMENTO: "Desenvolvimento", AGRO: "Agronegócio",
};
const TIPO_COLOR: Record<string, string> = {
  TERRA: "bg-green-100 text-green-800", MINA: "bg-orange-100 text-orange-800",
  NEGOCIO: "bg-blue-100 text-blue-800", FII_CRI: "bg-purple-100 text-purple-800",
  DESENVOLVIMENTO: "bg-cyan-100 text-cyan-800", AGRO: "bg-amber-100 text-amber-800",
};

const PRICE_RANGES = [
  { label: "Qualquer preço", value: "" },
  { label: "Até R$ 1M", value: "0-1000000" },
  { label: "R$ 1M - 5M", value: "1000000-5000000" },
  { label: "R$ 5M - 20M", value: "5000000-20000000" },
  { label: "Acima de R$ 20M", value: "20000000-999999999999" },
];

function fetchPublic(url: string) {
  return fetch(url).then(r => { if (!r.ok) throw new Error("Erro"); return r.json(); });
}

function isNew(listing: any) {
  if (!listing.createdAt) return false;
  const created = new Date(listing.createdAt);
  return (Date.now() - created.getTime()) < 7 * 24 * 60 * 60 * 1000;
}

function formatPrice(v: any) {
  if (!v) return null;
  const n = Number(v);
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
  if (n >= 1_000) return `R$ ${(n / 1_000).toFixed(0)}K`;
  return `R$ ${n.toLocaleString("pt-BR")}`;
}

export default function PortalPublicoPage() {
  const [, params] = useRoute("/portal/:id");
  if (params?.id) return <ListingDetail id={Number(params.id)} />;
  return <ListingGrid />;
}

function Navbar({ onScrollTo, transparent }: { onScrollTo?: (id: string) => void; transparent?: boolean }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const showBg = !transparent || scrolled;

  const navLinks = [
    { label: "Oportunidades", anchor: "oportunidades" },
    { label: "Como Funciona", anchor: "como-funciona" },
    { label: "Por que Investir", anchor: "sobre" },
    { label: "Contato", anchor: "contato" },
  ];

  return (
    <nav
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
        showBg ? "bg-white/95 backdrop-blur-md shadow-sm border-b border-gray-100" : "bg-transparent"
      )}
      data-testid="portal-navbar"
    >
      <div className="max-w-7xl mx-auto px-4 md:px-8 flex items-center justify-between h-16 md:h-20">
        <Link href="/portal">
          <div className="flex items-center gap-2.5 cursor-pointer" data-testid="link-portal-home">
            <div className="w-9 h-9 rounded-lg bg-gray-900 flex items-center justify-center">
              <Zap className="w-5 h-5 text-white fill-current" />
            </div>
            <span className={cn(
              "text-lg font-bold tracking-tight transition-colors",
              showBg ? "text-gray-900" : "text-white"
            )}>Mavrion Conect</span>
          </div>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          {onScrollTo && navLinks.map(link => (
            <button
              key={link.anchor}
              onClick={() => onScrollTo(link.anchor)}
              className={cn(
                "text-sm font-medium transition-colors",
                showBg ? "text-gray-600 hover:text-gray-900" : "text-white/80 hover:text-white"
              )}
              data-testid={`link-nav-${link.anchor}`}
            >
              {link.label}
            </button>
          ))}
          <Button
            size="sm"
            className="rounded-full px-6 bg-gray-900 text-white hover:bg-gray-800"
            onClick={() => onScrollTo?.("oportunidades")}
            data-testid="btn-cta-nav"
          >
            Explorar
          </Button>
        </div>

        <Button
          size="icon"
          variant="ghost"
          className={cn("md:hidden", showBg ? "text-gray-900" : "text-white")}
          onClick={() => setMobileOpen(!mobileOpen)}
          data-testid="btn-mobile-menu"
        >
          {mobileOpen ? <X /> : <Menu />}
        </Button>
      </div>

      {mobileOpen && (
        <div className="md:hidden bg-white border-t border-gray-100 px-4 py-4 space-y-3 shadow-lg">
          {onScrollTo && navLinks.map(link => (
            <button
              key={link.anchor}
              onClick={() => { onScrollTo(link.anchor); setMobileOpen(false); }}
              className="block w-full text-left text-sm font-medium text-gray-600 hover:text-gray-900 py-2"
              data-testid={`link-mobile-${link.anchor}`}
            >
              {link.label}
            </button>
          ))}
          <Button
            size="sm"
            className="w-full rounded-full bg-gray-900 text-white hover:bg-gray-800"
            onClick={() => { onScrollTo?.("oportunidades"); setMobileOpen(false); }}
            data-testid="btn-cta-mobile"
          >
            Explorar
          </Button>
        </div>
      )}
    </nav>
  );
}

function ListingGrid() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [priceFilter, setPriceFilter] = useState("");
  const [ufFilter, setUfFilter] = useState("");

  const oportunidadesRef = useRef<HTMLDivElement>(null);
  const sobreRef = useRef<HTMLDivElement>(null);
  const comoFuncionaRef = useRef<HTMLDivElement>(null);
  const contatoRef = useRef<HTMLDivElement>(null);

  const scrollTo = (id: string) => {
    const refs: Record<string, React.RefObject<HTMLDivElement | null>> = {
      oportunidades: oportunidadesRef,
      sobre: sobreRef,
      "como-funciona": comoFuncionaRef,
      contato: contatoRef,
    };
    refs[id]?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const { data: orgSettings } = useQuery<any>({
    queryKey: ["/api/org/settings"],
    queryFn: () => fetchPublic("/api/org/settings"),
  });

  const portalHeroImage = orgSettings?.portal_hero_image || null;
  const portalTitle = orgSettings?.portal_title || null;
  const portalSubtitle = orgSettings?.portal_subtitle || null;
  const portalWhyTitle = orgSettings?.portal_why_title || null;
  const portalWhyBullets: string[] = Array.isArray(orgSettings?.portal_why_bullets) ? orgSettings.portal_why_bullets : [];
  const portalAccentColor = orgSettings?.portal_accent_color || null;
  const portalContact = orgSettings?.portal_contact && typeof orgSettings.portal_contact === "object" ? orgSettings.portal_contact : null;

  const { data: listings = [], isLoading } = useQuery<any[]>({
    queryKey: ["public-listings"],
    queryFn: () => fetchPublic("/api/public/listings"),
  });

  const ufs = useMemo(() => {
    const set = new Set<string>();
    (listings as any[]).forEach(l => { if (l.asset?.estado) set.add(l.asset.estado); });
    return Array.from(set).sort();
  }, [listings]);

  const assetTypes = useMemo(() => {
    return Array.from(new Set((listings as any[]).filter(l => l.asset?.type).map(l => l.asset.type)));
  }, [listings]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    (listings as any[]).forEach(l => {
      if (l.asset?.type) counts[l.asset.type] = (counts[l.asset.type] || 0) + 1;
    });
    return counts;
  }, [listings]);

  const stats = useMemo(() => {
    const totalAssets = listings.length;
    const totalArea = (listings as any[]).reduce((sum, l) => sum + (Number(l.asset?.areaHa) || 0), 0);
    const categories = assetTypes.length;
    const totalValue = (listings as any[]).reduce((sum, l) => sum + (Number(l.asset?.priceAsking) || 0), 0);
    return { totalAssets, totalArea, categories, totalValue };
  }, [listings, assetTypes]);

  const filtered = useMemo(() => {
    return (listings as any[]).filter(l => {
      if (typeFilter && l.asset?.type !== typeFilter) return false;
      if (ufFilter && l.asset?.estado !== ufFilter) return false;
      if (priceFilter) {
        const [min, max] = priceFilter.split("-").map(Number);
        const price = Number(l.asset?.priceAsking) || 0;
        if (price < min || price > max) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        return l.title?.toLowerCase().includes(q) ||
          l.asset?.estado?.toLowerCase().includes(q) ||
          l.asset?.municipio?.toLowerCase().includes(q) ||
          l.description?.toLowerCase().includes(q);
      }
      return true;
    }).sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [listings, typeFilter, ufFilter, priceFilter, search]);

  return (
    <div className="min-h-screen bg-white">
      <Navbar onScrollTo={scrollTo} transparent />

      <section className="relative min-h-[90vh] flex items-center overflow-hidden" data-testid="section-hero">
        <div className="absolute inset-0">
          <img src={portalHeroImage || heroImg} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 md:px-8 w-full py-24">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 mb-6">
              <div className="h-px w-8 bg-white/50" />
              <span className="text-white/70 text-sm font-medium tracking-widest uppercase" data-testid="badge-hero-tag">
                Plataforma de Investimentos
              </span>
            </div>

            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-white leading-[1.1] tracking-tight" data-testid="portal-hero-title">
              {portalTitle ? (
                portalTitle
              ) : (
                <>Invest<br /><span className="text-white/90">with Purpose</span></>
              )}
            </h1>

            <p className="text-white/60 mt-6 text-base md:text-lg max-w-lg leading-relaxed" data-testid="text-hero-subtitle">
              {portalSubtitle || "Oportunidades exclusivas em Real Estate, Mineração, Agronegócio e M&A. Ativos verificados e curados para investidores qualificados."}
            </p>

            <div className="flex flex-wrap gap-3 mt-10">
              <Button
                size="lg"
                className="rounded-full px-8 font-semibold text-sm h-12"
                style={portalAccentColor ? { backgroundColor: portalAccentColor, color: "#fff" } : { backgroundColor: "#fff", color: "#111" }}
                onClick={() => scrollTo("oportunidades")}
                data-testid="btn-cta-hero"
              >
                Explorar Oportunidades
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="rounded-full px-8 border-white/30 text-white bg-white/10 backdrop-blur-sm font-medium text-sm h-12"
                onClick={() => scrollTo("como-funciona")}
                data-testid="btn-como-funciona-hero"
              >
                Como Funciona
              </Button>
            </div>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-100">
          <div className="max-w-7xl mx-auto px-4 md:px-8 py-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
              <div className="text-center" data-testid="stat-total-ativos">
                <p className="text-2xl md:text-3xl font-bold text-gray-900">{stats.totalAssets}</p>
                <p className="text-gray-500 text-xs mt-1 font-medium">Ativos Publicados</p>
              </div>
              <div className="text-center" data-testid="stat-valor-total">
                <p className="text-2xl md:text-3xl font-bold text-gray-900">
                  {stats.totalValue > 0 ? `${(stats.totalValue / 1_000_000).toFixed(0)}M` : "—"}
                </p>
                <p className="text-gray-500 text-xs mt-1 font-medium">Volume (R$)</p>
              </div>
              <div className="text-center" data-testid="stat-area-total">
                <p className="text-2xl md:text-3xl font-bold text-gray-900">
                  {stats.totalArea > 0 ? `${(stats.totalArea / 1000).toFixed(0)}K` : "—"}
                </p>
                <p className="text-gray-500 text-xs mt-1 font-medium">Hectares</p>
              </div>
              <div className="text-center" data-testid="stat-categorias">
                <p className="text-2xl md:text-3xl font-bold text-gray-900">{stats.categories}</p>
                <p className="text-gray-500 text-xs mt-1 font-medium">Categorias</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 md:py-24 bg-gray-50" data-testid="section-tagline">
        <div className="max-w-7xl mx-auto px-4 md:px-8 text-center">
          <div className="flex items-center justify-center gap-3 mb-6">
            <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
            <span className="text-sm font-medium text-gray-500 tracking-wide">Mavrion Conect</span>
            <span className="text-sm text-gray-400">•</span>
            <span className="text-sm text-gray-500">{stats.totalAssets > 0 ? `${stats.totalAssets}+ Ativos` : "Plataforma Premium"}</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-bold text-gray-900 leading-tight max-w-3xl mx-auto">
            Investimentos Inteligentes
            <br />
            <span className="text-gray-400">em Ativos Reais</span>
          </h2>
          <div className="flex items-center justify-center mt-8">
            <div className="flex items-center gap-1">
              {Array.from({ length: 20 }).map((_, i) => (
                <div key={i} className={cn("w-2 h-2 rounded-full", i === 10 ? "w-3 h-3 bg-gray-900" : "bg-gray-300")} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section ref={comoFuncionaRef} id="como-funciona" className="py-20 md:py-24 bg-white" data-testid="section-como-funciona">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="flex flex-col md:flex-row gap-12 md:gap-20">
            <div className="md:w-2/5">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs font-bold text-gray-400 tracking-widest">01. COMO FUNCIONA</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 leading-tight">
                Processo Simples
                <br />
                <span className="text-gray-400">e Transparente</span>
              </h2>
              <p className="text-gray-500 mt-4 leading-relaxed">
                Conectamos investidores qualificados a oportunidades verificadas. 
                Nosso processo é desenhado para ser rápido, seguro e eficiente.
              </p>
              <Button
                className="mt-6 rounded-full px-6 bg-gray-900 text-white hover:bg-gray-800"
                onClick={() => scrollTo("oportunidades")}
              >
                Ver Oportunidades
              </Button>
            </div>

            <div className="md:w-3/5 grid gap-6">
              {[
                { step: "01", icon: Search, title: "Explore Oportunidades", desc: "Navegue pelo catálogo de ativos verificados com filtros avançados por tipo, região e faixa de preço." },
                { step: "02", icon: Send, title: "Demonstre Interesse", desc: "Encontrou uma oportunidade? Preencha o formulário para receber informações detalhadas e análise completa." },
                { step: "03", icon: Mail, title: "Receba Assessoria", desc: "Nossa equipe entra em contato com documentação completa, análise de viabilidade e acompanhamento dedicado." },
              ].map((item, i) => (
                <div key={i} className="flex gap-5 items-start group" data-testid={`card-step-${i + 1}`}>
                  <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center shrink-0 group-hover:bg-gray-900 group-hover:text-white transition-colors">
                    <item.icon className="w-6 h-6 text-gray-600 group-hover:text-white transition-colors" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-gray-400 tracking-widest">PASSO {item.step}</span>
                    <h3 className="text-lg font-semibold text-gray-900 mt-0.5">{item.title}</h3>
                    <p className="text-sm text-gray-500 mt-1 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section ref={sobreRef} id="sobre" className="py-20 md:py-24 bg-gray-950" data-testid="section-sobre">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="text-center mb-14">
            <span className="text-xs font-bold text-gray-500 tracking-widest">02. POR QUE NÓS</span>
            <h2 className="text-3xl md:text-4xl font-bold text-white mt-3" data-testid="text-sobre-title">
              {portalWhyTitle || "Por que Investir Conosco"}
            </h2>
            {portalWhyBullets.length > 0 ? (
              <ul className="text-gray-400 mt-4 max-w-xl mx-auto space-y-2">
                {portalWhyBullets.map((bullet, i) => (
                  <li key={i} className="flex items-center gap-2 justify-center" data-testid={`text-why-bullet-${i}`}>
                    <CheckCircle2 className="w-4 h-4 shrink-0" style={portalAccentColor ? { color: portalAccentColor } : undefined} />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-400 mt-3 max-w-xl mx-auto">
                Confiança, transparência e assessoria especializada em cada etapa do processo.
              </p>
            )}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: FileCheck, title: "Diligência Completa", desc: "Todos os ativos passam por processo rigoroso de verificação documental e análise técnica." },
              { icon: Shield, title: "Ativos Verificados", desc: "Garantia de procedência e conformidade legal em todas as oportunidades publicadas." },
              { icon: Users, title: "Assessoria Dedicada", desc: "Time especializado para acompanhar cada etapa da negociação com suporte personalizado." },
              { icon: Eye, title: "Transparência Total", desc: "Acesso a informações claras e detalhadas sobre cada oportunidade de investimento." },
            ].map((item, i) => (
              <div key={i} className="p-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors" data-testid={`card-trust-${i}`}>
                <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center mb-4" style={portalAccentColor ? { backgroundColor: portalAccentColor + "22" } : undefined}>
                  <item.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="font-semibold text-white">{item.title}</h3>
                <p className="text-sm text-gray-400 mt-2 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section ref={oportunidadesRef} id="oportunidades" className="py-20 md:py-24 bg-white" data-testid="section-oportunidades">
        <div className="max-w-7xl mx-auto px-4 md:px-8 space-y-8">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <span className="text-xs font-bold text-gray-400 tracking-widest">OPORTUNIDADES</span>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mt-2" data-testid="text-oportunidades-title">
                Ativos Disponíveis
              </h2>
              <p className="text-gray-500 mt-2">
                Encontre o investimento ideal para o seu perfil.
              </p>
            </div>
            <p className="text-sm text-gray-400 font-medium" data-testid="text-result-count">
              {filtered.length} {filtered.length === 1 ? "oportunidade" : "oportunidades"}
            </p>
          </div>

          <div className="bg-gray-50 rounded-2xl p-4 md:p-5">
            <div className="flex flex-col md:flex-row gap-3 items-stretch">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Buscar por localização, tipo..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-10 h-11 bg-white border-gray-200 rounded-xl"
                  data-testid="input-portal-search"
                />
              </div>
              <Select value={typeFilter || "all"} onValueChange={v => setTypeFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-full md:w-[180px] h-11 bg-white border-gray-200 rounded-xl" data-testid="select-type-filter">
                  <SelectValue placeholder="Categoria" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas categorias</SelectItem>
                  {assetTypes.map(t => (
                    <SelectItem key={t} value={t}>{TIPO_LABEL[t] || t} ({typeCounts[t] || 0})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={priceFilter || "all"} onValueChange={v => setPriceFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-full md:w-[180px] h-11 bg-white border-gray-200 rounded-xl" data-testid="select-price-filter">
                  <SelectValue placeholder="Faixa de preço" />
                </SelectTrigger>
                <SelectContent>
                  {PRICE_RANGES.map(r => (
                    <SelectItem key={r.value || "all"} value={r.value || "all"}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={ufFilter || "all"} onValueChange={v => setUfFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-full md:w-[150px] h-11 bg-white border-gray-200 rounded-xl" data-testid="select-uf-filter">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos estados</SelectItem>
                  {ufs.map(uf => (
                    <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                className="h-11 rounded-xl px-6 font-medium"
                style={portalAccentColor ? { backgroundColor: portalAccentColor, color: "#fff" } : { backgroundColor: "#111", color: "#fff" }}
                onClick={() => scrollTo("oportunidades")}
                data-testid="btn-discover"
              >
                Descobrir
              </Button>
            </div>
            {(typeFilter || priceFilter || ufFilter || search) && (
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-200">
                <span className="text-xs text-gray-400">Filtros ativos:</span>
                {typeFilter && (
                  <Badge variant="secondary" className="text-xs cursor-pointer" onClick={() => setTypeFilter("")}>
                    {TIPO_LABEL[typeFilter] || typeFilter} ×
                  </Badge>
                )}
                {priceFilter && (
                  <Badge variant="secondary" className="text-xs cursor-pointer" onClick={() => setPriceFilter("")}>
                    {PRICE_RANGES.find(r => r.value === priceFilter)?.label} ×
                  </Badge>
                )}
                {ufFilter && (
                  <Badge variant="secondary" className="text-xs cursor-pointer" onClick={() => setUfFilter("")}>
                    {ufFilter} ×
                  </Badge>
                )}
                {search && (
                  <Badge variant="secondary" className="text-xs cursor-pointer" onClick={() => setSearch("")}>
                    "{search}" ×
                  </Badge>
                )}
                <button
                  className="text-xs text-gray-400 hover:text-gray-600 ml-auto"
                  onClick={() => { setTypeFilter(""); setPriceFilter(""); setUfFilter(""); setSearch(""); }}
                  data-testid="btn-clear-filters"
                >
                  Limpar todos
                </button>
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {[1,2,3].map(i => (
                <div key={i} className="rounded-2xl bg-gray-100 animate-pulse h-[360px]" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20">
              <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <Search className="w-7 h-7 text-gray-300" />
              </div>
              <p className="text-gray-500 font-medium">Nenhuma oportunidade encontrada</p>
              <p className="text-gray-400 text-sm mt-1">Tente ajustar os filtros de busca</p>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((listing: any) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section ref={contatoRef} id="contato" data-testid="section-contato">
        <footer className="bg-gray-950 text-white py-16 md:py-20">
          <div className="max-w-7xl mx-auto px-4 md:px-8">
            <div className="grid md:grid-cols-4 gap-8 md:gap-12">
              <div className="md:col-span-2">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center">
                    <Zap className="w-5 h-5 text-gray-900 fill-current" />
                  </div>
                  <span className="text-lg font-bold">Mavrion Conect</span>
                </div>
                <p className="text-gray-400 text-sm leading-relaxed max-w-md">
                  Plataforma de originação de negócios e investimentos. Conectamos investidores a oportunidades verificadas em Real Estate, Mineração, Agronegócio e M&A.
                </p>
              </div>
              <div>
                <h4 className="font-semibold mb-4 text-sm text-gray-300 uppercase tracking-wider">Links</h4>
                <ul className="space-y-2.5 text-sm">
                  {[
                    { label: "Oportunidades", anchor: "oportunidades" },
                    { label: "Como Funciona", anchor: "como-funciona" },
                    { label: "Sobre Nós", anchor: "sobre" },
                  ].map(link => (
                    <li key={link.anchor}>
                      <button onClick={() => scrollTo(link.anchor)} className="text-gray-500 hover:text-white transition-colors">
                        {link.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-4 text-sm text-gray-300 uppercase tracking-wider">
                  {portalContact ? "Contato" : "Legal"}
                </h4>
                {portalContact && (portalContact.email || portalContact.phone || portalContact.whatsapp) ? (
                  <ul className="space-y-2.5 text-sm text-gray-500">
                    {portalContact.email && (
                      <li className="flex items-center gap-2" data-testid="footer-contact-email">
                        <Mail className="w-3.5 h-3.5 shrink-0" />
                        <a href={`mailto:${portalContact.email}`} className="hover:text-white transition-colors">{portalContact.email}</a>
                      </li>
                    )}
                    {portalContact.phone && (
                      <li className="flex items-center gap-2" data-testid="footer-contact-phone">
                        <Phone className="w-3.5 h-3.5 shrink-0" />
                        <a href={`tel:${portalContact.phone}`} className="hover:text-white transition-colors">{portalContact.phone}</a>
                      </li>
                    )}
                    {portalContact.whatsapp && (
                      <li className="flex items-center gap-2" data-testid="footer-contact-whatsapp">
                        <Phone className="w-3.5 h-3.5 shrink-0" />
                        <a href={`https://wa.me/${portalContact.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">WhatsApp: {portalContact.whatsapp}</a>
                      </li>
                    )}
                  </ul>
                ) : (
                  <p className="text-gray-500 text-sm leading-relaxed">
                    Todas as informações são de caráter informativo e estão sujeitas a verificação antes de qualquer decisão de investimento.
                  </p>
                )}
              </div>
            </div>
            <div className="border-t border-white/10 mt-12 pt-6 flex flex-col md:flex-row items-center justify-between gap-3">
              <p className="text-gray-600 text-xs" data-testid="text-footer-copyright">
                © {new Date().getFullYear()} Mavrion Conect — Plataforma de Originação de Negócios
              </p>
              <div className="flex items-center gap-1 text-gray-600 text-xs">
                <Shield className="w-3 h-3" />
                <span>Seus dados estão protegidos</span>
              </div>
            </div>
          </div>
        </footer>
      </section>
    </div>
  );
}

function ListingCard({ listing }: { listing: any }) {
  const asset = listing.asset;
  const TIcon = asset ? (TIPO_ICON[asset.type] || Layers) : Layers;
  const color = asset ? (TIPO_COLOR[asset.type] || "") : "";
  const listingIsNew = isNew(listing);

  return (
    <Link href={`/portal/${listing.id}`}>
      <div
        className="group bg-white rounded-2xl border border-gray-200 overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer"
        data-testid={`portal-card-${listing.id}`}
      >
        <div className="relative h-52 overflow-hidden bg-gray-100">
          {listing.featuredImage ? (
            <img
              src={listing.featuredImage}
              alt={listing.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
              <TIcon className="w-16 h-16 text-gray-300 group-hover:text-gray-400 transition-colors" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="absolute top-3 left-3 flex gap-2">
            {asset?.type && (
              <span className={cn("text-[11px] font-semibold px-2.5 py-1 rounded-full backdrop-blur-sm", color)}>
                {TIPO_LABEL[asset.type] || asset.type}
              </span>
            )}
            {listingIsNew && (
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-500 text-white" data-testid={`badge-new-${listing.id}`}>
                Novo
              </span>
            )}
          </div>
          {listing.visibilityLevel === "teaser" && (
            <div className="absolute top-3 right-3">
              <div className="w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
                <Lock className="w-3.5 h-3.5 text-white" />
              </div>
            </div>
          )}
        </div>

        <div className="p-5 space-y-3">
          <h3 className="font-semibold text-gray-900 group-hover:text-gray-700 transition-colors line-clamp-1 text-[15px]" data-testid={`text-title-${listing.id}`}>
            {listing.title}
          </h3>
          {listing.description && (
            <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{listing.description}</p>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
            {asset?.estado && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {asset.municipio ? `${asset.municipio}, ${asset.estado}` : asset.estado}
              </span>
            )}
            {asset?.areaHa && (
              <span className="flex items-center gap-1">
                <Ruler className="w-3 h-3" />
                {Number(asset.areaHa).toLocaleString("pt-BR")} ha
              </span>
            )}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-gray-100">
            {asset?.priceAsking ? (
              <span className="text-sm font-bold text-gray-900" data-testid={`text-price-${listing.id}`}>
                {formatPrice(asset.priceAsking)}
              </span>
            ) : (
              <span className="text-sm font-medium text-gray-400 italic">
                Sob consulta
              </span>
            )}
            <span className="text-xs text-gray-400 flex items-center gap-1 group-hover:text-gray-600 transition-colors">
              Ver detalhes <ArrowRight className="w-3 h-3" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function ListingDetail({ id }: { id: number }) {
  const [submitted, setSubmitted] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [galleryIdx, setGalleryIdx] = useState(0);

  const { data: listing, isLoading } = useQuery<any>({
    queryKey: ["public-listing", id],
    queryFn: () => fetchPublic(`/api/public/listings/${id}`),
  });

  const inquiryMutation = useMutation({
    mutationFn: (data: any) =>
      fetch("/api/public/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: () => setSubmitted(true),
  });

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="animate-spin h-8 w-8 border-4 border-gray-900 border-t-transparent rounded-full" />
    </div>
  );
  if (!listing) return (
    <div className="min-h-screen flex items-center justify-center text-gray-500 bg-white">Oportunidade não encontrada.</div>
  );

  const asset = listing.asset;
  const TIcon = asset ? (TIPO_ICON[asset.type] || Layers) : Layers;
  const color = asset ? (TIPO_COLOR[asset.type] || "") : "";
  const gallery: string[] = listing.featuredImage
    ? [listing.featuredImage, ...(listing.galleryImages || [])]
    : (listing.galleryImages || []);
  const highlights: { label: string; value: string }[] = listing.highlights || [];
  const sections: { type: string; title?: string; content?: string }[] = listing.sectionsConfig || [];

  return (
    <div className="min-h-screen bg-white">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md shadow-sm border-b border-gray-100" data-testid="detail-navbar">
        <div className="max-w-7xl mx-auto px-4 md:px-8 flex items-center justify-between h-16 md:h-20">
          <Link href="/portal">
            <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900 gap-1.5 font-medium" data-testid="btn-voltar">
              <ArrowLeft className="w-4 h-4" /> Voltar
            </Button>
          </Link>
          <Link href="/portal">
            <div className="flex items-center gap-2 cursor-pointer">
              <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center">
                <Zap className="w-4 h-4 text-white fill-current" />
              </div>
              <span className="font-bold text-sm text-gray-900">Mavrion Conect</span>
            </div>
          </Link>
        </div>
      </nav>

      <div className="pt-20 md:pt-24">
        {gallery.length > 0 ? (
          <div className="max-w-7xl mx-auto px-4 md:px-8">
            <div className="relative rounded-3xl overflow-hidden h-[350px] md:h-[500px] bg-gray-100">
              <img
                src={gallery[galleryIdx]}
                alt={listing.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />

              {gallery.length > 1 && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm shadow-lg"
                    onClick={() => setGalleryIdx(i => i > 0 ? i - 1 : gallery.length - 1)}
                    data-testid="btn-gallery-prev"
                  >
                    <ChevronLeft className="w-5 h-5 text-gray-700" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm shadow-lg"
                    onClick={() => setGalleryIdx(i => i < gallery.length - 1 ? i + 1 : 0)}
                    data-testid="btn-gallery-next"
                  >
                    <ChevronRight className="w-5 h-5 text-gray-700" />
                  </Button>
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
                    {gallery.map((_: string, i: number) => (
                      <button
                        key={i}
                        className={cn("w-2 h-2 rounded-full transition-all", i === galleryIdx ? "bg-white w-6" : "bg-white/50")}
                        onClick={() => setGalleryIdx(i)}
                        data-testid={`btn-gallery-dot-${i}`}
                      />
                    ))}
                  </div>
                </>
              )}

              <div className="absolute top-4 left-4 flex gap-2">
                {asset?.type && (
                  <span className={cn("text-xs font-semibold px-3 py-1.5 rounded-full backdrop-blur-sm", color)} data-testid="badge-detail-type">
                    <TIcon className="w-3 h-3 mr-1 inline" />
                    {TIPO_LABEL[asset.type] || asset.type}
                  </span>
                )}
                {isNew(listing) && (
                  <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-500 text-white" data-testid="badge-detail-new">
                    Novo
                  </span>
                )}
              </div>
            </div>

            {gallery.length > 1 && (
              <div className="flex gap-2 mt-3 overflow-x-auto pb-2">
                {gallery.map((img: string, i: number) => (
                  <button
                    key={i}
                    className={cn(
                      "w-20 h-14 rounded-xl overflow-hidden shrink-0 border-2 transition-all",
                      i === galleryIdx ? "border-gray-900 ring-2 ring-gray-900/20" : "border-transparent opacity-60 hover:opacity-100"
                    )}
                    onClick={() => setGalleryIdx(i)}
                  >
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="max-w-7xl mx-auto px-4 md:px-8">
            <div className="rounded-3xl overflow-hidden h-[250px] md:h-[400px] bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
              <TIcon className="w-24 h-24 text-gray-300" />
            </div>
          </div>
        )}

        <div className="max-w-7xl mx-auto px-4 md:px-8 mt-8 md:mt-12">
          <div className="flex flex-col lg:flex-row gap-10">
            <div className="flex-1 lg:w-2/3 space-y-8">
              <div>
                <h1 className="text-3xl md:text-4xl font-bold text-gray-900 leading-tight" data-testid="listing-detail-title">
                  {listing.title}
                </h1>
                {listing.subtitle && (
                  <p className="text-lg text-gray-500 mt-2">{listing.subtitle}</p>
                )}
                {asset?.estado && (
                  <div className="flex items-center gap-1.5 mt-3 text-sm text-gray-400">
                    <MapPin className="w-4 h-4" />
                    {asset.municipio ? `${asset.municipio}, ${asset.estado}` : asset.estado}
                  </div>
                )}
              </div>

              {listing.description && (
                <p className="text-gray-600 leading-relaxed text-[15px]" data-testid="text-detail-description">
                  {listing.description}
                </p>
              )}

              {asset && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {asset.areaHa && (
                    <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100" data-testid="card-detail-area">
                      <Ruler className="w-5 h-5 text-gray-400 mb-2" />
                      <p className="text-xs text-gray-400 font-medium">Área Total</p>
                      <p className="text-lg font-bold text-gray-900 mt-0.5">{Number(asset.areaHa).toLocaleString("pt-BR")} ha</p>
                      {asset.areaUtil && <p className="text-[10px] text-gray-400">Útil: {Number(asset.areaUtil).toLocaleString("pt-BR")} ha</p>}
                    </div>
                  )}
                  <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100" data-testid="card-detail-price">
                    <DollarSign className="w-5 h-5 text-gray-400 mb-2" />
                    <p className="text-xs text-gray-400 font-medium">Valor</p>
                    <p className="text-lg font-bold text-gray-900 mt-0.5">
                      {asset.priceAsking ? formatPrice(asset.priceAsking) : "Sob consulta"}
                    </p>
                  </div>
                  {asset.docsStatus && (
                    <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100" data-testid="card-detail-docs">
                      <CheckCircle2 className="w-5 h-5 text-gray-400 mb-2" />
                      <p className="text-xs text-gray-400 font-medium">Documentação</p>
                      <p className="text-lg font-bold text-gray-900 mt-0.5 capitalize">{asset.docsStatus}</p>
                    </div>
                  )}
                  {asset.type && (
                    <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100">
                      <TIcon className="w-5 h-5 text-gray-400 mb-2" />
                      <p className="text-xs text-gray-400 font-medium">Tipo</p>
                      <p className="text-lg font-bold text-gray-900 mt-0.5">{TIPO_LABEL[asset.type] || asset.type}</p>
                    </div>
                  )}
                </div>
              )}

              {highlights.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold text-gray-900">Destaques</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {highlights.map((h: any, i: number) => (
                      <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                        <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
                        <div>
                          <p className="text-xs text-gray-400">{h.label}</p>
                          <p className="text-sm font-semibold text-gray-900">{h.value}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {asset?.description && (
                <div className="space-y-3" data-testid="card-detail-asset-desc">
                  <h3 className="text-lg font-semibold text-gray-900">Sobre o Ativo</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">{asset.description}</p>
                </div>
              )}

              {sections.map((s: any, i: number) => (
                <div key={i} className="space-y-3">
                  {s.title && <h3 className="text-lg font-semibold text-gray-900">{s.title}</h3>}
                  {s.content && <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-wrap">{s.content}</p>}
                </div>
              ))}

              {asset?.observacoes && (
                <div className="space-y-3" data-testid="card-detail-obs">
                  <h3 className="text-lg font-semibold text-gray-900">Observações</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">{asset.observacoes}</p>
                </div>
              )}

              {(listing.contactEmail || listing.contactPhone) && (
                <div className="p-5 rounded-2xl bg-gray-50 border border-gray-100" data-testid="card-detail-contact">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Contato Direto</h3>
                  <div className="flex flex-wrap gap-4 text-sm">
                    {listing.contactEmail && (
                      <a href={`mailto:${listing.contactEmail}`} className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 transition-colors" data-testid="link-contact-email">
                        <Mail className="w-4 h-4" /> {listing.contactEmail}
                      </a>
                    )}
                    {listing.contactPhone && (
                      <a href={`tel:${listing.contactPhone}`} className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 transition-colors" data-testid="link-contact-phone">
                        <Phone className="w-4 h-4" /> {listing.contactPhone}
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="lg:w-[380px]">
              <div className="sticky top-24 space-y-4">
                <div className="rounded-2xl border border-gray-200 bg-white shadow-lg overflow-hidden" data-testid="card-inquiry-form">
                  <div className="bg-gray-900 p-5">
                    <h3 className="font-semibold text-white text-lg">Demonstrar Interesse</h3>
                    <p className="text-gray-400 text-xs mt-1">Receba informações detalhadas</p>
                  </div>
                  <div className="p-5">
                    {submitted ? (
                      <div className="text-center py-8" data-testid="inquiry-success">
                        <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-4" />
                        <h3 className="text-lg font-bold text-gray-900">Interesse Registrado!</h3>
                        <p className="text-sm text-gray-500 mt-2">
                          Nossa equipe entrará em contato em breve com informações detalhadas.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <Label className="text-xs text-gray-500 font-medium">Nome completo *</Label>
                          <Input value={name} onChange={e => setName(e.target.value)} placeholder="João Silva" className="mt-1 rounded-xl h-10" data-testid="input-inquiry-name" />
                        </div>
                        <div>
                          <Label className="text-xs text-gray-500 font-medium">Email *</Label>
                          <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="joao@empresa.com" className="mt-1 rounded-xl h-10" data-testid="input-inquiry-email" />
                        </div>
                        <div>
                          <Label className="text-xs text-gray-500 font-medium">Telefone</Label>
                          <Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(11) 99999-9999" className="mt-1 rounded-xl h-10" data-testid="input-inquiry-phone" />
                        </div>
                        <div>
                          <Label className="text-xs text-gray-500 font-medium">Empresa</Label>
                          <Input value={company} onChange={e => setCompany(e.target.value)} placeholder="Empresa LTDA" className="mt-1 rounded-xl h-10" data-testid="input-inquiry-company" />
                        </div>
                        <div>
                          <Label className="text-xs text-gray-500 font-medium">Mensagem</Label>
                          <Textarea
                            value={message}
                            onChange={e => setMessage(e.target.value)}
                            placeholder="Tenho interesse neste ativo..."
                            rows={3}
                            className="mt-1 rounded-xl"
                            data-testid="input-inquiry-message"
                          />
                        </div>
                        <Button
                          className="w-full rounded-xl h-11 bg-gray-900 text-white hover:bg-gray-800 font-medium"
                          onClick={() => inquiryMutation.mutate({ listingId: id, name, email, phone, company, message })}
                          disabled={!name.trim() || !email.trim() || inquiryMutation.isPending}
                          data-testid="btn-send-inquiry"
                        >
                          {inquiryMutation.isPending ? "Enviando..." : "Enviar Interesse"}
                          {!inquiryMutation.isPending && <Send className="w-4 h-4 ml-1.5" />}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                  <Shield className="w-3.5 h-3.5" />
                  <span>Seus dados estão protegidos</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="bg-gray-950 text-white py-12 mt-20">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center">
                <Zap className="w-4 h-4 text-gray-900 fill-current" />
              </div>
              <span className="font-bold text-sm">Mavrion Conect</span>
            </div>
            <p className="text-gray-600 text-xs">© {new Date().getFullYear()} Mavrion Conect — Plataforma de Originação de Negócios</p>
            <Link href="/portal" className="text-gray-500 hover:text-white text-sm transition-colors">
              Ver todas oportunidades
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
