import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Magnet, Loader2, Search, Building2, CheckCircle2,
  XCircle, Plus, ArrowRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function NorionSdrPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const { data: leads = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/sdr/queue"] });

  const updateLeadMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await apiRequest("PATCH", `/api/sdr/leads/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/queue"] });
      toast({ title: "Lead atualizado" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const pendingLeads = (leads as any[]).filter((l: any) => l.status === "new" || l.status === "pending");

  const filtered = pendingLeads.filter((l: any) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const companyName = (l.company?.legalName || l.company?.tradeName || "").toLowerCase();
    const cnpj = l.company?.cnpj || "";
    return companyName.includes(q) || cnpj.includes(q);
  });

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Magnet className="w-7 h-7 text-amber-500" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-norion-sdr-title">Fila SDR</h1>
          <p className="text-sm text-muted-foreground">Leads para qualificação e criação de operações</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome ou CNPJ..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-n-sdr-search" />
        </div>
        <Badge variant="secondary">{filtered.length} lead(s) pendente(s)</Badge>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12 text-muted-foreground">
            <Magnet className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p>Nenhum lead pendente na fila</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>CNPJ</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((l: any) => (
                <TableRow key={l.id} data-testid={`row-n-lead-${l.id}`}>
                  <TableCell className="font-medium">{l.company?.legalName || l.company?.tradeName || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono">{l.company?.cnpj || "—"}</TableCell>
                  <TableCell className="text-sm">{l.source || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{l.status === "new" ? "Novo" : "Pendente"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button variant="outline" size="sm" className="h-7 text-xs text-green-600"
                        onClick={() => updateLeadMutation.mutate({ id: l.id, status: "qualified" })}
                        disabled={updateLeadMutation.isPending} data-testid={`button-n-qualify-${l.id}`}>
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Qualificar
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs text-red-500"
                        onClick={() => updateLeadMutation.mutate({ id: l.id, status: "disqualified" })}
                        disabled={updateLeadMutation.isPending} data-testid={`button-n-disqualify-${l.id}`}>
                        <XCircle className="w-3 h-3 mr-1" /> Desqualificar
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
