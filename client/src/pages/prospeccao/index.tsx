import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  Coins,
} from "lucide-react";
import PerfilSearch from "./perfil-search";

export default function ProspeccaoPage() {
  const { data: creditos } = useQuery<{ configured: boolean; transient: number; perpetual: number }>({
    queryKey: ["/api/prospeccao/creditos"],
    refetchInterval: 60000,
  });

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4 md:space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="text-prospeccao-title">Prospecção</h1>
          <p className="text-muted-foreground text-xs mt-0.5">
            Prospecte empresas por perfil usando filtros de localização, CNAE, porte e faturamento.
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

      <PerfilSearch />
    </div>
  );
}
