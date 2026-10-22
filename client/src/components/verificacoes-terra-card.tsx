import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { apresentarUsoSolo } from "@shared/uso-solo-amostragem";

type Verif = {
  chave: string; rotulo: string; estado: "confirmado" | "indicado" | "sem_dado";
  achado: "detectado" | "nao_detectado" | "indeterminado"; valor: any; unidade?: string;
  fonte: string; consultadoEm: string; confirmadoPor?: string; observacao?: string;
  desatualizada?: boolean; divergencia?: boolean; automaticaMaisRecente?: Verif;
};

function formatarValor(v: Verif): string {
  if (v.valor == null) return "";
  if (v.chave === "uso_solo") return apresentarUsoSolo(v.valor).texto;
  if (typeof v.valor === "number") {
    if (v.unidade === "m") return v.valor >= 1000 ? `${(v.valor / 1000).toFixed(1).replace(".", ",")} km` : `${v.valor} m`;
    return String(v.valor);
  }
  if (typeof v.valor === "string") return v.valor;
  if (Array.isArray(v.valor)) {
    return v.valor.map((a: any) => `${a.nome}${a.pct ? ` (${a.pct}%)` : ""}${a.aVerificar ? ` — ${a.aVerificar}` : ""}`).join("; ");
  }
  if (typeof v.valor === "object") {
    if ("appHa" in v.valor) return `${v.valor.appHa} ha (${String(v.valor.pctDaArea).replace(".", ",")}% da área)`;
    if ("grupos" in v.valor && typeof v.valor.descricao === "string") return v.valor.descricao;
        if ("alertas" in v.valor) return `${v.valor.alertas} alerta(s), ${v.valor.areaHa} ha`;
  }
  return JSON.stringify(v.valor);
}

function rotuloEstado(v: Verif): { texto: string; classe: string } {
  if (v.estado === "confirmado") return { texto: `Confirmado (${v.confirmadoPor ?? "humano"})`, classe: "bg-green-100 text-green-800" };
  if (v.estado === "sem_dado") return { texto: "Sem dado", classe: "bg-gray-100 text-gray-700" };
  return v.achado === "detectado"
    ? { texto: "Indicado por fonte", classe: "bg-blue-100 text-blue-800" }
    : { texto: "Não detectado na fonte", classe: "bg-yellow-100 text-yellow-800" };
}

export default function VerificacoesTerraCard({ assetId }: { assetId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["/api/assets", String(assetId), "verificacoes"];
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [origem, setOrigem] = useState("vendedor");
  const [achado, setAchado] = useState("detectado");

  const { data, isLoading } = useQuery<{ verificacoes: Verif[] }>({ queryKey: key });

  const executar = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/assets/${assetId}/verificacoes/executar`)).json(),
    onSuccess: (d) => { qc.setQueryData(key, d); toast({ title: "Verificações atualizadas" }); },
    onError: (e: any) => toast({ title: "Não foi possível verificar", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const confirmar = useMutation({
    mutationFn: async (chave: string) =>
      (await apiRequest("POST", `/api/assets/${assetId}/verificacoes/${chave}/confirmar`, { achado, confirmadoPor: origem })).json(),
    onSuccess: (d) => { qc.setQueryData(key, d); setConfirmando(null); toast({ title: "Confirmação registrada" }); },
    onError: (e: any) => toast({ title: "Erro ao confirmar", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const lista = data?.verificacoes ?? [];

  return (
    <Card data-testid="card-verificacoes-terra">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-600" />Verificações da terra</span>
          <Button size="sm" variant="outline" onClick={() => executar.mutate()} disabled={executar.isPending} data-testid="button-executar-verificacoes">
            {executar.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
            {lista.length ? "Atualizar" : "Verificar"}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-[11px] text-muted-foreground">
          Fontes públicas só indicam o que existe. "Não detectado" não prova ausência (cadastros podem estar desatualizados ou no nome de antigo dono).
          Confirme com o vendedor, documento ou visita.
        </p>
        {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
        {!isLoading && lista.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma verificação feita ainda. Requer polígono cadastrado.</p>}
        {lista.map((v) => {
          const r = rotuloEstado(v);
          const uso = v.chave === "uso_solo" ? apresentarUsoSolo(v.valor) : null;
          return (
            <div key={v.chave} className="rounded border p-2.5 space-y-1" data-testid={`row-verificacao-${v.chave}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">{v.rotulo}</span>
                <Badge className={`text-[10px] ${r.classe}`}>{r.texto}</Badge>
              </div>
              {formatarValor(v) && <p className="text-sm font-semibold">{formatarValor(v)}</p>}
              {v.achado === "nao_detectado" && v.estado !== "confirmado" && <p className="text-xs text-muted-foreground">Não detectado</p>}
              {uso?.detalhe && <p className="text-xs text-muted-foreground" data-testid="detalhe-uso-solo">{uso.detalhe}</p>}
              {v.observacao && !uso?.legado && <p className="text-[10px] text-muted-foreground">{v.observacao}</p>}
              {v.divergencia && v.automaticaMaisRecente && (
                <p className="text-[10px] text-red-600">
                  Divergência: a fonte automática mais recente indica "{v.automaticaMaisRecente.achado === "detectado" ? "detectado" : "não detectado"}", diferente da confirmação. Reavalie.
                </p>
              )}
              <p className="text-[10px] text-muted-foreground">
                {v.fonte} · {new Date(v.consultadoEm).toLocaleDateString("pt-BR")}
                {v.desatualizada && <span className="text-orange-600"> · desatualizada — atualize</span>}
              </p>
              {confirmando === v.chave ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <select className="text-xs border rounded px-1 py-0.5" value={achado} onChange={(e) => setAchado(e.target.value)}>
                    <option value="detectado">Existe</option>
                    <option value="nao_detectado">Não existe</option>
                  </select>
                  <select className="text-xs border rounded px-1 py-0.5" value={origem} onChange={(e) => setOrigem(e.target.value)}>
                    <option value="vendedor">Vendedor informou</option>
                    <option value="documento">Documento</option>
                    <option value="visita">Visita</option>
                  </select>
                  <Button size="sm" className="h-6 text-[11px]" onClick={() => confirmar.mutate(v.chave)} disabled={confirmar.isPending}>Salvar</Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setConfirmando(null)}>Cancelar</Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" className="h-6 text-[11px] px-1" onClick={() => { setConfirmando(v.chave); setAchado(v.achado === "nao_detectado" ? "nao_detectado" : "detectado"); }}>
                  Confirmar manualmente
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
