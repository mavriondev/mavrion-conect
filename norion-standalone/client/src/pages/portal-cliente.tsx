import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

function formatTaxId(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return digits
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export default function PortalClienteLogin() {
  const [taxId, setTaxId] = useState("");
  const [loading, setLoading] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    const existing = sessionStorage.getItem("portalClientId");
    if (existing) {
      setLocation("/portal-cliente/formulario");
    }
  }, [setLocation]);

  const handleLogin = async () => {
    const cleanTaxId = taxId.replace(/\D/g, "");
    if (cleanTaxId.length !== 11 && cleanTaxId.length !== 14) {
      toast({ title: "Informe um CPF ou CNPJ válido", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/norion-portal/login-cpf", {
        taxId: cleanTaxId,
      });
      const data = await res.json();
      sessionStorage.setItem("portalClientId", String(data.client.id));
      sessionStorage.setItem("portalToken", data.sessionToken);
      sessionStorage.setItem("portalClient", JSON.stringify(data.client));
      setLocation("/portal-cliente/formulario");
    } catch (err: any) {
      toast({ title: "Erro no login", description: err.message || "CPF/CNPJ não encontrado", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleLogin();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-slate-700 bg-slate-800/80 backdrop-blur shadow-2xl">
        <CardContent className="p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-500/20 mb-4">
              <Building2 className="w-8 h-8 text-amber-400" />
            </div>
            <h1 className="text-2xl font-bold text-white" data-testid="text-portal-title">Portal do Cliente</h1>
            <p className="text-sm text-slate-400 mt-1">Norion Capital</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">CPF ou CNPJ</Label>
              <Input
                placeholder="000.000.000-00"
                value={taxId}
                onChange={(e) => setTaxId(formatTaxId(e.target.value))}
                onKeyDown={handleKeyDown}
                className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500"
                data-testid="input-portal-taxid"
                maxLength={18}
                autoFocus
              />
            </div>
            <Button
              onClick={handleLogin}
              disabled={loading}
              className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
              data-testid="button-portal-login"
            >
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Entrar
            </Button>
          </div>

          <p className="text-xs text-slate-500 text-center mt-6">
            Acesso exclusivo para clientes. Se não possui cadastro, entre em contato com seu consultor.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
