// Consulta gratuita ao Querido Diário (Open Knowledge Brasil) — diários oficiais
// municipais. Complementa o DOU: licenças, embargos e decretos municipais que
// afetam uma jazida não saem no DOU. API: https://queridodiario.ok.org.br/api
import { sql } from "drizzle-orm";
import { db } from "../db";
import { getCached, setCached } from "../cache";
import { variantesProcesso } from "./dou";
import {
  TEXTO_VINCULO_NAO_CONFIRMADO,
  payloadFalhaConsulta,
  type EstadoConsulta,
  type IdentificadorVinculo,
  type VinculoDiario,
} from "./consulta-contrato";

const QD_API = "https://api.queridodiario.ok.org.br";

export interface QdPublicacao {
  data: string | null;
  municipio: string;
  uf: string;
  edicao: string | null;
  edicaoExtra: boolean;
  trechos: string[];
  url: string;
  urlTexto: string | null;
  termoBusca: string;
  categoria: string;
  /** todos os termos de busca que retornaram esta edição (dedupe por URL) */
  termosCasados?: string[];
  /** vínculo por identificador: processo ANM (confirmado) vs só nome do titular */
  vinculo?: VinculoDiario;
}

// Classifica o ato municipal a partir do texto dos trechos (heurística de
// palavras-chave, mesmo padrão do categorizarPublicacao do DOU). Compara sem
// acentos para tolerar OCR/normalização dos diários.
export function categorizarAtoMunicipal(texto: string): string {
  const t = String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  // risco primeiro: embargo e multa/penalidade têm prioridade sobre licença
  if (t.includes("EMBARGO") || t.includes("EMBARGA") || t.includes("INTERDICAO") || t.includes("INTERDITA") || t.includes("PARALISACAO DAS ATIVIDADES") || t.includes("SUSPENSAO DAS ATIVIDADES")) return "embargo";
  if (t.includes("MULTA") || t.includes("AUTO DE INFRACAO") || t.includes("PENALIDADE") || t.includes("SANCAO") || t.includes("INFRACAO AMBIENTAL") || t.includes("NOTIFICACAO DE INFRACAO")) return "multa";
  if (t.includes("LICENCA PREVIA") || t.includes("LICENCA DE INSTALACAO") || t.includes("LICENCA DE OPERACAO") || t.includes("LICENCA AMBIENTAL") || t.includes("LICENCIAMENTO") || t.includes("ALVARA") || (t.includes("LICENCA") && (t.includes("MINER") || t.includes("LAVRA") || t.includes("EXTRACAO") || t.includes("CONCED") || t.includes("RENOVA")))) return "licenca";
  if (t.includes("DECRETO") || t.includes("LEI MUNICIPAL") || t.includes("LEI COMPLEMENTAR") || t.includes("DESAPROPRIA") || t.includes("UTILIDADE PUBLICA")) return "decreto";
  return "outro";
}

// Resolve o código IBGE (7 dígitos) a partir do nome do município + UF,
// usando a tabela ibge_municipios já existente (busca sem acento).
export async function resolverCodigoIbge(municipio: string, uf: string): Promise<{ codigoIbge: string; nome: string; uf: string } | null> {
  const nome = String(municipio || "").trim();
  const ufNorm = String(uf || "").trim().toUpperCase();
  if (!nome) return null;
  const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  try {
    // normalização de acentos feita em JS (extensão unaccent não está habilitada)
    const result = ufNorm.length === 2
      ? await db.execute(sql`SELECT codigo_ibge, nome, uf FROM ibge_municipios WHERE uf = ${ufNorm}`)
      : await db.execute(sql`SELECT codigo_ibge, nome, uf FROM ibge_municipios`);
    const rows = ((result as any).rows as any[]).filter(r => normalizar(r.nome) === normalizar(nome));
    if (rows.length === 0) return null;
    // ambíguo sem UF: não arrisca
    if (rows.length > 1 && ufNorm.length !== 2) return null;
    return { codigoIbge: String(rows[0].codigo_ibge), nome: rows[0].nome, uf: rows[0].uf };
  } catch (e: any) {
    console.error(`[QueridoDiario] Erro ao resolver código IBGE de "${nome}/${ufNorm}":`, e.message);
    return null;
  }
}

// Verifica se o município tem cobertura no Querido Diário.
async function verificarCobertura(territoryId: string, timeoutMs = 15000): Promise<boolean | null> {
  try {
    const resp = await fetch(`${QD_API}/cities/${territoryId}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (resp.status === 404) return false;
    if (!resp.ok) return null;
    // level "0" = município cadastrado mas sem diários coletados (sem cobertura)
    const json: any = await resp.json().catch(() => null);
    const level = json?.city?.level;
    if (level === "0" || level === 0) return false;
    return true;
  } catch (e: any) {
    console.error(`[QueridoDiario] Erro ao verificar cobertura de ${territoryId}:`, e.message);
    return null;
  }
}

async function buscarTermo(territoryId: string, termo: string, timeoutMs = 20000): Promise<QdPublicacao[] | null> {
  const params = new URLSearchParams({
    territory_ids: territoryId,
    querystring: `"${termo}"`,
    size: "30",
    sort_by: "descending_date",
    excerpt_size: "400",
    number_of_excerpts: "2",
  });
  try {
    const resp = await fetch(`${QD_API}/gazettes?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) {
      console.error(`[QueridoDiario] Busca falhou (HTTP ${resp.status}) para termo: ${termo}`);
      return null;
    }
    const json: any = await resp.json();
    const arr: any[] = Array.isArray(json?.gazettes) ? json.gazettes : [];
    return arr.map((g) => {
      const trechos = (Array.isArray(g.excerpts) ? g.excerpts : [])
        .map((t: any) => String(t || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 3);
      return {
        data: g.date || null,
        municipio: g.territory_name || "",
        uf: g.state_code || "",
        edicao: g.edition != null && g.edition !== "" ? String(g.edition) : null,
        edicaoExtra: !!g.is_extra_edition,
        trechos,
        url: g.url || g.txt_url || "",
        urlTexto: g.txt_url || null,
        termoBusca: termo,
        categoria: categorizarAtoMunicipal(trechos.join(" ")),
      };
    });
  } catch (e: any) {
    console.error(`[QueridoDiario] Erro na busca por "${termo}":`, e.message);
    return null;
  }
}

const FONTE_QD = "Querido Diário — Open Knowledge Brasil (diários oficiais municipais)";

export async function consultarQueridoDiario(opts: {
  processo?: string;
  titular?: string;
  municipio: string;
  uf?: string;
  refresh?: boolean;
}) {
  const termosProcesso = opts.processo ? variantesProcesso(opts.processo) : [];
  const termos: string[] = [...termosProcesso];
  const titular = (opts.titular || "").trim();
  if (titular.length >= 5) termos.push(titular);
  if (termos.length === 0) {
    return payloadFalhaConsulta({
      fonte: FONTE_QD,
      tierFonte: "T2",
      motivoFalha: "Informe o processo ANM ou o nome do titular",
      identificadorVinculo: null,
      extras: { termosBuscados: [] as string[] },
    });
  }
  // identificador de vínculo desta consulta: preferir o número do processo
  const identificadorVinculo: IdentificadorVinculo | null = termosProcesso.length > 0
    ? { tipo: "processo_anm", valor: termosProcesso[0], proveniencia: "documento_oficial" }
    : (titular ? { tipo: "nome", valor: titular, proveniencia: "desconhecida" } : null);
  if (!opts.municipio?.trim()) {
    return payloadFalhaConsulta({
      fonte: FONTE_QD,
      tierFonte: "T2",
      motivoFalha: "Ativo sem município definido — informe o município para buscar nos diários municipais",
      identificadorVinculo,
      extras: { termosBuscados: termos },
    });
  }

  // v2: payload passou a carregar vínculo por publicação + três estados
  const cacheKey = `busca2:${opts.municipio.toLowerCase()}|${(opts.uf || "").toLowerCase()}|${termos.join("|").toLowerCase()}`;
  if (!opts.refresh) {
    const cached = await getCached<any>("querido_diario", cacheKey);
    if (cached) return cached;
  }

  const mun = await resolverCodigoIbge(opts.municipio, opts.uf || "");
  if (!mun) {
    return payloadFalhaConsulta({
      fonte: FONTE_QD,
      tierFonte: "T2",
      motivoFalha: `Não foi possível identificar o código IBGE do município "${opts.municipio}${opts.uf ? `/${opts.uf}` : ""}"`,
      identificadorVinculo,
      extras: { termosBuscados: termos },
    });
  }

  const cobertura = await verificarCobertura(mun.codigoIbge);
  if (cobertura === false) {
    const result = {
      disponivel: true as const,
      cobertura: false as const,
      // município sem cobertura = a base NÃO cobre este território: estado
      // "não consultada" (nunca confundir com "sem registro")
      estadoConsulta: "nao_consultada" as EstadoConsulta,
      situacaoRegistro: null,
      tierFonte: "T2" as const,
      janelaCobertura: null,
      identificadorVinculo,
      municipio: mun.nome,
      uf: mun.uf,
      codigoIbge: mun.codigoIbge,
      total: 0,
      publicacoes: [] as QdPublicacao[],
      termosBuscados: termos,
      message: `O município ${mun.nome}/${mun.uf} ainda não tem cobertura no Querido Diário — atos municipais precisam ser verificados diretamente no diário oficial local`,
      fonte: "Querido Diário — Open Knowledge Brasil (diários oficiais municipais)",
      consultadoEm: new Date().toISOString(),
    };
    await setCached("querido_diario", cacheKey, result);
    return result;
  }
  if (cobertura === null) {
    return payloadFalhaConsulta({
      fonte: FONTE_QD,
      tierFonte: "T2",
      motivoFalha: "Querido Diário indisponível no momento — tente novamente mais tarde",
      identificadorVinculo,
      extras: { municipio: mun.nome, uf: mun.uf, codigoIbge: mun.codigoIbge, termosBuscados: termos },
    });
  }

  const resultados = await Promise.all(termos.map(t => buscarTermo(mun.codigoIbge, t)));
  const setProcesso = new Set(termosProcesso);
  const termosComFalha = termos.filter((_, i) => resultados[i] === null);
  const falhas = termosComFalha.length;
  // completude por identificador: grafia do número do processo que falhou
  // deixa a busca por identificador incompleta — nunca vira "sem registro"
  const falhouTermoProcesso = termos.some((t, i) => resultados[i] === null && setProcesso.has(t));
  if (falhas === termos.length) {
    return payloadFalhaConsulta({
      fonte: FONTE_QD,
      tierFonte: "T2",
      motivoFalha: "Busca no Querido Diário indisponível no momento — tente novamente mais tarde",
      identificadorVinculo,
      extras: { municipio: mun.nome, uf: mun.uf, codigoIbge: mun.codigoIbge, termosBuscados: termos, termosComFalha },
    });
  }
  const vinculoDoTermo = (termo: string): VinculoDiario => setProcesso.has(termo)
    ? { por: "processo_anm", termo, confirmado: true }
    : { por: "nome_titular", termo, confirmado: false };

  // dedupe por URL (a mesma edição aparece para termos diferentes),
  // acumulando os termos casados; vínculo por número de processo prevalece
  // sobre casamento só por nome do titular.
  const vistos = new Map<string, QdPublicacao>();
  for (const lista of resultados) {
    for (const pub of lista || []) {
      const key = pub.url || `${pub.data}|${pub.edicao}`;
      const existente = vistos.get(key);
      if (!existente) {
        vistos.set(key, { ...pub, termosCasados: [pub.termoBusca], vinculo: vinculoDoTermo(pub.termoBusca) });
      } else {
        // mescla trechos de termos diferentes na mesma edição
        for (const t of pub.trechos) {
          if (!existente.trechos.includes(t) && existente.trechos.length < 4) existente.trechos.push(t);
        }
        // reclassifica com o texto ampliado
        existente.categoria = categorizarAtoMunicipal(existente.trechos.join(" "));
        if (!existente.termosCasados!.includes(pub.termoBusca)) existente.termosCasados!.push(pub.termoBusca);
        if (!existente.vinculo!.confirmado) {
          const v = vinculoDoTermo(pub.termoBusca);
          if (v.confirmado) existente.vinculo = v; // upgrade: casou também pelo número do processo
        }
      }
    }
  }
  const publicacoes = Array.from(vistos.values()).sort((a, b) => {
    const da = a.data ? new Date(a.data).getTime() : 0;
    const db_ = b.data ? new Date(b.data).getTime() : 0;
    return db_ - da;
  });

  const totalVinculoConfirmado = publicacoes.filter((p) => p.vinculo?.confirmado).length;
  const totalVinculoNaoConfirmado = publicacoes.length - totalVinculoConfirmado;

  const result = {
    disponivel: true as const,
    cobertura: true as const,
    estadoConsulta: (totalVinculoConfirmado > 0
      ? "registro_existente"
      : falhouTermoProcesso ? "nao_consultada" : "consultada_sem_registro") as EstadoConsulta,
    // publicação de diário não tem situação processual própria — registro = indeterminada
    situacaoRegistro: totalVinculoConfirmado > 0 ? ("indeterminada" as const) : null,
    ...(falhouTermoProcesso && totalVinculoConfirmado === 0 ? {
      motivoEstado: `a busca pelo número do processo falhou em ${termosComFalha.filter((t) => setProcesso.has(t)).length} grafia(s) — cobertura incompleta; ausência de registro não pode ser afirmada`,
    } : {}),
    tierFonte: "T2" as const, // publicação oficial que exige interpretação de texto
    janelaCobertura: `acervo do Querido Diário para ${mun.nome}/${mun.uf} (cobertura varia por município e período)`,
    identificadorVinculo,
    municipio: mun.nome,
    uf: mun.uf,
    codigoIbge: mun.codigoIbge,
    total: publicacoes.length,
    totalVinculoConfirmado,
    totalVinculoNaoConfirmado,
    ...(totalVinculoNaoConfirmado > 0 ? {
      notaVinculo: `${totalVinculoNaoConfirmado} edição(ões) casada(s) apenas pelo nome do titular (${TEXTO_VINCULO_NAO_CONFIRMADO} por número de processo) — exibidas rotuladas, sem gerar alerta/prazo nem entrar como fato nos insumos da IA.`,
    } : {}),
    publicacoes: publicacoes.slice(0, 40),
    termosBuscados: termos,
    fontesComFalha: falhas,
    ...(falhas > 0 ? {
      termosComFalha,
      notaCobertura: `${falhas} de ${termos.length} busca(s) falharam nesta consulta — cobertura incompleta.`,
    } : {}),
    urlBusca: `https://queridodiario.ok.org.br/pesquisa?territory_ids=${mun.codigoIbge}&q=${encodeURIComponent(`"${termos[0]}"`)}`,
    fonte: "Querido Diário — Open Knowledge Brasil (diários oficiais municipais)",
    consultadoEm: new Date().toISOString(),
  };
  // só cacheia quando todos os termos responderam (evita fixar resultado parcial)
  if (falhas === 0) await setCached("querido_diario", cacheKey, result);
  return result;
}
