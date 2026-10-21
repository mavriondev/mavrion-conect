/**
 * Helpers puros de vinculação de dados do relatório do ativo minerário.
 *
 * Corrigem os bugs de vinculação do relatório:
 * - TAH casada pelo número COMPLETO do processo (número + ano), nunca só o
 *   número-base — números-base são reutilizados entre anos por processos
 *   distintos (ex.: 832070/2024 vs 832070/1989).
 * - Histórico de eventos: só eventos reais (com data ou descrição), nunca o
 *   próprio número do processo renderizado como "evento".
 * - Tabela "ANM — Dados do Processo Minerário": fallback campo a campo
 *   (cadastro → SIGMINE ao vivo → SCM/cache) com origem e timestamp.
 * - Quadro completo de camadas de restrição: todas as camadas sempre
 *   listadas, com status "não consultada" quando a fonte falhou/faltou.
 */

import { derivarMetaModulo, type MetaConsulta } from "./consulta-contrato";

/** Extrai número-base e ano de um processo em qualquer formato ("832.070/2024", "832070/2024", "832070"). */
export function parseProcessoNumeroAno(processo: string | null | undefined): { numero: string | null; ano: number | null } {
  const clean = String(processo || "").replace(/\s/g, "").replace(/\./g, "");
  const m = clean.match(/^0*(\d{1,6})(?:\/(\d{4}))?$/);
  if (!m) return { numero: null, ano: null };
  return { numero: m[1], ano: m[2] ? parseInt(m[2], 10) : null };
}

export interface TahVinculo {
  rows: any[];
  /** true quando o vínculo não pôde ser feito pelo número completo (número+ano) */
  ambiguo: boolean;
  motivo?: string;
}

/**
 * Filtra registros de TAH para o processo exato. `anmTah` aceita o formato
 * legado (array de linhas) ou o novo ({ registros, ambiguo }).
 * Nos dados abertos da ANM, a coluna NRAnoProcesso (persistida em anoBase) é o
 * ANO DO PROCESSO — linhas com outro ano pertencem a processos distintos que
 * reutilizaram o número-base.
 */
export function filtrarTahPorProcesso(anmTah: any, processo: string | null | undefined): TahVinculo {
  const rawRows: any[] = Array.isArray(anmTah) ? anmTah
    : Array.isArray(anmTah?.registros) ? anmTah.registros
    : Array.isArray(anmTah?.rows) ? anmTah.rows : [];
  if (rawRows.length === 0) return { rows: [], ambiguo: false };
  if (anmTah && !Array.isArray(anmTah) && anmTah.ambiguo === true) {
    return { rows: rawRows, ambiguo: true, motivo: "consulta feita só pelo número-base do processo" };
  }
  const { ano } = parseProcessoNumeroAno(processo);
  if (!ano) {
    return { rows: rawRows, ambiguo: true, motivo: "ano do processo desconhecido — histórico por número-base pode incluir processos distintos" };
  }
  const rows = rawRows.filter((r: any) => {
    const rAno = Number(r.anoBase ?? r.ano_base);
    return Number.isFinite(rAno) && rAno === ano;
  });
  return { rows, ambiguo: false };
}

/** Um evento é "real" se tem descrição significativa (não é só o número do processo) e, idealmente, data. */
export function filtrarEventosReais(eventos: any[] | null | undefined, processo: string | null | undefined): any[] {
  if (!Array.isArray(eventos)) return [];
  const { numero, ano } = parseProcessoNumeroAno(processo);
  return eventos.filter((e: any) => {
    const desc = String(e?.descricao || "").trim();
    if (!desc && !e?.data) return false;
    // descarta "evento" que é apenas o número do processo (com/sem pontos, com/sem ano)
    const normalized = desc.replace(/[.\s]/g, "").replace(/^0+/, "");
    if (numero) {
      if (normalized === numero || normalized === `${numero}/${ano ?? ""}`.replace(/\/$/, "")) return false;
      if (ano && normalized === `${numero}/${ano}`) return false;
    }
    // sem letras e sem data = não é um evento descritivo
    const temLetras = /[a-zA-ZÀ-ú]/.test(desc);
    if (!temLetras && !e?.data) return false;
    return true;
  });
}

export interface CampoComOrigem {
  label: string;
  valor: string;
  fonte: string | null;
}

/**
 * Monta os campos da tabela "ANM — Dados do Processo Minerário" com fallback
 * campo a campo: cadastro do ativo → SIGMINE ao vivo → consulta SCM (cache).
 * Campos sem valor em NENHUMA fonte são omitidos (nunca renderizar "—" quando
 * o dado existe em outra seção do mesmo relatório).
 */
export function buildProcessoAnmCampos(a: any, c: any, scm: any | null): CampoComOrigem[] {
  const live = c?.anmLiveData || {};
  const liveEm = c?.anmLiveDataUpdatedAt || null;
  const scmEm = scm?.consultadoEm || null;
  const fmtBr = (v: any) => { try { const d = new Date(v); return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("pt-BR"); } catch { return String(v); } };
  const F_CAD = "cadastro do ativo";
  const F_LIVE = liveEm ? `SIGMINE (consultado ao vivo em ${fmtBr(liveEm)})` : "SIGMINE (ao vivo)";
  const F_SCM = scmEm ? `SCM/ANM (cache de ${fmtBr(scmEm)})` : "SCM/ANM (cache)";

  const pick = (...srcs: Array<[any, string | null]>): { valor: any; fonte: string | null } | null => {
    for (const [v, fonte] of srcs) {
      if (v !== null && v !== undefined && v !== "") return { valor: v, fonte };
    }
    return null;
  };

  const liveFeature = Array.isArray(live?.features) ? (live.features[0]?.attributes || live.features[0] || {}) : live;

  const defs: Array<[string, ReturnType<typeof pick>]> = [
    ["Nº do processo", pick([c?.processoAnm, null], [a?.anmProcesso, null])],
    ["Substância", pick([c?.substancia, F_CAD], [liveFeature?.SUBS, F_LIVE])],
    ["Fase", pick([c?.faseAnm, F_CAD], [liveFeature?.FASE, F_LIVE], [scm?.fase, F_SCM])],
    ["Situação", pick([c?.situacaoAnm, F_CAD], [scm?.statusAtivo === true ? "Ativo" : scm?.statusAtivo === false ? "Inativo" : null, F_SCM])],
    ["Validade", pick([c?.validadeAnm, F_CAD])],
    ["UF", pick([liveFeature?.UF, F_LIVE], [scm?.uf, F_SCM], [a?.estado, F_CAD])],
    ["Área (ha)", pick([liveFeature?.AREA_HA, F_LIVE], [scm?.areaHa, F_SCM], [a?.areaHa, F_CAD])],
    ["Uso", pick([liveFeature?.USO, F_LIVE])],
    ["Titular", pick([liveFeature?.NOME, F_LIVE], [scm?.titularNome, F_SCM])],
    ["Último evento", pick([c?.ultimoEventoAnm, F_CAD], [liveFeature?.ULT_EVENTO, F_LIVE])],
    ["NUP", pick([scm?.nup, F_SCM])],
    ["Data do protocolo", pick([scm?.dataProtocolo, F_SCM])],
  ];

  return defs
    .filter(([, p]) => p !== null)
    .map(([label, p]) => ({ label, valor: String(p!.valor), fonte: p!.fonte }));
}

export const CAMADAS_RESTRICAO: Array<{ key: string; label: string }> = [
  { key: "funai", label: "Terras indígenas (FUNAI)" },
  { key: "unidadesConservacao", label: "Unidades de Conservação (CNUC/MMA)" },
  { key: "embargos", label: "Embargos ambientais (ICMBio)" },
  { key: "cavernas", label: "Cavernas (CANIE/CECAV)" },
  { key: "quilombolas", label: "Territórios quilombolas (IBGE/INCRA)" },
  { key: "assentamentos", label: "Assentamentos (IBGE)" },
];

export interface LinhaCamada {
  key: string;
  label: string;
  consultada: boolean;
  status: string;
  destaque: string;
}

export interface QuadroCamadas {
  linhas: LinhaCamada[];
  consultadas: string[];
  falhadas: string[];
  semaforo: "vermelho" | "amarelo" | "verde" | null;
  raioKm: number | null;
}

/**
 * Quadro unificado das camadas de restrição (FUNAI + cruzamento multi-fonte).
 * TODAS as camadas sempre aparecem — camada ausente/falhada vira "camada não
 * consultada" e impede o semáforo verde (nunca somem do relatório).
 */
export function montarQuadroCamadas(c: any): QuadroCamadas {
  const restr = c?.anmRestricoes || null;
  const camadas = restr?.camadas || {};
  const funai = c?.anmFunai || null;
  const terrasRaw = c?.anmFunaiTerras || null;

  const linhas: LinhaCamada[] = [];

  // FUNAI
  {
    const consultada = !!(funai || terrasRaw);
    let status = "Camada não consultada";
    let destaque = "";
    if (consultada) {
      const sobrepoe = funai?.sobreposicao ?? funai?.overlap ?? funai?.dentro;
      const terras = Array.isArray(terrasRaw?.data) ? terrasRaw.data : Array.isArray(terrasRaw) ? terrasRaw : [];
      const total = (terrasRaw && !Array.isArray(terrasRaw) && terrasRaw.total != null) ? terrasRaw.total : terras.length;
      status = sobrepoe === true ? "SOBREPOSIÇÃO DIRETA"
        : total > 0 ? `${total} ocorrência(s) no raio`
        : sobrepoe === false ? "Sem ocorrências" : "Consultada";
      destaque = terras.slice(0, 3).map((t: any) =>
        [t.terrai_nome || t.nome, t.distancia_km != null ? `~${t.distancia_km} km` : ""].filter(Boolean).join(" — ")).join("; ");
    }
    linhas.push({ key: "funai", label: CAMADAS_RESTRICAO[0].label, consultada, status, destaque });
  }

  for (const { key, label } of CAMADAS_RESTRICAO.slice(1)) {
    const cam = camadas[key];
    const consultada = !!cam?.consultado;
    let status = "Camada não consultada";
    let destaque = "";
    if (cam && consultada) {
      status = cam.sobreposicao === true ? "SOBREPOSIÇÃO DIRETA"
        : cam.total > 0 ? `${cam.total} ocorrência(s) no raio` : "Sem ocorrências";
      destaque = (cam.sobreposicoes?.length ? cam.sobreposicoes : cam.ocorrencias || [])
        .slice(0, 3).map((o: any) => [o.nome, o.distancia_km != null ? `~${o.distancia_km} km` : ""].filter(Boolean).join(" — ")).join("; ");
    }
    linhas.push({ key, label, consultada, status, destaque });
  }

  const consultadas = linhas.filter(l => l.consultada).map(l => l.label);
  const falhadas = linhas.filter(l => !l.consultada).map(l => l.label);

  // Semáforo integrado: sobreposição direta = vermelho; qualquer camada não
  // consultada ou ocorrência próxima = no mínimo amarelo.
  let semaforo: QuadroCamadas["semaforo"] = null;
  if (linhas.some(l => l.status === "SOBREPOSIÇÃO DIRETA")) semaforo = "vermelho";
  else if (falhadas.length > 0 || linhas.some(l => /ocorrência\(s\)/.test(l.status))) semaforo = "amarelo";
  else if (consultadas.length === linhas.length) semaforo = "verde";
  if (restr?.semaforo === "vermelho") semaforo = "vermelho";

  return { linhas, consultadas, falhadas, semaforo, raioKm: restr?.raio_km ?? null };
}

// ── Sobreposição em unidades consistentes (mesma fonte em todas as tabelas) ──

/**
 * Formata sobreposição sempre na MESMA unidade dupla: "X ha (Y% do polígono)".
 * Aceita ausência parcial (dados persistidos antes do campo sobreposicaoHa)
 * sem inventar valor — nunca mostra "0 ha" para dado desconhecido.
 */
export function formatSobreposicao(ha: number | null | undefined, pct: number | null | undefined, aVerificar?: string | null): string {
  // valor reprovado na checagem de sanidade: exibe o marcador com o motivo
  if (aVerificar) return `a verificar — ${aVerificar}`;
  const fmt = (n: number) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const haOk = ha != null && Number.isFinite(Number(ha));
  const pctOk = pct != null && Number.isFinite(Number(pct));
  // guarda para dados persistidos ANTES da checagem na origem: nunca exibir
  // percentual > 100 nem valores negativos
  if ((pctOk && (Number(pct) > 100.5 || Number(pct) < 0)) || (haOk && Number(ha) < 0)) {
    return `a verificar — valor reprovado na checagem de sanidade (${haOk ? `${fmt(Number(ha))} ha` : "?"}; ${pctOk ? `${fmt(Number(pct))}%` : "?"})`;
  }
  if (haOk && pctOk) return `${fmt(Number(ha))} ha (${fmt(Number(pct))}% do polígono)`;
  if (haOk) return `${fmt(Number(ha))} ha`;
  if (pctOk) return `${fmt(Number(pct))}% do polígono`;
  return "—";
}

// ── Escopo das bases consultadas (qualifica conclusões negativas) ──────────

export interface FaixaAnos { anoMin: number | null; anoMax: number | null }
export interface EscopoBases {
  tah?: FaixaAnos | null;
  cfem?: FaixaAnos | null;
}

export function faixaAnosEscopo(faixa: FaixaAnos | null | undefined): string {
  if (faixa && faixa.anoMin != null && faixa.anoMax != null) {
    return faixa.anoMin === faixa.anoMax ? String(faixa.anoMin) : `${faixa.anoMin}–${faixa.anoMax}`;
  }
  return "período não determinado nesta geração";
}

/**
 * Nota determinística de escopo das bases — acompanha as seções TAH/CFEM/DOU
 * do PDF e entra no digest da IA para que toda conclusão negativa ("não foram
 * localizados TAH, multa ANM ou cessão") saia qualificada com base e período.
 */
export function montarNotaEscopoBases(escopo: EscopoBases | null | undefined): string {
  return `Bases consultadas: dados abertos ANM — TAH (${faixaAnosEscopo(escopo?.tah)}) e CFEM (${faixaAnosEscopo(escopo?.cfem)}) — e busca pública do DOU (Imprensa Nacional). Conclusões negativas (ausência de TAH, multa ou cessão) valem apenas dentro desse escopo.`;
}

// ── Telemetria de módulos: nenhuma fonte some do relatório em silêncio ──────

export const NOTA_HISTORICO_INDISPONIVEL =
  "Histórico de eventos ANM não disponível — o processo não consta na base local de eventos (dados abertos ANM — microdados SCM) e a consulta SCM em cache não traz o painel de eventos. Se a base de eventos ainda não foi importada, rode a importação em Admin.";

export const MODULOS_RELATORIO: Array<{ key: string; label: string }> = [
  { key: "anmTah", label: "TAH — Taxa Anual por Hectare (dados abertos ANM)" },
  { key: "anmCfem", label: "CFEM — Produção Real (dados abertos ANM)" },
  { key: "anmDou", label: "Publicações no DOU (Imprensa Nacional)" },
  { key: "anmDouMunicipal", label: "Diários Oficiais Municipais (Querido Diário)" },
  { key: "anmBarragens", label: "Barragens de Mineração (SIGBM/ANM)" },
  { key: "anmCertidoesTitular", label: "Certidões do Titular (PGFN/CNJ/CEIS)" },
  { key: "anmSei", label: "SEI — Processo Administrativo (documentos e andamentos)" },
  { key: "anmLogistica", label: "Logística — Infraestrutura Próxima" },
  { key: "anmSondagem", label: "Furos de sondagem (GeoSGB/CPRM)" },
  { key: "anmGeoquimica", label: "Geoquímica (GeoSGB/CPRM)" },
  { key: "sigefParcelas", label: "Parcelas certificadas (SIGEF/INCRA)" },
  { key: "carImoveis", label: "Imóveis CAR (SICAR)" },
];

export interface ModuloDisponibilidade {
  key: string;
  label: string;
  estado: "ok" | "indisponivel" | "nao_consultado";
  motivo: string | null;
  /**
   * Contrato de três estados + tier + vínculo derivado do payload (novo ou
   * legado) — fonte única para o renderizador e para os insumos da IA.
   */
  meta: MetaConsulta | null;
}

/**
 * Avalia a disponibilidade de cada módulo do dossiê para o relatório:
 * - payload ausente ⇒ "fonte não consultada" (o cruzamento nunca rodou);
 * - payload com disponivel === false (ou erro sem disponivel) ⇒ "indisponível
 *   nesta geração" (a consulta falhou — não significa ausência de dado);
 * - senão ⇒ ok (a própria seção mostra o dado, inclusive "sem registros").
 */
export function avaliarDisponibilidadeModulos(c: any): ModuloDisponibilidade[] {
  return MODULOS_RELATORIO.map(({ key, label }) => {
    const payload = c?.[key];
    const meta = derivarMetaModulo(key, payload, c?.processoAnm);
    if (payload == null) return { key, label, estado: "nao_consultado" as const, motivo: null, meta };
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const falhou = payload.disponivel === false || (payload.disponivel !== true && payload.erro);
      if (falhou) {
        const motivo = typeof payload.erro === "string" ? payload.erro
          : typeof payload.message === "string" ? payload.message : null;
        return { key, label, estado: "indisponivel" as const, motivo, meta };
      }
    }
    return { key, label, estado: "ok" as const, motivo: null, meta };
  });
}

// ── Riscos determinísticos a partir do quadro de camadas ───────────────────

const normalizarTexto = (s: any): string =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Palavras-chave conservadoras por camada — usadas só quando o destaque não traz nomes. */
const CAMADA_KEYWORDS: Record<string, string[]> = {
  funai: ["terra indigena", "terras indigenas", "funai"],
  unidadesConservacao: ["unidade de conservacao", "unidades de conservacao", "cnuc"],
  embargos: ["embargo"],
  cavernas: ["caverna", "cecav", "canie", "espeleolog"],
  quilombolas: ["quilombo"],
  assentamentos: ["assentamento"],
};

export interface MencaoRestricao {
  key: string;
  label: string;
  status: string;
  destaque: string;
  /** nomes das ocorrências extraídos do destaque ("Nome — ~X km; ...") */
  nomes: string[];
  texto: string;
}

/**
 * Camadas do quadro com ocorrência > 0 (ou sobreposição direta) viram menções
 * OBRIGATÓRIAS nos riscos do parecer, com nome e distância. Camadas zeradas
 * não geram menção (podem ir a pontos fortes).
 */
export function gerarMencoesRestricoes(quadro: QuadroCamadas): MencaoRestricao[] {
  return quadro.linhas
    .filter((l) => l.consultada && (l.status === "SOBREPOSIÇÃO DIRETA" || /ocorrência\(s\)/.test(l.status)))
    .map((l) => {
      const nomes = String(l.destaque || "")
        .split(";")
        .map((p) => p.split("—")[0].trim())
        .filter((n) => n.length >= 3);
      return {
        key: l.key,
        label: l.label,
        status: l.status,
        destaque: l.destaque,
        nomes,
        texto: `${l.label}: ${l.status}${l.destaque ? ` — ${l.destaque}` : ""}`,
      };
    });
}

export const MARCA_RISCO_INJETADO = "[incluído automaticamente do quadro de restrições]";

/**
 * Mescla as menções obrigatórias na lista de riscos do parecer NA
 * RENDERIZAÇÃO — vale também para pareceres antigos em cache. Não duplica
 * camadas que a IA já citou: quando a camada tem nomes em destaque, exige o
 * nome da ocorrência no texto do risco (garante nome+distância); sem nomes,
 * aceita a palavra-chave da camada.
 */
export function mesclarRiscosComRestricoes(
  riscos: any[] | null | undefined,
  quadro: QuadroCamadas,
): { riscos: string[]; injetados: string[] } {
  const base = (Array.isArray(riscos) ? riscos : [])
    .map((r) => (typeof r === "string" ? r : r?.descricao || r?.risco || JSON.stringify(r ?? "")))
    .map((r) => String(r))
    .filter((r) => r.trim().length > 0);
  const baseNorm = base.map(normalizarTexto);
  const injetados: string[] = [];
  for (const m of gerarMencoesRestricoes(quadro)) {
    const alvos = (m.nomes.length > 0 ? m.nomes : CAMADA_KEYWORDS[m.key] || [])
      .map(normalizarTexto)
      .filter((a) => a.length >= 3);
    const citado = alvos.length > 0 && baseNorm.some((r) => alvos.some((a) => r.includes(a)));
    if (!citado) injetados.push(`${m.texto} ${MARCA_RISCO_INJETADO}`);
  }
  return { riscos: [...base, ...injetados], injetados };
}
