/**
 * Disciplina de certeza — camada de enunciados classificados.
 *
 * Todo enunciado sintetizado nasce classificado:
 * - FATO: lido diretamente de uma fonte, com fonte + data da consulta +
 *   identificador de vínculo (nº do processo, CNPJ, código de parcela…).
 * - DERIVADO: calculado por regra determinística exibível, com os insumos.
 * - HIPOTESE: conjectura — só existe em seção própria rotulada.
 *
 * Regras de publicação (destinoEnunciado):
 * - corpo   = FATO/DERIVADO de fonte T1-T2;
 * - anexo   = material T3 (agregadores comerciais);
 * - hipoteses = HIPOTESE (qualquer tier) ou T4 (inferência de modelo /
 *   busca web sem verificação em fonte oficial).
 * Enunciado que não se enquadra em nenhum destino não é publicado.
 *
 * O passo adversarial (passoAdversarial) roda APÓS a montagem do texto e a
 * sua única operação é REMOVER — nunca reescrever nem suavizar. Cada remoção
 * fica registrada para exibição na seção de limitações.
 */

export type CategoriaEnunciado = "FATO" | "DERIVADO" | "HIPOTESE";
/** T1-T3 herdados da camada de dados (consulta-contrato); T4 só existe aqui:
 *  inferência de modelo / busca web sem verificação em fonte oficial. */
export type TierEnunciado = "T1" | "T2" | "T3" | "T4";
export type DestinoEnunciado = "corpo" | "anexo" | "hipoteses";

export interface Enunciado {
  categoria: CategoriaEnunciado;
  tier: TierEnunciado;
  texto: string;
  /** Nome da base consultada (nunca vago tipo "busca web"). */
  fonte: string | null;
  /** Data da consulta à fonte (ISO ou dd/mm/aaaa). */
  dataConsulta: string | null;
  /** Identificador de vínculo: nº do processo, CNPJ, código de parcela… */
  identificador: string | null;
  /** Obrigatória para DERIVADO: regra determinística exibível. */
  regra?: string | null;
  /** Insumos da regra (para DERIVADO). */
  insumos?: string[];
  /** Campo de origem no relatório (sintese/prioridade/risco/encaminhamento). */
  origem?: string;
  /** Para DERIVADO selecionado pela IA: ID do template determinístico usado. */
  templateId?: string;
  /** IDs dos fatos-âncora usados para remontar e conferir o template. */
  fatosIds?: string[];
}

/** Regras de publicação por categoria/tier. Retorna null quando o enunciado
 *  não se enquadra em nenhum destino (⇒ não é publicado). */
export function destinoEnunciado(e: Pick<Enunciado, "categoria" | "tier">): DestinoEnunciado | null {
  if (e.categoria === "HIPOTESE") return "hipoteses";
  if (e.tier === "T4") return "hipoteses";
  if (e.tier === "T3") return "anexo";
  if (e.categoria === "FATO" || e.categoria === "DERIVADO") return "corpo";
  return null;
}

// ── Vocabulário proibido ────────────────────────────────────────

/** Lista canônica (para exibição em prompts e mensagens). */
export const VOCABULARIO_PROIBIDO: string[] = [
  "possivelmente", "provavelmente", "aparentemente", "sugere-se",
  "pode indicar", "tudo indica", "não se descarta", "estima-se",
  "acredita-se", "é razoável supor", "em tese", "a princípio",
  "tende a", "costuma", "geralmente", "via de regra", "espera-se",
];

/** Normaliza para comparação: minúsculas + sem acentos. */
export function normalizarTexto(texto: string): string {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Padrões sobre o texto normalizado (sem acento, minúsculas), com fronteira
// de palavra e variantes de flexão (plural/imperfeito) para não escapar por
// conjugação ("costumam", "tendem a", "estimam-se").
const PADROES_PROIBIDOS: Array<{ termo: string; re: RegExp }> = [
  { termo: "possivelmente", re: /\bpossivelmente\b/ },
  { termo: "provavelmente", re: /\bprovavelmente\b/ },
  { termo: "aparentemente", re: /\baparentemente\b/ },
  { termo: "sugere-se", re: /\bsugere(m)?[-\s]se\b/ },
  { termo: "pode indicar", re: /\bpode(m|ria|riam)?\s+indicar\b/ },
  { termo: "tudo indica", re: /\btudo\s+indica\b/ },
  { termo: "não se descarta", re: /\bnao\s+se\s+descarta(m)?\b/ },
  { termo: "estima-se", re: /\bestima(m)?[-\s]se\b/ },
  { termo: "acredita-se", re: /\bacredita(m)?[-\s]se\b/ },
  { termo: "é razoável supor", re: /\brazoavel\s+supor\b/ },
  { termo: "em tese", re: /\bem\s+tese\b/ },
  { termo: "a princípio", re: /\ba\s+principio\b/ },
  { termo: "tende a", re: /\btende(m|ria|riam)?\s+a\b/ },
  { termo: "costuma", re: /\bcostuma(m|va|vam)?\b/ },
  { termo: "geralmente", re: /\bgeralmente\b/ },
  { termo: "via de regra", re: /\bvia\s+de\s+regra\b/ },
  { termo: "espera-se", re: /\bespera(m)?[-\s]se\b/ },
];

/** Detecta termos do vocabulário proibido (case/acento-insensível, com
 *  fronteiras de palavra). Retorna a lista de termos encontrados. */
export function detectarVocabularioProibido(texto: string): string[] {
  const norm = normalizarTexto(texto);
  const achados: string[] = [];
  for (const { termo, re } of PADROES_PROIBIDOS) {
    if (re.test(norm)) achados.push(termo);
  }
  return achados;
}

// ── Passo adversarial (só remove, nunca reescreve) ──────────────

/** Fontes vagas demais para conferência em menos de um minuto. */
export const FONTES_VAGAS: string[] = [
  "busca web", "busca na web", "web", "internet", "google", "pesquisa",
  "pesquisa web", "fontes diversas", "diversas fontes", "varias fontes",
  "n/d", "nd", "desconhecida", "",
];

export function fonteVaga(fonte: string | null | undefined): boolean {
  const f = normalizarTexto(fonte || "").trim();
  return FONTES_VAGAS.includes(f);
}

/** Checagem de contradição com um campo estruturado: `padrao` é aplicado ao
 *  texto normalizado (minúsculas, sem acento); match ⇒ o texto afirma o
 *  oposto do que o dado estruturado registra. */
export interface ChecagemContradicao {
  descricao: string;
  padrao: RegExp;
}

export interface RemocaoAdversarial {
  texto: string;
  origem?: string;
  motivo: string;
}

/**
 * Passo adversarial pós-montagem. Única operação: REMOVER (nunca reescrever
 * ou suavizar). Para cada frase, na ordem:
 * 1. Tem fonte e data da consulta?
 * 2. Está vinculada por identificador (ou, se DERIVADO, tem insumos)?
 * 3. Contradiz algum campo estruturado?
 * 4. Contém vocabulário proibido?
 * 5. É conferível contra a fonte em menos de um minuto? (fonte não vaga,
 *    destino corpo = FATO/DERIVADO T1-T2; DERIVADO exige regra exibível)
 * Cada remoção é registrada com o motivo, para a seção de limitações.
 */
export function passoAdversarial(
  frases: Enunciado[],
  contradicoes: ChecagemContradicao[] = [],
): { mantidas: Enunciado[]; remocoes: RemocaoAdversarial[] } {
  const mantidas: Enunciado[] = [];
  const remocoes: RemocaoAdversarial[] = [];
  for (const f of frases) {
    const remover = (motivo: string) => remocoes.push({ texto: f.texto, origem: f.origem, motivo });

    // 1. fonte e data
    if (!f.fonte || !String(f.fonte).trim() || !f.dataConsulta || !String(f.dataConsulta).trim()) {
      remover("sem fonte e/ou data da consulta");
      continue;
    }
    // 2. identificador de vínculo (DERIVADO pode se ancorar nos insumos)
    const temIdentificador = !!(f.identificador && String(f.identificador).trim());
    const temInsumos = f.categoria === "DERIVADO" && Array.isArray(f.insumos) && f.insumos.length > 0;
    if (!temIdentificador && !temInsumos) {
      remover("sem identificador de vínculo com a fonte");
      continue;
    }
    // 3. contradição com campo estruturado
    const norm = normalizarTexto(f.texto);
    const contra = contradicoes.find((c) => c.padrao.test(norm));
    if (contra) {
      remover(`contradiz dado estruturado: ${contra.descricao}`);
      continue;
    }
    // 4. vocabulário proibido
    const termos = detectarVocabularioProibido(f.texto);
    if (termos.length > 0) {
      remover(`vocabulário proibido: ${termos.join(", ")}`);
      continue;
    }
    // 5. conferível em <1 minuto: fonte específica + destino corpo
    if (fonteVaga(f.fonte)) {
      remover(`fonte vaga ("${f.fonte}") — não conferível em menos de um minuto`);
      continue;
    }
    if (f.categoria === "DERIVADO" && (!f.regra || !String(f.regra).trim())) {
      remover("DERIVADO sem regra determinística exibível");
      continue;
    }
    if (destinoEnunciado(f) !== "corpo") {
      remover(`não publicável no corpo (categoria ${f.categoria}, tier ${f.tier})`);
      continue;
    }
    mantidas.push(f);
  }
  return { mantidas, remocoes };
}

// ── Detector de conflitos entre campos estruturados ─────────────

export interface ValorComFonte {
  valor: any;
  fonte: string;
}

export interface GrandezaComparavel {
  grandeza: string;
  tipo: "numero" | "texto";
  /** Tolerância percentual para números (default 2%). */
  toleranciaPct?: number;
  valores: ValorComFonte[];
}

export interface ConflitoDetectado {
  grandeza: string;
  valores: Array<{ valor: string; fonte: string }>;
  descricao: string;
}

function parseNumero(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/\./g, "").replace(",", ".").replace(/[^\d.\-]/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function normalizarValorTexto(v: any): string {
  return normalizarTexto(String(v ?? ""))
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Compara pares/trios de campos que descrevem a MESMA grandeza vinda de
 * fontes diferentes (ex.: área SCM vs SIGMINE vs cadastro; titular SCM vs
 * SIGMINE). Divergência ⇒ conflito com AMBOS os valores exibidos e marcação
 * de revisão humana — o sistema nunca escolhe um dos lados.
 */
export function detectarConflitos(grandezas: GrandezaComparavel[]): ConflitoDetectado[] {
  const conflitos: ConflitoDetectado[] = [];
  for (const g of grandezas) {
    const presentes = (g.valores || []).filter(
      (v) => v.valor !== null && v.valor !== undefined && String(v.valor).trim() !== "",
    );
    if (presentes.length < 2) continue;

    if (g.tipo === "numero") {
      const nums = presentes
        .map((v) => ({ n: parseNumero(v.valor), fonte: v.fonte, bruto: v.valor }))
        .filter((x) => x.n !== null) as Array<{ n: number; fonte: string; bruto: any }>;
      if (nums.length < 2) continue;
      const max = Math.max(...nums.map((x) => x.n));
      const min = Math.min(...nums.map((x) => x.n));
      const tol = (g.toleranciaPct ?? 2) / 100;
      const base = Math.max(Math.abs(max), 1e-9);
      if ((max - min) / base > tol) {
        conflitos.push({
          grandeza: g.grandeza,
          valores: nums.map((x) => ({ valor: String(x.bruto), fonte: x.fonte })),
          descricao: `Valores divergentes para "${g.grandeza}" entre fontes (diferença acima de ${g.toleranciaPct ?? 2}%).`,
        });
      }
    } else {
      // Dois valores textuais só conflitam quando nenhum contém o outro
      // (após normalização) — "AREIA" vs "AREIA INDUSTRIAL" não é conflito;
      // "EMPRESA A LTDA" vs "EMPRESA B SA" é.
      const chaves = presentes
        .map((v) => ({ v, chave: normalizarValorTexto(v.valor) }))
        .filter((x) => x.chave);
      let haConflito = false;
      for (let i = 0; i < chaves.length && !haConflito; i++) {
        for (let j = i + 1; j < chaves.length && !haConflito; j++) {
          const a = chaves[i].chave, b = chaves[j].chave;
          if (!a.includes(b) && !b.includes(a)) haConflito = true;
        }
      }
      if (haConflito) {
        conflitos.push({
          grandeza: g.grandeza,
          valores: presentes.map((v) => ({ valor: String(v.valor), fonte: v.fonte })),
          descricao: `Registros divergentes para "${g.grandeza}" entre fontes.`,
        });
      }
    }
  }
  return conflitos;
}
