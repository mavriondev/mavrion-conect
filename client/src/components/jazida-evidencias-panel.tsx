import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, RefreshCw, AlertTriangle, MapPin, Search, Layers, FileText, Globe2, Ban,
  CheckCircle2, CircleDashed, HelpCircle, ListChecks, GitCompareArrows, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Vinculo = "poligono" | "entorno" | "regional" | "documento";
type EstadoFonte = "registro" | "sem_registro" | "indisponivel" | "nao_consultado";

interface Catalogo {
  perfil: { substancia: string; grupo: string; rotuloGrupo: string; termos: string[]; fase: string | null; rotuloFase: string; prioridades: string[]; unidadesTeor: string };
  poligono: { disponivel: boolean; raioEquivalenteKm: number | null; pontoReferencia: { lat: number; lon: number } | null };
  itens: Array<{ id: string; tema: string; vinculo: Vinculo; titulo: string; detalhe: string; fonte: string; consultadoEm: string | null; distanciaKm?: number | null; raioKm?: number | null; identificador?: string | null; mesmaSubstancia?: boolean; valor?: { numero: number; unidade: string } | null }>;
  fontes: Array<{ id: string; label: string; estado: EstadoFonte; consultadoEm: string | null; raioKm?: number | null; motivo?: string | null; cobertura?: string | null }>;
  sintese: { porVinculo: Record<Vinculo, number>; destaques: string[]; avisos: string[] };
  impeditivos: Array<{ titulo: string; detalhe: string; fonte: string; consultadoEm: string | null; severidade: "impeditivo" | "atencao" }>;
  divergencias: Array<{ tema: string; detalhe: string; fontes: string[] }>;
  lacunas: Array<{ id: string; tema: string; oQueFalta: string; porQueImporta: string; ondeObter: string; proximoPasso: string; prioridade: 1 | 2 | 3; evidenciaParcial?: string | null }>;
  proximosPassos: string[];
}

const VINCULOS: Array<{ id: Vinculo; label: string; icon: typeof MapPin; hint: string }> = [
  { id: "poligono", label: "Dentro do polígono", icon: MapPin, hint: "ponto-em-polígono com a geometria do ativo" },
  { id: "entorno", label: "Entorno", icon: Layers, hint: "fora do polígono, com distância e raio explícitos" },
  { id: "regional", label: "Regional", icon: Globe2, hint: "contexto geológico/infraestrutura de escala regional" },
  { id: "documento", label: "Documentos", icon: FileText, hint: "casamento documental, sem verificação de conteúdo" },
];

const ESTADO_FONTE: Record<EstadoFonte, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  registro: { label: "com registro", cls: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: CheckCircle2 },
  sem_registro: { label: "sem registro", cls: "bg-slate-50 text-slate-700 border-slate-200", icon: CircleDashed },
  indisponivel: { label: "indisponível", cls: "bg-amber-50 text-amber-800 border-amber-200", icon: AlertTriangle },
  nao_consultado: { label: "não consultada", cls: "bg-muted text-muted-foreground border-border", icon: HelpCircle },
};

const fmtData = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");

export function JazidaEvidenciasPanel({ assetId, lat, lon }: { assetId: string; lat: number | null; lon: number | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [vinculoAtivo, setVinculoAtivo] = useState<Vinculo | "todos">("todos");

  const { data, isLoading, isError } = useQuery<Catalogo>({
    queryKey: ["/api/jazida", assetId, "evidencias"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/jazida/${assetId}/evidencias`);
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  const pesquisa = useMutation({
    mutationFn: async (refresh: boolean) => {
      const res = await apiRequest("POST", `/api/jazida/${assetId}/pesquisa-complementar`, { refresh });
      return res.json() as Promise<{ pesquisa: { resumo: { registro: number; semRegistro: number; indisponiveis: number; duracaoMs: number } }; evidencias: Catalogo }>;
    },
    onSuccess: (r) => {
      qc.setQueryData(["/api/jazida", assetId, "evidencias"], r.evidencias);
      qc.invalidateQueries({ queryKey: ["/api/assets", assetId] });
      const { registro, semRegistro, indisponiveis } = r.pesquisa.resumo;
      toast({
        title: "Pesquisa complementar concluída",
        description: `${registro} fonte(s) com registro, ${semRegistro} sem registro, ${indisponiveis} indisponível(is)${indisponiveis ? " — indisponível não é ausência de registro; repita mais tarde" : ""}.`,
      });
    },
    onError: (e: any) => toast({ title: "Pesquisa complementar falhou", description: e?.message || "erro", variant: "destructive" }),
  });

  if (isLoading) {
    return <Card><CardContent className="flex items-center justify-center py-10 gap-2 text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Montando o catálogo de evidências…</CardContent></Card>;
  }
  if (isError || !data) {
    return <Card><CardContent className="flex items-center justify-center py-10 gap-2 text-sm text-muted-foreground"><AlertTriangle className="w-5 h-5 text-amber-500" /> Não foi possível montar o catálogo de evidências.</CardContent></Card>;
  }

  const semCoordenadas = lat == null || lon == null;
  const itens = vinculoAtivo === "todos" ? data.itens : data.itens.filter((i) => i.vinculo === vinculoAtivo);
  const fontesPc = data.fontes.filter((f) => f.id.startsWith("pc."));
  const jaPesquisou = fontesPc.some((f) => f.estado !== "nao_consultado");

  return (
    <div className="space-y-4" data-testid="panel-jazida-evidencias">
      {/* Perfil + ação */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm flex items-center gap-2"><Search className="w-4 h-4" /> Evidências da jazida</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {data.perfil.substancia || "substância não informada"} · perfil <strong>{data.perfil.rotuloGrupo}</strong> · {data.perfil.rotuloFase}
            </p>
          </div>
          <Button size="sm" variant={jaPesquisou ? "outline" : "default"} className="gap-1.5 h-8 shrink-0" disabled={pesquisa.isPending || semCoordenadas}
            onClick={() => pesquisa.mutate(jaPesquisou)} data-testid="button-pesquisa-complementar" title={semCoordenadas ? "Ativo sem coordenadas" : undefined}>
            {pesquisa.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {pesquisa.isPending ? "Consultando fontes…" : jaPesquisou ? "Atualizar pesquisa complementar" : "Executar pesquisa complementar"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 text-xs">
            <div><span className="text-muted-foreground">Prioridades do perfil:</span> {data.perfil.prioridades.join("; ")}</div>
            <div><span className="text-muted-foreground">Unidade esperada de teor/qualidade:</span> {data.perfil.unidadesTeor}</div>
            <div><span className="text-muted-foreground">Base espacial:</span> {data.poligono.disponivel ? "polígono do ativo" : data.poligono.raioEquivalenteKm != null ? `sem polígono — raio equivalente ${data.poligono.raioEquivalenteKm} km` : "sem polígono nem área"}</div>
            <div><span className="text-muted-foreground">Termos equivalentes:</span> {data.perfil.termos.join(", ") || "—"}</div>
          </div>
          {semCoordenadas && (
            <p className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Ativo sem coordenadas: cadastre latitude/longitude ou vincule o processo ANM para habilitar a pesquisa complementar.</p>
          )}
          {/* Estado das fontes */}
          <div className="flex flex-wrap gap-1.5" data-testid="chips-fontes">
            {data.fontes.map((f) => {
              const e = ESTADO_FONTE[f.estado];
              const Icon = e.icon;
              return (
                <span key={f.id} title={[f.motivo, f.cobertura, f.consultadoEm ? `consulta ${fmtData(f.consultadoEm)}` : null].filter(Boolean).join("\n")}
                  className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]", e.cls)}>
                  <Icon className="w-3 h-3" /> {f.label.replace(/\s*\(.*\)$/, "")} · {e.label}{f.raioKm != null ? ` · ${f.raioKm} km` : ""}
                </span>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Síntese + impeditivos */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ListChecks className="w-4 h-4" /> Síntese</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-4 gap-2">
              {VINCULOS.map((v) => (
                <button key={v.id} type="button" onClick={() => setVinculoAtivo(vinculoAtivo === v.id ? "todos" : v.id)} title={v.hint}
                  className={cn("rounded-md border p-2 text-left transition-colors", vinculoAtivo === v.id ? "border-primary bg-primary/5" : "hover:bg-muted/50")} data-testid={`filtro-vinculo-${v.id}`}>
                  <div className="text-lg font-semibold leading-none">{data.sintese.porVinculo[v.id]}</div>
                  <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1"><v.icon className="w-3 h-3" /> {v.label}</div>
                </button>
              ))}
            </div>
            {data.sintese.destaques.length ? (
              <ul className="text-xs space-y-1 list-disc pl-4">{data.sintese.destaques.map((d, i) => <li key={i}>{d}</li>)}</ul>
            ) : <p className="text-xs text-muted-foreground">Nenhuma evidência registrada ainda — execute as consultas do dossiê e a pesquisa complementar.</p>}
            <div className="text-[11px] text-muted-foreground space-y-0.5">{data.sintese.avisos.map((a, i) => <p key={i}>{a}</p>)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Ban className="w-4 h-4" /> Impeditivos documentados e divergências</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            {data.impeditivos.length === 0 && (
              <p className="text-muted-foreground">
                {data.fontes.find((f) => f.id === "anmRestricoes")?.estado === "registro"
                  ? "Nenhuma sobreposição direta ou ocorrência no raio nas camadas consultadas (vale só para camadas e raio da aba Restrições)."
                  : "Camadas de restrição não consultadas — execute a aba Restrições para concluir sobre impeditivos."}
              </p>
            )}
            {data.impeditivos.map((i, k) => (
              <div key={k} className={cn("rounded-md border p-2", i.severidade === "impeditivo" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50")} data-testid={`impeditivo-${k}`}>
                <div className="font-medium">{i.titulo}</div>
                <div className="text-muted-foreground">{i.detalhe}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">[{i.fonte}, {fmtData(i.consultadoEm)}]</div>
              </div>
            ))}
            {data.divergencias.map((d, k) => (
              <div key={`d${k}`} className="rounded-md border border-sky-200 bg-sky-50 p-2">
                <div className="font-medium flex items-center gap-1"><GitCompareArrows className="w-3 h-3" /> {d.tema}</div>
                <div className="text-muted-foreground">{d.detalhe}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">[{d.fontes.join("; ")}]</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Itens */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Evidências — {vinculoAtivo === "todos" ? "todas" : VINCULOS.find((v) => v.id === vinculoAtivo)?.label} ({itens.length})</CardTitle>
          {vinculoAtivo !== "todos" && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setVinculoAtivo("todos")}>Limpar filtro</Button>}
        </CardHeader>
        <CardContent>
          {itens.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma evidência neste vínculo.</p> : (
            <div className="divide-y">
              {itens.map((i) => {
                const v = VINCULOS.find((x) => x.id === i.vinculo)!;
                const link = i.identificador && /^https?:\/\//.test(i.identificador) ? i.identificador : null;
                return (
                  <div key={i.id} className="py-2 text-xs grid gap-1 sm:grid-cols-[150px_1fr]" data-testid={`evidencia-${i.id}`}>
                    <div className="space-y-1">
                      <Badge variant="outline" className="text-[10px] gap-1 font-normal"><v.icon className="w-3 h-3" /> {v.label}</Badge>
                      <div className="text-[11px] text-muted-foreground">{i.tema}</div>
                      {i.distanciaKm != null && <div className="text-[11px]">{i.distanciaKm} km{i.raioKm != null ? ` (raio ${i.raioKm} km)` : ""}</div>}
                      {i.mesmaSubstancia && <Badge className="text-[10px] bg-emerald-600 hover:bg-emerald-600">mesma substância</Badge>}
                    </div>
                    <div>
                      <div className="font-medium flex items-center gap-1">{i.titulo}{link && <a href={link} target="_blank" rel="noreferrer" className="text-primary"><ExternalLink className="w-3 h-3" /></a>}</div>
                      <div className="text-muted-foreground">{i.detalhe}</div>
                      {i.valor && <div className="mt-0.5">Valor: <strong>{i.valor.numero.toLocaleString("pt-BR")}</strong> {i.valor.unidade}</div>}
                      <div className="text-[10px] text-muted-foreground mt-0.5">[{i.fonte}, {fmtData(i.consultadoEm)}{i.identificador && !link ? ` · id ${i.identificador}` : ""}]</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lacunas e próximos passos */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Lacunas prioritárias do perfil</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            {data.lacunas.map((l) => (
              <div key={l.id} className="rounded-md border p-2" data-testid={`lacuna-${l.id}`}>
                <div className="flex items-center gap-2">
                  <Badge variant={l.prioridade === 1 ? "destructive" : l.prioridade === 2 ? "secondary" : "outline"} className="text-[10px]">P{l.prioridade}</Badge>
                  <span className="font-medium">{l.tema}</span>
                </div>
                <div className="mt-1 grid gap-0.5">
                  <div><span className="text-muted-foreground">O que falta:</span> {l.oQueFalta}</div>
                  <div><span className="text-muted-foreground">Por que importa:</span> {l.porQueImporta}</div>
                  <div><span className="text-muted-foreground">Onde obter:</span> {l.ondeObter}</div>
                  {l.evidenciaParcial && <div className="text-emerald-800"><span className="text-muted-foreground">Evidência parcial:</span> {l.evidenciaParcial}</div>}
                </div>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">Lista orientada pelo tipo de depósito e pela fase; não altera o score de completude do dossiê.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Próximos passos</CardTitle></CardHeader>
          <CardContent>
            {data.proximosPassos.length ? (
              <ol className="text-xs space-y-1.5 list-decimal pl-4">{data.proximosPassos.map((p, i) => <li key={i}>{p}</li>)}</ol>
            ) : <p className="text-xs text-muted-foreground">Sem pendências registradas.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
