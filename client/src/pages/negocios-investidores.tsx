import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search, Briefcase, Building2, DollarSign, MapPin, Eye,
  Users, TrendingUp, Target, Loader2, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

function formatPrice(v: any) {
  if (!v) return null;
  const n = Number(v);
  if (isNaN(n)) return null;
  if (n >= 1e9) return `R$ ${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `R$ ${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `R$ ${(n / 1e3).toFixed(0)}K`;
  return `R$ ${n.toLocaleString("pt-BR")}`;
}

export default function NegociosInvestidoresPage() {
  const [tab, setTab] = useState("negocios");
  const [searchNegocios, setSearchNegocios] = useState("");
  const [searchInvestidores, setSearchInvestidores] = useState("");

  const { data: assets = [], isLoading: assetsLoading } = useQuery<any[]>({
    queryKey: ["/api/matching/assets"],
    queryFn: () => apiRequest("GET", "/api/matching/assets").then(r => r.json()),
  });

  const { data: companiesRaw = [], isLoading: companiesLoading } = useQuery<any[]>({
    queryKey: ["/api/companies/with-leads"],
    queryFn: () => apiRequest("GET", "/api/companies/with-leads").then(r => r.json()),
  });

  const negocios = useMemo(() => {
    let list = (assets as any[]).filter((a: any) => a.type === "NEGOCIO");
    if (searchNegocios) {
      const s = searchNegocios.toLowerCase();
      list = list.filter((a: any) =>
        a.title?.toLowerCase().includes(s) ||
        a.municipio?.toLowerCase().includes(s) ||
        a.location?.toLowerCase().includes(s) ||
        a.observacoes?.toLowerCase().includes(s)
      );
    }
    return list;
  }, [assets, searchNegocios]);

  const investidores = useMemo(() => {
    let list = (companiesRaw as any[]).filter((c: any) => {
      const ed = c.enrichmentData || {};
      return ed.buyerType === "estrategico" || ed.buyerType === "financeiro";
    });
    if (searchInvestidores) {
      const s = searchInvestidores.toLowerCase();
      list = list.filter((c: any) =>
        c.tradeName?.toLowerCase().includes(s) ||
        c.legalName?.toLowerCase().includes(s) ||
        c.taxId?.includes(s) ||
        c.address?.city?.toLowerCase().includes(s) ||
        c.address?.state?.toLowerCase().includes(s)
      );
    }
    return list;
  }, [companiesRaw, searchInvestidores]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4 md:space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-page-title">
          <Briefcase className="w-6 h-6 text-primary" />
          Negócios & Investidores
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Gerencie ativos M&A à venda e investidores interessados em aquisições.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="negocios" data-testid="tab-negocios">
            <Briefcase className="w-4 h-4 mr-2" />
            Negócios
            {negocios.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">{negocios.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="investidores" data-testid="tab-investidores">
            <Users className="w-4 h-4 mr-2" />
            Investidores
            {investidores.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">{investidores.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="negocios" className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar negócios..."
                value={searchNegocios}
                onChange={e => setSearchNegocios(e.target.value)}
                className="pl-9"
                data-testid="input-search-negocios"
              />
            </div>
            <Badge variant="outline" className="shrink-0">
              {negocios.length} {negocios.length === 1 ? "negócio" : "negócios"}
            </Badge>
          </div>

          {assetsLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1,2,3].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
            </div>
          ) : negocios.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Briefcase className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">
                  {searchNegocios ? "Nenhum negócio encontrado para esta busca." : "Nenhum negócio M&A cadastrado ainda."}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Cadastre ativos do tipo "Negócio / M&A" na página de Ativos.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {negocios.map((a: any) => {
                const campos = a.camposEspecificos || {};
                return (
                  <Card key={a.id} className="hover:shadow-md transition-shadow" data-testid={`card-negocio-${a.id}`}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-sm truncate" title={a.title}>{a.title}</h3>
                          {a.linkedCompanyName && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              <Building2 className="w-3 h-3 inline mr-1" />
                              {a.linkedCompanyName}
                            </p>
                          )}
                        </div>
                        <Badge className="bg-blue-100 text-blue-800 shrink-0 text-xs">M&A</Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {a.priceAsking && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <DollarSign className="w-3 h-3" />
                            <span className="font-medium text-foreground">{formatPrice(a.priceAsking)}</span>
                          </div>
                        )}
                        {(a.municipio || a.estado || a.location) && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <MapPin className="w-3 h-3" />
                            <span className="truncate">{a.municipio ? `${a.municipio}/${a.estado}` : a.location || a.estado}</span>
                          </div>
                        )}
                        {campos.faturamentoAnual && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <TrendingUp className="w-3 h-3" />
                            <span>Fat: {formatPrice(campos.faturamentoAnual)}</span>
                          </div>
                        )}
                        {campos.ebitda && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Target className="w-3 h-3" />
                            <span>EBITDA: {formatPrice(campos.ebitda)}</span>
                          </div>
                        )}
                      </div>

                      {campos.motivoVenda && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{campos.motivoVenda}</p>
                      )}

                      <Link href={`/ativos/${a.id}`}>
                        <Button variant="outline" size="sm" className="w-full" data-testid={`button-ver-negocio-${a.id}`}>
                          <Eye className="w-3.5 h-3.5 mr-1.5" /> Ver Detalhes
                        </Button>
                      </Link>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="investidores" className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar investidores..."
                value={searchInvestidores}
                onChange={e => setSearchInvestidores(e.target.value)}
                className="pl-9"
                data-testid="input-search-investidores"
              />
            </div>
            <Badge variant="outline" className="shrink-0">
              {investidores.length} {investidores.length === 1 ? "investidor" : "investidores"}
            </Badge>
          </div>

          {companiesLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1,2,3].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
            </div>
          ) : investidores.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">Nenhum investidor cadastrado ainda.</p>
                <p className="text-xs text-muted-foreground mt-2 max-w-md mx-auto">
                  Para marcar uma empresa como investidor, busque o CNPJ em Prospecção, abra o detalhe da empresa e defina o "Perfil de Comprador / Investidor" como Estratégico ou Financeiro.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {investidores.map((c: any) => {
                const ed = c.enrichmentData || {};
                const isEstrategico = ed.buyerType === "estrategico";
                const capacidade = ed.capacidadeAquisicao ? formatPrice(ed.capacidadeAquisicao) : null;
                const regioes = (ed.regioesInteresse || []).join(", ");
                const cnaes = (ed.cnaeInteresse || []);

                return (
                  <Card key={c.id} className="hover:shadow-md transition-shadow" data-testid={`card-investidor-${c.id}`}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-sm truncate" title={c.tradeName || c.legalName}>
                            {c.tradeName || c.legalName}
                          </h3>
                          {c.tradeName && c.legalName && c.tradeName !== c.legalName && (
                            <p className="text-xs text-muted-foreground truncate">{c.legalName}</p>
                          )}
                        </div>
                        <Badge className={cn(
                          "shrink-0 text-xs",
                          isEstrategico
                            ? "bg-blue-100 text-blue-800"
                            : "bg-green-100 text-green-800"
                        )}>
                          {isEstrategico ? "Estratégico" : "Financeiro"}
                        </Badge>
                      </div>

                      <div className="space-y-1.5 text-xs">
                        {c.taxId && (
                          <p className="text-muted-foreground font-mono">{c.taxId.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}</p>
                        )}
                        {(c.address?.city || c.address?.state) && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <MapPin className="w-3 h-3" />
                            <span>{[c.address.city, c.address.state].filter(Boolean).join("/")}</span>
                          </div>
                        )}
                        {capacidade && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <DollarSign className="w-3 h-3" />
                            <span>Capacidade: <span className="font-medium text-foreground">{capacidade}</span></span>
                          </div>
                        )}
                        {regioes && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <MapPin className="w-3 h-3" />
                            <span className="truncate">Regiões: {regioes}</span>
                          </div>
                        )}
                        {cnaes.length > 0 && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Target className="w-3 h-3" />
                            <span className="truncate">{cnaes.length} CNAE(s) de interesse</span>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <Link href={`/empresas/${c.id}`} className="flex-1">
                          <Button variant="outline" size="sm" className="w-full" data-testid={`button-ver-investidor-${c.id}`}>
                            <Eye className="w-3.5 h-3.5 mr-1.5" /> Ver Empresa
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
