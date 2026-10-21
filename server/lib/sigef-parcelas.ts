// Parcelas certificadas SIGEF/INCRA sobre um polígono (processo minerário).
// O WFS oficial do SIGEF/Acervo Fundiário está atrás do gov.br desde 2025;
// usamos o espelho público do Acervo Fundiário no ArcGIS Online
// (sigef_brasil — Brasil inteiro, atualizado periodicamente; validado ago/2026).
import polygonClipping from "polygon-clipping";
import { buscarDetentoresParcelas } from "./sigef-detentor";

const SIGEF_ARCGIS_LAYER_URL =
  "https://services8.arcgis.com/WnoZVgMq9I8Pjaoc/arcgis/rest/services/Sigef_Brasil/FeatureServer/0";
const SIGEF_ARCGIS_URL = `${SIGEF_ARCGIS_LAYER_URL}/query`;

// Idade máxima aceitável da base do espelho antes de emitir alerta (~6 meses)
const MAX_IDADE_BASE_DIAS = 185;

import { sanearSobreposicao, checarPercentual } from "./sanidade-numerica";
import type { EstadoConsulta, SituacaoRegistro, TierFonte, IdentificadorVinculo } from "./consulta-contrato";

export interface SigefParcelaSobreposta {
  codigoParcela: string | null;
  nomeArea: string | null;
  situacao: string | null;
  status: string | null;
  codigoImovel: string | null;
  registroMatricula: string | null;
  detentor: string | null;          // nome do detentor (raspagem da página pública do SIGEF; melhor esforço)
  dataAprovacao: string | null;
  municipioIbge: number | null;
  uf: string | null;
  areaHa: number | null;            // área total da parcela
  sobreposicaoHa: number | null;    // área da parcela dentro do processo
  sobreposicaoPct: number | null;   // % do processo coberto por esta parcela
  /** checagem de sanidade falhou — motivo substitui os números na exibição */
  sobreposicaoAVerificar?: string;
  relacao: "sobreposta" | "vizinha";
}

export interface SigefResultado {
  disponivel: boolean;
  fonte: string;
  dataBase: string;
  consultadoEm: string;
  totalSobrepostas: number;
  totalVizinhas: number;
  coberturaPct: number | null; // % do processo coberto por parcelas certificadas
  coberturaAVerificar?: string; // sanidade da cobertura falhou — motivo
  // contrato de três estados + tier — obrigatório em todos os caminhos
  estadoConsulta: EstadoConsulta;
  situacaoRegistro: SituacaoRegistro | null;
  tierFonte: TierFonte;
  janelaCobertura: string | null;
  identificadorVinculo: IdentificadorVinculo | null;
  truncado?: boolean;          // true se a fonte devolveu mais parcelas do que buscamos
  parcelas: SigefParcelaSobreposta[];
  // Geometrias das parcelas (mesma consulta) — para preencher o cache de mapa
  // sem nova ida à rede. NÃO deve ser persistido em campos_especificos.
  geometrias?: SigefParcelaGeometria[];
  erro?: string;
  avisoDataBase?: string; // preenchido quando a base do espelho está defasada (> ~6 meses)
}

type Ring = number[][];          // [ [lng,lat], ... ]
type Poly = Ring[];              // polígono com furos
type MultiPoly = Poly[];

export function geojsonToMultiPoly(geometry: any): MultiPoly {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates as Poly];
  if (geometry.type === "MultiPolygon") return geometry.coordinates as MultiPoly;
  return [];
}

// Área assinada planar (para orientação e containment de anéis)
function signedRingArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return sum / 2;
}

function pointInRing(pt: number[], ring: Ring): boolean {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// esri rings → MultiPolygon GeoJSON: na convenção Esri, cascas são horárias
// (área assinada negativa em lng/lat) e furos anti-horários. Cada furo é
// associado à casca que o contém.
export function esriRingsToMultiPoly(rings: Ring[]): MultiPoly {
  const valid = rings.filter((r) => r.length >= 4);
  const shells: { ring: Ring; holes: Ring[] }[] = [];
  const holes: Ring[] = [];
  for (const r of valid) {
    if (signedRingArea(r) <= 0) shells.push({ ring: r, holes: [] });
    else holes.push(r);
  }
  // sem casca identificável (orientação fora do padrão) — trata tudo como casca
  if (shells.length === 0) return valid.map((r) => [r]);
  for (const h of holes) {
    // associa o furo à menor casca que contém um de seus vértices
    let best: { ring: Ring; holes: Ring[] } | null = null;
    let bestArea = Infinity;
    for (const s of shells) {
      if (pointInRing(h[0], s.ring)) {
        const a = Math.abs(signedRingArea(s.ring));
        if (a < bestArea) { best = s; bestArea = a; }
      }
    }
    if (best) best.holes.push(h);
    else shells.push({ ring: h, holes: [] }); // furo órfão — trata como casca
  }
  return shells.map((s) => [s.ring, ...s.holes]);
}

// GeoJSON MultiPolygon → esri rings preservando topologia: casca horária, furo anti-horário
function multiPolyToEsriRings(mp: MultiPoly): Ring[] {
  const rings: Ring[] = [];
  for (const poly of mp) {
    for (let i = 0; i < poly.length; i++) {
      const ring = poly[i].slice();
      const area = signedRingArea(ring);
      const isShell = i === 0;
      // esri: shell CW (área assinada negativa), hole CCW (positiva)
      if ((isShell && area > 0) || (!isShell && area < 0)) ring.reverse();
      rings.push(ring);
    }
  }
  return rings;
}

// Área geodésica aproximada (ha) de um MultiPolygon lng/lat
export function multiPolyAreaHa(mp: MultiPoly): number {
  const R = 6371008.8;
  let total = 0;
  for (const poly of mp) {
    for (let ri = 0; ri < poly.length; ri++) {
      const ring = poly[ri];
      if (ring.length < 3) continue;
      let sum = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x1, y1] = ring[j];
        const [x2, y2] = ring[i];
        sum += ((x2 - x1) * Math.PI / 180) * (2 + Math.sin(y1 * Math.PI / 180) + Math.sin(y2 * Math.PI / 180));
      }
      const areaM2 = Math.abs((sum * R * R) / 2);
      // primeiro anel = casca; demais = furos
      total += ri === 0 ? areaM2 : -areaM2;
    }
  }
  return Math.max(0, total) / 10000;
}

// Interseção geométrica exata (polygon-clipping) → área em ha
export function intersectionAreaHa(a: MultiPoly, b: MultiPoly): number {
  try {
    const inter = polygonClipping.intersection(a as any, b as any);
    if (!inter || inter.length === 0) return 0;
    return multiPolyAreaHa(inter as any);
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Metadados do espelho (data-base) + health-check
// ---------------------------------------------------------------------------

interface SigefEspelhoInfo {
  dataBaseIso: string;   // data da última edição dos dados no espelho
  idadeDias: number;
  defasada: boolean;     // idade > MAX_IDADE_BASE_DIAS
  layerName: string | null;
}

let espelhoInfoCache: { info: SigefEspelhoInfo; fetchedAt: number } | null = null;
const ESPELHO_INFO_TTL_MS = 6 * 60 * 60 * 1000; // 6h

async function fetchEspelhoInfo(): Promise<SigefEspelhoInfo> {
  if (espelhoInfoCache && Date.now() - espelhoInfoCache.fetchedAt < ESPELHO_INFO_TTL_MS) {
    return espelhoInfoCache.info;
  }
  const resp = await fetch(`${SIGEF_ARCGIS_LAYER_URL}?f=json`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`Metadados do espelho SIGEF: HTTP ${resp.status}`);
  const meta = await resp.json();
  if (meta?.error) throw new Error(`Metadados do espelho SIGEF: ${meta.error.message || "erro"}`);
  const lastEdit: number | undefined =
    meta?.editingInfo?.dataLastEditDate ?? meta?.editingInfo?.lastEditDate;
  if (typeof lastEdit !== "number") {
    throw new Error("Metadados do espelho SIGEF sem editingInfo.dataLastEditDate — formato do serviço mudou");
  }
  const idadeDias = Math.floor((Date.now() - lastEdit) / 86_400_000);
  const info: SigefEspelhoInfo = {
    dataBaseIso: new Date(lastEdit).toISOString(),
    idadeDias,
    defasada: idadeDias > MAX_IDADE_BASE_DIAS,
    layerName: typeof meta?.name === "string" ? meta.name : null,
  };
  espelhoInfoCache = { info, fetchedAt: Date.now() };
  return info;
}

function formatDataBase(info: SigefEspelhoInfo | null): string {
  if (!info) return "desconhecida";
  const d = new Date(info.dataBaseIso);
  const meses = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  return `${meses[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
}

export interface SigefHealthResult {
  ok: boolean;
  dataBase: string | null;      // ISO da última atualização dos dados do espelho
  idadeDias: number | null;
  baseDefasada: boolean;
  avisos: string[];
  erro?: string;
}

// Polígono conhecido (oeste da Bahia, região com muitas parcelas certificadas)
// usado para validar que o espelho continua respondendo no formato esperado.
const HEALTHCHECK_POLYGON = {
  rings: [[[-45.95, -12.05], [-45.85, -12.05], [-45.85, -12.15], [-45.95, -12.15], [-45.95, -12.05]]],
  spatialReference: { wkid: 4326 },
};

/**
 * Health-check do espelho SIGEF: valida metadados (idade da base) e executa
 * uma consulta espacial com um polígono conhecido, conferindo que o formato
 * de resposta e os campos esperados continuam presentes.
 */
export async function verificarEspelhoSigef(): Promise<SigefHealthResult> {
  const result: SigefHealthResult = {
    ok: false,
    dataBase: null,
    idadeDias: null,
    baseDefasada: false,
    avisos: [],
  };
  try {
    // 1) Metadados: data-base do espelho
    const info = await fetchEspelhoInfo();
    result.dataBase = info.dataBaseIso;
    result.idadeDias = info.idadeDias;
    result.baseDefasada = info.defasada;
    if (info.defasada) {
      result.avisos.push(
        `Base do espelho SIGEF defasada: última atualização há ${info.idadeDias} dias (${formatDataBase(info)})`
      );
    }

    // 2) Consulta com polígono conhecido: deve devolver features com os campos usados
    const data = await fetchSigefPage({
      geometry: JSON.stringify(HEALTHCHECK_POLYGON),
      geometryType: "esriGeometryPolygon",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "parcela_co,nome_area,situacao_i,status,data_aprov",
      returnGeometry: "false",
      resultRecordCount: "3",
      f: "json",
    });
    const features: any[] = Array.isArray(data?.features) ? data.features : [];
    if (features.length === 0) {
      throw new Error("Consulta de health-check não retornou nenhuma parcela em região densamente certificada — serviço mudou de comportamento");
    }
    const attrs = features[0]?.attributes || {};
    const camposEsperados = ["parcela_co", "nome_area", "situacao_i", "status"];
    const faltando = camposEsperados.filter((c) => !(c in attrs));
    if (faltando.length > 0) {
      throw new Error(`Resposta do espelho SIGEF sem os campos esperados: ${faltando.join(", ")} — schema mudou`);
    }
    result.ok = true;
  } catch (e: any) {
    result.erro = e?.message || String(e);
  }
  return result;
}

async function fetchSigefPage(bodyParams: Record<string, string>): Promise<any> {
  const resp = await fetch(SIGEF_ARCGIS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(bodyParams).toString(),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`SIGEF respondeu HTTP ${resp.status}`);
  const data = await resp.json();
  if (data?.error) throw new Error(`SIGEF erro: ${data.error.message || "consulta inválida"}`);
  return data;
}

export interface SigefParcelaGeometria {
  codigoParcela: string | null;
  geometry: { type: "MultiPolygon"; coordinates: MultiPoly };
}

/**
 * Busca apenas as geometrias das parcelas SIGEF que intersectam (ou tocam,
 * raio ~50 m) o polígono informado. Consulta leve, sem cálculo de
 * sobreposição nem detentores — usada para desenhar as parcelas no mapa.
 */
export async function consultarGeometriasParcelasSigef(processGeometry: any): Promise<SigefParcelaGeometria[]> {
  const processMp = geojsonToMultiPoly(processGeometry);
  if (processMp.length === 0) return [];
  const esriGeometry = JSON.stringify({
    rings: multiPolyToEsriRings(processMp),
    spatialReference: { wkid: 4326 },
  });
  const baseParams: Record<string, string> = {
    geometry: esriGeometry,
    geometryType: "esriGeometryPolygon",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: "50",
    units: "esriSRUnit_Meter",
    outFields: "parcela_co",
    returnGeometry: "true",
    geometryPrecision: "6",
    f: "json",
  };
  const PAGE_SIZE = 200;
  const MAX_FEATURES = 1000;
  const features: any[] = [];
  let offset = 0;
  for (;;) {
    const data = await fetchSigefPage({
      ...baseParams,
      resultOffset: String(offset),
      resultRecordCount: String(PAGE_SIZE),
    });
    const page: any[] = Array.isArray(data?.features) ? data.features : [];
    features.push(...page.slice(0, MAX_FEATURES - features.length));
    const more = data?.exceededTransferLimit === true && page.length > 0;
    if (!more || features.length >= MAX_FEATURES) break;
    offset += page.length;
  }
  const out: SigefParcelaGeometria[] = [];
  for (const f of features) {
    const mp = esriRingsToMultiPoly(Array.isArray(f.geometry?.rings) ? f.geometry.rings : []);
    if (mp.length === 0) continue;
    out.push({
      codigoParcela: f.attributes?.parcela_co ?? null,
      geometry: { type: "MultiPolygon", coordinates: mp },
    });
  }
  return out;
}

/**
 * Consulta as parcelas certificadas SIGEF que intersectam (ou tocam, num raio
 * de ~50 m) o polígono informado e calcula o percentual de sobreposição por
 * interseção geométrica exata.
 */
export async function consultarParcelasSigef(processGeometry: any): Promise<SigefResultado> {
  const consultadoEm = new Date().toISOString();

  // Data-base real do espelho (metadados) — melhor esforço, sem quebrar a consulta
  let espelhoInfo: SigefEspelhoInfo | null = null;
  try {
    espelhoInfo = await fetchEspelhoInfo();
  } catch (e: any) {
    console.warn(`[SIGEF] Falha ao obter metadados do espelho: ${e?.message || e}`);
  }
  const avisoDataBase = espelhoInfo?.defasada
    ? `Base do espelho SIGEF possivelmente defasada: última atualização há ${espelhoInfo.idadeDias} dias (${formatDataBase(espelhoInfo)})`
    : undefined;
  if (avisoDataBase) console.warn(`[SIGEF] ${avisoDataBase}`);

  const dataBase = espelhoInfo ? formatDataBase(espelhoInfo) : "maio/2026";
  const base: SigefResultado = {
    disponivel: false,
    fonte: "SIGEF/INCRA — Acervo Fundiário (espelho ArcGIS sigef_brasil)",
    dataBase,
    consultadoEm,
    // default: falha = "não consultada" (sobrescrito no caminho de sucesso)
    estadoConsulta: "nao_consultada",
    situacaoRegistro: null,
    tierFonte: "T1",
    janelaCobertura: `espelho SIGEF com data-base ${dataBase}`,
    identificadorVinculo: { tipo: "geometria", valor: "polígono do processo ANM", proveniencia: "documento_oficial", origem: "SIGMINE" },
    totalSobrepostas: 0,
    totalVizinhas: 0,
    coberturaPct: null,
    parcelas: [],
  };

  const processMp = geojsonToMultiPoly(processGeometry);
  if (processMp.length === 0) {
    return { ...base, erro: "Geometria do processo indisponível" };
  }
  const processAreaHa = multiPolyAreaHa(processMp);
  const esriGeometry = JSON.stringify({
    rings: multiPolyToEsriRings(processMp),
    spatialReference: { wkid: 4326 },
  });

  const baseParams: Record<string, string> = {
    geometry: esriGeometry,
    geometryType: "esriGeometryPolygon",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: "50",
    units: "esriSRUnit_Meter",
    outFields: "parcela_co,nome_area,situacao_i,status,codigo_imo,registro_m,data_aprov,municipio_,uf_id",
    returnGeometry: "true",
    f: "json",
  };

  // Paginação até esgotar (limite de segurança: 1000 parcelas)
  const PAGE_SIZE = 200;
  const MAX_FEATURES = 1000;
  const features: any[] = [];
  let truncado = false;
  try {
    let offset = 0;
    for (;;) {
      const data = await fetchSigefPage({
        ...baseParams,
        resultOffset: String(offset),
        resultRecordCount: String(PAGE_SIZE),
      });
      const page: any[] = Array.isArray(data?.features) ? data.features : [];
      const room = MAX_FEATURES - features.length;
      features.push(...page.slice(0, room));
      const more = data?.exceededTransferLimit === true && page.length > 0;
      if (page.length > room || (more && features.length >= MAX_FEATURES)) {
        truncado = true;
        console.warn(`[SIGEF] Resultado truncado em ${MAX_FEATURES} parcelas para o polígono consultado`);
        break;
      }
      if (!more) break;
      offset += page.length;
    }
  } catch (e: any) {
    console.error(`[SIGEF] Falha ao consultar espelho: ${e?.message || e}`);
    return { ...base, ...(avisoDataBase ? { avisoDataBase } : {}), erro: e?.message || "Falha ao consultar SIGEF" };
  }

  const parcelas: SigefParcelaSobreposta[] = [];
  const geometrias: SigefParcelaGeometria[] = [];
  // União das interseções para calcular a cobertura total sem contar dupla sobreposição
  let coveredUnion: any = [];

  for (const f of features) {
    const attrs = f.attributes || {};
    const parcelMp = esriRingsToMultiPoly(Array.isArray(f.geometry?.rings) ? f.geometry.rings : []);
    if (parcelMp.length > 0 && attrs.parcela_co) {
      geometrias.push({
        codigoParcela: attrs.parcela_co,
        geometry: { type: "MultiPolygon", coordinates: parcelMp },
      });
    }
    const interHa = parcelMp.length > 0 ? intersectionAreaHa(processMp, parcelMp) : 0;
    // limiar de 0,01 ha (100 m²) para descartar ruído numérico de borda
    const sobreposta = interHa > 0.01;
    if (sobreposta) {
      try {
        const inter = polygonClipping.intersection(processMp as any, parcelMp as any);
        coveredUnion = coveredUnion.length === 0 ? inter : polygonClipping.union(coveredUnion, inter as any);
      } catch { /* união é apenas informativa */ }
    }
    const pct = processAreaHa > 0 ? (interHa / processAreaHa) * 100 : null;
    const areaParcelaHa = parcelMp.length > 0 ? multiPolyAreaHa(parcelMp) : null;
    // sanidade: interseção ≤ menor área, pct ≤ 100 — falha vira "a verificar"
    const san = sobreposta
      ? sanearSobreposicao({
          sobreposicaoHa: Math.round(interHa * 100) / 100,
          sobreposicaoPct: pct != null ? Math.round(pct * 100) / 100 : null,
          areaMenorHa: areaParcelaHa,
          areaOutraHa: processAreaHa > 0 ? processAreaHa : null,
          contexto: `parcela SIGEF ${attrs.parcela_co ?? "sem código"} × processo`,
        })
      : null;
    parcelas.push({
      codigoParcela: attrs.parcela_co ?? null,
      nomeArea: attrs.nome_area ?? null,
      situacao: attrs.situacao_i ?? null,
      status: attrs.status ?? null,
      codigoImovel: attrs.codigo_imo ?? null,
      registroMatricula: attrs.registro_m ?? null,
      detentor: null,
      dataAprovacao: attrs.data_aprov ? new Date(attrs.data_aprov).toISOString() : null,
      municipioIbge: attrs.municipio_ ?? null,
      uf: attrs.uf_id != null ? String(attrs.uf_id) : null,
      areaHa: areaParcelaHa != null ? Math.round(areaParcelaHa * 100) / 100 : null,
      sobreposicaoHa: san ? san.sobreposicaoHa : 0,
      sobreposicaoPct: san ? san.sobreposicaoPct : 0,
      ...(san?.sobreposicaoAVerificar ? { sobreposicaoAVerificar: san.sobreposicaoAVerificar } : {}),
      relacao: sobreposta ? "sobreposta" : "vizinha",
    });
  }

  parcelas.sort((a, b) => (b.sobreposicaoPct ?? 0) - (a.sobreposicaoPct ?? 0));

  // Detentores: primeiro o cache SNCR (por código do imóvel — rápido, sem rede),
  // depois melhor esforço na página pública do SIGEF/Wayback só para o que faltar.
  try {
    const { preencherDetentoresDoCacheSncr } = await import("./sncr-detentores");
    await preencherDetentoresDoCacheSncr(parcelas);
  } catch { /* detentor é opcional */ }
  try {
    const codigosSobrepostas = parcelas
      .filter((p) => p.relacao === "sobreposta" && p.codigoParcela && !p.detentor)
      .map((p) => p.codigoParcela as string);
    if (codigosSobrepostas.length > 0) {
      const detentores = await buscarDetentoresParcelas(codigosSobrepostas);
      if (detentores.size > 0) {
        for (const p of parcelas) {
          if (p.codigoParcela && detentores.has(p.codigoParcela)) {
            p.detentor = detentores.get(p.codigoParcela)!;
          }
        }
      }
    }
  } catch { /* detentor é opcional */ }

  const coveredHa = coveredUnion.length > 0 ? multiPolyAreaHa(coveredUnion) : 0;

  const coberturaRaw = processAreaHa > 0 ? Math.round((coveredHa / processAreaHa) * 10000) / 100 : null;
  const cobertura = coberturaRaw != null ? checarPercentual(coberturaRaw, "cobertura do processo por parcelas SIGEF") : null;

  return {
    ...base,
    disponivel: true,
    estadoConsulta: parcelas.length > 0 ? "registro_existente" : "consultada_sem_registro",
    // cadastro fundiário não classifica situação: registro vigente = indeterminada
    situacaoRegistro: parcelas.length > 0 ? "indeterminada" : null,
    totalSobrepostas: parcelas.filter((p) => p.relacao === "sobreposta").length,
    totalVizinhas: parcelas.filter((p) => p.relacao === "vizinha").length,
    coberturaPct: cobertura == null ? null : cobertura.ok ? cobertura.valor : null,
    ...(cobertura && !cobertura.ok ? { coberturaAVerificar: cobertura.motivo } : {}),
    ...(truncado ? { truncado: true } : {}),
    ...(avisoDataBase ? { avisoDataBase } : {}),
    parcelas,
    geometrias,
  };
}
