// Consulta gratuita ao Diário Oficial da União (Imprensa Nacional).
// A busca em www.in.gov.br devolve os resultados embutidos no HTML, num input
// com id "..._BuscaDouPortlet_params" contendo JSON {"jsonArray":[...]}.
import { getCached, setCached } from "../cache";
import {
  TEXTO_VINCULO_NAO_CONFIRMADO,
  payloadFalhaConsulta,
  type EstadoConsulta,
  type IdentificadorVinculo,
  type VinculoDiario,
} from "./consulta-contrato";

const DOU_BASE = "https://www.in.gov.br";

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
} as const;

export interface DouPublicacao {
  titulo: string;
  data: string | null;
  secao: string;
  tipoAto: string | null;
  orgao: string | null;
  trecho: string;
  url: string;
  categoria: string;
  termoBusca: string;
  /** todos os termos de busca que retornaram esta publicação (dedupe por URL) */
  termosCasados?: string[];
  /** vínculo por identificador: processo ANM (confirmado) vs só nome do titular */
  vinculo?: VinculoDiario;
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripTags(s: string): string {
  return unescapeHtml(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function categorizarPublicacao(texto: string): string {
  const t = texto.toUpperCase();
  if (t.includes("PORTARIA DE LAVRA") || (t.includes("CONCESS") && t.includes("LAVRA"))) return "portaria_lavra";
  if (t.includes("ALVAR") && t.includes("PESQUISA")) return "alvara_pesquisa";
  if (t.includes("DISPONIBILIDADE")) return "disponibilidade";
  if (t.includes("MULTA") || t.includes("AUTO DE INFRA") || t.includes("SAN")) return "penalidade";
  if (t.includes("CADUCIDADE")) return "caducidade";
  if (t.includes("GUIA DE UTILIZA")) return "guia_utilizacao";
  if (t.includes("LICENCIAMENTO")) return "licenciamento";
  if (t.includes("CESS") || t.includes("TRANSFER")) return "cessao";
  if (t.includes("PRORROGA")) return "prorrogacao";
  if (t.includes("RENÚNCIA") || t.includes("RENUNCIA") || t.includes("DESIST")) return "desistencia";
  return "outro";
}

async function buscarTermo(termo: string, timeoutMs = 20000): Promise<DouPublicacao[] | null> {
  const url = `${DOU_BASE}/consulta/-/buscar/dou?q=${encodeURIComponent(`"${termo}"`)}&s=todos&exactDate=all&sortType=0`;
  try {
    const resp = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) {
      console.error(`[DOU] Busca falhou (HTTP ${resp.status}) para termo: ${termo}`);
      return null;
    }
    const html = await resp.text();
    // Os resultados vêm num <script type="application/json"> com o JSON puro no corpo
    const m = html.match(/id="_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params"[^>]*>\s*(\{[\s\S]*?\})\s*<\/script>/);
    let jsonRaw = m?.[1];
    let precisaUnescape = false;
    if (!jsonRaw) {
      // fallback: versões antigas usavam <input value="..."> com HTML escapado
      const m2 = html.match(/id="_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params"[^>]*value="([\s\S]*?)"\s*\/?>/)
        || html.match(/value="(\{&quot;jsonArray&quot;[\s\S]*?\})"/);
      jsonRaw = m2?.[1];
      precisaUnescape = true;
    }
    if (!jsonRaw) {
      console.error(`[DOU] Não encontrei o bloco de resultados no HTML para termo: ${termo}`);
      return null;
    }
    const parsed = JSON.parse(precisaUnescape ? unescapeHtml(jsonRaw) : jsonRaw);
    const arr: any[] = Array.isArray(parsed?.jsonArray) ? parsed.jsonArray : [];
    return arr.map((it) => {
      const trecho = stripTags(it.content || "");
      const titulo = stripTags(it.title || "") || (it.artType ? String(it.artType) : "Publicação");
      const texto = `${titulo} ${it.artType || ""} ${trecho}`;
      return {
        titulo,
        data: it.pubDate || it.displayDate || null,
        secao: it.pubName || "",
        tipoAto: it.artType || null,
        orgao: stripTags(it.hierarchyStr || "") || null,
        trecho: trecho.slice(0, 500),
        url: it.urlTitle ? `${DOU_BASE}/web/dou/-/${it.urlTitle}` : "",
        categoria: categorizarPublicacao(texto),
        termoBusca: termo,
      };
    });
  } catch (e: any) {
    console.error(`[DOU] Erro na busca por "${termo}":`, e.message);
    return null;
  }
}

// Gera as grafias usuais do processo ANM para busca no DOU.
export function variantesProcesso(processo: string): string[] {
  const digits = String(processo || "").replace(/\D/g, "");
  const partes = String(processo || "").split("/");
  const num = (partes[0] || "").replace(/\D/g, "");
  const ano = (partes[1] || "").replace(/\D/g, "");
  const out: string[] = [];
  if (num && ano) {
    // 886.371/2008 (grafia oficial) e 886371/2008
    if (num.length > 3) out.push(`${num.slice(0, num.length - 3)}.${num.slice(-3)}/${ano}`);
    out.push(`${num}/${ano}`);
  } else if (digits.length >= 7) {
    const n = digits.slice(0, digits.length - 4);
    const a = digits.slice(-4);
    if (n.length > 3) out.push(`${n.slice(0, n.length - 3)}.${n.slice(-3)}/${a}`);
    out.push(`${n}/${a}`);
  }
  return Array.from(new Set(out));
}

export async function consultarDou(opts: { processo?: string; titular?: string; refresh?: boolean }) {
  const termosProcesso = opts.processo ? variantesProcesso(opts.processo) : [];
  const termos: string[] = [...termosProcesso];
  const titular = (opts.titular || "").trim();
  if (titular.length >= 5) termos.push(titular);
  if (termos.length === 0) {
    return payloadFalhaConsulta({
      fonte: "Diário Oficial da União — Imprensa Nacional (busca gratuita)",
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

  // v2: payload passou a carregar vínculo por publicação + três estados
  const cacheKey = `busca2:${termos.join("|").toLowerCase()}`;
  if (!opts.refresh) {
    const cached = await getCached<any>("dou", cacheKey);
    if (cached) return cached;
  }

  const resultados = await Promise.all(termos.map(t => buscarTermo(t)));
  const setProcesso = new Set(termosProcesso);
  const termosComFalha = termos.filter((_, i) => resultados[i] === null);
  const falhas = termosComFalha.length;
  // completude por identificador: se alguma grafia do NÚMERO do processo
  // falhou, a busca por identificador está incompleta — sem resultado
  // confirmado, isso NUNCA pode virar "consultada sem registro"
  const falhouTermoProcesso = termos.some((t, i) => resultados[i] === null && setProcesso.has(t));
  if (falhas === termos.length) {
    return payloadFalhaConsulta({
      fonte: "Diário Oficial da União — Imprensa Nacional (busca gratuita)",
      tierFonte: "T2",
      motivoFalha: "Busca do DOU (Imprensa Nacional) indisponível no momento — tente novamente mais tarde",
      identificadorVinculo,
      extras: { termosBuscados: termos, termosComFalha },
    });
  }
  const vinculoDoTermo = (termo: string): VinculoDiario => setProcesso.has(termo)
    ? { por: "processo_anm", termo, confirmado: true }
    : { por: "nome_titular", termo, confirmado: false };

  // dedupe por URL (a mesma publicação aparece para grafias diferentes),
  // acumulando os termos casados; vínculo por número de processo prevalece
  // sobre casamento só por nome do titular.
  const vistos = new Map<string, DouPublicacao>();
  for (const lista of resultados) {
    for (const pub of lista || []) {
      const key = pub.url || `${pub.titulo}|${pub.data}`;
      const atual = vistos.get(key);
      if (!atual) {
        vistos.set(key, { ...pub, termosCasados: [pub.termoBusca], vinculo: vinculoDoTermo(pub.termoBusca) });
      } else {
        if (!atual.termosCasados!.includes(pub.termoBusca)) atual.termosCasados!.push(pub.termoBusca);
        if (!atual.vinculo!.confirmado) {
          const v = vinculoDoTermo(pub.termoBusca);
          if (v.confirmado) atual.vinculo = v; // upgrade: casou também pelo número do processo
        }
      }
    }
  }
  const publicacoes = Array.from(vistos.values()).sort((a, b) => {
    const da = a.data ? new Date(a.data.split("/").reverse().join("-")).getTime() : 0;
    const db_ = b.data ? new Date(b.data.split("/").reverse().join("-")).getTime() : 0;
    return db_ - da;
  });

  const totalVinculoConfirmado = publicacoes.filter((p) => p.vinculo?.confirmado).length;
  const totalVinculoNaoConfirmado = publicacoes.length - totalVinculoConfirmado;

  const result = {
    disponivel: true as const,
    // três estados: "registro existente" só com publicação casada pelo NÚMERO
    // do processo; casamento só por nome não confirma registro do processo; e
    // busca por identificador incompleta nunca vira "sem registro".
    estadoConsulta: (totalVinculoConfirmado > 0
      ? "registro_existente"
      : falhouTermoProcesso ? "nao_consultada" : "consultada_sem_registro") as EstadoConsulta,
    // publicação de diário não tem situação processual própria — registro = indeterminada
    situacaoRegistro: totalVinculoConfirmado > 0 ? ("indeterminada" as const) : null,
    ...(falhouTermoProcesso && totalVinculoConfirmado === 0 ? {
      motivoEstado: `a busca pelo número do processo falhou em ${termosComFalha.filter((t) => setProcesso.has(t)).length} grafia(s) — cobertura incompleta; ausência de registro não pode ser afirmada`,
    } : {}),
    tierFonte: "T2" as const, // publicação oficial que exige interpretação de texto
    janelaCobertura: "acervo completo da busca pública do DOU (sem recorte de datas)",
    identificadorVinculo,
    total: publicacoes.length,
    totalVinculoConfirmado,
    totalVinculoNaoConfirmado,
    ...(totalVinculoNaoConfirmado > 0 ? {
      notaVinculo: `${totalVinculoNaoConfirmado} publicação(ões) casada(s) apenas pelo nome do titular (${TEXTO_VINCULO_NAO_CONFIRMADO} por número de processo) — exibidas rotuladas, sem gerar alerta/prazo nem entrar como fato nos insumos da IA.`,
    } : {}),
    publicacoes: publicacoes.slice(0, 60),
    termosBuscados: termos,
    fontesComFalha: falhas,
    ...(falhas > 0 ? {
      termosComFalha,
      notaCobertura: `${falhas} de ${termos.length} busca(s) falharam nesta consulta — cobertura incompleta.`,
    } : {}),
    urlBusca: `${DOU_BASE}/consulta/-/buscar/dou?q=${encodeURIComponent(`"${termos[0]}"`)}&s=todos&exactDate=all&sortType=0`,
    fonte: "Diário Oficial da União — Imprensa Nacional (busca gratuita)",
    consultadoEm: new Date().toISOString(),
  };
  // só cacheia quando todas as variantes responderam (evita fixar resultado parcial)
  if (falhas === 0) await setCached("dou", cacheKey, result);
  return result;
}
