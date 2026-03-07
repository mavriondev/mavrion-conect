import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Search,
  AlertCircle,
  Download,
  Loader2,
  Filter,
  XCircle,
  Coins,
  ExternalLink,
  Brain,
  Sparkles,
} from "lucide-react";
import SearchFilters, { type Filters, INITIAL_FILTERS, getActiveFilterCount } from "./search-filters";
import ResultsTable from "./results-table";


interface CnpjDetail {
  legalName: string;
  tradeName: string | null;
  cnpj: string;
  cnaePrincipal: string | null;
  porte: string | null;
  status: string | null;
  natureza: string | null;
  simplesNacional: boolean;
  phones: string[];
  emails: string[];
  address: {
    street?: string;
    number?: string;
    district?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  socios: { name: string; role: string; since: string }[];
  savedCompanyId?: number | null;
}

interface SearchResult {
  taxId: string;
  legalName: string;
  tradeName: string | null;
  status: string | null;
  statusId: number | null;
  porte: string | null;
  cnaePrincipal: string | null;
  cnaeCode: number | null;
  city: string | null;
  state: string | null;
  founded: string | null;
  alreadySaved: boolean;
}

export default function ProspeccaoPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const { data: creditos } = useQuery<{ configured: boolean; transient: number; perpetual: number }>({
    queryKey: ["/api/prospeccao/creditos"],
    refetchInterval: 60000,
  });

  const [cnpjInput, setCnpjInput] = useState("");
  const [cnpjDetail, setCnpjDetail] = useState<CnpjDetail | null>(null);
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cnpjError, setCnpjError] = useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchMeta, setSearchMeta] = useState<{ count: number; next: string | null } | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [importingCnpj, setImportingCnpj] = useState<string | null>(null);
  const [importedMap, setImportedMap] = useState<Record<string, number>>({});
  const [disqualifyingCnpj, setDisqualifyingCnpj] = useState<string | null>(null);

  const [nlQuery, setNlQuery] = useState("");
  const [nlLoading, setNlLoading] = useState(false);
  const [nlResult, setNlResult] = useState<any>(null);

  const lookupCnpj = async () => {
    const clean = cnpjInput.replace(/\D/g, "");
    if (clean.length !== 14) {
      setCnpjError("CNPJ deve ter 14 dígitos");
      return;
    }
    setCnpjLoading(true);
    setCnpjError(null);
    setCnpjDetail(null);
    try {
      const res = await fetch(`/api/cnpj/${clean}`);
      if (!res.ok) {
        const err = await res.json();
        setCnpjError(err.message || "Erro na consulta");
      } else {
        const data = await res.json();
        setCnpjDetail(data);
      }
    } catch {
      setCnpjError("Falha ao consultar CNPJ");
    } finally {
      setCnpjLoading(false);
    }
  };

  const runAdvancedSearch = async () => {
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults(null);
    try {
      const params = new URLSearchParams();
      if (filters.names.trim()) params.set("names", filters.names.trim());
      if (filters.states.length > 0) params.set("state", filters.states.join(","));
      if (filters.cities.length > 0) params.set("city", filters.cities.join(","));
      if (filters.cnaeIds.length > 0) params.set("cnae", filters.cnaeIds.join(","));
      if (filters.cnaeSideIds.length > 0) params.set("cnae_side", filters.cnaeSideIds.join(","));
      if (filters.sizes.length > 0) params.set("size", filters.sizes.join(","));
      if (filters.statuses.length > 0) params.set("status", filters.statuses.join(","));
      if (filters.natures.length > 0) params.set("nature", filters.natures.join(","));
      if (filters.simples) params.set("simples", filters.simples);
      if (filters.mei) params.set("mei", filters.mei);
      if (filters.head) params.set("head", filters.head);
      if (filters.hasPhone) params.set("has_phone", "true");
      if (filters.hasEmail) params.set("has_email", "true");
      if (filters.foundedFrom) params.set("founded_from", filters.foundedFrom);
      if (filters.foundedTo) params.set("founded_to", filters.foundedTo);
      if (filters.equityMin) params.set("equity_min", filters.equityMin);
      if (filters.equityMax) params.set("equity_max", filters.equityMax);
      if (filters.ddds.length > 0) params.set("ddd", filters.ddds.join(","));
      params.set("limit", "50");

      const res = await fetch(`/api/prospeccao/search?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json();
        setSearchError(err.message || "Erro na busca");
      } else {
        const data = await res.json();
        setSearchResults(data.results);
        setSearchMeta({ count: data.count, next: data.next });
      }
    } catch {
      setSearchError("Falha na busca");
    } finally {
      setSearchLoading(false);
    }
  };

  const importLead = async (cnpj: string) => {
    setImportingCnpj(cnpj);
    try {
      const res = await apiRequest("POST", `/api/cnpj/${cnpj}/import`);
      const data = await res.json();
      toast({ title: "Lead importado com sucesso!" });
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies/with-leads"] });
      if (data?.companyId || data?.id) {
        setImportedMap(prev => ({ ...prev, [cnpj]: data.companyId || data.id }));
      }
      if (searchResults) {
        setSearchResults(prev =>
          prev ? prev.map(r => r.taxId === cnpj ? { ...r, alreadySaved: true } : r) : prev
        );
      }
    } catch (err: any) {
      let msg = "Erro ao importar";
      try {
        const raw = err?.message || "";
        const jsonPart = raw.indexOf("{") >= 0 ? raw.slice(raw.indexOf("{")) : raw;
        const body = JSON.parse(jsonPart);
        if (body?.message) msg = body.message;
      } catch {
        if (err?.message && !err.message.startsWith("{")) {
          const cleanMsg = err.message.replace(/^\d+:\s*/, "");
          if (cleanMsg.length > 0 && cleanMsg.length < 200) msg = cleanMsg;
        }
      }
      toast({ title: msg, variant: "destructive" });
    } finally {
      setImportingCnpj(null);
    }
  };

  const importarComoAtivo = async (empresa: any) => {
    const cnpj = (empresa.taxId || empresa.cnpj || "").replace(/\D/g, "");
    setImportingCnpj(cnpj);
    try {
      const res = await apiRequest("POST", `/api/cnpj/${cnpj}/import-as-asset`, {});
      const data = await res.json();
      toast({
        title: "Ativo criado com sucesso",
        description: `${empresa.tradeName || empresa.legalName} cadastrado como ativo NEGOCIO`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/matching/assets"] });
      navigate(`/ativos/${data.asset.id}`);
    } catch {
      toast({ title: "Erro ao criar ativo", variant: "destructive" });
    } finally {
      setImportingCnpj(null);
    }
  };

  const disqualifyLead = async (cnpj: string) => {
    setDisqualifyingCnpj(cnpj);
    try {
      await apiRequest("POST", `/api/cnpj/${cnpj}/disqualify`);
      toast({ title: "Empresa desqualificada", description: "Não aparecerá mais nos resultados de busca." });
      queryClient.invalidateQueries({ queryKey: ["/api/companies/with-leads"] });
      if (cnpjDetail) setCnpjDetail(null);
      if (searchResults) {
        setSearchResults(prev =>
          prev ? prev.map(r => r.taxId === cnpj ? { ...r, alreadySaved: true } : r) : prev
        );
      }
    } catch {
      toast({ title: "Erro ao desqualificar", variant: "destructive" });
    } finally {
      setDisqualifyingCnpj(null);
    }
  };

  const clearFilters = () => {
    setFilters({ ...INITIAL_FILTERS });
    setSearchResults(null);
    setSearchMeta(null);
    setSearchError(null);
  };

  const activeFilterCount = getActiveFilterCount(filters);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Prospecção</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Consulte e descubra empresas via base da Receita Federal. Leads já importados não aparecem nos resultados.
          </p>
        </div>
        {creditos?.configured && (
          <div className="flex items-center gap-2 shrink-0" data-testid="cnpja-creditos">
            <Coins className="w-4 h-4 text-amber-500" />
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">Créditos CNPJ.ja:</span>
              <Badge variant="secondary" className="font-mono" data-testid="creditos-transient">
                {creditos.transient.toLocaleString("pt-BR")} transitórios
              </Badge>
              <Badge variant="outline" className="font-mono" data-testid="creditos-perpetual">
                {creditos.perpetual.toLocaleString("pt-BR")} permanentes
              </Badge>
            </div>
          </div>
        )}
      </div>

      <Tabs defaultValue="simples">
        <TabsList>
          <TabsTrigger value="simples" data-testid="tab-busca-simples">
            <Search className="w-4 h-4 mr-2" />
            Busca por CNPJ
          </TabsTrigger>
          <TabsTrigger value="avancada" data-testid="tab-busca-avancada">
            <Filter className="w-4 h-4 mr-2" />
            Busca Avançada
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs py-0 h-4">{activeFilterCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="ia" data-testid="tab-busca-ia">
            <Brain className="w-4 h-4 mr-2" />
            Busca IA
          </TabsTrigger>
        </TabsList>

        <TabsContent value="simples" className="space-y-4 mt-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-2">
                <Input
                  placeholder="Digite o CNPJ (ex: 11.222.333/0001-81)"
                  value={cnpjInput}
                  onChange={e => setCnpjInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && lookupCnpj()}
                  data-testid="input-cnpj-simples"
                  className="max-w-sm"
                />
                <Button onClick={lookupCnpj} disabled={cnpjLoading} data-testid="button-consultar-cnpj">
                  {cnpjLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  <span className="ml-2">Consultar</span>
                </Button>
              </div>
              {cnpjError && (
                <p className="text-sm text-destructive mt-2 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" /> {cnpjError}
                </p>
              )}
            </CardContent>
          </Card>

          {cnpjDetail && (
            <Card data-testid="card-cnpj-detail">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg">{cnpjDetail.legalName}</CardTitle>
                    {cnpjDetail.tradeName && (
                      <p className="text-sm text-muted-foreground">{cnpjDetail.tradeName}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cnpjDetail.status === "Ativa" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-gray-100 text-gray-700"}`}>
                      {cnpjDetail.status}
                    </span>
                    {(importedMap[cnpjDetail.cnpj] || cnpjDetail.savedCompanyId) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-emerald-600 border-emerald-300 hover:bg-emerald-50"
                        onClick={() => window.open(`/empresas/${importedMap[cnpjDetail.cnpj] || cnpjDetail.savedCompanyId}`, '_blank', 'noopener,noreferrer')}
                        data-testid="button-abrir-cnpj-simples"
                      >
                        <ExternalLink className="w-4 h-4 mr-1" />
                        Abrir Empresa
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => disqualifyLead(cnpjDetail.cnpj)}
                          disabled={disqualifyingCnpj === cnpjDetail.cnpj}
                          data-testid="button-desqualificar-cnpj-simples"
                          className="text-destructive border-destructive/30 hover:bg-destructive/10"
                        >
                          {disqualifyingCnpj === cnpjDetail.cnpj ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-1" />
                          ) : (
                            <XCircle className="w-4 h-4 mr-1" />
                          )}
                          Desqualificar
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => importLead(cnpjDetail.cnpj)}
                          disabled={importingCnpj === cnpjDetail.cnpj}
                          data-testid="button-importar-cnpj-simples"
                        >
                          {importingCnpj === cnpjDetail.cnpj ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-1" />
                          ) : (
                            <Download className="w-4 h-4 mr-1" />
                          )}
                          Importar como Lead
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="space-y-2">
                    <p><span className="font-medium text-muted-foreground">CNPJ:</span> {cnpjDetail.cnpj}</p>
                    <p><span className="font-medium text-muted-foreground">CNAE:</span> {cnpjDetail.cnaePrincipal || "—"}</p>
                    <p><span className="font-medium text-muted-foreground">Porte:</span> {cnpjDetail.porte || "—"}</p>
                    <p><span className="font-medium text-muted-foreground">Natureza:</span> {cnpjDetail.natureza || "—"}</p>
                    <p><span className="font-medium text-muted-foreground">Simples Nacional:</span> {cnpjDetail.simplesNacional ? "Sim" : "Não"}</p>
                  </div>
                  <div className="space-y-2">
                    {cnpjDetail.address?.city && (
                      <p><span className="font-medium text-muted-foreground">Endereço:</span>{" "}
                        {[cnpjDetail.address.street, cnpjDetail.address.number, cnpjDetail.address.district, cnpjDetail.address.city, cnpjDetail.address.state].filter(Boolean).join(", ")}
                      </p>
                    )}
                    {cnpjDetail.phones.length > 0 && (
                      <p><span className="font-medium text-muted-foreground">Telefones:</span> {cnpjDetail.phones.join(", ")}</p>
                    )}
                    {cnpjDetail.emails.length > 0 && (
                      <p><span className="font-medium text-muted-foreground">E-mails:</span> {cnpjDetail.emails.join(", ")}</p>
                    )}
                  </div>
                </div>
                {cnpjDetail.socios.length > 0 && (
                  <div className="mt-4">
                    <p className="font-medium text-muted-foreground text-sm mb-2">Sócios / Quadro Societário</p>
                    <div className="space-y-1">
                      {cnpjDetail.socios.map((s, i) => (
                        <p key={i} className="text-sm">
                          <span className="font-medium">{s.name}</span>
                          {s.role && <span className="text-muted-foreground"> — {s.role}</span>}
                          {s.since && <span className="text-muted-foreground"> (desde {s.since})</span>}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="avancada" className="space-y-4 mt-4">
          <div className="flex items-center gap-3 bg-background/95 backdrop-blur sticky top-0 z-10 py-2 -mx-1 px-1 border-b">
            <Button
              className="gap-2 h-9 px-5"
              onClick={runAdvancedSearch}
              disabled={searchLoading}
              data-testid="button-buscar-topo"
            >
              {searchLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              {searchLoading ? "Buscando..." : "Buscar Empresas"}
            </Button>
            {searchMeta && (
              <span className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{searchMeta.count.toLocaleString("pt-BR")}</span> empresas encontradas
              </span>
            )}
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="text-xs">{activeFilterCount} filtro{activeFilterCount !== 1 ? "s" : ""} ativo{activeFilterCount !== 1 ? "s" : ""}</Badge>
            )}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <SearchFilters
              filters={filters}
              setFilters={setFilters}
              searchLoading={searchLoading}
              activeFilterCount={activeFilterCount}
              onSearch={runAdvancedSearch}
              onClear={clearFilters}
            />

            <ResultsTable
              searchResults={searchResults}
              searchMeta={searchMeta}
              searchLoading={searchLoading}
              searchError={searchError}
              importingCnpj={importingCnpj}
              disqualifyingCnpj={disqualifyingCnpj}
              importedMap={importedMap}
              onImport={importLead}
              onImportAsAsset={importarComoAtivo}
              onDisqualify={disqualifyLead}
            />
          </div>
        </TabsContent>

        <TabsContent value="ia" className="space-y-4 mt-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-2">
                <Input
                  placeholder="Ex: fazendas acima de 500 hectares em Mato Grosso até R$ 10 milhões..."
                  value={nlQuery}
                  onChange={e => setNlQuery(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !nlLoading && nlQuery.trim() && (async () => {
                    setNlLoading(true);
                    try {
                      const res = await apiRequest("POST", "/api/ai/search", { query: nlQuery });
                      const data = await res.json();
                      setNlResult(data);
                    } catch (e: any) {
                      toast({ title: "Erro na busca IA", description: e.message, variant: "destructive" });
                    } finally {
                      setNlLoading(false);
                    }
                  })()}
                  data-testid="input-nl-search"
                  className="flex-1"
                />
                <Button
                  onClick={async () => {
                    if (!nlQuery.trim()) return;
                    setNlLoading(true);
                    try {
                      const res = await apiRequest("POST", "/api/ai/search", { query: nlQuery });
                      const data = await res.json();
                      setNlResult(data);
                    } catch (e: any) {
                      toast({ title: "Erro na busca IA", description: e.message, variant: "destructive" });
                    } finally {
                      setNlLoading(false);
                    }
                  }}
                  disabled={nlLoading || !nlQuery.trim()}
                  data-testid="button-nl-search"
                >
                  {nlLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  Buscar com IA
                </Button>
              </div>
            </CardContent>
          </Card>

          {nlResult && (
            <div className="space-y-4" data-testid="text-nl-results">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-sm">
                  {nlResult.totalEncontrado ?? 0} resultado{(nlResult.totalEncontrado ?? 0) !== 1 ? "s" : ""}
                </Badge>
              </div>

              {nlResult.resultados && nlResult.resultados.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {nlResult.resultados.map((r: any, idx: number) => (
                    <Card key={r.id || idx} data-testid={`card-nl-result-${r.id || idx}`}>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-semibold">{r.title || r.titulo || "Sem título"}</h4>
                          {r.type && <Badge variant="outline" className="text-[10px] shrink-0">{r.type}</Badge>}
                        </div>
                        {(r.municipio || r.estado) && (
                          <p className="text-xs text-muted-foreground">
                            {[r.municipio, r.estado].filter(Boolean).join(" / ")}
                          </p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          {r.area && <span>{r.area} ha</span>}
                          {r.price && <span>R$ {Number(r.price).toLocaleString("pt-BR")}</span>}
                          {r.geoScore != null && <span>Geo: {r.geoScore}</span>}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {nlResult.insights && (
                <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground" data-testid="text-nl-insights">
                  {nlResult.insights}
                </div>
              )}
            </div>
          )}
        </TabsContent>

      </Tabs>
    </div>
  );
}
