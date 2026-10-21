import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Phone, Mail, Loader2, Sparkles, Search, Code, Tag, CheckCircle2, Clock, ExternalLink, Globe, TriangleAlert,
  Brain, Users, Shield, Lightbulb, UserCheck, Link2, TrendingUp, Building2, Target, AlertTriangle, DollarSign,
  Briefcase, Calendar, Scale, Award, Swords, ShieldAlert, FileWarning,
} from "lucide-react";
import { SiFacebook, SiInstagram, SiLinkedin, SiYoutube, SiWhatsapp, SiX, SiTiktok } from "react-icons/si";

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
          <h2 className="text-base font-semibold">Enriquecimento com IA</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Pesquisa web inteligente com GPT-4o — busca, analisa e cruza dados automaticamente de múltiplas fontes.
          </p>
        </div>
        <Button
          onClick={() => enrichMutation.mutate()}
          disabled={enrichMutation.isPending}
          className="gap-2 shrink-0"
          data-testid="button-enriquecer"
        >
          {enrichMutation.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Pesquisando com IA... (até 2min)</>
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
                  <Brain className="w-3.5 h-3.5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary" />
                </div>
              ) : (
                <CheckCircle2 className="w-8 h-8 text-emerald-500 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">
                  {enrichMutation.isPending ? "IA pesquisando na web..." : "Enriquecimento concluído!"}
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
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 pt-1">
                {[
                  { icon: Search, label: "Buscando", done: enrichProgress >= 15 },
                  { icon: Globe, label: "Sites & Redes", done: enrichProgress >= 35 },
                  { icon: Users, label: "Decisores", done: enrichProgress >= 55 },
                  { icon: DollarSign, label: "Financeiro", done: enrichProgress >= 72 },
                  { icon: Brain, label: "Análise IA", done: enrichProgress >= 90 },
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

      {result && <ScraperResults company={company} result={result} />}

      {(result?.aiEnrichment || (company as any)?.enrichmentData?.aiEnrichment) && (
        <AIEnrichmentResults
          aiData={result?.aiEnrichment || (company as any)?.enrichmentData?.aiEnrichment}
          company={company}
        />
      )}
    </div>
  );
}

function ScraperResults({ company, result }: { company: any; result: any }) {
  const merged = result.merged || {};
  if (!merged.phones?.length && !merged.emails?.length && !merged.website && !merged.whatsapp_num) return null;

  const knownPhones = new Set((company.phones || []).map((p: string) => p.replace(/\D/g, "")));
  const newPhones = (merged.phones || []).filter((p: string) => !knownPhones.has(p.replace(/\D/g, "")));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Search className="w-4 h-4 text-muted-foreground" /> Dados do Scraper (Receita/CNPJ)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {newPhones.length > 0 ? newPhones.map((p: string, i: number) => (
          <div key={i} className="flex items-center gap-2">
            <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <a href={`tel:${p.replace(/\D/g,"")}`} className="hover:text-primary">{p}</a>
            <Badge variant="outline" className="ml-auto text-xs text-emerald-600 border-emerald-300">novo</Badge>
          </div>
        )) : null}
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
        {merged.website && (
          <div className="pt-2 border-t flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <a href={merged.website} target="_blank" rel="noopener noreferrer"
              className="text-primary hover:underline text-xs break-all">{merged.website}</a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const SOCIAL_META: Record<string, { Icon: any; color: string; bg: string; label: string }> = {
  linkedin:  { Icon: SiLinkedin,  color: "text-white", bg: "bg-[#0A66C2]", label: "LinkedIn" },
  instagram: { Icon: SiInstagram, color: "text-white", bg: "bg-gradient-to-br from-[#833AB4] via-[#FD1D1D] to-[#FCB045]", label: "Instagram" },
  facebook:  { Icon: SiFacebook,  color: "text-white", bg: "bg-[#1877F2]", label: "Facebook" },
  twitter:   { Icon: SiX,         color: "text-white", bg: "bg-black", label: "X (Twitter)" },
  youtube:   { Icon: SiYoutube,   color: "text-white", bg: "bg-[#FF0000]", label: "YouTube" },
  whatsapp:  { Icon: SiWhatsapp,  color: "text-white", bg: "bg-[#25D366]", label: "WhatsApp" },
  tiktok:    { Icon: SiTiktok,    color: "text-white", bg: "bg-black", label: "TikTok" },
};

const CONFIDENCE_COLORS: Record<string, string> = {
  alta: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-300",
  media: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-300",
  baixa: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-gray-300",
};

const BUYER_POTENTIAL_COLORS: Record<string, string> = {
  alto: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-300",
  medio: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-300",
  baixo: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-gray-300",
};

function AIEnrichmentResults({ aiData, company }: { aiData: any; company: any }) {
  if (!aiData) return null;

  const phones = aiData.validatedPhones || [];
  const emails = aiData.validatedEmails || [];
  const makers = aiData.decisionMakers || [];
  const social = aiData.socialMedia || {};
  const website = aiData.website || {};
  const financial = aiData.financialProfile || {};
  const matching = aiData.matchingSignals || {};
  const competitive = aiData.competitiveIntel || {};
  const legal = aiData.legalCompliance || {};
  const intel = aiData.businessIntel || [];
  const sources = aiData.searchSources || [];

  const socialEntries = Object.entries(social).filter(([, url]) => url);
  const hasFinancial = financial.estimatedRevenue || financial.companySize || financial.sector || (financial.mainActivities || []).length > 0;
  const hasMatching = matching.buyerPotential || (matching.expansionSignals || []).length > 0 || (matching.interestAreas || []).length > 0;
  const hasCompetitive = (competitive.mainCompetitors || []).length > 0 || competitive.marketPosition || (competitive.differentials || []).length > 0;
  const hasLegal = (legal.certifications || []).length > 0 || (legal.lawsuits || []).length > 0 || (legal.environmentalIssues || []).length > 0 || (legal.debtSignals || []).length > 0;
  const hasWebsite = website.url || website.seo?.title || (website.tech || []).length > 0;
  const hasData = phones.length > 0 || emails.length > 0 || makers.length > 0 || intel.length > 0 || socialEntries.length > 0 || hasFinancial || hasMatching || hasCompetitive || hasLegal || hasWebsite;
  if (!hasData) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pt-2">
        <Brain className="w-5 h-5 text-violet-500" />
        <h3 className="text-sm font-semibold">Inteligência Comercial (IA)</h3>
        <Badge variant="outline" className="text-xs gap-1 border-violet-300 text-violet-600">
          GPT-4o + Web Search
        </Badge>
        {aiData.enrichedAt && (
          <span className="text-xs text-muted-foreground ml-auto">
            {new Date(aiData.enrichedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      {socialEntries.length > 0 && (
        <div data-testid="card-ai-social">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Redes Sociais</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {socialEntries.map(([platform, url]) => {
              const meta = SOCIAL_META[platform];
              if (!meta) return null;
              const { Icon, color, bg, label } = meta;
              return (
                <a key={platform} href={url as string} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2.5 p-2.5 rounded-lg border hover:shadow-sm transition-shadow"
                  data-testid={`ai-social-${platform}`}>
                  <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-4 h-4 ${color}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold">{label}</p>
                    <p className="text-xs text-muted-foreground truncate">{(() => { try { return new URL(url as string).pathname.replace(/^\//, "").replace(/\/$/, "") || new URL(url as string).hostname; } catch { return url as string; } })()}</p>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {hasWebsite && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(website.url || website.seo?.title) && (
            <Card data-testid="card-ai-website">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Globe className="w-4 h-4 text-blue-500" /> Site Oficial
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {website.url && (
                  <a href={website.url} target="_blank" rel="noopener noreferrer"
                    className="text-primary hover:underline text-xs break-all flex items-center gap-1">
                    <ExternalLink className="w-3 h-3 shrink-0" /> {website.url}
                  </a>
                )}
                {website.seo?.title && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Título</p>
                    <p className="font-medium text-sm">{website.seo.title}</p>
                  </div>
                )}
                {website.seo?.description && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Descrição</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">{website.seo.description}</p>
                  </div>
                )}
                {website.seo?.keywords && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Keywords</p>
                    <div className="flex flex-wrap gap-1">
                      {website.seo.keywords.split(",").slice(0, 8).map((k: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-xs font-normal">{k.trim()}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          {(website.tech || []).length > 0 && (
            <Card data-testid="card-ai-tech">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Code className="w-4 h-4 text-violet-500" /> Tecnologias Detectadas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {(website.tech || []).map((t: string) => (
                    <Badge key={t} className="text-xs gap-1 bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300 border-0">
                      <CheckCircle2 className="w-3 h-3" />{t}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {phones.length > 0 && (
          <Card data-testid="card-ai-phones">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Phone className="w-4 h-4 text-emerald-500" /> Telefones Descobertos
                <Badge variant="outline" className="ml-auto text-xs">{phones.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {phones.map((p: any, i: number) => (
                <div key={i} className="flex items-center gap-2 flex-wrap">
                  <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <a href={`tel:${(p.number || "").replace(/\D/g, "")}`} className="hover:text-primary font-medium">{p.number}</a>
                  <Badge variant="outline" className="text-xs capitalize">{p.type === "whatsapp" ? "WhatsApp" : p.type === "celular" ? "Celular" : "Comercial"}</Badge>
                  <Badge variant="outline" className={`text-xs ml-auto ${CONFIDENCE_COLORS[p.confidence] || ""}`}>{p.confidence}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {emails.length > 0 && (
          <Card data-testid="card-ai-emails">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Mail className="w-4 h-4 text-blue-500" /> Emails Descobertos
                <Badge variant="outline" className="ml-auto text-xs">{emails.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {emails.map((e: any, i: number) => (
                <div key={i} className="flex items-center gap-2 flex-wrap">
                  <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <a href={`mailto:${e.email}`} className="text-primary hover:underline break-all text-xs">{e.email}</a>
                  <Badge variant="outline" className="text-xs capitalize">{e.type === "comercial" ? "Corporativo" : e.type === "pessoal" ? "Pessoal" : "Genérico"}</Badge>
                  <Badge variant="outline" className={`text-xs ml-auto ${CONFIDENCE_COLORS[e.confidence] || ""}`}>{e.confidence}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {makers.length > 0 && (
        <Card data-testid="card-ai-makers">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-amber-500" /> Decisores Identificados
              <Badge variant="outline" className="ml-auto text-xs">{makers.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              {makers.map((m: any, i: number) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border">
                  <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-700 dark:text-amber-300 font-bold text-sm shrink-0">
                    {(m.name || "?")[0]}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="font-semibold text-sm">{m.name}</p>
                    <p className="text-xs text-muted-foreground">{m.role}</p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {m.phone && (
                        <a href={`tel:${m.phone.replace(/\D/g, "")}`} className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1">
                          <Phone className="w-3 h-3" /> {m.phone}
                        </a>
                      )}
                      {m.email && (
                        <a href={`mailto:${m.email}`} className="text-xs text-primary hover:underline flex items-center gap-1">
                          <Mail className="w-3 h-3" /> {m.email}
                        </a>
                      )}
                      {m.linkedin && (
                        <a href={m.linkedin} target="_blank" rel="noopener noreferrer" className="text-xs text-[#0A66C2] hover:underline flex items-center gap-1">
                          <SiLinkedin className="w-3 h-3" /> LinkedIn
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {hasFinancial && (
        <Card data-testid="card-ai-financial">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-500" /> Perfil Financeiro
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {financial.estimatedRevenue && (
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Faturamento Estimado</p>
                  <p className="text-sm font-semibold" data-testid="ai-revenue">{financial.estimatedRevenue}</p>
                </div>
              )}
              {financial.revenueRange && (
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Faixa</p>
                  <Badge variant="outline" className="text-xs capitalize" data-testid="ai-revenue-range">{financial.revenueRange}</Badge>
                </div>
              )}
              {financial.companySize && (
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Porte</p>
                  <Badge variant="outline" className="text-xs" data-testid="ai-company-size">{financial.companySize}</Badge>
                </div>
              )}
              {financial.employeeRange && (
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Funcionários</p>
                  <p className="text-sm font-medium flex items-center gap-1" data-testid="ai-employees">
                    <Users className="w-3 h-3 text-muted-foreground" /> {financial.employeeRange}
                  </p>
                </div>
              )}
              {financial.sector && (
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Setor</p>
                  <p className="text-sm font-medium" data-testid="ai-sector">{financial.sector}</p>
                </div>
              )}
              {financial.foundedYear && (
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Fundação</p>
                  <p className="text-sm font-medium flex items-center gap-1" data-testid="ai-founded">
                    <Calendar className="w-3 h-3 text-muted-foreground" /> {financial.foundedYear}
                  </p>
                </div>
              )}
            </div>
            {(financial.mainActivities || []).length > 0 && (
              <div className="mt-3 pt-2 border-t">
                <p className="text-xs text-muted-foreground mb-1.5">Principais Atividades</p>
                <div className="flex flex-wrap gap-1.5">
                  {financial.mainActivities.map((a: string, i: number) => (
                    <Badge key={i} variant="secondary" className="text-xs font-normal gap-1">
                      <Briefcase className="w-3 h-3" /> {a}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {hasCompetitive && (
        <Card data-testid="card-ai-competitive">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Swords className="w-4 h-4 text-orange-500" /> Inteligência Competitiva
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {competitive.marketPosition && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Posição no Mercado</p>
                <p className="text-sm font-medium">{competitive.marketPosition}</p>
              </div>
            )}
            {(competitive.mainCompetitors || []).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Principais Concorrentes</p>
                <div className="flex flex-wrap gap-1.5">
                  {competitive.mainCompetitors.map((c: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-xs">{c}</Badge>
                  ))}
                </div>
              </div>
            )}
            {(competitive.differentials || []).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Diferenciais</p>
                <div className="space-y-1">
                  {competitive.differentials.map((d: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                      <span>{d}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {hasMatching && (
        <Card data-testid="card-ai-matching">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="w-4 h-4 text-blue-500" /> Sinais para Deal Origination
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {matching.buyerPotential && (
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">Potencial Comprador:</p>
                <Badge variant="outline" className={`text-xs uppercase font-bold ${BUYER_POTENTIAL_COLORS[matching.buyerPotential] || ""}`}>
                  {matching.buyerPotential}
                </Badge>
              </div>
            )}
            {matching.investmentCapacity && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Capacidade de Investimento</p>
                <p className="text-sm">{matching.investmentCapacity}</p>
              </div>
            )}
            {matching.acquisitionHistory && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Histórico de Aquisições</p>
                <p className="text-sm">{matching.acquisitionHistory}</p>
              </div>
            )}
            {(matching.expansionSignals || []).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Sinais de Expansão</p>
                <div className="space-y-1">
                  {matching.expansionSignals.map((s: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                      <span>{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(matching.riskFactors || []).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Fatores de Risco</p>
                <div className="space-y-1">
                  {matching.riskFactors.map((r: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(matching.interestAreas || []).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Áreas de Interesse</p>
                <div className="flex flex-wrap gap-1.5">
                  {matching.interestAreas.map((a: string, i: number) => (
                    <Badge key={i} className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-0">{a}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {hasLegal && (
        <Card data-testid="card-ai-legal">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Scale className="w-4 h-4 text-slate-500" /> Compliance e Riscos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(legal.certifications || []).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Certificações</p>
                <div className="flex flex-wrap gap-1.5">
                  {legal.certifications.map((c: string, i: number) => (
                    <Badge key={i} className="text-xs gap-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 border-0">
                      <Award className="w-3 h-3" /> {c}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {(legal.lawsuits || []).filter(Boolean).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Processos Judiciais</p>
                <div className="space-y-1">
                  {legal.lawsuits.filter(Boolean).map((l: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <ShieldAlert className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                      <span>{l}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(legal.environmentalIssues || []).filter(Boolean).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Questões Ambientais</p>
                <div className="space-y-1">
                  {legal.environmentalIssues.filter(Boolean).map((e: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <FileWarning className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                      <span>{e}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(legal.debtSignals || []).filter(Boolean).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Sinais de Endividamento</p>
                <div className="space-y-1">
                  {legal.debtSignals.filter(Boolean).map((d: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                      <span>{d}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {intel.length > 0 && (
        <Card data-testid="card-ai-intel">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-yellow-500" /> Inteligência de Negócio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {intel.map((fact: string, i: number) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <Lightbulb className="w-3.5 h-3.5 text-yellow-500 mt-0.5 shrink-0" />
                  <span>{fact}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {sources.length > 0 && (
        <Card data-testid="card-ai-sources">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Link2 className="w-4 h-4 text-muted-foreground" /> Fontes Consultadas
              <Badge variant="outline" className="ml-auto text-xs">{sources.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {sources.map((url: string, i: number) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline truncate flex items-center gap-1">
                  <ExternalLink className="w-3 h-3 shrink-0" />
                  {(() => { try { return new URL(url).hostname; } catch { return url; } })()}
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
