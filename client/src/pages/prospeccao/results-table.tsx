import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Building2, MapPin, Briefcase, AlertCircle, Download, Loader2, Filter, XCircle, ExternalLink
} from "lucide-react";

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
  savedCompanyId?: number | null;
}

interface ResultsTableProps {
  searchResults: SearchResult[] | null;
  searchMeta: { count: number; next: string | null } | null;
  searchLoading: boolean;
  searchError: string | null;
  importingCnpj: string | null;
  disqualifyingCnpj: string | null;
  importedMap?: Record<string, number>;
  onImport: (cnpj: string) => void;
  onDisqualify: (cnpj: string) => void;
}

function statusColor(id: number | null) {
  if (id === 2) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400";
  if (id === 3) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
  if (id === 8) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
  return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
}

export default function ResultsTable({
  searchResults,
  searchMeta,
  searchLoading,
  searchError,
  importingCnpj,
  disqualifyingCnpj,
  importedMap = {},
  onImport,
  onDisqualify,
}: ResultsTableProps) {
  return (
    <div className="lg:col-span-2 space-y-3">
      {searchError && (
        <Card className="border-destructive">
          <CardContent className="pt-4">
            <p className="text-destructive text-sm flex items-center gap-1">
              <AlertCircle className="w-4 h-4" /> {searchError}
            </p>
          </CardContent>
        </Card>
      )}

      {searchMeta && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Building2 className="w-4 h-4" />
          <span>
            <span className="font-medium text-foreground">{searchMeta.count.toLocaleString("pt-BR")}</span> empresas encontradas
            {searchResults && searchResults.filter(r => r.alreadySaved || r.savedCompanyId).length > 0 && (
              <span className="ml-1 text-muted-foreground">
                ({searchResults.filter(r => r.alreadySaved || r.savedCompanyId).length} já no CRM)
              </span>
            )}
          </span>
        </div>
      )}

      {searchLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!searchLoading && searchResults && searchResults.filter(r => !r.alreadySaved || importedMap[r.taxId] || r.savedCompanyId).length === 0 && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center text-muted-foreground text-sm">
            Nenhuma empresa nova encontrada com esses filtros.
          </CardContent>
        </Card>
      )}

      {!searchLoading && searchResults &&
        searchResults
          .filter(r => !r.alreadySaved || importedMap[r.taxId] || r.savedCompanyId)
          .map(result => {
            const companyId = importedMap[result.taxId] || result.savedCompanyId;
            return (
            <Card key={result.taxId} data-testid={`card-result-${result.taxId}`} className={companyId ? "border-emerald-200 dark:border-emerald-800/50" : ""}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm truncate">{result.legalName}</p>
                      {result.tradeName && (
                        <p className="text-xs text-muted-foreground truncate">({result.tradeName})</p>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(result.statusId)}`}>
                        {result.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span className="font-mono">{result.taxId}</span>
                      {(result.city || result.state) && (
                        <span className="flex items-center gap-0.5">
                          <MapPin className="w-3 h-3" />
                          {[result.city, result.state].filter(Boolean).join(" – ")}
                        </span>
                      )}
                      {result.cnaePrincipal && (
                        <span className="flex items-center gap-0.5">
                          <Briefcase className="w-3 h-3" />
                          {result.cnaePrincipal}
                        </span>
                      )}
                      {result.founded && (
                        <span>Fundada: {result.founded}</span>
                      )}
                      {result.porte && (
                        <Badge variant="outline" className="text-xs py-0">{result.porte}</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {companyId ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-emerald-600 border-emerald-300 hover:bg-emerald-50"
                        onClick={() => window.open(`/empresas/${companyId}`, '_blank', 'noopener,noreferrer')}
                        data-testid={`button-abrir-${result.taxId}`}
                        title="Abrir empresa em nova aba"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span className="ml-1">Abrir</span>
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onDisqualify(result.taxId)}
                          disabled={disqualifyingCnpj === result.taxId}
                          data-testid={`button-desqualificar-${result.taxId}`}
                          className="text-destructive border-destructive/30 hover:bg-destructive/10 h-8 px-2"
                          title="Desqualificar — não aparece mais na busca"
                        >
                          {disqualifyingCnpj === result.taxId ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onImport(result.taxId)}
                          disabled={importingCnpj === result.taxId}
                          data-testid={`button-importar-${result.taxId}`}
                          className="h-8"
                        >
                          {importingCnpj === result.taxId ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Download className="w-3.5 h-3.5" />
                          )}
                          <span className="ml-1 hidden sm:inline">Importar</span>
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
            );
          })}

      {!searchLoading && !searchResults && !searchError && (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <Filter className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm font-medium">Configure os filtros e busque empresas</p>
          <p className="text-xs mt-1">Use CNAE, estado, porte, natureza jurídica e mais</p>
        </div>
      )}
    </div>
  );
}
