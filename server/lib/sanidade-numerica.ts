/**
 * Sanidade numérica: todo número derivado (percentual de sobreposição,
 * interseção de áreas, soma de partes) passa por checagem antes de ser
 * exposto. Quando a checagem falha, o valor NÃO é exibido — vira o marcador
 * "a verificar" com o motivo, para o renderizador e a IA tratarem como
 * pendência em vez de fato.
 *
 * Regras (tarefa "correção geral do relatório"):
 *  - nenhum percentual exibível excede 100%;
 *  - nenhuma interseção excede a área do menor polígono;
 *  - somas de partes não excedem o todo;
 *  - datas em ordem cronológica.
 *
 * Tolerâncias pequenas absorvem arredondamento (reprojeção UTM, GeoJSON com
 * 6 casas decimais); acima da tolerância é inconsistência real.
 */

export interface ChecagemOk { ok: true; valor: number }
export interface ChecagemFalha { ok: false; aVerificar: true; motivo: string; valorOriginal: number | null }
export type ValorChecado = ChecagemOk | ChecagemFalha;

/** pontos percentuais tolerados acima de 100 (arredondamento) — acima disso é erro real */
export const TOLERANCIA_PCT = 0.5;
/** tolerância relativa entre áreas (1%) + piso absoluto em ha para bases distintas */
export const TOLERANCIA_AREA_REL = 0.01;
export const TOLERANCIA_AREA_HA = 0.05;

const falha = (motivo: string, valorOriginal: number | null): ChecagemFalha =>
  ({ ok: false, aVerificar: true, motivo, valorOriginal });

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

const fmt = (n: number): string =>
  n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** Percentual exibível: 0–100. Levemente acima de 100 (arredondamento) é grampeado; acima da tolerância vira "a verificar". */
export function checarPercentual(pct: unknown, contexto?: string): ValorChecado {
  const p = num(pct);
  const ctx = contexto ? ` (${contexto})` : "";
  if (p == null) return falha(`percentual não numérico${ctx}`, null);
  if (p < 0) return falha(`percentual negativo (${fmt(p)}%)${ctx}`, p);
  if (p <= 100) return { ok: true, valor: p };
  if (p <= 100 + TOLERANCIA_PCT) return { ok: true, valor: 100 };
  return falha(`percentual de ${fmt(p)}% excede 100%${ctx} — inconsistência geométrica ou aritmética`, p);
}

/** Interseção nunca excede a área do menor polígono (com tolerância de arredondamento). Áreas desconhecidas não bloqueiam. */
export function checarIntersecao(intersecaoHa: unknown, areaAHa?: unknown, areaBHa?: unknown, contexto?: string): ValorChecado {
  const inter = num(intersecaoHa);
  const ctx = contexto ? ` (${contexto})` : "";
  if (inter == null) return falha(`área de interseção não numérica${ctx}`, null);
  if (inter < 0) return falha(`área de interseção negativa (${fmt(inter)} ha)${ctx}`, inter);
  const areas = [num(areaAHa), num(areaBHa)].filter((a): a is number => a != null && a >= 0);
  if (areas.length === 0) return { ok: true, valor: inter };
  const menor = Math.min(...areas);
  const teto = menor + Math.max(menor * TOLERANCIA_AREA_REL, TOLERANCIA_AREA_HA);
  if (inter <= teto) return { ok: true, valor: Math.min(inter, menor) };
  return falha(`interseção de ${fmt(inter)} ha excede a área do menor polígono (${fmt(menor)} ha)${ctx}`, inter);
}

/** Soma de partes não excede o todo (com tolerância). Todo desconhecido não bloqueia. */
export function checarSomaPartes(partes: unknown[], todo: unknown, contexto?: string): ValorChecado {
  const soma = (Array.isArray(partes) ? partes : [])
    .map(num)
    .filter((n): n is number => n != null)
    .reduce((s, n) => s + n, 0);
  const ctx = contexto ? ` (${contexto})` : "";
  if (soma < 0) return falha(`soma de partes negativa (${fmt(soma)})${ctx}`, soma);
  const t = num(todo);
  if (t == null) return { ok: true, valor: soma };
  const teto = t + Math.max(Math.abs(t) * TOLERANCIA_AREA_REL, TOLERANCIA_AREA_HA);
  if (soma <= teto) return { ok: true, valor: Math.min(soma, t) };
  return falha(`soma das partes (${fmt(soma)}) excede o todo (${fmt(t)})${ctx}`, soma);
}

/** Datas em ordem cronológica não decrescente (nulos/invalidas são ignorados). */
export function checarOrdemCronologica(datas: Array<string | Date | null | undefined>, contexto?: string): { ok: boolean; motivo?: string } {
  const ts: number[] = [];
  for (const d of datas || []) {
    if (d == null || d === "") continue;
    const t = d instanceof Date ? d.getTime() : Date.parse(String(d));
    if (Number.isFinite(t)) ts.push(t);
  }
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] < ts[i - 1]) {
      return { ok: false, motivo: `datas fora de ordem cronológica${contexto ? ` (${contexto})` : ""}` };
    }
  }
  return { ok: true };
}

export interface SobreposicaoSaneada {
  sobreposicaoHa: number | null;
  sobreposicaoPct: number | null;
  /** presente quando alguma checagem falhou — o motivo substitui os números na exibição */
  sobreposicaoAVerificar?: string;
}

/**
 * Sanea o par (ha, pct) de uma sobreposição: pct ≤ 100 e interseção ≤ menor
 * área quando as áreas de referência são conhecidas. Qualquer falha zera os
 * números e registra o motivo em `sobreposicaoAVerificar`.
 */
export function sanearSobreposicao(input: {
  sobreposicaoHa?: unknown;
  sobreposicaoPct?: unknown;
  areaMenorHa?: unknown;   // ex.: min(área do imóvel, área do processo)
  areaOutraHa?: unknown;
  contexto?: string;
}): SobreposicaoSaneada {
  const motivos: string[] = [];
  let ha = num(input.sobreposicaoHa);
  let pct = num(input.sobreposicaoPct);

  if (input.sobreposicaoHa != null && ha != null) {
    const c = checarIntersecao(ha, input.areaMenorHa, input.areaOutraHa, input.contexto);
    if (c.ok) ha = c.valor; else { motivos.push(c.motivo); ha = null; }
  }
  if (input.sobreposicaoPct != null && pct != null) {
    const c = checarPercentual(pct, input.contexto);
    if (c.ok) pct = c.valor; else { motivos.push(c.motivo); pct = null; }
  }
  if (motivos.length === 0) return { sobreposicaoHa: ha, sobreposicaoPct: pct };
  // uma falha contamina o par: número que sobreviveu também não é confiável
  return { sobreposicaoHa: null, sobreposicaoPct: null, sobreposicaoAVerificar: motivos.join("; ") };
}
