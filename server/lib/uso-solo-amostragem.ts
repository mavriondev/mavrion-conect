// Proporção de uso do solo por AMOSTRAGEM de pontos dentro do polígono (puro, sem rede).
// A API do MapBiomas devolve a classe de um ponto; amostrando N pontos internos obtemos uma
// ESTIMATIVA da proporção de cada uso. Não é medição por pixel: o erro cai com mais pontos
// (com 16 pontos, ~±12 pontos percentuais no pior caso).

export type GrupoUso = "vegetacao_nativa" | "pastagem" | "agricultura" | "silvicultura" | "agua" | "nao_vegetada" | "outros";

export const ROTULO_GRUPO: Record<GrupoUso, string> = {
  vegetacao_nativa: "Vegetação nativa",
  pastagem: "Pastagem",
  agricultura: "Agricultura",
  silvicultura: "Silvicultura",
  agua: "Água",
  nao_vegetada: "Área não vegetada",
  outros: "Outros / mosaico",
};

/** Agrupa as classes da Coleção MapBiomas. Classes não mapeadas (0, 27 "Não observado"...) → null (fora da conta). */
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
  /** % por grupo, sobre as amostras válidas, arredondado a 5 pontos (não finge precisão que a amostragem não tem). */
  grupos: Partial<Record<GrupoUso, number>>;
  amostrasValidas: number;
  amostrasTotal: number;
}

export function resumirUsoSolo(classes: Array<number | null | undefined>): ResumoUsoSolo | null {
  const total = classes.length;
  const cont: Partial<Record<GrupoUso, number>> = {};
  let validas = 0;
  for (const c of classes) {
    if (typeof c !== "number") continue;
    const g = grupoDaClasse(c);
    if (!g) continue;
    cont[g] = (cont[g] || 0) + 1;
    validas++;
  }
  // Amostra insuficiente (menos de metade dos pontos respondeu, ou menos de 4 pontos): não afirma proporção.
  if (validas < 4 || validas < total / 2) return null;
  const grupos: Partial<Record<GrupoUso, number>> = {};
  for (const [g, n] of Object.entries(cont) as Array<[GrupoUso, number]>) {
    const pct = Math.round(((n / validas) * 100) / 5) * 5;
    if (pct > 0) grupos[g] = pct;
  }
  return { grupos, amostrasValidas: validas, amostrasTotal: total };
}

export function descreverUsoSolo(r: ResumoUsoSolo): string {
  return Object.entries(r.grupos)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .map(([g, p]) => `~${p}% ${ROTULO_GRUPO[g as GrupoUso].toLowerCase()}`)
    .join(", ");
}
