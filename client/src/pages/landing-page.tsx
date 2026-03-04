import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  MapPin, Ruler, DollarSign, Zap, CheckCircle2,
  Send, Phone, Mail, MessageCircle, TreePine, Pickaxe, Briefcase,
  Home, Wheat, Factory, Layers, Shield,
  ChevronLeft, ChevronRight, Sparkles, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

function formatPrice(v: any) {
  if (!v) return null;
  const n = Number(v);
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
  if (n >= 1_000) return `R$ ${(n / 1_000).toFixed(0)}K`;
  return `R$ ${n.toLocaleString("pt-BR")}`;
}

function fetchPublic(url: string) {
  return fetch(url).then(r => { if (!r.ok) throw new Error("Erro"); return r.json(); });
}

export default function LandingPagePublic({ slug }: { slug: string }) {
  const [submitted, setSubmitted] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const { data: page, isLoading } = useQuery<any>({
    queryKey: ["public-lp", slug],
    queryFn: () => fetchPublic(`/api/public/lp/${slug}`),
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

  if (!page) return (
    <div className="min-h-screen flex flex-col items-center justify-center text-gray-500 bg-white gap-4">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
        <Eye className="w-8 h-8 text-gray-300" />
      </div>
      <p className="text-lg font-medium text-gray-600">Página não encontrada</p>
      <p className="text-sm text-gray-400">Este link pode ter expirado ou sido removido.</p>
    </div>
  );

  const asset = page.asset;
  const TIcon = asset ? (TIPO_ICON[asset.type] || Layers) : Layers;
  const color = asset ? (TIPO_COLOR[asset.type] || "") : "";
  const gallery: string[] = page.galleryImages || [];
  const highlights: { label: string; value: string }[] = page.highlights || [];
  const sections: { title?: string; content?: string }[] = page.sectionsConfig || [];
  const accent = page.accentColor || "#1a365d";

  return (
    <div className="min-h-screen bg-white">
      <nav
        className={cn(
          "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
          scrolled ? "bg-white/95 backdrop-blur-md shadow-sm border-b border-gray-100" : "bg-white/80 backdrop-blur-sm"
        )}
        data-testid="lp-navbar"
      >
        <div className="max-w-7xl mx-auto px-4 md:px-8 flex items-center justify-between h-16 md:h-20">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: accent }}>
              <Zap className="w-4 h-4 text-white fill-current" />
            </div>
            <span className="font-bold text-sm text-gray-900">Mavrion Conect</span>
          </div>
          <Badge variant="outline" className="text-xs font-normal text-gray-500 border-gray-200">
            Oportunidade Exclusiva
          </Badge>
        </div>
      </nav>

      {page.featuredImage && (
        <div
          className="relative w-full min-h-[400px] md:min-h-[520px] flex items-end"
          style={{
            backgroundImage: `url(${page.featuredImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
          data-testid="lp-hero-bg"
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/40 to-black/20" />
          <div className="relative z-10 max-w-7xl mx-auto px-4 md:px-8 w-full pb-10 pt-28 md:pt-36">
            {asset?.type && (
              <span className={cn("text-xs font-semibold px-3 py-1.5 rounded-full backdrop-blur-sm mb-4 inline-block", color)} data-testid="badge-lp-type-hero">
                <TIcon className="w-3 h-3 mr-1 inline" />
                {TIPO_LABEL[asset.type] || asset.type}
              </span>
            )}
            <h1 className="text-3xl md:text-5xl font-bold text-white leading-tight" data-testid="lp-hero-title">
              {page.title}
            </h1>
            {page.subtitle && (
              <p className="text-lg md:text-xl text-white/80 mt-3" data-testid="lp-hero-subtitle">{page.subtitle}</p>
            )}
            {asset?.estado && (
              <div className="flex items-center gap-1.5 mt-4 text-sm text-white/60">
                <MapPin className="w-4 h-4" />
                {asset.municipio ? `${asset.municipio}, ${asset.estado}` : asset.estado}
              </div>
            )}
          </div>
        </div>
      )}

      <div className={page.featuredImage ? "pt-8 md:pt-12" : "pt-20 md:pt-24"}>
        {!page.featuredImage && gallery.length > 0 ? (
          <div className="max-w-7xl mx-auto px-4 md:px-8">
            <div className="relative rounded-3xl overflow-hidden h-[350px] md:h-[500px] bg-gray-100">
              <img
                src={gallery[galleryIdx]}
                alt={page.title}
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
                    data-testid="btn-lp-gallery-prev"
                  >
                    <ChevronLeft className="w-5 h-5 text-gray-700" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm shadow-lg"
                    onClick={() => setGalleryIdx(i => i < gallery.length - 1 ? i + 1 : 0)}
                    data-testid="btn-lp-gallery-next"
                  >
                    <ChevronRight className="w-5 h-5 text-gray-700" />
                  </Button>
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
                    {gallery.map((_: string, i: number) => (
                      <button
                        key={i}
                        className={cn("w-2 h-2 rounded-full transition-all", i === galleryIdx ? "bg-white w-6" : "bg-white/50")}
                        onClick={() => setGalleryIdx(i)}
                      />
                    ))}
                  </div>
                </>
              )}

              <div className="absolute top-4 left-4 flex gap-2">
                {asset?.type && (
                  <span className={cn("text-xs font-semibold px-3 py-1.5 rounded-full backdrop-blur-sm", color)} data-testid="badge-lp-type">
                    <TIcon className="w-3 h-3 mr-1 inline" />
                    {TIPO_LABEL[asset.type] || asset.type}
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
        ) : !page.featuredImage ? (
          <div className="max-w-7xl mx-auto px-4 md:px-8">
            <div className="rounded-3xl overflow-hidden h-[250px] md:h-[400px] bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
              <TIcon className="w-24 h-24 text-gray-300" />
            </div>
          </div>
        ) : null}

        {page.featuredImage && gallery.length > 1 && (
          <div className="max-w-7xl mx-auto px-4 md:px-8 mt-4">
            <div className="relative rounded-3xl overflow-hidden h-[300px] md:h-[400px] bg-gray-100">
              <img
                src={gallery[galleryIdx]}
                alt={page.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
              {gallery.length > 1 && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm shadow-lg"
                    onClick={() => setGalleryIdx(i => i > 0 ? i - 1 : gallery.length - 1)}
                    data-testid="btn-lp-gallery-prev"
                  >
                    <ChevronLeft className="w-5 h-5 text-gray-700" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm shadow-lg"
                    onClick={() => setGalleryIdx(i => i < gallery.length - 1 ? i + 1 : 0)}
                    data-testid="btn-lp-gallery-next"
                  >
                    <ChevronRight className="w-5 h-5 text-gray-700" />
                  </Button>
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
                    {gallery.map((_: string, i: number) => (
                      <button
                        key={i}
                        className={cn("w-2 h-2 rounded-full transition-all", i === galleryIdx ? "bg-white w-6" : "bg-white/50")}
                        onClick={() => setGalleryIdx(i)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
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
          </div>
        )}

        <div className="max-w-7xl mx-auto px-4 md:px-8 mt-8 md:mt-12">
          <div className="flex flex-col lg:flex-row gap-10">
            <div className="flex-1 lg:w-2/3 space-y-8">
              {!page.featuredImage && (
              <div>
                <h1 className="text-3xl md:text-4xl font-bold text-gray-900 leading-tight" data-testid="lp-title">
                  {page.title}
                </h1>
                {page.subtitle && (
                  <p className="text-lg text-gray-500 mt-2" data-testid="lp-subtitle">{page.subtitle}</p>
                )}
                {asset?.estado && (
                  <div className="flex items-center gap-1.5 mt-3 text-sm text-gray-400">
                    <MapPin className="w-4 h-4" />
                    {asset.municipio ? `${asset.municipio}, ${asset.estado}` : asset.estado}
                  </div>
                )}
              </div>
              )}

              {page.description && (
                <div className="space-y-3" data-testid="lp-section-sobre">
                  <h3 className="text-lg font-semibold text-gray-900">Sobre</h3>
                  <p className="text-gray-600 leading-relaxed text-[15px] whitespace-pre-wrap" data-testid="lp-description">
                    {page.description}
                  </p>
                </div>
              )}

              {asset && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {asset.areaHa && (
                    <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100" data-testid="lp-card-area">
                      <Ruler className="w-5 h-5 text-gray-400 mb-2" />
                      <p className="text-xs text-gray-400 font-medium">Área Total</p>
                      <p className="text-lg font-bold text-gray-900 mt-0.5">{Number(asset.areaHa).toLocaleString("pt-BR")} ha</p>
                      {asset.areaUtil && <p className="text-[10px] text-gray-400">Útil: {Number(asset.areaUtil).toLocaleString("pt-BR")} ha</p>}
                    </div>
                  )}
                  <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100" data-testid="lp-card-price">
                    <DollarSign className="w-5 h-5 text-gray-400 mb-2" />
                    <p className="text-xs text-gray-400 font-medium">Valor</p>
                    <p className="text-lg font-bold text-gray-900 mt-0.5">
                      {asset.priceAsking ? formatPrice(asset.priceAsking) : "Sob consulta"}
                    </p>
                  </div>
                  {asset.docsStatus && (
                    <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100" data-testid="lp-card-docs">
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
                <div className="space-y-3">
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
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold text-gray-900">Observações</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">{asset.observacoes}</p>
                </div>
              )}

              {(page.contactEmail || page.contactPhone) && (
                <div className="p-6 rounded-2xl border border-gray-200 bg-white shadow-sm" data-testid="lp-contact-direct">
                  <div className="flex items-center gap-2 mb-4">
                    <MessageCircle className="w-5 h-5" style={{ color: accent }} />
                    <h3 className="text-lg font-semibold text-gray-900">Contato Direto</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {page.contactEmail && (
                      <a
                        href={`mailto:${page.contactEmail}`}
                        className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100 transition-colors hover:bg-gray-100"
                        data-testid="lp-link-email"
                      >
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: accent + "15" }}>
                          <Mail className="w-5 h-5" style={{ color: accent }} />
                        </div>
                        <div>
                          <p className="text-xs text-gray-400 font-medium">Email</p>
                          <p className="text-sm font-medium text-gray-700">{page.contactEmail}</p>
                        </div>
                      </a>
                    )}
                    {page.contactPhone && (
                      <a
                        href={`tel:${page.contactPhone}`}
                        className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100 transition-colors hover:bg-gray-100"
                        data-testid="lp-link-phone"
                      >
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: accent + "15" }}>
                          <Phone className="w-5 h-5" style={{ color: accent }} />
                        </div>
                        <div>
                          <p className="text-xs text-gray-400 font-medium">Telefone</p>
                          <p className="text-sm font-medium text-gray-700">{page.contactPhone}</p>
                        </div>
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="lg:w-[380px]">
              <div className="sticky top-24 space-y-4">
                <div className="rounded-2xl border border-gray-200 bg-white shadow-lg overflow-hidden" data-testid="lp-inquiry-form">
                  <div className="p-5" style={{ backgroundColor: accent }}>
                    <h3 className="font-semibold text-white text-lg">Demonstrar Interesse</h3>
                    <p className="text-white/70 text-xs mt-1">Receba informações detalhadas sobre esta oportunidade</p>
                  </div>
                  <div className="p-5">
                    {submitted ? (
                      <div className="text-center py-8" data-testid="lp-inquiry-success">
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
                          <Input value={name} onChange={e => setName(e.target.value)} placeholder="João Silva" className="mt-1 rounded-xl h-10" data-testid="input-lp-name" />
                        </div>
                        <div>
                          <Label className="text-xs text-gray-500 font-medium">Email *</Label>
                          <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="joao@empresa.com" className="mt-1 rounded-xl h-10" data-testid="input-lp-email" />
                        </div>
                        <div>
                          <Label className="text-xs text-gray-500 font-medium">Telefone</Label>
                          <Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(11) 99999-9999" className="mt-1 rounded-xl h-10" data-testid="input-lp-phone" />
                        </div>
                        <div>
                          <Label className="text-xs text-gray-500 font-medium">Empresa</Label>
                          <Input value={company} onChange={e => setCompany(e.target.value)} placeholder="Empresa LTDA" className="mt-1 rounded-xl h-10" data-testid="input-lp-company" />
                        </div>
                        <div>
                          <Label className="text-xs text-gray-500 font-medium">Mensagem</Label>
                          <Textarea
                            value={message}
                            onChange={e => setMessage(e.target.value)}
                            placeholder="Tenho interesse neste ativo..."
                            rows={3}
                            className="mt-1 rounded-xl"
                            data-testid="input-lp-message"
                          />
                        </div>
                        <Button
                          className="w-full rounded-xl h-11 text-white font-medium"
                          style={{ backgroundColor: accent }}
                          onClick={() => inquiryMutation.mutate({ landingPageId: page.id, name, email, phone, company, message })}
                          disabled={!name.trim() || !email.trim() || inquiryMutation.isPending}
                          data-testid="btn-lp-send"
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

      <footer className="text-white py-12 mt-20" style={{ backgroundColor: accent }}>
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center">
                <Zap className="w-4 h-4 fill-current" style={{ color: accent }} />
              </div>
              <span className="font-bold text-sm">Mavrion Conect</span>
            </div>
            <p className="text-white/50 text-xs">© {new Date().getFullYear()} Mavrion Conect — Plataforma de Originação de Negócios</p>
            <div className="flex items-center gap-1 text-white/50 text-xs">
              <Shield className="w-3 h-3" />
              <span>Informações sujeitas a verificação</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
