import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Building2, Loader2, Search, ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export default function EmpresaNovaPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [formData, setFormData] = useState({
    legalName: "",
    tradeName: "",
    cnpj: "",
    email: "",
    phone: "",
    cnaePrincipal: "",
    porte: "",
  });
  const [cnpjLoading, setCnpjLoading] = useState(false);

  const createMutation = useMutation({
    mutationFn: async () => {
      const body: any = {
        legalName: formData.legalName,
        tradeName: formData.tradeName || undefined,
        cnpj: formData.cnpj.replace(/\D/g, "") || undefined,
        cnaePrincipal: formData.cnaePrincipal || undefined,
        porte: formData.porte || undefined,
        emails: formData.email ? [formData.email] : [],
        phones: formData.phone ? [formData.phone] : [],
      };
      const res = await apiRequest("POST", "/api/crm/companies", body);
      return res.json();
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      try {
        await apiRequest("POST", "/api/norion/recalculate-profiles");
      } catch {}
      toast({ title: "Empresa cadastrada", description: "Empresa adicionada com sucesso." });
      navigate("/norion-app/empresas");
    },
    onError: (err: any) => toast({ title: "Erro ao cadastrar", description: err.message, variant: "destructive" }),
  });

  async function handleCnpjSearch() {
    const clean = formData.cnpj.replace(/\D/g, "");
    if (clean.length !== 14) {
      toast({ title: "CNPJ inválido", description: "Informe os 14 dígitos do CNPJ.", variant: "destructive" });
      return;
    }
    setCnpjLoading(true);
    try {
      const res = await fetch(`/api/cnpj/${clean}`);
      if (!res.ok) throw new Error("Não foi possível consultar o CNPJ");
      const data = await res.json();
      setFormData((prev) => ({
        ...prev,
        legalName: data.company?.name || data.name || prev.legalName,
        tradeName: data.alias || data.tradeName || prev.tradeName,
        cnaePrincipal: data.mainActivity?.text || data.mainActivity?.description || data.cnaePrincipal || prev.cnaePrincipal,
        porte: data.company?.size?.text || data.size || data.porte || prev.porte,
      }));
      toast({ title: "CNPJ encontrado", description: "Dados preenchidos automaticamente." });
    } catch (err: any) {
      toast({ title: "Erro na consulta", description: err.message, variant: "destructive" });
    } finally {
      setCnpjLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-[800px] mx-auto space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => navigate("/norion-app/empresas")} data-testid="button-voltar-empresas">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <Building2 className="w-7 h-7 text-amber-500" />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold" data-testid="text-empresa-nova-title">Cadastrar Empresa</h1>
          <p className="text-sm text-muted-foreground">Preencha os dados para cadastrar uma nova empresa</p>
        </div>
      </div>

      <Card className="p-6">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>CNPJ</Label>
            <div className="flex items-center gap-2">
              <Input
                data-testid="input-cnpj"
                placeholder="00.000.000/0000-00"
                value={formData.cnpj}
                onChange={(e) => setFormData((p) => ({ ...p, cnpj: formatCnpj(e.target.value) }))}
              />
              <Button
                variant="outline"
                onClick={handleCnpjSearch}
                disabled={cnpjLoading}
                data-testid="button-buscar-cnpj"
              >
                {cnpjLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Razão Social</Label>
            <Input
              data-testid="input-razao-social"
              placeholder="Razão Social"
              value={formData.legalName}
              onChange={(e) => setFormData((p) => ({ ...p, legalName: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Nome Fantasia</Label>
            <Input
              data-testid="input-nome-fantasia"
              placeholder="Nome Fantasia"
              value={formData.tradeName}
              onChange={(e) => setFormData((p) => ({ ...p, tradeName: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                data-testid="input-email"
                type="email"
                placeholder="email@empresa.com"
                value={formData.email}
                onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Telefone</Label>
              <Input
                data-testid="input-telefone"
                placeholder="(00) 00000-0000"
                value={formData.phone}
                onChange={(e) => setFormData((p) => ({ ...p, phone: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>CNAE Principal</Label>
              <Input
                data-testid="input-cnae"
                placeholder="Preenchido automaticamente"
                value={formData.cnaePrincipal}
                onChange={(e) => setFormData((p) => ({ ...p, cnaePrincipal: e.target.value }))}
                readOnly={!!formData.cnaePrincipal && cnpjLoading === false}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Porte</Label>
              <Input
                data-testid="input-porte"
                placeholder="Preenchido automaticamente"
                value={formData.porte}
                onChange={(e) => setFormData((p) => ({ ...p, porte: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => navigate("/norion-app/empresas")} data-testid="button-cancelar-cadastro">Cancelar</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!formData.legalName || createMutation.isPending}
              data-testid="button-salvar-empresa"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
              Salvar
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
