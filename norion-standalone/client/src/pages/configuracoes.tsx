import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Settings2, CheckCircle2, Loader2, AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function NorionConfiguracoesPage() {
  const { toast } = useToast();
  const [anbimaClientId, setAnbimaClientId] = useState("");
  const [anbimaClientSecret, setAnbimaClientSecret] = useState("");

  const { data: settingsData } = useQuery<any>({ queryKey: ["/api/norion/settings"] });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => { const res = await apiRequest("POST", "/api/norion/settings", data); return res.json(); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/settings"] });
      toast({ title: "Credenciais ANBIMA salvas" });
      setAnbimaClientId(""); setAnbimaClientSecret("");
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 max-w-[1000px] mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Settings2 className="w-7 h-7 text-amber-500" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-norion-config-title">Configurações</h1>
          <p className="text-sm text-muted-foreground">Configurações da Norion Capital</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Credenciais ANBIMA</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {settingsData?.configured ? (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="w-4 h-4" />
              Configurado (Client ID: {settingsData.clientId}) — Fonte: {settingsData.source}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-amber-600">
              <AlertTriangle className="w-4 h-4" />
              Credenciais não configuradas
            </div>
          )}
          <div className="grid gap-3 max-w-md">
            <div>
              <Label className="text-sm">Client ID</Label>
              <Input placeholder="Seu Client ID ANBIMA" value={anbimaClientId} onChange={(e) => setAnbimaClientId(e.target.value)} data-testid="input-n-anbima-id" />
            </div>
            <div>
              <Label className="text-sm">Client Secret</Label>
              <Input type="password" placeholder="Seu Client Secret ANBIMA" value={anbimaClientSecret} onChange={(e) => setAnbimaClientSecret(e.target.value)} data-testid="input-n-anbima-secret" />
            </div>
          </div>
          <Button
            onClick={() => saveMutation.mutate({ clientId: anbimaClientId, clientSecret: anbimaClientSecret })}
            disabled={saveMutation.isPending || !anbimaClientId || !anbimaClientSecret}
            data-testid="button-n-save-anbima"
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
            Salvar Credenciais
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
