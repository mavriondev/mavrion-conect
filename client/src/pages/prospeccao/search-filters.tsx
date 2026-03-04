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
  Phone,
  Mail,
  Loader2,
} from "lucide-react";
import { CnaePicker } from "./cnae-tree";

export interface Filters {
  names: string;
  states: string[];
  cnaeIds: number[];
  cnaeSideIds: number[];
  sizes: number[];
  statuses: number[];
  natures: number[];
  simples: "" | "true" | "false";
  mei: "" | "true" | "false";
  head: "" | "true" | "false";
  hasPhone: boolean;
  hasEmail: boolean;
  foundedFrom: string;
  foundedTo: string;
  equityMin: string;
  equityMax: string;
  ddds: string[];
}

export const INITIAL_FILTERS: Filters = {
  names: "",
  states: [],
  cnaeIds: [],
  cnaeSideIds: [],
  sizes: [],
  statuses: [2],
  natures: [],
  simples: "",
  mei: "",
  head: "",
  hasPhone: false,
  hasEmail: false,
  foundedFrom: "",
  foundedTo: "",
  equityMin: "",
  equityMax: "",
  ddds: [],
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
    filters.cnaeIds.length > 0,
    filters.cnaeSideIds.length > 0,
    filters.sizes.length > 0,
    filters.statuses.length > 0 && !(filters.statuses.length === 1 && filters.statuses[0] === 2),
    filters.natures.length > 0,
    filters.simples,
    filters.mei,
    filters.head,
    filters.hasPhone,
    filters.hasEmail,
    filters.foundedFrom,
    filters.foundedTo,
    filters.equityMin,
    filters.equityMax,
    filters.ddds.length > 0,
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

  const toggleState = (s: string) =>
    setFilters(f => ({ ...f, states: f.states.includes(s) ? f.states.filter(x => x !== s) : [...f.states, s] }));

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

        <div className="space-y-2">
          <Label>MEI</Label>
          <ToggleGroup
            value={filters.mei}
            onChange={v => setFilters(f => ({ ...f, mei: v as Filters["mei"] }))}
            options={[{ value: "", label: "Todos" }, { value: "true", label: "MEI" }, { value: "false", label: "Não MEI" }]}
          />
        </div>

        <div className="space-y-2">
          <Label>Tipo de Estabelecimento</Label>
          <ToggleGroup
            value={filters.head}
            onChange={v => setFilters(f => ({ ...f, head: v as Filters["head"] }))}
            options={[{ value: "", label: "Todos" }, { value: "true", label: "Matriz" }, { value: "false", label: "Filial" }]}
          />
        </div>

        <div className="space-y-2">
          <Label>Contactabilidade</Label>
          <div className="flex items-center gap-2">
            <Checkbox
              id="has-phone"
              checked={filters.hasPhone}
              onCheckedChange={v => setFilters(f => ({ ...f, hasPhone: Boolean(v) }))}
              data-testid="checkbox-has-phone"
            />
            <Label htmlFor="has-phone" className="font-normal text-sm cursor-pointer flex items-center gap-1">
              <Phone className="w-3.5 h-3.5" /> Tem telefone cadastrado
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="has-email"
              checked={filters.hasEmail}
              onCheckedChange={v => setFilters(f => ({ ...f, hasEmail: Boolean(v) }))}
              data-testid="checkbox-has-email"
            />
            <Label htmlFor="has-email" className="font-normal text-sm cursor-pointer flex items-center gap-1">
              <Mail className="w-3.5 h-3.5" /> Tem e-mail cadastrado
            </Label>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Data de Abertura</Label>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">De</p>
              <Input
                type="date"
                value={filters.foundedFrom}
                onChange={e => setFilters(f => ({ ...f, foundedFrom: e.target.value }))}
                data-testid="input-founded-from"
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Até</p>
              <Input
                type="date"
                value={filters.foundedTo}
                onChange={e => setFilters(f => ({ ...f, foundedTo: e.target.value }))}
                data-testid="input-founded-to"
              />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Capital Social (R$)</Label>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Mínimo</p>
              <Input
                type="number"
                placeholder="0"
                value={filters.equityMin}
                onChange={e => setFilters(f => ({ ...f, equityMin: e.target.value }))}
                data-testid="input-equity-min"
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Máximo</p>
              <Input
                type="number"
                placeholder="∞"
                value={filters.equityMax}
                onChange={e => setFilters(f => ({ ...f, equityMax: e.target.value }))}
                data-testid="input-equity-max"
              />
            </div>
          </div>
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
