import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Search,
  X,
  Loader2,
} from "lucide-react";
import { CnaePicker } from "./cnae-tree";

export interface Filters {
  names: string;
  states: string[];
  cities: string[];
  cnaeIds: number[];
  cnaeSideIds: number[];
  sizes: number[];
  statuses: number[];
  natures: number[];
  simples: "" | "true" | "false";
  ddds: string[];
  ceps: string[];
  bairros: string[];
  ageMin: string;
  ageMax: string;
  socioName: string;
}

export const INITIAL_FILTERS: Filters = {
  names: "",
  states: [],
  cities: [],
  cnaeIds: [],
  cnaeSideIds: [],
  sizes: [],
  statuses: [2],
  natures: [],
  simples: "",
  ddds: [],
  ceps: [],
  bairros: [],
  ageMin: "",
  ageMax: "",
  socioName: "",
};

const ESTADOS = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
  "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

const PORTES = [
  { id: 1, label: "ME – Microempresa" },
  { id: 3, label: "EPP – Pequeno Porte" },
  { id: 5, label: "Demais" },
];

const STATUS_OPTIONS = [
  { id: 2, label: "Ativa" },
  { id: 3, label: "Suspensa" },
  { id: 4, label: "Inapta" },
  { id: 8, label: "Baixada" },
];

const NATUREZA_OPTIONS = [
  { id: 2062, label: "Soc. Empresária Limitada (LTDA)" },
  { id: 2035, label: "Soc. Anônima Fechada (S.A.)" },
  { id: 2038, label: "Soc. Anônima Aberta (S.A.)" },
  { id: 2135, label: "EIRELI" },
  { id: 2143, label: "Cooperativa" },
  { id: 2011, label: "Empresário Individual (MEI)" },
  { id: 4120, label: "Produtor Rural (CPF)" },
  { id: 6010, label: "Fundação Privada" },
];

function ToggleGroup({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`text-xs px-2.5 py-1 rounded border transition-colors ${
            value === opt.value
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border hover:border-primary/50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function getActiveFilterCount(filters: Filters): number {
  return [
    filters.names,
    filters.states.length > 0,
    filters.cities.length > 0,
    filters.cnaeIds.length > 0,
    filters.cnaeSideIds.length > 0,
    filters.sizes.length > 0,
    filters.statuses.length > 0 && !(filters.statuses.length === 1 && filters.statuses[0] === 2),
    filters.natures.length > 0,
    filters.simples,
    filters.ddds.length > 0,
    filters.ceps.length > 0,
    filters.bairros.length > 0,
    filters.ageMin,
    filters.ageMax,
    filters.socioName,
  ].filter(Boolean).length;
}

interface SearchFiltersProps {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  searchLoading: boolean;
  activeFilterCount: number;
  onSearch: () => void;
  onClear: () => void;
}

export default function SearchFilters({
  filters,
  setFilters,
  searchLoading,
  activeFilterCount,
  onSearch,
  onClear,
}: SearchFiltersProps) {
  const [dddInput, setDddInput] = useState("");
  const [cityInput, setCityInput] = useState("");
  const [cepInput, setCepInput] = useState("");
  const [bairroInput, setBairroInput] = useState("");

  const toggleState = (s: string) =>
    setFilters(f => ({ ...f, states: f.states.includes(s) ? f.states.filter(x => x !== s) : [...f.states, s] }));

  const addCity = () => {
    const city = cityInput.trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (city && !filters.cities.includes(city)) {
      setFilters(f => ({ ...f, cities: [...f.cities, city] }));
    }
    setCityInput("");
  };

  const toggleSize = (id: number) =>
    setFilters(f => ({ ...f, sizes: f.sizes.includes(id) ? f.sizes.filter(x => x !== id) : [...f.sizes, id] }));

  const toggleStatus = (id: number) =>
    setFilters(f => ({ ...f, statuses: f.statuses.includes(id) ? f.statuses.filter(x => x !== id) : [...f.statuses, id] }));

  const toggleNature = (id: number) =>
    setFilters(f => ({ ...f, natures: f.natures.includes(id) ? f.natures.filter(x => x !== id) : [...f.natures, id] }));

  const addDdd = () => {
    const ddd = dddInput.trim().replace(/\D/g, "");
    if (ddd.length === 2 && !filters.ddds.includes(ddd)) {
      setFilters(f => ({ ...f, ddds: [...f.ddds, ddd] }));
    }
    setDddInput("");
  };

  const addCep = () => {
    const cep = cepInput.trim().replace(/\D/g, "");
    if (cep.length === 8 && !filters.ceps.includes(cep)) {
      setFilters(f => ({ ...f, ceps: [...f.ceps, cep] }));
    }
    setCepInput("");
  };

  const addBairro = () => {
    const bairro = bairroInput.trim().toUpperCase();
    if (bairro && !filters.bairros.includes(bairro)) {
      setFilters(f => ({ ...f, bairros: [...f.bairros, bairro] }));
    }
    setBairroInput("");
  };

  return (
    <Card className="lg:col-span-1">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            Filtros
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">{activeFilterCount} ativos</Badge>
            )}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClear} data-testid="button-limpar-filtros">
            <X className="w-4 h-4 mr-1" /> Limpar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 overflow-y-auto max-h-[calc(100vh-280px)]">

        <div className="space-y-1.5">
          <Label>Nome / Razão Social</Label>
          <Input
            placeholder="Ex: Construtora, Agro..."
            value={filters.names}
            onChange={e => setFilters(f => ({ ...f, names: e.target.value }))}
            data-testid="input-filtro-nome"
          />
        </div>

        <CnaePicker
          label="CNAE Principal"
          selected={filters.cnaeIds}
          onChange={ids => setFilters(f => ({ ...f, cnaeIds: ids }))}
        />

        <CnaePicker
          label="CNAE Secundário"
          selected={filters.cnaeSideIds}
          onChange={ids => setFilters(f => ({ ...f, cnaeSideIds: ids }))}
        />

        <div className="space-y-2">
          <Label>Estado (UF)</Label>
          <div className="flex flex-wrap gap-1.5">
            {ESTADOS.map(s => (
              <button
                key={s}
                onClick={() => toggleState(s)}
                data-testid={`toggle-estado-${s}`}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  filters.states.includes(s)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:border-primary/50"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Cidade / Município</Label>
          <div className="flex gap-1.5">
            <Input
              placeholder="Ex: SAO PAULO"
              value={cityInput}
              onChange={e => setCityInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addCity()}
              className="flex-1"
              data-testid="input-filtro-cidade"
            />
            <Button size="sm" variant="outline" onClick={addCity} data-testid="button-adicionar-cidade">Adicionar</Button>
          </div>
          {filters.cities.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {filters.cities.map(city => (
                <Badge key={city} variant="secondary" className="gap-1 cursor-pointer" onClick={() => setFilters(f => ({ ...f, cities: f.cities.filter(c => c !== city) }))} data-testid={`badge-cidade-${city}`}>
                  {city} <X className="w-3 h-3" />
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>DDD (área)</Label>
          <div className="flex gap-1.5">
            <Input
              placeholder="Ex: 11, 47..."
              value={dddInput}
              onChange={e => setDddInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addDdd()}
              maxLength={2}
              className="w-24"
              data-testid="input-filtro-ddd"
            />
            <Button size="sm" variant="outline" onClick={addDdd}>Adicionar</Button>
          </div>
          {filters.ddds.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {filters.ddds.map(ddd => (
                <Badge key={ddd} variant="secondary" className="gap-1 cursor-pointer" onClick={() => setFilters(f => ({ ...f, ddds: f.ddds.filter(d => d !== ddd) }))}>
                  {ddd} <X className="w-3 h-3" />
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>CEP</Label>
          <div className="flex gap-1.5">
            <Input
              placeholder="Ex: 01310100"
              value={cepInput}
              onChange={e => setCepInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addCep()}
              maxLength={9}
              className="w-32"
              data-testid="input-filtro-cep"
            />
            <Button size="sm" variant="outline" onClick={addCep} data-testid="button-adicionar-cep">Adicionar</Button>
          </div>
          <p className="text-xs text-muted-foreground">8 dígitos, sem hífen</p>
          {filters.ceps.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {filters.ceps.map(cep => (
                <Badge key={cep} variant="secondary" className="gap-1 cursor-pointer" onClick={() => setFilters(f => ({ ...f, ceps: f.ceps.filter(c => c !== cep) }))} data-testid={`badge-cep-${cep}`}>
                  {cep.replace(/(\d{5})(\d{3})/, "$1-$2")} <X className="w-3 h-3" />
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Bairro</Label>
          <div className="flex gap-1.5">
            <Input
              placeholder="Ex: CENTRO, JARDINS"
              value={bairroInput}
              onChange={e => setBairroInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addBairro()}
              className="flex-1"
              data-testid="input-filtro-bairro"
            />
            <Button size="sm" variant="outline" onClick={addBairro} data-testid="button-adicionar-bairro">Adicionar</Button>
          </div>
          {filters.bairros.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {filters.bairros.map(bairro => (
                <Badge key={bairro} variant="secondary" className="gap-1 cursor-pointer" onClick={() => setFilters(f => ({ ...f, bairros: f.bairros.filter(b => b !== bairro) }))} data-testid={`badge-bairro-${bairro}`}>
                  {bairro} <X className="w-3 h-3" />
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Sócio / Administrador</Label>
          <Input
            placeholder="Nome do sócio ou administrador"
            value={filters.socioName}
            onChange={e => setFilters(f => ({ ...f, socioName: e.target.value }))}
            data-testid="input-filtro-socio"
          />
          <p className="text-xs text-muted-foreground">Busca empresas onde essa pessoa é sócia</p>
        </div>

        <div className="space-y-1.5">
          <Label>Idade da Empresa (anos)</Label>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Mínimo</p>
              <Input
                type="number"
                placeholder="0"
                value={filters.ageMin}
                onChange={e => setFilters(f => ({ ...f, ageMin: e.target.value }))}
                data-testid="input-age-min"
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Máximo</p>
              <Input
                type="number"
                placeholder="∞"
                value={filters.ageMax}
                onChange={e => setFilters(f => ({ ...f, ageMax: e.target.value }))}
                data-testid="input-age-max"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Porte</Label>
          {PORTES.map(p => (
            <div key={p.id} className="flex items-center gap-2">
              <Checkbox
                id={`porte-${p.id}`}
                checked={filters.sizes.includes(p.id)}
                onCheckedChange={() => toggleSize(p.id)}
                data-testid={`checkbox-porte-${p.id}`}
              />
              <Label htmlFor={`porte-${p.id}`} className="font-normal text-sm cursor-pointer">{p.label}</Label>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Label>Natureza Jurídica</Label>
          <p className="text-xs text-muted-foreground -mt-1">Inclui "Produtor Rural" para agrônomos/produtores com CPF</p>
          {NATUREZA_OPTIONS.map(n => (
            <div key={n.id} className="flex items-center gap-2">
              <Checkbox
                id={`nature-${n.id}`}
                checked={filters.natures.includes(n.id)}
                onCheckedChange={() => toggleNature(n.id)}
                data-testid={`checkbox-nature-${n.id}`}
              />
              <Label htmlFor={`nature-${n.id}`} className="font-normal text-sm cursor-pointer">{n.label}</Label>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Label>Situação Cadastral</Label>
          {STATUS_OPTIONS.map(s => (
            <div key={s.id} className="flex items-center gap-2">
              <Checkbox
                id={`status-${s.id}`}
                checked={filters.statuses.includes(s.id)}
                onCheckedChange={() => toggleStatus(s.id)}
                data-testid={`checkbox-status-${s.id}`}
              />
              <Label htmlFor={`status-${s.id}`} className="font-normal text-sm cursor-pointer">{s.label}</Label>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Label>Simples Nacional</Label>
          <ToggleGroup
            value={filters.simples}
            onChange={v => setFilters(f => ({ ...f, simples: v as Filters["simples"] }))}
            options={[{ value: "", label: "Todos" }, { value: "true", label: "Optante" }, { value: "false", label: "Não optante" }]}
          />
        </div>


        <Button
          className="w-full"
          onClick={onSearch}
          disabled={searchLoading}
          data-testid="button-buscar-avancado"
        >
          {searchLoading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Search className="w-4 h-4 mr-2" />
          )}
          Buscar Empresas
        </Button>
      </CardContent>
    </Card>
  );
}
