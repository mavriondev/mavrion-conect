import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Landmark, Search, ExternalLink, Loader2 } from "lucide-react";

export default function FiiFundosPage() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/cvm/fundos", query],
    queryFn: () => apiRequest("GET", `/api/cvm/fundos?q=${encodeURIComponent(query)}`).then(r => r.json()),
    enabled: query.length >= 3,
  });

  const fundos = data?.fundos || [];

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-fii-title">
          <Landmark className="w-6 h-6 text-emerald-600" />
          FII / Fundos — CVM
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pesquise fundos imobiliários e fundos de investimento registrados na CVM
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Nome do fundo, CNPJ ou administrador..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search.length >= 3 && setQuery(search)}
          className="max-w-lg"
          data-testid="input-search-fundo"
        />
        <Button
          onClick={() => setQuery(search)}
          disabled={search.length < 3 || isLoading}
          data-testid="button-search-fundo"
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Buscar
        </Button>
      </div>

      {!query && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Landmark className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Digite o nome de um fundo, CNPJ ou administrador para iniciar a pesquisa</p>
          </CardContent>
        </Card>
      )}

      {query && !isLoading && fundos.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <p className="text-sm">Nenhum fundo encontrado para "{query}"</p>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Consultando CVM...</span>
        </div>
      )}

      <div className="grid gap-3">
        {fundos.map((f: any, i: number) => (
          <Card key={i} className="hover:shadow-md transition-shadow" data-testid={`card-fundo-${i}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{f.denomSocial || f.name}</p>
                  <p className="text-xs text-muted-foreground">{f.cnpj}</p>
                  {f.admin && <p className="text-xs text-muted-foreground">Admin: {f.admin}</p>}
                  <div className="flex gap-1.5 flex-wrap mt-1">
                    {f.tipo && <Badge variant="outline" className="text-[10px]">{f.tipo}</Badge>}
                    {f.situacao && (
                      <Badge variant="outline" className={`text-[10px] ${f.situacao === "EM FUNCIONAMENTO NORMAL" ? "text-emerald-600 border-emerald-300" : "text-amber-600 border-amber-300"}`}>
                        {f.situacao}
                      </Badge>
                    )}
                    {f.patrimLiq && <Badge variant="outline" className="text-[10px]">PL: R$ {Number(f.patrimLiq).toLocaleString("pt-BR")}</Badge>}
                  </div>
                </div>
                {f.cnpj && (
                  <a
                    href={`https://cvmweb.cvm.gov.br/SWB/Sistemas/SCW/CPublica/CConworConworFundoMaisCnpj.aspx?cnpj=${f.cnpj.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0"
                  >
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" data-testid={`button-cvm-${i}`}>
                      CVM <ExternalLink className="w-3 h-3" />
                    </Button>
                  </a>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
