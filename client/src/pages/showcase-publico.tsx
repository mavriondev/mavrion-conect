import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  MapPin, Ruler, DollarSign, TreePine, Pickaxe, Briefcase,
  Home, Wheat, Factory, Layers, ChevronLeft, ChevronRight,
  Mountain, Droplets, Zap, CheckCircle2, AlertCircle, Shield,
  Building2, FileText, Globe, Leaf, BarChart3,
  Sun, CloudRain, Thermometer, Wind, Star, Award,
  MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SiWhatsapp } from "react-icons/si";

const TIPO_ICON: Record<string, any> = {
  TERRA: TreePine, MINA: Pickaxe, NEGOCIO: Briefcase,
  FII_CRI: Home, DESENVOLVIMENTO: Factory, AGRO: Wheat,
};
const TIPO_LABEL: Record<string, string> = {
  TERRA: "Terras & Fazendas", MINA: "Mineração", NEGOCIO: "Negócio M&A",
  FII_CRI: "FII / CRI / Imóveis", DESENVOLVIMENTO: "Desenvolvimento", AGRO: "Agronegócio",
};
const TIPO_COLOR: Record<string, string> = {
  TERRA: "bg-green-600", MINA: "bg-orange-600",
  NEGOCIO: "bg-blue-600", FII_CRI: "bg-purple-600",
  DESENVOLVIMENTO: "bg-cyan-600", AGRO: "bg-amber-600",
};

function formatBRL(v: any) {
  if (!v) return null;
  const n = Number(v);
  if (isNaN(n)) return null;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function formatArea(v: any) {
  if (!v) return null;
  return `${Number(v).toLocaleString("pt-BR")} ha`;
}

function fetchPublic(url: string) {
  return fetch(url).then(r => { if (!r.ok) throw new Error("Erro"); return r.json(); });
}

function SectionTitle({ children, icon: Icon }: { children: any; icon?: any }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      {Icon && <Icon className="w-5 h-5 text-gray-400" />}
      <h2 className="text-lg font-bold text-gray-900">{children}</h2>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, color }: { label: string; value: any; icon?: any; color?: string }) {
  if (!value && value !== 0) return null;
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        {Icon && <Icon className={cn("w-4 h-4", color || "text-gray-400")} />}
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-lg font-bold text-gray-900 break-all" title={typeof value === 'string' ? value : undefined}>{typeof value === 'string' && value.length > 20 ? <span className="text-sm">{value}</span> : value}</p>
    </div>
  );
}

function StatusBadge({ ok, labelOk, labelBad }: { ok: boolean; labelOk: string; labelBad: string }) {
  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium",
      ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
    )}>
      {ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
      {ok ? labelOk : labelBad}
    </div>
  );
}

function DataBox({ label, value, span2 }: { label: string; value: any; span2?: boolean }) {
  if (!value && value !== 0) return null;
  return (
    <div className={cn("p-3 rounded-lg bg-gray-50", span2 && "col-span-2")}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-bold text-gray-900 text-sm">{value}</p>
    </div>
  );
}

export default function ShowcasePublico({ id }: { id: string }) {
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [dollar, setDollar] = useState<any>(null);
  const [weather, setWeather] = useState<any>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL")
      .then(r => r.json())
      .then(d => setDollar(d.USDBRL))
      .catch(() => {});
  }, []);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["showcase", id],
    queryFn: () => fetchPublic(`/api/public/showcase/${id}`),
  });

  useEffect(() => {
    if (!data?.geometry) return;
    try {
      const coords = data.geometry.coordinates;
      let lat: number | null = null;
      let lon: number | null = null;
      if (data.geometry.type === "Point") { lon = coords[0]; lat = coords[1]; }
      else if (data.geometry.type === "Polygon") { lon = coords[0][0][0]; lat = coords[0][0][1]; }
      else if (data.geometry.type === "MultiPolygon") { lon = coords[0][0][0][0]; lat = coords[0][0][0][1]; }
      if (lat && lon) {
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=America/Sao_Paulo&forecast_days=3`)
          .then(r => r.json())
          .then(w => setWeather(w))
          .catch(() => {});
      }
    } catch {}
  }, [data?.geometry]);

  useEffect(() => {
    if (!data?.geometry || !mapRef.current || mapInstanceRef.current) return;
    import("leaflet").then(L => {
      const linkEl = document.createElement("link");
      linkEl.rel = "stylesheet";
      linkEl.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(linkEl);

      setTimeout(() => {
        if (!mapRef.current) return;
        const map = L.map(mapRef.current, { scrollWheelZoom: false, zoomControl: true });
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
          attribution: "Esri Satellite",
        }).addTo(map);
        const geoLayer = L.geoJSON(data.geometry, {
          style: { color: "#f59e0b", weight: 3, fillColor: "#fbbf24", fillOpacity: 0.2 },
        }).addTo(map);
        map.fitBounds(geoLayer.getBounds(), { padding: [40, 40] });
        mapInstanceRef.current = map;
      }, 200);
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [data?.geometry]);

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-spin h-8 w-8 border-4 border-gray-900 border-t-transparent rounded-full" />
    </div>
  );

  if (!data) return (
    <div className="min-h-screen flex flex-col items-center justify-center text-gray-500 bg-gray-50 gap-4">
      <Layers className="w-16 h-16 text-gray-300" />
      <p className="text-lg font-medium">Ativo não encontrado</p>
    </div>
  );

  const d = data;
  const fotos: string[] = d.fotos || [];
  const TIcon = TIPO_ICON[d.type] || Layers;
  const accentColor = TIPO_COLOR[d.type] || "bg-gray-600";
  const hasGeo = d.geoAltMed || d.geoAltMin || d.geoDecliv || d.geoTemRio != null || d.geoDistAgua || d.geoDistEnergia;
  const hasSolo = d.embrapa?.solo;
  const hasClima = d.embrapa?.clima;
  const hasNdvi = d.embrapa?.ndvi;
  const hasAnm = d.anmProcesso;
  const hasCertidoes = d.certidoesData;
  const hasEmpresa = d.empresa?.tradeName;

  const WMO_WEATHER: Record<number, { label: string; icon: any }> = {
    0: { label: "Céu limpo", icon: Sun },
    1: { label: "Poucas nuvens", icon: Sun },
    2: { label: "Parcialmente nublado", icon: CloudRain },
    3: { label: "Nublado", icon: CloudRain },
    45: { label: "Nevoeiro", icon: CloudRain },
    48: { label: "Nevoeiro com geada", icon: CloudRain },
    51: { label: "Garoa leve", icon: CloudRain },
    53: { label: "Garoa moderada", icon: CloudRain },
    55: { label: "Garoa forte", icon: CloudRain },
    61: { label: "Chuva leve", icon: CloudRain },
    63: { label: "Chuva moderada", icon: CloudRain },
    65: { label: "Chuva forte", icon: CloudRain },
    71: { label: "Neve leve", icon: CloudRain },
    80: { label: "Pancadas leves", icon: CloudRain },
    81: { label: "Pancadas moderadas", icon: CloudRain },
    82: { label: "Pancadas fortes", icon: CloudRain },
    95: { label: "Tempestade", icon: Zap },
  };

  return (
    <div className="min-h-screen bg-gray-50" data-testid="showcase-page">
      <nav
        className={cn(
          "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
          scrolled ? "bg-white/95 backdrop-blur-md shadow-sm border-b" : "bg-transparent"
        )}
        data-testid="showcase-navbar"
      >
        <div className="max-w-6xl mx-auto px-4 md:px-8 flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            {d.logoUrl && <img src={d.logoUrl} alt="" className="h-8 w-auto" />}
            <span className={cn("font-bold text-sm", scrolled ? "text-gray-900" : "text-white")}>{d.companyName}</span>
          </div>
          {dollar && (
            <div className={cn("text-xs font-medium px-2.5 py-1 rounded-full", scrolled ? "bg-gray-100 text-gray-700" : "bg-white/20 text-white backdrop-blur-sm")} data-testid="text-dollar">
              <DollarSign className="w-3 h-3 inline mr-0.5" />
              Cotação Dólar: R$ {Number(dollar.bid).toFixed(2)}
            </div>
          )}
        </div>
      </nav>

      {fotos.length > 0 ? (
        <div className="relative w-full h-[400px] md:h-[520px]" data-testid="showcase-hero">
          <img
            src={fotos[galleryIdx]}
            alt={d.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/10" />

          {fotos.length > 1 && (
            <>
              <button
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm shadow-lg flex items-center justify-center"
                onClick={() => setGalleryIdx(i => i > 0 ? i - 1 : fotos.length - 1)}
                data-testid="btn-gallery-prev"
              >
                <ChevronLeft className="w-5 h-5 text-gray-700" />
              </button>
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm shadow-lg flex items-center justify-center"
                onClick={() => setGalleryIdx(i => i < fotos.length - 1 ? i + 1 : 0)}
                data-testid="btn-gallery-next"
              >
                <ChevronRight className="w-5 h-5 text-gray-700" />
              </button>
              <div className="absolute bottom-20 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
                {fotos.map((_: string, i: number) => (
                  <button
                    key={i}
                    className={cn("w-2 h-2 rounded-full transition-all", i === galleryIdx ? "bg-white w-6" : "bg-white/50")}
                    onClick={() => setGalleryIdx(i)}
                  />
                ))}
              </div>
            </>
          )}

          <div className="absolute bottom-0 left-0 right-0 p-6 md:p-10">
            <div className="max-w-6xl mx-auto">
              <span className={cn("text-xs font-semibold px-3 py-1.5 rounded-full text-white inline-flex items-center gap-1 mb-3", accentColor)} data-testid="badge-type">
                <TIcon className="w-3 h-3" />
                {TIPO_LABEL[d.type] || d.type}
              </span>
              <h1 className="text-3xl md:text-5xl font-bold text-white leading-tight" data-testid="text-title">{d.title}</h1>
              {(d.municipio || d.estado) && (
                <div className="flex items-center gap-1.5 mt-3 text-white/70 text-sm">
                  <MapPin className="w-4 h-4" />
                  {d.municipio ? `${d.municipio}, ${d.estado}` : d.estado}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className={cn("relative w-full h-[300px] md:h-[400px] flex items-end", accentColor)} data-testid="showcase-hero-fallback">
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="relative z-10 p-6 md:p-10 max-w-6xl mx-auto w-full pt-24">
            <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white/20 text-white inline-flex items-center gap-1 mb-3 backdrop-blur-sm" data-testid="badge-type">
              <TIcon className="w-3 h-3" />
              {TIPO_LABEL[d.type] || d.type}
            </span>
            <h1 className="text-3xl md:text-5xl font-bold text-white leading-tight" data-testid="text-title">{d.title}</h1>
            {(d.municipio || d.estado) && (
              <div className="flex items-center gap-1.5 mt-3 text-white/70 text-sm">
                <MapPin className="w-4 h-4" />
                {d.municipio ? `${d.municipio}, ${d.estado}` : d.estado}
              </div>
            )}
          </div>
        </div>
      )}

      {fotos.length > 1 && (
        <div className="max-w-6xl mx-auto px-4 md:px-8 mt-4">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {fotos.map((img: string, i: number) => (
              <button
                key={i}
                className={cn(
                  "w-20 h-14 rounded-xl overflow-hidden shrink-0 border-2 transition-all",
                  i === galleryIdx ? "border-gray-900 ring-2 ring-gray-900/20" : "border-transparent opacity-60 hover:opacity-100"
                )}
                onClick={() => setGalleryIdx(i)}
                data-testid={`btn-thumb-${i}`}
              >
                <img src={img} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 md:py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-10" data-testid="metrics-grid">
          <MetricCard label="Preço" value={formatBRL(d.priceAsking)} icon={DollarSign} color="text-green-600" />
          <MetricCard label="Área Total" value={formatArea(d.areaHa)} icon={Ruler} color="text-blue-600" />
          <MetricCard label="Área Útil" value={formatArea(d.areaUtil)} icon={Ruler} color="text-cyan-600" />
          <MetricCard label="Localização" value={d.municipio ? `${d.municipio}/${d.estado}` : d.estado} icon={MapPin} color="text-orange-600" />
          {d.priceAsking && d.areaHa && (
            <MetricCard label="R$/Hectare" value={formatBRL(d.priceAsking / d.areaHa)} icon={BarChart3} color="text-purple-600" />
          )}
          {d.carCodImovel && <MetricCard label="Código CAR" value={d.carCodImovel} icon={Leaf} color="text-green-600" />}
          {d.anmProcesso && <MetricCard label="Processo ANM" value={d.anmProcesso} icon={Pickaxe} color="text-orange-600" />}
          {d.geoScore != null && <MetricCard label="Score Geo" value={`${d.geoScore}/100`} icon={Star} color="text-yellow-600" />}
        </div>

        {d.tags?.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            {d.tags.map((t: string, i: number) => (
              <Badge key={i} variant="secondary" className="text-xs">{t}</Badge>
            ))}
          </div>
        )}

        {d.description && (
          <div className="mb-10 bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <SectionTitle icon={FileText}>Sobre o Ativo</SectionTitle>
            <p className="text-gray-600 leading-relaxed whitespace-pre-wrap" data-testid="text-description">{d.description}</p>
          </div>
        )}

        {d.embrapa?.resumo && (
          <div className="mb-10 bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <SectionTitle icon={Leaf}>Resumo Agronômico (Embrapa)</SectionTitle>
            <p className="text-gray-600 leading-relaxed text-sm" data-testid="text-resumo-agro">{d.embrapa.resumo}</p>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6 mb-10">
          {d.geometry && (
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm md:col-span-2" data-testid="section-map">
              <div className="p-6 pb-3">
                <SectionTitle icon={Globe}>Localização & Polígono</SectionTitle>
              </div>
              <div ref={mapRef} className="w-full h-[400px]" data-testid="map-container" />
            </div>
          )}

          {hasGeo && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm" data-testid="section-geo">
              <SectionTitle icon={Mountain}>Dados Geográficos</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <DataBox label="Altitude Média" value={d.geoAltMed ? `${Math.round(d.geoAltMed)} m` : null} />
                <DataBox label="Altitude Min/Max" value={d.geoAltMin != null && d.geoAltMax != null ? `${Math.round(d.geoAltMin)} — ${Math.round(d.geoAltMax)} m` : null} />
                <DataBox label="Declividade Média" value={d.geoDecliv != null ? `${d.geoDecliv.toFixed(1)}°` : null} />
                <DataBox label="Próximo a Rio/Córrego" value={d.geoTemRio != null ? (d.geoTemRio ? "Sim" : "Não") : null} />
                <DataBox label="Próximo a Lago/Represa" value={d.geoTemLago != null ? (d.geoTemLago ? "Sim" : "Não") : null} />
                <DataBox label="Dist. Água" value={d.geoDistAgua ? `${(d.geoDistAgua / 1000).toFixed(1)} km` : null} />
                <DataBox label="Dist. Energia" value={d.geoDistEnergia ? `${(d.geoDistEnergia / 1000).toFixed(1)} km` : null} />
                {d.geoScoreEnergia != null && <DataBox label="Score Energia" value={`${d.geoScoreEnergia}/100`} />}
              </div>
            </div>
          )}

          {hasSolo && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm" data-testid="section-solo">
              <SectionTitle icon={Leaf}>Análise de Solo</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <DataBox label="Classificação" value={d.embrapa.solo.classificacao} span2 />
                <DataBox label="Textura" value={d.embrapa.solo.textura} />
                <DataBox label="pH" value={d.embrapa.solo.ph} />
                <DataBox label="Argila" value={d.embrapa.solo.argila != null ? `${d.embrapa.solo.argila}%` : null} />
                <DataBox label="Areia" value={d.embrapa.solo.areia != null ? `${d.embrapa.solo.areia}%` : null} />
                <DataBox label="CEC" value={d.embrapa.solo.cec} />
                <DataBox label="Carbono Orgânico" value={d.embrapa.solo.carbonoOrganico != null ? `${d.embrapa.solo.carbonoOrganico} g/kg` : null} />
                <DataBox label="Nitrogênio" value={d.embrapa.solo.nitrogenio != null ? `${d.embrapa.solo.nitrogenio} g/kg` : null} />
                <DataBox label="Aptidão" value={d.embrapa.solo.aptidao} />
                {d.embrapa.solo.fonte && <DataBox label="Fonte" value={d.embrapa.solo.fonte} span2 />}
              </div>
            </div>
          )}

          {hasClima && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm" data-testid="section-clima">
              <SectionTitle icon={CloudRain}>Dados Climáticos (Histórico)</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <DataBox label="Temp. Média" value={d.embrapa.clima.temperaturaMedia != null ? `${d.embrapa.clima.temperaturaMedia}°C` : (d.embrapa.clima.tempMediaAnual ? `${d.embrapa.clima.tempMediaAnual}°C` : null)} />
                <DataBox label="Temp. Máxima" value={d.embrapa.clima.temperaturaMax != null ? `${d.embrapa.clima.temperaturaMax}°C` : null} />
                <DataBox label="Temp. Mínima" value={d.embrapa.clima.temperaturaMin != null ? `${d.embrapa.clima.temperaturaMin}°C` : null} />
                <DataBox label="Precipitação" value={d.embrapa.clima.precipitacaoMedia != null ? `${d.embrapa.clima.precipitacaoMedia} mm` : (d.embrapa.clima.precipitacaoAnual ? `${d.embrapa.clima.precipitacaoAnual} mm` : null)} />
                <DataBox label="Classificação Climática" value={d.embrapa.clima.classificacao} span2 />
                {d.embrapa.clima.indiceSeca && <DataBox label="Resumo Climático" value={d.embrapa.clima.indiceSeca} span2 />}
                {d.embrapa.clima.fonte && <DataBox label="Fonte" value={d.embrapa.clima.fonte} span2 />}
              </div>
            </div>
          )}

          {hasNdvi && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm" data-testid="section-ndvi">
              <SectionTitle icon={Leaf}>Vegetação (NDVI/EVI)</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <DataBox label="NDVI" value={d.embrapa.ndvi.ndvi != null ? d.embrapa.ndvi.ndvi.toFixed(4) : null} />
                <DataBox label="EVI" value={d.embrapa.ndvi.evi != null ? d.embrapa.ndvi.evi.toFixed(4) : null} />
                <DataBox label="Classificação" value={d.embrapa.ndvi.classificacao} />
                <DataBox label="Período" value={d.embrapa.ndvi.periodo} />
                {d.embrapa.ndvi.fonte && <DataBox label="Fonte" value={d.embrapa.ndvi.fonte} span2 />}
              </div>
            </div>
          )}

          {d.embrapa?.scoreAgro != null && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm" data-testid="section-score-agro">
              <SectionTitle icon={Award}>Score Agronômico</SectionTitle>
              <div className="flex items-center gap-4">
                <div className={cn(
                  "w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white",
                  d.embrapa.scoreAgro >= 70 ? "bg-green-500" : d.embrapa.scoreAgro >= 40 ? "bg-yellow-500" : "bg-red-500"
                )}>
                  {d.embrapa.scoreAgro}
                </div>
                <div>
                  <p className="font-bold text-gray-900">
                    {d.embrapa.scoreAgro >= 70 ? "Excelente" : d.embrapa.scoreAgro >= 40 ? "Bom" : "Baixo"} potencial agro
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Baseado em solo, clima, NDVI e zoneamento</p>
                </div>
              </div>
            </div>
          )}

          {hasAnm && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm" data-testid="section-anm">
              <SectionTitle icon={Pickaxe}>Dados Minerários (ANM)</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <DataBox label="Processo" value={d.anmProcesso} />
                <DataBox label="Titular" value={d.anmNome} />
                <DataBox label="Substância" value={d.anmSubstancia} />
                <DataBox label="Fase" value={d.anmFase} />
                <DataBox label="Tipo" value={d.anmTipo} />
                <DataBox label="Área Outorgada" value={d.anmArea ? `${d.anmArea} ha` : null} />
                <DataBox label="Situação" value={d.anmSituacao} span2 />
                <DataBox label="Último Evento" value={d.anmUltimoEvento} span2 />
              </div>
            </div>
          )}

          {hasEmpresa && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm" data-testid="section-empresa">
              <SectionTitle icon={Building2}>Empresa</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <DataBox label="Nome Comercial" value={d.empresa.tradeName} span2 />
                <DataBox label="Setor" value={d.setor} />
              </div>
            </div>
          )}

          {hasCertidoes && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm" data-testid="section-certidoes">
              <SectionTitle icon={Shield}>Due Diligence</SectionTitle>
              <div className="space-y-2">
                {d.certidoesData.status && (
                  <p className="text-sm text-gray-700">{d.certidoesData.status}</p>
                )}
                {d.certidoesData.resumo && (
                  <p className="text-sm text-gray-600">{d.certidoesData.resumo}</p>
                )}
              </div>
            </div>
          )}

          {d.ibama && !d.ibama.temEmbargo && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm" data-testid="section-ibama">
              <SectionTitle icon={Leaf}>Situação Ambiental</SectionTitle>
              <StatusBadge ok={true} labelOk="IBAMA — Sem embargos" labelBad="" />
            </div>
          )}
        </div>

        {weather?.current && (
          <div className="mb-10 bg-white rounded-2xl border border-gray-100 p-6 shadow-sm" data-testid="section-weather">
            <SectionTitle icon={Sun}>Clima e Tempo — Agora</SectionTitle>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="p-4 rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 text-center">
                <Thermometer className="w-5 h-5 text-blue-600 mx-auto mb-1" />
                <p className="text-2xl font-bold text-gray-900">{weather.current.temperature_2m}°C</p>
                <p className="text-xs text-gray-500 mt-0.5">Temperatura</p>
              </div>
              <div className="p-4 rounded-lg bg-gradient-to-br from-cyan-50 to-cyan-100 text-center">
                <Droplets className="w-5 h-5 text-cyan-600 mx-auto mb-1" />
                <p className="text-2xl font-bold text-gray-900">{weather.current.relative_humidity_2m}%</p>
                <p className="text-xs text-gray-500 mt-0.5">Umidade</p>
              </div>
              <div className="p-4 rounded-lg bg-gradient-to-br from-gray-50 to-gray-100 text-center">
                <Wind className="w-5 h-5 text-gray-600 mx-auto mb-1" />
                <p className="text-2xl font-bold text-gray-900">{weather.current.wind_speed_10m} km/h</p>
                <p className="text-xs text-gray-500 mt-0.5">Vento</p>
              </div>
              <div className="p-4 rounded-lg bg-gradient-to-br from-amber-50 to-amber-100 text-center">
                {(() => {
                  const wmo = WMO_WEATHER[weather.current.weather_code] || { label: "—", icon: Sun };
                  const WIcon = wmo.icon;
                  return (
                    <>
                      <WIcon className="w-5 h-5 text-amber-600 mx-auto mb-1" />
                      <p className="text-sm font-bold text-gray-900">{wmo.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Condição</p>
                    </>
                  );
                })()}
              </div>
            </div>
            {weather.daily && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Previsão 3 dias</p>
                <div className="grid grid-cols-3 gap-2">
                  {weather.daily.time?.map((day: string, i: number) => (
                    <div key={day} className="p-3 rounded-lg bg-gray-50 text-center text-sm">
                      <p className="font-medium text-gray-700">{new Date(day + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "numeric" })}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {weather.daily.temperature_2m_min?.[i]?.toFixed(0)}° — {weather.daily.temperature_2m_max?.[i]?.toFixed(0)}°
                      </p>
                      {weather.daily.precipitation_sum?.[i] > 0 && (
                        <p className="text-xs text-blue-600 mt-0.5">{weather.daily.precipitation_sum[i].toFixed(1)} mm</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="text-center mt-8 pb-8">
          <p className="text-xs text-gray-400">
            {d.companyName} &middot; {new Date().getFullYear()} &middot; Dados sujeitos a verificação
          </p>
          {dollar && (
            <p className="text-[10px] text-gray-300 mt-1">
              Cotação do Dólar: R$ {Number(dollar.bid).toFixed(4)} (Compra) / R$ {Number(dollar.ask).toFixed(4)} (Venda) — Atualizado em {new Date(dollar.create_date).toLocaleDateString("pt-BR")}
            </p>
          )}
          {d.updatedAt && (
            <p className="text-[10px] text-gray-300 mt-0.5">
              Dados enriquecidos em: {new Date(d.updatedAt).toLocaleDateString("pt-BR")}
            </p>
          )}
        </div>
      </div>

      {d.showcaseWhatsapp && (
        <a
          href={`https://wa.me/${d.showcaseWhatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá! Tenho interesse no ativo: ${d.title || ""} (ID ${d.id})`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-green-500 hover:bg-green-600 rounded-full flex items-center justify-center shadow-lg shadow-green-500/30 transition-all hover:scale-110"
          data-testid="btn-whatsapp-fab"
          title="Fale conosco no WhatsApp"
        >
          <SiWhatsapp className="w-7 h-7 text-white" />
        </a>
      )}
    </div>
  );
}
