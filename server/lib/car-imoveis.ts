// Imóveis CAR (SICAR) sobrepostos a um polígono (processo minerário ou outro).
// Fonte: GeoServer público do SICAR (geoserver.car.gov.br), camadas por UF
// (sicar:sicar_imoveis_<uf>) — consulta por bbox do polígono + interseção
// geométrica exata (polygon-clipping) para % de sobreposição. Validado ago/2026.
import polygonClipping from "polygon-clipping";
import {
  geojsonToMultiPoly,
  multiPolyAreaHa,
  intersectionAreaHa,
  consultarGeometriasParcelasSigef,
} from "./sigef-parcelas";

const SICAR_WFS_URL = "https://geoserver.car.gov.br/geoserver/sicar/wfs";

const STATUS_LABEL: Record<string, string> = {
  AT: "Ativo",
  PE: "Pendente",
  SU: "Suspenso",
  CA: "Cancelado",
};

const TIPO_LABEL: Record<string, string> = {
  IRU: "Imóvel Rural",
  AST: "Assentamento",
  PCT: "Território Tradicional",
};

import { sanearSobreposicao, checarPercentual } from "./sanidade-numerica";
import type { EstadoConsulta, SituacaoRegistro, TierFonte, IdentificadorVinculo } from "./consulta-contrato";

export interface CarImovelSobreposto {
  codImovel: string | null;
  municipio: string | null;
  uf: string | null;
  municipioIbge: number | null;
  areaHa: number | null;             // área declarada do imóvel no CAR
  status: string | null;             // Ativo / Pendente / Suspenso / Cancelado
  condicao: string | null;           // ex.: "Aguardando análise"
  tipo: string | null;               // Imóvel Rural / Assentamento / Território Tradicional
  modulosFiscais: number | null;
  sobreposicaoHa: number | null;     // área do imóvel dentro do polígono
  sobreposicaoPct: number | null;    // % do polígono coberto por este imóvel
  /** checagem de sanidade falhou — motivo substitui os números na exibição */
  sobreposicaoAVerificar?: string;
  relacao: "sobreposto" | "vizinho";
}

export interface CarResultado {
  disponivel: boolean;
  fonte: string;
  consultadoEm: string;
  ufsConsultadas: string[];
  totalSobrepostos: number;
  totalVizinhos: number;
  coberturaPct: number | null;  // % do polígono coberto por imóveis CAR
  coberturaAVerificar?: string; // sanidade da cobertura falhou — motivo
  // contrato de três estados + tier — obrigatório em todos os caminhos
  estadoConsulta: EstadoConsulta;
  situacaoRegistro: SituacaoRegistro | null;
  tierFonte: TierFonte;
  janelaCobertura: string | null;
  identificadorVinculo: IdentificadorVinculo | null;
  truncado?: boolean;
  imoveis: CarImovelSobreposto[];
  // Geometrias dos imóveis (mesma consulta) — para preencher o cache de mapa
  // sem nova ida à rede. NÃO deve ser persistido em campos_especificos.
  geometrias?: CarImovelGeometria[];
  erro?: string;
}

export interface CarImovelGeometria {
  codImovel: string | null;
  geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
}

// bbox [minLon, minLat, maxLon, maxLat] do MultiPolygon, com margem (~50 m)
function bboxOfMultiPoly(mp: number[][][][], padDeg = 0.0005): [number, number, number, number] | null {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const poly of mp) for (const ring of poly) for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLon)) return null;
  return [minLon - padDeg, minLat - padDeg, maxLon + padDeg, maxLat + padDeg];
}

// O GeoServer do SICAR é sabidamente instável: HTTP 5xx intermitente, lentidão
// e exceções XML devolvidas com HTTP 200. Cada página é tentada algumas vezes
// com backoff curto, dentro de um orçamento total pensado para caber nos 120s
// da chamada interna do orquestrador de enriquecimento (sobra folga para o
// cálculo geométrico e a persistência).
const MAX_TENTATIVAS_PAGINA = 3;
const TIMEOUT_PAGINA_MS = 30_000;
const ORCAMENTO_CONSULTA_MS = 90_000;

class SicarHttpError extends Error {
  constructor(public readonly status: number) {
    super(`GeoServer do SICAR respondeu HTTP ${status}`);
    this.name = "SicarHttpError";
  }
}

// Vale nova tentativa? 5xx/429, timeout, falha de rede e exceção XML com
// HTTP 200 são transitórios; apenas 4xx é tratado como permanente.
function isFalhaTransitoriaSicar(e: any): boolean {
  if (e instanceof SicarHttpError) return e.status >= 500 || e.status === 429;
  return true;
}

async function fetchCarPage(uf: string, bbox: [number, number, number, number], startIndex: number, count: number, timeoutMs: number): Promise<any> {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeName: `sicar:sicar_imoveis_${uf.toLowerCase()}`,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    bbox: `${bbox.join(",")},EPSG:4326`,
    count: String(count),
    startIndex: String(startIndex),
  });
  let text: string;
  try {
    const resp = await fetch(`${SICAR_WFS_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) throw new SicarHttpError(resp.status);
    text = await resp.text();
  } catch (e: any) {
    if (e instanceof SicarHttpError) throw e;
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new Error(`GeoServer do SICAR não respondeu em ${Math.round(timeoutMs / 1000)}s`);
    }
    throw new Error(`Falha de rede ao consultar o GeoServer do SICAR: ${e?.message || e}`);
  }
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    // GeoServer devolve XML de exceção com HTTP 200 em alguns erros
    const m = text.match(/<ows:ExceptionText>([^<]+)</);
    throw new Error(m ? `SICAR WFS: ${m[1]}` : "SICAR WFS: resposta inesperada (não-JSON)");
  }
  return data;
}

async function fetchCarPageComRetry(uf: string, bbox: [number, number, number, number], startIndex: number, count: number, deadline: number): Promise<any> {
  let ultimoErro: any = null;
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_PAGINA; tentativa++) {
    const restanteMs = deadline - Date.now();
    if (restanteMs < 5_000) break; // sem orçamento para (mais uma) tentativa
    try {
      return await fetchCarPage(uf, bbox, startIndex, count, Math.min(TIMEOUT_PAGINA_MS, restanteMs));
    } catch (e: any) {
      ultimoErro = e;
      if (!isFalhaTransitoriaSicar(e) || tentativa === MAX_TENTATIVAS_PAGINA) throw e;
      const backoffMs = 1_000 * tentativa;
      console.warn(`[CAR] SICAR instável (${e?.message || e}) — nova tentativa (${tentativa + 1}/${MAX_TENTATIVAS_PAGINA}) em ${backoffMs / 1000}s`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw ultimoErro ?? new Error("GeoServer do SICAR indisponível no momento (tempo de consulta esgotado)");
}

// Busca todas as features CAR no bbox (com paginação e retry), por UF.
async function fetchCarFeatures(ufs: string[], bbox: [number, number, number, number]): Promise<{ features: any[]; truncado: boolean }> {
  const PAGE_SIZE = 200;
  const MAX_FEATURES = 500;
  const deadline = Date.now() + ORCAMENTO_CONSULTA_MS;
  const features: any[] = [];
  let truncado = false;
  for (const uf of ufs) {
    let startIndex = 0;
    for (;;) {
      const data = await fetchCarPageComRetry(uf, bbox, startIndex, PAGE_SIZE, deadline);
      const page: any[] = Array.isArray(data?.features) ? data.features : [];
      const room = MAX_FEATURES - features.length;
      features.push(...page.slice(0, room));
      if (page.length > room || features.length >= MAX_FEATURES) {
        truncado = true;
        console.warn(`[CAR] Resultado truncado em ${MAX_FEATURES} imóveis para o bbox consultado`);
        return { features, truncado };
      }
      if (page.length < PAGE_SIZE) break;
      startIndex += page.length;
    }
  }
  return { features, truncado };
}

/**
 * Casa parcelas SIGEF com imóveis CAR por sobreposição geométrica: quando a
 * parcela certificada está majoritariamente dentro do imóvel CAR, é muito
 * provável que sejam a mesma propriedade (fontes distintas, sem vínculo
 * cadastral oficial). Retorna Map<codigoParcela, codImovel CAR>.
 *
 * Busca as geometrias das duas fontes sobre o polígono do processo — melhor
 * esforço: qualquer falha de rede resulta em Map vazio (sem fusão).
 *
 * Se `geometriasCache` trouxer geometrias já consultadas (ex.: cache das rotas
 * de mapa), elas são reutilizadas e a rede só é consultada para a fonte que
 * faltar no cache.
 */
export interface GeometriasPreCarregadas {
  parcelas?: { codigoParcela: string | null; geometry: { type: "MultiPolygon"; coordinates: number[][][][] } }[];
  imoveis?: CarImovelGeometria[];
}

// Limiar de 60% da área da parcela dentro do imóvel CAR: tolera divergências
// de traçado entre as bases (SIGEF é certificado; CAR é autodeclarado).
const LIMIAR_FRACAO = 0.6;

export interface SigefCarCasamento {
  /** parcela SIGEF → imóvel CAR com fração ≥ limiar (pareamento consolidável) */
  casados: Map<string, string>;
  /** melhor candidato ABAIXO do limiar — pareamento não consolidado: exibir fontes separadas */
  abaixoLimiar: Map<string, { codImovel: string; fracaoPct: number }>;
  limiarPct: number;
}

export async function casarParcelasSigefComCar(
  processGeometry: any,
  ufs: string[],
  codigosParcelas: string[],
  codigosCar: string[],
  geometriasCache?: GeometriasPreCarregadas,
): Promise<SigefCarCasamento> {
  const casados = new Map<string, string>();
  const abaixoLimiar = new Map<string, { codImovel: string; fracaoPct: number }>();
  const limiarPct = Math.round(LIMIAR_FRACAO * 100);
  if (codigosParcelas.length === 0 || codigosCar.length === 0) return { casados, abaixoLimiar, limiarPct };

  const [parcelas, imoveis] = await Promise.all([
    geometriasCache?.parcelas && geometriasCache.parcelas.length > 0
      ? Promise.resolve(geometriasCache.parcelas)
      : consultarGeometriasParcelasSigef(processGeometry),
    geometriasCache?.imoveis && geometriasCache.imoveis.length > 0
      ? Promise.resolve(geometriasCache.imoveis)
      : consultarGeometriasImoveisCar(processGeometry, ufs),
  ]);

  const wantParcela = new Set(codigosParcelas);
  const wantCar = new Set(codigosCar);
  const imoveisAlvo = imoveis.filter((i) => i.codImovel && wantCar.has(i.codImovel));

  for (const p of parcelas) {
    if (!p.codigoParcela || !wantParcela.has(p.codigoParcela)) continue;
    const areaParcela = multiPolyAreaHa(p.geometry.coordinates as any);
    if (areaParcela <= 0) continue;
    let melhorCod: string | null = null;
    let melhorFracao = 0;
    for (const i of imoveisAlvo) {
      const inter = intersectionAreaHa(p.geometry.coordinates as any, i.geometry.coordinates as any);
      const fracao = inter / areaParcela;
      if (fracao > melhorFracao) {
        melhorFracao = fracao;
        melhorCod = i.codImovel;
      }
    }
    if (melhorCod && melhorFracao >= LIMIAR_FRACAO) {
      casados.set(p.codigoParcela, melhorCod);
    } else if (melhorCod && melhorFracao >= 0.05) {
      // candidato existe mas não atinge o critério objetivo — registrar para
      // o consolidador rotular como "não consolidado" (fontes exibidas separadas)
      abaixoLimiar.set(p.codigoParcela, {
        codImovel: melhorCod,
        fracaoPct: Math.round(melhorFracao * 1000) / 10,
      });
    }
  }
  return { casados, abaixoLimiar, limiarPct };
}

/**
 * Consulta os imóveis CAR que intersectam (ou tocam, via bbox com margem
 * de ~50 m) o polígono informado e calcula o percentual de sobreposição
 * por interseção geométrica exata.
 */
export async function consultarImoveisCar(processGeometry: any, ufs: string[]): Promise<CarResultado> {
  const consultadoEm = new Date().toISOString();
  const ufsNorm = Array.from(new Set(ufs.map((u) => u.trim().toUpperCase()).filter((u) => /^[A-Z]{2}$/.test(u))));

  const base: CarResultado = {
    disponivel: false,
    fonte: "SICAR — GeoServer público (geoserver.car.gov.br)",
    consultadoEm,
    ufsConsultadas: ufsNorm,
    // default: falha = "não consultada" (sobrescrito no caminho de sucesso)
    estadoConsulta: "nao_consultada",
    situacaoRegistro: null,
    tierFonte: "T1",
    janelaCobertura: "cadastro CAR autodeclarado vigente no GeoServer do SICAR na data da consulta",
    identificadorVinculo: { tipo: "geometria", valor: "polígono do processo ANM", proveniencia: "documento_oficial", origem: "SIGMINE" },
    totalSobrepostos: 0,
    totalVizinhos: 0,
    coberturaPct: null,
    imoveis: [],
  };

  const processMp = geojsonToMultiPoly(processGeometry);
  if (processMp.length === 0) return { ...base, erro: "Geometria do processo indisponível" };
  if (ufsNorm.length === 0) return { ...base, erro: "UF do ativo desconhecida — preencha o estado do ativo para consultar o CAR" };

  const bbox = bboxOfMultiPoly(processMp as any);
  if (!bbox) return { ...base, erro: "Geometria do processo inválida" };

  const processAreaHa = multiPolyAreaHa(processMp);

  let features: any[] = [];
  let truncado = false;
  try {
    const r = await fetchCarFeatures(ufsNorm, bbox);
    features = r.features;
    truncado = r.truncado;
  } catch (e: any) {
    console.error(`[CAR] Falha ao consultar GeoServer do SICAR: ${e?.message || e}`);
    return { ...base, erro: e?.message || "GeoServer do SICAR indisponível no momento" };
  }

  const imoveis: CarImovelSobreposto[] = [];
  const geometrias: CarImovelGeometria[] = [];
  let coveredUnion: any = [];

  for (const f of features) {
    const p = f.properties || {};
    const imovelMp = geojsonToMultiPoly(f.geometry);
    if (imovelMp.length > 0 && p.cod_imovel) {
      geometrias.push({
        codImovel: p.cod_imovel,
        geometry: { type: "MultiPolygon", coordinates: imovelMp as any },
      });
    }
    const interHa = imovelMp.length > 0 ? intersectionAreaHa(processMp, imovelMp) : 0;
    // limiar de 0,01 ha (100 m²) para descartar ruído numérico de borda
    const sobreposto = interHa > 0.01;
    if (sobreposto) {
      try {
        const inter = polygonClipping.intersection(processMp as any, imovelMp as any);
        coveredUnion = coveredUnion.length === 0 ? inter : polygonClipping.union(coveredUnion, inter as any);
      } catch { /* união é apenas informativa */ }
    }
    const pct = processAreaHa > 0 ? (interHa / processAreaHa) * 100 : null;
    // sanidade geométrica: interseção ≤ menor área (usa a área DESENHADA do
    // imóvel, não a declarada — a declarada pode divergir do traçado)
    const areaGeomHa = imovelMp.length > 0 ? multiPolyAreaHa(imovelMp) : null;
    const san = sobreposto
      ? sanearSobreposicao({
          sobreposicaoHa: Math.round(interHa * 100) / 100,
          sobreposicaoPct: pct != null ? Math.round(pct * 100) / 100 : null,
          areaMenorHa: areaGeomHa,
          areaOutraHa: processAreaHa > 0 ? processAreaHa : null,
          contexto: `imóvel CAR ${p.cod_imovel ?? "sem código"} × processo`,
        })
      : null;
    imoveis.push({
      codImovel: p.cod_imovel ?? null,
      municipio: p.municipio ?? null,
      uf: p.uf ?? null,
      municipioIbge: p.cod_municipio_ibge != null ? Number(p.cod_municipio_ibge) : null,
      areaHa: p.area != null ? Math.round(Number(p.area) * 100) / 100 : (areaGeomHa != null ? Math.round(areaGeomHa * 100) / 100 : null),
      status: p.status_imovel ? (STATUS_LABEL[p.status_imovel] || String(p.status_imovel)) : null,
      condicao: p.condicao ?? null,
      tipo: p.tipo_imovel ? (TIPO_LABEL[p.tipo_imovel] || String(p.tipo_imovel)) : null,
      modulosFiscais: p.m_fiscal != null ? Number(p.m_fiscal) : null,
      sobreposicaoHa: san ? san.sobreposicaoHa : 0,
      sobreposicaoPct: san ? san.sobreposicaoPct : 0,
      ...(san?.sobreposicaoAVerificar ? { sobreposicaoAVerificar: san.sobreposicaoAVerificar } : {}),
      relacao: sobreposto ? "sobreposto" : "vizinho",
    });
  }

  imoveis.sort((a, b) => (b.sobreposicaoPct ?? 0) - (a.sobreposicaoPct ?? 0));
  const coveredHa = coveredUnion.length > 0 ? multiPolyAreaHa(coveredUnion) : 0;

  const coberturaRaw = processAreaHa > 0 ? Math.round((coveredHa / processAreaHa) * 10000) / 100 : null;
  const cobertura = coberturaRaw != null ? checarPercentual(coberturaRaw, "cobertura do processo por imóveis CAR") : null;

  return {
    ...base,
    disponivel: true,
    estadoConsulta: imoveis.length > 0 ? "registro_existente" : "consultada_sem_registro",
    // cadastro ambiental não classifica situação: registro vigente = indeterminada
    situacaoRegistro: imoveis.length > 0 ? "indeterminada" : null,
    totalSobrepostos: imoveis.filter((i) => i.relacao === "sobreposto").length,
    totalVizinhos: imoveis.filter((i) => i.relacao === "vizinho").length,
    coberturaPct: cobertura == null ? null : cobertura.ok ? cobertura.valor : null,
    ...(cobertura && !cobertura.ok ? { coberturaAVerificar: cobertura.motivo } : {}),
    ...(truncado ? { truncado: true } : {}),
    imoveis,
    geometrias,
  };
}

/**
 * Busca apenas as geometrias dos imóveis CAR no bbox do polígono — usada para
 * desenhar no mapa. Os atributos/relação vêm do resultado salvo.
 */
export async function consultarGeometriasImoveisCar(processGeometry: any, ufs: string[]): Promise<CarImovelGeometria[]> {
  const processMp = geojsonToMultiPoly(processGeometry);
  if (processMp.length === 0) return [];
  const ufsNorm = Array.from(new Set(ufs.map((u) => u.trim().toUpperCase()).filter((u) => /^[A-Z]{2}$/.test(u))));
  if (ufsNorm.length === 0) return [];
  const bbox = bboxOfMultiPoly(processMp as any);
  if (!bbox) return [];
  const { features } = await fetchCarFeatures(ufsNorm, bbox);
  const out: CarImovelGeometria[] = [];
  for (const f of features) {
    const mp = geojsonToMultiPoly(f.geometry);
    if (mp.length === 0) continue;
    out.push({
      codImovel: f.properties?.cod_imovel ?? null,
      geometry: { type: "MultiPolygon", coordinates: mp as any },
    });
  }
  return out;
}
