import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronRight, X } from "lucide-react";

export const CNAE_TREE = [
  {
    section: "A", label: "Agricultura, Pecuária, Pesca e Aquicultura",
    divisions: [
      { code: "01", label: "Agricultura, pecuária e serviços relacionados", subclasses: [
        { id: 111301, label: "Cultivo de arroz" },
        { id: 111302, label: "Cultivo de milho" },
        { id: 113000, label: "Cultivo de cana-de-açúcar" },
        { id: 115600, label: "Cultivo de soja" },
        { id: 119901, label: "Cultivo de abacaxi" },
        { id: 131800, label: "Cultivo de laranja" },
        { id: 141501, label: "Cultivo de café arábica" },
        { id: 141502, label: "Cultivo de café conilon" },
        { id: 151201, label: "Criação de bovinos para leite" },
        { id: 151202, label: "Criação de bovinos para corte" },
        { id: 155501, label: "Criação de suínos" },
        { id: 156901, label: "Criação de aves" },
        { id: 161001, label: "Serviços de preparação do terreno" },
        { id: 162801, label: "Serviços de adubação" },
        { id: 162803, label: "Serviços de colheita mecanizada" },
        { id: 163600, label: "Atividades de pós-colheita" },
      ]},
      { code: "02", label: "Produção florestal", subclasses: [
        { id: 210102, label: "Silvicultura sob regime de concessão" },
        { id: 210108, label: "Plantio de eucalipto" },
        { id: 220901, label: "Extração de madeira em florestas nativas" },
        { id: 220902, label: "Produção de carvão vegetal" },
      ]},
      { code: "03", label: "Pesca e aquicultura", subclasses: [
        { id: 311601, label: "Pesca de peixes em água salgada" },
        { id: 321301, label: "Criação de peixes em água salgada" },
        { id: 322100, label: "Criação de camarões em água salgada" },
      ]},
    ],
  },
  {
    section: "B", label: "Indústrias Extrativas",
    divisions: [
      { code: "05", label: "Extração de carvão mineral", subclasses: [
        { id: 500301, label: "Extração de carvão mineral" },
      ]},
      { code: "06", label: "Extração de petróleo e gás natural", subclasses: [
        { id: 600001, label: "Extração de petróleo e gás natural" },
        { id: 600002, label: "Extração e beneficiamento de xisto" },
      ]},
      { code: "07", label: "Extração de minerais metálicos", subclasses: [
        { id: 710301, label: "Extração de minério de ferro" },
        { id: 721401, label: "Extração de minério de alumínio" },
        { id: 722201, label: "Extração de minério de estanho" },
        { id: 723303, label: "Extração de minério de ouro" },
        { id: 729403, label: "Extração de gemas (pedras preciosas)" },
      ]},
      { code: "08", label: "Extração de minerais não metálicos", subclasses: [
        { id: 810002, label: "Extração de granito e beneficiamento" },
        { id: 810007, label: "Extração de mármore e beneficiamento" },
        { id: 812200, label: "Extração de calcário e dolomita" },
        { id: 891600, label: "Extração de minerais para fertilizantes" },
        { id: 899903, label: "Extração de areia, cascalho" },
      ]},
    ],
  },
  {
    section: "C", label: "Indústrias de Transformação",
    divisions: [
      { code: "10", label: "Fabricação de alimentos", subclasses: [
        { id: 1011201, label: "Abate de bovinos" },
        { id: 1011202, label: "Abate de suínos" },
        { id: 1012101, label: "Abate de aves" },
        { id: 1051100, label: "Preparação do leite" },
        { id: 1061901, label: "Beneficiamento de arroz" },
        { id: 1064300, label: "Moagem de trigo e fabricação de derivados" },
        { id: 1065101, label: "Beneficiamento de soja" },
        { id: 1094500, label: "Fabricação de rações" },
      ]},
      { code: "19", label: "Fabricação de coque, derivados do petróleo", subclasses: [
        { id: 1921700, label: "Fabricação de álcool" },
      ]},
    ],
  },
  {
    section: "F", label: "Construção",
    divisions: [
      { code: "41", label: "Construção de edifícios", subclasses: [
        { id: 4110700, label: "Incorporação de empreendimentos imobiliários" },
        { id: 4120400, label: "Construção de edifícios" },
      ]},
      { code: "42", label: "Obras de infraestrutura", subclasses: [
        { id: 4211101, label: "Construção de rodovias e ferrovias" },
        { id: 4213800, label: "Obras de arte especiais" },
        { id: 4221901, label: "Construção de barragens e represas" },
        { id: 4222701, label: "Montagem de estruturas metálicas" },
        { id: 4291000, label: "Obras portuárias, marítimas e fluviais" },
      ]},
      { code: "43", label: "Serviços especializados para construção", subclasses: [
        { id: 4311801, label: "Demolição de edifícios" },
        { id: 4312600, label: "Terraplenagem" },
        { id: 4330401, label: "Impermeabilização em obras de engenharia civil" },
      ]},
    ],
  },
  {
    section: "K", label: "Atividades Financeiras e de Seguros",
    divisions: [
      { code: "64", label: "Atividades de serviços financeiros", subclasses: [
        { id: 6410702, label: "Banco de investimento" },
        { id: 6421200, label: "Bancos comerciais" },
        { id: 6431000, label: "Bancos de câmbio" },
        { id: 6440900, label: "Arrendamento mercantil (leasing)" },
        { id: 6450600, label: "Sociedades de capitalização" },
        { id: 6461100, label: "Holdings de instituições financeiras" },
        { id: 6462000, label: "Holdings de outras sociedades" },
        { id: 6499300, label: "Outras atividades de serviços financeiros" },
      ]},
      { code: "65", label: "Seguros, resseguros e previdência", subclasses: [
        { id: 6512000, label: "Seguros de vida" },
        { id: 6521300, label: "Resseguros" },
        { id: 6530800, label: "Previdência complementar aberta" },
      ]},
      { code: "66", label: "Atividades auxiliares dos serviços financeiros", subclasses: [
        { id: 6611801, label: "Bolsa de valores" },
        { id: 6621501, label: "Peritos e avaliadores de seguros" },
        { id: 6630400, label: "Atividades de administração de fundos" },
      ]},
    ],
  },
  {
    section: "L", label: "Atividades Imobiliárias",
    divisions: [
      { code: "68", label: "Atividades imobiliárias", subclasses: [
        { id: 6810201, label: "Compra e venda de imóveis próprios" },
        { id: 6810202, label: "Aluguel de imóveis próprios" },
        { id: 6821801, label: "Corretagem na compra e venda de imóveis" },
        { id: 6821802, label: "Corretagem no aluguel de imóveis" },
        { id: 6822600, label: "Gestão e administração da propriedade imobiliária" },
      ]},
    ],
  },
  {
    section: "M", label: "Atividades Profissionais, Científicas e Técnicas",
    divisions: [
      { code: "70", label: "Atividades de sedes e consultoria em gestão", subclasses: [
        { id: 7010600, label: "Atividades de sedes (holdings)" },
        { id: 7020400, label: "Atividades de consultoria em gestão empresarial" },
      ]},
      { code: "71", label: "Serviços de arquitetura e engenharia", subclasses: [
        { id: 7111100, label: "Serviços de arquitetura" },
        { id: 7112000, label: "Serviços de engenharia" },
        { id: 7119702, label: "Atividades de estudos geológicos" },
        { id: 7119703, label: "Serviços de desenho técnico" },
        { id: 7119704, label: "Serviços de perícia técnica" },
      ]},
      { code: "74", label: "Outras atividades profissionais e técnicas", subclasses: [
        { id: 7490101, label: "Serviços de tradução" },
        { id: 7490104, label: "Atividades de intermediação e agenciamento" },
      ]},
    ],
  },
  {
    section: "N", label: "Atividades Administrativas e Serviços Complementares",
    divisions: [
      { code: "77", label: "Locação de bens não-imóveis", subclasses: [
        { id: 7731400, label: "Locação de máquinas e equipamentos agrícolas" },
        { id: 7732201, label: "Locação de máquinas e equipamentos para construção" },
      ]},
    ],
  },
  {
    section: "G", label: "Comércio e Reparação de Veículos",
    divisions: [
      { code: "46", label: "Comércio atacadista (exceto veículos)", subclasses: [
        { id: 4612100, label: "Representantes comerciais de matérias-primas" },
        { id: 4621400, label: "Comércio atacadista de cereais e leguminosas" },
        { id: 4622200, label: "Comércio atacadista de soja" },
        { id: 4651601, label: "Comércio atacadista de máquinas agrícolas" },
      ]},
    ],
  },
];

export const ALL_CNAE_IDS_BY_DIVISION: Record<string, number[]> = {};
export const ALL_CNAE_IDS_BY_SECTION: Record<string, number[]> = {};
for (const sec of CNAE_TREE) {
  const secIds: number[] = [];
  for (const div of sec.divisions) {
    const divIds = div.subclasses.map(s => s.id);
    ALL_CNAE_IDS_BY_DIVISION[div.code] = divIds;
    secIds.push(...divIds);
  }
  ALL_CNAE_IDS_BY_SECTION[sec.section] = secIds;
}

export function CnaePicker({
  selected,
  onChange,
  label,
}: {
  selected: number[];
  onChange: (ids: number[]) => void;
  label: string;
}) {
  const [openSections, setOpenSections] = useState<string[]>([]);

  const toggleSection = (sec: string) => {
    setOpenSections(prev => prev.includes(sec) ? prev.filter(s => s !== sec) : [...prev, sec]);
  };

  const toggleSubclass = (id: number) => {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  };

  const toggleDivision = (code: string) => {
    const ids = ALL_CNAE_IDS_BY_DIVISION[code] || [];
    const allSelected = ids.every(id => selected.includes(id));
    if (allSelected) {
      onChange(selected.filter(id => !ids.includes(id)));
    } else {
      const newSelected = [...selected];
      for (const id of ids) if (!newSelected.includes(id)) newSelected.push(id);
      onChange(newSelected);
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.slice(0, 3).map(id => {
            const sub = CNAE_TREE.flatMap(s => s.divisions.flatMap(d => d.subclasses)).find(s => s.id === id);
            return (
              <Badge key={id} variant="secondary" className="text-xs gap-1 cursor-pointer" onClick={() => toggleSubclass(id)}>
                {sub?.label.substring(0, 20) ?? id}
                <X className="w-3 h-3" />
              </Badge>
            );
          })}
          {selected.length > 3 && (
            <Badge variant="outline" className="text-xs">+{selected.length - 3}</Badge>
          )}
          <button
            className="text-xs text-muted-foreground hover:text-foreground underline"
            onClick={() => onChange([])}
          >
            limpar
          </button>
        </div>
      )}
      <div className="border rounded-md max-h-56 overflow-y-auto text-sm">
        {CNAE_TREE.map(sec => {
          const isOpen = openSections.includes(sec.section);
          const secSelectedCount = sec.divisions.flatMap(d => d.subclasses).filter(s => selected.includes(s.id)).length;
          return (
            <div key={sec.section} className="border-b last:border-0">
              <button
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 text-left"
                onClick={() => toggleSection(sec.section)}
                data-testid={`cnae-section-${sec.section}`}
              >
                <span className="font-medium text-xs flex items-center gap-1">
                  <span className="text-muted-foreground w-4">{sec.section}</span>
                  {sec.label}
                  {secSelectedCount > 0 && (
                    <Badge variant="secondary" className="text-xs ml-1 py-0 h-4">{secSelectedCount}</Badge>
                  )}
                </span>
                {isOpen ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
              </button>
              {isOpen && (
                <div className="bg-muted/20">
                  {sec.divisions.map(div => {
                    const divIds = div.subclasses.map(s => s.id);
                    const allDivSelected = divIds.every(id => selected.includes(id));
                    const someDivSelected = divIds.some(id => selected.includes(id));
                    return (
                      <div key={div.code} className="border-t border-border/40">
                        <div className="flex items-center gap-2 px-4 py-1.5">
                          <Checkbox
                            checked={allDivSelected}
                            data-state={someDivSelected && !allDivSelected ? "indeterminate" : undefined}
                            onCheckedChange={() => toggleDivision(div.code)}
                            data-testid={`cnae-div-${div.code}`}
                          />
                          <span className="text-xs font-medium text-muted-foreground">{div.code} – {div.label}</span>
                        </div>
                        <div className="pl-8 pb-1 space-y-0.5">
                          {div.subclasses.map(sub => (
                            <div key={sub.id} className="flex items-center gap-2 py-0.5">
                              <Checkbox
                                checked={selected.includes(sub.id)}
                                onCheckedChange={() => toggleSubclass(sub.id)}
                                data-testid={`cnae-sub-${sub.id}`}
                              />
                              <span className="text-xs">{sub.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
