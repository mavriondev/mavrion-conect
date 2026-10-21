// Estados de confiança dos dados de um ativo (puro, sem rede/banco — testável).
//
// Regra central: fonte pública só ADICIONA evidência positiva; ela nunca prova que algo não existe
// (CAR pode estar no nome do dono antigo, bases são defasadas, serviço pode ter falhado).
// Por isso cada verificação tem um ESTADO e um ACHADO separados:
//
//   estado  confirmado  → alguém confirmou (vendedor, documento ou visita) — só a ação humana gera isso
//           indicado    → uma fonte automática indicou, com data
//           sem_dado    → nada se sabe (fonte não respondeu / não cobre)
//
//   achado  detectado       → a fonte mostrou que EXISTE (ex.: rio na propriedade, sobreposição com TI)
//           nao_detectado   → a fonte respondeu e não encontrou — NÃO prova ausência
//           indeterminado   → a consulta falhou ou não cobre
//
// Chaves de verificação conhecidas ficam em CHAVES_VERIFICACAO para a UI e o site público.

export type EstadoConfianca = "confirmado" | "indicado" | "sem_dado";
export type Achado = "detectado" | "nao_detectado" | "indeterminado";
export type OrigemConfirmacao = "vendedor" | "documento" | "visita";

export interface Verificacao {
  chave: string;
  rotulo: string;
  estado: EstadoConfianca;
  achado: Achado;
  /** Valor legível/serializável (número, texto, objeto pequeno). */
  valor: unknown;
  unidade?: string;
  fonte: string;
  /** ISO — quando a fonte foi consultada (ou quando a confirmação foi feita). */
  consultadoEm: string;
  confirmadoPor?: OrigemConfirmacao;
  observacao?: string;
}

export const CHAVES_VERIFICACAO: Record<string, { rotulo: string; validadeDias: number }> = {
  sobreposicao_ti: { rotulo: "Terra indígena", validadeDias: 180 },
  sobreposicao_quilombola: { rotulo: "Território quilombola", validadeDias: 180 },
  sobreposicao_uc: { rotulo: "Unidade de conservação", validadeDias: 180 },
  sobreposicao_assentamento: { rotulo: "Assentamento", validadeDias: 180 },
  alertas_desmatamento: { rotulo: "Alertas de desmatamento", validadeDias: 30 },
  uso_solo: { rotulo: "Uso do solo (MapBiomas)", validadeDias: 365 },
  ndvi: { rotulo: "Vigor da vegetação (NDVI)", validadeDias: 45 },
  logistica_rodovia: { rotulo: "Rodovia mais próxima", validadeDias: 365 },
  logistica_ferrovia: { rotulo: "Ferrovia mais próxima", validadeDias: 365 },
  app_estimada: { rotulo: "APP mínima estimada", validadeDias: 365 },
};

export function idadeEmDias(consultadoEm: string, agora: Date = new Date()): number {
  const t = Date.parse(consultadoEm);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((agora.getTime() - t) / 86400000));
}

/** Verificação automática vencida (mais antiga que a validade da chave) deve ser refeita antes de ser mostrada como atual. */
export function estaVencida(v: Pick<Verificacao, "chave" | "consultadoEm" | "estado">, agora: Date = new Date()): boolean {
  if (v.estado === "confirmado") return false; // confirmação humana não vence sozinha (pode ser revisada)
  const validade = CHAVES_VERIFICACAO[v.chave]?.validadeDias ?? 180;
  return idadeEmDias(v.consultadoEm, agora) > validade;
}

/** Monta uma verificação automática. Nunca devolve "confirmado". */
export function verificacaoAutomatica(p: {
  chave: string;
  achado: Achado;
  valor?: unknown;
  unidade?: string;
  fonte: string;
  consultadoEm?: string;
  observacao?: string;
}): Verificacao {
  const meta = CHAVES_VERIFICACAO[p.chave];
  return {
    chave: p.chave,
    rotulo: meta?.rotulo ?? p.chave,
    // indeterminado = a fonte não respondeu → "sem dado"; detectado/nao_detectado = a fonte respondeu → "indicado".
    estado: p.achado === "indeterminado" ? "sem_dado" : "indicado",
    achado: p.achado,
    valor: p.achado === "indeterminado" ? null : (p.valor ?? null),
    unidade: p.unidade,
    fonte: p.fonte,
    consultadoEm: p.consultadoEm ?? new Date().toISOString(),
    observacao: p.achado === "nao_detectado"
      ? [p.observacao, "Não detectado na fonte consultada — não confirma ausência."].filter(Boolean).join(" ")
      : p.observacao,
  };
}

/** Confirmação humana: sobrepõe a automática. Exige origem. */
export function confirmarVerificacao(base: Verificacao | null, p: {
  chave: string;
  achado: Achado;
  valor?: unknown;
  confirmadoPor: OrigemConfirmacao;
  observacao?: string;
  quando?: string;
}): Verificacao {
  if (!["vendedor", "documento", "visita"].includes(p.confirmadoPor)) {
    throw new Error("confirmadoPor deve ser vendedor, documento ou visita");
  }
  if (p.achado === "indeterminado") throw new Error("confirmação precisa de um achado (detectado/nao_detectado)");
  const meta = CHAVES_VERIFICACAO[p.chave];
  return {
    chave: p.chave,
    rotulo: base?.rotulo ?? meta?.rotulo ?? p.chave,
    estado: "confirmado",
    achado: p.achado,
    valor: p.valor ?? base?.valor ?? null,
    unidade: base?.unidade,
    fonte: `Confirmado por ${p.confirmadoPor}`,
    consultadoEm: p.quando ?? new Date().toISOString(),
    confirmadoPor: p.confirmadoPor,
    observacao: p.observacao,
  };
}

/** Entre a verificação já existente e uma nova automática, quem vale? Confirmação humana não é sobrescrita por automática. */
export function escolherVigente(atual: Verificacao | null, nova: Verificacao): Verificacao {
  if (!atual) return nova;
  if (atual.estado === "confirmado" && nova.estado !== "confirmado") return atual;
  return nova;
}

/** Rótulo curto para exibição (UI/ site): deixa claro o que é fato e o que é indício. */
export function rotuloEstado(v: Pick<Verificacao, "estado" | "achado" | "confirmadoPor">): string {
  if (v.estado === "confirmado") return `Confirmado (${v.confirmadoPor ?? "humano"})`;
  if (v.estado === "sem_dado") return "Sem dado";
  return v.achado === "detectado" ? "Indicado por fonte" : "Não detectado na fonte";
}

/**
 * Projeção segura para vitrine pública: só o que é positivo e não revela localização.
 * Nunca expõe CAR, município, coordenadas ou nomes de áreas (ex.: nome da TI/UC).
 * Sobreposições e embargos nunca vão para a vitrine (tratadas só com o intermediário).
 */
const PUBLICAVEIS = new Set(["uso_solo", "ndvi", "logistica_rodovia", "logistica_ferrovia"]);
export function projecaoPublica(vs: Verificacao[]): Array<{ chave: string; rotulo: string; estado: EstadoConfianca; texto: string }> {
  const out: Array<{ chave: string; rotulo: string; estado: EstadoConfianca; texto: string }> = [];
  for (const v of vs) {
    if (!PUBLICAVEIS.has(v.chave) || v.estado === "sem_dado" || v.achado !== "detectado") continue;
    let texto = "";
    if (v.chave === "logistica_rodovia" || v.chave === "logistica_ferrovia") {
      const km = typeof v.valor === "number" ? v.valor / 1000 : null;
      if (km === null) continue;
      // faixa, nunca o número exato
      texto = km <= 5 ? "até 5 km" : km <= 15 ? "de 5 a 15 km" : km <= 30 ? "de 15 a 30 km" : "acima de 30 km";
    } else if (v.chave === "ndvi") {
      const n = typeof v.valor === "number" ? v.valor : null;
      if (n === null) continue;
      texto = n >= 0.6 ? "vegetação vigorosa" : n >= 0.4 ? "vegetação moderada" : n >= 0.2 ? "vegetação esparsa" : "pouca cobertura vegetal";
    } else if (v.chave === "uso_solo" && v.valor && typeof v.valor === "object" && typeof (v.valor as any).descricao === "string") {
      texto = (v.valor as any).descricao; // já em faixas de 5%
    } else if (typeof v.valor === "string") {
      texto = v.valor;
    } else continue;
    out.push({ chave: v.chave, rotulo: v.rotulo, estado: v.estado, texto });
  }
  return out;
}
