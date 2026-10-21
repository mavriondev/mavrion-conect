/**
 * Helpers de determinismo e validação das seções de IA do relatório.
 *
 * - hashInsumos: hash estável dos dados de entrada de uma análise de IA.
 *   As análises são cacheadas por esse hash (não por TTL): mesmo insumo ⇒
 *   mesma análise; insumo mudou ⇒ regenerar.
 * - secaoDataAtual: bloco de prompt com a data atual e instrução de validar
 *   aritmética de prazos (fim do "prorrogação de 26/11/2025 garantindo
 *   continuidade até 2025").
 * - validarContatosDeepIntel: valida telefones (DDD × UF da sede, formato
 *   celular BR com 9 dígitos); mismatch rebaixa a confiança e anexa aviso.
 *
 * (Nenhum score de confiança sobre conclusões é calculado ou exibido aqui —
 * o único indicador numérico do relatório é o score de completude do dossiê,
 * em lacunas-dossie.ts, com fórmula e componentes visíveis.)
 */
import { createHash } from "crypto";

export function hashInsumos(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Bloco de prompt com a data atual e a fonte única para vigência de alvará. */
export function secaoDataAtual(now: Date = new Date()): string {
  const dataAtual = now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const anoAtual = now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric" });
  return `DATA ATUAL: ${dataAtual} (ano corrente: ${anoAtual}).
REGRAS DE DATAS E PRAZOS (obrigatórias):
- Para vigência, validade ou vencimento de alvará/título minerário, NUNCA faça aritmética a partir dos eventos. Use exclusivamente o bloco VIGÊNCIA CANÔNICA calculado pelo sistema.
- Eventos brutos de vigência não são fornecidos ao modelo. Se VIGÊNCIA CANÔNICA estiver indeterminada ou ausente, diga que o prazo final é indeterminado; não estime.
- Para outros prazos não minerários, valide a aritmética explicitamente a partir das datas estruturadas e da data atual acima.
- Nunca descreva um evento futuro como passado (nem o contrário); compare cada data com a data atual antes de classificá-la.
- Se a duração de um prazo não constar dos dados, diga que o prazo final é indeterminado em vez de inventar um ano.`;
}

/**
 * Seções do contexto do deep intel derivadas de SAÍDAS de IA anteriores
 * (gravadas pela própria rota após cada análise). Elas entram no prompt como
 * contexto, mas NÃO podem entrar no hash do cache — senão cada execução
 * regrava esses campos (com timestamps novos) e invalida o próprio cache.
 */
export const SECOES_DERIVADAS_DEEP_INTEL = ["ANÁLISE IA ANTERIOR", "ENRIQUECIMENTO IA ANTERIOR"];

/** Insumo canônico do deep intel: só as seções de dados reais, sem as derivadas. */
export function insumosCanonicosDeepIntel(sections: string[]): string {
  return sections
    .filter((s) => !SECOES_DERIVADAS_DEEP_INTEL.some((p) => s.startsWith(p)))
    .join("\n\n");
}

// ── Validação de telefones (DDD × UF, formato BR) ──────────────

/** Mapa DDD → UF (Anatel). */
export const DDD_UF: Record<string, string> = {
  "11": "SP", "12": "SP", "13": "SP", "14": "SP", "15": "SP", "16": "SP", "17": "SP", "18": "SP", "19": "SP",
  "21": "RJ", "22": "RJ", "24": "RJ",
  "27": "ES", "28": "ES",
  "31": "MG", "32": "MG", "33": "MG", "34": "MG", "35": "MG", "37": "MG", "38": "MG",
  "41": "PR", "42": "PR", "43": "PR", "44": "PR", "45": "PR", "46": "PR",
  "47": "SC", "48": "SC", "49": "SC",
  "51": "RS", "53": "RS", "54": "RS", "55": "RS",
  "61": "DF", "62": "GO", "64": "GO", "63": "TO",
  "65": "MT", "66": "MT", "67": "MS",
  "68": "AC", "69": "RO",
  "71": "BA", "73": "BA", "74": "BA", "75": "BA", "77": "BA",
  "79": "SE",
  "81": "PE", "87": "PE",
  "82": "AL", "83": "PB", "84": "RN",
  "85": "CE", "88": "CE",
  "86": "PI", "89": "PI",
  "91": "PA", "93": "PA", "94": "PA",
  "92": "AM", "97": "AM",
  "95": "RR", "96": "AP", "98": "MA", "99": "MA",
};

export interface TelefoneValidacao {
  valido: boolean;
  ddd: string | null;
  ufDoDdd: string | null;
  mismatchUf: boolean;
  e164: string | null;
  motivo: string | null;
}

/**
 * Valida um telefone brasileiro: extrai DDD, checa formato (celular = 9
 * dígitos começando em 9; fixo = 8 dígitos) e compara a UF do DDD com a UF
 * da sede do ativo (quando conhecida).
 */
export function validarTelefoneBR(valor: string, ufSede?: string | null): TelefoneValidacao {
  const digits = String(valor || "").replace(/\D/g, "").replace(/^0+/, "");
  // remove código do país se presente
  const local = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length !== 10 && local.length !== 11) {
    return { valido: false, ddd: null, ufDoDdd: null, mismatchUf: false, e164: null, motivo: "quantidade de dígitos inválida para telefone BR" };
  }
  const ddd = local.slice(0, 2);
  const numero = local.slice(2);
  const ufDoDdd = DDD_UF[ddd] || null;
  if (!ufDoDdd) {
    return { valido: false, ddd, ufDoDdd: null, mismatchUf: false, e164: null, motivo: `DDD ${ddd} inexistente` };
  }
  if (numero.length === 9 && numero[0] !== "9") {
    return { valido: false, ddd, ufDoDdd, mismatchUf: false, e164: null, motivo: "celular BR deve ter 9 dígitos iniciando em 9" };
  }
  const mismatchUf = !!ufSede && ufDoDdd !== String(ufSede).toUpperCase().trim();
  return {
    valido: true,
    ddd,
    ufDoDdd,
    mismatchUf,
    e164: `+55${local}`,
    motivo: mismatchUf ? `DDD ${ddd} pertence a ${ufDoDdd}, mas a sede do ativo é ${String(ufSede).toUpperCase().trim()}` : null,
  };
}

export const AVISO_CONTATO_DESATUALIZADO =
  "dado não confirmado na fonte oficial — confirmar por via independente";

const ORDEM_CONFIANCA: Record<string, number> = { alta: 3, media: 2, baixa: 1 };

function rebaixar(confianca: string): string {
  const nivel = ORDEM_CONFIANCA[confianca] || 1;
  return nivel >= 3 ? "media" : "baixa";
}

/**
 * Valida os contatos retornados pelo deep intel. Telefones com formato
 * inválido ou DDD divergente da UF da sede têm a confiança rebaixada e
 * recebem o aviso padrão em `aviso`.
 */
export function validarContatosDeepIntel<T extends { tipo: string; valor: string; confianca: string; aviso?: string }>(
  contatos: T[],
  ufSede?: string | null,
): T[] {
  return (contatos || []).map((c) => {
    const ehTelefone = /telefone|whatsapp|celular|fone/i.test(c.tipo || "");
    if (!ehTelefone) return c;
    const v = validarTelefoneBR(c.valor, ufSede);
    if (v.valido && !v.mismatchUf) {
      return { ...c, valor: c.valor, e164: v.e164 } as T;
    }
    return {
      ...c,
      confianca: rebaixar(c.confianca),
      aviso: `⚠️ ${v.motivo || "telefone não validado"} — ${AVISO_CONTATO_DESATUALIZADO}`,
    } as T;
  });
}

// (O score de confiança determinístico da investigação foi removido:
// nenhum score de confiança sobre conclusões aparece em nenhuma saída —
// o único indicador numérico do produto é o score de completude do dossiê,
// calculado em lacunas-dossie.ts com fórmula e componentes visíveis.)

// (A Due Diligence de IA foi removida do produto a pedido do usuário — o bug
// do "Índice de Prontidão 0%" morreu junto com a seção; dados antigos
// iaDueDiligence em camposEspecificos são inertes e nada mais os lê.)
