// Fontes oficiais verificadas em 22/10/2026. Não descobrir automaticamente uma
// versão "mais nova": há camadas CNUC publicadas com colunas genéricas n1..n32.
export interface BboxRestricao {
  minLon: number; minLat: number; maxLon: number; maxLat: number;
}

export const FONTES_RESTRICOES = {
  terraIndigena: {
    url: "https://cmr.funai.gov.br/geoserver/ows",
    camada: "CMR-PUBLICO:lim_terra_indigena_a",
    campoNome: "no_ti",
    campoOrdenacao: "co_funai",
    origem: "FUNAI — CMR público (serviço oficial)",
    dataBase: "atualização não informada para o conjunto; dt_cadastro disponível por feição",
    limitacoes: "Terras indígenas com delimitação publicada no CMR; não substitui consulta formal à FUNAI.",
  },
  quilombola: {
    url: "https://geoservicos.ibge.gov.br/geoserver/ows",
    camada: "CGMAT:qg_2022_620_territorioquilombola__v02",
    campoNome: "nm_tq",
    campoOrdenacao: "cd_tq",
    origem: "IBGE — Territórios Quilombolas 2022, delimitação INCRA (republicação oficial)",
    dataBase: "2022",
    limitacoes: "Recorte de 2022, não é cadastro INCRA em tempo real nem cobre todas as comunidades quilombolas; ausência só vale neste recorte.",
  },
  unidadeConservacao: {
    url: "https://geoservicos.inde.gov.br/geoserver/ows",
    camada: "MMA:cnuc_26_07_31",
    campoNome: "nome_uc",
    campoOrdenacao: "ogc_fid",
    origem: "MMA/CNUC via INDE (republicação oficial; UCs federais, estaduais e municipais)",
    dataBase: "2026-07-31",
    limitacoes: "Recorte CNUC de julho/2026; não representa atualizações posteriores nem substitui verificação junto ao órgão gestor.",
  },
} as const;

export type CamadaRestricao = keyof typeof FONTES_RESTRICOES;
export interface EvidenciaWfs {
  origem: string;
  url: string;
  camada: string;
  dataBase: string;
  limitacoes: string;
  consultadoEm: string;
  erro?: string;
}

const TAMANHO_PAGINA = 200;
const MAX_PAGINAS = 10;

/** CRS:84 explicita lon,lat no BBOX e na saída, sem depender do eixo EPSG:4326/WFS 2. */
export async function consultarRestricaoWfs(
  camada: CamadaRestricao, bbox: BboxRestricao,
): Promise<{ ok: boolean; features: any[]; evidencia: EvidenciaWfs }> {
  const fonte = FONTES_RESTRICOES[camada];
  const evidencia: EvidenciaWfs = { ...fonte, consultadoEm: new Date().toISOString() };
  try {
    const { minLon, minLat, maxLon, maxLat } = bbox;
    if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)
      || minLon > maxLon || minLat > maxLat || minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) {
      throw new Error("BBOX inválido");
    }
    const features: any[] = [];
    const ids = new Set<string>();
    // Um único orçamento de tempo para todas as páginas.
    const signal = AbortSignal.timeout(45000);
    let totalEsperado: number | undefined;
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const params = new URLSearchParams({
        service: "WFS", version: "2.0.0", request: "GetFeature",
        typeNames: fonte.camada, outputFormat: "application/json", srsName: "CRS:84",
        bbox: `${minLon},${minLat},${maxLon},${maxLat},CRS:84`,
        count: String(TAMANHO_PAGINA), startIndex: String(features.length),
        // IBGE rejeita startIndex (inclusive 0) sem ordenação explícita.
        sortBy: fonte.campoOrdenacao,
      });
      const r = await fetch(`${fonte.url}?${params}`, { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // GeoServer também devolve ExceptionReport XML com HTTP 200.
      const j = await r.json();
      if (j?.type !== "FeatureCollection" || !Array.isArray(j.features)) throw new Error("Resposta não é FeatureCollection");
      const matched = j.numberMatched ?? j.totalFeatures;
      if (matched !== undefined && matched !== "unknown") {
        const total = Number(matched);
        if (!Number.isSafeInteger(total) || total < 0) throw new Error("Total WFS inválido");
        if (totalEsperado !== undefined && total !== totalEsperado) throw new Error("Total mudou durante paginação");
        totalEsperado = total;
      }
      for (const f of j.features) {
        if (f?.type !== "Feature" || !["Polygon", "MultiPolygon"].includes(f.geometry?.type)
          || !Array.isArray(f.geometry.coordinates) || !f.geometry.coordinates.length
          || typeof f.properties?.[fonte.campoNome] !== "string" || !f.properties[fonte.campoNome].trim()) {
          throw new Error("Feição sem polígono ou atributos esperados");
        }
        // IDs GeoServer são estáveis. Detecta servidor que ignora startIndex.
        const id = String(f.properties[fonte.campoOrdenacao] ?? f.id ?? JSON.stringify(f));
        if (ids.has(id)) throw new Error("Página repetida; paginação não confiável");
        ids.add(id);
        features.push(f);
      }
      if (totalEsperado !== undefined) {
        if (features.length > totalEsperado) throw new Error("Contagem WFS inconsistente");
        if (features.length === totalEsperado) return { ok: true, features, evidencia };
        if (!j.features.length) throw new Error("Resposta WFS incompleta");
      } else if (j.features.length < TAMANHO_PAGINA) {
        return { ok: true, features, evidencia };
      }
    }
    throw new Error(`Consulta incompleta: limite de ${MAX_PAGINAS * TAMANHO_PAGINA} feições atingido`);
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    evidencia.erro = `${err.message}${err.cause?.code ? ` (${err.cause.code})` : ""}`;
    console.warn(`[Restrições WFS ${camada}] ${fonte.url} ${fonte.camada}: ${evidencia.erro}`);
    // Não devolver páginas parciais como se fossem consulta completa.
    return { ok: false, features: [], evidencia };
  }
}

export function descreverFonteWfs(e: EvidenciaWfs): string {
  return `${e.origem}; ${e.url}; camada ${e.camada}; base: ${e.dataBase}`;
}
