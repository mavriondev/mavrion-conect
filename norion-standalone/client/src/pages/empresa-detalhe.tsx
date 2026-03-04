import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Building2, Loader2, ArrowLeft, Phone, Mail, MapPin, Globe, CreditCard, Leaf, Users, ExternalLink, Check, Edit2, Save, Tractor } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

function ProfileBadge({ profile }: { profile: string | null | undefined }) {
  const p = (profile || "baixo").toLowerCase();
  const colors: Record<string, string> = {
    alto: "bg-green-100 text-green-700 border-green-300",
    medio: "bg-amber-100 text-amber-700 border-amber-300",
    baixo: "bg-slate-100 text-slate-600 border-slate-300",
  };
  return <Badge variant="outline" className={cn("text-xs", colors[p] || colors.baixo)}>{p.charAt(0).toUpperCase() + p.slice(1)}</Badge>;
}

function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function formatBRL(value: number | null | undefined) {
  if (value === null || value === undefined) return "\u2014";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function CafSection({ company }: { company: any }) {
  const { toast } = useToast();
  const caf = (company.enrichmentData as any)?.caf || {};
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({
    numeroCAF: caf.numeroCAF || "",
    grupo: caf.grupo || "",
    validade: caf.validade || "",
    areaHa: caf.areaHa || "",
    atividadesProdutivas: caf.atividadesProdutivas || "",
    rendaBrutaAnual: caf.rendaBrutaAnual || "",
  });

  useEffect(() => {
    const c = (company.enrichmentData as any)?.caf || {};
    setFormData({
      numeroCAF: c.numeroCAF || "",
      grupo: c.grupo || "",
      validade: c.validade || "",
      areaHa: c.areaHa || "",
      atividadesProdutivas: c.atividadesProdutivas || "",
      rendaBrutaAnual: c.rendaBrutaAnual || "",
    });
  }, [company]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        ...formData,
        areaHa: formData.areaHa ? Number(formData.areaHa) : null,
        rendaBrutaAnual: formData.rendaBrutaAnual ? Number(formData.rendaBrutaAnual) : null,
      };
      const res = await apiRequest("PATCH", `/api/norion/companies/${company.id}/caf`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      toast({ title: "CAF salvo", description: "Dados do CAF atualizados com sucesso." });
      setEditing(false);
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3" data-testid="caf-section">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Leaf className="w-4 h-4 text-green-600" />
          <span className="text-sm font-medium">CAF - Agricultura Familiar</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost" size="sm"
            onClick={() => window.open("https://caf.mda.gov.br/", "_blank")}
            data-testid="button-consultar-caf"
          >
            <ExternalLink className="w-3 h-3 mr-1" />
            Consultar CAF
          </Button>
          {!editing ? (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} data-testid="button-editar-caf">
              <Edit2 className="w-3 h-3 mr-1" />
              Editar
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-salvar-caf">
              <Save className="w-3 h-3 mr-1" />
              Salvar
            </Button>
          )}
        </div>
      </div>

      {!editing && !formData.numeroCAF ? (
        <p className="text-xs text-muted-foreground italic">Nenhum dado CAF registrado. Clique em "Editar" para adicionar.</p>
      ) : editing ? (
        <div className="space-y-3 bg-green-50/50 border border-green-100 rounded-md p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Número CAF/DAP</Label>
              <Input className="text-sm" value={formData.numeroCAF} onChange={(e) => setFormData(p => ({ ...p, numeroCAF: e.target.value }))} data-testid="input-caf-numero" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Grupo</Label>
              <Select value={formData.grupo} onValueChange={(v) => setFormData(p => ({ ...p, grupo: v }))}>
                <SelectTrigger data-testid="select-caf-grupo"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="A">Grupo A</SelectItem>
                  <SelectItem value="A/C">Grupo A/C</SelectItem>
                  <SelectItem value="B">Grupo B</SelectItem>
                  <SelectItem value="V">Grupo V (Renda Variável)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Validade</Label>
              <Input type="date" className="text-sm" value={formData.validade} onChange={(e) => setFormData(p => ({ ...p, validade: e.target.value }))} data-testid="input-caf-validade" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Área (ha)</Label>
              <Input type="number" className="text-sm" value={formData.areaHa} onChange={(e) => setFormData(p => ({ ...p, areaHa: e.target.value }))} data-testid="input-caf-area" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Atividades Produtivas</Label>
            <Textarea className="text-sm" rows={2} value={formData.atividadesProdutivas} onChange={(e) => setFormData(p => ({ ...p, atividadesProdutivas: e.target.value }))} data-testid="input-caf-atividades" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Renda Bruta Anual (R$)</Label>
            <Input type="number" className="text-sm" value={formData.rendaBrutaAnual} onChange={(e) => setFormData(p => ({ ...p, rendaBrutaAnual: e.target.value }))} data-testid="input-caf-renda" />
          </div>
        </div>
      ) : (
        <div className="bg-green-50/50 border border-green-100 rounded-md p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><p className="text-xs text-muted-foreground">Nº CAF/DAP</p><p className="font-medium" data-testid="text-caf-numero">{formData.numeroCAF}</p></div>
            <div><p className="text-xs text-muted-foreground">Grupo</p><p className="font-medium" data-testid="text-caf-grupo">{formData.grupo || "\u2014"}</p></div>
            <div><p className="text-xs text-muted-foreground">Validade</p><p className="font-medium" data-testid="text-caf-validade">{formData.validade ? new Date(formData.validade).toLocaleDateString("pt-BR") : "\u2014"}</p></div>
            <div><p className="text-xs text-muted-foreground">Área</p><p className="font-medium">{formData.areaHa ? `${formData.areaHa} ha` : "\u2014"}</p></div>
          </div>
          {formData.atividadesProdutivas && (
            <div><p className="text-xs text-muted-foreground">Atividades</p><p className="text-sm">{formData.atividadesProdutivas}</p></div>
          )}
          {formData.rendaBrutaAnual && (
            <div><p className="text-xs text-muted-foreground">Renda Bruta Anual</p><p className="text-sm font-medium">{formatBRL(Number(formData.rendaBrutaAnual))}</p></div>
          )}
        </div>
      )}
    </div>
  );
}

function SociosSection({ company }: { company: any }) {
  const { toast } = useToast();
  const enrichment = company.enrichmentData as any;
  const cnpjaData = enrichment || {};
  const socios = cnpjaData.socios || [];
  const sociosContato = enrichment?.sociosContato || {};

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState({ cpf: "", telefone: "", email: "" });

  function socioKey(s: any, idx: number) {
    return s.name ? s.name.trim().toLowerCase().replace(/\s+/g, "_") : `socio_${idx}`;
  }

  const saveMutation = useMutation({
    mutationFn: async (data: { sociosContato: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/norion/companies/${company.id}/socios-contato`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      toast({ title: "Contato salvo" });
      setEditingKey(null);
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  function startEdit(key: string) {
    const existing = sociosContato[key] || {};
    setContactForm({ cpf: existing.cpf || "", telefone: existing.telefone || "", email: existing.email || "" });
    setEditingKey(key);
  }

  function saveContact(key: string) {
    const updated = { ...sociosContato, [key]: { ...contactForm, verificado: true, verificadoEm: new Date().toISOString() } };
    saveMutation.mutate({ sociosContato: updated });
  }

  if (socios.length === 0) return null;

  return (
    <div className="space-y-3" data-testid="socios-section">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-blue-600" />
        <span className="text-sm font-medium">Quadro Societário (QSA)</span>
        <Badge variant="outline" className="text-xs">{socios.length}</Badge>
      </div>

      <div className="space-y-2">
        {socios.map((s: any, idx: number) => {
          const key = socioKey(s, idx);
          const contato = sociosContato[key];
          const isEditing = editingKey === key;

          return (
            <div key={key} className="border rounded-md p-3 space-y-2" data-testid={`socio-card-${idx}`}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{s.name || "\u2014"}</p>
                  <p className="text-xs text-muted-foreground">{s.role || "Sócio"}{s.since ? ` \u00b7 desde ${s.since}` : ""}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {contato?.verificado ? (
                    <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-300">
                      <Check className="w-3 h-3 mr-0.5" /> Verificado
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs bg-slate-50 text-slate-400">Pendente</Badge>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => isEditing ? setEditingKey(null) : startEdit(key)} data-testid={`button-edit-socio-${idx}`}>
                    <Edit2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              {contato && !isEditing && (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {contato.cpf && <div><span className="text-muted-foreground">CPF:</span> <span data-testid={`text-socio-cpf-${idx}`}>{contato.cpf}</span></div>}
                  {contato.telefone && <div><span className="text-muted-foreground">Tel:</span> <span data-testid={`text-socio-tel-${idx}`}>{contato.telefone}</span></div>}
                  {contato.email && <div><span className="text-muted-foreground">Email:</span> <span data-testid={`text-socio-email-${idx}`}>{contato.email}</span></div>}
                </div>
              )}

              {isEditing && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">CPF</Label>
                    <Input className="text-xs" placeholder="000.000.000-00" value={contactForm.cpf} onChange={(e) => setContactForm(p => ({ ...p, cpf: e.target.value }))} data-testid={`input-socio-cpf-${idx}`} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Telefone</Label>
                    <Input className="text-xs" placeholder="(00) 00000-0000" value={contactForm.telefone} onChange={(e) => setContactForm(p => ({ ...p, telefone: e.target.value }))} data-testid={`input-socio-tel-${idx}`} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Email</Label>
                    <Input className="text-xs" type="email" placeholder="email@..." value={contactForm.email} onChange={(e) => setContactForm(p => ({ ...p, email: e.target.value }))} data-testid={`input-socio-email-${idx}`} />
                  </div>
                  <div className="col-span-3 flex justify-end">
                    <Button size="sm" onClick={() => saveContact(key)} disabled={saveMutation.isPending} data-testid={`button-save-socio-${idx}`}>
                      <Save className="w-3 h-3 mr-1" /> Salvar Contato
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SicorSection({ company }: { company: any }) {
  const addr = company.address as any;
  const municipio = addr?.municipality;
  const { data: sicorData, isLoading } = useQuery<any>({
    queryKey: ["/api/norion/sicor", municipio],
    queryFn: async () => {
      const res = await fetch(`/api/norion/sicor/${municipio}`, { credentials: "include" });
      if (!res.ok) throw new Error("Erro ao consultar SICOR");
      return res.json();
    },
    enabled: !!municipio,
  });

  if (!municipio) return null;

  return (
    <div className="space-y-3" data-testid="sicor-section">
      <div className="flex items-center gap-2">
        <Tractor className="w-4 h-4 text-amber-600" />
        <span className="text-sm font-medium">Crédito Rural na Região</span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
      ) : sicorData ? (
        <div className="bg-amber-50/50 border border-amber-100 rounded-md p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="text-center p-2 bg-white rounded-md border">
              <p className="text-lg font-bold text-amber-700" data-testid="text-sicor-contratos">{(sicorData.totalContratos || 0).toLocaleString("pt-BR")}</p>
              <p className="text-xs text-muted-foreground">Contratos PRONAF</p>
            </div>
            <div className="text-center p-2 bg-white rounded-md border">
              <p className="text-lg font-bold text-amber-700" data-testid="text-sicor-valor">{formatBRL(sicorData.totalValor)}</p>
              <p className="text-xs text-muted-foreground">Volume Total</p>
            </div>
          </div>

          {sicorData.topProdutos && sicorData.topProdutos.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Principais Produtos Financiados</p>
              <div className="space-y-1">
                {sicorData.topProdutos.map((p: any, i: number) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate flex-1">{p.produto}</span>
                    <span className="text-muted-foreground ml-2">{p.contratos} contratos</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sicorData.totalContratos > 100 ? (
            <Badge className="bg-green-100 text-green-700 border-green-300 text-xs">Alta atividade PRONAF</Badge>
          ) : sicorData.totalContratos > 10 ? (
            <Badge className="bg-amber-100 text-amber-700 border-amber-300 text-xs">Atividade PRONAF moderada</Badge>
          ) : (
            <Badge className="bg-slate-100 text-slate-500 border-slate-300 text-xs">Baixa atividade PRONAF</Badge>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">Dados SICOR indisponíveis para este município.</p>
      )}
    </div>
  );
}

export default function EmpresaDetalhePage({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { data: companies = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/crm/companies"] });

  const company = companies.find((c: any) => String(c.id) === String(id));

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="p-6 max-w-[800px] mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/empresas")} data-testid="button-voltar-empresas">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-bold">Empresa não encontrada</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[800px] mx-auto space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => navigate("/empresas")} data-testid="button-voltar-empresas">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <Building2 className="w-7 h-7 text-amber-500" />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold" data-testid="text-empresa-detalhe-title">
            {company.legalName || company.tradeName || "Empresa"}
          </h1>
          <p className="text-sm text-muted-foreground">Perfil completo da empresa</p>
        </div>
      </div>

      <Card className="p-6 space-y-4">
        {company.tradeName && (
          <div>
            <p className="text-xs text-muted-foreground">Nome Fantasia</p>
            <p className="text-sm font-medium" data-testid="text-detalhe-trade-name">{company.tradeName}</p>
          </div>
        )}

        {company.cnpj && (
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">CNPJ</p>
              <p className="text-sm" data-testid="text-detalhe-cnpj">{formatCnpj(company.cnpj)}</p>
            </div>
          </div>
        )}

        {company.cnaePrincipal && (
          <div>
            <p className="text-xs text-muted-foreground">CNAE Principal</p>
            <p className="text-sm" data-testid="text-detalhe-cnae">{company.cnaePrincipal}</p>
          </div>
        )}

        {company.porte && (
          <div>
            <p className="text-xs text-muted-foreground">Porte</p>
            <p className="text-sm" data-testid="text-detalhe-porte">{company.porte}</p>
          </div>
        )}

        <div>
          <p className="text-xs text-muted-foreground">Perfil Norion</p>
          <div className="mt-1"><ProfileBadge profile={company.norionProfile} /></div>
        </div>

        {company.emails && (company.emails as any[]).length > 0 && (
          <div className="flex items-start gap-2">
            <Mail className="w-4 h-4 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-xs text-muted-foreground">Email(s)</p>
              {(company.emails as string[]).map((e, i) => (
                <p key={i} className="text-sm" data-testid={`text-detalhe-email-${i}`}>{e}</p>
              ))}
            </div>
          </div>
        )}

        {company.phones && (company.phones as any[]).length > 0 && (
          <div className="flex items-start gap-2">
            <Phone className="w-4 h-4 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-xs text-muted-foreground">Telefone(s)</p>
              {(company.phones as string[]).map((p, i) => (
                <p key={i} className="text-sm" data-testid={`text-detalhe-phone-${i}`}>{typeof p === "object" ? (p as any).number || JSON.stringify(p) : p}</p>
              ))}
            </div>
          </div>
        )}

        {company.website && (
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Website</p>
              <p className="text-sm" data-testid="text-detalhe-website">{company.website}</p>
            </div>
          </div>
        )}

        {company.address && typeof company.address === "object" && Object.keys(company.address).length > 0 && (
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-xs text-muted-foreground">Endereço</p>
              <p className="text-sm" data-testid="text-detalhe-address">
                {[
                  (company.address as any).street,
                  (company.address as any).number,
                  (company.address as any).district,
                  (company.address as any).city,
                  (company.address as any).state,
                ].filter(Boolean).join(", ") || JSON.stringify(company.address)}
              </p>
            </div>
          </div>
        )}

        {company.notes && (
          <div>
            <p className="text-xs text-muted-foreground">Notas</p>
            <p className="text-sm" data-testid="text-detalhe-notes">{company.notes}</p>
          </div>
        )}

        <Separator />

        <SociosSection company={company} />

        <Separator />

        <CafSection company={company} />

        <Separator />

        <SicorSection company={company} />

        <Separator />

        <Button
          className="w-full"
          onClick={() => navigate("/operacoes")}
          data-testid="button-nova-operacao"
        >
          <CreditCard className="w-4 h-4 mr-1.5" />
          Nova Operação de Crédito
        </Button>
      </Card>
    </div>
  );
}
