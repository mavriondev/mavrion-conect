import { useState } from "react";
import { useConnectors, useCreateConnector, useRunConnector } from "@/hooks/use-connectors";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Play, Plus, Server, Database, Activity, Search, X, Globe, FileCode, ChevronDown, HelpCircle, Zap, Trash2, RefreshCw, HardDrive } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const TEMPLATES = [
  {
    name: "API ReceitaWS",
    type: "API",
    description: "Consulta de CNPJ via ReceitaWS. Retorna dados cadastrais, situação e endereço.",
    configJson: { baseUrl: "https://receitaws.com.br/v1" },
    schedule: "0 6 * * *",
    icon: Globe,
  },
  {
    name: "IBGE Municipios",
    type: "DATABASE",
    description: "Dados municipais do IBGE via API REST. Inclui municípios, estados e distritos.",
    configJson: { dbType: "rest_api", endpoint: "https://servicodados.ibge.gov.br/api/v3", resources: ["municipios", "estados", "distritos"], syncMode: "incremental", format: "json" },
    schedule: "0 0 1 * *",
    icon: Database,
  },
  {
    name: "Scraper Portal ANM",
    type: "SCRAPER",
    description: "Extrai processos minerários do portal GEO ANM. Coleta titular, substância e fase.",
    configJson: { targetUrl: "https://geo.anm.gov.br", selectors: { processos: ".processo-item", titular: ".titular-nome", substancia: ".substancia", fase: ".fase-atual" }, retryAttempts: 3, timeout: 30000, rateLimit: "2req/s" },
    schedule: "0 8 * * 1",
    icon: Server,
  },
  {
    name: "Scraper SICAR Rural",
    type: "SCRAPER",
    description: "Extrai dados do Cadastro Ambiental Rural (CAR) via portal SICAR. Informações de propriedades rurais.",
    configJson: { targetUrl: "https://www.car.gov.br/publico/imoveis/index", selectors: { imovel: ".imovel-item", proprietario: ".proprietario-nome", area: ".area-total", status: ".status-car" }, retryAttempts: 3, timeout: 45000, rateLimit: "1req/s" },
    schedule: "0 6 * * 3",
    icon: FileCode,
  },
];

function cronToPortugues(cron: string): string {
  const PRESETS: Record<string, string> = {
    "0 */6 * * *": "A cada 6 horas",
    "0 */4 * * *": "A cada 4 horas",
    "0 */12 * * *": "A cada 12 horas",
    "0 8 * * 1-5": "Toda manhã às 8h (dias úteis)",
    "0 0 * * *": "Todo dia à meia-noite",
    "0 6 * * *": "Todo dia às 6h",
    "0 0 1 * *": "1º dia de cada mês",
    "0 8 * * 1": "Toda segunda às 8h",
    "0 6 * * 3": "Toda quarta às 6h",
  };
  if (PRESETS[cron]) return PRESETS[cron];
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return "Expressão inválida";
  return `Min: ${parts[0]} | Hora: ${parts[1]} | Dia: ${parts[2]} | Mês: ${parts[3]} | Sem: ${parts[4]}`;
}

const CACHE_NAMESPACES = [
  { key: "anm", label: "ANM (Mineração)", ttl: "6 horas" },
  { key: "sicar", label: "SICAR (Rural)", ttl: "12 horas" },
  { key: "cnpja", label: "CNPJA (Receita)", ttl: "24 horas" },
  { key: "geo", label: "Geo (IBGE/Elevação)", ttl: "24 horas" },
];

function CacheCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [flushing, setFlushing] = useState<string | null>(null);

  const { data: cacheStats, isLoading: statsLoading } = useQuery<{
    total: number;
    namespaces: Record<string, { count: number; expired: number }>;
  }>({
    queryKey: ["/api/cache/stats"],
  });

  const flushCache = async (ns: string) => {
    setFlushing(ns);
    try {
      await apiRequest("DELETE", `/api/cache/flush/${ns}`);
      queryClient.invalidateQueries({ queryKey: ["/api/cache/stats"] });
      toast({ title: `Cache ${ns === "all" ? "completo" : ns} limpo com sucesso` });
    } catch {
      toast({ title: "Erro ao limpar cache", variant: "destructive" });
    } finally {
      setFlushing(null);
    }
  };

  const total = cacheStats?.total || 0;
  const namespaces = cacheStats?.namespaces || {};

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">Cache do Sistema</CardTitle>
          </div>
          <Badge variant="secondary" className="font-mono" data-testid="badge-cache-total">
            {total} entradas
          </Badge>
        </div>
        <CardDescription>
          Cache em banco de dados para APIs externas. Reduz chamadas e melhora a velocidade.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {CACHE_NAMESPACES.map(ns => {
          const stats = namespaces[ns.key];
          const count = stats?.count || 0;
          const expired = stats?.expired || 0;
          return (
            <div key={ns.key} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{ns.label}</span>
                  <Badge variant="outline" className="text-[10px] font-mono px-1.5">TTL: {ns.ttl}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {count} registros{expired > 0 ? ` (${expired} expirados)` : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => flushCache(ns.key)}
                disabled={flushing !== null || count === 0}
                data-testid={`button-flush-cache-${ns.key}`}
              >
                {flushing === ns.key ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              </Button>
            </div>
          );
        })}
        <Button
          variant="outline"
          size="sm"
          className="w-full mt-2"
          onClick={() => flushCache("all")}
          disabled={flushing !== null || total === 0}
          data-testid="button-flush-cache-all"
        >
          <Trash2 className="w-3.5 h-3.5 mr-2" />
          Limpar Todo Cache ({total})
        </Button>
      </CardContent>
    </Card>
  );
}

export default function ConnectorsPage() {
  const { data: connectors, isLoading } = useConnectors();
  const { mutate: createConnector } = useCreateConnector();
  const { mutate: runConnector } = useRunConnector();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [connectorSearch, setConnectorSearch] = useState("");
  const [connectorType, setConnectorType] = useState("all");
  const [connectorStatus, setConnectorStatus] = useState("all");
  const [helpOpen, setHelpOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    type: "API",
    configJson: "{}",
    schedule: "0 0 * * *"
  });

  const handleUseTemplate = (template: typeof TEMPLATES[0]) => {
    setFormData({
      name: template.name,
      type: template.type,
      configJson: JSON.stringify(template.configJson, null, 2),
      schedule: template.schedule,
    });
    setIsCreateOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const config = JSON.parse(formData.configJson);
      createConnector({
        name: formData.name,
        type: formData.type,
        configJson: config,
        schedule: formData.schedule,
        status: "active"
      });
      setIsCreateOpen(false);
      setFormData({ name: "", type: "API", configJson: "{}", schedule: "0 0 * * *" });
    } catch {
      alert("Configuração JSON inválida");
    }
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case "SCRAPER": return <Server className="w-5 h-5 text-primary" />;
      case "DATABASE": return <Database className="w-5 h-5 text-primary" />;
      default: return <Globe className="w-5 h-5 text-primary" />;
    }
  };

  const filteredConnectors = connectors?.filter(c => {
    if (connectorSearch.trim() && !c.name.toLowerCase().includes(connectorSearch.toLowerCase())) return false;
    if (connectorType !== "all" && c.type !== connectorType) return false;
    if (connectorStatus !== "all" && c.status !== connectorStatus) return false;
    return true;
  });

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold" data-testid="text-connectors-title">Conectores de Dados</h1>
          <p className="text-muted-foreground mt-1 text-sm" data-testid="text-connectors-subtitle">Gerencie integrações via API, scrapers e importações de banco de dados.</p>
        </div>

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="shadow-lg shadow-primary/20" data-testid="button-add-connector">
              <Plus className="w-4 h-4 mr-2" />
              Novo Conector
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[540px]">
            <DialogHeader>
              <DialogTitle>Criar Novo Conector</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nome do Conector</Label>
                <Input
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  placeholder="Ex: API Receita Federal"
                  required
                  data-testid="input-connector-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={formData.type}
                  onValueChange={val => setFormData({...formData, type: val})}
                >
                  <SelectTrigger data-testid="select-connector-create-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="API">REST API</SelectItem>
                    <SelectItem value="SCRAPER">Web Scraper</SelectItem>
                    <SelectItem value="DATABASE">Importação de Banco</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Configuração (JSON)</Label>
                <Textarea
                  value={formData.configJson}
                  onChange={e => setFormData({...formData, configJson: e.target.value})}
                  className="font-mono text-xs h-36 bg-gray-900 text-green-400 dark:bg-gray-950 dark:text-green-400 rounded-md"
                  data-testid="textarea-connector-config"
                />
              </div>
              <div className="space-y-2">
                <Label>
                  Agendamento CRON
                  <span className="text-muted-foreground text-xs ml-2 font-normal">Define quando o conector roda automaticamente</span>
                </Label>
                <Input
                  value={formData.schedule}
                  onChange={e => setFormData({...formData, schedule: e.target.value})}
                  placeholder="0 0 * * *"
                  className="font-mono"
                  data-testid="input-connector-schedule"
                />
                {formData.schedule && (
                  <p className="text-xs text-muted-foreground" data-testid="text-cron-preview">
                    {cronToPortugues(formData.schedule)}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: "6 em 6h", value: "0 */6 * * *" },
                    { label: "Diário 8h", value: "0 8 * * 1-5" },
                    { label: "Meia-noite", value: "0 0 * * *" },
                    { label: "Mensal", value: "0 0 1 * *" },
                  ].map(p => (
                    <Button
                      key={p.value}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-5 text-[10px] px-2 rounded-full"
                      onClick={() => setFormData({ ...formData, schedule: p.value })}
                      data-testid={`button-preset-${p.label.replace(/\s+/g, "-").toLowerCase()}`}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>
              <Button type="submit" className="w-full" data-testid="button-create-connector">Criar Conector</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Collapsible open={helpOpen} onOpenChange={setHelpOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" data-testid="button-help-connectors">
            <HelpCircle className="w-4 h-4" />
            O que são Connectors?
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${helpOpen ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Card className="mt-2">
            <CardContent className="pt-4 text-sm text-muted-foreground space-y-2">
              <p>
                <strong className="text-foreground">Connectors</strong> são integrações automatizadas que coletam dados de fontes externas para enriquecer sua base de informações.
              </p>
              <p>
                Existem três tipos principais: <strong className="text-foreground">REST API</strong> (consulta de APIs públicas ou privadas), <strong className="text-foreground">Web Scraper</strong> (extração de dados de páginas web) e <strong className="text-foreground">Importação de Banco</strong> (sincronização com bases de dados externas).
              </p>
              <p>
                Cada conector pode ser agendado via expressão CRON ou executado manualmente a qualquer momento.
              </p>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2" data-testid="text-templates-title">
          <Zap className="w-4 h-4 text-primary" />
          Templates Pré-configurados
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {TEMPLATES.map((template) => {
            const Icon = template.icon;
            return (
              <Card key={template.name} className="hover-elevate" data-testid={`card-template-${template.name.replace(/\s+/g, "-").toLowerCase()}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="p-1.5 bg-muted rounded-md">
                      <Icon className="w-4 h-4 text-primary" />
                    </div>
                    <Badge variant="secondary" className="text-xs">{template.type}</Badge>
                  </div>
                  <CardTitle className="text-sm">{template.name}</CardTitle>
                  <CardDescription className="text-xs line-clamp-2">{template.description}</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => handleUseTemplate(template)}
                    data-testid={`button-use-template-${template.name.replace(/\s+/g, "-").toLowerCase()}`}
                  >
                    Usar Template
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3" data-testid="text-active-connectors-title">Conectores Ativos</h2>
        <div className="flex flex-wrap gap-2 mb-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar conector..."
              value={connectorSearch}
              onChange={e => setConnectorSearch(e.target.value)}
              className="pl-8 text-sm w-44"
              data-testid="input-connector-search"
            />
          </div>
          <Select value={connectorType} onValueChange={setConnectorType}>
            <SelectTrigger className="text-sm w-36" data-testid="select-connector-type">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              <SelectItem value="API">REST API</SelectItem>
              <SelectItem value="SCRAPER">Scraper</SelectItem>
              <SelectItem value="DATABASE">Banco de Dados</SelectItem>
            </SelectContent>
          </Select>
          <Select value={connectorStatus} onValueChange={setConnectorStatus}>
            <SelectTrigger className="text-sm w-36" data-testid="select-connector-status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="active">Ativo</SelectItem>
              <SelectItem value="inactive">Inativo</SelectItem>
            </SelectContent>
          </Select>
          {(connectorSearch || connectorType !== "all" || connectorStatus !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setConnectorSearch(""); setConnectorType("all"); setConnectorStatus("all"); }}
              className="text-xs text-muted-foreground"
              data-testid="button-clear-connector-filters"
            >
              <X className="w-3.5 h-3.5 mr-1" /> Limpar filtros
            </Button>
          )}
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {isLoading ? (
            <div className="text-muted-foreground text-sm" data-testid="text-loading">Carregando conectores...</div>
          ) : filteredConnectors?.length === 0 ? (
            <div className="text-muted-foreground text-sm col-span-full" data-testid="text-no-connectors">Nenhum conector encontrado.</div>
          ) : filteredConnectors?.map((connector) => (
            <Card key={connector.id} className="border-border/50 shadow-sm hover-elevate" data-testid={`card-connector-${connector.id}`}>
              <CardHeader>
                <div className="flex justify-between items-start gap-2">
                  <div className="p-2 bg-muted rounded-md">
                    {typeIcon(connector.type)}
                  </div>
                  <Badge variant={connector.status === 'active' ? 'default' : 'secondary'} className="capitalize">
                    {connector.status === 'active' ? 'Ativo' : 'Inativo'}
                  </Badge>
                </div>
                <CardTitle className="mt-4" data-testid={`text-connector-name-${connector.id}`}>{connector.name}</CardTitle>
                <CardDescription className="font-mono text-xs text-muted-foreground">
                  {connector.schedule || 'Somente execução manual'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <Activity className="w-3 h-3" />
                    Última execução: {connector.lastRunAt ? new Date(connector.lastRunAt).toLocaleString('pt-BR') : 'Nunca'}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => runConnector(connector.id)}
                    data-testid={`button-run-connector-${connector.id}`}
                  >
                    <Play className="w-3 h-3 mr-2" />
                    Executar Agora
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <CacheCard />
    </div>
  );
}
