import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Phone, Mail, Loader2, Sparkles, Search, Code, Tag, CheckCircle2, Clock, ExternalLink, Globe, TriangleAlert
} from "lucide-react";
import { SiFacebook, SiInstagram, SiLinkedin, SiYoutube, SiWhatsapp, SiX } from "react-icons/si";

interface EnrichmentPanelProps {
  company: any;
  enrichmentResult: any;
  enrichMutation: any;
  enrichProgress: number;
  enrichStep: string;
}

export default function EnrichmentPanel({
  company,
  enrichmentResult,
  enrichMutation,
  enrichProgress,
  enrichStep,
}: EnrichmentPanelProps) {
  const result = enrichmentResult || (company as any)?.enrichmentData;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">Enriquecimento via Web</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Busca automática no DuckDuckGo + scraping do site oficial. Extrai redes sociais, contatos, SEO e tecnologias.
          </p>
        </div>
        <Button
          onClick={() => enrichMutation.mutate()}
          disabled={enrichMutation.isPending}
          className="gap-2 shrink-0"
          data-testid="button-enriquecer"
        >
          {enrichMutation.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Buscando... (até 90s)</>
          ) : (
            <><Sparkles className="w-4 h-4" /> Enriquecer empresa</>
          )}
        </Button>
      </div>

      {(enrichMutation.isPending || enrichMutation.isSuccess) && (
        <Card className={enrichMutation.isPending ? "border-primary/30 bg-primary/5" : "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20"}>
          <CardContent className="py-8 space-y-4">
            <div className="flex items-center gap-3">
              {enrichMutation.isPending ? (
                <div className="relative shrink-0">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <Search className="w-3.5 h-3.5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary" />
                </div>
              ) : (
                <CheckCircle2 className="w-8 h-8 text-emerald-500 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">
                  {enrichMutation.isPending ? "Enriquecendo empresa..." : "Enriquecimento concluído!"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{enrichStep}</p>
              </div>
              <span className="text-sm font-bold tabular-nums text-muted-foreground shrink-0">{enrichProgress}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out ${enrichMutation.isPending ? "bg-primary" : "bg-emerald-500"}`}
                style={{ width: `${enrichProgress}%` }}
              />
            </div>
            {enrichMutation.isPending && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                {[
                  { icon: Search, label: "Buscando", done: enrichProgress >= 20 },
                  { icon: Globe, label: "Acessando site", done: enrichProgress >= 65 },
                  { icon: Mail, label: "Contatos", done: enrichProgress >= 78 },
                  { icon: Tag, label: "SEO & Tech", done: enrichProgress >= 88 },
                ].map(step => (
                  <div key={step.label} className={`flex flex-col items-center gap-1 text-center p-2 rounded-lg border ${step.done ? "border-primary/30 bg-primary/5" : "border-border"}`}>
                    <step.icon className={`w-5 h-5 ${step.done ? "text-primary" : "text-muted-foreground"}`} />
                    <span className={`text-xs font-medium ${step.done ? "text-primary" : "text-muted-foreground"}`}>{step.label}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!enrichMutation.isPending && !enrichmentResult && (company as any)?.enrichmentData && (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5 pb-1">
          <Clock className="w-3.5 h-3.5" />
          Último enriquecimento em {new Date((company as any).enrichedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}.
          Clique em "Enriquecer empresa" para atualizar.
        </div>
      )}

      {result && <EnrichmentResults company={company} result={result} />}
    </div>
  );
}

function EnrichmentResults({ company, result }: { company: any; result: any }) {
  const merged = result.merged || {};
  const seo = merged.seo || {};
  const social = merged.social || {};
  const tech = merged.tech || [];
  const searchResults = result.search?.search_results || [];
  const isDirectory = merged.is_directory_site === true;

  const SOCIAL_META: Record<string, { Icon: any; color: string; bg: string; label: string }> = {
    linkedin:  { Icon: SiLinkedin,  color: "text-white", bg: "bg-[#0A66C2]", label: "LinkedIn" },
    instagram: { Icon: SiInstagram, color: "text-white", bg: "bg-gradient-to-br from-[#833AB4] via-[#FD1D1D] to-[#FCB045]", label: "Instagram" },
    facebook:  { Icon: SiFacebook,  color: "text-white", bg: "bg-[#1877F2]", label: "Facebook" },
    twitter:   { Icon: SiX,         color: "text-white", bg: "bg-black", label: "X (Twitter)" },
    youtube:   { Icon: SiYoutube,   color: "text-white", bg: "bg-[#FF0000]", label: "YouTube" },
    whatsapp:  { Icon: SiWhatsapp,  color: "text-white", bg: "bg-[#25D366]", label: "WhatsApp" },
    tiktok:    { Icon: SiWhatsapp,  color: "text-white", bg: "bg-black", label: "TikTok" },
  };

  const extractHandle = (url: string, platform: string) => {
    try {
      const parts = url.replace(/https?:\/\/(www\.)?/, "").split("/").filter(Boolean);
      const handle = parts[parts.length - 1]?.replace(/^@/, "") || "";
      if (handle && handle.length > 1) return "@" + handle;
    } catch {}
    return url;
  };

  const knownPhones = new Set((company.phones || []).map((p: string) => p.replace(/\D/g, "")));
  const newPhones = (merged.phones || []).filter((p: string) => !knownPhones.has(p.replace(/\D/g, "")));

  return (
    <div className="space-y-4">
      {Object.keys(social).length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Redes Sociais Encontradas</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.entries(social).map(([platform, url]) => {
              const meta = SOCIAL_META[platform];
              if (!meta) return null;
              const { Icon, color, bg, label } = meta;
              const handle = extractHandle(url as string, platform);
              return (
                <a key={platform} href={url as string} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2.5 p-2.5 rounded-lg border hover:shadow-sm transition-shadow"
                  data-testid={`link-social-${platform}`}>
                  <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-4 h-4 ${color}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold">{label}</p>
                    <p className="text-xs text-muted-foreground truncate">{handle}</p>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Phone className="w-4 h-4 text-muted-foreground" /> Contatos Encontrados via Web
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {newPhones.length > 0 ? newPhones.map((p: string, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <a href={`tel:${p.replace(/\D/g,"")}`} className="hover:text-primary">{p}</a>
                <Badge variant="outline" className="ml-auto text-xs text-emerald-600 border-emerald-300">novo</Badge>
              </div>
            )) : (
              <p className="text-muted-foreground text-xs">Nenhum telefone novo encontrado além dos já cadastrados.</p>
            )}
            {(merged.emails || []).map((e: string, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <a href={`mailto:${e}`} className="text-primary hover:underline break-all text-xs">{e}</a>
              </div>
            ))}
            {merged.whatsapp_num && (
              <div className="flex items-center gap-2">
                <SiWhatsapp className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <a href={`https://wa.me/${merged.whatsapp_num}`} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline text-xs">+{merged.whatsapp_num}</a>
              </div>
            )}
            {!newPhones.length && !(merged.emails?.length) && !merged.whatsapp_num && (
              <p className="text-muted-foreground text-xs">Nenhum contato adicional encontrado.</p>
            )}
            {merged.website && (
              <div className="pt-2 border-t flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <a href={merged.website} target="_blank" rel="noopener noreferrer"
                  className="text-primary hover:underline text-xs break-all">{merged.website}</a>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between gap-2">
              <span className="flex items-center gap-2"><Tag className="w-4 h-4 text-muted-foreground" /> SEO do Site</span>
              {isDirectory && (
                <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 gap-1">
                  <TriangleAlert className="w-3 h-3" /> Diretório CNPJ
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {isDirectory ? (
              <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/20 p-2.5 rounded-lg border border-amber-200">
                O site identificado é um diretório de CNPJs (ex: cnpj.biz, casadosdados.com.br) — os dados de SEO não representam o site oficial da empresa. Tente cadastrar o site correto nos dados da empresa.
              </p>
            ) : (
              <>
                {seo.og_image && (
                  <img src={seo.og_image} alt="OG preview" className="w-full h-28 object-cover rounded-lg border" />
                )}
                {seo.title && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Title</p>
                    <p className="font-medium text-sm">{seo.title}</p>
                  </div>
                )}
                {seo.description && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Meta Description</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">{seo.description}</p>
                  </div>
                )}
                {seo.keywords && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Keywords</p>
                    <div className="flex flex-wrap gap-1">
                      {seo.keywords.split(",").slice(0, 8).map((k: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-xs font-normal">{k.trim()}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {!seo.title && !seo.description && (
                  <p className="text-muted-foreground text-xs">Dados SEO não encontrados para o site da empresa.</p>
                )}
              </>
            )}
            {(merged.ga_id || merged.gtm_id) && (
              <div className="pt-1 border-t flex gap-2 flex-wrap">
                {merged.ga_id && <Badge variant="outline" className="text-xs gap-1 text-orange-600 border-orange-300"><Tag className="w-3 h-3" />{merged.ga_id}</Badge>}
                {merged.gtm_id && <Badge variant="outline" className="text-xs gap-1 text-blue-600 border-blue-300"><Tag className="w-3 h-3" />{merged.gtm_id}</Badge>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {(tech.length > 0 || searchResults.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tech.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Code className="w-4 h-4 text-muted-foreground" /> Tecnologias Detectadas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {tech.map((t: string) => (
                    <Badge key={t} className="text-xs gap-1 bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300 border-0">
                      <CheckCircle2 className="w-3 h-3" />{t}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {searchResults.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Search className="w-4 h-4 text-muted-foreground" /> Fontes Encontradas
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {searchResults.map((r: any, i: number) => (
                  <div key={i} className="border rounded-md p-2.5 space-y-0.5">
                    <a href={r.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs font-medium text-primary hover:underline line-clamp-1">{r.title}</a>
                    <p className="text-xs text-muted-foreground line-clamp-2">{r.snippet}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
