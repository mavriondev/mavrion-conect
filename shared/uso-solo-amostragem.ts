export type GrupoUso = "vegetacao_nativa" | "pastagem" | "agricultura" | "silvicultura" | "agua" | "nao_vegetada" | "outros";

export const ROTULO_GRUPO: Record<GrupoUso, string> = {
  vegetacao_nativa: "Vegetação nativa", pastagem: "Pastagem", agricultura: "Agricultura",
  silvicultura: "Silvicultura", agua: "Água", nao_vegetada: "Área não vegetada", outros: "Outros / mosaico",
};

/** Classes desconhecidas/não observadas são sem dado, nunca uma classe de uso. */
export function grupoDaClasse(classe: number): GrupoUso | null {
  if ([1, 3, 4, 5, 6, 11, 12, 13, 49, 50, 32].includes(classe)) return "vegetacao_nativa";
  if (classe === 15) return "pastagem";
  if ([18, 19, 20, 35, 36, 39, 40, 41, 46, 47, 48, 62].includes(classe)) return "agricultura";
  if (classe === 9) return "silvicultura";
  if ([26, 33, 31].includes(classe)) return "agua";
  if ([22, 23, 24, 25, 29, 30].includes(classe)) return "nao_vegetada";
  if ([14, 21].includes(classe)) return "outros";
  return null;
}

export interface ResumoUsoSolo {
  metodo: "amostragem_pontos";
  basePercentual: "todos_os_pontos";
  passoPercentual: 5;
  /** Faixas arredondadas em conjunto; incluem zero para classes raras observadas. */
  grupos: Partial<Record<GrupoUso, number>>;
  contagens: Partial<Record<GrupoUso, number>>;
  percentualSemDado: number;
  amostrasSemDado: number;
  amostrasValidas: number;
  amostrasTotal: number;
}

export function resumirUsoSolo(classes: Array<number | null | undefined>): ResumoUsoSolo | null {
  const total = classes.length;
  const contagens: Partial<Record<GrupoUso, number>> = {};
  let validas = 0;
  for (const c of classes) {
    const g = typeof c === "number" ? grupoDaClasse(c) : null;
    if (!g) continue;
    contagens[g] = (contagens[g] ?? 0) + 1;
    validas++;
  }
  if (validas < 4 || validas < total / 2) return null;
  const semDado = total - validas;
  // Maiores restos distribuem exatamente 20 unidades de 5 p.p.
  // A ordem canônica desempata de forma independente da ordem dos pontos.
  const entradas = (Object.keys(ROTULO_GRUPO) as GrupoUso[])
    .filter(g => contagens[g])
    .map(g => ({ chave: g as GrupoUso | "sem_dado", n: contagens[g]! }));
  if (semDado) entradas.push({ chave: "sem_dado", n: semDado });
  const faixas = entradas.map((e, ordem) => ({
    ...e, ordem, unidades: Math.floor(e.n * 20 / total), resto: e.n * 20 % total,
  }));
  const faltam = 20 - faixas.reduce((s, e) => s + e.unidades, 0);
  const porResto = [...faixas].sort((a, b) => b.resto - a.resto || a.ordem - b.ordem);
  for (let i = 0; i < faltam; i++) porResto[i].unidades++;
  const grupos: ResumoUsoSolo["grupos"] = {};
  let percentualSemDado = 0;
  for (const e of faixas) {
    if (e.chave === "sem_dado") percentualSemDado = e.unidades * 5;
    else grupos[e.chave] = e.unidades * 5;
  }
  return {
    metodo: "amostragem_pontos", basePercentual: "todos_os_pontos", passoPercentual: 5,
    grupos, contagens, percentualSemDado, amostrasSemDado: semDado,
    amostrasValidas: validas, amostrasTotal: total,
  };
}

export function descreverUsoSolo(r: ResumoUsoSolo): string {
  const faixa = (p: number, n: number, rotulo: string) =>
    p === 0
      ? `${rotulo}: ${n} ponto(s), presença amostrada (0% após arredondamento)`
      : `~${p}% ${rotulo} (${n}/${r.amostrasTotal} pontos)`;
  const textos = Object.entries(r.grupos)
    .sort((a, b) => b[1]! - a[1]!)
    .map(([g, p]) => faixa(p!, r.contagens[g as GrupoUso]!, ROTULO_GRUPO[g as GrupoUso].toLowerCase()));
  if (r.amostrasSemDado) textos.push(faixa(r.percentualSemDado, r.amostrasSemDado, "sem dado"));
  return textos.join("; ");
}

/** Legados não têm contagens: não é possível reconstruir proporções a partir de 90% + 15%. */
export function apresentarUsoSolo(valor: unknown): { texto: string; detalhe?: string; legado?: boolean } {
  if (typeof valor === "string") return {
    texto: valor, detalhe: "Classe em um ponto (pixel de ~30 m); não representa a proporção de uso na área.",
  };
  if (!valor || typeof valor !== "object") return { texto: "" };
  const v = valor as Record<string, any>;
  if (!v.grupos || typeof v.grupos !== "object" || Array.isArray(v.grupos)) return { texto: "" };
  if (v.metodo === "amostragem_pontos" && v.basePercentual === "todos_os_pontos" && v.contagens) {
    return {
      texto: descreverUsoSolo(v as ResumoUsoSolo),
      detalhe: `Proporção dos pontos, não área medida: ${v.amostrasValidas}/${v.amostrasTotal} classificados; ${v.amostrasSemDado} sem dado. Faixas de 5 pontos percentuais, arredondadas em conjunto para totalizar 100%, incluindo sem dado. Não são hectares nem medição por pixel; o arredondamento não indica precisão estatística.`,
    };
  }
  return {
    texto: Object.keys(v.grupos).map(g => ROTULO_GRUPO[g as GrupoUso] ?? g).join("; "),
    detalhe: "Estimativa amostral antiga, sem contagens originais. Atualize este ativo para obter percentuais consistentes; não é área medida.",
    legado: true,
  };
}
