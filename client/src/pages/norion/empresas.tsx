import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation, Link } from "wouter";
import { cn } from "@/lib/utils";
import { Building2, Loader2, RefreshCw, Plus, Leaf } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function ProfileBadge({ profile }: { profile: string | null | undefined }) {
  const p = (profile || "baixo").toLowerCase();
  const colors: Record<string, string> = {
    alto: "bg-green-100 text-green-700 border-green-300",
    medio: "bg-amber-100 text-amber-700 border-amber-300",
    baixo: "bg-slate-100 text-slate-600 border-slate-300",
  };
  return <Badge variant="outline" className={cn("text-xs", colors[p] || colors.baixo)}>{p.charAt(0).toUpperCase() + p.slice(1)}</Badge>;
}

function CafBadge({ enrichmentData }: { enrichmentData: any }) {
  const caf = enrichmentData?.caf;
  if (!caf || !caf.numeroCAF) return <Badge variant="outline" className="text-xs bg-slate-50 text-slate-400 border-slate-200">Sem CAF</Badge>;
  const isValid = caf.validade && new Date(caf.validade) > new Date();
  return (
    <Badge variant="outline" className={cn("text-xs", isValid ? "bg-green-50 text-green-700 border-green-300" : "bg-red-50 text-red-600 border-red-300")}>
      <Leaf className="w-3 h-3 mr-1" />
      {isValid ? "CAF Ativo" : "CAF Vencido"}
    </Badge>
  );
}

function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export default function NorionEmpresasPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: companies = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/crm/companies"] });

  const recalcMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("POST", "/api/norion/recalculate-profiles"); return res.json(); },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      toast({ title: "Perfis recalculados", description: `${data.alto} alto, ${data.medio} médio, ${data.baixo} baixo` });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Building2 className="w-7 h-7 text-amber-500" />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold" data-testid="text-norion-empresas-title">Empresas</h1>
          <p className="text-sm text-muted-foreground">Perfil financeiro das empresas para operações de crédito</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">{companies.length} empresa(s)</p>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={() => recalcMutation.mutate()} disabled={recalcMutation.isPending} data-testid="button-n-recalculate-profiles">
            <RefreshCw className={cn("w-4 h-4 mr-1.5", recalcMutation.isPending && "animate-spin")} />
            Recalcular Perfis
          </Button>
          <Link href="/norion-app/empresas/nova">
            <Button data-testid="button-cadastrar-empresa">
              <Plus className="w-4 h-4 mr-1.5" />
              Cadastrar Empresa
            </Button>
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>CNPJ</TableHead>
                <TableHead>Setor (CNAE)</TableHead>
                <TableHead>Porte</TableHead>
                <TableHead className="text-center">Perfil</TableHead>
                <TableHead className="text-center">CAF</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c: any) => (
                <TableRow
                  key={c.id}
                  data-testid={`row-n-company-${c.id}`}
                  className="cursor-pointer hover-elevate"
                  onClick={() => navigate(`/norion-app/empresas/${c.id}`)}
                >
                  <TableCell className="font-medium">{c.legalName || c.tradeName || "\u2014"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.cnpj ? formatCnpj(c.cnpj) : "\u2014"}</TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">{c.cnaePrincipal || "\u2014"}</TableCell>
                  <TableCell className="text-sm">{c.porte || "\u2014"}</TableCell>
                  <TableCell className="text-center"><ProfileBadge profile={c.norionProfile} /></TableCell>
                  <TableCell className="text-center"><CafBadge enrichmentData={c.enrichmentData} /></TableCell>
                </TableRow>
              ))}
              {companies.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhuma empresa cadastrada</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
